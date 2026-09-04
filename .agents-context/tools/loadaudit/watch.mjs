import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const url = process.argv[2], SECS = +(process.argv[3]||30), DELAY=+(process.argv[4]||0);
const b = await chromium.launch({headless:true});
const c = await b.newContext({ignoreHTTPSErrors:true, viewport:{width:1440,height:900}});
const p = await c.newPage();
const t0=Date.now();
if (DELAY) await p.route(u=>{try{return new URL(u).pathname.startsWith('/api/')&&!/events\/stream/.test(u);}catch{return false}}, async r=>{await new Promise(x=>setTimeout(x,DELAY)); await r.continue();});
p.on('request', r=>{ const u=r.url(); if(/\/api\//.test(u)&&!/\/src\//.test(u)) console.log((Date.now()-t0+'').padStart(6),'REQ ', u.replace('https://127.0.0.1:5173','')); });
p.on('response', r=>{ const u=r.url(); if(/\/api\//.test(u)&&!/\/src\//.test(u)) console.log((Date.now()-t0+'').padStart(6),'RESP', u.replace('https://127.0.0.1:5173','')); });
await p.goto(url,{waitUntil:'commit',timeout:60000});
let last=null;
const end=Date.now()+SECS*1000;
while(Date.now()<end){
  let s=null; try{ s=await p.evaluate(()=>({p:document.querySelectorAll('.animate-pulse,[class*="skeleton"]').length, h:document.documentElement.scrollHeight, t:(document.querySelector('main')||document.body).innerText.replace(/\s+/g,' ').trim().length}));}catch{}
  if(s){ const k=s.p+'|'+s.h+'|'+s.t; if(k!==last){ console.log((Date.now()-t0+'').padStart(6),'STATE pulses='+s.p,'scrollH='+s.h,'textlen='+s.t); last=k; } }
  await new Promise(r=>setTimeout(r,120));
}
await b.close();
