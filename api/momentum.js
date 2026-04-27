// api/momentum.js
// Uses Yahoo Finance JSON API directly - no npm package needed, no install issues
// Screens for: price <$5, vol >500K, rel vol >2x, float <30M, change >3%, within 10% of 52W high

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

async function getScreenerResults() {
  const body = {
    offset: 0,
    size: 100,
    sortField: 'percentchange',
    sortType: 'DESC',
    quoteType: 'EQUITY',
    query: {
      operator: 'AND',
      operands: [
        { operator: 'or', operands: [
          { operator: 'eq', operands: ['exchange', 'NMS'] },
          { operator: 'eq', operands: ['exchange', 'NCM'] },
          { operator: 'eq', operands: ['exchange', 'NGM'] },
        ]},
        { operator: 'lt', operands: ['regularMarketPrice', 5] },
        { operator: 'gt', operands: ['regularMarketPrice', 0.1] },
        { operator: 'gt', operands: ['regularMarketVolume', 500000] },
        { operator: 'or', operands: [
          { operator: 'eq', operands: ['sector', 'Healthcare'] },
        ]},
      ]
    },
    userId: '',
    userIdType: 'guid'
  };

  const res = await fetch('https://query1.finance.yahoo.com/v1/finance/screener?lang=en-US&region=US&formatted=false', {
    method: 'POST',
    headers: { ...YF_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Yahoo screener error: ${res.status}`);
  const data = await res.json();
  return data?.finance?.result?.[0]?.quotes || [];
}

async function getSummary(ticker) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=defaultKeyStatistics,summaryDetail`;
  try {
    const res = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const ks = data?.quoteSummary?.result?.[0]?.defaultKeyStatistics;
    const sd = data?.quoteSummary?.result?.[0]?.summaryDetail;
    return { floatShares: ks?.floatShares, avgVolume: sd?.averageVolume10days || sd?.averageVolume };
  } catch { return null; }
}

function fmtCap(mc) {
  if (!mc) return 'Unknown';
  if (mc >= 1e9) return `~$${(mc/1e9).toFixed(1)}B`;
  return `~$${(mc/1e6).toFixed(0)}M`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const quotes = await getScreenerResults();

    const results = [];
    for (const q of quotes.slice(0, 50)) {
      try {
        const price       = q.regularMarketPrice          || 0;
        const changePct   = q.regularMarketChangePercent  || 0;
        const volume      = q.regularMarketVolume         || 0;
        const high52      = q.fiftyTwoWeekHigh            || 0;
        const low52       = q.fiftyTwoWeekLow             || 0;
        const marketCap   = q.marketCap                   || 0;
        const avgVol      = q.averageDailyVolume3Month || q.averageDailyVolume10Day || 1;
        const relVol      = volume / avgVol;
        const pctFromHigh = high52 > 0 ? ((high52 - price) / high52) * 100 : 100;

        if (price     >= 5)     continue;
        if (changePct <= 3)     continue;
        if (volume    < 500000) continue;
        if (relVol    < 2)      continue;
        if (pctFromHigh > 10)   continue;
        if (marketCap  > 2e9)   continue;

        const ind   = (q.industry || '').toLowerCase();
        const isBio = ind.includes('biotech') || ind.includes('pharma') ||
                      ind.includes('medical') || ind.includes('drug') ||
                      ind.includes('diagnos') || ind.includes('therapeut') ||
                      ind.includes('health');
        if (!isBio && q.sector !== 'Healthcare') continue;

        let floatShares = 0;
        const summary = await getSummary(q.symbol);
        if (summary?.floatShares) floatShares = summary.floatShares;
        if (floatShares > 0 && floatShares > 30000000) continue;

        const capLabel = marketCap < 300e6 ? 'Micro-cap' : 'Small-cap';

        results.push({
          ticker:          q.symbol,
          name:            q.shortName || q.longName || q.symbol,
          price:           +price.toFixed(2),
          change_pct:      +changePct.toFixed(2),
          volume,
          avg_volume:      Math.round(avgVol),
          rel_volume:      +relVol.toFixed(2),
          float_shares:    floatShares,
          market_cap:      fmtCap(marketCap),
          cap_label:       capLabel,
          week52_high:     +high52.toFixed(2),
          week52_low:      +low52.toFixed(2),
          pct_from_52high: +pctFromHigh.toFixed(2),
          sector:          q.industry || q.sector || 'Healthcare',
          catalyst:        `Up ${changePct.toFixed(1)}% on ${(volume/1e6).toFixed(1)}M shares (${relVol.toFixed(1)}x avg volume)`,
          risk:            marketCap < 100e6 ? 'High' : marketCap < 500e6 ? 'Medium' : 'Low',
          setup:           `$${price.toFixed(2)} price, ${pctFromHigh.toFixed(1)}% below 52W high of $${high52.toFixed(2)}. ${floatShares > 0 ? (floatShares/1e6).toFixed(1)+'M float.' : 'Float unknown.'} ${relVol.toFixed(1)}x relative volume.`,
        });

        if (results.length >= 20) break;
      } catch { continue; }
    }

    results.sort((a,b) => b.change_pct - a.change_pct);
    return res.status(200).json({ results, scanned_at: new Date().toISOString() });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
