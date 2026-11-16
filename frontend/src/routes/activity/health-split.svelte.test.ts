/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Activity from './+page.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';

beforeAll(() => install(true));
afterEach(() => vi.unstubAllGlobals());

function stub(opts: { hold?: boolean } = {}) {
	resetDemoState('calm');
	vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? input));
		const path = url.replace(/^https?:\/\/[^/]+/, '');
		if (opts.hold && path.includes('/health-checks')) return new Promise<Response>(() => {});
		const r = respond((init?.method ?? 'GET') as string, path);
		return new Response(r.body ?? '', { status: r.status, headers: r.headers });
	}));
}
const rollups = () => [...document.querySelectorAll('[data-rollup]')].map((e) => e.textContent!.replace(/\s+/g, ' ').trim());

const part = (rollup: Element, re: RegExp) => [...rollup.children].find((c) => re.test(c.textContent ?? ''))!;
const loaded = async () => waitFor(() => expect(rollups().some((t) => /deploys?/.test(t))).toBe(true), { timeout: 10_000 });

describe('Activity: the failing / failed split', { timeout: 30_000 }, () => {
	test('the Deploys header and a day-card rollup ink only the failing part', async () => {
		stub();
		render(WithQueryClient, { props: { component: Activity as any } });
		await loaded();
		await waitFor(() => expect(rollups()[0]).toContain('failed'), { timeout: 10_000 });
		for (const r of [...document.querySelectorAll('[data-rollup]')].slice(0, 2)) {
			expect(part(r, /\d+ failing/).className).toContain('text-danger');
			expect(part(r, /\d+ failed/).className).not.toContain('text-danger');
		}
	});
	test('day-card rows for a recovered failure read neutral, a failure failing now stays danger', async () => {
		stub();
		render(WithQueryClient, { props: { component: Activity as any } });
		await loaded();
		await waitFor(() => expect(rollups()[0]).toContain('failed'), { timeout: 10_000 });
		const verb = (app: string) => [...document.querySelectorAll('.fr-in')].filter((r) => r.querySelector('.fr-nm')?.textContent === app).map((r) => r.querySelector('.fr-v')!).find((v) => v.textContent === 'failed its health check');
		for (const app of ['catalog-api', 'search-indexer']) {
			expect(verb(app)).toBeTruthy();
			expect(verb(app)?.className).not.toContain('text-danger');
		}
		for (const app of ['orders-hub', 'checkout-gateway']) { expect(verb(app)).toBeTruthy(); expect(verb(app)?.className).toContain('text-danger'); }
	});
	test('before the fleet health checks answer, the rollups show only the count', async () => {
		stub({ hold: true });
		render(WithQueryClient, { props: { component: Activity as any } });
		await loaded();
		await new Promise((r) => setTimeout(r, 1000));
		expect(rollups()[0]).toBe('212 deploys');
		expect(rollups()[1]).toBe('47 deploys');
	});
});
