// api/late-filings.js
const UA = { 'User-Agent': 'BioScannerPro admin@bioscannerpro.app' };

const HEALTH_SICS = new Set([
  '2830','2831','2833','2834','2835','2836',
  '8011','8049','8051','8062','8071','8099',
  '8731','8734',
  '3826','3827','3841','3842','3845','3851',
  '5047','5122',
]);

async function fetchNT(formType, days) {
  const end   = new Date();
  const start = new Date(Date.now() - days * 86400000);
  const fmt   = d => d.toISOString().slice(0,10);
  const params = new URLSearchParams({
    q: `"${formType}"`, forms: formType, dateRange: 'custom',
    startdt: fmt(start), enddt: fmt(end), size: '50'
  });
  const res = await fetch(`https://efts.sec.gov/LATEST/search-index?${params}`, { headers: UA });
  if (!res.ok) throw new Error(`EDGAR error ${res.status}`);
  const data = await res.json();
  return data?.hits?.hits || [];
}

async function getTickerMap() {
  const res = await fetch('https://www.sec.gov/files/company_tickers_exchange.json', { headers: UA });
  if (!res.ok) throw new Error(`Ticker map error: ${res.status}`);
  const data = await res.json();
  const map = {};
  for (const [cik, name, ticker, exchange] of data.data) {
    map[String(cik)] = { name, ticker, exchange: (exchange || '').toLowerCase() };
  }
  return map;
}

async function getSIC(cik) {
  try {
    const padded = String(cik).padStart(10, '0');
    const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: UA });
    if (!res.ok) return {};
    const d = await res.json();
    return { sic: String(d.sic || ''), sicDesc: d.sicDescription || 'Healthcare / Biotech' };
  } catch { return {}; }
}

function extractCIK(hit) {
  if (hit._source?.ciks?.length) return String(hit._source.ciks[0]);
  const id  = (hit._id || '').split(':')[0];
  const num = id.split('-')[0];
  return num ? String(parseInt(num, 10)) : null;
}

function getRisk(fileDate) {
  const days = Math.floor((Date.now() - new Date(fileDate)) / 86400000);
  return days > 45 ? 'High' : days > 20 ? 'Medium' : 'Low';
}

function getBounce(sic) {
  if (['2836','8731','2835','2833'].includes(sic)) return 'High';
  if (HEALTH_SICS.has(sic)) return 'Medium';
  return 'Low';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  if (req.met
