// ============================================================
// BETMEN AFFILIATES — Cellxpert API (API key)
// Response: XML <ResultSet><row>...</row></ResultSet> (content-type text/html)
// Columns: Day, Brand, Impressions, Visitors, Unique_Visitors,
//          Registrations, QFTD, Deposits, Commission
//
// Credentials from Code.gs fetchViaPuppeteer:
//   c.affiliateId -> Col C  (36451)
//   c.apiKey      -> Col J  (Access Key)
//   c.baseUrl     -> default https://track.betmenaffiliates.com
//   c.report      -> mediareport (default)
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://track.betmenaffiliates.com').replace(/\/+$/, '');
  const affiliateId = String(c.affiliateId || c.username || '').trim();
  const apiKey = String(c.apiKey || c.password || '').trim();
  const command = (c.report || 'mediareport').toLowerCase();

  if (!affiliateId) throw new Error('Betmen: affiliateId missing (Col C).');
  if (!apiKey) throw new Error('Betmen: API key missing (Col J).');

  console.log('  -> Betmen affId=' + affiliateId + ' keyLen=' + apiKey.length);

  const authStyles = [
    { 'affiliateid': affiliateId, 'x-api-key': apiKey },
    { 'affiliateid': affiliateId, 'apikey': apiKey },
    { 'affiliateid': affiliateId, 'accesskey': apiKey },
    { 'affiliateid': affiliateId, 'Authorization': apiKey },
    { 'affiliateid': affiliateId, 'Authorization': 'Bearer ' + apiKey }
  ];

  const chunks = splitRange(df, dt, 31);
  let allRows = [];
  let headerNames = null;
  let workingStyle = null;
  let lastErr = '';
  let rawSample = '';

  for (const [cf, ct] of chunks) {
    let chunkDone = false;
    const stylesToTry = workingStyle ? [workingStyle] : authStyles;

    for (const style of stylesToTry) {
      const headers = { 'Accept': 'application/xml', 'User-Agent': 'Mozilla/5.0' };
      for (const k in style) headers[k] = style[k];

      // Breakdown params — Col H se 'breakdown' key, ya default Day+Brand+Country
      const bd = (c.breakdown || 'day,brand,country').toLowerCase();
      let bdParams = '';
      if (bd.indexOf('day') >= 0) bdParams += '&Day=1';
      if (bd.indexOf('brand') >= 0) bdParams += '&Brand=1';
      if (bd.indexOf('country') >= 0) bdParams += '&Country=1';
      if (bd.indexOf('media') >= 0) bdParams += '&Media=1';

      const url = base + '/api/'
        + '?command=' + encodeURIComponent(command)
        + '&fromdate=' + encodeURIComponent(cf)
        + '&todate=' + encodeURIComponent(ct)
        + bdParams;

      let resp, body;
      try {
        resp = await fetch(url, { method: 'GET', headers });
        body = await resp.text();
      } catch (e) { lastErr = 'network: ' + e.message; continue; }

      const trimmed = body.trim();
      const low = trimmed.toLowerCase();

      // Auth failure — chhote error responses
      if (trimmed.length < 200 &&
        (low.indexOf('bad authentication') >= 0 || low.indexOf('authentication key') >= 0
          || low.indexOf('not authenticated') >= 0 || low.indexOf('access denied') >= 0)) {
        lastErr = trimmed.substring(0, 120);
        const uh = Object.keys(style).find(k => k !== 'affiliateid') || '?';
        console.log('  -> auth fail [' + uh + ']: ' + lastErr);
        continue;
      }
      if (trimmed.length < 200 && low.indexOf('ip not authenticated') >= 0) {
        const ipm = trimmed.match(/(\d+\.\d+\.\d+\.\d+)/);
        throw new Error('Betmen IP block: ' + (ipm ? ipm[1] : '?') + ' — /myip se IP whitelist karo.');
      }
      if (!resp.ok) { lastErr = 'HTTP ' + resp.status + ': ' + trimmed.substring(0, 120); continue; }

      if (!rawSample) rawSample = trimmed.substring(0, 300);

      // ── Parse <row>...</row> blocks ──
      const parsedRows = parseResultSet(trimmed);
      const uh = Object.keys(style).find(k => k !== 'affiliateid') || '?';
      console.log('  -> Betmen OK [' + uh + '], ' + parsedRows.length + ' rows for ' + cf);
      workingStyle = style;
      parsedRows.forEach(o => { if (!headerNames) headerNames = Object.keys(o); allRows.push(o); });
      chunkDone = true;
      break;
    }

    if (!chunkDone && !workingStyle) {
      throw new Error('Betmen: auth fail. ID (' + affiliateId + ') aur key same account ke hone chahiye. Last: "' + lastErr + '"');
    }
  }

  if (!allRows.length || !headerNames) {
    throw new Error('Betmen: auth OK par ' + df + ' to ' + dt + ' me row parse nahi hui. RAW: "' + escapeCtrl(rawSample) + '"');
  }

  // Column order fix — Day pehle, phir baaki
  const preferredOrder = ['Day', 'Brand', 'Country', 'Impressions', 'Visitors', 'Unique_Visitors', 'Registrations', 'QFTD', 'Deposits', 'Commission'];
  let keys = [];
  preferredOrder.forEach(k => { if (headerNames.indexOf(k) >= 0) keys.push(k); });
  headerNames.forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }); // baaki jo bache
  allRows.forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));

  const dateIdx = keys.findIndex(k => /^day$|date/i.test(k));

  const headerLabels = keys.map(prettyLabel);
  const rows = allRows.map(o => keys.map((k, idx) => {
    let v = o[k];
    if (v === null || v === undefined) return '';
    v = String(v);
    if (idx === dateIdx) { const norm = normalizeDate(v); if (norm) v = "'" + norm; }
    return v;
  }));

  console.log('  -> Betmen', rows.length, 'rows (xml)');
  return { headers: headerLabels, rows };
}

