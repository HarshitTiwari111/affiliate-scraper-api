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
    await p.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    
    await p.goto(b+'/signin.php',{waitUntil:'networkidle2',timeout:45000});
    await new Promise(r=>setTimeout(r,3000));
    
    // STEP 1: Handle "are you a robot?" - find ALL clickable elements and check them
    const robotHandled=await p.evaluate(()=>{
      // Find all checkboxes and click them
      const cbs=document.querySelectorAll('input[type="checkbox"]');
      cbs.forEach(cb=>{if(!cb.checked)cb.click()});
      
      // Find any element with "robot" text and click nearby inputs
      const allElements=document.querySelectorAll('*');
      for(const el of allElements){
        if(el.innerText&&el.innerText.toLowerCase().includes('robot')&&el.tagName!=='SCRIPT'){
          // Click the element itself
          el.click();
          // Find nearby checkbox/input
          const parent=el.closest('div,label,span,p,li');
          if(parent){
            const inp=parent.querySelector('input');
            if(inp)inp.click();
          }
          break;
        }
      }
      return document.querySelectorAll('input[type="checkbox"]').length;
    });
    console.log('Robot checkboxes found:',robotHandled);
    await new Promise(r=>setTimeout(r,2000));
    
    // STEP 2: Get full HTML to see what's on page
    const formHTML=await p.evaluate(()=>{
      const form=document.querySelector('form');
      return form?form.innerHTML.substring(0,1000):'NO FORM';
    });
    console.log('Form HTML:',formHTML);
    
    // STEP 3: Type credentials
    await p.waitForSelector('input[name="username"]',{timeout:10000});
    await p.type('input[name="username"]',c.username,{delay:100});
    await new Promise(r=>setTimeout(r,1000));
    await p.type('input[name="password"]',c.password,{delay:100});
    await new Promise(r=>setTimeout(r,2000));
    
    // STEP 4: Submit
    try{
      await Promise.all([
        p.waitForNavigation({waitUntil:'networkidle2',timeout:30000}),
        p.click('input[type="submit"],button[type="submit"]')
      ]);
    }catch(e){
      await Promise.all([
        p.waitForNavigation({waitUntil:'networkidle2',timeout:30000}),
        p.evaluate(()=>document.querySelector('form').submit())
      ]);
    }
    
    await new Promise(r=>setTimeout(r,3000));
    const url=p.url();
    
    if(url.includes('signin')){
      const pageText=await p.evaluate(()=>document.body.innerText.substring(0,500));
      throw new Error('Login failed. Page: '+pageText.substring(0,300));
    }
    
    console.log('Login OK!');
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