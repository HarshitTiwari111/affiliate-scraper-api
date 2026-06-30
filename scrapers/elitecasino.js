const puppeteer=require('puppeteer-extra');
const S=require('puppeteer-extra-plugin-stealth');
puppeteer.use(S());

async function scrape(c,df,dt,cp){
  const b=c.baseUrl.replace(/\/+$/,'');
  let br;
  try{
    br=await puppeteer.launch({headless:'new',executablePath:cp,
      args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process']});
    const p=await br.newPage();
    await p.setViewport({width:1280,height:800});
    
    // Login
    await p.goto(b+'/signin.php',{waitUntil:'networkidle2',timeout:45000});
    await new Promise(r=>setTimeout(r,2000)); // Wait for Cloudflare
    
    // Type credentials
    await p.waitForSelector('input[name="username"]',{timeout:10000});
    await p.type('input[name="username"]',c.username,{delay:50});
    await p.type('input[name="password"]',c.password,{delay:50});
    
    // Click submit button (not form.submit)
    await new Promise(r=>setTimeout(r,500));
    try{
      await Promise.all([
        p.waitForNavigation({waitUntil:'networkidle2',timeout:30000}),
        p.click('input[type="submit"], button[type="submit"], .btn-login, #login-btn')
      ]);
    }catch(e){
      // Fallback: try form submit
      await Promise.all([
        p.waitForNavigation({waitUntil:'networkidle2',timeout:30000}),
        p.evaluate(()=>{
          const forms=document.querySelectorAll('form');
          for(const f of forms){if(f.querySelector('input[name="password"]')){f.submit();return;}}
          document.querySelector('form').submit();
        })
      ]);
    }
    
    await new Promise(r=>setTimeout(r,2000));
    const url=p.url();
    console.log('Post-login URL:',url);
    
    if(url.includes('signin')){
      // Get page content for debugging
      const pageText=await p.evaluate(()=>document.body.innerText.substring(0,500));
      console.log('Page text:',pageText);
      throw new Error('Login failed - still on signin page. Check credentials.');
    }
    
    console.log('Login OK!');
    
    // Fetch report
    const sd=new Date(df+'T00:00:00'),ed=new Date(dt+'T00:00:00'),ds=Math.ceil((ed-sd)/864e5)+1;
    let ah=null,ar=[];
    if(ds<=35){const r=await fr(p,b,df,dt,true);ah=r.headers;ar=r.rows}
    else{let cs=new Date(sd);while(cs<=ed){const ce=new Date(cs.getFullYear(),cs.getMonth()+1,0);if(ce>ed)ce.setTime(ed.getTime());const r=await fr(p,b,fmt(cs),fmt(ce),false);if(!ah&&r.headers)ah=r.headers;ar=ar.concat(r.rows);cs=new Date(cs.getFullYear(),cs.getMonth()+1,1)}}
    
    const dd=[];ar.forEach(r=>{if(dd.length>0){const l=dd[dd.length-1];if(r.length===l.length&&r.every((c,i)=>c===l[i]))return}dd.push(r)});
    return{headers:ah||[],rows:dd};
  }finally{if(br)await br.close()}
}

async function fr(p,b,df,dt,sd){
  await p.goto(b+'/statistics.php?d1='+df+'&d2='+dt+(sd?'&sd=1':'')+'&sbm=1',{waitUntil:'networkidle2',timeout:30000});
  const d=await p.evaluate(()=>{
    const ts=document.querySelectorAll('table');if(!ts.length)return null;
    let bt=ts[0];for(let i=1;i<ts.length;i++)if(ts[i].rows.length>bt.rows.length)bt=ts[i];
    const h=[],r=[];
    bt.querySelector('tr')?.querySelectorAll('th,td').forEach(c=>h.push(c.innerText.trim()));
    const ar=bt.querySelectorAll('tr');
    for(let i=1;i<ar.length;i++){const cs=[];ar[i].querySelectorAll('td').forEach(c=>cs.push(c.innerText.trim()));if(cs.length>0&&cs.some(c=>c))r.push(cs)}
    return{headers:h,rows:r};
  });
  if(!d)return{headers:null,rows:[]};
  const hd=d.headers.some(h=>h.toLowerCase().includes('date'));
  let f=d.rows.filter(r=>hd?(r[0]||'').trim().length>0:true);
  if(!hd){d.headers.unshift('Date');f=f.map(r=>[df,...r])}
  return{headers:d.headers,rows:f};
}

function fmt(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
module.exports={scrape};