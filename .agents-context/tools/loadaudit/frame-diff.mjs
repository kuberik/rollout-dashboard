#!/usr/bin/env node
// frame-diff.mjs — capture per-100ms geometry+pixel frames during page load and
// report elements that APPEAR or MOVE after first paint.
//
// usage:
//   node frame-diff.mjs --url https://127.0.0.1:5173/rollouts --w 1440 --tag rollouts-1440
//   node frame-diff.mjs --url https://127.0.0.1:5173/ --w 390 --click 'text=Apps' --tag nav-apps
//
// flags: --url --w(idth) --h(eight) --ms (capture window, default 4000)
//        --tag (output dir name) --click (selector to click AFTER load, records the nav)
//        --latency --kbps --dark --shots (also write pngs)
import { chromium } from '/home/luka/.claude/skills/gstack/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes('--' + n);

const URL_ = arg('url');
const W = +arg('w', 1440), H = +arg('h', W < 500 ? 844 : 900);
const MS = +arg('ms', 4000);
const TAG = arg('tag', 'run');
const CLICK = arg('click');
const LAT = +arg('latency', 400), KBPS = +arg('kbps', 1500);
const OUT = path.join('/tmp/claude-1000/loadaudit/shots', TAG);
fs.mkdirSync(OUT, { recursive: true });

