import { test } from '@playwright/test';

// Scene 4: Live logs — shows streaming pod logs and switching between pods.
// Target length: ~20s real-time (will be sped up 1.5x → ~13s final)
test('04-logs', async ({ page }) => {
	await page.goto('/rollouts/default/hello-world/logs');
	await page.waitForLoadState('domcontentloaded');
	await page.waitForTimeout(3000);

	// Let some logs stream in
	await page.waitForTimeout(3000);

	// Hover over a log line
	await page.mouse.move(640, 350, { steps: 10 });
	await page.waitForTimeout(1000);
	await page.mouse.move(640, 400, { steps: 10 });
	await page.waitForTimeout(1000);

	// Try to click a pod selector if visible
	const podSelector = page.locator('button').filter({ hasText: /pod|hello-world/i }).first();
	if (await podSelector.isVisible({ timeout: 1000 }).catch(() => false)) {
		await podSelector.click();
		await page.waitForTimeout(2000);
	}

	// Let more logs stream in
	await page.waitForTimeout(3000);

	// Scroll to bottom
	await page.evaluate(() => {
		const el = document.querySelector('[class*="overflow"][class*="auto"]') ||
			document.querySelector('[class*="scroll"]') ||
			document.documentElement;
		el.scrollTop = el.scrollHeight;
	});
	await page.waitForTimeout(2000);
});
