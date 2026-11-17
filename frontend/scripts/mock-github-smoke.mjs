// mock-github-smoke.mjs: the mock dashboard's GitHub-backed pages render CONNECTED, never with a "not connected" state.
//
// usage (from frontend/):  MOCK_API=1 pnpm run dev   (another shell)   then   node scripts/mock-github-smoke.mjs [base]
//   base  default https://127.0.0.1:5173. Also works with MOCK_SCENARIO=home-incident (needed for the Approve button on Home).
// Checks: Home (your changes, signed-in viewer, an Approve button), /changes, a change page, the PR view URL, the palette paste
// flow (paste a PR link, "Open change #N", Enter, lands on the change page), and a rollout's Change version dialog.
// Every page must show none of: "not connected", "not configured", "Connect GitHub". Exit code 1 on any failure.
// The unit pin is src/lib/demo/github-mock-agreement.test.ts.
import { chromium } from '@playwright/test';
const base = process.argv[2] || 'https://127.0.0.1:5173';
const BAD = /not connected|not configured|connect github/i;
const fails = [];
const check = (ok, msg) => {
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
	if (!ok) fails.push(msg);
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const body = async () => {
	await page.waitForTimeout(2500);
	return page.locator('body').innerText();
};
const visit = async (path) => {
	await page.goto(base + path, { waitUntil: 'load' });
	return body();
};
const clean = (t, name) => check(!BAD.test(t), `${name}: no "not connected" state`);

let t = await visit('/');
clean(t, 'Home');
check(/Your changes/.test(t), 'Home: "Your changes" is there');
check(/danielreed/.test(t), 'Home: the signed-in viewer is shown');
if (process.env.EXPECT_APPROVE !== '0') check((await page.getByRole('button', { name: /^Approve/ }).count()) > 0, 'Home: an Approve button (viewer may approve)');

t = await visit('/changes');
clean(t, '/changes');
const links = await page.locator('a[href*="/changes/github.com/"][href*="/pull/"]').evaluateAll((a) => a.map((x) => x.getAttribute('href')));
check(links.length > 0, '/changes: change rows link to change pages');
const changeHref = links[0];

t = await visit(changeHref);
clean(t, `change page ${changeHref}`);
check(/Merged|yours|Pull request/.test(t), 'change page: renders the pull request');

const m = changeHref.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
t = await visit(`/pr/github.com/${m[1]}/${m[2]}/${m[3]}`.replace('/github.com', ''));
check(page.url().includes('/changes/github.com/'), 'PR view URL redirects to the change page');
clean(t, 'PR view');

await visit('/');
await page.keyboard.press('Control+k');
await page.keyboard.type(`https://github.com/${m[1]}/${m[2]}/pull/${m[3]}`);
await page.waitForTimeout(1500);
const opt = await page.getByText(new RegExp(`Open change #${m[3]}`)).count();
check(opt > 0, `palette: "Open change #${m[3]}" offered for a pasted PR link`);
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
check(page.url().includes(`/pull/${m[3]}`), 'palette: Enter lands on the change page');

const rollouts = await page.request.get(base + '/api/rollouts');
const first = (await rollouts.json()).rollouts.items.find((r) => /checkout-api/.test(r.metadata.name));
const cluster = first?.metadata?.annotations?.['rollout-dashboard.kuberik.com/source-cluster'] ?? 'prod';
t = await visit(`/rollouts/${cluster}/${first.metadata.namespace}/${first.metadata.name}?action=change-version`);
clean(t, 'change version');

await browser.close();
if (fails.length) {
	console.log(`\n${fails.length} failure(s)`);
	process.exit(1);
}
console.log('\nall ok');
