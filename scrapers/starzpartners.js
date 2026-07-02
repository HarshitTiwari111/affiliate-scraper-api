// ============================================================
// STARZPARTNERS — Partner REPORT API
// Server-side promo filter kaam nahi karta → CLIENT-SIDE filter.
// Date-wise: pehle 'period' group_by try, warna day-by-day loop.
// Col H: baseUrl:...,promoIds:30482,columns:Date.Visits.Registrations.First Deposits
// ============================================================

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const COLUMNS = JSON.stringify([
  'visits_count', 'registrations_count', 'first_deposits_count',
  'deposits_sum', 'average_deposit_amount', 'ngr'
]);

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username;
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  const promoIds = String(c.promoIds || c.promo_ids || '').trim().split(',').map(s => s.trim()).filter(Boolean);
  const campaignIds = String(c.campaignId || c.campaign_ids || '').trim().split(',').map(s => s.trim()).filter(Boolean);

  const headers = {
    'Accept': 'application/json',
    'Authorization': String(token),
    'User-Agent': 'Mozilla/5.0'
  };

  // ── Attempt 1: single request with period grouping (fast path) ──
  const periodTries = [
    { groupBy: ['period', 'brand', 'campaign', 'promo'], extra: '&period_group_by=day' },
    { groupBy: ['period', 'brand', 'campaign', 'promo'], extra: '&date_group_by=day' },
    { groupBy: ['period', 'brand', 'campaign', 'promo'], extra: '' }
  ];
  for (const t of periodTries) {
    try {
      const rows = await fetchReport(base, headers, t.groupBy, df, dt, t.extra);
      if (rows.length) {
        const objs = rowsToObjects(rows);
        const dateKey = findDateKey(objs);
        if (dateKey) {
          console.log('  -> StarzPartners: period grouping worked! ' + objs.length + ' rows');
          return buildOutput(objs, dateKey, promoIds, campaignIds);
        }
      }
    } catch (e) { /* try next */ }
    await sleep(800);
  }

  // ── Attempt 2: day-by-day loop (guaranteed — single-day fetch works) ──
  console.log('  -> StarzPartners: period grouping failed, day-by-day loop...');
  const days = buildDayList(df, dt);
  if (days.length > 62) throw new Error('StarzPartners: range too big (' + days.length + ' days). Max 62 days.');

  const outRows = [];
  let matchedAny = false;

  for (const day of days) {
    let objs = [];
    try {
      const rows = await fetchReport(base, headers, ['brand', 'campaign', 'promo'], day, day, '');
      objs = rowsToObjects(rows);
    } catch (e) {
      console.log('  -> ' + day + ' failed: ' + e.message);
    }

    const matched = filterRows(objs, promoIds, campaignIds);
    if (matched.length) matchedAny = true;

    const sum = (key) => matched.reduce((a, o) => a + (parseFloat(o[key]) || 0), 0);
    const visits = sum('visits_count');
    const regs = sum('registrations_count');
    const ftd = sum('first_deposits_count');
    const deps = sum('deposits_sum');
    const ngr = sum('ngr');

    outRows.push([day, String(visits), String(regs), String(ftd),
      deps ? deps.toFixed(2) : '0', String(ngr ? ngr.toFixed(2) : '0')]);

    await sleep(700); // rate limit se bachne ke liye
  }

  if (!matchedAny) {
    const what = promoIds.length ? 'promo ' + promoIds.join(',') : (campaignIds.length ? 'campaign ' + campaignIds.join(',') : 'account');
    throw new Error('StarzPartners: ' + what + ' ki koi row nahi mili (' + df + ' → ' + dt + '). Promo ID sahi hai? UI mein "(ID: 30482)" jaisa dikhna chahiye.');
  }

  console.log('  -> StarzPartners: ' + outRows.length + ' day rows');
  return {
    headers: ['Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
    rows: outRows
  };
}

