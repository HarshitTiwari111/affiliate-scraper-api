// ============================================================
// BETMEN AFFILIATES — Cellxpert API (API key)
// Handles JSON, XML, and ANY delimited text (tab/comma/semicolon/multi-space).
// Auto-detects delimiter. Shows exact bytes on failure.
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
    { 'affiliateid': affiliateId, 'Authorization': 'Bearer ' + apiKey },
    { 'affiliateid': affiliateId, 'api-key': apiKey },
    { 'affiliateid': affiliateId, '__queryKey': apiKey }
  ];

  const chunks = splitRange(df, dt, 31);
  let allRows = [];
  let headerNames = null;
  let format = '?';
  let workingStyle = null;
  let lastErr = '';
  let rawSample = '';

  for (const [cf, ct] of chunks) {
    let chunkDone = false;
    const stylesToTry = workingStyle ? [workingStyle] : authStyles;

    for (const style of stylesToTry) {
      const headers = { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' };
      let url = base + '/api/'
        + '?command=' + encodeURIComponent(command)
        + '&fromdate=' + encodeURIComponent(cf)
        + '&todate=' + encodeURIComponent(ct)
        + '&Day=1&Brand=1&json=1';

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

      // Auth failure — sirf chhote responses (clearly error) ko auth-fail maano
      if (trimmed.length < 200 &&
          (low.indexOf('bad authentication') >= 0 || low.indexOf('authentication key') >= 0
          || low.indexOf('not authenticated') >= 0 || low.indexOf('access denied') >= 0
          || (low.indexOf('invalid') >= 0 && low.indexOf('key') >= 0))) {
        lastErr = trimmed.substring(0, 120);
        const uh = Object.keys(style).find(k => k !== 'affiliateid') || 'query';
        console.log('  -> auth fail with [' + uh + ']: ' + lastErr);
        continue;
      }
      if (trimmed.length < 200 && low.indexOf('ip not authenticated') >= 0) {
        const ipm = trimmed.match(/(\d+\.\d+\.\d+\.\d+)/);
        throw new Error('Betmen IP block: ' + (ipm ? ipm[1] : '?') + ' — /myip se IP le ke whitelist karo.');
      }
      if (!resp.ok) { lastErr = 'HTTP ' + resp.status + ': ' + trimmed.substring(0, 120); continue; }

      if (!rawSample) rawSample = trimmed.substring(0, 400);

      // ── Format detect: XML / JSON / delimited-text ──
      let parsedRows = [];
      if (trimmed.startsWith('<')) {
        format = 'xml';
        parsedRows = parseXmlRows(trimmed);
      } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const data = JSON.parse(body);
          parsedRows = extractJsonRows(data);
          format = 'json';
        } catch (e) {
          const res = parseDelimited(trimmed);
          parsedRows = res.rows; format = 'delim(' + res.delim + ')';
        }
      } else {
        const res = parseDelimited(trimmed);
        parsedRows = res.rows; format = 'delim(' + res.delim + ')';
      }

      const uh = Object.keys(style).find(k => k !== 'affiliateid') || 'query';
      console.log('  -> Betmen OK via [' + uh + '] (' + format + '), ' + parsedRows.length + ' rows for ' + cf);
      workingStyle = style;
      parsedRows.forEach(o => { if (!headerNames) headerNames = Object.keys(o); allRows.push(o); });
      chunkDone = true;
      break;
    }

    if (!chunkDone && !workingStyle) {
      throw new Error('Betmen: koi auth style kaam nahi kari. ID (' + affiliateId + ') aur key same account ke hone chahiye. Last: "' + lastErr + '"');
    }
  }

  if (!allRows.length || !headerNames) {
    // Row parse nahi hui — EXACT bytes dikhao (tabs/newlines visible), taaki fix ho sake
    const visible = escapeCtrl(rawSample);
    throw new Error('Betmen: auth OK par row parse nahi hui. RAW (control chars visible): "' + visible + '"');
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

  console.log('  -> Betmen', rows.length, 'rows (' + format + ')');
  return { headers: headerLabels, rows };
}

