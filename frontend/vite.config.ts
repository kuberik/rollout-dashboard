import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { svelteTesting } from '@testing-library/svelte/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { mockApiPlugin } from './dev-mock-api';
import { devAuthPlugin } from './dev-auth';

const useMockApi = !!process.env.MOCK_API;
const skipDevAuth = !!process.env.SKIP_DEV_AUTH;

export default defineConfig({
	define: {
		...(useMockApi ? { 'import.meta.env.VITE_APP_VERSION': JSON.stringify('v0.0.1') } : {})
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
					setupFiles: ['./vitest-setup-client.ts']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
