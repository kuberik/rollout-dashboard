#!/usr/bin/env node
// pair-warm.mjs — same instrument as pair.mjs (capture LOADING vs LOADED
// geometry, slot by slot), but for a WARM visit: localStorage is primed with
// a remembered `skeleton-hints.ts` shape BEFORE the app boots, so the
// skeleton this pass draws is the one a real second visit would draw, not
// the cold first-visit guess. Same CLI shape as pair.mjs plus --shape and
// --key.
//   node pair-warm.mjs --url ... --w 1440 --tag <name> \
//     --key kuberik.skeleton-shape.v1.revisions \
//     --shape '{"repos":2,"open":"0","services":"6,2","hadBanner":false,"heroLines":"2,1","heldLines":"01,0"}' \
//     [--delay 2000] [--dark]
//
// To get the CURRENT shape for --shape: open the route once, run
//   localStorage.getItem('kuberik.skeleton-shape.v1.revisions')
// in the page (or `$B storage` via the browse skill) after it has settled.
import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
import fs from 'node:fs'; import path from 'node:path';
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);
const URL_ = arg('url'), W = +arg('w', 1440), H = +arg('h', W < 500 ? 844 : 900), DELAY = +arg('delay', 2000), TAG = arg('tag', 'pair-warm');
const KEY = arg('key', 'kuberik.skeleton-shape.v1.revisions');
const SHAPE = arg('shape', null);
const OUT = path.join('/tmp/claude-1000/loadaudit/pairs', TAG); fs.mkdirSync(OUT, { recursive: true });

const PROBE = `(() => {
  const norm=s=>(s||'').replace(/\\s+/g,' ').trim().slice(0,60);
  const main=document.querySelector('main')||document.body;
  const blocks=[];
  (function walk(el,p,d){ if(d>4) return; let i=0;
    for(const ch of el.children){ const r=ch.getBoundingClientRect();
      if(r.height>0&&r.width>0) blocks.push({k:p+'/'+i+':'+ch.tagName.toLowerCase(),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cls:String(ch.className&&ch.className.baseVal!==undefined?ch.className.baseVal:ch.className||'').slice(0,70),txt:norm(ch.textContent).slice(0,40)});
      walk(ch,p+'/'+i+':'+ch.tagName.toLowerCase(),d+1); i++; } })(main,'',0);
  const pulses=[...document.querySelectorAll('.animate-pulse,.skel-block,[class*="skeleton"]')].map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cls:String(e.className).slice(0,80)};});
  const cards=[...document.querySelectorAll('main [class*="rounded-xl"],main [class*="rounded-lg"],main section,main article')].map(e=>{const r=e.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),t:norm(e.textContent).slice(0,34)};}).filter(c=>c.h>24&&c.w>60);
  return {blocks,pulses,cards,mainRect:(()=>{const r=main.getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})(),
    scrollH:document.documentElement.scrollHeight, txt:norm(main.innerText).length,
    spinners:document.querySelectorAll('svg.animate-spin,[class*="animate-spin"],[role="progressbar"]').length};
})()`;

const b = await chromium.launch({ headless: true });
const c = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: has('dark') ? 'dark' : 'light' });
// ⭐ PRIME LOCALSTORAGE FOR A WARM VISIT before any app script runs. Without
// --shape this behaves like a cold visit (no remembered hint at all) — pass
// the JSON string a real settled visit leaves in localStorage under `--key`.
if (SHAPE) {
  // ⚠️ Playwright's `addInitScript(fn, arg)` passes exactly ONE arg through
  // to the page — a SECOND trailing argument is silently dropped, not bound
  // as a second function parameter. Pack key+shape into one object; passing
  // them as two positional args here previously left `shape` `undefined` in
  // the page, which `localStorage.setItem` stringified to `"undefined"`,
  // which `recallShape`'s `JSON.parse` then threw on and silently discarded
  // (caught, returns `null`) — every `--shape` value was being ignored.
  await c.addInitScript(({ key, shape }) => {
    try { localStorage.setItem(key, shape); } catch {}
    try { localStorage.setItem('theme', 'light'); } catch {}
  }, { key: KEY, shape: SHAPE });
}
const p = await c.newPage();
// Kill Vite HMR: this shared dev checkout full-reloads whenever another
// session touches a file, which is indistinguishable from a product-side
// re-render.
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
let navs = 0; p.on('framenavigated', f => { if (f === p.mainFrame()) navs++; });
let delayOn = true;
await p.route(u => { try { const q = new URL(u); return q.pathname.startsWith('/api/') && !q.pathname.startsWith('/api/events/stream'); } catch { return false; } },
  async r => { if (delayOn) await new Promise(x => setTimeout(x, DELAY)); return r.continue(); });

