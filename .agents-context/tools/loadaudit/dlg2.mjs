import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const W=+(process.argv[2]||1440);
const b=await chromium.launch({headless:true});
const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:W,height:W<500?844:900}});
const p=await c.newPage();
await p.addInitScript(()=>{const OW=window.WebSocket;window.WebSocket=function(u,pr){const a=Array.isArray(pr)?pr:(pr?[pr]:[]);if(a.includes('vite-hmr')||String(u).includes('vite'))return{readyState:3,close(){},send(){},addEventListener(){},removeEventListener(){}};return new OW(u,pr);};window.WebSocket.prototype=OW.prototype;});
let on=false;
await p.route(u=>{try{const q=new URL(u);return q.pathname.startsWith('/api/')&&!q.pathname.startsWith('/api/events/stream');}catch{return false}}, async r=>{ if(on) await new Promise(x=>setTimeout(x,2500)); return r.continue(); });
await p.goto('https://127.0.0.1:5173/rollouts/prod/hello-world-prod/hello-world-app',{waitUntil:'load'});
await p.waitForTimeout(2500);
await p.click('button:has-text("Change Version")'); await p.waitForTimeout(600);
const fn=()=>{const d=document.querySelector('[role="dialog"]'); if(!d) return null; const r=d.getBoundingClientRect();
 return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),
  pulses:d.querySelectorAll('.animate-pulse,[class*="skeleton"]').length, spin:d.querySelectorAll('[class*="animate-spin"]').length,
  txt:d.innerText.replace(/\s+/g,' ').trim().length, head:d.innerText.replace(/\s+/g,' ').trim().slice(0,90)};};
console.log('STEP1', JSON.stringify(await p.evaluate(fn)));
fs.writeFileSync('/tmp/claude-1000/loadaudit/dlgA.png', await p.screenshot());
on=true; const t0=Date.now();
await p.click('[role="dialog"] button:has-text("0afab6f")');
let last='';
for(let i=0;i<60;i++){ let s=null; try{s=await p.evaluate(fn);}catch{}
 const k=s?JSON.stringify(s):'null'; if(k!==last){ console.log(String(Date.now()-t0).padStart(6)+'ms '+(s?(s.x+','+s.y+' '+s.w+'x'+s.h+' pulses='+s.pulses+' spin='+s.spin+' txt='+s.txt+' | '+s.head):'CLOSED')); last=k; }
 await new Promise(r=>setTimeout(r,90)); }
fs.writeFileSync('/tmp/claude-1000/loadaudit/dlgB.png', await p.screenshot());
await b.close();
