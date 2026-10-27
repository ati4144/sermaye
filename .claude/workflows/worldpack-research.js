export const meta = {
  name: 'worldpack-research',
  description: 'Collect real historical economic datasets for the Sermaye WorldPack (equity returns, gold, crises, regime stats, current agenda)',
  phases: [
    { title: 'Research', detail: '9 parallel web-research agents, each writes one JSON dataset to tools/data/raw/' },
  ],
}

phase('Research')

const ROOT = 'C:/Users/atill/projects/sermaye/tools/data/raw'
const RETURN_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    rows: { type: 'number' },
    approxCount: { type: 'number' },
    sources: { type: 'array', items: { type: 'string' } },
    caveats: { type: 'string' },
  },
  required: ['file', 'rows', 'approxCount', 'sources', 'caveats'],
}

const COMMON = `You are a data-research agent for a game-economy calibration pipeline. Work directory: C:/Users/atill/projects/sermaye.
RULES:
- Research using WebSearch/WebFetch. Prefer established sources (official exchanges, FRED, World Bank, Macrotrends, Wikipedia tables with citations, index fact sheets).
- NEVER fabricate precision: round values to 1 decimal. If a number is uncertain or reconstructed, mark it "approx": true. Honest approximation beats fake precision.
- Write your result EXACTLY to the specified file path using the Write tool (JSON, UTF-8, keys in English, no comments). Then return the structured summary.
- Percent values are plain numbers (e.g. -37.0 means -37.0%). Years are integers.
- The game engine only consumes compiled parameters later; your job is a clean, sourced raw dataset.`

