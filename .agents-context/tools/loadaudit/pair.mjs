#!/usr/bin/env node
// pair.mjs — capture the LOADING state and the LOADED state of a route with the
// same instrument, and report the geometry difference slot by slot.
// Guards against Vite HMR full-reloads (this dev checkout reloads itself).
//   node pair.mjs --url ... --w 1440 --tag home-1440 [--delay 2000] [--dark] [--tab 'text=History']
import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
import fs from 'node:fs'; import path from 'node:path';
const arg=(n,d)=>{const i=process.argv.indexOf('--'+n);return i>-1?process.argv[i+1]:d;};
const has=(n)=>process.argv.includes('--'+n);
const URL_=arg('url'), W=+arg('w',1440), H=+arg('h',W<500?844:900), DELAY=+arg('delay',2000), TAG=arg('tag','pair');
const OUT=path.join('/tmp/claude-1000/loadaudit/pairs',TAG); fs.mkdirSync(OUT,{recursive:true});

const PROBE=`(() => {
  const norm=s=>(s||'').replace(/\\s+/g,' ').trim().slice(0,60);
  const main=document.querySelector('main')||document.body;
  const blocks=[];
  (function walk(el,p,d){ if(d>4) return; let i=0;
    for(const ch of el.children){ const r=ch.getBoundingClientRect();
      if(r.height>0&&r.width>0) blocks.push({k:p+'/'+i+':'+ch.tagName.toLowerCase(),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cls:String(ch.className&&ch.className.baseVal!==undefined?ch.className.baseVal:ch.className||'').slice(0,70),txt:norm(ch.textContent).slice(0,40)});
      walk(ch,p+'/'+i+':'+ch.tagName.toLowerCase(),d+1); i++; } })(main,'',0);
  const pulses=[...document.querySelectorAll('.animate-pulse,[class*="skeleton"]')].map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cls:String(e.className).slice(0,80)};});
  const cards=[...document.querySelectorAll('main [class*="rounded-xl"],main [class*="rounded-lg"],main section,main article')].map(e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),t:norm(e.textContent).slice(0,34)};}).filter(c=>c.h>24&&c.w>60);
  return {blocks,pulses,cards,mainRect:(()=>{const r=main.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})(),
    scrollH:document.documentElement.scrollHeight, txt:norm(main.innerText).length,
    spinners:document.querySelectorAll('svg.animate-spin,[class*="animate-spin"],[role="progressbar"]').length};
})()`;

const b=await chromium.launch({headless:true});
const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:W,height:H},deviceScaleFactor:1,colorScheme:has('dark')?'dark':'light'});
const p=await c.newPage();
// Kill Vite HMR: this shared dev checkout full-reloads whenever another session
// touches a file, which is indistinguishable from a product-side re-render.
await p.addInitScript(() => {
  const OW = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const pr = Array.isArray(protocols) ? protocols : (protocols ? [protocols] : []);
    if (pr.includes('vite-hmr') || String(url).includes('vite')) {
      return { readyState: 3, close() {}, send() {}, addEventListener() {}, removeEventListener() {}, onopen: null, onclose: null, onerror: null, onmessage: null };
    }
    return new OW(url, protocols);
  };
  window.WebSocket.prototype = OW.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
});
let navs=0; p.on('framenavigated',f=>{if(f===p.mainFrame())navs++;});
let delayOn=true;
await p.route(u=>{try{const q=new URL(u);return q.pathname.startsWith('/api/')&&!q.pathname.startsWith('/api/events/stream');}catch{return false}},
  async r=>{ if(delayOn) await new Promise(x=>setTimeout(x,DELAY)); return r.continue(); });

