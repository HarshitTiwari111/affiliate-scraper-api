const express=require('express');
const app=express();
const PORT=process.env.PORT||10000;
const CHROME=process.env.PUPPETEER_EXECUTABLE_PATH||'/usr/bin/chromium';
app.use(express.json());
const ec=require('./scrapers/elitecasino');
const cx=require('./scrapers/cellxpert');
const vp=require('./scrapers/vpartners');
const sp=require('./scrapers/starzpartners');
app.get('/',(q,r)=>r.json({status:'ok'}));
app.get('/health',(q,r)=>r.json({status:'ok',chrome:CHROME}));
app.post('/scrape',async(q,r)=>{
  const{platform,dateFrom,dateTo,credentials}=q.body;
  if(!platform||!dateFrom||!dateTo||!credentials)return r.status(400).json({error:'Missing fields'});
  try{
    let result;
    switch(platform){
      case 'elitecasino':result=await ec.scrape(credentials,dateFrom,dateTo,CHROME);break;
      case 'cellxpert':result=await cx.scrape(credentials,dateFrom,dateTo);break;
      case 'vpartners':result=await vp.scrape(credentials,dateFrom,dateTo,CHROME);break;
      case 'starzpartners':result=await sp.scrape(credentials,dateFrom,dateTo,CHROME);break;
      default:return r.status(400).json({error:'Unknown: '+platform});
    }
    r.json({success:true,headers:result.headers,rows:result.rows});
  }catch(e){r.status(500).json({error:e.message})}
});
app.listen(PORT,()=>console.log('Running on '+PORT));