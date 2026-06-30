const puppeteer = require('puppeteer-extra');
const S = require('puppeteer-extra-plugin-stealth');
puppeteer.use(S());

// ============================================================
// BETMEN AFFILIATES (Cellxpert / Angular SPA)
// URL: https://track.betmenaffiliates.com/v2/login   <-- FIXED (was /partner/login)
// Heavy Angular app - needs careful waiting + memory tuning
// ============================================================
async function scrape(c, df, dt, cp) {
  if (!cp) throw new Error('Chrome path required');
  const baseUrl = (c.baseUrl || 'https://track.betmenaffiliates.com').replace(/\/+$/, '');
  let br;
  try {
    br = await puppeteer.launch({
      headless: 'new',
      executablePath: cp,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-software-rasterizer', '--disable-extensions',
        '--disable-background-networking', '--disable-default-apps', '--disable-sync',
        '--disable-translate', '--metrics-recording-only', '--no-first-run',
        '--js-flags=--max-old-space-size=384',
        '--disable-features=site-per-process'
      ]
    });
    const p = await br.newPage();

    // Block only images/fonts/media. KEEP CSS + JS (Angular needs JS to boot!)
    await p.setRequestInterception(true);
    p.on('request', req => {
      const rt = req.resourceType();
      if (['image', 'font', 'media'].includes(rt)) req.abort();
      else req.continue();
    });

    await p.setViewport({ width: 1280, height: 800 });
    await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    console.log('  → Loading Betmen /v2/login ...');
    await p.goto(baseUrl + '/v2/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Wait for Angular to bootstrap and render inputs
    console.log('  → Waiting for Angular form...');
    const formFound = await waitForInputs(p, 15, 4000);

    if (!formFound) {
      console.log('  → Reloading once...');
      await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      const retry = await waitForInputs(p, 10, 4000);
      if (!retry) {
        const html = await p.content();
        console.log('  → HTML(400):', html.substring(0, 400));
        throw new Error('Betmen: Angular form did not render (likely Render free-plan memory limit). Consider upgrading to a paid instance or use cookie-injection.');
      }
    }

    console.log('  → Form found, filling credentials...');

    // Fill username/email (first non-password visible input)
    const userSel = await firstSelector(p, ['input[type="email"]', 'input[type="text"]', 'input[formcontrolname="username"]', 'input[name="username"]']);
    if (userSel) {
      await p.click(userSel, { clickCount: 3 });
      await p.type(userSel, c.username || c.email || '', { delay: 40 });
      // Fire Angular events
      await p.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); }
      }, userSel);
    }
    await new Promise(r => setTimeout(r, 400));

    const passSel = 'input[type="password"]';
    await p.click(passSel, { clickCount: 3 });
    await p.type(passSel, c.password || '', { delay: 40 });
    await p.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) { el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); }
    }, passSel);
    await new Promise(r => setTimeout(r, 800));

    // Submit
    console.log('  → Submitting...');
    const btn = await firstSelector(p, ['button[type="submit"]', 'button.btn-primary', 'button.mat-raised-button', 'button']);
    if (btn) await p.click(btn);
    else await p.keyboard.press('Enter');

    // Wait for URL to leave /login (Angular client-side routing - no nav event)
    let loggedIn = false;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 2500));
      if (!p.url().includes('/login')) { loggedIn = true; break; }
    }
    console.log('  → URL after login:', p.url());

    if (!loggedIn) {
      const err = await p.evaluate(() => {
        const e = document.querySelector('.error, .alert, .mat-error, [class*="error"]');
        return e ? e.innerText.trim().substring(0, 150) : '';
      });
      throw new Error('Betmen login failed. ' + (err ? 'Message: ' + err : 'Check credentials.'));
    }
    console.log('  ✅ Login OK');

    // Navigate to reports (Angular route). Common Cellxpert paths:
    const reportPaths = ['/v2/reports/media', '/v2/reports', '/partner/reports/media', '/v2/statistics'];
    let dataFound = false, data = null;
    for (const rp of reportPaths) {
      try {
        console.log('  → Trying report path:', rp);
        await p.goto(baseUrl + rp, { waitUntil: 'domcontentloaded', timeout: 30000 });
        // wait for a table to render
        const hasTable = await waitForTable(p, 8, 2500);
        if (hasTable) {
          data = await extractTable(p);
          if (data && data.rows.length) { dataFound = true; break; }
        }
      } catch (e) { /* try next */ }
    }

    if (!dataFound || !data) throw new Error('Betmen: logged in but no report table found. Report route may differ.');
    console.log('  ✅ Got', data.rows.length, 'rows');
    return data;
  } finally {
    if (br) await br.close();
  }
}

async function waitForInputs(p, attempts, delay) {
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, delay));
    const count = await p.evaluate(() => document.querySelectorAll('input').length);
    console.log('  → Attempt ' + (i + 1) + ': ' + count + ' inputs');
    if (count >= 2) return true;
  }
  return false;
}

async function waitForTable(p, attempts, delay) {
  for (let i = 0; i < attempts; i++) {
    const has = await p.evaluate(() => {
      const t = document.querySelector('table');
      return t && t.querySelectorAll('tr').length > 1;
    });
    if (has) return true;
    await new Promise(r => setTimeout(r, delay));
  }
  return false;
}

async function firstSelector(p, selectors) {
  for (const s of selectors) {
    if (await p.$(s)) return s;
  }
  return null;
}

async function extractTable(p) {
  return await p.evaluate(() => {
    const tables = document.querySelectorAll('table');
    if (!tables.length) return null;
    let best = tables[0];
    for (let i = 1; i < tables.length; i++) if (tables[i].rows.length > best.rows.length) best = tables[i];
    const h = [], r = [];
    (best.querySelector('thead tr') || best.querySelector('tr'))?.querySelectorAll('th,td').forEach(c => h.push(c.innerText.trim()));
    best.querySelectorAll('tbody tr').forEach(rr => {
      const cs = [];
      rr.querySelectorAll('td').forEach(c => cs.push(c.innerText.trim()));
      if (cs.length && cs[0] !== 'Total') r.push(cs);
    });
    return h.length && r.length ? { headers: h, rows: r } : null;
  });
}

module.exports = { scrape };