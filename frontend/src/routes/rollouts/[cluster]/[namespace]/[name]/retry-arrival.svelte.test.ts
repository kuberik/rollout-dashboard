/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.removeAttribute('open');
	};
}
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	(Element.prototype as any).animate = () => ({ finished: Promise.resolve(), cancel: () => {}, play: () => {}, pause: () => {}, addEventListener: () => {}, removeEventListener: () => {} });
}

/**
 * `?action=retry` on a FAILED rollout, through the real rollout page on the health-failures demo: the failure panel's Retry confirm opens
 * and the param is cleared. catalog-api has recovered checks, orders-hub is failing now.
 */
const state = vi.hoisted(() => ({
	page: { params: {} as Record<string, string>, url: new URL('http://localhost/rollouts/prod/x/y'), route: { id: null as string | null }, status: 200, error: null, data: {}, form: null }
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn((url: URL) => {
		state.page.url = url instanceof URL ? url : new URL(String(url), state.page.url);
	}),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import RolloutDetail from './+page.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';

beforeAll(() => install(true));
afterEach(() => vi.unstubAllGlobals());

function open(app: string, query: string) {
	resetDemoState('calm');
	const ns = `${app}-prod-default`;
	state.page.params = { cluster: 'prod', namespace: ns, name: app };
	state.page.url = new URL(`http://localhost/rollouts/prod/${ns}/${app}${query}`);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: any, init?: any) => {
			const url = String(typeof input === 'string' ? input : (input?.url ?? input));
			const r = respond((init?.method ?? 'GET') as string, url.replace(/^https?:\/\/[^/]+/, ''));
			return new Response(r.body ?? '', { status: r.status, headers: r.headers });
		})
	);
	document.body.innerHTML = '';
	render(WithQueryClient, { props: { component: RolloutDetail as any } });
}

describe('rollout page: ?action=retry on a failed rollout', { timeout: 30_000 }, () => {
	for (const app of ['catalog-api', 'orders-hub']) {
		test(`${app}: the Retry confirm opens and the param is cleared`, async () => {
			open(app, '?action=retry');
			await waitFor(() => expect(document.querySelector('#rcm-title')?.textContent).toMatch(/^Retry /), { timeout: 15_000 });
			await waitFor(() => expect(state.page.url.searchParams.get('action')).toBeNull(), { timeout: 5000 });
		});
		test(`${app}: without the param no confirm opens`, async () => {
			open(app, '');
			await waitFor(() => expect(document.querySelector('#failure-retry-btn, [data-retry]')).not.toBeNull(), { timeout: 15_000 }).catch(() => {});
			await new Promise((r) => setTimeout(r, 1500));
			expect(document.querySelector('#rcm-title')).toBeNull();
		});
	}
});