// ============================================================
// SMART DELIMITED PARSER — auto-detects tab / comma / semicolon / pipe / multi-space
// ============================================================
function parseDelimited(text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!text) return { rows: [], delim: 'none' };

  const lines = text.split('\n').filter(l => l.trim().length);
  if (lines.length < 1) return { rows: [], delim: 'none' };

  const header = lines[0];

  // Delimiter detect — jo header me sabse zyada consistent lage
  const candidates = [
    { name: 'tab', re: /\t/, split: (s) => s.split('\t') },
    { name: 'semicolon', re: /;/, split: (s) => s.split(';') },
    { name: 'pipe', re: /\|/, split: (s) => s.split('|') },
    { name: 'comma', re: /,/, split: (s) => s.split(',') },
    { name: 'multispace', re: /\s{2,}/, split: (s) => s.split(/\s{2,}/) }
  ];

  let chosen = null;
  for (const cand of candidates) {
    if (cand.re.test(header)) {
      const cols = cand.split(header).filter(x => x.trim().length);
      if (cols.length >= 2) { chosen = cand; break; }
    }
  }

  // Agar koi delimiter nahi mila — single column data
  if (!chosen) {
    // Har line ek value — generic "Value" column bana do
    const rows = lines.slice(1).map(l => ({ Value: l.trim() })).filter(o => o.Value.length);
    return { rows, delim: 'none/singlecol' };
  }

  const headerCols = chosen.split(header).map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = chosen.split(lines[i]);
    if (!cells.some(c => c && c.trim().length)) continue;
    const first = String(cells[0] || '').trim().toLowerCase();
    if (first === 'total' || first === 'totals' || first === 'summary') continue;
    const obj = {};
    headerCols.forEach((h, idx) => { obj[h || ('col' + idx)] = (cells[idx] !== undefined ? String(cells[idx]).trim() : ''); });
    rows.push(obj);
  }
  return { rows, delim: chosen.name };
}

// Control chars ko visible banao ([9]=tab, [10]=newline) — debugging ke liye
function escapeCtrl(s) {
  return String(s).split('').map(ch => {
    const code = ch.charCodeAt(0);
    if (code < 32) return '[' + code + ']';
    return ch;
  }).join('');
}

// ---- JSON helper ----
function extractJsonRows(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data.filter(x => x && typeof x === 'object');
  if (typeof data !== 'object') return [];
  const candidates = ['data', 'rows', 'records', 'report', 'results', 'items', 'mediareport', 'commissions', 'result', 'stats', 'reportdata'];
  for (const rk of Object.keys(data)) {
    if (candidates.indexOf(rk.toLowerCase()) >= 0 && Array.isArray(data[rk])) return data[rk].filter(x => x && typeof x === 'object');
  }
  for (const rk of Object.keys(data)) {
    const val = data[rk];
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const ik of Object.keys(val)) {
        if (Array.isArray(val[ik]) && val[ik].length && typeof val[ik][0] === 'object') return val[ik].filter(x => x && typeof x === 'object');
      }
    }
  }
  for (const rk of Object.keys(data)) {
    if (Array.isArray(data[rk]) && data[rk].length && typeof data[rk][0] === 'object') return data[rk].filter(x => x && typeof x === 'object');
  }
  const vals = Object.values(data).filter(v => v && typeof v === 'object' && !Array.isArray(v));
  if (vals.length && vals.every(v => Object.keys(v).length >= 2)) return vals;
  return [];
}

function parseXmlRows(xml) {
  const rows = [];
  const tagMatch = xml.match(/<(\w+)>\s*<(\w+)>/);
  let rowTag = null;
  if (tagMatch) rowTag = tagMatch[2];
  if (!rowTag) { const m = xml.match(/<(\w+)>[^<]*<\w+>/g); if (m && m.length) { const t = m[0].match(/<(\w+)>/); if (t) rowTag = t[1]; } }
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
  m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) { let d = +m[1], mo = +m[2], y = +m[3]; if (d > 12) return y + '-' + pad(mo) + '-' + pad(d); if (mo > 12) return y + '-' + pad(d) + '-' + pad(mo); return y + '-' + pad(mo) + '-' + pad(d); }
  return null;
}
function pad(n) { return String(n).padStart(2, '0'); }
function prettyLabel(k) { return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()); }

module.exports = { scrape };