// ============================================================
// ELITE CASINO PARTNERS - OAuth2 (MyAffiliates client_credentials)
// NO browser, NO Puppeteer.
// Multi-brand CSV: detects brand sections (Wild Casino / Super Slots)
// and adds a "Brand" column so brand-dropdown filtering works.
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

  // Step 3: parse CSV WITH brand sections
  const parsed = parseMultiBrandCsv(csvText);
  if (!parsed.headers.length || !parsed.rows.length) throw new Error('Elite Casino: CSV empty for ' + df + ' to ' + dt);
  console.log('  OK Got', parsed.rows.length, 'rows across', parsed.brandCount, 'brands');

  // Bada range (>45 din) => month-wise summary (per brand)
  if (spanDays(df, dt) > 45) {
    const dateIdx = parsed.headers.findIndex(h => /date|day|month|period/i.test(String(h)));
    const brandIdx = parsed.headers.findIndex(h => /^brand$/i.test(String(h)));
    if (dateIdx >= 0) {
      const g = groupRowsByMonth(parsed.headers, parsed.rows, dateIdx, brandIdx);
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
// MULTI-BRAND CSV PARSER
// CSV structure (Elite Casino):
//   <Brand Name line OR "X pay period" line>
//   Date,Impressions,Clicks,Signups,FTD,FTD Amount,...   <- header
//   2026-06-30,0,8,1,0,0,...                              <- data
//   (blank)
//   <next Brand line>
//   Date,...  <- header again
//   ...data...
// We detect each brand section and prepend a "Brand" column to every data row.
// ============================================================
function parseMultiBrandCsv(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  // Split into raw CSV records (quote-aware)
  const records = parseCsvRecords(text);
  if (!records.length) return { headers: [], rows: [], brandCount: 0 };

  let headers = null;         // final headers (with "Brand" prepended)
  let baseHeaders = null;     // detected data headers (Date, Clicks, ...)
  let currentBrand = '';      // brand for current section
  const outRows = [];
  const brandSet = {};

  // Helper: is this record a header row? (first cell looks like "Date"/"Day")
  function isHeaderRecord(rec) {
    const first = String(rec[0] || '').trim().toLowerCase();
    return first === 'date' || first === 'day' || first === 'datum' || first === 'period';
  }
  // Helper: is this a brand/title line? (single non-empty cell, not a date, not a number)
  function isBrandLine(rec) {
    const nonEmpty = rec.filter(c => c && c.trim().length);
    if (nonEmpty.length !== 1) return false;
    const val = nonEmpty[0].trim();
    if (/^\d/.test(val)) return false;                 // starts with number -> not a brand
    if (isHeaderRecordVal(val)) return false;
    return true;
  }
  function isHeaderRecordVal(v) {
    const s = String(v).trim().toLowerCase();
    return s === 'date' || s === 'day' || s === 'datum' || s === 'period';
  }
  // Helper: is this a "total" summary row?
  function isTotalRow(rec) {
    const first = String(rec[0] || '').trim().toLowerCase();
    return first === 'total' || first === 'totals' || first === 'summary';
  }

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec.some(c => c && c.trim().length)) continue; // skip blank

    if (isHeaderRecord(rec)) {
      baseHeaders = rec.map(h => h.trim());
      if (!headers) headers = ['Brand'].concat(baseHeaders);
      continue;
    }

    if (isBrandLine(rec)) {
      // Brand name — may be "Wild Casino" or "Wild Casino pay period : 01/07/2026"
      let bname = rec.filter(c => c && c.trim().length)[0].trim();
      // strip "pay period..." suffix if present
      bname = bname.replace(/\s*pay period.*$/i, '').replace(/\s*:.*$/, '').trim();
      currentBrand = bname;
      continue;
    }

    if (isTotalRow(rec)) continue; // skip totals

    // Data row — only if we have headers
    if (baseHeaders) {
      const cells = baseHeaders.map((h, idx) => (rec[idx] !== undefined ? String(rec[idx]).trim() : ''));
      // skip if entire data row empty
      if (!cells.some(c => c.length)) continue;
      // skip if first cell empty (section subtotal row with blank date)
      if (!cells[0]) continue;
      outRows.push([currentBrand].concat(cells));
      if (currentBrand) brandSet[currentBrand] = true;
    }
  }

  if (!headers) return { headers: [], rows: [], brandCount: 0 };
  return { headers: headers, rows: outRows, brandCount: Object.keys(brandSet).length };
}

// Quote-aware CSV -> array of records (each record = array of cells)
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

// ---- month grouping (brand-aware) ----
function groupRowsByMonth(headers, rows, dateIdx, brandIdx) {
  const rateIdxs = new Set();
  headers.forEach((h, i) => { if (i !== dateIdx && i !== brandIdx && /(^cr$|rate|ratio|percent|%|avg|average|conversion)/i.test(String(h))) rateIdxs.add(i); });
  const buckets = {}; let order = 0;
  rows.forEach(row => {
    const dnum = ymdNum(String(row[dateIdx] || '').replace(/^'/, '').trim());
    if (!dnum) return;
    const brand = brandIdx >= 0 ? String(row[brandIdx] || '') : '';
    const mk = brand + '||' + dnum.substring(0, 4) + '-' + dnum.substring(4, 6);
    if (!buckets[mk]) { buckets[mk] = { sums: {}, cnt: {}, order: order++, brand: brand, month: dnum.substring(0, 4) + '-' + dnum.substring(4, 6) }; headers.forEach((h, i) => { if (i !== dateIdx && i !== brandIdx) { buckets[mk].sums[i] = 0; buckets[mk].cnt[i] = 0; } }); }
    const b = buckets[mk];
    headers.forEach((h, i) => { if (i === dateIdx || i === brandIdx) return; const num = parseFloat(String(row[i]).replace(/[$€£,%]/g, '')); if (!isNaN(num)) { b.sums[i] += num; b.cnt[i] += 1; } });
  });
  const mks = Object.keys(buckets).sort((a, b) => buckets[a].order - buckets[b].order);
  const outRows = mks.map(mk => {
    const b = buckets[mk];
    return headers.map((h, i) => {
      if (i === dateIdx) return "'" + b.month;
      if (i === brandIdx) return b.brand;
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