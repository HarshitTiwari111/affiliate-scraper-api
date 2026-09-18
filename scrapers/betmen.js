// ============================================================
// BETMEN AFFILIATES — Cellxpert legacy API
// FIX: credentials ab query-string me bhi bheje jaate hain.
// Cellxpert /api/?command=... endpoint headers se auth NAHI karta —
// wo ?username=&password= (ya ?affiliateid=&key=) expect karta hai.
// Isi wajah se "Bad Authentication" aa raha tha.
//
// Credentials (Code.gs fetchViaPuppeteer se):
//   c.affiliateId / c.username -> Col C  (36451)
//   c.apiKey      / c.password -> Col J  (Access Key)
//   c.baseUrl  -> default https://track.betmenaffiliates.com
//   c.report   -> mediareport (default)
// Optional Col H extras:
//   apiuser:xxx   -> alag login username (agar Col C affiliate ID hai)
//   apipass:xxx   -> alag password
//   authstyle:qp_user_pass  -> seedha ek hi style force karo (debug)
// ============================================================

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://track.betmenaffiliates.com').replace(/\/+$/, '');
  const affiliateId = String(c.affiliateId || c.username || '').trim();
  const apiKey = String(c.apiKey || c.password || '').trim();
  const apiUser = String(c.apiuser || c.apiUser || '').trim() || affiliateId;
  const apiPass = String(c.apipass || c.apiPass || '').trim() || apiKey;
  const command = (c.report || 'mediareport').toLowerCase();
  const forceStyle = String(c.authstyle || '').trim();

  if (!affiliateId) throw new Error('Betmen: affiliateId missing (Col C).');
  if (!apiKey) throw new Error('Betmen: API key missing (Col J).');

  console.log('  -> Betmen affId=' + affiliateId + ' keyLen=' + apiKey.length + ' cmd=' + command);

  // ── Auth styles: params = query-string, headers = HTTP headers ──
  let authStyles = [
    // Cellxpert classic — sabse zyada chalta hai
    { name: 'qp_user_pass', params: { username: apiUser, password: apiPass } },
    { name: 'qp_affid_key', params: { affiliateid: affiliateId, key: apiKey } },
    { name: 'qp_affid_apikey', params: { affiliateid: affiliateId, apikey: apiKey } },
    { name: 'qp_affid_accesskey', params: { affiliateid: affiliateId, accesskey: apiKey } },
    { name: 'qp_user_token', params: { username: apiUser, token: apiKey } },
    // Query + header dono (kuch instances dono maangte hain)
    { name: 'qp_user_pass+hdr', params: { username: apiUser, password: apiPass }, headers: { affiliateid: affiliateId, 'x-api-key': apiKey } },
    // Pure header styles (purana behaviour — fallback)
    { name: 'hdr_xapikey', headers: { affiliateid: affiliateId, 'x-api-key': apiKey } },
    { name: 'hdr_apikey', headers: { affiliateid: affiliateId, apikey: apiKey } },
    { name: 'hdr_accesskey', headers: { affiliateid: affiliateId, accesskey: apiKey } },
    { name: 'hdr_bearer', headers: { affiliateid: affiliateId, Authorization: 'Bearer ' + apiKey } }
  ];
  if (forceStyle) {
    const only = authStyles.filter(s => s.name === forceStyle);
    if (only.length) authStyles = only;
  }

  // Breakdown params — Col H se 'breakdown', default Day+Brand+Country
  const bd = (c.breakdown || 'day,brand,country').toLowerCase();
  const bdParams = {};
  if (bd.indexOf('day') >= 0) bdParams.Day = 1;
  if (bd.indexOf('brand') >= 0) bdParams.Brand = 1;
  if (bd.indexOf('country') >= 0) bdParams.Country = 1;
  if (bd.indexOf('media') >= 0) bdParams.Media = 1;

  const chunks = splitRange(df, dt, 31);
  let allRows = [];
  let headerNames = null;
  let workingStyle = null;
  let rawSample = '';
  const tried = [];

  for (const [cf, ct] of chunks) {
    let chunkDone = false;
    const stylesToTry = workingStyle ? [workingStyle] : authStyles;

    for (const style of stylesToTry) {
      const qs = Object.assign(
        { command: command, fromdate: cf, todate: ct },
        bdParams,
        style.params || {}
      );
      const url = base + '/api/?' + Object.keys(qs)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(qs[k])).join('&');

      const headers = Object.assign(
        { Accept: 'application/xml, text/xml, */*', 'User-Agent': 'Mozilla/5.0' },
        style.headers || {}
      );

      let resp, body;
      try {
        resp = await fetch(url, { method: 'GET', headers });
        body = await resp.text();
      } catch (e) {
        recordTry(tried, style.name, 'network: ' + e.message);
        continue;
      }

      const trimmed = body.trim();
      const low = trimmed.toLowerCase();

      // IP block — retry karne ka fayda nahi, seedha bata do
      if (low.indexOf('ip not authenticated') >= 0 || low.indexOf('ip is not authorized') >= 0) {
        const ipm = trimmed.match(/(\d+\.\d+\.\d+\.\d+)/);
        throw new Error('Betmen IP block: ' + (ipm ? ipm[1] : '?')
          + ' — server ka /myip khol ke wo IP Betmen panel me whitelist karo.');
      }

      // Auth failure — chhote error responses
      if (trimmed.length < 400 &&
        (low.indexOf('bad authentication') >= 0 || low.indexOf('authentication key') >= 0 ||
          low.indexOf('not authenticated') >= 0 || low.indexOf('access denied') >= 0 ||
          low.indexOf('invalid user') >= 0 || low.indexOf('unauthorized') >= 0)) {
        recordTry(tried, style.name, trimmed.substring(0, 100));
        console.log('  -> auth fail [' + style.name + ']: ' + trimmed.substring(0, 100));
        continue;
      }

      if (!resp.ok) {
        recordTry(tried, style.name, 'HTTP ' + resp.status + ': ' + trimmed.substring(0, 100));
        continue;
      }

      if (!rawSample) rawSample = trimmed.substring(0, 300);

      const parsedRows = parseResultSet(trimmed);

      // Auth to chal gaya (200 + koi error text nahi) — style lock kar do
      workingStyle = style;
      console.log('  -> Betmen OK [' + style.name + '], ' + parsedRows.length + ' rows for ' + cf + '..' + ct);
      parsedRows.forEach(o => { if (!headerNames) headerNames = Object.keys(o); allRows.push(o); });
      chunkDone = true;
      break;
    }

    if (!chunkDone && !workingStyle) {
      throw new Error('Betmen: auth fail — koi bhi style kaam nahi kara.\n'
        + 'affiliateId=' + affiliateId + ', keyLen=' + apiKey.length + '\n'
        + 'Tried: ' + tried.map(t => t.style + ' → "' + t.err + '"').join(' | ') + '\n'
        + '👉 Check: (1) Col C = affiliate ID/username, Col J = Access Key ek hi account ke hain? '
        + '(2) Betmen panel me API access ON hai? (3) Server IP whitelist hai (/myip)?');
    }
  }

  if (!allRows.length || !headerNames) {
    // Auth OK par data nahi — ye error nahi, khaali result hai
    console.log('  -> Betmen: auth OK [' + (workingStyle ? workingStyle.name : '?') + '] par 0 rows. RAW: ' + escapeCtrl(rawSample));
    return { headers: ['Day', 'Brand', 'Impressions', 'Visitors', 'Registrations', 'QFTD', 'Deposits', 'Commission'], rows: [] };
  }

  // Column order fix — Day pehle, phir baaki
  const preferredOrder = ['Day', 'Brand', 'Country', 'Impressions', 'Visitors', 'Unique_Visitors',
    'Registrations', 'QFTD', 'Deposits', 'Commission'];
  let keys = [];
  preferredOrder.forEach(k => { if (headerNames.indexOf(k) >= 0) keys.push(k); });
  headerNames.forEach(k => { if (keys.indexOf(k) < 0) keys.push(k); });
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

  console.log('  -> Betmen', rows.length, 'rows (style=' + workingStyle.name + ')');
  return { headers: headerLabels, rows };
}

