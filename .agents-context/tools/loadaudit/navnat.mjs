import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const W=+(process.argv[2]||1440), THROTTLE=process.argv[3]==='throttle';
const b=await chromium.launch({headless:true});
const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:W,height:900}});
const p=await c.newPage();
await p.addInitScript(()=>{const OW=window.WebSocket;window.WebSocket=function(u,pr){const a=Array.isArray(pr)?pr:(pr?[pr]:[]);if(a.includes('vite-hmr')||String(u).includes('vite'))return{readyState:3,close(){},send(){},addEventListener(){},removeEventListener(){}};return new OW(u,pr);};window.WebSocket.prototype=OW.prototype;});
if (THROTTLE) { const cdp=await c.newCDPSession(p); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:400,downloadThroughput:1500*1000/8,uploadThroughput:1500*1000/8}); }
const t0=Date.now();
p.goto('https://127.0.0.1:5173/',{waitUntil:'commit'}).catch(()=>{});
let last='';
const end=Date.now()+(THROTTLE?15000:6000);
while(Date.now()<end){
  let s=null; try{s=await p.evaluate(`(()=>{const hdr=document.querySelector('header')||document.body;
   const items=[...hdr.querySelectorAll('button,a')].map(x=>{const r=x.getBoundingClientRect();return {t:((x.textContent||'')+' '+(x.getAttribute('aria-label')||'')).replace(/\\s+/g,' ').trim().slice(0,22),x:Math.round(r.x),w:Math.round(r.width)};}).filter(i=>i.w>0);
   return items;})()`);}catch(e){}
  if(s){const k=JSON.stringify(s); if(k!==last){console.log((Date.now()-t0+'').padStart(6)+'ms  '+s.map(i=>i.t+'@'+i.x+'w'+i.w).join('  |  ')); last=k;}}
  await new Promise(r=>setTimeout(r,60));
}
await b.close();
