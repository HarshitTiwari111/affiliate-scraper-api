// ============================================================
// STARZPARTNERS — v9 (OFFICIAL API — promo via group_by[]=promo)
//
// Official docs confirm: /api/customer/v1/partner/report (STATISTIC_TOKEN se chalta hai)
//   group_by[]=promo  → promo-wise breakdown
//   group_by[]=day    → date-wise (date grouper group_by me daalna padta hai, alag param NAHI)
//   Sirf EK date grouper (year/month/week/day) allowed.
//
// PROMO MODE (Col H me promoIds diya):
//   group_by[]=day + group_by[]=promo, phir client-side sirf wanted promo_id filter.
//   Token se — koi login/cookie/2FA nahi.
//
// NO-FILTER MODE (promoIds nahi):
//   Chhota range: report group_by[]=day (daily rows).
//   Lamba range (>62 din): report group_by[]=month (monthly rows).
//
// Col H: baseUrl:https://starzpartners.com,promoIds:30482,columns:Date.Month.Visits.Registrations.First Deposits
// ============================================================

const sleep = (ms) => new Promise(res => setTimeout(res, ms));
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Report columns (docs ke exact naam)
const REPORT_COL_KEYS = ['visits_count', 'registrations_count', 'first_deposits_count', 'deposits_sum', 'ngr'];

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username;
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  const wants = String(c.promoIds || c.promo_ids || c.campaignId || c.campaign_ids || '')
    .trim().split(',').map(s => s.trim()).filter(Boolean);

  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': String(token),
    'User-Agent': 'Mozilla/5.0'
  };

  const today = new Date().toISOString().substring(0, 10);
  const totalDays = Math.round((new Date(dt + 'T00:00:00Z') - new Date(df + 'T00:00:00Z')) / 86400000) + 1;
  const monthly = totalDays > 62;
  const dateGrouper = monthly ? 'month' : 'day';

  // ════════════════════════════════════════════
  // PROMO MODE — group_by[]=day/month + promo, filter client-side
  // ════════════════════════════════════════════
  if (wants.length) {
    console.log('StarzPartners PROMO MODE: ' + wants.join(',') + ' | ' + df + ' -> ' + dt + ' | grouper=' + dateGrouper);
    const url = buildReportUrl(base, [dateGrouper, 'promo'], REPORT_COL_KEYS, df, dt, today);
    const result = await tryFetch(url, headers, 'promo-report ' + dateGrouper + '+promo');

    if (!result) throw new Error('StarzPartners: report request fail (network/auth). Render logs me status check kar.');
    if (!result.objs.length) {
      throw new Error('StarzPartners: report khaali aaya ' + df + ' -> ' + dt + ' range me. '
        + 'Is range/promo me data hai? Sheet me date range check kar.');
    }

    // Promo filter — promo_id ya promo field pe match
    const matched = filterByPromo(result.objs, wants);
    if (!matched.length) {
      const seen = collectPromoValues(result.objs);
      throw new Error('StarzPartners: promo "' + wants.join(',') + '" match nahi hua.\n'
        + 'API me ye promo values dikhi:\n' + (seen.length ? seen.join('\n') : '(promo field nahi mila — data me promo dimension shayad nahi aaya)')
        + '\nCol H me promoIds me sahi value daal.');
    }

    console.log('  -> PROMO MATCH: ' + matched.length + ' rows');
    return formatRows(matched, df, dt, monthly);
  }

  // ════════════════════════════════════════════
  // NO-FILTER MODE — report group_by[]=day/month
  // ════════════════════════════════════════════
  console.log('StarzPartners NO-FILTER: ' + df + ' -> ' + dt + ' | grouper=' + dateGrouper);
  const url = buildReportUrl(base, [dateGrouper], REPORT_COL_KEYS, df, dt, today);
  const result = await tryFetch(url, headers, 'report ' + dateGrouper);

  if (result && result.objs.length) {
    console.log('  -> report: ' + result.objs.length + ' rows');
    return formatRows(result.objs, df, dt, monthly);
  }

  // Fallback: zero-fill
  const labels = monthly ? buildMonthChunks(df, dt).map(ch => ch.label) : buildDayList(df, dt);
  return {
    headers: [monthly ? 'Month' : 'Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
    rows: labels.map(l => [l, '0', '0', '0', '0.00', '0.00'])
  };
}

// ── Official report URL: columns[]= , group_by[]= (array params) ──
function buildReportUrl(base, groupBy, cols, from, to, today) {
  let url = base + '/api/customer/v1/partner/report'
    + '?async=false'
    + '&from=' + encodeURIComponent(from)
    + '&to=' + encodeURIComponent(to)
    + '&exchange_rates_date=' + encodeURIComponent(today)
    + '&conversion_currency=EUR';
  cols.forEach(k => { url += '&columns%5B%5D=' + k; });
  groupBy.forEach(g => { url += '&group_by%5B%5D=' + encodeURIComponent(g); });
  return url;
}

// ── Promo filter: har row me promo_id / promo field dekho, wanted se match ──
function filterByPromo(objs, wants) {
  const lw = wants.map(w => String(w).toLowerCase());
  return objs.filter(o => {
    // promo-related keys ki value nikaalo
    const promoVals = [];
    Object.keys(o).forEach(k => {
      if (k.toLowerCase().indexOf('promo') >= 0) promoVals.push(String(o[k]).toLowerCase());
    });
    // Agar promo field mila to usi pe match; warna poori row text pe (safety)
    const hay = promoVals.length ? promoVals.join(' | ') : Object.values(o).map(v => String(v)).join(' | ').toLowerCase();
    return lw.some(w => hay.indexOf(w) >= 0);
  });
}

