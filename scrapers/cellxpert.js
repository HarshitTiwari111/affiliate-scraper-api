const puppeteer=require('puppeteer-extra');
const S=require('puppeteer-extra-plugin-stealth');
puppeteer.use(S());

async function scrape(c,df,dt,cp){
  if(!cp)throw new Error('Chrome path required');
  const baseUrl='https://track.betmenaffiliates.com';
  let br;
  try{
    br=await puppeteer.launch({headless:'new',executablePath:cp,
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process']});
    const p=await br.newPage();
    await p.setViewport({width:1280,height:800});
    await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    
    console.log('  → Loading Betmen login...');
    await p.goto(baseUrl+'/partner/login',{waitUntil:'networkidle2',timeout:45000});
    await new Promise(r=>setTimeout(r,5000)); // Angular render wait
    
    // Log what's on page
    const pageContent=await p.evaluate(()=>document.body.innerText.substring(0,300));
    console.log('  → Page:',pageContent.substring(0,100));
    
    // Try multiple input selectors for Angular
    const inputSelectors=[
      'input[type="email"]','input[type="text"]','input[name="email"]',
      'input[name="username"]','input[name="login"]','input[formcontrolname="email"]',
      'input[formcontrolname="username"]','input[formcontrolname="login"]',
      'input[placeholder*="mail"]','input[placeholder*="user"]','input[placeholder*="login"]'
    ];
    
    let emailFilled=false;
    for(const sel of inputSelectors){
      const el=await p.$(sel);
      if(el){
        await el.click();
        await el.type(c.username||c.apiKey||'',{delay:80});
        console.log('  → Username filled with:',sel);
        emailFilled=true;
        break;
      }
    }
    if(!emailFilled){
      // Try first visible input
      await p.evaluate((u)=>{
        const inputs=document.querySelectorAll('input:not([type="hidden"])');
        if(inputs[0]){inputs[0].value=u;inputs[0].dispatchEvent(new Event('input',{bubbles:true}))}
      },c.username||'');
      console.log('  → Username filled via JS');
    }
    
    await new Promise(r=>setTimeout(r,1000));
    
    // Password
    const passEl=await p.$('input[type="password"]');
    if(passEl){
      await passEl.click();
      await passEl.type(c.password||'',{delay:80});
      console.log('  → Password filled');
    }else{
      await p.evaluate((pw)=>{
        const inputs=document.querySelectorAll('input[type="password"]');
        if(inputs[0]){inputs[0].value=pw;inputs[0].dispatchEvent(new Event('input',{bubbles:true}))}
      },c.password||'');
    }
    
    await new Promise(r=>setTimeout(r,2000));
    
    // Submit
    try{
      await Promise.all([
        p.waitForNavigation({waitUntil:'networkidle2',timeout:30000}).catch(()=>{}),
        p.click('button[type="submit"],input[type="submit"],button.btn-primary,.login-btn').catch(()=>p.keyboard.press('Enter'))
      ]);
    }catch(e){await p.keyboard.press('Enter')}
    
    await new Promise(r=>setTimeout(r,8000)); // Angular route change wait
    const url=p.url();
    console.log('  → Post-login URL:',url);
    
    if(url.includes('login')){
      const txt=await p.evaluate(()=>document.body.innerText.substring(0,300));
      throw new Error('Login failed. Page: '+txt.substring(0,200));
    }
    
    console.log('  → Login OK! Navigating to reports...');
    
    // Go to Media Report
    await p.goto(baseUrl+'/partner/reports/media',{waitUntil:'networkidle2',timeout:30000});
    await new Promise(r=>setTimeout(r,6000)); // Angular render
    
    // Extract table
    const data=await p.evaluate(()=>{
      const tables=document.querySelectorAll('table');
      if(tables.length>0){
        let best=tables[0];
        for(let i=1;i<tables.length;i++)if(tables[i].rows.length>best.rows.length)best=tables[i];
        const h=[],r=[];
        (best.querySelector('thead tr')||best.querySelector('tr'))?.querySelectorAll('th,td').forEach(c=>h.push(c.innerText.trim()));
        best.querySelectorAll('tbody tr').forEach(rr=>{
          const cs=[];rr.querySelectorAll('td').forEach(c=>cs.push(c.innerText.trim()));
          if(cs.length&&cs[0]!=='Total')r.push(cs);
        });
        if(h.length&&r.length)return{headers:h,rows:r};
      }
      return null;
    });
    
    if(!data){
      const txt=await p.evaluate(()=>document.body.innerText.substring(0,500));
      throw new Error('No table found. Page: '+txt.substring(0,300));
    }
    
    console.log('  ✅ Got',data.rows.length,'rows');
    return data;
  }finally{if(br)await br.close()}
}

module.exports={scrape};