// ============================================================
// BETMEN AFFILIATES — Cellxpert official API (API key)
// NO browser, NO login, NO reCAPTCHA — pure REST API.
//
// Place at: scrapers/betmen.js   (REPLACE the old Puppeteer/Angular code)
//
// Cellxpert API docs:
//   GET /api/?command=mediareport&fromdate=YYYY-MM-DD&todate=YYYY-MM-DD&Day=1&Brand=1&json=1
//   headers: affiliateid: <ID>,  x-api-key: <ACCESS_KEY>
//   commands: mediareport (JSON), commissions (XML), registrations
//   limits: max 31-day range, no future dates
//
// Credentials from Code.gs fetchViaPuppeteer:
//   c.affiliateId -> Col C  (e.g. 36451)
//   c.apiKey      -> Col J  (Access Key)
//   c.baseUrl     -> Col H baseUrl:... (default https://track.betmenaffiliates.com)
//   c.report      -> Col H report:mediareport | commissions | registrations (default mediareport)
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://track.betmenaffiliates.com').replace(/\/+$/, '');
  const affiliateId = c.affiliateId || c.username; // Col C
  const apiKey = c.apiKey || c.password;           // Col J
  const command = (c.report || 'mediareport').toLowerCase();

  if (!affiliateId) throw new Error('Betmen: affiliateId missing (Col C).');
  if (!apiKey) throw new Error('Betmen: API key missing (Col J). Regenerate key in Betmen API settings.');

  // Cellxpert: max 31-day window. Split the range into <=31-day chunks.
  const chunks = splitRange(df, dt, 31);

  const headers = {
    'affiliateid': String(affiliateId),
    'x-api-key': String(apiKey),
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0'
  };

  let allRows = [];
  let headerNames = null;
  let isXml = false;

  for (const [cf, ct] of chunks) {
    const url = base + '/api/'
      + '?command=' + encodeURIComponent(command)
      + '&fromdate=' + encodeURIComponent(cf)
      + '&todate=' + encodeURIComponent(ct)
      + '&Day=1&Brand=1&json=1';

    console.log('  -> Betmen', command, cf, '->', ct);
    const resp = await fetch(url, { method: 'GET', headers });
    const body = await resp.text();
    if (!resp.ok) {
      throw new Error('Betmen API failed (' + resp.status + '): ' + body.substring(0, 250)
        + (resp.status === 401 || resp.status === 403
            ? ' — check API key + that Render IP is whitelisted (call /myip).'
            : ''));
    }

    // commissions command returns XML; mediareport returns JSON
    const trimmed = body.trim();
    if (trimmed.startsWith('<')) {
      isXml = true;
      const parsed = parseXmlRows(trimmed);
      if (parsed.length) {
        if (!headerNames) headerNames = Object.keys(parsed[0]);
        allRows = allRows.concat(parsed);
      }
    } else {
      let data;
      try { data = JSON.parse(body); }
      catch (e) { throw new Error('Betmen: response not JSON/XML: ' + body.substring(0, 250)); }

      const rowsArr = extractJsonRows(data);
      rowsArr.forEach(o => {
        if (!headerNames) headerNames = Object.keys(o);
        allRows.push(o);
      });
    }
  }

  if (!allRows.length || !headerNames) {
    throw new Error('Betmen: no rows for ' + df + ' to ' + dt + ' (command: ' + command + ').');
  }

  // union of keys (in first-seen order)
  const keys = headerNames.slice();
  allRows.forEach(o => Object.keys(o).forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); }));

  // force date column to YYYY-MM-DD with leading apostrophe (sheet keeps it as text)
  const dateIdx = keys.findIndex(k => /date|day/i.test(k));

  const headerLabels = keys.map(prettyLabel);
  const rows = allRows.map(o => keys.map((k, idx) => {
    let v = o[k];
    if (v === null || v === undefined) return '';
    v = String(v);
    if (idx === dateIdx) {
      const norm = normalizeDate(v);
      if (norm) v = "'" + norm; // apostrophe => sheet treats as text, no auto-format
    }
    return v;
  }));

  console.log('  -> Betmen', rows.length, 'rows (' + (isXml ? 'xml' : 'json') + ')');
  return { headers: headerLabels, rows };
}

// ---- helpers ----

function extractJsonRows(data) {
  // Cellxpert responses vary; dig out the array of row objects.
  if (Array.isArray(data)) return data;
  const candidates = ['data', 'rows', 'records', 'report', 'results', 'items', 'mediareport', 'commissions'];
  for (const key of candidates) {
    if (data[key]) {
      if (Array.isArray(data[key])) return data[key];
      if (typeof data[key] === 'object') {
        // sometimes nested one level
        for (const k2 of candidates) {
          if (Array.isArray(data[key][k2])) return data[key][k2];
        }
      }
    }
  }
  // object of objects -> values
  if (typeof data === 'object') {
    const vals = Object.values(data).filter(v => v && typeof v === 'object');
    if (vals.length && vals.every(v => !Array.isArray(v))) return vals;
  }
  return [];
}

function parseXmlRows(xml) {
  // Generic XML -> array of flat objects.
  // Find repeating child blocks (e.g. <row>...</row>, <commission>...</commission>)
  const rows = [];
  // grab inner of the first repeating tag
  const tagMatch = xml.match(/<(\w+)>\s*<(\w+)>/);
  let rowTag = null;
  if (tagMatch) rowTag = tagMatch[2];
  if (!rowTag) {
    // fallback: any tag that appears multiple times wrapping fields
    const m = xml.match(/<(\w+)>[^<]*<\w+>/g);
    if (m && m.length) {
      const t = m[0].match(/<(\w+)>/);
      if (t) rowTag = t[1];
    }
  }
  if (!rowTag) return rows;

  const re = new RegExp('<' + rowTag + '>([\\s\\S]*?)<\\/' + rowTag + '>', 'g');
  let r;
  while ((r = re.exec(xml)) !== null) {
    const inner = r[1];
    const obj = {};
    const fre = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let f;
    while ((f = fre.exec(inner)) !== null) {
      obj[f[1]] = f[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    }
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
    start = new Date(chunkEnd);
    start.setUTCDate(start.getUTCDate() + 1);
  }
  return out.length ? out : [[df, dt]];
}

function ymd(d) {
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function normalizeDate(s) {
  s = String(s).trim();
  let m;
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    let d = +m[1], mo = +m[2], y = +m[3];
    if (d > 12) return y + '-' + pad(mo) + '-' + pad(d);
    if (mo > 12) return y + '-' + pad(d) + '-' + pad(mo);
    return y + '-' + pad(mo) + '-' + pad(d);
  }
  return null;
}

function pad(n) { return String(n).padStart(2, '0'); }

function prettyLabel(k) {
  return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

module.exports = { scrape };