// ── Debug: kaunse promo values API me aaye ──
function collectPromoValues(objs) {
  const seen = {};
  objs.forEach(o => {
    Object.keys(o).forEach(k => {
      if (k.toLowerCase().indexOf('promo') >= 0) seen[k + '=' + String(o[k]).substring(0, 40)] = true;
    });
  });
  return Object.keys(seen).slice(0, 20);
}

// ── Rows ko output format me — date-wise group, missing din/month 0 fill ──
function formatRows(objs, df, dt, monthly) {
  const keys = Object.keys(objs[0]);
  const dateKey = keys.find(k => {
    const lk = k.toLowerCase();
    return lk === 'date' || lk === 'day' || lk === 'month' || lk === 'period' || /^\d{4}-\d{2}-\d{2}/.test(String(objs[0][k] || ''));
  });
  const findKey = (pats) => keys.find(k => pats.some(p => k.toLowerCase().indexOf(p) >= 0));
  const vKey = findKey(['visit']), rKey = findKey(['registration', 'signup']),
    fKey = findKey(['first_deposit', 'ftd']), dKey = findKey(['deposits_sum', 'deposit_sum']),
    nKey = findKey(['ngr']);

  // money type nested object ho sakta hai ({amount, amount_cents}) — amount nikaalo
  const numOf = (o, k) => {
    if (!k) return 0;
    const v = o[k];
    if (v && typeof v === 'object') return parseFloat(v.amount != null ? v.amount : (v.amount_cents != null ? v.amount_cents / 100 : 0)) || 0;
    return parseFloat(v) || 0;
  };

  const bucket = {};
  objs.forEach(o => {
    let label;
    if (dateKey) {
      const rawD = String(o[dateKey]).substring(0, 10); // YYYY-MM-DD
      label = monthly
        ? (MONTH_NAMES[parseInt(rawD.substring(5, 7), 10) - 1] + ' ' + rawD.substring(0, 4))
        : rawD;
    } else {
      label = (df === dt) ? df : (df + ' -> ' + dt);
    }
    if (!bucket[label]) bucket[label] = { v: 0, r: 0, f: 0, dep: 0, n: 0, _sort: (dateKey ? String(o[dateKey]).substring(0, 10) : label) };
    bucket[label].v += numOf(o, vKey);
    bucket[label].r += numOf(o, rKey);
    bucket[label].f += numOf(o, fKey);
    bucket[label].dep += numOf(o, dKey);
    bucket[label].n += numOf(o, nKey);
  });

  // Missing periods 0 se fill (sirf date-wise ke liye)
  if (dateKey && !monthly) {
    let cur = new Date(df + 'T00:00:00Z');
    const endD = new Date(dt + 'T00:00:00Z');
    while (cur <= endD) {
      const key = cur.toISOString().substring(0, 10);
      if (!bucket[key]) bucket[key] = { v: 0, r: 0, f: 0, dep: 0, n: 0, _sort: key };
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else if (dateKey && monthly) {
    buildMonthChunks(df, dt).forEach(ch => {
      if (!bucket[ch.label]) bucket[ch.label] = { v: 0, r: 0, f: 0, dep: 0, n: 0, _sort: ch.from };
    });
  }

  const rows = Object.keys(bucket)
    .sort((a, b) => (bucket[a]._sort < bucket[b]._sort ? -1 : bucket[a]._sort > bucket[b]._sort ? 1 : 0))
    .map(label => {
      const x = bucket[label];
      return [label, String(x.v), String(x.r), String(x.f), x.dep.toFixed(2), x.n.toFixed(2)];
    });

  return { headers: [(monthly ? 'Month' : 'Date'), 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'], rows };
}

// ── Fetch + flexible parse + LOG PREVIEW ──
async function tryFetch(url, headers, label) {
  let resp, body;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      resp = await fetch(url, { method: 'GET', headers });
      body = await resp.text();
      if (resp.status !== 429) break;
      console.log('  -> 429 [' + label + '], waiting 5s...');
      await sleep(5000);
    }
  } catch (e) {
    console.log('  -> [' + label + '] network error: ' + e.message);
    return null;
  }

  console.log('  -> [' + label + '] status=' + resp.status + ' preview=' + body.substring(0, 180).replace(/\s+/g, ' '));
  if (!resp.ok) return null;

  let data;
  try { data = JSON.parse(body); } catch (e) { return null; }

  let raw = null;
  if (data.rows && Array.isArray(data.rows.data)) raw = data.rows.data;
  else if (Array.isArray(data.rows)) raw = data.rows;
  else if (Array.isArray(data.data)) raw = data.data;
  else if (Array.isArray(data)) raw = data;
  if (!raw || !raw.length) return { objs: [] };

  // Rows = array of cells [{name, value, type}] -> object {name: value}
  const objs = raw.map(item => {
    if (Array.isArray(item)) {
      const o = {};
      item.forEach(cell => { if (cell && cell.name !== undefined) o[cell.name] = cell.value; });
      return o;
    }
    return item;
  });

  return { objs };
}

// ── Month chunks ──
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

// ── Day list (fallback zero-fill) ──
function buildDayList(df, dt) {
  const start = new Date(df + 'T00:00:00Z');
  const end = new Date(dt + 'T00:00:00Z');
  const out = [];
  let d = new Date(start);
  while (d <= end) {
    out.push(d.toISOString().substring(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

module.exports = { scrape };