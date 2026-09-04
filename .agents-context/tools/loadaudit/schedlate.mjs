import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const b=await chromium.launch({headless:true});
const routes=['/','/rollouts','/apps','/apps/hello-world-app','/environments','/envs/prod','/dependencies','/rollouts/prod/hello-world-prod/hello-world-app','/rollouts/prod/hello-world-prod/hello-world-app/dependencies'];
for (const r of routes) {
  const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});
  const p=await c.newPage();
  await p.addInitScript(()=>{const OW=window.WebSocket;window.WebSocket=function(u,pr){const a=Array.isArray(pr)?pr:(pr?[pr]:[]);if(a.includes('vite-hmr')||String(u).includes('vite'))return{readyState:3,close(){},send(){},addEventListener(){},removeEventListener(){}};return new OW(u,pr);};window.WebSocket.prototype=OW.prototype;});
  let on=true;
  await p.route(u=>{try{return new URL(u).pathname.startsWith('/api/schedules');}catch{return false}}, async rt=>{ if(on) await new Promise(x=>setTimeout(x,3500)); return rt.continue(); });
  await p.goto('https://127.0.0.1:5173'+r,{waitUntil:'commit'});
  await p.waitForTimeout(1800);
  const A=await p.evaluate(()=>{const m=document.querySelector('main');return {t:(m?m.innerText:'').replace(/\s+/g,' ').trim(), h:m?Math.round(m.scrollHeight):0};});
  on=false; await p.waitForTimeout(4500);
  const B=await p.evaluate(()=>{const m=document.querySelector('main');return {t:(m?m.innerText:'').replace(/\s+/g,' ').trim(), h:m?Math.round(m.scrollHeight):0};});
  const same = A.t===B.t;
  console.log('== '+r+'   mainScrollH '+A.h+' -> '+B.h+(A.h!==B.h?('  (Δ'+(B.h-A.h)+'px)'):'  (no height change)')+(same?'   TEXT IDENTICAL':'   TEXT CHANGED'));
  if(!same){
    const aw=A.t.split(' · '), bw=B.t.split(' · ');
    // crude: show first divergence context
    let i=0; while(i<Math.min(A.t.length,B.t.length)&&A.t[i]===B.t[i]) i++;
    console.log('   before: ...'+A.t.slice(Math.max(0,i-60),i+120).replace(/\n/g,' ')+'...');
    console.log('   after : ...'+B.t.slice(Math.max(0,i-60),i+120).replace(/\n/g,' ')+'...');
  }
  await c.close();
}
await b.close();
