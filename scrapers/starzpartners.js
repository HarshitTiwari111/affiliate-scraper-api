// ============================================================
// STARZPARTNERS — FINAL (v5)
// Route 1: /partner/traffic_report  (koi bhi range, ek request)
// Route 2: /partner/report          (group_by token discovery)
// Route 3: chunk loop — <=62 din: day-by-day | >62 din: month-by-month
// Col H: baseUrl:https://starzpartners.com,promoIds:30482,columns:Date.Visits.Registrations.First Deposits
// ============================================================

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const REPORT_COLUMNS = JSON.stringify([
  'visits_count', 'registrations_count', 'first_deposits_count',
  'deposits_sum', 'average_deposit_amount', 'ngr'
]);

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
  // ROUTE 1 — TRAFFIC_REPORT (koi bhi range, single request)
  // ════════════════════════════════════════════
  const trafficVariants = [];
  if (wants.length) {
    trafficVariants.push('&promo_id=' + encodeURIComponent(wants[0]));
    trafficVariants.push('&promo_ids=' + encodeURIComponent(JSON.stringify(wants.map(Number))));
    trafficVariants.push('&promo_ids=' + encodeURIComponent(wants.join(',')));
  } else {
    trafficVariants.push('');
  }

  for (const fv of trafficVariants) {
    const url = base + '/api/customer/v1/partner/traffic_report'
      + '?from=' + encodeURIComponent(df)
      + '&to=' + encodeURIComponent(dt)
      + '&date_group_by=day'
      + fv;
    const result = await tryFetch(url, headers, 'traffic_report' + fv.substring(0, 30));
    if (result && result.objs.length) {
      console.log('  -> ROUTE 1 SUCCESS (traffic_report): ' + result.objs.length + ' rows');
      return formatOutput(result.objs, df, dt);
    }
    await sleep(2000);
  }
  console.log('  -> Route 1 (traffic_report) se kuch nahi mila, Route 2...');

  // ── Chunk list banao (Route 2/3 fallback ke liye) ──
  // <=62 din: har din alag | >62 din: month-by-month (This Year jaise ranges ke liye)
  const chunks = buildChunkList(df, dt);
  console.log('  -> Fallback chunks: ' + chunks.length + ' (' + chunks[0].label + ' ... ' + chunks[chunks.length - 1].label + ')');

  // ════════════════════════════════════════════
  // ROUTE 2 — REPORT endpoint, group_by token discovery (poore range pe)
  // ════════════════════════════════════════════
  const promoTokens = ['promo', 'promos', 'promo_id', 'promo_code', 'promo_hash'];

  for (const pt of promoTokens) {
    const url = buildReportUrl(base, ['brand', 'campaign', pt], df, dt);
    const result = await tryFetch(url, headers, 'report group_by=' + pt);
    if (result && result.objs.length) {
      console.log('  -> ROUTE 2 SUCCESS: group_by token "' + pt + '" works! ' + result.objs.length + ' rows');
      return await chunkLoop(base, headers, ['brand', 'campaign', pt], chunks, wants, result.objs, df, dt);
    }
    await sleep(2000);
  }
  console.log('  -> Route 2 (promo group_by) se kuch nahi mila, Route 3...');

  // ════════════════════════════════════════════
  // ROUTE 3 — brand+campaign chunk loop (last resort)
  // ════════════════════════════════════════════
  const baseUrl2 = buildReportUrl(base, ['brand', 'campaign'], df, dt);
  const baseResult = await tryFetch(baseUrl2, headers, 'report brand+campaign');

  if (!baseResult || !baseResult.objs.length) {
    console.log('  -> Account mein is range mein KOI data nahi (' + df + ' → ' + dt + ')');
    return {
      headers: ['Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
      rows: chunks.map(ch => [ch.label, '0', '0', '0', '0.00', '0.00'])
    };
  }

  if (wants.length) {
    throw new Error('StarzPartners: account mein data HAI (' + baseResult.objs.length + ' rows) lekin promo-level breakdown kisi bhi API route se nahi mil raha — Render logs mein "preview" lines dekh aur mujhe bhej.');
  }

  return await chunkLoop(base, headers, ['brand', 'campaign'], chunks, [], null, df, dt);
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

  console.log('  -> [' + label + '] status=' + resp.status + ' preview=' + body.substring(0, 200).replace(/\s+/g, ' '));

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

// ── Chunk loop with client-side promo filter ──
// chunk = { from, to, label } — chhota range: per-day | bada range: per-month
async function chunkLoop(base, headers, groupBy, chunks, wants, rangeObjs, df, dt) {
  const outRows = [];
  let matchedAny = false;
  const seenValues = {};

  for (const ch of chunks) {
    let objs = [];
    const url = buildReportUrl(base, groupBy, ch.from, ch.to);
    const result = await tryFetch(url, headers, 'chunk ' + ch.label);
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

    const sum = (key) => matched.reduce((a, o) => a + (parseFloat(o[key]) || 0), 0);
    outRows.push([
      ch.label,
      String(sum('visits_count')),
      String(sum('registrations_count')),
      String(sum('first_deposits_count')),
      sum('deposits_sum').toFixed(2),
      sum('ngr').toFixed(2)
    ]);

    await sleep(1500);
  }

  if (wants.length && !matchedAny) {
    const seen = Object.keys(seenValues).slice(0, 15);
    throw new Error('StarzPartners: "' + wants.join(',') + '" kisi row mein match nahi hua (' + df + ' → ' + dt + ').\n\nAPI ne ye values bheji:\n' + (seen.length ? seen.join('\n') : '(rows khali)') + '\n\nIn mein se sahi value promoIds mein daal.');
  }

  console.log('  -> chunk loop done: ' + outRows.length + ' rows');
  return {
    headers: ['Date', 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'],
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

// ── Traffic_report output (date-wise already aata hai) ──
// ── Traffic_report output ──
// <=62 din: date-wise | >62 din: month-wise (khali months 0 ke saath)
function formatOutput(objs, df, dt) {
  const keys = Object.keys(objs[0]);
  const dateKey = keys.find(k => {
    const lk = k.toLowerCase();
    return lk === 'date' || lk === 'day' || lk === 'period' || /^\d{4}-\d{2}-\d{2}/.test(String(objs[0][k] || ''));
  });

  const findKey = (patterns) => keys.find(k => patterns.some(p => k.toLowerCase().indexOf(p) >= 0));
  const vKey = findKey(['visit']);
  const rKey = findKey(['registration', 'signup']);
  const fKey = findKey(['first_deposit', 'ftd']);
  const dKey = findKey(['deposits_sum', 'deposit_sum', 'deposits_amount']);
  const nKey = findKey(['ngr']);

  let monthly = false;
  if (df && dt) {
    const totalDays = Math.round((new Date(dt + 'T00:00:00Z') - new Date(df + 'T00:00:00Z')) / 86400000) + 1;
    monthly = totalDays > 62;
  }
  console.log('  -> formatOutput: ' + (monthly ? 'MONTHLY grouping' : 'daily rows'));

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const byDate = {};
  objs.forEach(o => {
    let d = dateKey ? String(o[dateKey]).substring(0, 10) : 'total';
    if (monthly && /^\d{4}-\d{2}/.test(d)) d = d.substring(0, 7);
    if (!byDate[d]) byDate[d] = { v: 0, r: 0, f: 0, dep: 0, n: 0 };
    byDate[d].v += parseFloat(o[vKey]) || 0;
    byDate[d].r += parseFloat(o[rKey]) || 0;
    byDate[d].f += parseFloat(o[fKey]) || 0;
    byDate[d].dep += parseFloat(o[dKey]) || 0;
    byDate[d].n += parseFloat(o[nKey]) || 0;
  });

  // ── Missing periods ko 0 ke saath fill karo ──
  if (df && dt) {
    if (monthly) {
      // Har month df→dt range mein
      let cur = new Date(Date.UTC(parseInt(df.substring(0, 4)), parseInt(df.substring(5, 7)) - 1, 1));
      const endM = new Date(Date.UTC(parseInt(dt.substring(0, 4)), parseInt(dt.substring(5, 7)) - 1, 1));
      while (cur <= endM) {
        const key = cur.toISOString().substring(0, 7);
        if (!byDate[key]) byDate[key] = { v: 0, r: 0, f: 0, dep: 0, n: 0 };
        cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
      }
    } else {
      // Har din df→dt range mein
      let cur = new Date(df + 'T00:00:00Z');
      const endD = new Date(dt + 'T00:00:00Z');
      while (cur <= endD) {
        const key = cur.toISOString().substring(0, 10);
        if (!byDate[key]) byDate[key] = { v: 0, r: 0, f: 0, dep: 0, n: 0 };
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    }
  }

  const rows = Object.keys(byDate).sort().map(d => {
    const x = byDate[d];
    let label = d;
    if (monthly && /^\d{4}-\d{2}$/.test(d)) {
      label = MONTH_NAMES[parseInt(d.substring(5, 7), 10) - 1] + ' ' + d.substring(0, 4);
    }
    return [label, String(x.v), String(x.r), String(x.f), x.dep.toFixed(2), x.n.toFixed(2)];
  });

  const dateHeader = monthly ? 'Month' : 'Date';
  return { headers: [dateHeader, 'Visits', 'Registrations', 'First Deposits', 'Deposits Sum', 'NGR'], rows };
}
// ── Chunk list: <=62 din → per day | >62 din → per month ──
function buildChunkList(df, dt) {
  const start = new Date(df + 'T00:00:00Z');
  const end = new Date(dt + 'T00:00:00Z');
  const totalDays = Math.round((end - start) / 86400000) + 1;
  const chunks = [];

  if (totalDays <= 62) {
    let d = new Date(start);
    while (d <= end) {
      const iso = d.toISOString().substring(0, 10);
      chunks.push({ from: iso, to: iso, label: iso });
      d.setUTCDate(d.getUTCDate() + 1);
    }
  } else {
    // Month-by-month (This Year / lambi ranges)
    let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    while (cur <= end) {
      const monthEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
      const chunkEnd = monthEnd > end ? end : monthEnd;
      const fromIso = cur.toISOString().substring(0, 10);
      const toIso = chunkEnd.toISOString().substring(0, 10);
      chunks.push({ from: fromIso, to: toIso, label: fromIso.substring(0, 7) }); // "2026-01"
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    }
  }
  return chunks;
}

module.exports = { scrape };