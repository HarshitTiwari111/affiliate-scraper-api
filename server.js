const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
app.use(express.json());

const ecOauth = require('./scrapers/elitecasino-oauth'); // Elite Casino OAuth (no browser)
const bm = require('./scrapers/betmen');                 // Betmen Cellxpert API-key (no browser)
const vp = require('./scrapers/vpartners');              // V.Partners remote-stats (no browser)
const sp = require('./scrapers/starzpartners');          // StarzPartners Partner API (no browser)

app.get('/', (q, r) => r.json({ status: 'ok', scrapers: ['elitecasino', 'betmen', 'vpartners', 'starzpartners'] }));
app.get('/health', (q, r) => r.json({ status: 'ok', chrome: CHROME }));

app.get('/myip', async (q, r) => {
  try {
    const resp = await fetch('https://api.ipify.org?format=json');
    const data = await resp.json();
    r.json({ ip: data.ip });
  } catch (e) { r.json({ error: e.message }); }
});

// ============================================================
// TEMPORARY DEBUG — Betmen ka EXACT raw response dekhne ke liye
// Browser me khol: /betmen-raw?key=YOUR_API_KEY
// ============================================================
app.get('/betmen-raw', async (q, r) => {
  try {
    const key = q.query.key || '';
    const affId = q.query.aff || '36451';
    const results = {};
    for (const suffix of ['&json=1', '']) {
      const url = 'https://track.betmenaffiliates.com/api/'
        + '?command=mediareport&fromdate=2026-06-30&todate=2026-06-30&Day=1&Brand=1' + suffix;
      const resp = await fetch(url, {
        headers: { 'affiliateid': affId, 'x-api-key': key, 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
      });
      const body = await resp.text();
      results[suffix ? 'with_json' : 'without_json'] = {
        status: resp.status,
        contentType: resp.headers.get('content-type'),
        length: body.length,
        full: body.substring(0, 3000)
      };
    }
    r.json(results);
  } catch (e) { r.json({ error: e.message }); }
});

// ============================================================
// TEMPORARY DEBUG — Elite Casino CSV ka RAW structure dekhne ke liye
// Browser me khol: /elite-raw?u=USERNAME&p=PASSWORD
// ============================================================
app.get('/elite-raw', async (q, r) => {
  try {
    const base = 'https://affiliates.elitecasinopartners.ag';
    const clientId = q.query.u || '';
    const clientSecret = q.query.p || '';
    const df = q.query.df || '2026-06-30';
    const dt = q.query.dt || '2026-06-30';

    // Token
    const tokenBody = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'r_user_stats' }).toString();
    const tr = await fetch(base + '/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: tokenBody });
    const tJson = JSON.parse(await tr.text());
    const token = tJson.access_token;
    if (!token) return r.json({ error: 'no token', resp: tJson });

    // CSV
    const statsUrl = base + '/statistics.php?d1=' + df + '&d2=' + dt + '&sd=1&mode=csv&sbm=1&dnl=1';
    const sr = await fetch(statsUrl, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'text/csv' } });
    const csv = await sr.text();

    // Har line ko number ke saath dikhao (taaki structure saaf dikhe)
    const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const numbered = lines.slice(0, 40).map((l, i) => '[' + i + '] ' + l);

    r.json({
      totalLines: lines.length,
      contentType: sr.headers.get('content-type'),
      lines: numbered
    });
  } catch (e) { r.json({ error: e.message }); }
});

// ============================================================
// TEMPORARY DEBUG — StarzPartners promo filter (with delays to avoid 429)
// Browser me khol: /starz-raw?token=YOUR_STARZ_TOKEN
// ============================================================
app.get('/starz-raw', async (q, r) => {
  try {
    const token = q.query.token || '';
    const base = 'https://starzpartners.com';
    const path = '/api/customer/v1/partner/traffic_report';
    const from = '2026-06-25';
    const to = '2026-07-02';
    const headers = { 'Accept': 'application/json', 'Authorization': String(token), 'User-Agent': 'Mozilla/5.0' };
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    const tries = [
      ['no_filter', '?from=' + from + '&to=' + to + '&date_group_by=day'],
      ['promo_id', '?from=' + from + '&to=' + to + '&date_group_by=day&promo_id=30482'],
      ['promos_array', '?from=' + from + '&to=' + to + '&date_group_by=day&promos[]=30482'],
      ['campaign_promo', '?from=' + from + '&to=' + to + '&date_group_by=day&campaign_id=19941&promo_id=30482'],
      ['group_by_promo_full', '?from=' + from + '&to=' + to + '&date_group_by=promo']
    ];

    const out = {};
    for (const [name, qs] of tries) {
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          const resp = await fetch(base + path + qs, { headers });
          const body = await resp.text();
          if (resp.status === 429) { await sleep(4000); continue; }
          let totalVisits = '?', rowCount = '?', colNames = [];
          try {
            const d = JSON.parse(body);
            const rows = (d.rows && d.rows.data) ? d.rows.data : [];
            rowCount = rows.length;
            if (rows.length && rows[0]) colNames = rows[0].map(c => c.name);
            let v = 0;
            rows.forEach(cells => { cells.forEach(c => { if (/visit/i.test(c.name)) v += parseFloat(c.value) || 0; }); });
            totalVisits = v;
          } catch (e) {}
          out[name] = { status: resp.status, rowCount: rowCount, totalVisits: totalVisits, columns: colNames, preview: body.substring(0, 250) };
          done = true;
        } catch (e) { out[name] = { error: e.message }; done = true; }
      }
      if (!done) out[name] = { status: 429, note: 'still rate-limited after retries' };
      await sleep(3000);
    }
    r.json(out);
  } catch (e) { r.json({ error: e.message }); }
});

