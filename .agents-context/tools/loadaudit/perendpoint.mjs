import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const ROUTE=process.argv[2], W=+(process.argv[3]||1440);
const PATTERNS=[/permissions/,/\/events\?/,/managed-resources/,/health-checks/,/\/schedules/,/auth\/github/,/\/api\/cluster/,/\/api\/rollouts$/,/\/api\/rollouts\/[^?]+\?/];
const b=await chromium.launch({headless:true});
const fn=()=>{const m=document.querySelector('main');const out=[];
 (function w(el,p,d){if(d>4)return;let i=0;for(const ch of el.children){const r=ch.getBoundingClientRect();if(r.height>0&&r.width>0)out.push({k:(ch.textContent||'').replace(/\s+/g,' ').trim().slice(0,40),y:Math.round(r.y),h:Math.round(r.height),x:Math.round(r.x),w:Math.round(r.width)});w(ch,p,d+1);i++;}})(m,'',0);
 return {blocks:out, sh:Math.round(m.scrollHeight), txt:m.innerText.replace(/\s+/g,' ').trim()};};
for (const pat of PATTERNS){
  const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:W,height:W<500?844:900}});
  const p=await c.newPage();
  await p.addInitScript(()=>{const OW=window.WebSocket;window.WebSocket=function(u,pr){const a=Array.isArray(pr)?pr:(pr?[pr]:[]);if(a.includes('vite-hmr')||String(u).includes('vite'))return{readyState:3,close(){},send(){},addEventListener(){},removeEventListener(){}};return new OW(u,pr);};window.WebSocket.prototype=OW.prototype;});
  let on=true, hit=0;
  await p.route(u=>{try{const q=new URL(u); if(!q.pathname.startsWith('/api/')) return false; const s=q.pathname+q.search; return pat.test(s);}catch{return false}}, async r=>{ hit++; if(on) await new Promise(x=>setTimeout(x,3500)); return r.continue(); });
  await p.goto('https://127.0.0.1:5173'+ROUTE,{waitUntil:'commit'}); 
  await p.waitForTimeout(2200);
  let A=null; try{A=await p.evaluate(fn);}catch{}
  on=false; await p.waitForTimeout(5000);
  let B=null; try{B=await p.evaluate(fn);}catch{}
  if(A&&B){
    const m=new Map(A.blocks.filter(x=>x.k.length>3).map(x=>[x.k,x]));
    const mv=[]; for(const x of B.blocks){const a=m.get(x.k); if(a&&(Math.abs(a.y-x.y)>=4||Math.abs(a.h-x.h)>=4)) mv.push({k:x.k,dy:x.y-a.y,dh:x.h-a.h,ay:a.y,by:x.y});}
    mv.sort((u,v)=>Math.abs(v.dy)-Math.abs(u.dy));
    const newTxt = B.txt.length-A.txt.length;
    console.log('\n>> delayed '+pat+'  (matched '+hit+' req)  mainScrollH '+A.sh+'->'+B.sh+'  Δtext '+(newTxt>0?'+':'')+newTxt+'  movedLandmarks='+mv.length);
    for(const x of mv.slice(0,6)) console.log('     dy='+(x.dy>0?'+':'')+String(x.dy).padStart(5)+' dh='+(x.dh>0?'+':'')+String(x.dh).padStart(5)+'  y '+x.ay+'->'+x.by+'  "'+x.k.slice(0,38)+'"');
  } else console.log('\n>> delayed '+pat+'  EVAL FAILED');
  await c.close();
}
await b.close();
