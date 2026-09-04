import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const W=+(process.argv[2]||1440), DELAY=+(process.argv[3]||2500);
const b=await chromium.launch({headless:true});
const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:W,height:W<500?844:900}});
const p=await c.newPage();
await p.addInitScript(()=>{const OW=window.WebSocket;window.WebSocket=function(u,pr){const a=Array.isArray(pr)?pr:(pr?[pr]:[]);if(a.includes('vite-hmr')||String(u).includes('vite'))return{readyState:3,close(){},send(){},addEventListener(){},removeEventListener(){}};return new OW(u,pr);};window.WebSocket.prototype=OW.prototype;});
let on=false;
await p.route(u=>{try{const q=new URL(u);return q.pathname.startsWith('/api/')&&!q.pathname.startsWith('/api/events/stream');}catch{return false}}, async r=>{ if(on) await new Promise(x=>setTimeout(x,DELAY)); return r.continue(); });
p.on('request', r=>{const u=r.url(); if(/127.0.0.1:5173\/api\//.test(u)) console.log('   REQ '+u.replace('https://127.0.0.1:5173',''));});
await p.goto('https://127.0.0.1:5173/rollouts/prod/hello-world-prod/hello-world-app',{waitUntil:'load'});
await p.waitForTimeout(2500);
const fn=()=>{const d=document.querySelector('[role="dialog"]'); if(!d) return null; const r=d.getBoundingClientRect();
 const items=[...d.querySelectorAll('li,[role="option"],button')].length;
 return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),items,
  pulses:d.querySelectorAll('.animate-pulse,[class*="skeleton"]').length, spin:d.querySelectorAll('[class*="animate-spin"]').length,
  txt:d.innerText.replace(/\s+/g,' ').trim().length, head:d.innerText.replace(/\s+/g,' ').trim().slice(0,70)};};
on=true;
const t0=Date.now();
await p.click('button:has-text("Change Version")');
let last='';
for(let i=0;i<70;i++){ let s=null; try{s=await p.evaluate(fn);}catch{}
 const k=s?JSON.stringify(s):'null'; if(k!==last){ console.log(String(Date.now()-t0).padStart(6)+'ms '+(s?('rect '+s.x+','+s.y+' '+s.w+'x'+s.h+'  items='+s.items+' pulses='+s.pulses+' spin='+s.spin+' txt='+s.txt+'  | '+s.head):'no dialog')); last=k; }
 await new Promise(r=>setTimeout(r,90)); }
fs.writeFileSync('/tmp/claude-1000/loadaudit/dlg-step1.png', await p.screenshot());
// step 2: pick a version and continue
const btn = await p.$$('[role="dialog"] button');
console.log('\n--- attempting step 2 ---');
const labels = await p.evaluate(()=>[...document.querySelectorAll('[role="dialog"] button')].map(b=>b.textContent.replace(/\s+/g,' ').trim().slice(0,40)));
console.log('buttons:', JSON.stringify(labels));
await b.close();
