// api/momentum.js
// Yahoo Finance screener via direct JSON API - no npm packages needed

const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://finance.yahoo.com',
  'Referer': 'https://finance.yahoo.com/',
};

async function getYahooScreener() {
  const url = 'https://query2.finance.yahoo.com/v1/finance/screener?lang=en-US&region=US&formatted=false&corsDomain=finance.yahoo.com';
  const body = {
    offset: 0,
    size: 100,
    sortField: 'percentchange',
    sortType: 'DESC',
    quoteType: 'EQUITY',
    query: {
      operator: 'AND',
      operands: [
        {
          operator: 'OR',
          operands: [
            { operator: 'EQ', operands: ['exchange', 'NMS'] },
            { operator: 'EQ', operands: ['exchange', 'NCM'] },
            { operator: 'EQ', operands: ['exchange', 'NGM'] },
          ]
        },
        { operator: 'LT', operands: ['regularMarketPrice', 5] },
        { operator: 'GT', operands: ['regularMarketPrice', 0.10] },
        { operator: 'GT', operands: ['regularMarketChangePercent', 3] },
        { operator: 'GT', operands: ['regularMarketVolume', 500000] },
        { operator: 'EQ', operands: ['sector', 'Healthcare'] },
      ]
    },
    userId: '',
    userIdType: 'guid'
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Yahoo screener HTTP ${res.status}: ${txt.slice(0,200)}`);
  }

  const data = await res.json();
  const quotes = data?.finance?.result?.[0]?.quotes;
  if (!quotes) throw new Error(`Unexpected Yahoo response: ${JSON.stringify(data).slice(0,300)}`);
  return quotes;
}

async function getFloat(symbol) {
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${symbol}?modules=defaultKeyStatistics`;
    const res = await fetch(url, { headers: UA
