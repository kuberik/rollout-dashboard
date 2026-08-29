import { test } from '@playwright/test';

// Scene 1: Dashboard overview — shows the rollouts grid and navigates into a rollout.
// Target length: ~20s real-time (will be sped up 1.5x → ~13s final)
test('01-dashboard', async ({ page }) => {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(2500);

	// Slowly pan the mouse over the rollout card to show hover state
	await page.mouse.move(200, 300);
	await page.waitForTimeout(500);
	await page.mouse.move(400, 300, { steps: 20 });
	await page.waitForTimeout(1000);

	// Find and hover over the first rollout card
	const card = page.locator('a[href*="/rollouts/"]').first();
	await card.hover();
	await page.waitForTimeout(2500);

	// Click to navigate into the rollout detail
	await card.click();
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(2000);
});
