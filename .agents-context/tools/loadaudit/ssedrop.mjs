import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const url = process.argv[2];
const b = await chromium.launch({headless:true});
const c = await b.newContext({ignoreHTTPSErrors:true, viewport:{width:1440,height:900}});
const p = await c.newPage();
const t0=Date.now(); let dropped=false;
// after render, delay every /api/ response by 1500ms so any re-entry is visible
await p.route(u=>{try{const q=new URL(u); return q.pathname.startsWith('/api/');}catch{return false}}, async r=>{
  const u=r.request().url();
  if (/events\/stream/.test(u) && dropped) { console.log((Date.now()-t0+'').padStart(6),'ABORT sse'); return r.abort(); }
  if (dropped && !/events\/stream/.test(u)) { await new Promise(x=>setTimeout(x,1500)); }
  return r.continue();
});
p.on('request', r=>{const u=r.url(); if(/127.0.0.1:5173\/api\//.test(u)) console.log((Date.now()-t0+'').padStart(6),'REQ ',u.replace('https://127.0.0.1:5173',''));});
await p.goto(url,{waitUntil:'load',timeout:60000});
await p.waitForTimeout(3000);
const before = await p.evaluate(()=>({p:document.querySelectorAll('.animate-pulse, .skel-block').length,t:(document.querySelector('main')).innerText.length}));
console.log('BEFORE', JSON.stringify(before));
dropped=true;
// kill the live SSE connection from inside the page
await p.evaluate(()=>{ /* force offline/online to make EventSource reconnect */ });
const cdp = await c.newCDPSession(p);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
await p.waitForTimeout(900);
await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
let worst=0, log=[];
const end=Date.now()+14000;
let last='';
while(Date.now()<end){
  let s=null; try{s=await p.evaluate(()=>({p:document.querySelectorAll('.animate-pulse, .skel-block').length,h:document.documentElement.scrollHeight,t:document.querySelector('main').innerText.replace(/\s+/g,' ').trim().length}));}catch{}
  if(s){ const k=s.p+'|'+s.h+'|'+s.t; if(k!==last){console.log((Date.now()-t0+'').padStart(6),'STATE pulses='+s.p,'scrollH='+s.h,'textlen='+s.t); last=k;} worst=Math.max(worst,s.p);}
  await new Promise(r=>setTimeout(r,100));
}
console.log('MAX pulses after drop:', worst);
await b.close();
