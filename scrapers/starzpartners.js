// ============================================================
// STARZPARTNERS — Partner REPORT API (v3 — range-based detection)
// Col H: baseUrl:...,promoIds:30482,columns:Date.Visits.Registrations.First Deposits
// ============================================================

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const COLUMNS = JSON.stringify([
  'visits_count', 'registrations_count', 'first_deposits_count',
  'deposits_sum', 'average_deposit_amount', 'ngr'
]);

const PROMO_TOKENS = ['promo', 'promos', 'promo_id'];

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username;
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  const wants = String(c.promoIds || c.promo_ids || c.campaignId || c.campaign_ids || '')
    .trim().split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const headers = {
    'Accept': 'application/json',
    'Authorization': String(token),
    'User-Agent': 'Mozilla/5.0'
  };

  const days = buildDayList(df, dt);
  if (days.length > 62) throw new Error('StarzPartners: range too big (' + days.length + ' days).');

  // ── Working group_by dhundo — POORE RANGE pe test (single day pe nahi!) ──
  let workingGroupBy = null;
  let rangeObjs = null;
  const diag = [];

  for (const pt of PROMO_TOKENS) {
    const gb = ['brand', 'campaign', pt];
    try {
      const rows = await fetchReport(base, headers, gb, df, dt);
      diag.push(pt + '=' + rows.length);
      if (rows.length) { workingGroupBy = gb; rangeObjs = rowsToObjects(rows); break; }
    } catch (e) { diag.push(pt + '=ERR:' + e.message.substring(0, 50)); }
    await sleep(2000);
  }

  if (!workingGroupBy) {
    // Promo grouping se kuch nahi mila — check karo range mein data hai bhi?
    let baseRows = [];
    try {
      baseRows = await fetchReport(base, headers, ['brand', 'campaign'], df, dt);
      diag.push('brand+campaign=' + baseRows.length);
    } catch (e) { diag.push('brand+campaign=ERR'); }

    if (!baseRows.length) {
      // Poore range mein account-level data hi nahi — ye error nahi, empty period hai
      console.log('  -> StarzPartners: is range mein account mein koi data nahi (' + df + ' → ' + dt + ')');
      return {
        headers: ['Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
        rows: days.map(d => [d, '0', '0', '0', '0.00', '0.00'])
      };
    }

    // Data hai lekin promo grouping fail — brand+campaign se hi chalao (promo filter possible nahi)
    console.log('  -> StarzPartners: promo grouping unsupported, brand+campaign use kar raha (NO promo filter!)');
    workingGroupBy = ['brand', 'campaign'];
  }

  console.log('  -> StarzPartners group_by: ' + JSON.stringify(workingGroupBy) + ' | ' + diag.join(' | '));

  // ── Day-by-day loop ──
  const outRows = [];
  let matchedAny = false;
  const seenValues = {};

  for (const day of days) {
    let objs = [];
    try {
      const rows = await fetchReport(base, headers, workingGroupBy, day, day);
      objs = rowsToObjects(rows);
    } catch (e) {
      console.log('  -> ' + day + ' failed: ' + e.message.substring(0, 80));
    }

    objs.forEach(o => {
      Object.keys(o).forEach(k => {
        const lk = k.toLowerCase();
        if (lk.indexOf('promo') >= 0 || lk === 'campaign' || lk === 'brand') {
          seenValues[k + ': ' + String(o[k]).substring(0, 50)] = true;
        }
      });
    });

    const matched = filterRows(objs, wants);
    if (matched.length) matchedAny = true;

    const sum = (key) => matched.reduce((a, o) => a + (parseFloat(o[key]) || 0), 0);
    outRows.push([
      day,
      String(sum('visits_count')),
      String(sum('registrations_count')),
      String(sum('first_deposits_count')),
      sum('deposits_sum').toFixed(2),
      sum('ngr').toFixed(2)
    ]);

    await sleep(1500);
  }

  // Range mein data tha, promo bhi group ho raha tha, par tera ID match nahi hua → diagnostic
  if (wants.length && !matchedAny && rangeObjs) {
    const rangeMatched = filterRows(rangeObjs, wants);
    if (!rangeMatched.length) {
      const seen = Object.keys(seenValues).slice(0, 12);
      throw new Error('StarzPartners: "' + wants.join(',') + '" kisi row mein nahi mila.\n\nAPI ne ye values bheji:\n' + seen.join('\n') + '\n\nIn mein se sahi value promoIds mein daal.');
    }
  }

  console.log('  -> StarzPartners: ' + outRows.length + ' day rows done');
  return {
    headers: ['Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
    rows: outRows
  };
}

async function fetchReport(base, headers, groupBy, from, to) {
  const url = base + '/api/customer/v1/partner/report'
    + '?columns=' + encodeURIComponent(COLUMNS)
    + '&group_by=' + encodeURIComponent(JSON.stringify(groupBy))
    + '&from=' + encodeURIComponent(from)
    + '&to=' + encodeURIComponent(to)
    + '&period=custom'
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
    console.log('  -> 429, waiting 5s...');
    await sleep(5000);
  }
  if (!resp.ok) throw new Error(resp.status + ': ' + body.substring(0, 120));

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

function filterRows(objs, wants) {
  if (!wants.length) return objs;
  return objs.filter(o => {
    const rowText = Object.values(o).map(v => String(v)).join(' | ').toLowerCase();
    return wants.some(w => rowText.indexOf(w) >= 0);
  });
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