// --- what we track. keyed by tag + normalized text, so a node that is replaced
// but says the same thing is still the "same" landmark.
const PROBE = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, 48);
  const sel = 'h1,h2,h3,button,a,[class*="card"],[class*="chip"],[class*="badge"],table,svg,dl,dt,dd,li,p,section,article,header,input,summary,[role="status"],[role="alert"],[aria-busy],[class*="skeleton"],[class*="animate-pulse"], .skel-block';
  const out = [];
  const seen = new Map();
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    let key = el.tagName.toLowerCase() + '|' + norm(el.textContent);
    if (!norm(el.textContent)) key = el.tagName.toLowerCase() + '|@' + norm(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className);
    const n = (seen.get(key) || 0); seen.set(key, n + 1);
    out.push({ k: key + '#' + n, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
  }
  // positional block map under <main>: stable key = nth-child path, so a skeleton
  // block and the content block that replaces it compare as the SAME slot.
  const blocks = [];
  (function walk(el, path, d) {
    if (d > 3) return;
    let i = 0;
    for (const ch of el.children) {
      const r = ch.getBoundingClientRect();
      const k = path + '/' + i + ':' + ch.tagName.toLowerCase();
      if (r.height > 0) blocks.push({ k, y: Math.round(r.y), h: Math.round(r.height), x: Math.round(r.x), w: Math.round(r.width) });
      walk(ch, k, d + 1);
      i++;
    }
  })(document.querySelector('main') || document.body, '', 0);
  return {
    els: out,
    blocks,
    scrollH: document.documentElement.scrollHeight,
    mainH: (document.querySelector('main') || document.body).getBoundingClientRect().height,
    pulses: document.querySelectorAll('.animate-pulse,[class*="skeleton"]').length,
    spinners: document.querySelectorAll('[class*="spinner"],[role="status"] svg,svg.animate-spin,[class*="animate-spin"]').length,
    txt: norm((document.querySelector('main') || document.body).innerText).length
  };
})()`;

const browser = await chromium.launch({ headless: true, args: ['--force-color-profile=srgb'] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: has('dark') ? 'dark' : 'light' });
const page = await ctx.newPage();
// Kill Vite HMR: this shared dev checkout full-reloads whenever another session
// touches a file, which is indistinguishable from a product-side re-render.
await page.addInitScript(() => {
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
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
if (has('throttle')) await cdp.send('Network.emulateNetworkConditions', {
  offline: false, latency: LAT,
  downloadThroughput: KBPS * 1000 / 8, uploadThroughput: KBPS * 1000 / 8
});

// --- API delay: either a flat --apidelay N, or --stagger to separate each payload
// in time so a pop-in can be attributed to the exact response that caused it.
const STAGGER = [
  [/\/api\/rollouts(\?|$)/, 600],
  [/\/api\/cluster/, 1300],
  [/\/api\/schedules/, 2000],
  [/\/api\/auth\/github\/status/, 2700],
  [/\/api\/events/, 3400],
  [/\/api\//, 1000]
];
const FLAT = +arg('apidelay', 0);
const apiLog = [];
if (FLAT || has('stagger')) {
  await page.route((u) => { try { return new URL(u).pathname.startsWith('/api/'); } catch { return false; } }, async (route) => {
    const u = route.request().url();
    let d = FLAT;
    if (has('stagger')) { for (const [re, ms] of STAGGER) if (re.test(u)) { d = ms; break; } }
    if (/events\/stream/.test(u)) d = 0;
    await new Promise(r => setTimeout(r, d));
    apiLog.push({ u: u.replace(URL_.replace(/\/[^/]*$/, ''), '').replace(/^https?:\/\/[^/]+/, ''), t: Date.now() - t0, delay: d });
    await route.continue();
  });
}

const frames = [];
let t0 = 0, running = false;

async function capture() {
  running = true;
  while (running) {
    const t = Date.now() - t0;
    let snap = null;
    try { snap = await page.evaluate(PROBE); } catch (e) { }
    let shot = null;
    if (has('shots')) { try { shot = await page.screenshot({ type: 'jpeg', quality: 55 }); } catch { } }
    if (snap) {
      frames.push({ t, ...snap });
      if (shot) fs.writeFileSync(path.join(OUT, String(t).padStart(5, '0') + '.jpg'), shot);
    }
    if (t > MS) break;
    await new Promise(r => setTimeout(r, 90));
  }
}

t0 = Date.now();
if (CLICK) {
  // warm load first (untimed), then time the in-app navigation
  if (has('throttle')) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await page.goto(URL_, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  if (has('throttle')) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: LAT, downloadThroughput: KBPS * 1000 / 8, uploadThroughput: KBPS * 1000 / 8 });
  t0 = Date.now();
  const cap = capture();
  await page.click(CLICK, { timeout: 10000 }).catch(e => console.error('CLICK FAIL', e.message));
  await cap;
} else {
  const nav = page.goto(URL_, { waitUntil: 'commit', timeout: 60000 }).catch(e => console.error('GOTO', e.message));
  await nav;
  await capture();
}
running = false;

// ---- diff
const report = { url: URL_, w: W, dark: has('dark'), click: CLICK || null, frames: frames.length, api: apiLog, appear: [], move: [], vanish: [], timeline: [] };
for (const f of frames) report.timeline.push({ t: f.t, els: f.els.length, scrollH: f.scrollH, pulses: f.pulses, spinners: f.spinners, txt: f.txt });

const firstSeen = new Map(), lastRect = new Map();
for (const f of frames) {
  const cur = new Map(f.els.map(e => [e.k, e]));
  for (const [k, e] of cur) {
    if (!firstSeen.has(k)) { firstSeen.set(k, { t: f.t, y: e.y, h: e.h, x: e.x, w: e.w }); }
    const prev = lastRect.get(k);
    if (prev && (Math.abs(prev.y - e.y) > 1 || Math.abs(prev.x - e.x) > 1 || Math.abs(prev.h - e.h) > 2)) {
      report.move.push({ k, from_t: prev.t, to_t: f.t, dy: e.y - prev.y, dx: e.x - prev.x, dh: e.h - prev.h, y: e.y });
    }
    lastRect.set(k, { ...e, t: f.t });
  }
  for (const k of lastRect.keys()) if (!cur.has(k) && lastRect.get(k).alive !== false) {
    const r = lastRect.get(k); if (r.t !== f.t) { report.vanish.push({ k, t: f.t, y: r.y }); lastRect.set(k, { ...r, alive: false }); }
  }
}
const t_first = frames.length ? frames[0].t : 0;
for (const [k, v] of firstSeen) if (v.t > t_first) report.appear.push({ k, t: v.t, y: v.y, h: v.h });
report.appear.sort((a, b) => a.t - b.t || a.y - b.y);
report.move.sort((a, b) => Math.abs(b.dy) - Math.abs(a.dy));

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));

// ---- console summary
const fmt = (n) => (n > 0 ? '+' : '') + n;
console.log('\n=== ' + TAG + '  ' + URL_ + '  @' + W + (CLICK ? '  (in-app click: ' + CLICK + ')' : ' (cold)') + ' ===');
console.log('frames:', frames.length, ' window:', MS + 'ms');
console.log('t     els  scrollH  pulses spin  textlen');
for (const r of report.timeline) console.log(String(r.t).padStart(5), String(r.els).padStart(4), String(r.scrollH).padStart(7), String(r.pulses).padStart(6), String(r.spinners).padStart(4), String(r.txt).padStart(7));
// --- block-slot analysis: same nth-child slot, y/h across frames
const slot = new Map();
for (const f of frames) for (const b of f.blocks || []) {
  if (!slot.has(b.k)) slot.set(b.k, []);
  const a = slot.get(b.k); const last = a[a.length - 1];
  if (!last || last.y !== b.y || last.h !== b.h || last.w !== b.w) a.push({ t: f.t, y: b.y, h: b.h, w: b.w });
}
report.slots = [];
for (const [k, a] of slot) if (a.length > 1) {
  const dy = a[a.length - 1].y - a[0].y, dh = a[a.length - 1].h - a[0].h, dw = a[a.length - 1].w - a[0].w;
  if (Math.abs(dy) >= 4 || Math.abs(dh) >= 4 || Math.abs(dw) >= 4) report.slots.push({ k, steps: a, dy, dh, dw });
}
report.slots.sort((a, b) => (Math.abs(b.dy) + Math.abs(b.dh)) - (Math.abs(a.dy) + Math.abs(a.dh)));
console.log('\n-- BLOCK SLOTS that changed geometry (' + report.slots.length + ', top 22) --');
for (const s2 of report.slots.slice(0, 22)) {
  console.log('  ' + s2.k.slice(0, 56).padEnd(58) + ' dy=' + (s2.dy > 0 ? '+' : '') + s2.dy + ' dh=' + (s2.dh > 0 ? '+' : '') + s2.dh + ' dw=' + (s2.dw > 0 ? '+' : '') + s2.dw);
  console.log('      ' + s2.steps.map(x => 't' + x.t + ' y' + x.y + ' h' + x.h + ' w' + x.w).join('  |  '));
}

const bigMoves = report.move.filter(m => Math.abs(m.dy) >= 8);
console.log('\n-- MOVED >=8px vertically (' + bigMoves.length + ' events, top 25) --');
for (const m of bigMoves.slice(0, 25)) console.log('  ' + String(m.from_t).padStart(5) + '->' + String(m.to_t).padStart(5) + 'ms  dy=' + fmt(m.dy).padStart(6) + '  dh=' + fmt(m.dh).padStart(5) + '  ' + m.k.slice(0, 90));
console.log('\n-- APPEARED after first frame (' + report.appear.length + ', top 30 by time) --');
for (const a of report.appear.slice(0, 30)) console.log('  t=' + String(a.t).padStart(5) + 'ms y=' + String(a.y).padStart(5) + ' h=' + String(a.h).padStart(4) + '  ' + a.k.slice(0, 90));
console.log('\n-- API responses released --');
for (const a of apiLog) console.log('  t=' + String(a.t).padStart(5) + 'ms (delay ' + a.delay + ')  ' + a.u);
console.log('\nreport: ' + path.join(OUT, 'report.json'));
await browser.close();
