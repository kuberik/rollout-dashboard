import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const b=await chromium.launch({headless:true});
for (const W of [1440, 1280, 900, 640, 390]) {
  const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:W,height:W<500?844:900}});
  const p=await c.newPage();
  await p.goto('https://127.0.0.1:5173/activity',{waitUntil:'load'}); await p.waitForTimeout(3000);
  const r = await p.evaluate(()=>{const m=document.querySelector('main');return{
    deScrollH:document.documentElement.scrollHeight, deClientH:document.documentElement.clientHeight,
    mainOverflowY:getComputedStyle(m).overflowY, mainScrollH:m.scrollHeight, mainClientH:m.clientHeight,
    outerH:getComputedStyle(document.querySelector('main').parentElement.parentElement||document.body).height};});
  await p.evaluate(()=>window.scrollTo(0,1500)); await p.waitForTimeout(200);
  const sy = await p.evaluate(()=>window.scrollY);
  console.log('W='+W, JSON.stringify(r), 'windowScrollYafterScrollTo1500='+sy);
  await c.close();
}
await b.close();
