# BioScanner Pro v2 — 100% Free, No API Key Required

Nasdaq biotech stock scanner using:
- **SEC EDGAR** (efts.sec.gov) — official, free, no key — for late filings
- **Yahoo Finance** (yahoo-finance2) — free npm package — for momentum screening

---

## Deploy in 5 Minutes (Free)

### Step 1 — Sign up for Vercel (free)
Go to **https://vercel.com** and sign up with GitHub, Google, or email.

### Step 2 — Deploy

**Option A — Drag & Drop (easiest)**
1. Zip this entire `bioscanner2` folder
2. Go to vercel.com/new
3. Click **"Deploy"** → drag your ZIP onto the upload area
4. Done — you get a live URL like `https://bioscanner-xyz.vercel.app`

**Option B — GitHub (best for updates)**
1. Create a free GitHub account at github.com
2. Create a new repo called `bioscanner`
3. Upload all files from this folder
4. In Vercel → "Add New Project" → import your GitHub repo → Deploy

### Step 3 — Install as PWA

**Android:**
1. Open your Vercel URL in Chrome
2. Tap 3-dot menu → "Add to Home Screen"
3. Tap "Add" — icon appears on home screen ✓

**PC (Chrome/Edge):**
1. Open your Vercel URL
2. Click the install icon (⊕) in the address bar
3. Click "Install" — opens in its own window ✓

---

## No API Key Needed — It's Completely Free

| Data Source | What it provides | Cost |
|-------------|-----------------|------|
| SEC EDGAR (efts.sec.gov) | NT 10-K, NT 10-Q late filing notices, biotech filter by SIC code | FREE, official US government data |
| Yahoo Finance (yahoo-finance2) | Live price, volume, float, 52W high/low, market cap | FREE |

**No Anthropic API key. No credit card. No monthly fees.**

---

## How it Works

### Late Filings Tab
Queries the SEC's EDGAR full-text search API for `NT 10-K` and `NT 10-Q` forms filed in the last 90 days. Filters results by SIC codes for biotech/pharma (2830-2836, 8731, 8734, etc.) and Nasdaq exchange only. Enriches each filing with company details from SEC's submissions API.

### Momentum Tab  
Uses Yahoo Finance's screener to find Nasdaq healthcare stocks with:
- Price < $5
- Today's volume > 500,000
- Relative volume > 2x (today vs 3-month average)
- Float < 30M shares
- Price change > 3% today
- Within 10% of 52-week high
- Micro-cap (<$300M) or Small-cap (<$2B)

---

## Caching
- Late Filings: cached 1 hour (data changes infrequently)
- Momentum: cached 15 minutes (changes during market hours)

---

## File Structure
```
bioscanner2/
├── api/
│   ├── late-filings.js   ← SEC EDGAR NT filing scanner
│   └── momentum.js       ← Yahoo Finance momentum screener
├── public/
│   ├── index.html        ← PWA frontend
│   ├── manifest.json     ← PWA manifest
│   ├── sw.js             ← Service worker
│   ├── icon-192.svg
│   └── icon-512.svg
├── vercel.json
├── package.json
└── README.md
```

---

⚠️ **Disclaimer**: Not financial advice. For research purposes only. Data from SEC EDGAR (free, official) and Yahoo Finance (free, 15-min delayed during market hours). Always verify with primary sources before investing.
