// ============================================================
// ELITE CASINO PARTNERS - OAuth2 (MyAffiliates client_credentials)
// Built per official "OAuth How-to" docs. NO browser, NO Puppeteer.
//
// Flow:
//   1. POST client_id + client_secret + grant_type + scope -> /oauth/access_token
//   2. GET with Bearer token -> /statistics.php?...&mode=csv&dnl=1  (returns CSV)
//   3. Parse CSV -> { headers, rows }
//
// Credentials (Dashboards sheet):
//   c.clientId / c.username     -> Client identifier (Col C)
//   c.clientSecret / c.password -> Client secret     (Col J)
//   c.baseUrl                   -> https://affiliates.elitecasinopartners.ag (Col H baseUrl:...)
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://affiliates.elitecasinopartners.ag').replace(/\/+$/, '');
  const clientId = c.clientId || c.username;
  const clientSecret = c.clientSecret || c.password;

  if (!clientId || !clientSecret) {
    throw new Error('Elite Casino OAuth: clientId / clientSecret missing.');
  }

  // ---- Step 1: Get access token (POST form-encoded) ----
  console.log('  -> Requesting OAuth access_token...');
  const tokenBody = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'r_user_stats'
  }).toString();

  let token;
  try {
    const tr = await fetch(base + '/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: tokenBody
    });
    const tText = await tr.text();
    if (!tr.ok) throw new Error('Token request failed (' + tr.status + '): ' + tText.substring(0, 250));
    const tJson = JSON.parse(tText);
    token = tJson.access_token;
    if (!token) throw new Error('No access_token in response: ' + tText.substring(0, 250));
    console.log('  OK Got access token (expires in ' + (tJson.expires_in || '?') + 's)');
  } catch (e) {
    throw new Error('Elite Casino OAuth token error: ' + e.message);
  }

  // ---- Step 2: Download statistics as CSV ----
  // Docs curl uses only the Bearer header (no -d / no -X) => GET request.
  const sd = new Date(df + 'T00:00:00'), ed = new Date(dt + 'T00:00:00');
  const daySpan = Math.ceil((ed - sd) / 864e5) + 1;
  const showDaily = daySpan <= 366 ? 1 : 0;

  // Param order matches the docs example exactly: d1, d2, sd, mode, sbm, dnl
  const statsUrl = base + '/statistics.php'
    + '?d1=' + encodeURIComponent(df)
    + '&d2=' + encodeURIComponent(dt)
    + '&sd=' + showDaily
    + '&mode=csv'
    + '&sbm=1'
    + '&dnl=1';

  console.log('  -> Downloading statistics (GET):', statsUrl);
  let csvText = await tryStats(statsUrl, token, 'GET');

  // Fallback: if GET gave a 400, retry as POST (some installs differ)
  if (csvText.__error && csvText.status === 400) {
    console.log('  -> GET returned 400, retrying as POST...');
    csvText = await tryStats(statsUrl, token, 'POST');
  }

  if (csvText.__error) {
    throw new Error('Stats download failed (' + csvText.status + '): ' + (csvText.body || '').substring(0, 300));
  }

  // If we got an HTML login page instead of CSV, token/scope problem
  if (/<html|<!doctype/i.test(csvText.substring(0, 200))) {
    throw new Error('Elite Casino: got HTML instead of CSV - token rejected or scope insufficient.');
  }

  // ---- Step 3: Parse CSV -> { headers, rows } ----
  const parsed = parseCsv(csvText);
  if (!parsed.headers.length || !parsed.rows.length) {
    throw new Error('Elite Casino: CSV empty for ' + df + ' to ' + dt);
  }
  console.log('  OK Got', parsed.rows.length, 'rows');
  return parsed;
}

async function tryStats(url, token, method) {
  const resp = await fetch(url, {
    method,
    headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'text/csv' }
  });
  const body = await resp.text();
  if (!resp.ok) return { __error: true, status: resp.status, body };
  return body;
}

// Minimal RFC-4180-ish CSV parser (handles quoted fields, commas, newlines)
function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const records = [];
  let field = '', row = [], inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); records.push(row); field = ''; row = []; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); records.push(row); }

  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map(h => h.trim());
  let rows = records.slice(1).filter(r => r.some(c => c && c.trim().length));
  rows = rows.filter(r => (r[0] || '').trim().toLowerCase() !== 'total');

  return { headers, rows };
}

module.exports = { scrape };