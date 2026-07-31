// netlify/functions/save-daily-close.js
// Corre sola todos los días de semana después del cierre de NYSE (16:00 ET)
// y guarda el cierre de los 17 tickers en Supabase.

const { schedule } = require("@netlify/functions");
const { createClient } = require("@supabase/supabase-js");

const TICKERS = [
  "GILD","VRTX","AMGN","BIIB","MRNA","LLY","JNJ","ABBV","MRK","UNH","ISRG","TEM",
  "MSFT","AMZN","GOOGL","META","USO"
];

const FINNHUB_KEY   = process.env.FINNHUB_KEY;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY; // service_role key, NUNCA la anon/public

console.log("DIAG SUPABASE_URL:", JSON.stringify(SUPABASE_URL));
console.log("DIAG SUPABASE_URL length:", (SUPABASE_URL||"").length);
console.log("DIAG SUPABASE_KEY presente:", !!SUPABASE_KEY, "length:", (SUPABASE_KEY||"").length);

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function getQuote(ticker) {
  const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_KEY}`);
  const j = await r.json();
  if (!j.c) throw new Error(`Sin precio para ${ticker}: ${JSON.stringify(j)}`);
  return j.c; // último precio = cierre oficial, si corre después de las 16:00 ET
}

const handler = async () => {
  // Fecha de NY (evita problemas de huso horario del servidor de Netlify, que corre en UTC)
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // formato YYYY-MM-DD

  const rows = [];
  const errors = [];

  for (const ticker of TICKERS) {
    try {
      const close = await getQuote(ticker);
      rows.push({ date: today, ticker, close });
    } catch (e) {
      errors.push({ ticker, error: e.message });
    }
    await new Promise((res) => setTimeout(res, 150)); // espaciar llamadas, evitar rate limit
  }

  if (rows.length) {
    const { error } = await supabase
      .from("etf_daily_closes")
      .upsert(rows, { onConflict: "date,ticker" });
    if (error) {
      console.error("Error guardando en Supabase:", error);
      return { statusCode: 500, body: JSON.stringify({ error, errors }) };
    }
  }

  console.log(`Guardados ${rows.length}/${TICKERS.length} tickers para ${today}`);
  if (errors.length) console.warn("Fallaron:", errors);

  return { statusCode: 200, body: JSON.stringify({ saved: rows.length, date: today, errors }) };
};

// 21:15 UTC = 17:15 EDT (verano) / 16:15 EST (invierno) — siempre después del cierre de NYSE
// Solo de lunes a viernes
module.exports.handler = schedule("15 21 * * 1-5", handler);
