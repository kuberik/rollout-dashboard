/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor, fireEvent } from '@testing-library/svelte';

/** how many times a dialog was opened (jsdom keeps a closed dialog's element, so counting open ones cannot tell) */
const opened = { n: 0 };
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		opened.n++;
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
import Gates from './+page.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';
import { failureToasts, resetFailureToasts } from '$lib/stores/failure-toasts.svelte';

beforeAll(() => install(true));
afterEach(() => { resetFailureToasts(); vi.unstubAllGlobals(); });

describe('Gates tab: a failed Clear pin names the place like the Overview', () => {
	test('"search-indexer in prod · eu-west", from the matched Environment', async () => {
		resetDemoState('calm');
		const ns = 'search-indexer-prod-default';
		state.page.params = { cluster: 'prod', namespace: ns, name: 'search-indexer' };
		state.page.url = new URL(`http://localhost/rollouts/prod/${ns}/search-indexer/gates`);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: any, init?: any) => {
				const url = String(typeof input === 'string' ? input : (input?.url ?? input));
				if ((init?.method ?? 'GET') === 'POST' && /\/pin$/.test(url)) return new Response('{"error":"denied"}', { status: 403, headers: { 'Content-Type': 'application/json' } });
				const r = respond((init?.method ?? 'GET') as string, url.replace(/^https?:\/\/[^/]+/, ''));
				let body = r.body ?? '';
				try {
					const j = JSON.parse(body);
					if (j.rollout?.metadata?.name === 'search-indexer') {
						j.rollout.spec = { ...(j.rollout.spec ?? {}), wantedVersion: j.rollout.status?.history?.[0]?.version?.tag ?? 'pinned' };
						j.rollout.metadata.managedFields = [{ manager: 'rollout-dashboard', operation: 'Update', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }];
						if (j.environment?.spec) j.environment.spec.site = 'eu-west';
						body = JSON.stringify(j);
					}
				} catch { /* not JSON */ }
				return new Response(body, { status: r.status, headers: r.headers });
			})
		);
		document.body.innerHTML = '';
		render(WithQueryClient, { props: { component: Gates as any } });
		await waitFor(() => expect([...document.querySelectorAll('button')].some((b) => b.textContent!.trim() === 'Clear pin')).toBe(true), { timeout: 20_000 });
		await fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Clear pin')!);
		await waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull());
		const dlg = document.querySelector('dialog[open]')!;
		// the confirm itself names the site, in its title and its body
		expect(dlg.getAttribute('aria-label')).toBe('Clear the pin on search-indexer in prod · eu-west?');
		expect(dlg.textContent).toContain('currently held in prod · eu-west');
		const confirm = [...dlg.querySelectorAll('button')].filter((b) => b.textContent!.trim() === 'Clear pin').pop()!;
		await fireEvent.click(confirm);
		await waitFor(() => expect(failureToasts.items.length).toBe(1), { timeout: 8000 });
		expect(failureToasts.items[0].message).toBe('search-indexer in prod · eu-west: Failed to clear pin: denied');
	}, 60_000);
});
