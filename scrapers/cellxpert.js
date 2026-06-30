const puppeteer=require('puppeteer-extra');
const S=require('puppeteer-extra-plugin-stealth');
puppeteer.use(S());

async function scrape(c,df,dt,cp){
  // If chromePath provided, use Puppeteer to scrape dashboard
  if(cp){return scrapeDashboard(c,df,dt,cp)}
  
  // Fallback: try API
  throw new Error('Cellxpert API not working. Use Puppeteer mode.');
}

async function scrapeDashboard(c,df,dt,cp){
  const baseUrl='https://track.betmenaffiliates.com';
  let br;
  try{
    br=await puppeteer.launch({headless:'new',executablePath:cp,
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process']});
    const p=await br.newPage();
    await p.setViewport({width:1280,height:800});
    
    // Go to login
    console.log('  → Loading Betmen login...');
    await p.goto(baseUrl+'/partner/',{waitUntil:'networkidle2',timeout:45000});
   await new Promise(r=>setTimeout(r,6000));
    
    // Wait for Angular to render
    await p.waitForSelector('input[type="email"],input[type="text"],input[name="email"],input[name="username"]',{timeout:15000});
    
    // Find and fill email/username
    for(const sel of['input[type="email"]','input[name="email"]','input[name="username"]','input[type="text"]']){
      const el=await p.$(sel);
      if(el){await el.type(c.username||c.apiKey||'',{delay:50});break;}
    }
    
    // Fill password if provided
    if(c.password){
      const pp=await p.$('input[type="password"]');
      if(pp)await pp.type(c.password,{delay:50});
    }
    
    // Submit
    await new Promise(r=>setTimeout(r,1000));
    try{
      await Promise.all([
        p.waitForNavigation({waitUntil:'networkidle2',timeout:30000}).catch(()=>{}),
        p.click('button[type="submit"],input[type="submit"],.login-btn,button.btn-primary').catch(()=>p.keyboard.press('Enter'))
      ]);
    }catch(e){}
    
    await new Promise(r=>setTimeout(r,5000));
    console.log('  → Current URL:',p.url());
    
    // Navigate to reports/statistics
const reportPaths=['/partner/reports/media','/partner/reports/earnings','/partner/reports/registrations','/partner/reports'];
    for(const rp of reportPaths){
      try{
        await p.goto(baseUrl+rp,{waitUntil:'networkidle2',timeout:20000});
       await new Promise(r=>setTimeout(r,6000));
        const hasData=await p.evaluate(()=>{
          return document.querySelectorAll('table').length>0||
                 document.querySelectorAll('[class*="table"],[class*="grid"],[class*="report"]').length>0;
        });
        if(hasData){console.log('  → Found data at:',rp);break;}
      }catch(e){}
    }
    
    // Extract table data
    const data=await p.evaluate(()=>{
      const tables=document.querySelectorAll('table');
      if(tables.length>0){
        let best=tables[0];
        for(let i=1;i<tables.length;i++)if(tables[i].rows.length>best.rows.length)best=tables[i];
        const h=[],r=[];
        (best.querySelector('thead tr')||best.querySelector('tr'))?.querySelectorAll('th,td').forEach(c=>h.push(c.innerText.trim()));
        best.querySelectorAll('tbody tr').forEach(rr=>{
          const cs=[];rr.querySelectorAll('td').forEach(c=>cs.push(c.innerText.trim()));
          if(cs.length)r.push(cs);
        });
        if(h.length&&r.length)return{headers:h,rows:r};
      }
      // Try div-based data
      const text=document.body.innerText;
      return{headers:['Page Content'],rows:[[text.substring(0,1000)]]};
    });
    
    if(!data||!data.rows.length)throw new Error('No data found on Betmen dashboard');
    console.log('  ✅ Got',data.rows.length,'rows');
    return data;
  }finally{if(br)await br.close()}
}

module.exports={scrape};