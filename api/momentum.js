// api/momentum.js
// Uses Finviz export CSV - works server side, no auth needed

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=900');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const FINVIZ_URL =
      'https://finviz.com/export.ashx?v=151&f=exch_nasd,geo_usa,ind_biotechnology|ind_drugmanufacturers-specialty%26generic|ind_healthcareplans|ind_medicaldevices|ind_medicalinstruments%26supplies|ind_pharmaceuticals,cap_micro|cap_small,price_u5,vol_o500,relvolume_o2,change_u5to100,ta_52hightolow_0to10&ft=4&o=-change';

    const response = await fetch(FINVIZ_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://finviz.com/screener.ashx',
      }
    });

    if (!response.ok) throw new Error(`Finviz error: ${response.status}`);

    const text = await response.text();
    const lines = text.trim().split('\n').filter(Boolean);
    if (lines.length < 2) {
      return res.status(200).json({
        results: [],
        message: 'No matching stocks found — market may be closed or no stocks match criteria today.',
        scanned_at: new Date().toISOString()
      });
    }

    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const rows    = lines.slice(1);

    function col(row, name) {
      const idx = headers.indexOf(name);
      return idx >= 0 ? row[idx]?.replace(/"/g, '').trim() : '';
    }

    function parseNum(s) {
      if (!s) return 0;
      s = s.replace(/[%$,]/g, '');
      if (s.endsWith('B')) return parseFloat(s) * 1e9;
      if (s.endsWith('M')) return parseFloat(s) * 1e6;
      if (s.endsWith('K')) return parseFloat(s) * 1e3;
      return parseFloat(s) || 0;
    }

    const results = rows.slice(0, 30).map(line => {
      const row = [];
      let inQuote = false, cur = '';
      for (const ch of line + ',') {
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === ',' && !inQuote) { row.push(cur); cur = ''; }
        else cur += ch;
      }

      const ticker    = col(row, 'Ticker');
      const name      = col(row, 'Company');
      const price     = parseNum(col(row, 'Price'));
      const changePct = parseNum(col(row, 'Change'));
      const volume    = parseNum(col(row, 'Volume'));
      const avgVol    = parseNum(col(row, 'Avg Volume'));
      const relVol    = parseNum(col(row, 'Rel Volume'));
      const float_    = parseNum(col(row, 'Float'));
      const high52    = parseNum(col(row, '52W High'));
      const low52     = parseNum(col(row, '52W Low'));
      const mktCap    = parseNum(col(row, 'Market Cap'));
      const industry  = col(row, 'Industry');
      const from52h   = high52 > 0 ? ((high52 - price) / high52 * 100) : 0;

      if (!ticker) return null;

      const fmtCap = mktCap >= 1e9
        ? `~$${(mktCap/1e9).toFixed(1)}B`
        : `~$${(mktCap/1e6).toFixed(0)}M`;

      return {
        ticker,
        name,
        price:           +price.toFixed(2),
        change_pct:      +changePct.toFixed(2),
        volume:          Math.round(volume),
        avg_volume:      Math.round(avgVol),
        rel_volume:      relVol || +(volume / (avgVol || 1)).toFixed(2),
        float_shares:    Math.round(float_),
        market_cap:      fmtCap,
        cap_label:       mktCap < 300e6 ? 'Micro-cap' : 'Small-cap',
        week52_high:     +high52.toFixed(2),
        week52_low:      +low52.toFixed(2),
        pct_from_52high: +from52h.toFixed(2),
        sector:          industry || 'Biotech / Healthcare',
        catalyst:        `Up ${changePct.toFixed(1)}% on ${(volume/1e6).toFixed(2)}M shares (${(relVol||(volume/(avgVol||1))).toFixed(1)}x avg vol)`,
        risk:            mktCap < 100e6 ? 'High' : mktCap < 500e6 ? 'Medium' : 'Low',
        setup:           `$${price.toFixed(2)} · ${from52h.toFixed(1)}% from 52W high $${high52.toFixed(2)} · Float ${float_ > 0 ? (float_/1e6).toFixed(1)+'M' : 'N/A'} · RelVol ${(relVol||(volume/(avgVol||1))).toFixed(1)}x`,
      };
    }).filter(Boolean);

    results.sort((a, b) => b.change_pct - a.change_pct);
    return res.status(200).json({
      results,
      source: 'Finviz (free, 15min delayed)',
      scanned_at: new Date().toISOString()
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
