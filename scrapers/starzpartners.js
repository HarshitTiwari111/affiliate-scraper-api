// ============================================================
// STARZPARTNERS — v7 (PROMO-FIX)
//
// PROMO MODE (Col H me promoIds diya ho):
//   traffic_report promo_id ko IGNORE karta hai (hamesha account total deta hai).
//   Isliye promo filter ke liye SEEDHA /api/customer/v1/partner/report endpoint use hota hai
//   (group_by me 'promo' ke saath), phir client-side sirf wanted promo ki rows filter hoti hain.
//   Scraper khud multiple group_by combos + date_group_by variants try karta hai — jo asli
//   date pe data de, wahi use hoga. Koi manual diagnostic nahi.
//
// NO-FILTER MODE (promoIds nahi diya):
//   Pehle jaisa — traffic_report daily (<=62 din) ya monthly (>62 din).
//
// Col H: baseUrl:https://starzpartners.com,promoIds:30482,columns:Date.Month.Visits.Registrations.First Deposits
// ============================================================

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const REPORT_COLUMNS = JSON.stringify([
  'visits_count', 'registrations_count', 'first_deposits_count',
  'deposits_sum', 'average_deposit_amount', 'ngr'
]);

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function scrape(c, df, dt, cp) {
  const base = (c.baseUrl || 'https://starzpartners.com').replace(/\/+$/, '');
  const token = c.token || c.username;
  if (!token) throw new Error('StarzPartners: STATISTIC_TOKEN missing (Col C).');

  const wants = String(c.promoIds || c.promo_ids || c.campaignId || c.campaign_ids || '')
    .trim().split(',').map(s => s.trim()).filter(Boolean);

  const headers = {
    'Accept': 'application/json',
    'Authorization': String(token),
    'User-Agent': 'Mozilla/5.0'
  };

  // ════════════════════════════════════════════
  // PROMO MODE — /report endpoint + client-side promo filter
  // ════════════════════════════════════════════
  if (wants.length) {
    console.log('StarzPartners PROMO MODE: ' + wants.join(',') + ' | ' + df + ' -> ' + dt);
    return await promoReport(base, headers, df, dt, wants);
  }

  // ════════════════════════════════════════════
  // NO-FILTER MODE — traffic_report (pehle jaisa)
  // ════════════════════════════════════════════
  const totalDays = Math.round((new Date(dt + 'T00:00:00Z') - new Date(df + 'T00:00:00Z')) / 86400000) + 1;
  const monthly = totalDays > 62;

  if (!monthly) {
    // Chhota range: single request, daily rows
    const result = await fetchTraffic(base, headers, df, dt, '');
    if (result && result.objs.length) {
      console.log('  -> traffic_report daily: ' + result.objs.length + ' rows');
      return formatDaily(result.objs, df, dt);
    }
  } else {
    // Lamba range: har month alag request, monthly rows
    const monthChunks = buildMonthChunks(df, dt);
    console.log('  -> traffic_report monthly mode: ' + monthChunks.length + ' month requests');
    const rows = [];
    for (const ch of monthChunks) {
      const result = await fetchTraffic(base, headers, ch.from, ch.to, '');
      await sleep(1200);
      const t = sumObjs((result && result.objs) ? result.objs : []);
      rows.push([ch.label, String(t.v), String(t.r), String(t.f), t.dep.toFixed(2), t.n.toFixed(2)]);
      console.log('  -> ' + ch.label + ': visits=' + t.v + ' regs=' + t.r + ' ftd=' + t.f);
    }
    return { headers: ['Month', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'], rows };
  }

  // Fallback: zero-fill
  const chunks = buildChunkList(df, dt);
  return {
    headers: [monthly ? 'Month' : 'Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
    rows: chunks.map(ch => [ch.label, '0', '0', '0', '0.00', '0.00'])
  };
}

// ════════════════════════════════════════════
// PROMO REPORT — self-discover working group_by, filter to wanted promo
// ════════════════════════════════════════════
async function promoReport(base, headers, df, dt, wants) {
  // Group_by combos — jo bhi 'promo' dimension de, uski har promo alag row aayegi.
  const groupByCombos = [
    ['brand', 'campaign', 'promo'],
    ['campaign', 'promo'],
    ['brand', 'promo'],
    ['promo']
  ];
  // UI me "Period: Day" hota hai — isliye date_group_by=day pehle try, phir bina.
  const dateGroupVariants = ['&date_group_by=day', ''];

  const seenPromo = {};
  let anyData = false;

  for (const dg of dateGroupVariants) {
    for (const gb of groupByCombos) {
      const url = buildReportUrl(base, gb, df, dt) + dg;
      const result = await tryFetch(url, headers, 'promo-report gb=' + gb.join('+') + dg);
      await sleep(1500);
      if (!result || !result.objs.length) continue;
      anyData = true;

      // Debug ke liye promo-ish values yaad rakho (agar match na ho)
      result.objs.forEach(o => {
        Object.keys(o).forEach(k => {
          if (k.toLowerCase().indexOf('promo') >= 0) {
            seenPromo[k + '=' + String(o[k]).substring(0, 40)] = true;
          }
        });
      });

      const matched = filterRows(result.objs, wants);
      if (matched.length) {
        console.log('  -> PROMO MATCH: gb=' + gb.join('+') + dg + ' | ' + matched.length + ' rows');
        return formatPromoRows(matched, df, dt);
      }
    }
  }

  if (anyData) {
    const seen = Object.keys(seenPromo).slice(0, 20);
    throw new Error('StarzPartners: /report data mila par promo "' + wants.join(',')
      + '" match nahi hua.\nAPI me ye promo values dikhi:\n'
      + (seen.length ? seen.join('\n') : '(promo field hi nahi mila)')
      + '\n\nCol H me promoIds me inme se sahi wali ID/value daal.');
  }
  throw new Error('StarzPartners: /report endpoint se ' + df + ' -> ' + dt
    + ' range me KOI data nahi mila (saare group_by combos empty). Date range sahi hai? Render logs bhej.');
}

// Matched (promo-filtered) objs ko output rows me convert karo
function formatPromoRows(objs, df, dt) {
  const keys = Object.keys(objs[0]);
  const dateKey = keys.find(k => {
    const lk = k.toLowerCase();
    return lk === 'date' || lk === 'day' || lk === 'period' || /^\d{4}-\d{2}-\d{2}/.test(String(objs[0][k] || ''));
  });
  const findKey = (pats) => keys.find(k => pats.some(p => k.toLowerCase().indexOf(p) >= 0));
  const vKey = findKey(['visit']), rKey = findKey(['registration', 'signup']),
    fKey = findKey(['first_deposit', 'ftd']), dKey = findKey(['deposits_sum', 'deposit_sum']),
    nKey = findKey(['ngr']);
  const num = (o, k) => k ? (parseFloat(o[k]) || 0) : 0;

  if (dateKey) {
    // Date-wise group (ek promo ki multiple din ki rows)
    const byDate = {};
    objs.forEach(o => {
      const d = String(o[dateKey]).substring(0, 10);
      if (!byDate[d]) byDate[d] = { v: 0, r: 0, f: 0, dep: 0, n: 0 };
      byDate[d].v += num(o, vKey);
      byDate[d].r += num(o, rKey);
      byDate[d].f += num(o, fKey);
      byDate[d].dep += num(o, dKey);
      byDate[d].n += num(o, nKey);
    });
    // Missing din 0 se fill (range ke andar)
    let cur = new Date(df + 'T00:00:00Z');
    const endD = new Date(dt + 'T00:00:00Z');
    while (cur <= endD) {
      const key = cur.toISOString().substring(0, 10);
      if (!byDate[key]) byDate[key] = { v: 0, r: 0, f: 0, dep: 0, n: 0 };
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const rows = Object.keys(byDate).sort().map(d => {
      const x = byDate[d];
      return [d, String(x.v), String(x.r), String(x.f), x.dep.toFixed(2), x.n.toFixed(2)];
    });
    return { headers: ['Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'], rows };
  }

  // Date field nahi — single aggregate row
  const t = sumObjs(objs);
  const label = (df === dt) ? df : (df + ' -> ' + dt);
  return {
    headers: ['Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
    rows: [[label, String(t.v), String(t.r), String(t.f), t.dep.toFixed(2), t.n.toFixed(2)]]
  };
}

// ── Traffic_report single request (no-filter mode) ──
async function fetchTraffic(base, headers, from, to, fv) {
  const url = base + '/api/customer/v1/partner/traffic_report'
    + '?from=' + encodeURIComponent(from)
    + '&to=' + encodeURIComponent(to)
    + '&date_group_by=day'
    + fv;
  return await tryFetch(url, headers, 'traffic ' + from + '->' + to);
}

// ── Objs ka total ──
function sumObjs(objs) {
  const t = { v: 0, r: 0, f: 0, dep: 0, n: 0 };
  if (!objs.length) return t;
  const keys = Object.keys(objs[0]);
  const findKey = (pats) => keys.find(k => pats.some(p => k.toLowerCase().indexOf(p) >= 0));
  const vKey = findKey(['visit']), rKey = findKey(['registration', 'signup']),
    fKey = findKey(['first_deposit', 'ftd']), dKey = findKey(['deposits_sum', 'deposit_sum']),
    nKey = findKey(['ngr']);
  objs.forEach(o => {
    t.v += parseFloat(o[vKey]) || 0;
    t.r += parseFloat(o[rKey]) || 0;
    t.f += parseFloat(o[fKey]) || 0;
    t.dep += parseFloat(o[dKey]) || 0;
    t.n += parseFloat(o[nKey]) || 0;
  });
  return t;
}

// ── Fetch + flexible parse + LOG PREVIEW ──
async function tryFetch(url, headers, label) {
  let resp, body;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      resp = await fetch(url, { method: 'GET', headers });
      body = await resp.text();
      if (resp.status !== 429) break;
      console.log('  -> 429 [' + label + '], waiting 5s...');
      await sleep(5000);
    }
  } catch (e) {
    console.log('  -> [' + label + '] network error: ' + e.message);
    return null;
  }

  console.log('  -> [' + label + '] status=' + resp.status + ' preview=' + body.substring(0, 150).replace(/\s+/g, ' '));
  if (!resp.ok) return null;

  let data;
  try { data = JSON.parse(body); } catch (e) { return null; }

  let raw = null;
  if (data.rows && Array.isArray(data.rows.data)) raw = data.rows.data;
  else if (Array.isArray(data.rows)) raw = data.rows;
  else if (Array.isArray(data.data)) raw = data.data;
  else if (Array.isArray(data)) raw = data;
  if (!raw || !raw.length) return { objs: [] };

  const objs = raw.map(item => {
    if (Array.isArray(item)) {
      const o = {};
      item.forEach(cell => { if (cell && cell.name !== undefined) o[cell.name] = cell.value; });
      return o;
    }
    return item;
  });

  return { objs };
}

function buildReportUrl(base, groupBy, from, to) {
  return base + '/api/customer/v1/partner/report'
    + '?columns=' + encodeURIComponent(REPORT_COLUMNS)
    + '&group_by=' + encodeURIComponent(JSON.stringify(groupBy))
    + '&from=' + encodeURIComponent(from)
    + '&to=' + encodeURIComponent(to)
    + '&period=custom'
    + '&conversion_currency=EUR&convert_all_currencies=1'
    + '&exchange_rates_date=' + encodeURIComponent(to)
    + '&promo_codes=' + encodeURIComponent('[]')
    + '&strategies=' + encodeURIComponent('[]')
    + '&player_dynamic_tags_include=' + encodeURIComponent('[]')
    + '&player_dynamic_tags_exclude=' + encodeURIComponent('[]');
}

// ── Client-side promo filter: row me wanted ID/value substring dhundo ──
function filterRows(objs, wants) {
  if (!wants.length) return objs;
  const lw = wants.map(w => w.toLowerCase());
  return objs.filter(o => {
    const rowText = Object.values(o).map(v => String(v)).join(' | ').toLowerCase();
    return lw.some(w => rowText.indexOf(w) >= 0);
  });
}

// ── Daily output (no-filter chhote ranges), missing din 0 se fill ──
function formatDaily(objs, df, dt) {
  const keys = Object.keys(objs[0]);
  const dateKey = keys.find(k => {
    const lk = k.toLowerCase();
    return lk === 'date' || lk === 'day' || lk === 'period' || /^\d{4}-\d{2}-\d{2}/.test(String(objs[0][k] || ''));
  });
  const findKey = (pats) => keys.find(k => pats.some(p => k.toLowerCase().indexOf(p) >= 0));
  const vKey = findKey(['visit']), rKey = findKey(['registration', 'signup']),
    fKey = findKey(['first_deposit', 'ftd']), dKey = findKey(['deposits_sum', 'deposit_sum']),
    nKey = findKey(['ngr']);

  const byDate = {};
  objs.forEach(o => {
    const d = dateKey ? String(o[dateKey]).substring(0, 10) : 'total';
    if (!byDate[d]) byDate[d] = { v: 0, r: 0, f: 0, dep: 0, n: 0 };
    byDate[d].v += parseFloat(o[vKey]) || 0;
    byDate[d].r += parseFloat(o[rKey]) || 0;
    byDate[d].f += parseFloat(o[fKey]) || 0;
    byDate[d].dep += parseFloat(o[dKey]) || 0;
    byDate[d].n += parseFloat(o[nKey]) || 0;
  });

  // Missing din 0 se fill
  let cur = new Date(df + 'T00:00:00Z');
  const endD = new Date(dt + 'T00:00:00Z');
  while (cur <= endD) {
    const key = cur.toISOString().substring(0, 10);
    if (!byDate[key]) byDate[key] = { v: 0, r: 0, f: 0, dep: 0, n: 0 };
    cur.setUTCDate(cur.getUTCDate() + 1);
  }

  const rows = Object.keys(byDate).sort().map(d => {
    const x = byDate[d];
    return [d, String(x.v), String(x.r), String(x.f), x.dep.toFixed(2), x.n.toFixed(2)];
  });
  return { headers: ['Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'], rows };
}

// ── Month chunks: har month ka from/to + "Jan 2026" label ──
function buildMonthChunks(df, dt) {
  const start = new Date(df + 'T00:00:00Z');
  const end = new Date(dt + 'T00:00:00Z');
  const chunks = [];
  let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  while (cur <= end) {
    const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
    const chunkEnd = monthEnd > end ? end : monthEnd;
    chunks.push({
      from: cur.toISOString().substring(0, 10),
      to: chunkEnd.toISOString().substring(0, 10),
      label: MONTH_NAMES[cur.getUTCMonth()] + ' ' + cur.getUTCFullYear()
    });
    cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
  }
  return chunks;
}

// ── Fallback chunk list: <=62 din -> per day | >62 -> per month ──
function buildChunkList(df, dt) {
  const start = new Date(df + 'T00:00:00Z');
  const end = new Date(dt + 'T00:00:00Z');
  const totalDays = Math.round((end - start) / 86400000) + 1;
  if (totalDays <= 62) {
    const chunks = [];
    let d = new Date(start);
    while (d <= end) {
      const iso = d.toISOString().substring(0, 10);
      chunks.push({ from: iso, to: iso, label: iso });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return chunks;
  }
  return buildMonthChunks(df, dt);
}

module.exports = { scrape };