p.goto(URL_,{waitUntil:'commit',timeout:60000}).catch(()=>{});
// wait until something is painted (skeleton or content)
await p.waitForTimeout(900);
const navAtSkel=navs;
const skel=await p.evaluate(PROBE);
fs.writeFileSync(path.join(OUT,'A-loading.png'), await p.screenshot({fullPage:true}));
// let data in
delayOn=false;
await p.waitForTimeout(DELAY+1500);
const loaded=await p.evaluate(PROBE);
fs.writeFileSync(path.join(OUT,'B-loaded.png'), await p.screenshot({fullPage:true}));
const navAtLoad=navs;
// late enrichment window: 5 more seconds, sample geometry
const late=[]; let lastSig=JSON.stringify(loaded.blocks.map(x=>x.k+x.y+x.h));
for(let i=0;i<25;i++){ await p.waitForTimeout(200); let s=null; try{s=await p.evaluate(PROBE);}catch{}
  if(s){const sig=JSON.stringify(s.blocks.map(x=>x.k+x.y+x.h)); if(sig!==lastSig){ late.push({t:900+DELAY+1500+i*200, txt:s.txt, scrollH:s.scrollH, n:s.blocks.length}); lastSig=sig; }}}
const res={url:URL_,w:W,dark:has('dark'),navsDuring:navAtLoad-navAtSkel,skel,loaded,late};
fs.writeFileSync(path.join(OUT,'pair.json'),JSON.stringify(res,null,1));

console.log('=== '+TAG+'  '+URL_+' @'+W+(has('dark')?' dark':'')+' ===');
console.log('document navigations between the two states: '+(navAtLoad-navAtSkel)+(navAtLoad-navAtSkel>1?'  <-- HMR RELOAD, RESULT SUSPECT':''));
console.log('LOADING  : mainH='+skel.mainRect.h+' scrollH='+skel.scrollH+' textlen='+skel.txt+' pulseBlocks='+skel.pulses.length+' spinners='+skel.spinners);
console.log('LOADED   : mainH='+loaded.mainRect.h+' scrollH='+loaded.scrollH+' textlen='+loaded.txt+' cards='+loaded.cards.length);
console.log('\n-- placeholder blocks (loading) --');
for(const q of skel.pulses) console.log('   x='+String(q.x).padStart(4)+' y='+String(q.y).padStart(4)+' w='+String(q.w).padStart(4)+' h='+String(q.h).padStart(4)+'  '+q.cls.slice(0,60));
console.log('\n-- first 12 real cards (loaded) --');
for(const q of loaded.cards.slice(0,12)) console.log('   x='+String(q.x).padStart(4)+' y='+String(q.y).padStart(4)+' w='+String(q.w).padStart(4)+' h='+String(q.h).padStart(4)+'  '+q.t);
// slot-by-slot
const m=new Map(skel.blocks.map(x=>[x.k,x]));
const diffs=[];
for(const x of loaded.blocks){ const a=m.get(x.k); if(a && (Math.abs(a.y-x.y)>=4||Math.abs(a.h-x.h)>=4||Math.abs(a.w-x.w)>=4)) diffs.push({k:x.k,dy:x.y-a.y,dh:x.h-a.h,dw:x.w-a.w,a,x}); }
diffs.sort((u,v)=>(Math.abs(v.dy)+Math.abs(v.dh))-(Math.abs(u.dy)+Math.abs(u.dh)));
console.log('\n-- same DOM slot, geometry changed loading -> loaded ('+diffs.length+', top 14) --');
for(const d of diffs.slice(0,14)) console.log('   '+d.k.slice(0,44).padEnd(46)+' dy='+(d.dy>0?'+':'')+d.dy+' dh='+(d.dh>0?'+':'')+d.dh+' dw='+(d.dw>0?'+':'')+d.dw+'   ['+d.a.y+','+d.a.h+']->['+d.x.y+','+d.x.h+']  '+(d.x.txt||d.x.cls).slice(0,34));
console.log('\n-- geometry changes AFTER first full render ('+late.length+' samples) --');
for(const l of late) console.log('   t≈'+l.t+'ms blocks='+l.n+' scrollH='+l.scrollH+' textlen='+l.txt);
console.log('\nshots: '+OUT);
await b.close();