// ============================================================
// Parse <ResultSet><row><Tag>val</Tag>...</row></ResultSet>
// ============================================================
function parseResultSet(xml) {
  const rows = [];
  // Har <row>...</row> block nikaalo
  const rowRe = /<row>([\s\S]*?)<\/row>/gi;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const inner = rm[1];
    const obj = {};
    // Har <Tag>value</Tag> nikaalo
    const tagRe = /<([A-Za-z_][\w]*)>([\s\S]*?)<\/\1>/g;
    let tm;
    while ((tm = tagRe.exec(inner)) !== null) {
      const tag = tm[1];
      let val = tm[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      obj[tag] = val;
    }
    if (Object.keys(obj).length) rows.push(obj);
  }
  return rows;
}

function escapeCtrl(s) {
  return String(s).split('').map(ch => { const c = ch.charCodeAt(0); return c < 32 ? '[' + c + ']' : ch; }).join('');
}

function splitRange(df, dt, maxDays) {
  const out = [];
  let start = new Date(df + 'T00:00:00Z');
  const end = new Date(dt + 'T00:00:00Z');
  while (start <= end) {
    let chunkEnd = new Date(start);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxDays - 1);
    if (chunkEnd > end) chunkEnd = new Date(end);
    out.push([ymd(start), ymd(chunkEnd)]);
    start = new Date(chunkEnd); start.setUTCDate(start.getUTCDate() + 1);
  }
  return out.length ? out : [[df, dt]];
}

function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function normalizeDate(s) {
  s = String(s).trim(); let m;
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (d > 12) return y + '-' + pad(mo) + '-' + pad(d); if (mo > 12) return y + '-' + pad(d) + '-' + pad(mo); return y + '-' + pad(mo) + '-' + pad(d); }
  return null;
}
function pad(n) { return String(n).padStart(2, '0'); }
function prettyLabel(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

module.exports = { scrape };