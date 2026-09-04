import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
import fs from 'node:fs'; import path from 'node:path';
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>-1?process.argv[i+1]:d;};
const has=n=>process.argv.includes('--'+n);
const START=arg('start'), W=+arg('w',1440), H=+arg('h',W<500?844:900), DELAY=+arg('delay',2000), TAG=arg('tag','act'), SEL=arg('sel'), KEY=arg('key'), WATCH=+arg('watch',4500);
const OUT=path.join('/tmp/claude-1000/loadaudit/acts',TAG); fs.mkdirSync(OUT,{recursive:true});
const b=await chromium.launch({headless:true});
const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:W,height:H},colorScheme:has('dark')?'dark':'light'});
const p=await c.newPage();
await p.addInitScript(()=>{const OW=window.WebSocket;window.WebSocket=function(u,pr){const a=Array.isArray(pr)?pr:(pr?[pr]:[]);if(a.includes('vite-hmr')||String(u).includes('vite'))return{readyState:3,close(){},send(){},addEventListener(){},removeEventListener(){}};return new OW(u,pr);};window.WebSocket.prototype=OW.prototype;});
let delayOn=false;
await p.route(u=>{try{const q=new URL(u);return q.pathname.startsWith('/api/')&&!q.pathname.startsWith('/api/events/stream');}catch{return false}}, async r=>{ if(delayOn) await new Promise(x=>setTimeout(x,DELAY)); return r.continue(); });
const fn = () => {
  const main=document.querySelector('main')||document.body;
  const dlg=document.querySelector('[role="dialog"]');
  const root=dlg||main;
  const b=[];
  (function walk(el,pth,d){ if(d>3) return; let i=0; for(const ch of el.children){const r=ch.getBoundingClientRect(); if(r.height>0&&r.width>0) b.push({k:pth+'/'+i+':'+ch.tagName.toLowerCase(),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),t:(ch.textContent||'').replace(/\s+/g,' ').trim().slice(0,34)}); walk(ch,pth+'/'+i+':'+ch.tagName.toLowerCase(),d+1); i++; } })(root,'',0);
  return {url:location.pathname+location.search, dialog:!!dlg, blocks:b,
    pulses:[...document.querySelectorAll('.animate-pulse,[class*="skeleton"]')].map(e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};}),
    spin:document.querySelectorAll('svg.animate-spin,[class*="animate-spin"]').length,
    txt:(root.innerText||'').replace(/\s+/g,' ').trim().length,
    rootH:Math.round(root.getBoundingClientRect().height), scrollH:document.documentElement.scrollHeight};
};
await p.goto(START,{waitUntil:'load',timeout:60000});
await p.waitForTimeout(2500);
const before=await p.evaluate(fn);
fs.writeFileSync(path.join(OUT,'0-before.png'), await p.screenshot());
delayOn=true;
const t0=Date.now();
if(SEL) await p.click(SEL,{timeout:10000}).catch(e=>console.log('CLICK FAIL',e.message.slice(0,80)));
if(KEY) await p.keyboard.press(KEY);
const seq=[]; let last='';
const end=Date.now()+WATCH;
let shots=0;
while(Date.now()<end){
  let s=null; try{s=await p.evaluate(fn);}catch{}
  if(s){ const sig=s.url+'|'+s.pulses.length+'|'+s.spin+'|'+s.txt+'|'+s.rootH+'|'+s.blocks.length;
    if(sig!==last){ seq.push({t:Date.now()-t0,...s}); last=sig;
      if(shots<8){ fs.writeFileSync(path.join(OUT,(shots+1)+'-t'+(Date.now()-t0)+'.png'), await p.screenshot()); shots++; } } }
  await new Promise(r=>setTimeout(r,100));
}
delayOn=false; await p.waitForTimeout(2500);
const after=await p.evaluate(fn); fs.writeFileSync(path.join(OUT,'9-after.png'), await p.screenshot());
console.log('=== '+TAG+'  '+START+' @'+W+'  action='+(SEL||KEY));
console.log('BEFORE url='+before.url+' txt='+before.txt+' rootH='+before.rootH);
for(const s of seq) console.log('  t='+String(s.t).padStart(5)+'ms url='+s.url.slice(0,46).padEnd(46)+' dlg='+(s.dialog?'Y':'n')+' pulses='+String(s.pulses.length).padStart(3)+' spin='+String(s.spin).padStart(2)+' txt='+String(s.txt).padStart(5)+' rootH='+String(s.rootH).padStart(5)+' scrollH='+String(s.scrollH).padStart(5));
console.log('AFTER  url='+after.url+' txt='+after.txt+' rootH='+after.rootH);
// landmark move between the first post-action rendered state and the final
const A=seq.find(s=>s.txt>0)||seq[0]||before, B=after;
if(A){ const m=new Map(A.blocks.filter(x=>x.t.length>2).map(x=>[x.t,x])); const mv=[];
 for(const x of B.blocks){ const a=m.get(x.t); if(a&&(Math.abs(a.y-x.y)>=4||Math.abs(a.x-x.x)>=4||Math.abs(a.h-x.h)>=4)) mv.push({t:x.t,dy:x.y-a.y,dx:x.x-a.x,dh:x.h-a.h,ay:a.y,by:x.y}); }
 mv.sort((u,v)=>Math.abs(v.dy)-Math.abs(u.dy));
 console.log('\n-- landmarks that moved between first painted state (t='+A.t+') and final --');
 for(const x of mv.slice(0,12)) console.log('   dy='+(x.dy>0?'+':'')+String(x.dy).padStart(5)+' dx='+(x.dx>0?'+':'')+String(x.dx).padStart(4)+' dh='+(x.dh>0?'+':'')+String(x.dh).padStart(5)+'  y '+x.ay+'->'+x.by+'  "'+x.t.slice(0,40)+'"');
 if(!mv.length) console.log('   (none)');
}
console.log('shots: '+OUT);
await b.close();
