const puppeteer = require('puppeteer-extra');
const S = require('puppeteer-extra-plugin-stealth');
puppeteer.use(S());

// ============================================================
// ELITE CASINO PARTNERS (MyAffiliates platform)
// URL: https://affiliates.elitecasinopartners.ag
// Plain PHP login form (signin.php) - NO CAPTCHA
// ============================================================
async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://affiliates.elitecasinopartners.ag').replace(/\/+$/, '');
  let br;
  try {
    br = await puppeteer.launch({
      headless: 'new',
      executablePath: cp,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions',
        '--disable-background-networking', '--disable-default-apps', '--disable-sync',
        '--no-first-run', '--js-flags=--max-old-space-size=256',
        '--disable-features=site-per-process'
      ]
    });
    const p = await br.newPage();

    // Block heavy assets to save memory on free plan
    await p.setRequestInterception(true);
    p.on('request', req => {
      const rt = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(rt)) req.abort();
      else req.continue();
    });

    await p.setViewport({ width: 1280, height: 800 });
    await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    console.log('  → Loading Elite Casino login...');
    await p.goto(base + '/signin.php', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2000));

    // Find username field (multiple possible selectors)
    console.log('  → Looking for login form...');
    let userSel = null;
    for (const s of ['input[name="username"]', 'input[name="user"]', 'input[type="text"]', 'input[type="email"]']) {
      if (await p.$(s)) { userSel = s; break; }
    }
    if (!userSel) {
      const html = await p.content();
      console.log('  → No username field. HTML(300):', html.substring(0, 300));
      throw new Error('Elite Casino: login form not found');
    }

    console.log('  → Filling credentials...');
    await p.click(userSel, { clickCount: 3 });
    await p.type(userSel, c.username || '', { delay: 40 });
    await new Promise(r => setTimeout(r, 400));

    const passSel = 'input[type="password"]';
    await p.waitForSelector(passSel, { timeout: 10000 });
    await p.click(passSel, { clickCount: 3 });
    await p.type(passSel, c.password || '', { delay: 40 });
    await new Promise(r => setTimeout(r, 600));

    // Submit - try button, then submit input, then Enter
    console.log('  → Submitting...');
    const submitBtn = await p.$('input[type="submit"], button[type="submit"], input[value="Login"], button.btn');
    try {
      await Promise.all([
        p.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
        submitBtn ? submitBtn.click() : p.keyboard.press('Enter')
      ]);
    } catch (e) {
      // Maybe no navigation event - try form submit
      await p.evaluate(() => { const f = document.querySelector('form'); if (f) f.submit(); });
      await new Promise(r => setTimeout(r, 5000));
    }

    await new Promise(r => setTimeout(r, 3000));
    const url = p.url();
    console.log('  → URL after login:', url);

    if (url.includes('signin') || url.includes('login')) {
      const txt = await p.evaluate(() => document.body.innerText.substring(0, 300));
      throw new Error('Elite Casino login failed. Check username/password. Page: ' + txt.substring(0, 150));
    }
    console.log('  ✅ Login OK');

    // Build date-range statistics URL (MyAffiliates standard: statistics.php?d1=&d2=&sd=1&sbm=1)
    const sd = new Date(df + 'T00:00:00'), ed = new Date(dt + 'T00:00:00');
    const ds = Math.ceil((ed - sd) / 864e5) + 1;

    let ah = null, ar = [];
    if (ds <= 35) {
      const r = await fetchReport(p, base, df, dt, true);
      ah = r.headers; ar = r.rows;
    } else {
      // Multi-month: fetch month by month
      let cs = new Date(sd);
      while (cs <= ed) {
        let ce = new Date(cs.getFullYear(), cs.getMonth() + 1, 0);
        if (ce > ed) ce = new Date(ed);
        const r = await fetchReport(p, base, fmt(cs), fmt(ce), false);
        if (!ah && r.headers) ah = r.headers;
        ar = ar.concat(r.rows);
        cs = new Date(cs.getFullYear(), cs.getMonth() + 1, 1);
      }
    }

    // Dedupe consecutive identical rows
    const dd = [];
    ar.forEach(r => {
      if (dd.length > 0) {
        const l = dd[dd.length - 1];
        if (r.length === l.length && r.every((c, i) => c === l[i])) return;
      }
      dd.push(r);
    });

    if (!ah || dd.length === 0) throw new Error('Elite Casino: no report data found');
    console.log('  ✅ Got', dd.length, 'rows');
    return { headers: ah, rows: dd };
  } finally {
    if (br) await br.close();
  }
}

async function fetchReport(p, base, df, dt, showDaily) {
  const reportUrl = base + '/statistics.php?d1=' + df + '&d2=' + dt + (showDaily ? '&sd=1' : '') + '&sbm=1';
  console.log('  → Fetching report:', reportUrl);
  await p.goto(reportUrl, { waitUntil: 'networkidle2', timeout: 30000 });

  try { await p.waitForSelector('table', { timeout: 15000 }); }
  catch (e) { await new Promise(r => setTimeout(r, 5000)); }

  const d = await p.evaluate(() => {
    const ts = document.querySelectorAll('table');
    if (!ts.length) return null;
    let bt = ts[0];
    for (let i = 1; i < ts.length; i++) if (ts[i].rows.length > bt.rows.length) bt = ts[i];
    const h = [], r = [];
    (bt.querySelector('thead tr') || bt.querySelector('tr'))?.querySelectorAll('th,td').forEach(c => h.push(c.innerText.trim()));
    const ar = bt.querySelectorAll('tbody tr');
    const rows = ar.length ? ar : bt.querySelectorAll('tr');
    rows.forEach((rr, idx) => {
      if (!ar.length && idx === 0) return; // skip header row if no tbody
      const cs = [];
      rr.querySelectorAll('td').forEach(c => cs.push(c.innerText.trim()));
      if (cs.length && cs[0] !== 'Total') r.push(cs);
    });
    return h.length ? { headers: h, rows: r } : null;
  });

  if (!d) return { headers: null, rows: [] };
  const hasDate = d.headers.some(h => h.toLowerCase().includes('date'));
  let f = d.rows.filter(r => hasDate ? (r[0] || '').trim().length > 0 : true);
  if (!hasDate) { d.headers.unshift('Date'); f = f.map(r => [df, ...r]); }
  return { headers: d.headers, rows: f };
}

function fmt(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

module.exports = { scrape };