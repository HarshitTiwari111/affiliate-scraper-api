const puppeteer=require('puppeteer-extra');
const S=require('puppeteer-extra-plugin-stealth');puppeteer.use(S());
async function scrape(c,df,dt,cp){let br;
  try{br=await puppeteer.launch({headless:'new',executablePath:cp,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--single-process']});
    const p=await br.newPage();
    await p.goto((c.baseUrl||'https://starzpartners.com')+'/partner/login',{waitUntil:'networkidle2',timeout:45000});
    await new Promise(r=>setTimeout(r,3000));
    for(const s of['input[type="email"]','input[type="text"]']){const e=await p.$(s);if(e){await e.type(c.username,{delay:30});break}}
    const pp=await p.$('input[type="password"]');if(pp)await pp.type(c.password,{delay:30});
    try{await Promise.all([p.waitForNavigation({waitUntil:'networkidle2',timeout:20000}).catch(()=>{}),p.click('button[type="submit"]').catch(()=>p.keyboard.press('Enter'))])}catch(e){}
    await new Promise(r=>setTimeout(r,5000));
    if(p.url().includes('login'))throw new Error('Login failed');
    for(const rp of['/partner/statistics','/partner/reports']){try{await p.goto((c.baseUrl||'https://starzpartners.com')+rp,{waitUntil:'networkidle2',timeout:20000});await new Promise(r=>setTimeout(r,3000));const has=await p.evaluate(()=>document.querySelectorAll('table').length>0);if(has)break}catch(e){}}
    const d=await p.evaluate(()=>{const t=document.querySelector('table');if(!t)return null;const h=[],r=[];t.querySelector('thead tr,tr')?.querySelectorAll('th,td').forEach(c=>h.push(c.innerText.trim()));t.querySelectorAll('tbody tr').forEach(rr=>{const cs=[];rr.querySelectorAll('td').forEach(c=>cs.push(c.innerText.trim()));if(cs.length)r.push(cs)});return h.length&&r.length?{headers:h,rows:r}:null});
    if(!d)throw new Error('No data found');return d;
  }finally{if(br)await br.close()}}
module.exports={scrape};