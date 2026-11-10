/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

// jsdom has no `<dialog>` showModal/close and no Web Animations API; the
// real ChangeVersionModal needs both. Same file-scoped polyfill the
// Overview's `../change-version-param.svelte.test.ts` uses.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.removeAttribute('open');
	};
}
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	(Element.prototype as any).animate = () => ({
		finished: Promise.resolve(),
		cancel: () => {},
		play: () => {},
		pause: () => {},
		addEventListener: () => {},
		removeEventListener: () => {}
	});
}

/**
 * ⭐ PALROW r9 (squad-rollout, 2026-10-11): THE PALETTE'S "Change version…"
 * RUN FROM HISTORY OPENS THE FLOW ON HISTORY, ONCE. The palette navigates to
 * `…/history?action=change-version` when the reader is on History (AD-signed
 * behaviour). The tip's History had no handler for the param, so the command
 * landed and opened nothing. This pins the handler: the flow opens exactly
 * once (one picker on screen), the param is stripped, and a SECOND identical
 * request from the already-mounted tab (an `afterNavigate`, the way a
 * same-route `goto()` is delivered) opens it again rather than being missed.
 *
 * History reads the page through `$app/stores` (not `$app/state` like the
 * Overview), so the mock is a writable store whose URL `replaceState` updates.
 */
const store = vi.hoisted(() => ({ value: null as any, set: null as any }));
vi.mock('$app/stores', async () => {
	const { writable } = await import('svelte/store');
	const page = writable({
		params: { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' },
		url: new URL(
			'http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history?action=change-version'
		),
		route: { id: null },
		status: 200,
		error: null,
		data: {},
		form: null,
		state: {}
	});
	store.value = page;
	return {
		page,
		navigating: writable(null),
		updated: { subscribe: writable(false).subscribe, check: async () => false }
	};
});

const nav = vi.hoisted(() => ({ afterNavigateCb: null as null | (() => void) }));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn((url: URL) => {
		store.value.update((p: any) => ({
			...p,
			url: url instanceof URL ? url : new URL(String(url), p.url)
		}));
	}),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn((cb: () => void) => {
		nav.afterNavigateCb = cb;
	})
}));

import { get } from 'svelte/store';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import History from './+page.svelte';
import { fleet, respond } from '../../../../../../lib/messages/fleet-fixture';

afterEach(() => vi.unstubAllGlobals());

const ROLLOUT_DETAIL_URL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;

function detailFetch() {
	const payload = fleet(() => ({ at: 2, cameFrom: 1, hold: 'none' }));
	const one = payload.rollouts.items[0];
	const env = payload.environments.items[0];
	const list = respond(payload) as any;
	return async (input: any) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? input));
		if (ROLLOUT_DETAIL_URL.test(url)) {
			return new Response(
				JSON.stringify({ rollout: one, environment: env, rolloutGates: { items: [] } }),
				{
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				}
			);
		}
		return list(input);
	};
}

const actionParam = () => (get(store.value) as any).url.searchParams.get('action');

describe('History opens Change version from ?action=change-version', () => {
	test('the flow opens exactly once, the param is stripped, and a second request reopens it', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch()));
		render(WithQueryClient, { props: { component: History as any } });

		await waitFor(() => expect(screen.getAllByPlaceholderText(/Search builds/i)).toHaveLength(1), {
			timeout: 5000
		});
		await waitFor(() => expect(actionParam()).toBeNull());
		// Still exactly one picker after the param is gone: nothing re-fired.
		expect(screen.getAllByPlaceholderText(/Search builds/i)).toHaveLength(1);

		// A second identical request from the mounted tab.
		store.value.update((p: any) => ({
			...p,
			url: new URL(
				'http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history?action=change-version'
			)
		}));
		expect(nav.afterNavigateCb).not.toBeNull();
		nav.afterNavigateCb?.();
		await waitFor(() => expect(actionParam()).toBeNull());
		expect(screen.getAllByPlaceholderText(/Search builds/i)).toHaveLength(1);
	});
});

/**
 * `?deploy=X&action=rollback` (the diff page's "Roll back to X") must open
 * the dialog on X, not on the header's default rollback target. The palette
 * effect used to overwrite the deep link's selection with `rollbackNow`.
 */
describe('History rollback deep link', () => {
	const base = 'http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history';

	test('?deploy=X&action=rollback selects X', async () => {
		store.value.update((p: any) => ({
			...p,
			url: new URL(`${base}?deploy=r3ccccc&action=rollback`)
		}));
		vi.stubGlobal('fetch', vi.fn(detailFetch()));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull(), {
			timeout: 5000
		});
		await new Promise((r) => setTimeout(r, 300));
		const dlg = document.querySelector('dialog[open]')!.textContent ?? '';
		expect(dlg).toContain('Pin dev to r3ccccc');
	});

	test('plain ?action=rollback still selects the rollback target', async () => {
		store.value.update((p: any) => ({ ...p, url: new URL(`${base}?action=rollback`) }));
		vi.stubGlobal('fetch', vi.fn(detailFetch()));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull(), {
			timeout: 5000
		});
		await new Promise((r) => setTimeout(r, 300));
		const dlg = document.querySelector('dialog[open]')!.textContent ?? '';
		expect(dlg).toContain('Roll back dev to r2bbbbb');
	});
});
