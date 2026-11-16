/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';

/**
 * The Logs and diff tabs draw the same header as the others: a head deploy whose check fails now reads "failing", one whose checks are
 * OK again reads "failed"; the Logs header's age is the head deploy's. Rendered on the health-failures demo: catalog-api (failed, its
 * check recovered) and orders-hub (failed, still failing).
 */
const st = vi.hoisted(() => ({ page: { params: {} as Record<string, string>, url: new URL('http://localhost/x'), route: { id: null as string | null }, status: 200, error: null, data: {}, form: null } }));
vi.mock('$app/state', () => st);
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), pushState: vi.fn(), replaceState: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Logs from './logs/+page.svelte';
import Diff from './diff/[version]/+page.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';
import { formatTimeAgoCompact } from '$lib/utils';
import { headDeployedAt } from '$lib/view-models/head-age';

beforeAll(() => install(true));
afterEach(() => vi.unstubAllGlobals());

const call = (input: any, init?: any) => {
	const url = String(typeof input === 'string' ? input : (input?.url ?? input));
	return respond((init?.method ?? 'GET') as string, url.replace(/^https?:\/\/[^/]+/, ''));
};
const rolloutOf = (app: string) => JSON.parse(call(`/api/rollouts/${app}-prod-default/${app}?cluster=prod`).body ?? '{}').rollout;

function open(Page: any, app: string, tail: string, version?: string) {
	resetDemoState('calm');
	const ns = `${app}-prod-default`;
	const params: Record<string, string> = { cluster: 'prod', namespace: ns, name: app, ...(version ? { version } : {}) };
	const url = new URL(`http://localhost/rollouts/prod/${ns}/${app}/${tail}`);
	st.page.params = params;
	st.page.url = url;
	vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
		const r = call(input, init);
		return new Response(r.body ?? '', { status: r.status, headers: r.headers });
	}));
	document.body.innerHTML = '';
	render(WithQueryClient, { props: { component: Page } });
}

/** the header's state chips: the words the tab prints for the head deploy */
const words = () => [...document.querySelectorAll('.chip, [class*="chip"]')].map((e) => e.textContent?.trim().toLowerCase()).filter(Boolean) as string[];

describe('Logs: the head deploy reads failing / failed, and its age', { timeout: 40_000 }, () => {
	test('a check failing now: "failing"', async () => {
		open(Logs, 'orders-hub', 'logs');
		await waitFor(() => expect(words()).toContain('failing'), { timeout: 20_000 });
		expect(words()).not.toContain('failed');
	});
	test('checks OK again: "failed", never "failing"', async () => {
		open(Logs, 'catalog-api', 'logs');
		await waitFor(() => expect(words()).toContain('failed'), { timeout: 20_000 });
		await new Promise((r) => setTimeout(r, 1500));
		expect(words()).toContain('failed');
		expect(words()).not.toContain('failing');
	});
	test('the header age is the head deploy\'s', async () => {
		const app = 'catalog-api';
		const at = headDeployedAt(rolloutOf(app))!;
		expect(at).toBeTruthy();
		open(Logs, app, 'logs');
		const ok = () => {
			const now = new Date();
			return [now, new Date(now.getTime() - 60_000)].map((n) => `${formatTimeAgoCompact(at, n)} ago`);
		};
		await waitFor(() => {
			const spans = [...document.querySelectorAll('[data-rth-meta] span, .dot-list-row span')].map((e) => e.textContent?.trim());
			expect(spans.some((t) => ok().includes(t as string))).toBe(true);
		}, { timeout: 20_000 });
	});
});

describe('Diff of the head deploy: the same word', { timeout: 40_000 }, () => {
	const head = (app: string) => rolloutOf(app).status.history[0].version.tag as string;
	test('a check failing now: "failing"', async () => {
		open(Diff, 'orders-hub', `diff/${head('orders-hub')}`, head('orders-hub'));
		await waitFor(() => expect(words()).toContain('failing'), { timeout: 20_000 });
	});
	test('checks OK again: "failed", never "failing"', async () => {
		open(Diff, 'catalog-api', `diff/${head('catalog-api')}`, head('catalog-api'));
		await waitFor(() => expect(words()).toContain('failed'), { timeout: 20_000 });
		await new Promise((r) => setTimeout(r, 1500));
		expect(words()).not.toContain('failing');
	});
});
