// ============================================================
// THUNDER PARTNERS — go.thunder.partners
// NO real browser. 2-step flow:
//   Step 1: POST https://go.thunder.partners/authenticate
//           body: user=<username>&pass=<password>  (form-urlencoded)
//           response: {"success":true,"message":"<bearer token>"}
//   Step 2: GET https://affiliateapi.cellxpert.com/?command=processReport
//           headers: Authorization: Bearer <token>, Affiliate_url: ThunderPartners
//           response: JSON array, e.g.
//             [{"Day":"2026/08/17","Commission":0,"Sub_Commissions":0,
//               "Impressions":"0","Visitors":"1", ...more fields}, ...]
//
// Credentials from Code.gs fetchViaPuppeteer:
//   c.username -> Col C
//   c.password -> Col J
// Token session-based hai (login se milta hai), isliye har run pe
// fresh login karte hain — koi hardcoded token store nahi karte.
// ============================================================

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function scrape(c, df, dt, cp) {
  const username = String(c.username || c.affiliateId || '').trim();
  const password = String(c.password || c.apiKey || '').trim();
  if (!username) throw new Error('Thunder Partners: username missing (Col C).');
  if (!password) throw new Error('Thunder Partners: password missing (Col J).');

  // ── Step 1: Login -> Bearer token ──
  console.log('  -> Thunder Partners: logging in as ' + username);
  const token = await login(username, password);
  console.log('  OK Got token (len=' + token.length + ')');

  // ── Step 2: Report fetch ──
  const monthly = spanDays(df, dt) > 62;
  let allRows = [];

  if (!monthly) {
    allRows = await fetchReport(token, df, dt);
  } else {
    const chunks = buildMonthChunks(df, dt);
    console.log('  -> Thunder Partners monthly mode: ' + chunks.length + ' month requests');
    for (const ch of chunks) {
      try {
        const rows = await fetchReport(token, ch.from, ch.to);
        console.log('  -> ' + ch.label + ': ' + rows.length + ' rows');
        allRows = allRows.concat(rows);
      } catch (e) {
        console.log('  -> ' + ch.label + ' failed: ' + e.message.substring(0, 80));
      }
    }
  }

  if (!allRows.length) {
    console.log('  -> Thunder Partners: no rows for ' + df + ' to ' + dt);
    return { headers: ['Date', 'Commission', 'Sub Commissions', 'Impressions', 'Visitors', 'Registrations', 'FTD'], rows: [] };
  }

  // ── Dynamic column detection (jo bhi keys API me aayen) ──
  const firstKeys = Object.keys(allRows[0]);
  const preferred = [
    ['Day', 'Date'], ['Date', 'Date'],
    ['Commission', 'Commission'], ['Sub_Commissions', 'Sub Commissions'],
    ['Impressions', 'Impressions'], ['Visitors', 'Visitors'], ['Hits', 'Hits'],
    ['Registrations', 'Registrations'], ['Signups', 'Signups'],
    ['FTD', 'FTD'], ['First_Deposits', 'First Deposits'], ['First_Deposit', 'First Deposit'],
    ['Chargebacks', 'Chargebacks'], ['Deposits', 'Deposits']
  ];
  let cols = preferred.filter(p => firstKeys.indexOf(p[0]) >= 0);
  // Baaki jo keys preferred list me nahi hain, unhe bhi jod do (missing na ho)
  firstKeys.forEach(k => { if (!cols.some(p => p[0] === k)) cols.push([k, prettyLabel(k)]); });

  const headers = cols.map(c2 => c2[1]);
  let rows = allRows.map(r => cols.map(c2 => {
    const v = r[c2[0]];
    if (v === null || v === undefined) return '';
    return String(v);
  }));

  const dIdx = cols.findIndex(c2 => c2[0] === 'Day' || c2[0] === 'Date');
  if (dIdx >= 0) {
    rows.forEach(row => { row[dIdx] = String(row[dIdx]).replace(/\//g, '-'); }); // 2026/08/17 -> 2026-08-17
    rows.sort((a, b) => String(a[dIdx]).localeCompare(String(b[dIdx])));
  }

  // Lamba range => month-wise summary
  if (monthly && dIdx >= 0) {
    const g = groupRowsByMonth(headers, rows, dIdx);
    rows = g.rows;
    headers[dIdx] = 'Month';
    console.log('  -> Thunder Partners grouped into ' + rows.length + ' months');
  }

  console.log('  -> Thunder Partners ' + rows.length + ' rows');
  return { headers, rows };
}

// ── Login: POST /authenticate -> bearer token from "message" field ──
async function login(username, password) {
  const body = 'user=' + encodeURIComponent(username) + '&pass=' + encodeURIComponent(password);
  const resp = await fetch('https://go.thunder.partners/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    body
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error('Thunder Partners login failed (' + resp.status + '): ' + text.substring(0, 200));

  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Thunder Partners login: response not JSON: ' + text.substring(0, 200)); }

  if (!data.success || !data.message) {
    throw new Error('Thunder Partners login failed: ' + (data.message || text.substring(0, 200)) + ' — username/password check kar.');
  }
  return data.message; // bearer token
}

// ── Report fetch for one date range ──
async function fetchReport(token, from, to) {
  const url = 'https://affiliateapi.cellxpert.com/'
    + '?command=processReport'
    + '&startDate=' + encodeURIComponent(mdY(from))
    + '&endDate=' + encodeURIComponent(mdY(to))
    + '&DateFormat=day&day=true'
    + '&uniqueId=' + Math.floor(Math.random() * 900000000 + 100000000);

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Affiliate_url': 'ThunderPartners',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0'
    }
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error('Thunder Partners report failed (' + resp.status + '): ' + text.substring(0, 200));

  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('Thunder Partners report: response not JSON: ' + text.substring(0, 200)); }

  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.rows)) return data.rows;
  return [];
}

