// ============================================================
// STARZPARTNERS (BitStarz/SoftSwiss) — Partner API (Statistic Token)
// NO browser, NO reCAPTCHA, NO 2FA — pure REST API.
//
// Place at: scrapers/starzpartners.js
//
// Auth: Authorization header = STATISTIC_TOKEN
// Endpoint: GET /api/customer/v1/partner/traffic_report
//   query: from (inclusive), to (EXCLUSIVE), date_group_by, page
//
// Credentials from Code.gs fetchViaPuppeteer:
//   c.token   -> STATISTIC_TOKEN   (Col C)
//   c.baseUrl -> https://starzpartners.com (Col H baseUrl:..., or default)
//   c.report  -> optional date_group_by (Col H report:day/week/month) default AUTO
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username;
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  // ── date_group_by: agar Col H me diya hai to wahi, warna range ke hisaab se AUTO ──
  // Chhota range (<=45 din) => day-wise. Bada range => month-wise summary.
  let groupBy = (c.report || '').toLowerCase();
  if (!groupBy || groupBy === 'auto') {
    const spanDays = daysBetween(df, dt) + 1;
    groupBy = spanDays > 45 ? 'month' : 'day';
  }

  const toExclusive = addDays(dt, 1); // 'to' is exclusive per docs

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

    console.log('  -> StarzPartners page', page, df, '->', toExclusive, '(' + groupBy + ')');

    // fetch with retry on 429 (rate limit)
    const { ok, status, body } = await fetchWithRetry(url, headers, 4);
    if (!ok) {
      if (allRows.length > 0) {
        console.log('  -> StarzPartners stopped at page', page, 'due to', status, '— returning partial', allRows.length, 'rows');
        break;
      }
      throw new Error('StarzPartners API failed (' + status + '): ' + body.substring(0, 200)
        + (status === 429 ? ' — rate limited. Try a smaller date range (e.g. Last Month) or use report:month.' : ''));
    }

    let data;
    try { data = JSON.parse(body); }
    catch (e) { throw new Error('StarzPartners: response not JSON: ' + body.substring(0, 250)); }

    const dataRows = (data.rows && data.rows.data) ? data.rows.data : [];
    dataRows.forEach(cells => {
      if (!headerNames) headerNames = cells.map(c => c.name);
      const rowObj = {};
      cells.forEach(c => { rowObj[c.name] = c.value; });
      allRows.push(rowObj);
    });

    totalPages = data.total_pages || 1;
    page++;

    if (page <= totalPages) await sleep(600);
    if (page > 100) break;
  } while (page <= totalPages);

  if (!allRows.length || !headerNames) throw new Error('StarzPartners: no rows for ' + df + ' to ' + dt);

  const keys = headerNames.slice();
  allRows.forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));

  // Find the date column
  const dateKeyIdx = keys.findIndex(k => /date|day|month|period/i.test(k));

  // ── FIX 1: 'to' exclusive hone par bhi API ek extra din ka row de deta hai.
  //          Range ke bahar wale rows hata do (sirf day-wise data pe apply hota hai). ──
  if (dateKeyIdx >= 0 && groupBy === 'day') {
    const startNum = df.replace(/-/g, '');           // "20260630"
    const endNum = dt.replace(/-/g, '');             // "20260630"
    const before = allRows.length;
    allRows = allRows.filter(o => {
      const raw = String(o[keys[dateKeyIdx]] || '').trim();
      const norm = normalizeToYmdNum(raw);           // "20260630" ya null
      if (!norm) return true;                        // parse na ho to rakho
      return norm >= startNum && norm <= endNum;
    });
    console.log('  -> StarzPartners date-filter:', before, '->', allRows.length, '(', df, 'to', dt, ')');
  }

  if (!allRows.length) throw new Error('StarzPartners: no rows in range ' + df + ' to ' + dt + ' after filter');

  const headerLabels = keys.map(prettyLabel);
  const rows = allRows.map(o => keys.map((k, idx) => {
    let v = o[k];
    if (v === null || v === undefined) return '';
    v = String(v);
    if (idx === dateKeyIdx) {
      const nd = normalizeDate(v);
      if (nd) v = "'" + nd; // apostrophe => sheet keeps as text, no auto-format
    }
    return v;
  }));

  console.log('  -> StarzPartners', rows.length, 'rows across', totalPages, 'page(s) [' + groupBy + ']');
  return { headers: headerLabels, rows };
}

async function fetchWithRetry(url, headers, maxTries) {
  let lastStatus = 0, lastBody = '';
  for (let i = 0; i < maxTries; i++) {
    const resp = await fetch(url, { method: 'GET', headers });
    const body = await resp.text();
    if (resp.ok) return { ok: true, status: resp.status, body };
    lastStatus = resp.status; lastBody = body;
    if (resp.status === 429) {
      const wait = 2000 * Math.pow(2, i);
      console.log('  -> 429 rate limited, waiting', wait, 'ms (try', i + 1, ')');
      await sleep(wait);
      continue;
    }
    return { ok: false, status: resp.status, body };
  }
  return { ok: false, status: lastStatus, body: lastBody };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function daysBetween(a, b) {
  const d1 = new Date(a + 'T00:00:00Z');
  const d2 = new Date(b + 'T00:00:00Z');
  return Math.round((d2 - d1) / 86400000);
}

function addDays(ymdStr, n) {
  const d = new Date(ymdStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

// Force any date string to YYYY-MM-DD (for display)
function normalizeDate(s) {
  s = String(s).trim();
  let m;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  // Month-only label like "2026-01" ya "January 2026" — leave as-is
  m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return m[1] + '-' + pad(m[2]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (d > 12) return y + '-' + pad(mo) + '-' + pad(d);
    if (mo > 12) return y + '-' + pad(d) + '-' + pad(mo);
    return y + '-' + pad(mo) + '-' + pad(d);
  }
  return s;
}

// For range comparison: return "YYYYMMDD" number-string or null
function normalizeToYmdNum(s) {
  s = String(s).trim();
  let m;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + pad(m[2]) + pad(m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (d > 12) return y + pad(mo) + pad(d);
    if (mo > 12) return y + pad(d) + pad(mo);
    return y + pad(mo) + pad(d);
  }
  return null;
}

function pad(n) { return String(n).padStart(2, '0'); }

function prettyLabel(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

module.exports = { scrape };