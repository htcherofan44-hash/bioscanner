// api/late-filings.js
// SEC EDGAR NT 10-K / NT 10-Q scanner for biotech/pharma on Nasdaq
// CIK is extracted from the _id field of each EDGAR hit

const BIOTECH_SICS = new Set([
  '2830','2833','2834','2835','2836',
  '8731','8734','3826','3841','3845','5122'
]);

const UA = { 'User-Agent': 'BioScannerPro admin@bioscannerpro.app' };

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
    size: '40'
  });
  const res = await fetch(`https://efts.sec.gov/LATEST/search-index?${params}`, { headers: UA });
  if (!res.ok) throw new Error(`EDGAR error ${res.status} for ${formType}`);
  const data = await res.json();
  return data?.hits?.hits || [];
}

function extractCIK(hit) {
  if (hit._source?.ciks?.length) return String(hit._source.ciks[0]);
  if (hit._source?.cik)          return String(hit._source.cik);
  const id = hit._id || '';
  const acc = id.split(':')[0];
  const parts = acc.split('-');
  if (parts[0]) return parts[0].replace(/^0+/, '');
  return null;
}

async function getCompany(cik) {
  if (!cik) return null;
  const padded = String(cik).padStart(10,'0');
  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: UA });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function getRisk(fileDate) {
  const days = Math.floor((Date.now() - new Date(fileDate)) / 86400000);
  if (days > 45) return 'High';
  if (days > 20) return 'Medium';
  return 'Low';
}

function getBounce(sic) {
  const s = String(sic);
  if (['2836','8731','2835'].includes(s)) return 'High';
  if (BIOTECH_SICS.has(s))               return 'Medium';
  return 'Low';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [hitsK, hitsQ] = await Promise.all([
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

    const settled = await Promise.allSettled(
      unique.slice(0, 30).map(async hit => {
        const src = hit._source || {};
        const cik = extractCIK(hit);
        const co  = await getCompany(cik);

        const sic      = String(co?.sic || '');
        const exchanges = (co?.exchanges || []).map(e => e.toLowerCase()).join(' ');
        const ticker   = co?.tickers?.[0] || '';
        const name     = src.entity_name || co?.name || 'Unknown';

        if (!BIOTECH_SICS.has(sic))       return null;
        if (!exchanges.includes('nasdaq')) return null;

        const risk   = getRisk(src.file_date);
        const bounce = getBounce(sic);

        const bounceReason =
          bounce === 'High' && risk === 'Low' ? 'Core biotech, very recent NT filing — likely an auditor scheduling issue. Quick resolution expected.' :
          bounce === 'High'                   ? 'Biotech/biopharma pipeline company. NT filings from auditor delays often resolve in days, triggering a relief rally.' :
          bounce === 'Medium'                 ? 'Pharma-adjacent company. Bounce potential depends on pipeline strength and reason for delay.' :
          'Limited bounce potential without a confirmed catalyst.';

        return {
          ticker,
          name,
          filing_missed:       hit._form,
          notice_date:         src.file_date        || 'Unknown',
          fiscal_period:       src.period_of_report || 'Unknown',
          reason:              'NT form filed — company notified SEC it cannot file on time',
          status:              'NT Filed — Late Filing',
          risk_level:          risk,
          market_cap:          'See Yahoo Finance',
          pipeline:            co?.sicDescription   || 'Biotech / Biopharma',
          resolution_deadline: '15 days from original deadline per SEC rules',
          bounce_potential:    bounce,
          bounce_reason:       bounceReason,
          sec_url:             `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=NT&dateb=&owner=include&count=10`,
        };
      })
    );

    const results = settled
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value)
      .sort((a, b) => new Date(b.notice_date) - new Date(a.notice_date));

    return res.status(200).json({ results, scanned_at: new Date().toISOString() });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
