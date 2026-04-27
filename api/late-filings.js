// api/late-filings.js
// Calls SEC EDGAR server-side (no CORS issue), filters biotech/pharma on Nasdaq

const BIOTECH_SICS = new Set([
  '2830','2833','2834','2835','2836',
  '8731','8734','3826','3841','3845','5122'
]);

async function fetchEdgar(formType, days) {
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
  const res = await fetch(`https://efts.sec.gov/LATEST/search-index?${params}`, {
    headers: { 'User-Agent': 'BioScannerPro contact@bioscannerpro.app' }
  });
  if (!res.ok) throw new Error(`EDGAR ${formType} error: ${res.status}`);
  return res.json();
}

async function getCompany(cik) {
  if (!cik) return null;
  const padded = String(cik).padStart(10,'0');
  const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { 'User-Agent': 'BioScannerPro contact@bioscannerpro.app' }
  });
  if (!res.ok) return null;
  return res.json();
}

function getRisk(filingDate) {
  const days = Math.floor((Date.now() - new Date(filingDate)) / 86400000);
  if (days > 45) return 'High';
  if (days > 20) return 'Medium';
  return 'Low';
}

function getBounce(sic) {
  if (['2836','8731','2835'].includes(String(sic))) return 'High';
  if (BIOTECH_SICS.has(String(sic))) return 'Medium';
  return 'Low';
}

function getBounceReason(bounce, risk) {
  if (bounce === 'High' && risk === 'Low')  return 'Core biotech - very recent filing. Likely administrative delay. Quick resolution probable.';
  if (bounce === 'High')                    return 'Biotech/biopharma with active pipeline. Auditor delays often resolve fast, stock can pop on filing.';
  if (bounce === 'Medium')                  return 'Pharma-adjacent sector. Recovery depends on pipeline and reason for delay.';
  return 'Limited bounce potential without a clear catalyst.';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const [ntK, ntQ] = await Promise.all([
      fetchEdgar('NT 10-K', 90),
      fetchEdgar('NT 10-Q', 60),
    ]);

    const hits = [
      ...(ntK?.hits?.hits || []).map(h => ({...h._source, _form:'NT 10-K'})),
      ...(ntQ?.hits?.hits || []).map(h => ({...h._source, _form:'NT 10-Q'})),
    ];

    const seen = new Set();
    const unique = hits.filter(h => {
      const key = `${h.entity_name}_${h._form}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    const settled = await Promise.allSettled(
      unique.slice(0, 25).map(async filing => {
        const cik = filing.ciks?.[0] || filing.cik_str || filing.cik;
        let company = null;
        try { company = await getCompany(cik); } catch {}

        const sic      = String(company?.sic || '');
        const exchange = (company?.exchanges || []).join(' ').toLowerCase();
        const ticker   = company?.tickers?.[0] || '';

        if (!BIOTECH_SICS.has(sic)) return null;
        if (!exchange.includes('nasdaq')) return null;

        const risk   = getRisk(filing.file_date);
        const bounce = getBounce(sic);

        return {
          ticker,
          name:                filing.entity_name || company?.name || 'Unknown',
          filing_missed:       filing._form,
          notice_date:         filing.file_date,
          fiscal_period:       filing.period_of_report || 'Unknown',
          reason:              'NT form filed - company notified SEC of inability to file on time',
          status:              'NT Filed - Late Filing',
          risk_level:          risk,
          market_cap:          'See Yahoo Finance',
          pipeline:            company?.sicDescription || 'Biotech / Biopharma',
          resolution_deadline: '15 days from original deadline per SEC rules',
          bounce_potential:    bounce,
          bounce_reason:       getBounceReason(bounce, risk),
          sec_url:             `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=NT&dateb=&owner=include&count=10`,
        };
      })
    );

    const results = settled
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .sort((a,b) => new Date(b.notice_date) - new Date(a.notice_date));

    return res.status(200).json({ results, scanned_at: new Date().toISOString() });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
