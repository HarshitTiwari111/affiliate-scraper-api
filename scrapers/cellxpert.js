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
    
    console.log('  → Loading Betmen...');
    await p.goto(baseUrl+'/partner/login',{waitUntil:'networkidle2',timeout:45000});
    await new Promise(r=>setTimeout(r,5000));
    
    // Log page state
    const pageInfo=await p.evaluate(()=>{
      const inputs=document.querySelectorAll('input');
      const info=[];
      inputs.forEach(i=>info.push(i.type+'|'+i.name+'|'+(i.placeholder||'')));
      return{text:document.body.innerText.substring(0,200),inputs:info,url:location.href};
    });
    console.log('  → URL:',pageInfo.url);
    console.log('  → Inputs:',JSON.stringify(pageInfo.inputs));
    
    // Fill username - Angular way (set value + dispatch events)
    await p.evaluate((username)=>{
      const inputs=document.querySelectorAll('input:not([type="hidden"]):not([type="password"])');
      for(const inp of inputs){
        if(inp.type==='email'||inp.type==='text'||inp.name.includes('email')||inp.name.includes('user')||inp.name.includes('login')||inp.placeholder.toLowerCase().includes('email')||inp.placeholder.toLowerCase().includes('user')){
          inp.focus();
          inp.value=username;
          inp.dispatchEvent(new Event('input',{bubbles:true}));
          inp.dispatchEvent(new Event('change',{bubbles:true}));
          inp.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
          break;
        }
      }
    },c.username||'');
    
    await new Promise(r=>setTimeout(r,500));
    
    // Also type it for safety
    const emailInput=await p.$('input[type="email"],input[type="text"],input[name="email"],input[placeholder*="mail"],input[placeholder*="user"]');
    if(emailInput){
      await emailInput.click({clickCount:3}); // select all
      await emailInput.type(c.username||'',{delay:50});
    }
    
    await new Promise(r=>setTimeout(r,1000));
    
    // Fill password - Angular way
    await p.evaluate((password)=>{
      const inp=document.querySelector('input[type="password"]');
      if(inp){
        inp.focus();
        inp.value=password;
        inp.dispatchEvent(new Event('input',{bubbles:true}));
        inp.dispatchEvent(new Event('change',{bubbles:true}));
        inp.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));
      }
    },c.password||'');
    
    await new Promise(r=>setTimeout(r,500));
    
    // Also type it
    const passInput=await p.$('input[type="password"]');
    if(passInput){
      await passInput.click({clickCount:3});
      await passInput.type(c.password||'',{delay:50});
    }
    
    await new Promise(r=>setTimeout(r,2000));
    
    // Submit - try button click then Enter
    const submitted=await p.evaluate(()=>{
      const btn=document.querySelector('button[type="submit"],button.btn-primary,button.login-btn,input[type="submit"]');
      if(btn){btn.click();return 'button:'+btn.innerText}
      return null;
    });
    console.log('  → Submit:',submitted||'no button found, pressing Enter');
    if(!submitted)await p.keyboard.press('Enter');
    
    // Wait for navigation
    await new Promise(r=>setTimeout(r,10000));
    
    const finalUrl=p.url();
    console.log('  → Final URL:',finalUrl);
    
    // Check login result
    if(finalUrl.includes('/partner/login')||finalUrl.includes('/login')){
      const txt=await p.evaluate(()=>document.body.innerText.substring(0,300));
      // Maybe credentials wrong or Angular didn't submit
      throw new Error('Login failed. URL: '+finalUrl+' Page: '+txt.substring(0,150));
    }
    
    console.log('  → Login OK!');
    
    // Navigate to Media Report
    await p.goto(baseUrl+'/partner/reports/media',{waitUntil:'networkidle2',timeout:30000});
    await new Promise(r=>setTimeout(r,8000));
    
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