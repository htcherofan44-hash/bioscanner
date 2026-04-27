// api/momentum.js
// Free momentum screener using yahoo-finance2
// Criteria: price <$5, vol >500K, rel vol >2x, float <30M, change >3%, within 10% of 52W high, micro/small cap

import yahooFinance from 'yahoo-finance2';

// Known small/micro cap biotech tickers to screen as seed list
// We pull these from Yahoo Finance's own biotech screener results
const BIOTECH_UNIVERSE_QUERY = {
  screenerType: 'equity',
  query: {
    operator: 'AND',
    operands: [
      { operator: 'eq',  operands: ['exchange', 'NMS'] },        // Nasdaq
      { operator: 'lt',  operands: ['regularMarketPrice', 5] },  // price < $5
      { operator: 'gt',  operands: ['averageDailyVolume3Month', 300000] }, // some avg vol
      {
        operator: 'OR',
        operands: [
          { operator: 'eq', operands: ['sector', 'Healthcare'] },
        ]
      }
    ]
  },
  sortField: 'percentchange',
  sortType: 'DESC',
  quoteType: 'EQUITY',
  offset: 0,
  size: 100,
};

async function screenViaYahoo() {
  // Use Yahoo Finance screener directly
  const result = await yahooFinance.screener(BIOTECH_UNIVERSE_QUERY, {
    fields: [
      'symbol','shortName','regularMarketPrice','regularMarketChangePercent',
      'regularMarketVolume','averageDailyVolume3Month','fiftyTwoWeekHigh',
      'fiftyTwoWeekLow','marketCap','floatShares','industry','sector',
    ]
  });
  return result?.quotes || [];
}

async function enrichTicker(quote) {
  try {
    const price      = quote.regularMarketPrice      || 0;
    const changePct  = (quote.regularMarketChangePercent || 0) * 100;
    const volume     = quote.regularMarketVolume     || 0;
    const avgVol     = quote.averageDailyVolume3Month|| 0;
    const high52     = quote.fiftyTwoWeekHigh        || 0;
    const low52      = quote.fiftyTwoWeekLow         || 0;
    const marketCap  = quote.marketCap               || 0;
    const floatSh    = quote.floatShares             || 0;
    const relVol     = avgVol > 0 ? volume / avgVol  : 0;
    const pctFromHigh= high52 > 0 ? ((high52 - price) / high52) * 100 : 100;

    // Apply all criteria
    if (price     >= 5)        return null; // price must be < $5
    if (volume    <  500000)   return null; // volume > 500K
    if (relVol    <  2)        return null; // relative volume > 2x
    if (floatSh   >  30000000) return null; // float < 30M (0 = unknown, let pass)
    if (changePct <= 3)        return null; // up > 3%
    if (pctFromHigh > 10)      return null; // within 10% of 52W high
    if (marketCap  > 2e9)      return null; // micro or small cap

    // Filter to healthcare/biotech industries
    const ind = (quote.industry || '').toLowerCase();
    const sec = (quote.sector   || '').toLowerCase();
    const isBio = sec.includes('health') ||
                  ind.includes('biotech') || ind.includes('pharma') ||
                  ind.includes('medical') || ind.includes('drug') ||
                  ind.includes('diagnos') || ind.includes('therapeut');
    if (!isBio) return null;

    const fmtCap = marketCap >= 1e9
      ? `~$${(marketCap/1e9).toFixed(1)}B`
      : marketCap >= 1e6
        ? `~$${(marketCap/1e6).toFixed(0)}M`
        : 'Micro';

    const capLabel = marketCap < 300e6 ? 'Micro-cap' : 'Small-cap';

    return {
      ticker:          quote.symbol,
      name:            quote.shortName || quote.symbol,
      price:           +price.toFixed(2),
      change_pct:      +changePct.toFixed(2),
      volume:          volume,
      avg_volume:      avgVol,
      rel_volume:      +relVol.toFixed(2),
      float_shares:    floatSh,
      market_cap:      fmtCap,
      cap_label:       capLabel,
      week52_high:     +high52.toFixed(2),
      week52_low:      +low52.toFixed(2),
      pct_from_52high: +pctFromHigh.toFixed(2),
      sector:          quote.industry || quote.sector || 'Biotech/Healthcare',
      catalyst:        `Up ${changePct.toFixed(1)}% today on ${(volume/1e6).toFixed(1)}M shares (${relVol.toFixed(1)}x normal volume)`,
      risk:            marketCap < 100e6 ? 'High' : marketCap < 500e6 ? 'Medium' : 'Low',
      setup:           `Price $${price.toFixed(2)} — ${pctFromHigh.toFixed(1)}% below 52W high of $${high52.toFixed(2)}. Float ${floatSh > 0 ? (floatSh/1e6).toFixed(1)+'M shares' : 'unknown'}. ${relVol.toFixed(1)}x relative volume surge.`,
    };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800'); // 15-min cache
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const quotes = await screenViaYahoo();

    const enriched = await Promise.all(quotes.map(q => enrichTicker(q)));
    const results  = enriched
      .filter(Boolean)
      .sort((a, b) => b.change_pct - a.change_pct);

    return res.status(200).json({
      results,
      source:     'Yahoo Finance (free)',
      scanned_at: new Date().toISOString(),
      criteria: {
        price_max:      '$5',
        volume_min:     '500,000',
        rel_vol_min:    '2x',
        float_max:      '30M shares',
        change_min:     '3%',
        from_52wk_high: '≤10%',
        cap:            'Micro or Small',
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
