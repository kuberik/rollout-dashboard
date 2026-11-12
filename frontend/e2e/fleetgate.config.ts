import { defineConfig } from '@playwright/test';
export default defineConfig({
	testDir: '.',
	testMatch: 'fleetgate-nav.test.ts',
	use: { baseURL: process.env.BASE_URL ?? 'https://localhost:5731', ignoreHTTPSErrors: true }
});
