// y-trace probe (MOCK_API=1 vite dev --port N): steps a 2-stage canary through its states and prints every row's y-offset from
// the Deployment pipeline card top. Rows must read the same number in every column. usage: node scripts/pipeline-y-trace.mjs <port> <width> <theme> [shot.png]
import { chromium } from '@playwright/test';
const [port, width, theme, shot] = [process.argv[2], +process.argv[3], process.argv[4] || 'light', process.argv[5]];
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const STATES = {
  'S0 stage1 running':        { idx: 1, state: 'StepUpgrade', ann: {} },
  'S1 stage1 paused (no bake yet)': { idx: 1, state: 'StepPaused', ann: {} },
  'S2 stage1 check ticking 25s':    { idx: 1, state: 'StepPaused', ann: { 'internal.rollout.kuberik.io/step-1-ready-at': iso(-5000) } },
  'S3 stage1 check elapsed':        { idx: 1, state: 'StepPaused', ann: { 'internal.rollout.kuberik.io/step-1-ready-at': iso(-60000) } },
};
const b = await chromium.launch();
const out = {};
for (const [name, st] of Object.entries(STATES)) {
  const c = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 1100 }, colorScheme: theme });
  const p = await c.newPage();
  await p.addInitScript((t) => { try { localStorage.setItem('theme', t); localStorage.setItem('color-theme', t); } catch {} if (t==='dark') document.documentElement.classList.add('dark'); }, theme);
  await p.route('**/managed-resources', async (route) => {
    const r = await route.fetch(); const j = await r.json();
    for (const m of j.managedResources) if (m.groupVersionKind?.endsWith('/Rollout') && m.object?.kind === 'Rollout') {
      const o = m.object;
      o.spec.strategy.canary.steps = [{ replicas: 1, pause: {} }, { replicas: '100%' }];
      o.metadata.annotations = { 'rollout.kuberik.io/step-1-bake-time': '30s', ...st.ann };
      o.status.canaryStatus = { currentStepIndex: st.idx, currentStepState: st.state, canaryRevision: 'f68d0ac' };
      o.status.conditions = [{ type: 'Progressing', status: 'True', reason: 'Progressing' }];
      o.status.phase = 'Progressing';
    }
    await route.fulfill({ response: r, json: j });
  });
  await p.route(/\/rollouts\/default\/hello-world$/, async (route) => {
    const r = await route.fetch(); const j = await r.json();
    if (j.rollout?.status?.history?.[0]) j.rollout.status.history[0].bakeStatus = 'Deploying';
    await route.fulfill({ response: r, json: j });
  });
  await p.goto(`https://127.0.0.1:${port}/rollouts/dev/default/hello-world`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('[data-tour=pipeline]');
  await p.waitForTimeout(2500);
  const res = await p.evaluate((w) => {
    const card = document.querySelector('[data-tour=pipeline]');
    const root = card.querySelector(w >= 1 ? (getComputedStyle(card.querySelector('.dpc-desktop')).display !== 'none' ? '.dpc-desktop' : '.dpc-mobile') : '');
    const top = card.getBoundingClientRect().top;
    const y = (el) => (el ? Math.round((el.getBoundingClientRect().top - top) * 10) / 10 : null);
    const byText = (sel, t) => [...root.querySelectorAll(sel)].find((e) => e.textContent.trim() === t);
    const rows = {};
    const nav = (t) => [...root.querySelectorAll('button')].find((e) => e.textContent.trim().startsWith(t));
    rows['nav Stage 1'] = y(nav('Stage 1'));
    rows['nav Stage 2'] = y(nav('Stage 2'));
    rows['nav Check'] = y(nav('Check'));
    const box = root.querySelector('.overflow-hidden.rounded-md.border.border-line.bg-subtle');
    for (const t of ['Rollout', 'Tests', 'Check']) {
      const s = box && [...box.querySelectorAll('span.truncate')].find((e) => e.textContent.trim() === t);
      rows['sub ' + t] = y(s);
    }
    rows['box bottom'] = box ? Math.round((box.getBoundingClientRect().bottom - top) * 10) / 10 : null;
    const cont = [...root.querySelectorAll('button')].find((e) => /Continue to stage|Finish rollout/.test(e.textContent));
    rows['Continue button'] = y(cont);
    rows['Continue visible'] = cont ? getComputedStyle(cont.closest('.flex-col')).visibility : 'absent';
    rows['Continue class'] = cont ? (cont.className.includes('btn-primary') ? 'primary' : 'secondary') : '-';
    rows['card height'] = Math.round(card.getBoundingClientRect().height);
    // the rows below the card
    return rows;
  }, width);
  out[name] = res;
  if (shot && name.startsWith('S2')) await p.locator('[data-tour=pipeline]').screenshot({ path: shot });
  await c.close();
}
await b.close();
const names = Object.keys(out[Object.keys(out)[0]]);
console.log(['row', ...Object.keys(out).map((k) => k.split(' ')[0])].join('\t'));
for (const n of names) console.log([n, ...Object.values(out).map((o) => o[n])].join('\t'));
