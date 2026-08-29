import { test } from '@playwright/test';

// Scene 2: Rollout detail — shows status, canary pipeline, health checks, managed resources.
// Target length: ~30s real-time (will be sped up 1.5x → ~20s final)
test('02-rollout-detail', async ({ page }) => {
	await page.goto('/rollouts/default/hello-world');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(3000);

	// Move mouse to show the status area
	await page.mouse.move(640, 200, { steps: 15 });
	await page.waitForTimeout(1500);

	// Scroll down to reveal pipeline / canary steps
	await page.mouse.wheel(0, 300);
	await page.waitForTimeout(2000);

	// Hover over pipeline area
	await page.mouse.move(640, 400, { steps: 15 });
	await page.waitForTimeout(1500);

	// Scroll down further to show managed resources / health checks
	await page.mouse.wheel(0, 300);
	await page.waitForTimeout(2000);

	await page.mouse.move(640, 500, { steps: 15 });
	await page.waitForTimeout(2000);

	// Scroll back to top
	await page.mouse.wheel(0, -600);
	await page.waitForTimeout(2000);
});
