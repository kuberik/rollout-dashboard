import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const W=+(process.argv[2]||1440);
const b=await chromium.launch({headless:true});
const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:W,height:W<500?844:900}});
const p=await c.newPage();
await p.addInitScript(()=>{const OW=window.WebSocket;window.WebSocket=function(u,pr){const a=Array.isArray(pr)?pr:(pr?[pr]:[]);if(a.includes('vite-hmr')||String(u).includes('vite'))return{readyState:3,close(){},send(){},addEventListener(){},removeEventListener(){}};return new OW(u,pr);};window.WebSocket.prototype=OW.prototype;});
const fn=()=>[...document.querySelectorAll('main button')].map(e=>{const r=e.getBoundingClientRect();return {t:(e.textContent||'').replace(/\s+/g,' ').trim().slice(0,16),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width)};}).filter(i=>i.w>0&&i.y>150&&i.y<230);
await p.goto('https://127.0.0.1:5173/rollouts/prod/hello-world-prod/hello-world-app/logs',{waitUntil:'commit'});
let last='';
for(let i=0;i<70;i++){ let s=null; try{s=await p.evaluate(fn);}catch{}
 const k=JSON.stringify(s); if(k!==last){ console.log(String(i*100)+'ms '+k); last=k; }
 await new Promise(r=>setTimeout(r,100)); }
await b.close();
