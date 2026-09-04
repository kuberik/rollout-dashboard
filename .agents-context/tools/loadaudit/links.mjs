import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
const b = await chromium.launch({headless:true});
const c = await b.newContext({ignoreHTTPSErrors:true, viewport:{width:1440,height:900}});
const p = await c.newPage();
for (const u of process.argv.slice(2)) {
  await p.goto('https://127.0.0.1:5173'+u, {waitUntil:'load', timeout:60000});
  await p.waitForTimeout(3500);
  const hrefs = await p.evaluate(()=>[...new Set([...document.querySelectorAll('main a[href]')].map(a=>a.getAttribute('href')))].slice(0,25));
  console.log('==',u); hrefs.forEach(h=>console.log('   ',h));
}
await b.close();