// ── Ek report request (NO promo/campaign filter — wo server pe kaam nahi karta) ──
async function fetchReport(base, headers, groupBy, from, to, extra) {
  const url = base + '/api/customer/v1/partner/report'
    + '?columns=' + encodeURIComponent(COLUMNS)
    + '&group_by=' + encodeURIComponent(JSON.stringify(groupBy))
    + '&from=' + encodeURIComponent(from)
    + '&to=' + encodeURIComponent(to)
    + '&period=custom'
    + (extra || '')
    + '&conversion_currency=EUR&convert_all_currencies=1'
    + '&exchange_rates_date=' + encodeURIComponent(to)
    + '&promo_codes=' + encodeURIComponent('[]')
    + '&strategies=' + encodeURIComponent('[]')
    + '&player_dynamic_tags_include=' + encodeURIComponent('[]')
    + '&player_dynamic_tags_exclude=' + encodeURIComponent('[]');

  let resp, body;
  for (let attempt = 0; attempt < 3; attempt++) {
    resp = await fetch(url, { method: 'GET', headers });
    body = await resp.text();
    if (resp.status !== 429) break;
    console.log('  -> 429, waiting 4s...');
    await sleep(4000);
  }
  if (!resp.ok) throw new Error(resp.status + ': ' + body.substring(0, 150));

  const data = JSON.parse(body);
  return (data.rows && data.rows.data) ? data.rows.data : [];
}

function rowsToObjects(dataRows) {
  return dataRows.map(cells => {
    const o = {};
    cells.forEach(cell => { o[cell.name] = cell.value; });
    return o;
  });
}

// Promo/campaign match — cell value mein ID dhundo (e.g. "b975e1edd (ID: 30482)")
function filterRows(objs, promoIds, campaignIds) {
  if (!promoIds.length && !campaignIds.length) return objs;
  return objs.filter(o => {
    if (promoIds.length) {
      const pv = String(o.promo || o.promo_id || '');
      return promoIds.some(id => pv.indexOf(id) >= 0);
    }
    const cv = String(o.campaign || o.campaign_id || '');
    return campaignIds.some(id => cv.indexOf(id) >= 0);
  });
}

function findDateKey(objs) {
  if (!objs.length) return null;
  const keys = Object.keys(objs[0]);
  return keys.find(k => {
    const lk = k.toLowerCase();
    if (lk === 'period' || lk === 'day' || lk === 'date') return true;
    // value date jaisa dikhta hai? (2026-06-30 etc.)
    return /^\d{4}-\d{2}-\d{2}/.test(String(objs[0][k] || ''));
  }) || null;
}

// Fast-path output (jab period grouping chal jaye)
function buildOutput(objs, dateKey, promoIds, campaignIds) {
  const matched = filterRows(objs, promoIds, campaignIds);
  if (!matched.length) throw new Error('StarzPartners: period grouping mein promo match nahi hua.');

  // Same date ki rows ko sum karo
  const byDate = {};
  matched.forEach(o => {
    const d = String(o[dateKey]).substring(0, 10);
    if (!byDate[d]) byDate[d] = { visits: 0, regs: 0, ftd: 0, deps: 0, ngr: 0 };
    byDate[d].visits += parseFloat(o.visits_count) || 0;
    byDate[d].regs += parseFloat(o.registrations_count) || 0;
    byDate[d].ftd += parseFloat(o.first_deposits_count) || 0;
    byDate[d].deps += parseFloat(o.deposits_sum) || 0;
    byDate[d].ngr += parseFloat(o.ngr) || 0;
  });

  const rows = Object.keys(byDate).sort().map(d => {
    const v = byDate[d];
    return [d, String(v.visits), String(v.regs), String(v.ftd), v.deps.toFixed(2), v.ngr.toFixed(2)];
  });
  return { headers: ['Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'], rows };
}

function buildDayList(df, dt) {
  const days = [];
  let d = new Date(df + 'T00:00:00Z');
  const end = new Date(dt + 'T00:00:00Z');
  while (d <= end) {
    days.push(d.toISOString().substring(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

module.exports = { scrape };