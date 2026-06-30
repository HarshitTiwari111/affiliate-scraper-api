const https=require('https');
async function scrape(c,df,dt){
  const ak=c.apiKey,ab=(c.apiBase||'https://affiliateapi.cellxpert.com').replace(/\/+$/,'');
  const auths=[{'api-key':ak},{'x-api-key':ak},{'Authorization':'Bearer '+ak}];
  const eps=['/v2/affiliate/reports/quick-statistics','/v2/affiliate/reports','/affiliate/reports','/v2/reports'];
  let le='';
  for(const a of auths){for(const e of eps){
    const u=ab+e+'?dateFrom='+df+'&dateTo='+dt+'&limit=1000';
    try{const data=await fj(u,{...a,Accept:'application/json'});
      if(data){const rec=data.data||data.records||data.results||(Array.isArray(data)?data:null);
        if(rec&&rec.length>0){const ks=Object.keys(rec[0]);
          return{headers:ks.map(k=>k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())),rows:rec.map(r=>ks.map(k=>String(r[k]??'')))}}}}
    catch(e){if(e.status===403)le='Auth failed';else if(e.status!==404)le=e.message}}}
  throw new Error('Cellxpert: no endpoint worked. '+le);
}
function fj(u,h){return new Promise((res,rej)=>{https.get(u,{headers:h,timeout:15000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{if(r.statusCode===200)try{res(JSON.parse(d))}catch(e){rej(new Error('Bad JSON'))}else{const e=new Error('HTTP '+r.statusCode);e.status=r.statusCode;rej(e)}})}).on('error',rej)})}
module.exports={scrape};