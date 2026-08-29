import { test } from '@playwright/test';

// Scene 3: Deployment history — shows the timeline of past deployments including a failure.
// Target length: ~20s real-time (will be sped up 1.5x → ~13s final)
test('03-history', async ({ page }) => {
	await page.goto('/rollouts/default/hello-world/history');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(3000);

	// Slowly scan the history list with the mouse
	await page.mouse.move(640, 250, { steps: 10 });
	await page.waitForTimeout(1500);

	// Hover over each history item one by one
	await page.mouse.move(640, 300, { steps: 10 });
	await page.waitForTimeout(1200);
	await page.mouse.move(640, 380, { steps: 10 });
	await page.waitForTimeout(1200);
	await page.mouse.move(640, 460, { steps: 10 });
	await page.waitForTimeout(1500);

	// Scroll to show more history
	await page.mouse.wheel(0, 200);
	await page.waitForTimeout(1500);

	await page.mouse.move(640, 400, { steps: 10 });
	await page.waitForTimeout(2000);
});
