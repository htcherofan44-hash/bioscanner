// api/late-filings.js
// Pulls NT 10-K and NT 10-Q filings from SEC EDGAR (100% free, no API key)
// Filters for biotech/biopharma SIC codes on NASDAQ

const BIOTECH_SICS = new Set([
  '2830','2833','2834','2835','2836', // pharma / biotech
  '8731','8734',                       // R&D / testing labs
  '3826','3827','3841','3845',         // medical instruments
  '5122',                              // drug wholesalers
]);

const NASDAQ_EXCHANGES = new Set(['Nasdaq Global Select Market','Nasdaq Global Market','Nasdaq Capital Market','NASDAQ']);

async function fetchEdgar(formType, days = 90) {
  const end   = new Date();
  const start = new Date(end - days * 86400000);
  const fmt   = d => d.toISOString().slice(0,10);

  const url = new URL('https://efts.sec.gov/LATEST/search-index');
  url.searchParams.set('q', `"${formType}"`);
  url.searchParams.set('forms', formType);
  url.searchParams.set('dateRange', 'custom');
  url.searchParams.set('startdt', fmt(start));
  url.searchParams.set('enddt',   fmt(end));
  url.searchParams.set('size', '50');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'BioScannerPro research@bioscannerpro.app' }
  });
  if (!res.ok) throw new Error(`EDGAR error ${res.status}`);
  return res.json();
}

async function getCompanyDetails(cik) {
  const paddedCik = String(cik).padStart(10, '0');
  const res = await fetch(
    `https://data.sec.gov/submissions/CIK${paddedCik}.json`,
    { headers: { 'User-Agent': 'BioScannerPro research@bioscannerpro.app' } }
  );
  if (!res.ok) return null;
  return res.json();
}

function classifyRisk(company, filing) {
  const daysSince = Math.floor((Date.now() - new Date(filing.file_date)) / 86400000);
  if (daysSince > 60) return 'High';
  if (daysSince > 30) return 'Medium';
  return 'Low';
}

function bouncePotential(company) {
  const sic = String(company?.sic || '');
  if (['2836','8731'].includes(sic)) return 'High';
  if (BIOTECH_SICS.has(sic))        return 'Medium';
  return 'Low';
}

function bounceReason(risk, bounce) {
  if (bounce === 'High' && risk !== 'High') return 'Core biotech/biopharma — filing delays often administrative. Stock may recover once filed.';
  if (bounce === 'High') return 'Biotech with active pipeline. Late filings from auditor issues often resolve quickly, triggering relief bounce.';
  if (bounce === 'Medium') return 'Pharma-adjacent sector. Recovery depends on reason for delay and pipeline strength.';
  return 'Limited bounce potential without confirmed catalyst.';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // Fetch NT 10-K and NT 10-Q in parallel
    const [ntKData, ntQData] = await Promise.all([
      fetchEdgar('NT 10-K', 90),
      fetchEdgar('NT 10-Q', 60),
    ]);

    const allHits = [
      ...(ntKData?.hits?.hits || []).map(h => ({...h._source, _formType:'NT 10-K'})),
      ...(ntQData?.hits?.hits || []).map(h => ({...h._source, _formType:'NT 10-Q'})),
    ];

    // Deduplicate by entity+form
    const seen = new Set();
    const unique = allHits.filter(h => {
      const key = `${h.entity_name}_${h._formType}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    // Enrich with company details and filter for biotech on Nasdaq
    const enriched = await Promise.allSettled(
      unique.slice(0, 30).map(async filing => {
        const cik = filing.file_num?.split('-')[1] || filing.cik_str || filing.cik;
        let company = null;
        try { company = await getCompanyDetails(cik); } catch {}

        const sic = String(company?.sic || '');
        const exchange = company?.exchanges?.[0] || '';

        // Filter: must be biotech SIC AND Nasdaq
        if (!BIOTECH_SICS.has(sic)) return null;
        if (!NASDAQ_EXCHANGES.has(exchange) && !exchange.toLowerCase().includes('nasdaq')) return null;

        const ticker = company?.tickers?.[0] || '';
        const risk   = classifyRisk(company, filing);
        const bounce = bouncePotential(company);

        return {
          ticker:               ticker || '—',
          name:                 filing.entity_name || company?.name || '?',
          filing_missed:        filing._formType,
          notice_date:          filing.file_date,
          fiscal_period:        filing.period_of_report ? `Period: ${filing.period_of_report}` : 'Unknown',
          reason:               'Late filing notification (NT form submitted to SEC)',
          status:               'NT Filed — Nasdaq notified',
          risk_level:           risk,
          market_cap:           'See Yahoo Finance',
          pipeline:             company?.sicDescription || 'Biotech / Biopharma',
          resolution_deadline:  'Within 15 days of original deadline per SEC rules',
          bounce_potential:     bounce,
          bounce_reason:        bounceReason(risk, bounce),
          sec_url:              `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=NT&dateb=&owner=include&count=10`,
        };
      })
    );

    const results = enriched
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value)
      .sort((a,b) => new Date(b.notice_date) - new Date(a.notice_date));

    return res.status(200).json({ results, source: 'SEC EDGAR (free)', scanned_at: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