function recordTry(tried, style, err) {
  if (!tried.some(t => t.style === style)) tried.push({ style: style, err: String(err).replace(/\s+/g, ' ').substring(0, 80) });
}

// ============================================================
// Parse <ResultSet><row><Tag>val</Tag>...</row></ResultSet>
// ============================================================
function parseResultSet(xml) {
  const rows = [];
  const rowRe = /<row>([\s\S]*?)<\/row>/gi;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const inner = rm[1];
    const obj = {};
    const tagRe = /<([A-Za-z_][\w]*)>([\s\S]*?)<\/\1>/g;
    let tm;
    while ((tm = tagRe.exec(inner)) !== null) {
      obj[tm[1]] = tm[2].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    }
    if (Object.keys(obj).length) rows.push(obj);
  }
  // Fallback: kuch instances JSON dete hain agar &json=1 ho
  if (!rows.length && xml.trim().charAt(0) === '{') {
    try {
      const j = JSON.parse(xml);
      const arr = j.data || j.rows || j.ResultSet || (Array.isArray(j) ? j : null);
      if (Array.isArray(arr)) arr.forEach(o => { if (o && typeof o === 'object') rows.push(o); });
    } catch (e) { /* ignore */ }
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
function prettyLabel(k) { return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()); }

module.exports = { scrape };