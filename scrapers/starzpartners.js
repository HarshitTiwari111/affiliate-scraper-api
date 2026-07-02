// ============================================================
// STARZPARTNERS — Partner REPORT API (self-diagnosing version)
// Col H: baseUrl:...,promoIds:30482,columns:Date.Visits.Registrations.First Deposits
// promoIds mein ID ya promo naam (b975e1edd) dono chalega
// ============================================================

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const COLUMNS = JSON.stringify([
  'visits_count', 'registrations_count', 'first_deposits_count',
  'deposits_sum', 'average_deposit_amount', 'ngr'
]);

// group_by mein promo ke liye alag-alag naam try karo
const PROMO_TOKENS = ['promo', 'promos', 'promo_id'];

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username;
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  // ID ya naam — dono lowercase mein match karenge
  const wants = String(c.promoIds || c.promo_ids || c.campaignId || c.campaign_ids || '')
    .trim().split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const headers = {
    'Accept': 'application/json',
    'Authorization': String(token),
    'User-Agent': 'Mozilla/5.0'
  };

  const days = buildDayList(df, dt);
  if (days.length > 62) throw new Error('StarzPartners: range too big (' + days.length + ' days).');

  // ── Pehle working group_by dhundo (pehle din pe test) ──
  let workingGroupBy = null;
  let firstDayObjs = null;
  const diag = [];

  for (const pt of PROMO_TOKENS) {
    const gb = ['brand', 'campaign', pt];
    try {
      const rows = await fetchReport(base, headers, gb, days[0], days[0]);
      diag.push(pt + '=' + rows.length + ' rows');
      if (rows.length) { workingGroupBy = gb; firstDayObjs = rowsToObjects(rows); break; }
    } catch (e) { diag.push(pt + '=ERR ' + e.message.substring(0, 60)); }
    await sleep(900);
  }

  // Promo grouping bilkul nahi chala → bina promo ke (brand+campaign)
  if (!workingGroupBy) {
    try {
      const rows = await fetchReport(base, headers, ['brand', 'campaign'], days[0], days[0]);
      diag.push('brand+campaign=' + rows.length + ' rows');
      if (rows.length) { workingGroupBy = ['brand', 'campaign']; firstDayObjs = rowsToObjects(rows); }
    } catch (e) { diag.push('brand+campaign=ERR'); }
  }

  if (!workingGroupBy) {
    throw new Error('StarzPartners: API se koi rows hi nahi aa rahi (' + days[0] + '). Tried: ' + diag.join(' | ') + '. Token expire toh nahi hua?');
  }

  console.log('  -> StarzPartners group_by working: ' + JSON.stringify(workingGroupBy));

  // ── Day-by-day loop ──
  const outRows = [];
  let matchedAny = false;
  const seenPromoValues = {};

  for (let di = 0; di < days.length; di++) {
    const day = days[di];
    let objs;
    if (di === 0 && firstDayObjs) {
      objs = firstDayObjs; // pehle din ka data already fetch ho chuka
    } else {
      try {
        const rows = await fetchReport(base, headers, workingGroupBy, day, day);
        objs = rowsToObjects(rows);
      } catch (e) {
        console.log('  -> ' + day + ' failed: ' + e.message.substring(0, 80));
        objs = [];
      }
      await sleep(700);
    }

    // Diagnostic: promo values collect karo
    objs.forEach(o => {
      Object.keys(o).forEach(k => {
        const lk = k.toLowerCase();
        if (lk.indexOf('promo') >= 0 || lk === 'campaign' || lk === 'brand') {
          seenPromoValues[k + ': ' + String(o[k]).substring(0, 50)] = true;
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
  }

  if (wants.length && !matchedAny) {
    const seen = Object.keys(seenPromoValues).slice(0, 12);
    throw new Error('StarzPartners: "' + wants.join(',') + '" kisi row mein nahi mila (' + df + ' → ' + dt + ').\n\nAPI ne ye values bheji:\n' + (seen.length ? seen.join('\n') : '(koi rows nahi)') + '\n\nIn mein se sahi value promoIds mein daal.');
  }

  console.log('  -> StarzPartners: ' + outRows.length + ' day rows');
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
    console.log('  -> 429, waiting 4s...');
    await sleep(4000);
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

// Row ki HAR value mein ID/naam dhundo (case-insensitive)
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