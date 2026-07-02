// ============================================================
// V.PARTNERS Remote Statistics — NO browser, JSON API.
// <=62 din: single request, daily rows
// >62 din:  month-by-month requests (API long-range limit bypass) + monthly summary
// ============================================================

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://v.partners').replace(/\/+$/, '');
  const token = c.token || c.username || c.email;
  if (!token) throw new Error('V.Partners: remote-stats token missing (Col C).');

  const monthly = spanDays(df, dt) > 62;
  let allRows = [];

  if (!monthly) {
    allRows = await fetchStats(base, token, df, dt);
  } else {
    // Month-by-month fetch + merge
    const chunks = buildMonthChunks(df, dt);
    console.log('  -> V.Partners monthly mode: ' + chunks.length + ' month requests');
    for (const ch of chunks) {
      try {
        const rows = await fetchStats(base, token, ch.from, ch.to);
        console.log('  -> ' + ch.label + ': ' + rows.length + ' rows');
        allRows = allRows.concat(rows);
      } catch (e) {
        console.log('  -> ' + ch.label + ' failed: ' + e.message.substring(0, 80));
      }
      await sleep(1000);
    }
  }

  if (!allRows.length) {
    console.log('  -> V.Partners: no rows for ' + df + ' to ' + dt + ' (empty period, not an error)');
    return { headers: ['Date', 'Brand', 'Unique Clicks', 'Registrations', 'First Deposits'], rows: [] };
  }

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

  const headers = cols.map(c2 => c2[1]);
  let rows = allRows.map(r => cols.map(c2 => {
    const v = r[c2[0]];
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }));

  const dIdx = cols.findIndex(c2 => c2[0] === 'stats_date');
  if (dIdx >= 0) rows.sort((a, b) => String(a[dIdx]).localeCompare(String(b[dIdx])));

  // Lamba range => month-wise summary ("Jan 2026" labels)
  if (monthly && dIdx >= 0) {
    const g = groupRowsByMonth(headers, rows, dIdx);
    rows = g.rows;
    headers[dIdx] = 'Month';
    console.log('  -> V.Partners grouped into ' + rows.length + ' months');
  }

  console.log('  -> V.Partners ' + rows.length + ' rows');
  return { headers, rows };
}

// ── Single API request ──
async function fetchStats(base, token, from, to) {
  const url = base + '/api/stats'
    + '?token=' + encodeURIComponent(token)
    + '&date_from=' + encodeURIComponent(from)
    + '&date_to=' + encodeURIComponent(to);

  const resp = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' } });
  const body = await resp.text();
  if (!resp.ok) throw new Error('V.Partners API failed (' + resp.status + '): ' + body.substring(0, 200));

  let data;
  try { data = JSON.parse(body); }
  catch (e) { throw new Error('V.Partners: response not JSON: ' + body.substring(0, 200)); }

  const out = [];
  if (Array.isArray(data)) {
    data.forEach(r => out.push(r));
  } else if (data && typeof data === 'object') {
    for (const dateKey of Object.keys(data)) {
      const arr = data[dateKey];
      if (Array.isArray(arr)) { arr.forEach(r => { if (r && typeof r === 'object' && !r.stats_date) r.stats_date = dateKey; out.push(r); }); }
      else if (arr && typeof arr === 'object') { if (!arr.stats_date) arr.stats_date = dateKey; out.push(arr); }
    }
  }
  return out;
}

// ── Month grouping — "Jan 2026" labels ──
function groupRowsByMonth(headers, rows, dateIdx) {
  const rateIdxs = new Set();
  headers.forEach((h, i) => { if (i !== dateIdx && /(^cr$|rate|ratio|percent|%|avg|average|conversion)/i.test(String(h))) rateIdxs.add(i); });

  // Text columns (Brand, Currency etc.) — pehli value rakho, sum mat karo
  const buckets = {}; let order = 0;
  rows.forEach(row => {
    const dnum = ymdNum(String(row[dateIdx] || '').replace(/^'/, '').trim());
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
      if (!isNaN(num) && /^[\d.,$€£%\s-]+$/.test(raw)) { b.sums[i] += num; b.cnt[i] += 1; }
      else if (raw && b.texts[i] === undefined) { b.texts[i] = raw; }
    });
  });

  const mks = Object.keys(buckets).sort();
  const outRows = mks.map(mk => {
    const b = buckets[mk];
    return headers.map((h, i) => {
      if (i === dateIdx) {
        return MONTH_NAMES[parseInt(mk.substring(5, 7), 10) - 1] + ' ' + mk.substring(0, 4);
      }
      if (b.texts[i] !== undefined && b.cnt[i] === 0) return b.texts[i]; // text column
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

module.exports = { scrape };