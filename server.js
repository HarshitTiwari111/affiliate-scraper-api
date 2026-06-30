const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
const CHROME = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
app.use(express.json());

// Only the two scrapers that can work without bypassing CAPTCHA/2FA
const ec = require('./scrapers/elitecasino');
const bm = require('./scrapers/betmen');

app.get('/', (q, r) => r.json({ status: 'ok', scrapers: ['elitecasino', 'betmen'] }));
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
      case 'elitecasino': result = await ec.scrape(credentials, dateFrom, dateTo, CHROME); break;
      case 'betmen':      result = await bm.scrape(credentials, dateFrom, dateTo, CHROME); break;
      default: return r.status(400).json({ error: 'Unknown or unsupported platform: ' + platform });
    }
    r.json({ success: true, headers: result.headers, rows: result.rows });
  } catch (e) {
    console.error('Scrape error:', e.message);
    r.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Running on ' + PORT + ' | Chrome: ' + CHROME));