// ============================================================
// TEMPORARY DEBUG — StarzPartners /report ka EXACT response (UI jaisa request)
// Browser me khol: /starz-report?token=YOUR_STARZ_TOKEN
// NOTE: ~15 sec lagega (gap de raha hai) — page load hone de.
// ============================================================
app.get('/starz-report', async (q, r) => {
  try {
    const token = q.query.token || '';
    const base = 'https://starzpartners.com';
    const headers = { 'Accept': 'application/json', 'Authorization': String(token), 'User-Agent': 'Mozilla/5.0' };
    const sleep = (ms) => new Promise(res => setTimeout(res, ms));

    // EXACT jaisa UI bhejta hai (tere URL se copy kiya)
    const columns = JSON.stringify(['visits_count', 'registrations_count', 'first_deposits_count', 'deposits_sum', 'average_deposit_amount', 'ngr']);

    // 3 alag group_by try karo
    const tries = [
      ['group_date', JSON.stringify(['date'])],
      ['group_brand_campaign', JSON.stringify(['brand', 'campaign'])],
      ['group_promo', JSON.stringify(['promo'])]
    ];

    const out = {};
    for (const [name, gb] of tries) {
      const url = base + '/api/customer/v1/partner/report'
        + '?columns=' + encodeURIComponent(columns)
        + '&group_by=' + encodeURIComponent(gb)
        + '&from=' + (q.query.from || '2026-06-25') + '&to=' + (q.query.to || '2026-07-01')
        + '&period=custom'
        + '&conversion_currency=EUR&convert_all_currencies=1'
        + '&exchange_rates_date=' + (q.query.to || '2026-07-01')
        + '&promo_ids=30482'
        + '&promo_codes=' + encodeURIComponent('[]')
        + '&strategies=' + encodeURIComponent('[]')
        + '&player_dynamic_tags_include=' + encodeURIComponent('[]')
        + '&player_dynamic_tags_exclude=' + encodeURIComponent('[]');

      let done = false;
      for (let a = 0; a < 3 && !done; a++) {
        try {
          const resp = await fetch(url, { headers });
          const body = await resp.text();
          if (resp.status === 429) { await sleep(4000); continue; }
          out[name] = { status: resp.status, full: body.substring(0, 1200) };
          done = true;
        } catch (e) { out[name] = { error: e.message }; done = true; }
      }
      await sleep(3000);
    }
    r.json(out);
  } catch (e) { r.json({ error: e.message }); }
});

app.post('/scrape', async (q, r) => {
  const { platform, dateFrom, dateTo, credentials } = q.body;
  if (!platform || !dateFrom || !dateTo || !credentials) {
    return r.status(400).json({ error: 'Missing fields (platform, dateFrom, dateTo, credentials)' });
  }
  try {
    let result;
    switch (platform) {
      case 'elitecasino':   result = await ecOauth.scrape(credentials, dateFrom, dateTo, CHROME); break;
      case 'betmen':        result = await bm.scrape(credentials, dateFrom, dateTo, CHROME); break;
      case 'vpartners':     result = await vp.scrape(credentials, dateFrom, dateTo, CHROME); break;
      case 'starzpartners': result = await sp.scrape(credentials, dateFrom, dateTo, CHROME); break;
      default: return r.status(400).json({ error: 'Unknown or unsupported platform: ' + platform });
    }
    r.json({ success: true, headers: result.headers, rows: result.rows });
  } catch (e) {
    console.error('Scrape error:', e.message);
    r.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Running on ' + PORT + ' | Chrome: ' + CHROME));