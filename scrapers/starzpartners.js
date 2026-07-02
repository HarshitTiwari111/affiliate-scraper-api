// ============================================================
// STARZPARTNERS — FINAL (v6)
// Route 1: /partner/traffic_report
//   <=62 din: single request, daily rows
//   >62 din:  PER-MONTH requests (API ~120 row cap se bachne ke liye), monthly rows
// Route 2: /partner/report (group_by discovery) | Route 3: chunk loop
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

  const totalDays = Math.round((new Date(dt + 'T00:00:00Z') - new Date(df + 'T00:00:00Z')) / 86400000) + 1;
  const monthly = totalDays > 62;

  // Promo filter variants (jo pehla month pe chale, wahi aage use hoga)
  const trafficVariants = [];
  if (wants.length) {
    trafficVariants.push('&promo_id=' + encodeURIComponent(wants[0]));
    trafficVariants.push('&promo_ids=' + encodeURIComponent(JSON.stringify(wants.map(Number))));
    trafficVariants.push('&promo_ids=' + encodeURIComponent(wants.join(',')));
  } else {
    trafficVariants.push('');
  }

  // ════════════════════════════════════════════
  // ROUTE 1 — TRAFFIC_REPORT
  // ════════════════════════════════════════════
  if (!monthly) {
    // ── Chhota range: single request, daily rows ──
    for (const fv of trafficVariants) {
      const result = await fetchTraffic(base, headers, df, dt, fv);
      if (result && result.objs.length) {
        console.log('  -> ROUTE 1 SUCCESS (daily): ' + result.objs.length + ' rows');
        return formatDaily(result.objs, df, dt);
      }
      await sleep(2000);
    }
  } else {
    // ── Lamba range: HAR MONTH alag request (API row-cap bypass) ──
    const monthChunks = buildMonthChunks(df, dt);
    console.log('  -> ROUTE 1 monthly mode: ' + monthChunks.length + ' month requests');

    // Working promo variant dhundo — months pe try karo jab tak kisi mein rows na milein
    let workingFv = null;
    let prefetched = {}; // label -> objs (dobara fetch na karna pade)

    outer:
    for (const fv of trafficVariants) {
      for (const ch of monthChunks) {
        const result = await fetchTraffic(base, headers, ch.from, ch.to, fv);
        await sleep(1200);
        if (result && result.objs.length) {
          workingFv = fv;
          prefetched[ch.label] = result.objs;
          console.log('  -> working promo variant mila (month ' + ch.label + ')');
          break outer;
        }
      }
    }

    if (workingFv !== null) {
      const rows = [];
      for (const ch of monthChunks) {
        let objs = prefetched[ch.label];
        if (!objs) {
          const result = await fetchTraffic(base, headers, ch.from, ch.to, workingFv);
          objs = (result && result.objs) ? result.objs : [];
          await sleep(1200);
        }
        const t = sumObjs(objs);
        rows.push([ch.label, String(t.v), String(t.r), String(t.f), t.dep.toFixed(2), t.n.toFixed(2)]);
        console.log('  -> ' + ch.label + ': visits=' + t.v + ' regs=' + t.r + ' ftd=' + t.f);
      }
      return { headers: ['Month', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'], rows };
    }
  }
  console.log('  -> Route 1 (traffic_report) se kuch nahi mila, Route 2...');

  // ── Fallback chunks ──
  const chunks = buildChunkList(df, dt);

  // ════════════════════════════════════════════
  // ROUTE 2 — REPORT endpoint, group_by token discovery
  // ════════════════════════════════════════════
  const promoTokens = ['promo', 'promos', 'promo_id', 'promo_code', 'promo_hash'];

  for (const pt of promoTokens) {
    const url = buildReportUrl(base, ['brand', 'campaign', pt], df, dt);
    const result = await tryFetch(url, headers, 'report group_by=' + pt);
    if (result && result.objs.length) {
      console.log('  -> ROUTE 2 SUCCESS: group_by "' + pt + '" works!');
      return await chunkLoop(base, headers, ['brand', 'campaign', pt], chunks, wants, df, dt);
    }
    await sleep(2000);
  }
  console.log('  -> Route 2 se kuch nahi mila, Route 3...');

  // ════════════════════════════════════════════
  // ROUTE 3 — brand+campaign chunk loop
  // ════════════════════════════════════════════
  const baseResult = await tryFetch(buildReportUrl(base, ['brand', 'campaign'], df, dt), headers, 'report brand+campaign');

  if (!baseResult || !baseResult.objs.length) {
    console.log('  -> Account mein is range mein KOI data nahi');
    return {
      headers: [monthly ? 'Month' : 'Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
      rows: chunks.map(ch => [ch.label, '0', '0', '0', '0.00', '0.00'])
    };
  }

  if (wants.length) {
    throw new Error('StarzPartners: account mein data HAI lekin promo-level breakdown kisi route se nahi mila — Render logs bhej.');
  }

  return await chunkLoop(base, headers, ['brand', 'campaign'], chunks, [], df, dt);
}

// ── Traffic_report single request ──
async function fetchTraffic(base, headers, from, to, fv) {
  const url = base + '/api/customer/v1/partner/traffic_report'
    + '?from=' + encodeURIComponent(from)
    + '&to=' + encodeURIComponent(to)
    + '&date_group_by=day'
    + fv;
  return await tryFetch(url, headers, 'traffic ' + from + '→' + to);
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

// ── Chunk loop (Route 2/3 fallback) with client-side promo filter ──
async function chunkLoop(base, headers, groupBy, chunks, wants, df, dt) {
  const outRows = [];
  let matchedAny = false;
  const seenValues = {};

  for (const ch of chunks) {
    let objs = [];
    const result = await tryFetch(buildReportUrl(base, groupBy, ch.from, ch.to), headers, 'chunk ' + ch.label);
    if (result) objs = result.objs;

    objs.forEach(o => {
      Object.keys(o).forEach(k => {
        const lk = k.toLowerCase();
        if (lk.indexOf('promo') >= 0 || lk === 'campaign' || lk === 'brand') {
          seenValues[k + ': ' + String(o[k]).substring(0, 50)] = true;
        }
      });
    });

    const matched = filterRows(objs, wants);
    if (matched.length) matchedAny = true;

    const t = sumObjs(matched);
    outRows.push([ch.label, String(t.v), String(t.r), String(t.f), t.dep.toFixed(2), t.n.toFixed(2)]);
    await sleep(1500);
  }

  if (wants.length && !matchedAny) {
    const seen = Object.keys(seenValues).slice(0, 15);
    throw new Error('StarzPartners: "' + wants.join(',') + '" match nahi hua.\nAPI values:\n' + (seen.length ? seen.join('\n') : '(khali)'));
  }

  const isMonthly = chunks.length > 0 && chunks[0].from !== chunks[0].to;
  return {
    headers: [isMonthly ? 'Month' : 'Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
    rows: outRows
  };
}

function filterRows(objs, wants) {
  if (!wants.length) return objs;
  const lw = wants.map(w => w.toLowerCase());
  return objs.filter(o => {
    const rowText = Object.values(o).map(v => String(v)).join(' | ').toLowerCase();
    return lw.some(w => rowText.indexOf(w) >= 0);
  });
}

// ── Daily output (chhote ranges), missing din 0 se fill ──
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

// ── Fallback chunk list: <=62 din → per day | >62 → per month ──
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