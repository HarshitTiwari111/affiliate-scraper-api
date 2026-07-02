// ============================================================
// STARZPARTNERS — Partner REPORT API (/api/customer/v1/partner/report)
// Promo-level, date-wise data. Col H:
//   baseUrl:https://starzpartners.com
//   promoIds:30482                          <- promo b975e1edd filter
//   columns:Date.Visits.Registrations.First Deposits
// ============================================================

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username;
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  const promoIds = String(c.promoIds || c.promo_ids || '').trim();
  const campaignIds = String(c.campaignId || c.campaign_ids || '').trim();

  const path = '/api/customer/v1/partner/report';
  const headers = {
    'Accept': 'application/json',
    'Authorization': String(token),
    'User-Agent': 'Mozilla/5.0'
  };

  const columns = JSON.stringify([
    'visits_count', 'registrations_count', 'first_deposits_count',
    'deposits_sum', 'average_deposit_amount', 'ngr'
  ]);

  // Date-wise breakdown ke liye group_by variants (jo chale wahi use hoga)
  const groupTries = [
    { name: 'period+promo', groupBy: ['period', 'promo'], extra: '&date_group_by=day' },
    { name: 'day+promo',    groupBy: ['day', 'promo'],    extra: '' },
    { name: 'period',       groupBy: ['period'],           extra: '&date_group_by=day' },
    { name: 'day',          groupBy: ['day'],              extra: '' },
    { name: 'promo-split',  groupBy: ['brand', 'campaign', 'promo'], extra: '' }
  ];

  // Filter formats: pehle JSON array (sahi format), phir plain (fallback)
  const filterVariants = [];
  if (promoIds) {
    filterVariants.push('&promo_ids=' + encodeURIComponent(JSON.stringify(promoIds.split(',').map(Number))));
    filterVariants.push('&promo_ids=' + encodeURIComponent(promoIds));
  } else if (campaignIds) {
    filterVariants.push('&campaign_ids=' + encodeURIComponent(JSON.stringify(campaignIds.split(',').map(Number))));
    filterVariants.push('&campaign_ids=' + encodeURIComponent(campaignIds));
  } else {
    filterVariants.push(''); // no filter — poora account
  }

  let lastErr = '';

  for (const fv of filterVariants) {
    for (const gt of groupTries) {
      const url = base + path
        + '?columns=' + encodeURIComponent(columns)
        + '&group_by=' + encodeURIComponent(JSON.stringify(gt.groupBy))
        + '&from=' + encodeURIComponent(df)
        + '&to=' + encodeURIComponent(dt)
        + '&period=custom'
        + gt.extra
        + '&conversion_currency=EUR&convert_all_currencies=1'
        + '&exchange_rates_date=' + encodeURIComponent(dt)
        + '&promo_codes=' + encodeURIComponent('[]')
        + '&strategies=' + encodeURIComponent('[]')
        + '&player_dynamic_tags_include=' + encodeURIComponent('[]')
        + '&player_dynamic_tags_exclude=' + encodeURIComponent('[]')
        + fv;

      let resp, body;
      for (let attempt = 0; attempt < 2; attempt++) {
        resp = await fetch(url, { method: 'GET', headers });
        body = await resp.text();
        if (resp.status !== 429) break;
        console.log('  -> 429 rate limit, waiting 4s...');
        await sleep(4000);
      }

      if (!resp.ok) {
        lastErr = resp.status + ': ' + body.substring(0, 150);
        console.log('  -> [' + gt.name + '] failed:', lastErr);
        await sleep(1200);
        continue;
      }

      let data;
      try { data = JSON.parse(body); }
      catch (e) { lastErr = 'not JSON: ' + body.substring(0, 100); continue; }

      const dataRows = (data.rows && data.rows.data) ? data.rows.data : [];
      if (!dataRows.length) {
        console.log('  -> [' + gt.name + '] 0 rows, trying next...');
        await sleep(1200);
        continue;
      }

      console.log('  -> StarzPartners SUCCESS [' + gt.name + '] ' + dataRows.length + ' rows');
      return formatRows(dataRows);
    }
  }

  const what = promoIds ? ('promo ' + promoIds) : (campaignIds ? ('campaign ' + campaignIds) : 'account');
  throw new Error('StarzPartners: no rows for ' + what + ' (' + df + ' → ' + dt + '). Saare group_by variants try kiye. Last error: ' + (lastErr || 'empty response'));
}

function formatRows(dataRows) {
  const allRows = dataRows.map(cells => {
    const o = {};
    cells.forEach(c => { o[c.name] = c.value; });
    return o;
  });

  const keys = [];
  allRows.forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));

  // Date column ko sabse pehle rakho
  const dateKey = keys.find(k => ['period', 'day', 'date'].indexOf(String(k).toLowerCase()) >= 0);
  if (dateKey) { keys.splice(keys.indexOf(dateKey), 1); keys.unshift(dateKey); }

  const headers = keys.map(k => prettyLabel(k));
  const rows = allRows.map(o => keys.map(k => {
    const v = o[k];
    return (v === null || v === undefined) ? '' : String(v);
  }));
  return { headers, rows };
}

function prettyLabel(k) {
  const lk = String(k).toLowerCase();
  if (lk === 'period' || lk === 'day' || lk === 'date') return 'Date';  // GScript "Date" filter match kare
  return String(k).replace(/_count|_sum/g, '').replace(/_/g, ' ')
    .replace(/\b\w/g, ch => ch.toUpperCase()).trim();
}

module.exports = { scrape };