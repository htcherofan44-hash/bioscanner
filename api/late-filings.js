// api/late-filings.js - Fast version using SEC company_tickers_exchange.json for filtering

const UA = { 'User-Agent': 'BioScannerPro admin@bioscannerpro.app' };

const BIOTECH_SICS = new Set([
  '2830','2833','2834','2835','2836',
  '8731','8734','3826','3841','3845','5122'
]);

async function getTickerMap() {
  const res = await fetch('https://www.sec.gov/files/company_tickers_exchange.json', { headers: UA });
  if (!res.ok) throw new Error(`Ticker map error: ${res.status}`);
  const data = await res.json();
  const map = {};
  for (const row of data.data) {
    const [cik, name, ticker, exchange] = row;
    if (!map[cik]) map[cik] = { cik, name, ticker, exchange };
  }
  return map;
}

async function fetchNT(formType, days) {
  const end   = new Date();
  const start = new Date(Date.now() - days * 86400000);
  const fmt   = d => d.toISOString().slice(0,10);
  const params = new URLSearchParams({
    q: `"${formType}"`,
    forms: formType,
    dateRange: 'custom',
    startdt: fmt(start),
    enddt: fmt(end),
    size: '50'
  });
  const res = await fetch(`https://efts.sec.gov/LATEST/search-index?${params}`, { headers: UA });
  if (!res.ok) throw new Error(`EDGAR error ${res.status}`);
  const data = await res.json();
  return data?.hits?.hits || [];
}

async function getSIC(cik) {
  const padded = String(cik).padStart(10,'0');
  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: UA });
    if (!res.ok) return null;
    const d = await res.json();
    return { sic: String(d.sic || ''), sicDesc: d.sicDescription || '' };
  } catch { return null; }
}

function extractCIK(hit) {
  if (hit._source?.ciks?.length) return String(hit._source.ciks[0]);
  const id = (hit._id || '').split(':')[0];
  const num = id.split('-')[0];
  return num ? num.replace(/^0+/, '') : null;
}

function getRisk(fileDate) {
  const days = Math.floor((Date.now() - new Date(fileDate)) / 86400000);
  if (days > 45) return 'High';
  if (days > 20) return 'Medium';
  return 'Low';
}

function getBounce(sic) {
  if (['2836','8731','2835'].includes(sic)) return 'High';
  if (BIOTECH_SICS.has(sic))               return 'Medium';
  return 'Low';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [tickerMap, hitsK, hitsQ] = await Promise.all([
      getTickerMap(),
      fetchNT('NT 10-K', 90),
      fetchNT('NT 10-Q', 60),
    ]);

    const allHits = [
      ...hitsK.map(h => ({ ...h, _form: 'NT 10-K' })),
      ...hitsQ.map(h => ({ ...h, _form: 'NT 10-Q' })),
    ];

    const seen = new Set();
    const unique = allHits.filter(h => {
      const key = `${h._source?.entity_name}_${h._form}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    const nasdaqHits = unique.filter(hit => {
      const cik = extractCIK(hit);
      if (!cik) return false;
      const co = tickerMap[cik] || tickerMap[parseInt(cik)];
      if (!co) return false;
      const ex = (co.exchange || '').toLowerCase();
      return ex.includes('nasdaq') || ex === 'nms' || ex === 'ncm' || ex === 'ngm';
    });

    const results = [];
    const sicFetches = await Promise.allSettled(
      nasdaqHits.slice(0, 20).map(async hit => {
        const cik     = extractCIK(hit);
        const co      = tickerMap[cik] || tickerMap[parseInt(cik)];
        const src     = hit._source || {};
        const sicData = await getSIC(cik);
        const sic     = sicData?.sic || '';
        if (!BIOTECH_SICS.has(sic)) return null;

        const risk   = getRisk(src.file_date);
        const bounce = getBounce(sic);
        const bounceReason =
          bounce === 'High' && risk === 'Low' ? 'Core biotech, recent NT filing — likely auditor scheduling. Quick resolution expected.' :
          bounce === 'High'                   ? 'Biotech/biopharma — NT delays from auditors often resolve fast, triggering a relief rally.' :
          bounce === 'Medium'                 ? 'Pharma-adjacent. Bounce depends on pipeline strength and delay reason.' :
                                               'Limited bounce potential without a confirmed catalyst.';
        return {
          ticker:              co?.ticker || '',
          name:                src.entity_name || co?.name || 'Unknown',
          filing_missed:       hit._form,
          notice_date:         src.file_date        || 'Unknown',
          fiscal_period:       src.period_of_report || 'Unknown',
          reason:              'NT form filed — company notified SEC it cannot file on time',
          status:              'NT Filed — Late Filing',
          risk_level:          risk,
          market_cap:          'See Yahoo Finance',
          pipeline:            sicData?.sicDesc || 'Biotech / Biopharma',
          resolution_deadline: '15 days from original deadline per SEC rules',
          bounce_potential:    bounce,
          bounce_reason:       bounceReason,
          sec_url:             `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=NT&dateb=&owner=include&count=10`,
        };
      })
    );

    for (const r of sicFetches) {
      if (r.status === 'fulfilled' && r.value) results.push(r.value);
    }

    results.sort((a,b) => new Date(b.notice_date) - new Date(a.notice_date));
    return res.status(200).json({ results, scanned_at: new Date().toISOString() });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
