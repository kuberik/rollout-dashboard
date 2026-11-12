import { test, expect, type Page } from '@playwright/test';

/**
 * Regression for "client-side navigation leaves <main> on the FleetGate skeleton" (2026-11-12): the next route's gate installed the live
 * source, then the previous route's gate tore down and cleared it, and nothing reinstalled it.
 * Run against a MOCK_API=1 dev server: BASE_URL=https://localhost:5731 npx playwright test --config=e2e/fleetgate.config.ts
 */
const settled = async (page: Page, what: string) => {
	await page.waitForTimeout(1200);
	await expect(page.locator('[data-fleet-loading]'), `skeleton stuck: ${what}`).toHaveCount(0);
};
const go = async (page: Page, sel: string, what: string) => {
	await page.locator(sel).locator('visible=true').first().click();
	await settled(page, what);
};

for (const vp of [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }]) {
	test(`client-side navigation never sticks on the skeleton @${vp.name}`, async ({ page }) => {
		await page.setViewportSize(vp);
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		await page.goto('/rollouts');
		await settled(page, 'first load');
		for (const href of ['/apps', '/rollouts', '/environments', '/changes', '/', '/apps']) {
			await go(page, `a[href="${href}"]`, `to ${href}`);
		}
		// an app, then its tabs
		await go(page, 'a[href^="/apps/"]:not([href$="/apps/"])', 'open an app');
		const appBase = new URL(page.url()).pathname.split('/').slice(0, 3).join('/');
		for (const tab of ['pipeline', 'gates']) {
			const l = page.locator(`a[href^="${appBase}"][href$="/${tab}"]`).locator('visible=true').first();
			if (await l.count()) { await l.click(); await settled(page, `app tab ${tab}`); }
		}
		await go(page, 'a[href="/rollouts"]', 'app -> rollouts');
		// a rollout, then its tabs
		await go(page, 'a[href^="/rollouts/"]', 'open a rollout');
		const rBase = new URL(page.url()).pathname.split('/').slice(0, 4).join('/');
		const tabs = await page.locator(`a[href^="${rBase}/"]`).evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).getAttribute('href')!))]);
		for (const t of tabs) {
			const l = page.locator(`a[href="${t}"]`).locator('visible=true').first();
			if (await l.count()) { await l.click(); await settled(page, `rollout tab ${t}`); }
		}
		await go(page, 'a[href="/environments"]', 'rollout -> environments');
		expect(errors).toEqual([]);
	});
}
