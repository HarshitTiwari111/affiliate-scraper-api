// ============================================================
// STARZPARTNERS (BitStarz/SoftSwiss) — Partner API (Statistic Token)
// NO browser, NO reCAPTCHA, NO 2FA — pure REST API.
//
// Place at: scrapers/starzpartners.js  (replaces old Puppeteer one)
//
// Auth (per docs): Authorization header = STATISTIC_TOKEN
// Endpoint: GET /api/customer/v1/partner/traffic_report
//   query: from (inclusive), to (EXCLUSIVE), date_group_by, page
//
// Response shape:
//   { rows: { data: [ [ {name,value,type}, ... ], ... ] },
//     overall_totals: {...}, current_page, total_pages, ... }
//
// Credentials from Code.gs fetchViaPuppeteer:
//   c.token   -> STATISTIC_TOKEN   (Col C)
//   c.baseUrl -> https://starzpartners.com (Col H baseUrl:..., or default)
//   c.report  -> optional date_group_by (Col H report:day/week/month) default "day"
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username; // Col C carries the token
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  const groupBy = (c.report || 'day').toLowerCase(); // hour/day/week/month/year

  // 'to' is EXCLUSIVE per docs -> add 1 day to the requested end date
  const toExclusive = addDays(dt, 1);

  const path = '/api/customer/v1/partner/traffic_report';
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': String(token),
    'User-Agent': 'Mozilla/5.0'
  };

  let allRows = [];
  let headerNames = null;
  let page = 1;
  let totalPages = 1;

  do {
    const url = base + path
      + '?from=' + encodeURIComponent(df)
      + '&to=' + encodeURIComponent(toExclusive)
      + '&date_group_by=' + encodeURIComponent(groupBy)
      + '&page=' + page;

    console.log('  -> StarzPartners page', page, df, '->', toExclusive);
    const resp = await fetch(url, { method: 'GET', headers });
    const body = await resp.text();
    if (!resp.ok) throw new Error('StarzPartners API failed (' + resp.status + '): ' + body.substring(0, 250));

    let data;
    try { data = JSON.parse(body); }
    catch (e) { throw new Error('StarzPartners: response not JSON: ' + body.substring(0, 250)); }

    const dataRows = (data.rows && data.rows.data) ? data.rows.data : [];
    // Each row is an array of {name, value, type}
    dataRows.forEach(cells => {
      if (!headerNames) headerNames = cells.map(c => c.name);
      const rowObj = {};
      cells.forEach(c => { rowObj[c.name] = c.value; });
      allRows.push(rowObj);
    });

    totalPages = data.total_pages || 1;
    page++;
    // safety cap
    if (page > 50) break;
  } while (page <= totalPages);

  if (!allRows.length || !headerNames) throw new Error('StarzPartners: no rows for ' + df + ' to ' + dt);

  // Build headers + rows (union of keys, in first-seen order)
  const keys = headerNames.slice();
  allRows.forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));

  const headerLabels = keys.map(prettyLabel);
  const rows = allRows.map(o => keys.map(k => {
    const v = o[k];
    return (v === null || v === undefined) ? '' : String(v);
  }));

  console.log('  -> StarzPartners', rows.length, 'rows across', totalPages, 'page(s)');
  return { headers: headerLabels, rows };
}

function addDays(ymdStr, n) {
  const d = new Date(ymdStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

function prettyLabel(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

module.exports = { scrape };