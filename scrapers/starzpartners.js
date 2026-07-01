// ============================================================
// STARZPARTNERS — Partner REPORT API (/api/customer/v1/partner/report)
// group_by = brand,campaign (UI jaisa). promo_ids ya campaign_ids se filter.
// Col H:
//   baseUrl:https://starzpartners.com
//   campaignId:19941     <- poore campaign ka data (RECOMMENDED — isme data hai)
//   promoIds:30482       <- sirf ek promo (isme abhi 0 data hai)
//   columns:Visits.Registrations.First Deposits
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username;
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  const promoIds = String(c.promoIds || c.promo_ids || '').trim();
  const campaignIds = String(c.campaignId || c.campaign_ids || '').trim();

  const path = '/api/customer/v1/partner/report';
  const headers = {
    'Accept': 'application/json', 'Content-Type': 'application/json',
    'Authorization': String(token), 'User-Agent': 'Mozilla/5.0'
  };

  const columns = JSON.stringify(['visits_count', 'registrations_count', 'first_deposits_count', 'deposits_sum', 'average_deposit_amount', 'ngr']);
  const groupBy = JSON.stringify(['brand', 'campaign']);

  let url = base + path
    + '?columns=' + encodeURIComponent(columns)
    + '&group_by=' + encodeURIComponent(groupBy)
    + '&from=' + encodeURIComponent(df)
    + '&to=' + encodeURIComponent(dt)
    + '&period=custom'
    + '&conversion_currency=EUR&convert_all_currencies=1'
    + '&exchange_rates_date=' + encodeURIComponent(dt)
    + '&promo_codes=' + encodeURIComponent('[]')
    + '&strategies=' + encodeURIComponent('[]')
    + '&player_dynamic_tags_include=' + encodeURIComponent('[]')
    + '&player_dynamic_tags_exclude=' + encodeURIComponent('[]');

  if (campaignIds) url += '&campaign_ids=' + encodeURIComponent(campaignIds);
  if (promoIds) url += '&promo_ids=' + encodeURIComponent(promoIds);

  console.log('  -> StarzPartners', df, '->', dt, (campaignIds ? 'campaign ' + campaignIds : '') + (promoIds ? ' promo ' + promoIds : ''));

  const resp = await fetch(url, { method: 'GET', headers });
  const body = await resp.text();
  if (!resp.ok) throw new Error('StarzPartners failed (' + resp.status + '): ' + body.substring(0, 200));

  let data;
  try { data = JSON.parse(body); }
  catch (e) { throw new Error('StarzPartners: response not JSON: ' + body.substring(0, 200)); }

  const dataRows = (data.rows && data.rows.data) ? data.rows.data : [];
  if (!dataRows.length) {
    const what = campaignIds ? ('campaign ' + campaignIds) : (promoIds ? ('promo ' + promoIds) : 'account');
    throw new Error('StarzPartners: no rows for ' + what + ' (' + df + ' to ' + dt + '). Is ' + what + ' me is range me data nahi hai. Tip: promoIds ki jagah campaignId:19941 try kar — usme data hai.');
  }

  // Headers + rows
  let headerNames = dataRows[0].map(c => c.name);
  const allRows = dataRows.map(cells => {
    const o = {};
    cells.forEach(c => { o[c.name] = c.value; });
    return o;
  });

  const keys = headerNames.slice();
  allRows.forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));

  const headerLabels = keys.map(prettyLabel);
  const rows = allRows.map(o => keys.map(k => {
    let v = o[k];
    if (v === null || v === undefined) return '';
    return String(v);
  }));

  console.log('  -> StarzPartners', rows.length, 'rows');
  return { headers: headerLabels, rows };
}

function prettyLabel(k) {
  return String(k).replace(/_count|_sum/g, '').replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()).trim();
}

module.exports = { scrape };