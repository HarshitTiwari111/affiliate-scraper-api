// ============================================================
// BETMEN AFFILIATES — Cellxpert API (API key)
// Auto-tries multiple auth header styles + trims key.
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
  const apiKey = String(c.apiKey || c.password || '').trim(); // TRIM — hidden space hata do
  const command = (c.report || 'mediareport').toLowerCase();

  if (!affiliateId) throw new Error('Betmen: affiliateId missing (Col C).');
  if (!apiKey) throw new Error('Betmen: API key missing (Col J).');

  console.log('  -> Betmen affId=' + affiliateId + ' keyLen=' + apiKey.length);

  // Different header styles Cellxpert installs use — try each until one works
  const authStyles = [
    { 'affiliateid': affiliateId, 'x-api-key': apiKey },
    { 'affiliateid': affiliateId, 'apikey': apiKey },
    { 'affiliateid': affiliateId, 'accesskey': apiKey },
    { 'affiliateid': affiliateId, 'Authorization': apiKey },
    { 'affiliateid': affiliateId, 'Authorization': 'Bearer ' + apiKey },
    { 'affiliateid': affiliateId, 'api-key': apiKey },
    // key as query param instead of header
    { 'affiliateid': affiliateId, '__queryKey': apiKey }
  ];

  const chunks = splitRange(df, dt, 31);
  let allRows = [];
  let headerNames = null;
  let isXml = false;
  let workingStyle = null;
  let lastErr = '';

  for (const [cf, ct] of chunks) {
    let chunkDone = false;

    // Agar ek style pehle chunk me chal gayi, aage usi ko use karo
    const stylesToTry = workingStyle ? [workingStyle] : authStyles;

    for (const style of stylesToTry) {
      const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
      let url = base + '/api/'
        + '?command=' + encodeURIComponent(command)
        + '&fromdate=' + encodeURIComponent(cf)
        + '&todate=' + encodeURIComponent(ct)
        + '&Day=1&Brand=1&json=1';

      // Copy style into headers (except the special __queryKey)
      for (const k in style) {
        if (k === '__queryKey') url += '&apikey=' + encodeURIComponent(style[k]) + '&key=' + encodeURIComponent(style[k]);
        else headers[k] = style[k];
      }

      let resp, body;
      try {
        resp = await fetch(url, { method: 'GET', headers });
        body = await resp.text();
      } catch (e) { lastErr = 'network: ' + e.message; continue; }

      const trimmed = body.trim();
      const low = trimmed.toLowerCase();

      // Auth failure — is style ko chhod ke agli try karo
      if (low.indexOf('bad authentication') >= 0 || low.indexOf('authentication key') >= 0
          || low.indexOf('not authenticated') >= 0 || low.indexOf('access denied') >= 0
          || (low.indexOf('invalid') >= 0 && low.indexOf('key') >= 0)) {
        lastErr = trimmed.substring(0, 120);
        const usedHeader = Object.keys(style).find(k => k !== 'affiliateid') || 'query';
        console.log('  -> auth fail with [' + usedHeader + ']: ' + lastErr);
        continue;
      }
      if (low.indexOf('ip not authenticated') >= 0) {
        const ipm = trimmed.match(/(\d+\.\d+\.\d+\.\d+)/);
        throw new Error('Betmen IP block: ' + (ipm ? ipm[1] : '?') + ' — /myip se IP le ke Betmen panel me whitelist karo.');
      }
      if (!resp.ok) { lastErr = 'HTTP ' + resp.status + ': ' + trimmed.substring(0, 120); continue; }

      // ── Success — parse ──
      let parsedRows = [];
      if (trimmed.startsWith('<')) {
        isXml = true;
        parsedRows = parseXmlRows(trimmed);
      } else {
        let data;
        try { data = JSON.parse(body); }
        catch (e) { lastErr = 'not JSON/XML: ' + trimmed.substring(0, 120); continue; }
        parsedRows = extractJsonRows(data);
      }

      // Parse hua (khaali bhi ho sakta hai — wo valid hai)
      const usedHeader = Object.keys(style).find(k => k !== 'affiliateid') || 'query';
      console.log('  -> Betmen OK via [' + usedHeader + '], ' + parsedRows.length + ' rows for ' + cf);
      workingStyle = style; // aage isi ko use karo
      parsedRows.forEach(o => { if (!headerNames) headerNames = Object.keys(o); allRows.push(o); });
      chunkDone = true;
      break;
    }

    if (!chunkDone && !workingStyle) {
      // Koi bhi auth style kaam nahi kari
      throw new Error('Betmen: koi auth style kaam nahi kari. '
        + 'ID (' + affiliateId + ') aur key (Col J) same Betmen account ke hone chahiye. '
        + 'Last server response: "' + lastErr + '"');
    }
  }

  if (!allRows.length || !headerNames) {
    // Auth chal gaya par data khaali — ye error nahi, bas is range me data nahi
    throw new Error('Betmen: auth OK par ' + df + ' to ' + dt + ' me koi data nahi (command: ' + command + '). Dusra date range try kar.');
  }

  const keys = headerNames.slice();
  allRows.forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));
  const dateIdx = keys.findIndex(k => /date|day/i.test(k));

  const headerLabels = keys.map(prettyLabel);
  const rows = allRows.map(o => keys.map((k, idx) => {
    let v = o[k];
    if (v === null || v === undefined) return '';
    v = String(v);
    if (idx === dateIdx) { const norm = normalizeDate(v); if (norm) v = "'" + norm; }
    return v;
  }));

  console.log('  -> Betmen', rows.length, 'rows (' + (isXml ? 'xml' : 'json') + ')');
  return { headers: headerLabels, rows };
}

