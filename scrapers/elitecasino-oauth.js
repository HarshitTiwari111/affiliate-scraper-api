// ============================================================
// ELITE CASINO PARTNERS - OAuth2 (MyAffiliates client_credentials)
// NO browser, NO Puppeteer.
// Fix: This Year => month-wise summary.
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://affiliates.elitecasinopartners.ag').replace(/\/+$/, '');
  const clientId = c.clientId || c.username;
  const clientSecret = c.clientSecret || c.password;
  if (!clientId || !clientSecret) throw new Error('Elite Casino OAuth: clientId / clientSecret missing.');

  // Step 1: access token
  console.log('  -> Requesting OAuth access_token...');
  const tokenBody = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'r_user_stats' }).toString();
  let token;
  try {
    const tr = await fetch(base + '/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: tokenBody });
    const tText = await tr.text();
    if (!tr.ok) throw new Error('Token request failed (' + tr.status + '): ' + tText.substring(0, 250));
    const tJson = JSON.parse(tText);
    token = tJson.access_token;
    if (!token) throw new Error('No access_token in response: ' + tText.substring(0, 250));
    console.log('  OK Got access token (expires in ' + (tJson.expires_in || '?') + 's)');
  } catch (e) { throw new Error('Elite Casino OAuth token error: ' + e.message); }

  // Step 2: stats CSV
  const sd = new Date(df + 'T00:00:00'), ed = new Date(dt + 'T00:00:00');
  const daySpan = Math.ceil((ed - sd) / 864e5) + 1;
  const showDaily = daySpan <= 366 ? 1 : 0;

  const statsUrl = base + '/statistics.php'
    + '?d1=' + encodeURIComponent(df) + '&d2=' + encodeURIComponent(dt)
    + '&sd=' + showDaily + '&mode=csv' + '&sbm=1' + '&dnl=1';

  console.log('  -> Downloading statistics (GET):', statsUrl);
  let csvText = await tryStats(statsUrl, token, 'GET');
  if (csvText.__error && csvText.status === 400) { console.log('  -> GET 400, retrying POST...'); csvText = await tryStats(statsUrl, token, 'POST'); }
  if (csvText.__error) throw new Error('Stats download failed (' + csvText.status + '): ' + (csvText.body || '').substring(0, 300));
  if (/<html|<!doctype/i.test(csvText.substring(0, 200))) throw new Error('Elite Casino: got HTML instead of CSV - token rejected or scope insufficient.');

  // Step 3: parse CSV
  const parsed = parseCsv(csvText);
  if (!parsed.headers.length || !parsed.rows.length) throw new Error('Elite Casino: CSV empty for ' + df + ' to ' + dt);
  console.log('  OK Got', parsed.rows.length, 'rows');

  // Bada range (>45 din) => month-wise summary
  if (spanDays(df, dt) > 45) {
    const dateIdx = parsed.headers.findIndex(h => /date|day|month|period/i.test(String(h)));
    if (dateIdx >= 0) {
      const g = groupRowsByMonth(parsed.headers, parsed.rows, dateIdx);
      parsed.rows = g.rows;
      console.log('  OK Grouped into', parsed.rows.length, 'months');
    }
  }

  return parsed;
}

async function tryStats(url, token, method) {
  const resp = await fetch(url, { method, headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'text/csv' } });
  const body = await resp.text();
  if (!resp.ok) return { __error: true, status: resp.status, body };
  return body;
}

function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const records = []; let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) { if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += ch; }
    else { if (ch === '"') inQuotes = true; else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); records.push(row); field = ''; row = []; } else field += ch; }
  }
  if (field.length || row.length) { row.push(field); records.push(row); }
  if (!records.length) return { headers: [], rows: [] };
  const headers = records[0].map(h => h.trim());
  let rows = records.slice(1).filter(r => r.some(c => c && c.trim().length));
  rows = rows.filter(r => (r[0] || '').trim().toLowerCase() !== 'total');
  return { headers, rows };
}

// ---- month grouping (self-contained) ----
function groupRowsByMonth(headers, rows, dateIdx) {
  const rateIdxs = new Set();
  headers.forEach((h, i) => { if (i !== dateIdx && /(^cr$|rate|ratio|percent|%|avg|average|conversion)/i.test(String(h))) rateIdxs.add(i); });
  const buckets = {}; let order = 0;
  rows.forEach(row => {
    const dnum = ymdNum(String(row[dateIdx] || '').replace(/^'/, '').trim());
    if (!dnum) return;
    const mk = dnum.substring(0, 4) + '-' + dnum.substring(4, 6);
    if (!buckets[mk]) { buckets[mk] = { sums: {}, cnt: {}, order: order++ }; headers.forEach((h, i) => { if (i !== dateIdx) { buckets[mk].sums[i] = 0; buckets[mk].cnt[i] = 0; } }); }
    const b = buckets[mk];
    headers.forEach((h, i) => { if (i === dateIdx) return; const num = parseFloat(String(row[i]).replace(/[$€£,%]/g, '')); if (!isNaN(num)) { b.sums[i] += num; b.cnt[i] += 1; } });
  });
  const mks = Object.keys(buckets).sort((a, b) => buckets[a].order - buckets[b].order);
  const outRows = mks.map(mk => {
    const b = buckets[mk];
    return headers.map((h, i) => {
      if (i === dateIdx) return "'" + mk;
      let val = rateIdxs.has(i) ? (b.cnt[i] > 0 ? b.sums[i] / b.cnt[i] : 0) : b.sums[i];
      val = Math.round(val * 100) / 100; if (val % 1 === 0) val = Math.round(val);
      return String(val);
    });
  });
  return { headers, rows: outRows };
}
function spanDays(df, dt) { const d1 = new Date(df + 'T00:00:00Z'), d2 = new Date(dt + 'T00:00:00Z'); return Math.round((d2 - d1) / 86400000) + 1; }
function ymdNum(s) { s = String(s).trim(); let m; m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + pad(m[2]) + pad(m[3]); m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/); if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (d > 12) return y + pad(mo) + pad(d); if (mo > 12) return y + pad(d) + pad(mo); return y + pad(mo) + pad(d); } return null; }
function pad(n) { return String(n).padStart(2, '0'); }

module.exports = { scrape };