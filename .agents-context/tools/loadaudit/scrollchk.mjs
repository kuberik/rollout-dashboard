import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const b=await chromium.launch({headless:true});
const c=await b.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:900}});
const p=await c.newPage();
await p.goto('https://127.0.0.1:5173/activity',{waitUntil:'load'}); await p.waitForTimeout(3500);
console.log(await p.evaluate(()=>({
 deScrollH:document.documentElement.scrollHeight, deClientH:document.documentElement.clientHeight,
 bodyScrollH:document.body.scrollHeight, bodyOffsetH:document.body.offsetHeight,
 htmlOverflow:getComputedStyle(document.documentElement).overflow, bodyOverflow:getComputedStyle(document.body).overflow,
 mainRect:document.querySelector('main').getBoundingClientRect().height,
 mainOverflow:getComputedStyle(document.querySelector('main')).overflowY,
 winScrollY0:window.scrollY
})));
await p.evaluate(()=>window.scrollTo(0,2000)); await p.waitForTimeout(300);
console.log('after scrollTo(0,2000): scrollY=', await p.evaluate(()=>window.scrollY));
await b.close();
