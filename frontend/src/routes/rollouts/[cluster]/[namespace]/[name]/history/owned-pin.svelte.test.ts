/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

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
 * Roll back on History follows the ownership rule of the header and the Overview: when another controller owns `spec.wantedVersion`, every Roll back is
 * disabled with the same reason and the `?action=rollback` link opens nothing.
 * History reads the page through `$app/stores`, so the mock is a writable store.
 */
const store = vi.hoisted(() => ({ value: null as any, set: null as any }));
vi.mock('$app/stores', async () => {
	const { writable } = await import('svelte/store');
	const page = writable({
		params: { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' },
		url: new URL(
			'http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history'
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

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import History from './+page.svelte';
import { fleet, respond } from '../../../../../../lib/messages/fleet-fixture';

afterEach(() => vi.unstubAllGlobals());
import { WANTED_VERSION_OWNED_REASON } from '$lib/view-models/pin-hold';
const ROLLOUT_DETAIL_URL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;

function detailFetch(owner: string | null) {
	const payload = fleet(() => ({ at: 2, cameFrom: 1, hold: 'none' }));
	const one = JSON.parse(JSON.stringify(payload.rollouts.items[0]));
	const env = JSON.parse(JSON.stringify(payload.environments.items[0]));
	if (owner) {
		one.metadata.managedFields = [{ manager: owner, operation: 'Apply', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }];
		one.spec = { ...(one.spec ?? {}), wantedVersion: 'pinned' };
	}
	const list = respond(payload) as any;
	return async (input: any) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? input));
		if (ROLLOUT_DETAIL_URL.test(url)) {
			return new Response(JSON.stringify({ rollout: one, environment: env, rolloutGates: { items: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}
		return list(input);
	};
}
const rowButtons = () => [...document.querySelectorAll<HTMLButtonElement>('button[data-action="rollback"][aria-label="Roll back to this build"]')];

describe('History Roll back obeys the wanted-version ownership rule', () => {
	test('owned elsewhere: every row Roll back is disabled and says why', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch('flux-controller')));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(rowButtons().length).toBeGreaterThan(0), { timeout: 8000 });
		for (const b of rowButtons()) {
			expect(b.disabled).toBe(true);
			expect(b.getAttribute('title')).toBe(WANTED_VERSION_OWNED_REASON);
		}
	});
	test('owned by the dashboard: the row Roll back is enabled', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch(null)));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(rowButtons().length).toBeGreaterThan(0), { timeout: 8000 });
		for (const b of rowButtons()) expect(b.disabled).toBe(false);
	});
	test('owned elsewhere: ?action=rollback opens no dialog', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch('flux-controller')));
		store.value.update((p: any) => ({ ...p, url: new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history?action=rollback') }));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(rowButtons().length).toBeGreaterThan(0), { timeout: 8000 });
		await new Promise((r) => setTimeout(r, 400));
		expect(document.querySelector('dialog[open]')).toBeNull();
		expect(document.querySelector('[data-owned-reason]')?.textContent).toBe(WANTED_VERSION_OWNED_REASON);
		expect(new URL(String(window.location.href)).searchParams.get('action')).toBeNull();
	});
	test('owned elsewhere: a ?deploy=<build>&action=rollback link (the diff page\'s) opens no dialog', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch('flux-controller')));
		const payload = fleet(() => ({ at: 2, cameFrom: 1, hold: 'none' }));
		const tags = (payload.rollouts.items[0].status.history as { version: { tag: string } }[]).map((h) => h.version.tag);
		expect(tags.length).toBeGreaterThan(1);
		store.value.update((p: any) => ({ ...p, url: new URL(`http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history?deploy=${encodeURIComponent(tags[1])}&action=rollback`) }));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(rowButtons().length).toBeGreaterThan(0), { timeout: 8000 });
		await new Promise((r) => setTimeout(r, 600));
		expect(document.querySelector('dialog[open]')).toBeNull();
	});
	test('owned by the dashboard: the same link opens the Roll back dialog (positive control)', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch(null)));
		const payload = fleet(() => ({ at: 2, cameFrom: 1, hold: 'none' }));
		const tags = (payload.rollouts.items[0].status.history as { version: { tag: string } }[]).map((h) => h.version.tag);
		store.value.update((p: any) => ({ ...p, url: new URL(`http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history?deploy=${encodeURIComponent(tags[1])}&action=rollback`) }));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull(), { timeout: 8000 });
	});
	test('owned elsewhere: the cadence strip\'s hover card Roll back is disabled with the reason', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch('flux-controller')));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(document.querySelector('.cadence-segment[data-state="healthy"]')).not.toBeNull(), { timeout: 8000 });
		await fireEvent.mouseEnter(document.querySelector('.cadence-segment[data-state="healthy"]')!);
		const b = (await screen.findAllByRole('button', { name: /Roll back to this/ })).find((e) => !e.closest('[data-row-actions]') && !e.closest('.deploy-row')) as HTMLButtonElement;
		expect(b, 'the hover card\'s Roll back').toBeTruthy();
		expect(b.disabled).toBe(true);
		expect(b.getAttribute('title')).toBe(WANTED_VERSION_OWNED_REASON);
	});
	test('owned elsewhere: the expanded panel\'s Roll back is disabled too', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch('flux-controller')));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(rowButtons().length).toBeGreaterThan(0), { timeout: 8000 });
		const panel = () => rowButtons().filter((b) => !b.closest('[data-row-actions]'));
		for (const r of document.querySelectorAll<HTMLElement>('.deploy-row button[aria-expanded="false"]')) {
			await fireEvent.click(r);
			if (panel().length) break;
		}
		await waitFor(() => expect(panel().length).toBeGreaterThan(0));
		for (const b of panel()) {
			expect(b.disabled).toBe(true);
			expect(b.getAttribute('title')).toBe(WANTED_VERSION_OWNED_REASON);
			// a phone has no hover: the same reason sits beside the panel's button and describes it
			const id = b.getAttribute('aria-describedby');
			expect(id, 'the disabled Roll back names its reason').toBeTruthy();
			const reason = document.getElementById(id!);
			expect(reason?.textContent).toBe(WANTED_VERSION_OWNED_REASON);
			expect(reason?.parentElement).toBe(b.closest('.hist-row-actions')?.parentElement);
		}
	});
	test('owned by the dashboard: the expanded panel carries no inline reason', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch(null)));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(rowButtons().length).toBeGreaterThan(0), { timeout: 8000 });
		const panel = () => rowButtons().filter((b) => !b.closest('[data-row-actions]'));
		for (const r of document.querySelectorAll<HTMLElement>('.deploy-row button[aria-expanded="false"]')) {
			await fireEvent.click(r);
			if (panel().length) break;
		}
		await waitFor(() => expect(panel().length).toBeGreaterThan(0));
		expect(document.querySelector('[data-owned-reason-inline]')).toBeNull();
		for (const b of panel()) expect(b.getAttribute('aria-describedby')).toBeNull();
	});
});
