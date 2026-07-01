// ============================================================
// ELITE CASINO PARTNERS - OAuth2 (MyAffiliates client_credentials)
// NO browser, NO Puppeteer.
// CSV already has a "Channel" column (Wild Casino / Super Slots / etc)
// in every row — so channel-dropdown filtering works directly.
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

  // Step 3: parse CSV — Channel column is already inside every row.
  // CSV has REPEATED header rows (one per channel block), so we skip any
  // row whose first cell is "Date" (that's a header, not data).
  const parsed = parseCsvSkipRepeatHeaders(csvText);
  if (!parsed.headers.length || !parsed.rows.length) throw new Error('Elite Casino: CSV empty for ' + df + ' to ' + dt);
  console.log('  OK Got', parsed.rows.length, 'rows');

  // Bada range (>45 din) => month-wise summary (channel-aware)
  if (spanDays(df, dt) > 45) {
    const dateIdx = parsed.headers.findIndex(h => /^date$|^day$|month|period/i.test(String(h)));
    const chIdx = parsed.headers.findIndex(h => /^channel$/i.test(String(h)));
    if (dateIdx >= 0) {
      const g = groupRowsByMonth(parsed.headers, parsed.rows, dateIdx, chIdx);
      parsed.rows = g.rows;
      console.log('  OK Grouped into', parsed.rows.length, 'month-rows');
    }
  }

  return { headers: parsed.headers, rows: parsed.rows };
}

async function tryStats(url, token, method) {
  const resp = await fetch(url, { method, headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'text/csv' } });
  const body = await resp.text();
  if (!resp.ok) return { __error: true, status: resp.status, body };
  return body;
}

// ============================================================
// CSV parser — handles REPEATED header rows.
// Structure:
//   Date,Channel,Pay period,...,Income   <- header
//   2026-06-30,Wild Casino,...           <- data
//   Date,Channel,Pay period,...,Income   <- header AGAIN (per channel)
//   2026-06-30,Super Slots,...           <- data
// We take headers from the FIRST header row, then skip any later row
// whose first cell == "Date" (repeat header) or first cell == "Total".
// ============================================================
function parseCsvSkipRepeatHeaders(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const records = parseCsvRecords(text);
  if (!records.length) return { headers: [], rows: [] };

  let headers = null;
  const rows = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec.some(c => c && c.trim().length)) continue; // blank

    const first = String(rec[0] || '').trim().toLowerCase();

    // Header row (first cell = Date/Day)
    if (first === 'date' || first === 'day' || first === 'datum' || first === 'period') {
      if (!headers) headers = rec.map(h => h.trim());
      continue; // skip all header rows (first one already captured)
    }

    // Total / summary row
    if (first === 'total' || first === 'totals' || first === 'summary') continue;

    // Data row
    if (headers) {
      const cells = headers.map((h, idx) => (rec[idx] !== undefined ? String(rec[idx]).trim() : ''));
      if (!cells.some(c => c.length)) continue;
      if (!cells[0]) continue; // empty date = subtotal
      rows.push(cells);
    }
  }

  return { headers: headers || [], rows: rows };
}

// Quote-aware CSV -> array of records
function parseCsvRecords(text) {
  const records = []; let field = '', row = [], inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); records.push(row); field = ''; row = []; }
      else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); records.push(row); }
  return records;
}

// ---- month grouping (channel-aware) ----
function groupRowsByMonth(headers, rows, dateIdx, chIdx) {
  const rateIdxs = new Set();
  headers.forEach((h, i) => { if (i !== dateIdx && i !== chIdx && /(^cr$|rate|ratio|percent|%|avg|average|conversion)/i.test(String(h))) rateIdxs.add(i); });
  const buckets = {}; let order = 0;
  rows.forEach(row => {
    const dnum = ymdNum(String(row[dateIdx] || '').replace(/^'/, '').trim());
    if (!dnum) return;
    const ch = chIdx >= 0 ? String(row[chIdx] || '') : '';
    const mk = ch + '||' + dnum.substring(0, 4) + '-' + dnum.substring(4, 6);
    if (!buckets[mk]) { buckets[mk] = { sums: {}, cnt: {}, order: order++, ch: ch, month: dnum.substring(0, 4) + '-' + dnum.substring(4, 6) }; headers.forEach((h, i) => { if (i !== dateIdx && i !== chIdx) { buckets[mk].sums[i] = 0; buckets[mk].cnt[i] = 0; } }); }
    const b = buckets[mk];
    headers.forEach((h, i) => { if (i === dateIdx || i === chIdx) return; const num = parseFloat(String(row[i]).replace(/[$€£,%]/g, '')); if (!isNaN(num)) { b.sums[i] += num; b.cnt[i] += 1; } });
  });
  const mks = Object.keys(buckets).sort((a, b) => buckets[a].order - buckets[b].order);
  const outRows = mks.map(mk => {
    const b = buckets[mk];
    return headers.map((h, i) => {
      if (i === dateIdx) return "'" + b.month;
      if (i === chIdx) return b.ch;
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