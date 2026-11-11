import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { realpathSync } from 'node:fs';
import mkcert from 'vite-plugin-mkcert';
import { mockApiPlugin } from './dev-mock-api';
import { devAuthPlugin } from './dev-auth';

const useMockApi = !!process.env.MOCK_API;
const skipDevAuth = !!process.env.SKIP_DEV_AUTH;
// The DEMO BUILD (`scripts/build-demo.sh`). It needs no server-side mock —
// `src/hooks.client.ts` installs the same fixtures as a `fetch` shim in the
// page — but it does need a version string, since there is no backend to ask.
const isDemo = process.env.VITE_DEMO === '1';

export default defineConfig({
	// Two dev servers sharing one node_modules (worktrees symlink it) must not
	// share Vite's optimizer cache: they race on node_modules/.vite and break
	// Svelte. `VITE_CACHE_DIR` gives a second server its own.
	...(process.env.VITE_CACHE_DIR ? { cacheDir: process.env.VITE_CACHE_DIR } : {}),
	define: {
		...(useMockApi || isDemo
			? { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.MOCK_APP_VERSION || 'v0.0.1') }
			: {})
	},
	plugins: [
		...(useMockApi ? [mockApiPlugin()] : []),
		...(!useMockApi && !skipDevAuth ? [devAuthPlugin()] : []),
		mkcert(),
		tailwindcss(),
		sveltekit(),
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide'
		})
	],
	server: {
		https: true,
		host: "0.0.0.0",
		...(!useMockApi && {
			proxy: {
				'/api': {
					target: 'https://kuberik.192.168.1.102.nip.io:8080',
					changeOrigin: true,
					secure: false,
					// http-proxy does not end the upstream request when the browser goes
					// away. With a long-lived response (/api/events/stream, pod logs) that
					// leaves the hub serving a subscriber nobody reads: measured 1038
					// leaked streams on one dev server after a day of tabs (2026-09-04),
					// with the hub restarting under them. Tear the upstream down when the
					// client closes, in both directions.
					configure(proxy) {
						proxy.on('proxyReq', (proxyReq, req) => {
							req.on('close', () => proxyReq.destroy());
						});
						proxy.on('proxyRes', (proxyRes, _req, res) => {
							res.on('close', () => proxyRes.destroy());
						});
					}
				},
				'/oauth2': {
					target: 'https://kuberik.192.168.1.102.nip.io:8080',
					changeOrigin: true,
					secure: false,
				}
			}
		}),
		allowedHosts: true,
		// A git worktree may symlink node_modules to another checkout. Vite's
		// fs allowlist checks the RESOLVED path, so allow wherever node_modules
		// really lives — computed at startup, never a hard-coded local path.
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')]
		},
	},
	test: {
		workspace: [
			{
				extends: './vite.config.ts',
				plugins: [svelteTesting()],
				test: {
					name: 'client',
					environment: 'jsdom',
					clearMocks: true,
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**'],
					setupFiles: ['./vitest-setup-legacy-releases.ts', './vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					setupFiles: ['./vitest-setup-legacy-releases.ts'],
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
