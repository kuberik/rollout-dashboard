/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor, fireEvent } from '@testing-library/svelte';

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

let retryStatus = 500;
const posts: string[] = [];
function open(app: string, query: string) {
	resetDemoState('calm');
	const ns = `${app}-prod-default`;
	state.page.params = { cluster: 'prod', namespace: ns, name: app };
	state.page.url = new URL(`http://localhost/rollouts/prod/${ns}/${app}${query}`);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: any, init?: any) => {
			const url = String(typeof input === 'string' ? input : (input?.url ?? input));
			if ((init?.method ?? 'GET') === 'POST' && /\/retry$/.test(url)) {
				posts.push(url);
				return new Response(retryStatus === 200 ? '{}' : '{"error":"admission webhook denied"}', { status: retryStatus, headers: { 'Content-Type': 'application/json' } });
			}
			const r = respond((init?.method ?? 'GET') as string, url.replace(/^https?:\/\/[^/]+/, ''));
			return new Response(r.body ?? '', { status: r.status, headers: r.headers });
		})
	);
	document.body.innerHTML = '';
	render(WithQueryClient, { props: { component: RolloutDetail as any } });
}

/**
 * The Overview's own Retry wiring (`retryDeployment`), through the real page: a failed Retry prints once, inside the open confirm, with no
 * toast; an accepted one closes the confirm and the success toast follows.
 */
async function confirmRetry() {
	open('orders-hub', '?action=retry');
	await waitFor(() => expect(document.querySelector('#rcm-title')?.textContent).toMatch(/^Retry /), { timeout: 15_000 });
	const typed = document.querySelector<HTMLInputElement>('#rcm-confirm');
	if (typed) {
		const tag = document.querySelector('label[for="rcm-confirm"] span')!.textContent!.trim();
		await fireEvent.input(typed, { target: { value: tag } });
	}
	await fireEvent.click([...document.querySelectorAll('dialog[open] button')].find((b) => b.textContent!.trim() === 'Retry')!);
}

describe('rollout page: Retry from the Overview', { timeout: 40_000 }, () => {
	test('a failed Retry prints inside the open confirm and raises no toast', async () => {
		retryStatus = 500;
		await confirmRetry();
		await waitFor(() => expect(document.querySelector('[data-retry-error]')?.textContent).toBe('Failed to retry: admission webhook denied'), { timeout: 10_000 });
		expect(document.querySelector('#rcm-title')).not.toBeNull();
		await new Promise((r) => setTimeout(r, 500));
		expect(document.body.textContent!.split('Failed to retry').length - 1).toBe(1);
	});
	test('an accepted Retry closes the confirm and the success toast follows', async () => {
		retryStatus = 200;
		await confirmRetry();
		await waitFor(() => expect(document.body.textContent).toMatch(/Retry started/), { timeout: 10_000 });
		expect(document.querySelector('[data-retry-error]')).toBeNull();
	});
});
