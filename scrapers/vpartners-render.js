// ============================================================
// V.PARTNERS Remote Statistics scraper (Render / Node)
// NO browser, NO Puppeteer — just a JSON API call.
//
// Place at: scrapers/vpartners.js   (replaces the old Puppeteer one)
//
// Credentials sent from Code.gs fetchViaPuppeteer:
//   c.username -> remote-stats TOKEN   (Col C)
//   c.baseUrl  -> https://v.partners   (from Col H baseUrl:..., or default)
//
// API: GET {base}/api/stats?token=XXX&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD
// Response shape: { "YYYY-MM-DD": [ {row}, {row} ], ... }
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://v.partners').replace(/\/+$/, '');
  // token may arrive as username (Col C) or as an explicit token field
  const token = c.token || c.username || c.email;
  if (!token) throw new Error('V.Partners: remote-stats token missing (Col C).');

  const url = base + '/api/stats'
    + '?token=' + encodeURIComponent(token)
    + '&date_from=' + encodeURIComponent(df)
    + '&date_to=' + encodeURIComponent(dt);

  console.log('  -> V.Partners fetching', base + '/api/stats', df, '->', dt);
  const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
  const body = await resp.text();
  if (!resp.ok) throw new Error('V.Partners API failed (' + resp.status + '): ' + body.substring(0, 300));

  let data;
  try { data = JSON.parse(body); }
  catch (e) { throw new Error('V.Partners: response not JSON: ' + body.substring(0, 250)); }

  // Flatten { "date": [ {row}, ... ] } into one array
  let allRows = [];
  if (Array.isArray(data)) {
    allRows = data;
  } else if (data && typeof data === 'object') {
    for (const dateKey of Object.keys(data)) {
      const arr = data[dateKey];
      if (Array.isArray(arr)) {
        arr.forEach(r => { if (r && typeof r === 'object' && !r.stats_date) r.stats_date = dateKey; allRows.push(r); });
      } else if (arr && typeof arr === 'object') {
        if (!arr.stats_date) arr.stats_date = dateKey;
        allRows.push(arr);
      }
    }
  }
  if (!allRows.length) throw new Error('V.Partners: no rows for ' + df + ' to ' + dt);

  // Friendly column subset (only those present)
  const firstKeys = Object.keys(allRows[0]);
  const preferred = [
    ['stats_date', 'Date'], ['title', 'Brand'], ['rotator', 'Rotator'],
    ['utm_sub_id', 'Sub ID'], ['landing_hits', 'Landing Hits'], ['hits', 'Hits'],
    ['hosts', 'Hosts'], ['unique_clicks', 'Unique Clicks'],
    ['registrations', 'Registrations'], ['first_deposit_count', 'First Deposits'],
    ['first_deposit_amount', 'First Deposit Amt'], ['deposits_count', 'Deposits Count'],
    ['deposits', 'Deposits'], ['withdrawals', 'Withdrawals'],
    ['GGR', 'GGR'], ['NGR', 'NGR'],
    ['cpa_approved', 'CPA Approved'], ['revshare_income', 'Revshare Income'],
    ['qual_cpa_count', 'Qual CPA'], ['currency_name', 'Currency']
  ];
  let cols = preferred.filter(p => firstKeys.indexOf(p[0]) >= 0);
  if (!cols.length) cols = firstKeys.map(k => [k, k]);

  const headers = cols.map(c => c[1]);
  let rows = allRows.map(r => cols.map(c => {
    const v = r[c[0]];
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }));

  // Sort by date asc
  const dIdx = cols.findIndex(c => c[0] === 'stats_date');
  if (dIdx >= 0) rows.sort((a, b) => String(a[dIdx]).localeCompare(String(b[dIdx])));

  console.log('  -> V.Partners', rows.length, 'rows');
  return { headers, rows };
}

module.exports = { scrape };