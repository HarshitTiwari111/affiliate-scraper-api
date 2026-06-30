const puppeteer=require('puppeteer-extra');
const S=require('puppeteer-extra-plugin-stealth');
puppeteer.use(S());

async function scrape(c,df,dt,cp){
  if(!cp)throw new Error('Chrome path required');
  const baseUrl='https://track.betmenaffiliates.com';
  let br;
  try{
    br=await puppeteer.launch({headless:'new',executablePath:cp,
      args:[
        '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
        '--disable-gpu','--disable-software-rasterizer',
        '--disable-extensions','--disable-background-networking',
        '--disable-default-apps','--disable-sync','--disable-translate',
        '--metrics-recording-only','--no-first-run',
        '--js-flags=--max-old-space-size=256',
        '--disable-features=site-per-process'
      ]});
    const p=await br.newPage();
    
    // Block images/css/fonts to save memory
    await p.setRequestInterception(true);
    p.on('request',req=>{
      const rt=req.resourceType();
      if(['image','stylesheet','font','media'].includes(rt))req.abort();
      else req.continue();
    });
    
    await p.setViewport({width:1280,height:800});
    await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    
    console.log('  → Loading Betmen...');
    await p.goto(baseUrl+'/partner/login',{waitUntil:'domcontentloaded',timeout:60000});
    
    // Wait for Angular bootstrap
    console.log('  → Waiting for Angular...');
    let formFound=false;
    for(let i=0;i<12;i++){
      await new Promise(r=>setTimeout(r,5000));
      const count=await p.evaluate(()=>document.querySelectorAll('input').length);
      console.log('  → Attempt '+(i+1)+': '+count+' inputs found');
      if(count>=2){formFound=true;break;}
    }
    
    if(!formFound){
      // Try page reload
      console.log('  → Reloading page...');
      await p.reload({waitUntil:'domcontentloaded',timeout:60000});
      for(let i=0;i<6;i++){
        await new Promise(r=>setTimeout(r,5000));
        const count=await p.evaluate(()=>document.querySelectorAll('input').length);
        console.log('  → Reload attempt '+(i+1)+': '+count+' inputs');
        if(count>=2){formFound=true;break;}
      }
    }
    
    if(!formFound){
      const html=await p.content();
      console.log('  → Page HTML (first 500):',html.substring(0,500));
      throw new Error('Angular form did not render. Free plan memory limit.');
    }
    
    console.log('  → Form found! Filling credentials...');
    
    // Fill username
    await p.evaluate((u)=>{
      const inputs=document.querySelectorAll('input:not([type="hidden"]):not([type="password"])');
      for(const inp of inputs){
        inp.focus();inp.value=u;
        inp.dispatchEvent(new Event('input',{bubbles:true}));
        inp.dispatchEvent(new Event('change',{bubbles:true}));
        break;
      }
    },c.username||'');
    
    const ei=await p.$('input[type="email"],input[type="text"]');
    if(ei){await ei.click({clickCount:3});await ei.type(c.username||'',{delay:30});}
    
    await new Promise(r=>setTimeout(r,500));
    
    // Fill password
    await p.evaluate((pw)=>{
      const inp=document.querySelector('input[type="password"]');
      if(inp){inp.focus();inp.value=pw;
        inp.dispatchEvent(new Event('input',{bubbles:true}));
        inp.dispatchEvent(new Event('change',{bubbles:true}));}
    },c.password||'');
    
    const pi=await p.$('input[type="password"]');
    if(pi){await pi.click({clickCount:3});await pi.type(c.password||'',{delay:30});}
    
    await new Promise(r=>setTimeout(r,1000));
    
    // Submit
    const btn=await p.$('button[type="submit"],button.btn-primary');
    if(btn)await btn.click();
    else await p.keyboard.press('Enter');
    
    await new Promise(r=>setTimeout(r,10000));
    console.log('  → URL after login:',p.url());
    
    if(p.url().includes('/partner/login')){
      throw new Error('Login failed. Check credentials in Col C and Col J.');
    }
    
    // Go to reports
    await p.goto(baseUrl+'/partner/reports/media',{waitUntil:'domcontentloaded',timeout:30000});
    
    // Wait for table
    console.log('  → Waiting for report table...');
    try{await p.waitForSelector('table',{timeout:20000})}
    catch(e){
      await new Promise(r=>setTimeout(r,10000));
    }
    
    const data=await p.evaluate(()=>{
      const tables=document.querySelectorAll('table');
      if(!tables.length)return null;
      let best=tables[0];
      for(let i=1;i<tables.length;i++)if(tables[i].rows.length>best.rows.length)best=tables[i];
      const h=[],r=[];
      (best.querySelector('thead tr')||best.querySelector('tr'))?.querySelectorAll('th,td').forEach(c=>h.push(c.innerText.trim()));
      best.querySelectorAll('tbody tr').forEach(rr=>{
        const cs=[];rr.querySelectorAll('td').forEach(c=>cs.push(c.innerText.trim()));
        if(cs.length&&cs[0]!=='Total')r.push(cs);
      });
      return h.length&&r.length?{headers:h,rows:r}:null;
    });
    
    if(!data)throw new Error('No table found on reports page');
    console.log('  ✅ Got',data.rows.length,'rows');
    return data;
  }finally{if(br)await br.close()}
}

module.exports={scrape};