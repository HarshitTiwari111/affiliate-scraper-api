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

   const promoWants = String(c.promoIds || c.promo_ids || '').trim().split(',').map(s => s.trim()).filter(Boolean);
  const campWants  = String(c.campaignId || c.campaign_ids || '').trim().split(',').map(s => s.trim()).filter(Boolean);
  const brandWant  = String(c.brand || '').trim();
  let dim = null, wants = [];
  if (brandWant && brandWant !== '__all__') { dim = 'brand';    wants = [brandWant]; }
  else if (campWants.length)               { dim = 'campaign'; wants = campWants; }
  else if (promoWants.length)              { dim = 'promo';    wants = promoWants; }
  const showBrand = !!(c.brands || brandWant);

  // Col H brandmap:1=Bitstarz.2=Cashy  → brand_id ko naam me badlo
  const brandMap = {};
  String(c.brandmap || c.brandMap || '').split(/[.,]/).forEach(p => {
    const m = p.trim().match(/^(\d+)\s*=\s*(.+)$/);
    if (m) brandMap[m[1]] = m[2].trim();
  });

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
  // REPORT — group_by[]=day/month (+ brand/campaign/promo), filter client-side
  // ════════════════════════════════════════════
  const groupBy = [dateGrouper];
  if (dim) groupBy.push(dim); else if (showBrand) groupBy.push('brand');
  console.log('StarzPartners: ' + df + ' -> ' + dt + ' | group_by=' + groupBy.join(',') + (dim ? ' | ' + dim + '=' + wants.join(',') : ''));

  const url = buildReportUrl(base, groupBy, REPORT_COL_KEYS, df, dt, today);
  const result = await tryFetch(url, headers, 'report ' + groupBy.join('+'));
  if (!result) throw new Error('StarzPartners: report request fail (network/auth). Render logs me status check kar.');

  let objs = result.objs;
  if (Object.keys(brandMap).length) {
    objs.forEach(o => {
      const idKey = Object.keys(o).find(k => /^brand_?id$/i.test(k));
      if (idKey && brandMap[String(o[idKey])]) o.brand = brandMap[String(o[idKey])];
    });
  }
  if (dim && objs.length) {
    const matched = filterByDim(objs, wants, dim);
    if (!matched.length) {
      const seen = collectDimValues(objs, dim);
      throw new Error('StarzPartners: ' + dim + ' "' + wants.join(',') + '" match nahi hua.\nAPI me ye values dikhi:\n'
        + (seen.length ? seen.join('\n') : '(' + dim + ' field nahi mila)') + '\nDashboards sheet Col H me sahi naam daal.');
    }
    objs = matched;
  }
  if (objs.length) {
    console.log('  -> report: ' + objs.length + ' rows');
    return formatRows(objs, df, dt, monthly);
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

// ── Dimension filter: brand / campaign / promo field pe match ──
function filterByDim(objs, wants, dim) {
  const lw = wants.map(w => String(w).toLowerCase());
  return objs.filter(o => {
    const vals = [];
    Object.keys(o).forEach(k => { if (k.toLowerCase().indexOf(dim) >= 0) vals.push(String(o[k]).toLowerCase()); });
    const hay = vals.length ? vals.join(' | ') : Object.values(o).map(v => String(v)).join(' | ').toLowerCase();
    return lw.some(w => hay.indexOf(w) >= 0);
  });
}

// ── Debug: kaunse brand/campaign/promo values API me aaye ──
function collectDimValues(objs, dim) {
  const seen = {};
  objs.forEach(o => Object.keys(o).forEach(k => {
    if (k.toLowerCase().indexOf(dim) >= 0) seen[k + '=' + String(o[k]).substring(0, 40)] = true;
  }));
  return Object.keys(seen).slice(0, 20);
}

// ── Rows ko output format me — date(+brand)-wise group, missing din/month 0 fill ──
function formatRows(objs, df, dt, monthly) {
  const keys = Object.keys(objs[0]);
  const dateKey = keys.find(k => {
    const lk = k.toLowerCase();
    return lk === 'date' || lk === 'day' || lk === 'month' || lk === 'period' || /^\d{4}-\d{2}-\d{2}/.test(String(objs[0][k] || ''));
  });
  const brandKey = keys.find(k => /^brand(_name|_title)?$/i.test(k))
    || keys.find(k => k.toLowerCase().indexOf('brand') >= 0 && !/_?id$/i.test(k));
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
    const brand = brandKey ? String(o[brandKey] || '') : '';
    const bk = label + '||' + brand;
    if (!bucket[bk]) bucket[bk] = { label: label, brand: brand, v: 0, r: 0, f: 0, dep: 0, n: 0, _sort: (dateKey ? String(o[dateKey]).substring(0, 10) : label) + '||' + brand };
    bucket[bk].v += numOf(o, vKey);
    bucket[bk].r += numOf(o, rKey);
    bucket[bk].f += numOf(o, fKey);
    bucket[bk].dep += numOf(o, dKey);
    bucket[bk].n += numOf(o, nKey);
  });

  // Missing periods 0 se fill (sirf jab brand column nahi)
  if (dateKey && !brandKey && !monthly) {
    let cur = new Date(df + 'T00:00:00Z');
    const endD = new Date(dt + 'T00:00:00Z');
    while (cur <= endD) {
      const key = cur.toISOString().substring(0, 10);
      if (!bucket[key + '||']) bucket[key + '||'] = { label: key, brand: '', v: 0, r: 0, f: 0, dep: 0, n: 0, _sort: key + '||' };
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  } else if (dateKey && !brandKey && monthly) {
    buildMonthChunks(df, dt).forEach(ch => {
      if (!bucket[ch.label + '||']) bucket[ch.label + '||'] = { label: ch.label, brand: '', v: 0, r: 0, f: 0, dep: 0, n: 0, _sort: ch.from + '||' };
    });
  }

  const rows = Object.values(bucket)
    .sort((a, b) => (a._sort < b._sort ? -1 : a._sort > b._sort ? 1 : 0))
    .map(x => {
      const r = [x.label];
      if (brandKey) r.push(x.brand);
      return r.concat([String(x.v), String(x.r), String(x.f), x.dep.toFixed(2), x.n.toFixed(2)]);
    });

  const headers = [monthly ? 'Month' : 'Date'];
  if (brandKey) headers.push('Brand');
  return { headers: headers.concat(['Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR']), rows: rows };
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