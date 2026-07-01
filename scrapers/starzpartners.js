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

  // Range span nikaalo — bada range (>45 din) = month-wise summary chahiye
  const spanDays = daysBetween(df, dt) + 1;
  const wantMonthly = spanDays > 45;

  // API se hamesha day-wise mangenge, phir khud group karenge (API ka month reliable nahi)
  let groupBy = (c.report || '').toLowerCase();
  if (!groupBy || groupBy === 'auto') groupBy = 'day';

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

    console.log('  -> StarzPartners page', page, df, '->', toExclusive, '(' + groupBy + ')');

    const { ok, status, body } = await fetchWithRetry(url, headers, 4);
    if (!ok) {
      if (allRows.length > 0) {
        console.log('  -> StarzPartners stopped at page', page, 'due to', status, '— returning partial', allRows.length, 'rows');
        break;
      }
      throw new Error('StarzPartners API failed (' + status + '): ' + body.substring(0, 200)
        + (status === 429 ? ' — rate limited. Try a smaller date range.' : ''));
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

  const dateKeyIdx = keys.findIndex(k => /date|day|month|period/i.test(k));

  // ── FIX 1: 'to' exclusive hone par bhi extra din aata hai — range ke bahar hata do ──
  if (dateKeyIdx >= 0) {
    const startNum = df.replace(/-/g, '');
    const endNum = dt.replace(/-/g, '');
    const before = allRows.length;
    allRows = allRows.filter(o => {
      const norm = normalizeToYmdNum(String(o[keys[dateKeyIdx]] || '').trim());
      if (!norm) return true;
      return norm >= startNum && norm <= endNum;
    });
    console.log('  -> StarzPartners date-filter:', before, '->', allRows.length);
  }

  if (!allRows.length) throw new Error('StarzPartners: no rows in range after filter');

  // ── FIX 2: Bada range = khud month-wise group karo (API day-wise deta hai) ──
  if (wantMonthly && dateKeyIdx >= 0) {
    const grouped = groupByMonth(allRows, keys, dateKeyIdx);
    allRows = grouped;
    console.log('  -> StarzPartners grouped into', allRows.length, 'months');
  }

  const headerLabels = keys.map(prettyLabel);
  const rows = allRows.map(o => keys.map((k, idx) => {
    let v = o[k];
    if (v === null || v === undefined) return '';
    v = String(v);
    if (idx === dateKeyIdx) {
      // monthly me value already "2026-01" hai; daily me normalize karo
      const nd = normalizeDate(v);
      if (nd) v = "'" + nd;
    }
    return v;
  }));

  console.log('  -> StarzPartners', rows.length, 'rows [' + (wantMonthly ? 'monthly' : groupBy) + ']');
  return { headers: headerLabels, rows };
}

// ── Day-wise rows ko month-wise sum karo ──
// Numeric columns add hote hain; rate columns (Cr = conversion rate %) recompute nahi,
// unhe average kar dete hain (approx). Date column month label ban jata hai.
function groupByMonth(rows, keys, dateIdx) {
  const buckets = {}; // "2026-01" -> { sums:{}, counts:{}, order:n }
  let order = 0;

  // Kaunse columns rate/percent type hain (add nahi karne) — naam se guess
  const rateIdxs = new Set();
  keys.forEach((k, i) => {
    if (i === dateIdx) return;
    if (/(^cr$|rate|ratio|percent|%|avg|average)/i.test(k)) rateIdxs.add(i);
  });

  rows.forEach(o => {
    const dnum = normalizeToYmdNum(String(o[keys[dateIdx]] || '').trim());
    if (!dnum) return;
    const monthKey = dnum.substring(0, 4) + '-' + dnum.substring(4, 6); // "2026-01"

    if (!buckets[monthKey]) {
      buckets[monthKey] = { sums: {}, cnt: {}, order: order++ };
      keys.forEach((k, i) => { if (i !== dateIdx) { buckets[monthKey].sums[i] = 0; buckets[monthKey].cnt[i] = 0; } });
    }
    const b = buckets[monthKey];
    keys.forEach((k, i) => {
      if (i === dateIdx) return;
      const num = parseFloat(String(o[k]).replace(/[$€£,%]/g, ''));
      if (!isNaN(num)) { b.sums[i] += num; b.cnt[i] += 1; }
    });
  });

  // Buckets ko rows me convert karo (month order me)
  const monthKeys = Object.keys(buckets).sort((a, b) => buckets[a].order - buckets[b].order);
  return monthKeys.map(mk => {
    const b = buckets[mk];
    const obj = {};
    keys.forEach((k, i) => {
      if (i === dateIdx) { obj[k] = mk; return; } // "2026-01"
      let val = b.sums[i];
      if (rateIdxs.has(i)) {
        // rate column = average across days
        val = b.cnt[i] > 0 ? (b.sums[i] / b.cnt[i]) : 0;
        val = Math.round(val * 100) / 100;
      } else {
        val = Math.round(val * 100) / 100;
        if (val % 1 === 0) val = Math.round(val);
      }
      obj[k] = val;
    });
    return obj;
  });
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