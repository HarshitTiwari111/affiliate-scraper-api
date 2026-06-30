const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
app.use(express.json());

const ecOauth = require('./scrapers/elitecasino-oauth'); // Elite Casino OAuth (no browser)
const bm = require('./scrapers/cellxpert');              // Betmen (Puppeteer) lives in cellxpert.js
const vp = require('./scrapers/vpartners');              // V.Partners remote-stats (no browser)

app.get('/', (q, r) => r.json({ status: 'ok', scrapers: ['elitecasino', 'betmen', 'vpartners'] }));
app.get('/health', (q, r) => r.json({ status: 'ok', chrome: CHROME }));

app.get('/myip', async (q, r) => {
  try {
    const resp = await fetch('https://api.ipify.org?format=json');
    const data = await resp.json();
    r.json({ ip: data.ip });
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
      case 'elitecasino': result = await ecOauth.scrape(credentials, dateFrom, dateTo, CHROME); break;
      case 'betmen':      result = await bm.scrape(credentials, dateFrom, dateTo, CHROME); break;
      case 'vpartners':   result = await vp.scrape(credentials, dateFrom, dateTo, CHROME); break;
      default: return r.status(400).json({ error: 'Unknown or unsupported platform: ' + platform });
    }
    r.json({ success: true, headers: result.headers, rows: result.rows });
  } catch (e) {
    console.error('Scrape error:', e.message);
    r.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Running on ' + PORT + ' | Chrome: ' + CHROME));