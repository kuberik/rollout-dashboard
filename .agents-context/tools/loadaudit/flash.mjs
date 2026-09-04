import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const url = process.argv[2], W=+(process.argv[3]||1440);
const b = await chromium.launch({headless:true});
const c = await b.newContext({ignoreHTTPSErrors:true, viewport:{width:W,height:900}});
const p = await c.newPage();
const t0=Date.now();
await p.route(u=>{try{return new URL(u).pathname==='/api/rollouts';}catch{return false}}, async r=>{ await new Promise(x=>setTimeout(x,2000)); return r.continue(); });
p.on('request', r=>{const u=r.url(); if(/127.0.0.1:5173\/api\//.test(u)) console.log((Date.now()-t0+'').padStart(6),'REQ ',u.replace('https://127.0.0.1:5173',''));});
p.goto(url,{waitUntil:'commit',timeout:60000}).catch(()=>{});
let last='';
const end=Date.now()+22000;
const episodes=[];
while(Date.now()<end){
  let s=null; try{s=await p.evaluate(()=>({p:document.querySelectorAll('.animate-pulse').length,h:document.documentElement.scrollHeight,t:(document.querySelector('main')||document.body).innerText.replace(/\s+/g,' ').trim().length}));}catch{}
  if(s){const k=s.p+'|'+s.h+'|'+s.t; if(k!==last){console.log((Date.now()-t0+'').padStart(6),'STATE pulses='+s.p,'scrollH='+s.h,'textlen='+s.t); last=k;}}
  await new Promise(r=>setTimeout(r,100));
}
await b.close();
