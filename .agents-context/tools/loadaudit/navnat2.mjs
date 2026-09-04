import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const W=+(process.argv[2]||1440), THROTTLE=process.argv[3]==='throttle';
const b=await chromium.launch({headless:true});
const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:W,height:900}});
const p=await c.newPage();
await p.addInitScript(()=>{const OW=window.WebSocket;window.WebSocket=function(u,pr){const a=Array.isArray(pr)?pr:(pr?[pr]:[]);if(a.includes('vite-hmr')||String(u).includes('vite'))return{readyState:3,close(){},send(){},addEventListener(){},removeEventListener(){}};return new OW(u,pr);};window.WebSocket.prototype=OW.prototype;});
if (THROTTLE){const cdp=await c.newCDPSession(p);await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:400,downloadThroughput:1500*1000/8,uploadThroughput:1500*1000/8});}
const fn = () => {
  const hdr = document.querySelector('header') || document.body;
  return [...hdr.querySelectorAll('button,a')].map(x => { const r = x.getBoundingClientRect();
    return { t: ((x.textContent||'') + ' ' + (x.getAttribute('aria-label')||'')).replace(/\s+/g,' ').trim().slice(0,20), x: Math.round(r.x), w: Math.round(r.width) }; }).filter(i => i.w > 0);
};
const t0=Date.now();
await p.goto('https://127.0.0.1:5173/',{waitUntil:'domcontentloaded'}).catch(()=>{});
let last='';
const end=Date.now()+(THROTTLE?16000:7000);
while(Date.now()<end){
  let s=null; try{ s=await p.evaluate(fn); }catch(e){ if(!globalThis.E){globalThis.E=1;console.log('ERR',e.message.slice(0,90));} }
  if(s){const k=JSON.stringify(s); if(k!==last){ console.log(String(Date.now()-t0).padStart(6)+'ms  '+s.map(i=>i.t+'@'+i.x+'/w'+i.w).join('  |  ')); last=k; }}
  await new Promise(r=>setTimeout(r,60));
}
await b.close();