// ── YYYY-MM-DD -> MM/DD/YYYY (jaisa DevTools me dikha) ──
function mdY(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return m[2] + '/' + m[3] + '/' + m[1];
}

// ── Month grouping (numeric columns sum, text columns first-value) ──
function groupRowsByMonth(headers, rows, dateIdx) {
  const rateIdxs = new Set();
  headers.forEach((h, i) => { if (i !== dateIdx && /(^cr$|rate|ratio|percent|%|avg|average|conversion)/i.test(String(h))) rateIdxs.add(i); });

  const buckets = {}; let order = 0;
  rows.forEach(row => {
    const dnum = ymdNum(String(row[dateIdx] || '').trim());
    if (!dnum) return;
    const mk = dnum.substring(0, 4) + '-' + dnum.substring(4, 6);
    if (!buckets[mk]) {
      buckets[mk] = { sums: {}, cnt: {}, texts: {}, order: order++ };
      headers.forEach((h, i) => { if (i !== dateIdx) { buckets[mk].sums[i] = 0; buckets[mk].cnt[i] = 0; } });
    }
    const b = buckets[mk];
    headers.forEach((h, i) => {
      if (i === dateIdx) return;
      const raw = String(row[i]);
      const num = parseFloat(raw.replace(/[$€£,%]/g, ''));
      if (!isNaN(num) && /^[\d.,$€£%\s-]+$/.test(raw) && raw !== '') { b.sums[i] += num; b.cnt[i] += 1; }
      else if (raw && b.texts[i] === undefined) { b.texts[i] = raw; }
    });
  });

  const mks = Object.keys(buckets).sort();
  const outRows = mks.map(mk => {
    const b = buckets[mk];
    return headers.map((h, i) => {
      if (i === dateIdx) return MONTH_NAMES[parseInt(mk.substring(5, 7), 10) - 1] + ' ' + mk.substring(0, 4);
      if (b.texts[i] !== undefined && b.cnt[i] === 0) return b.texts[i];
      let val = rateIdxs.has(i) ? (b.cnt[i] > 0 ? b.sums[i] / b.cnt[i] : 0) : b.sums[i];
      val = Math.round(val * 100) / 100; if (val % 1 === 0) val = Math.round(val);
      return String(val);
    });
  });
  return { headers, rows: outRows };
}

function buildMonthChunks(df, dt) {
  const start = new Date(df + 'T00:00:00Z');
  const end = new Date(dt + 'T00:00:00Z');
  const chunks = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (cur <= end) {
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const chunkEnd = monthEnd > end ? end : monthEnd;
    chunks.push({
      from: cur.toISOString().substring(0, 10),
      to: chunkEnd.toISOString().substring(0, 10),
      label: MONTH_NAMES[cur.getUTCMonth()] + ' ' + cur.getUTCFullYear()
    });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return chunks;
}

function spanDays(df, dt) { const d1 = new Date(df + 'T00:00:00Z'), d2 = new Date(dt + 'T00:00:00Z'); return Math.round((d2 - d1) / 86400000) + 1; }
function ymdNum(s) { s = String(s).trim(); let m; m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + pad(m[2]) + pad(m[3]); m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (d > 12) return y + pad(mo) + pad(d); if (mo > 12) return y + pad(d) + pad(mo); return y + pad(mo) + pad(d); } return null; }
function pad(n) { return String(n).padStart(2, '0'); }
function prettyLabel(k) { return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()); }

module.exports = { scrape };