// ---- helpers ----
function extractJsonRows(data) {
  if (Array.isArray(data)) return data;
  const candidates = ['data', 'rows', 'records', 'report', 'results', 'items', 'mediareport', 'commissions'];
  for (const key of candidates) {
    if (data[key]) {
      if (Array.isArray(data[key])) return data[key];
      if (typeof data[key] === 'object') {
        for (const k2 of candidates) { if (Array.isArray(data[key][k2])) return data[key][k2]; }
      }
    }
  }
  if (typeof data === 'object') {
    const vals = Object.values(data).filter(v => v && typeof v === 'object');
    if (vals.length && vals.every(v => !Array.isArray(v))) return vals;
  }
  return [];
}

function parseXmlRows(xml) {
  const rows = [];
  const tagMatch = xml.match(/<(\w+)>\s*<(\w+)>/);
  let rowTag = null;
  if (tagMatch) rowTag = tagMatch[2];
  if (!rowTag) {
    const m = xml.match(/<(\w+)>[^<]*<\w+>/g);
    if (m && m.length) { const t = m[0].match(/<(\w+)>/); if (t) rowTag = t[1]; }
  }
  if (!rowTag) return rows;
  const re = new RegExp('<' + rowTag + '>([\\s\\S]*?)<\\/' + rowTag + '>', 'g');
  let r;
  while ((r = re.exec(xml)) !== null) {
    const inner = r[1]; const obj = {};
    const fre = /<(\w+)>([\s\S]*?)<\/\1>/g; let f;
    while ((f = fre.exec(inner)) !== null) { obj[f[1]] = f[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim(); }
    if (Object.keys(obj).length) rows.push(obj);
  }
  return rows;
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
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (d > 12) return y + '-' + pad(mo) + '-' + pad(d); if (mo > 12) return y + '-' + pad(d) + '-' + pad(mo); return y + '-' + pad(mo) + '-' + pad(d); }
  return null;
}
function pad(n) { return String(n).padStart(2, '0'); }
function prettyLabel(k) { return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()); }

module.exports = { scrape };