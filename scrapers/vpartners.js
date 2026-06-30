const puppeteer=require('puppeteer-extra');
const S=require('puppeteer-extra-plugin-stealth');puppeteer.use(S());
async function scrape(c,df,dt,cp){let br;
  try{br=await puppeteer.launch({headless:'new',executablePath:cp,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--single-process']});
    const p=await br.newPage();
    await p.goto(c.baseUrl||'https://v.partners',{waitUntil:'networkidle2',timeout:30000});
    try{await p.click('[data-popup-modal="login"]');await new Promise(r=>setTimeout(r,2000))}catch(e){}
    const ef=await p.$('input[name="data[Webmaster][email]"],input[type="email"]');
    const pf=await p.$('input[name="data[Webmaster][pass]"],input[type="password"]');
    if(!ef||!pf)throw new Error('Login form not found');
    await ef.type(c.email,{delay:50});await pf.type(c.password,{delay:50});
    try{await Promise.all([p.waitForNavigation({waitUntil:'networkidle2',timeout:15000}),p.click('input[type="submit"],button[type="submit"]')])}
    catch(e){const hr=await p.evaluate(()=>!!document.querySelector('.g-recaptcha'));if(hr)throw new Error('reCAPTCHA blocked');throw e}
    await p.goto((c.baseUrl||'https://v.partners')+'/webmasters/statistics',{waitUntil:'networkidle2',timeout:30000});
    const d=await p.evaluate(()=>{const t=document.querySelector('table');if(!t)return null;const h=[],r=[];t.querySelector('tr')?.querySelectorAll('th,td').forEach(c=>h.push(c.innerText.trim()));t.querySelectorAll('tbody tr').forEach(rr=>{const cs=[];rr.querySelectorAll('td').forEach(c=>cs.push(c.innerText.trim()));if(cs.length)r.push(cs)});return h.length&&r.length?{headers:h,rows:r}:null});
    if(!d)throw new Error('No data found');return d;
  }finally{if(br)await br.close()}}
module.exports={scrape};