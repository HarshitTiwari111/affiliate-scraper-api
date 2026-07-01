// ============================================================
// STARZPARTNERS (BitStarz/SoftSwiss) — Partner REPORT API
// Uses /partner/report endpoint. Supports campaign_ids + promo_ids filter.
// Date-wise data.
//
// Col H options:
//   baseUrl:https://starzpartners.com
//   campaignId:19941        -> poore campaign ka data
//   promoIds:30482          -> sirf ek promo ka data
//   columns:Date.Visits.Registrations.First Deposits
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username;
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  const promoIds = String(c.promoIds || c.promo_ids || '').trim();
  const campaignIds = String(c.campaignId || c.campaign_ids || '').trim();

  const spanDays = daysBetween(df, dt) + 1;
  const wantMonthly = spanDays > 45;

  const path = '/api/customer/v1/partner/report';
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': String(token),
    'User-Agent': 'Mozilla/5.0'
  };

  const columns = JSON.stringify(['visits_count', 'registrations_count', 'first_deposits_count', 'deposits_sum', 'ngr']);
  const groupBy = JSON.stringify(['date']);

  let allRows = [];
  let headerNames = null;
  let page = 1;
  let totalPages = 1;

  do {
    let url = base + path
      + '?columns=' + encodeURIComponent(columns)
      + '&group_by=' + encodeURIComponent(groupBy)
      + '&from=' + encodeURIComponent(df)
      + '&to=' + encodeURIComponent(dt)
      + '&period=custom'
      + '&conversion_currency=EUR'
      + '&convert_all_currencies=1'
      + '&exchange_rates_date=' + encodeURIComponent(dt)
      + '&page=' + page;

    // Campaign filter (poore campaign ka data — UI jaisa)
    if (campaignIds) url += '&campaign_ids=' + encodeURIComponent(campaignIds);
    // Promo filter (sirf ek promo ka data)
    if (promoIds) url += '&promo_ids=' + encodeURIComponent(promoIds);

    console.log('  -> StarzPartners /report page', page, df, '->', dt,
      (campaignIds ? '(campaign ' + campaignIds + ')' : '') + (promoIds ? '(promo ' + promoIds + ')' : ''));

    const { ok, status, body } = await fetchWithRetry(url, headers, 4);
    if (!ok) {
      if (allRows.length > 0) { console.log('  -> stopped at page', page, 'due to', status); break; }
      throw new Error('StarzPartners /report failed (' + status + '): ' + body.substring(0, 200)
        + (status === 429 ? ' — rate limited, chhota range try kar.' : ''));
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

    totalPages = data.total_pages || (data.rows && data.rows.total_pages) || 1;
    page++;
    if (page <= totalPages) await sleep(600);
    if (page > 100) break;
  } while (page <= totalPages);

  if (!allRows.length || !headerNames) {
    const what = campaignIds ? ('campaign ' + campaignIds) : (promoIds ? ('promo ' + promoIds) : 'account');
    throw new Error('StarzPartners: no rows for ' + what + ' (' + df + ' to ' + dt + '). Is range me data nahi ho sakta.');
  }

  const keys = headerNames.slice();
  allRows.forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));

  const dateKeyIdx = keys.findIndex(k => /date|day|month|period/i.test(k));

  if (dateKeyIdx >= 0) {
    const startNum = df.replace(/-/g, '');
    const endNum = dt.replace(/-/g, '');
    allRows = allRows.filter(o => {
      const norm = normalizeToYmdNum(String(o[keys[dateKeyIdx]] || '').trim());
      if (!norm) return true;
      return norm >= startNum && norm <= endNum;
    });
  }

  if (!allRows.length) throw new Error('StarzPartners: no rows in range after filter');

  if (wantMonthly && dateKeyIdx >= 0) {
    allRows = groupByMonth(allRows, keys, dateKeyIdx);
    console.log('  -> grouped into', allRows.length, 'months');
  }

  const headerLabels = keys.map(prettyLabel);
  const rows = allRows.map(o => keys.map((k, idx) => {
    let v = o[k];
    if (v === null || v === undefined) return '';
    v = String(v);
    if (idx === dateKeyIdx) { const nd = normalizeDate(v); if (nd) v = "'" + nd; }
    return v;
  }));

  console.log('  -> StarzPartners', rows.length, 'rows [' + (wantMonthly ? 'monthly' : 'daily') + ']');
  return { headers: headerLabels, rows };
}

// ── month grouping ──
function groupByMonth(rows, keys, dateIdx) {
  const buckets = {}; let order = 0;
  const rateIdxs = new Set();
  keys.forEach((k, i) => { if (i !== dateIdx && /(^cr$|rate|ratio|percent|%|avg|average)/i.test(k)) rateIdxs.add(i); });
  rows.forEach(o => {
    const dnum = normalizeToYmdNum(String(o[keys[dateIdx]] || '').trim());
    if (!dnum) return;
    const mk = dnum.substring(0, 4) + '-' + dnum.substring(4, 6);
    if (!buckets[mk]) { buckets[mk] = { sums: {}, cnt: {}, order: order++ }; keys.forEach((k, i) => { if (i !== dateIdx) { buckets[mk].sums[i] = 0; buckets[mk].cnt[i] = 0; } }); }
    const b = buckets[mk];
    keys.forEach((k, i) => { if (i === dateIdx) return; const num = parseFloat(String(o[k]).replace(/[$€£,%]/g, '')); if (!isNaN(num)) { b.sums[i] += num; b.cnt[i] += 1; } });
  });
  const mks = Object.keys(buckets).sort((a, b) => buckets[a].order - buckets[b].order);
  return mks.map(mk => {
    const b = buckets[mk]; const obj = {};
    keys.forEach((k, i) => {
      if (i === dateIdx) { obj[k] = mk; return; }
      let val = rateIdxs.has(i) ? (b.cnt[i] > 0 ? b.sums[i] / b.cnt[i] : 0) : b.sums[i];
      val = Math.round(val * 100) / 100; if (val % 1 === 0) val = Math.round(val);
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
    if (resp.status === 429) { const wait = 2000 * Math.pow(2, i); await sleep(wait); continue; }
    return { ok: false, status: resp.status, body };
  }
  return { ok: false, status: lastStatus, body: lastBody };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function daysBetween(a, b) { const d1 = new Date(a + 'T00:00:00Z'), d2 = new Date(b + 'T00:00:00Z'); return Math.round((d2 - d1) / 86400000); }
function normalizeDate(s) {
  s = String(s).trim(); let m;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) return m[1] + '-' + pad(m[2]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (d > 12) return y + '-' + pad(mo) + '-' + pad(d); if (mo > 12) return y + '-' + pad(d) + '-' + pad(mo); return y + '-' + pad(mo) + '-' + pad(d); }
  return s;
}
function normalizeToYmdNum(s) {
  s = String(s).trim(); let m;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + pad(m[2]) + pad(m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (d > 12) return y + pad(mo) + pad(d); if (mo > 12) return y + pad(d) + pad(mo); return y + pad(mo) + pad(d); }
  return null;
}
function pad(n) { return String(n).padStart(2, '0'); }
function prettyLabel(k) { return String(k).replace(/_count|_sum/g, '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()); }

module.exports = { scrape };