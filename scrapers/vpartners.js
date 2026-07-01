// ============================================================
// V.PARTNERS Remote Statistics scraper — NO browser, JSON API.
// Fix: This Year => month-wise summary.
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://v.partners').replace(/\/+$/, '');
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

  let allRows = [];
  if (Array.isArray(data)) {
    allRows = data;
  } else if (data && typeof data === 'object') {
    for (const dateKey of Object.keys(data)) {
      const arr = data[dateKey];
      if (Array.isArray(arr)) { arr.forEach(r => { if (r && typeof r === 'object' && !r.stats_date) r.stats_date = dateKey; allRows.push(r); }); }
      else if (arr && typeof arr === 'object') { if (!arr.stats_date) arr.stats_date = dateKey; allRows.push(arr); }
    }
  }
  if (!allRows.length) throw new Error('V.Partners: no rows for ' + df + ' to ' + dt);

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

  const dIdx = cols.findIndex(c => c[0] === 'stats_date');
  if (dIdx >= 0) rows.sort((a, b) => String(a[dIdx]).localeCompare(String(b[dIdx])));

  // Bada range (>45 din) => month-wise summary
  if (spanDays(df, dt) > 45 && dIdx >= 0) {
    const g = groupRowsByMonth(headers, rows, dIdx);
    rows = g.rows;
    console.log('  -> V.Partners grouped into', rows.length, 'months');
  }

  console.log('  -> V.Partners', rows.length, 'rows');
  return { headers, rows };
}

// ---- month grouping (self-contained) ----
function groupRowsByMonth(headers, rows, dateIdx) {
  const rateIdxs = new Set();
  headers.forEach((h, i) => { if (i !== dateIdx && /(^cr$|rate|ratio|percent|%|avg|average|conversion)/i.test(String(h))) rateIdxs.add(i); });
  const buckets = {}; let order = 0;
  rows.forEach(row => {
    const dnum = ymdNum(String(row[dateIdx] || '').replace(/^'/, '').trim());
    if (!dnum) return;
    const mk = dnum.substring(0, 4) + '-' + dnum.substring(4, 6);
    if (!buckets[mk]) { buckets[mk] = { sums: {}, cnt: {}, order: order++ }; headers.forEach((h, i) => { if (i !== dateIdx) { buckets[mk].sums[i] = 0; buckets[mk].cnt[i] = 0; } }); }
    const b = buckets[mk];
    headers.forEach((h, i) => { if (i === dateIdx) return; const num = parseFloat(String(row[i]).replace(/[$€£,%]/g, '')); if (!isNaN(num)) { b.sums[i] += num; b.cnt[i] += 1; } });
  });
  const mks = Object.keys(buckets).sort((a, b) => buckets[a].order - buckets[b].order);
  const outRows = mks.map(mk => {
    const b = buckets[mk];
    return headers.map((h, i) => {
      if (i === dateIdx) return "'" + mk;
      let val = rateIdxs.has(i) ? (b.cnt[i] > 0 ? b.sums[i] / b.cnt[i] : 0) : b.sums[i];
      val = Math.round(val * 100) / 100; if (val % 1 === 0) val = Math.round(val);
      return String(val);
    });
  });
  return { headers, rows: outRows };
}
function spanDays(df, dt) { const d1 = new Date(df + 'T00:00:00Z'), d2 = new Date(dt + 'T00:00:00Z'); return Math.round((d2 - d1) / 86400000) + 1; }
function ymdNum(s) { s = String(s).trim(); let m; m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + pad(m[2]) + pad(m[3]); m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (d > 12) return y + pad(mo) + pad(d); if (mo > 12) return y + pad(d) + pad(mo); return y + pad(mo) + pad(d); } return null; }
function pad(n) { return String(n).padStart(2, '0'); }

module.exports = { scrape };