const results = await parallel([
  () => agent(`${COMMON}
TASK: Annual nominal returns (local currency, price return unless total return is the only series — note it) of flagship equity indices for USA and GERMANY.
- us: S&P 500 (or equivalent), 1950-2025.
- de: DAX (from 1988; for 1950-1987 use a documented German stock proxy e.g. CDAX/composite, mark approx).
FILE: ${ROOT}/equity-us-de.json
SHAPE: { "markets": { "us": { "indexName": "...", "returnBasis": "price|total", "series": [{ "year": 1950, "ret": 21.8, "approx": false }], "typicalAnnualVol": 15.5, "sources": ["url"] }, "de": { ... } } }
Cover EVERY year in the range (no gaps). Cross-check famous anchors: 2008 us ≈ -37 (total) / -38.5 (price), 1974 ≈ -26, 1995 ≈ +34, 2022 ≈ -19 to -25.`, { label: 'equity:us+de', phase: 'Research', schema: RETURN_SCHEMA }),

  () => agent(`${COMMON}
TASK: Annual nominal returns (local currency, price return unless total return is the only series — note it) of flagship equity indices for JAPAN and UNITED KINGDOM.
- jp: Nikkei 225 (from 1950 or earliest; note the 1989 bubble peak ~38,957 and the long drawdown).
- uk: FTSE All-Share or FTSE 100 (as long a history as documented; earliest years may be approx).
FILE: ${ROOT}/equity-jp-uk.json
SHAPE: { "markets": { "jp": { "indexName": "...", "returnBasis": "...", "series": [{ "year": 1950, "ret": 21.8, "approx": false }], "typicalAnnualVol": 20.0, "sources": ["url"] }, "uk": { ... } } }
Cover EVERY year in the range (no gaps). Cross-check anchors: jp 1990 ≈ -39, uk 1974 ≈ -55, uk 2008 ≈ -31.`, { label: 'equity:jp+uk', phase: 'Research', schema: RETURN_SCHEMA }),

  () => agent(`${COMMON}
TASK: Annual nominal returns (local currency, price return unless total is the only series — note it) of flagship equity indices for CHINA and INDIA.
- cn: Shanghai Composite (SSE), from 1990/1991 (earliest available). If pre-1990 data does not exist, start there — no gaps after the start.
- in: BSE Sensex (from 1979/1980 or earliest documented).
FILE: ${ROOT}/equity-cn-in.json
SHAPE: { "markets": { "cn": { "indexName": "...", "returnBasis": "...", "series": [{ "year": 1991, "ret": 100.0, "approx": false }], "typicalAnnualVol": 28.0, "sources": ["url"] }, "in": { ... } } }
Cross-check anchors: cn 1992 ≈ +166, cn 2007 ≈ +97, cn 2008 ≈ -65, in 1992 ≈ +81.`, { label: 'equity:cn+in', phase: 'Research', schema: RETURN_SCHEMA }),

  () => agent(`${COMMON}
TASK: Annual nominal returns (local currency, price return unless total is the only series — note it) of flagship equity indices for TURKEY and BRAZIL.
- tr: BIST 100 (ISE-100 / XU100), from 1990 or earliest documented (IMKB era). High-inflation local-currency returns are expected — record them as they are.
- br: Ibovespa, from 1968 or earliest documented.
FILE: ${ROOT}/equity-tr-br.json
SHAPE: { "markets": { "tr": { "indexName": "...", "returnBasis": "...", "series": [{ "year": 1990, "ret": 50.0, "approx": false }], "typicalAnnualVol": 45.0, "sources": ["url"] }, "br": { ... } } }
Cross-check anchors: tr 1994 hyperinflation year > +100, br 2008 ≈ -41.`, { label: 'equity:tr+br', phase: 'Research', schema: RETURN_SCHEMA }),

  () => agent(`${COMMON}
TASK: Annual nominal returns (local currency, price return) of flagship equity indices for NIGERIA and UAE — thin data, honest approximations expected.
- ng: NGX All-Share Index (formerly NSE ASI), from 1985 or earliest documented.
- ae: If a UAE equity index history is too short/thin (ADX from 2000, DFM from 2000), record what exists; for pre-history years OMIT them (no gaps after start) and set "approx": true on early entries. Add a field "coverageNote" per market.
FILE: ${ROOT}/equity-ng-ae.json
SHAPE: { "markets": { "ng": { "indexName": "...", "returnBasis": "price", "series": [{ "year": 1985, "ret": 10.0, "approx": false }], "typicalAnnualVol": 30.0, "coverageNote": "...", "sources": ["url"] }, "ae": { ... } } }
Cross-check anchors: ng 2008 ≈ -46, ae/DFM 2008 ≈ -70, DFM 2005 ≈ +84.`, { label: 'equity:ng+ae', phase: 'Research', schema: RETURN_SCHEMA }),

  () => agent(`${COMMON}
TASK: Gold price history (USD/oz).
- series: YEARLY (use year-end or annual average — pick ONE basis and note it) from 1968 to 2025, plus 2026 latest if available.
- crisisMoves: for each major crisis (1973-74 oil, 1979-80 inflation, 2000-03 dot-com, 2008-09 GFC, 2011 eurozone, 2020 COVID, 2022 rate shock, 2023-26 rally) record gold's approximate % move over the crisis window.
FILE: ${ROOT}/gold.json
SHAPE: { "basis": "year-end|average", "series": [{ "year": 1968, "priceUsd": 39.0, "approx": false }], "crisisMoves": [{ "crisis": "gfc_2008", "from": "2007-12", "to": "2009-12", "pct": 25.5, "approx": false }], "sources": ["url"] }
Cross-check anchors: 1971 ≈ $40, Jan-1980 peak $850, 1999 low ≈ $252, Sep-2011 ≈ $1900, 2020 ≈ $1900-2000, 2024-2026 strong rally above $2000.`, { label: 'gold', phase: 'Research', schema: RETURN_SCHEMA }),

  () => agent(`${COMMON}
TASK: Global financial-crisis timeline for scenario scripting — the game will replay these as deterministic monthly beats.
For EACH crisis below: start month, end month (or trough), approximate world-equity peak-to-trough drawdown %, most-affected countries, and 2-4 short factual beat descriptions with month anchors (e.g. "2008-09 Lehman Brothers collapse"). Crises to cover: 1973-74 oil crisis & stagflation onset, 1979-81 second oil shock/Volcker, 1987 Black Monday, 1990 Japan bubble burst + lost decade, 1997 Asian financial crisis, 1998 Russia/LTCM, 2000-03 dot-com bust, 2008-09 Global Financial Crisis, 2010-2012 eurozone debt crisis, 2018 emerging-market/Fed tightening (incl. Turkish lira crisis), 2020 COVID crash & recovery, 2022 rate-shock bear market.
FILE: ${ROOT}/crises.json
SHAPE: { "crises": [{ "id": "gfc_2008", "name": "Global Financial Crisis", "start": "2007-10", "end": "2009-03", "worldDrawdownPct": -55.0, "mostAffected": ["us","uk","jp","de"], "beats": [{ "at": "2008-09", "fact": "Lehman Brothers files for bankruptcy" }], "sources": ["url"] }] }
Facts must be real, dated events — they become in-game headlines.`, { label: 'crises', phase: 'Research', schema: RETURN_SCHEMA }),

  () => agent(`${COMMON}
TASK: Bull/bear market regime statistics for calibration of a regime-switching model.
- usBullBear: US bull/bear market episodes (S&P 500), from reliable analyses (e.g. Invesco/Guggenheim/CNBC tables): type (bull|bear), start, end, duration months, cumulative % or drawdown %.
- globalNotes: typical regime-duration findings for other markets if documented (e.g. average bear market duration ~9-18 months; Japan lost-decade exception; EM crises shorter/sharper).
- nberRecessions: list of US recession periods (NBER) 1950-2025 as [start, end] pairs.
FILE: ${ROOT}/regime-stats.json
SHAPE: { "usBullBear": [{ "type": "bear", "start": "2007-10", "end": "2009-03", "months": 17, "pct": -56.8 }], "globalNotes": "...", "nberRecessions": [["1953-07","1954-05"]], "sources": ["url"] }`, { label: 'regime-stats', phase: 'Research', schema: RETURN_SCHEMA }),

  () => agent(`${COMMON}
TASK: Current macro/market agenda snapshot — October 2026. Research CURRENT news and macro data via web search, then distill topic weights (0..1) for a game "agenda" layer that tilts event probabilities.
Topics (fixed ids, all required): inflation (is inflation hot/cooling?), rates (central-bank cutting/hiking cycle?), geopolitics (war/sanctions tension), ai_tech (AI/tech equity cycle), energy (oil/energy price stress), em_stress (emerging-market/currency stress), gold_rally (safe-haven demand).
For each topic: weight 0..1 (1 = dominant theme), one-line rationale grounded in what you found, 2-3 sources dated 2026 if possible (fall back to most recent available).
FILE: ${ROOT}/agenda-2026-10.json
SHAPE: { "asOf": "2026-10", "topics": { "inflation": { "weight": 0.6, "rationale": "..." }, "rates": { ... }, "geopolitics": { ... }, "ai_tech": { ... }, "energy": { ... }, "em_stress": { ... }, "gold_rally": { ... } }, "sources": ["url"] }`, { label: 'agenda:2026-10', phase: 'Research', schema: RETURN_SCHEMA }),
])

const ok = results.filter(Boolean)
log(`datasets written: ${ok.length}/9`)
return {
  written: ok.map((r) => `${r.file} (${r.rows} rows, ${r.approxCount} approx)`),
  failed: 9 - ok.length,
  caveats: ok.map((r) => ({ file: r.file, caveats: r.caveats })),
}