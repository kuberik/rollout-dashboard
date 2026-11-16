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

function stub(opts: { hold?: boolean; fail?: boolean } = {}) {
	resetDemoState('calm');
	vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? input));
		const path = url.replace(/^https?:\/\/[^/]+/, '');
		if (opts.hold && path.includes('/health-checks')) return new Promise<Response>(() => {});
		if (opts.fail && path.includes('/health-checks')) return new Response('boom', { status: 500 });
		const r = respond((init?.method ?? 'GET') as string, path);
		return new Response(r.body ?? '', { status: r.status, headers: r.headers });
	}));
}
const rollups = () => [...document.querySelectorAll('[data-rollup]')].map((e) => e.textContent!.replace(/\s+/g, ' ').trim());

const part = (rollup: Element, re: RegExp) => [...rollup.children].find((c) => re.test(c.textContent ?? ''))!;
const failedVerbs = () => [...document.querySelectorAll('.fr-v')].filter((v) => v.textContent === 'failed its health check');
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
		/* 214: search-indexer carries one build newer than its failed prod head (live in dev and staging), two more deploys in the window */
		expect(rollups()[0]).toBe('214 deploys');
		expect(rollups()[1]).toBe('47 deploys');
	});
	test('before the fleet health checks answer, failed rows stay neutral instead of turning red and back', async () => {
		stub({ hold: true });
		render(WithQueryClient, { props: { component: Activity as any } });
		await loaded();
		await new Promise((r) => setTimeout(r, 1000));
		const rows = failedVerbs();
		expect(rows.length).toBeGreaterThan(0);
		for (const v of rows) expect(v.className).not.toContain('text-danger');
	});
	test('when the health-check query fails, the history snapshot answers: failed rows read failing, the rollup counts them failing', async () => {
		stub({ fail: true });
		render(WithQueryClient, { props: { component: Activity as any } });
		await loaded();
		await waitFor(() => expect(rollups()[0]).toContain('failing'), { timeout: 10_000 });
		expect(rollups()[0]).not.toContain(' failed');
		const rows = failedVerbs();
		expect(rows.length).toBeGreaterThan(0);
		for (const v of rows) expect(v.className).toContain('text-danger');
	});
	test('a recovered current failure draws the ring, a failing one the solid disc; the recovered words go neutral', async () => {
		stub();
		render(WithQueryClient, { props: { component: Activity as any } });
		await loaded();
		await waitFor(() => expect(rollups()[0]).toContain('failed'), { timeout: 10_000 });
		const chipOf = (app: string) => {
			const row = [...document.querySelectorAll('.fr-in')].find((r) => r.querySelector('.fr-nm')?.textContent === app && r.querySelector('.fr-v')?.textContent === 'failed its health check')!;
			return row.querySelector('.fr-mk span.rounded-full')!.className;
		};
		expect(chipOf('catalog-api')).toContain('ring-[1.5px]');
		expect(chipOf('catalog-api')).not.toContain('bg-danger-solid');
		expect(chipOf('orders-hub')).toContain('bg-danger-solid');
	});
});