p.goto(URL_, { waitUntil: 'commit', timeout: 60000 }).catch(() => {});
await p.waitForTimeout(900);
const navAtSkel = navs;
const skel = await p.evaluate(PROBE);
fs.writeFileSync(path.join(OUT, 'A-loading.png'), await p.screenshot({ fullPage: true }));
delayOn = false;
await p.waitForTimeout(DELAY + 1500);
const loaded = await p.evaluate(PROBE);
fs.writeFileSync(path.join(OUT, 'B-loaded.png'), await p.screenshot({ fullPage: true }));
const navAtLoad = navs;
const res = { url: URL_, w: W, dark: has('dark'), warm: !!SHAPE, navsDuring: navAtLoad - navAtSkel, skel, loaded };
fs.writeFileSync(path.join(OUT, 'pair.json'), JSON.stringify(res, null, 1));

console.log('=== ' + TAG + '  ' + URL_ + ' @' + W + (has('dark') ? ' dark' : '') + (SHAPE ? ' (WARM)' : ' (COLD — no --shape given)') + ' ===');
console.log('document navigations between the two states: ' + (navAtLoad - navAtSkel) + (navAtLoad - navAtSkel > 1 ? '  <-- HMR RELOAD, RESULT SUSPECT' : ''));
console.log('LOADING  : mainH=' + skel.mainRect.h + ' scrollH=' + skel.scrollH + ' textlen=' + skel.txt + ' pulseBlocks=' + skel.pulses.length);
console.log('LOADED   : mainH=' + loaded.mainRect.h + ' scrollH=' + loaded.scrollH + ' textlen=' + loaded.txt + ' cards=' + loaded.cards.length);
const m = new Map(skel.blocks.map(x => [x.k, x]));
const diffs = [];
for (const x of loaded.blocks) { const a = m.get(x.k); if (a && (Math.abs(a.y - x.y) >= 4 || Math.abs(a.h - x.h) >= 4 || Math.abs(a.w - x.w) >= 4)) diffs.push({ k: x.k, dy: x.y - a.y, dh: x.h - a.h, dw: x.w - a.w, a, x }); }
diffs.sort((u, v) => (Math.abs(v.dy) + Math.abs(v.dh)) - (Math.abs(u.dy) + Math.abs(u.dh)));
console.log('\n-- same DOM slot, geometry changed loading -> loaded (' + diffs.length + ', top 20) --');
for (const d of diffs.slice(0, 20)) console.log('   ' + d.k.slice(0, 44).padEnd(46) + ' dy=' + (d.dy > 0 ? '+' : '') + d.dy + ' dh=' + (d.dh > 0 ? '+' : '') + d.dh + ' dw=' + (d.dw > 0 ? '+' : '') + d.dw + '   [' + d.a.y + ',' + d.a.h + ']->[' + d.x.y + ',' + d.x.h + ']  ' + (d.x.txt || d.x.cls).slice(0, 34));
console.log('\nMAX |dy|: ' + (diffs.length ? Math.max(...diffs.map(d => Math.abs(d.dy))) : 0) + '  MAX |dh|: ' + (diffs.length ? Math.max(...diffs.map(d => Math.abs(d.dh))) : 0));
console.log('\nshots: ' + OUT);
await b.close();
