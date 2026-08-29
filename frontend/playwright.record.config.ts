import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e/recordings',
	testMatch: '*.ts',
	outputDir: 'recordings-raw',
	workers: 1,
	reporter: 'list',
	use: {
		baseURL: 'https://localhost:5173',
		ignoreHTTPSErrors: true,
		viewport: { width: 1280, height: 720 },
		video: {
			mode: 'on',
			size: { width: 1280, height: 720 },
		},
		actionTimeout: 10000,
		launchOptions: {
			executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell`,
		},
	},
	webServer: {
		command: 'MOCK_API=1 npx vite dev',
		port: 5173,
		reuseExistingServer: true,
		timeout: 30000,
	},
});
