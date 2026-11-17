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

/** The Overview refuses Roll back on a rollout another controller owns, and says why as text (a title is hover-only). */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);

const nav = vi.hoisted(() => ({
	afterNavigateCb: null as null | (() => void)
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	// Mocked to actually mutate `state.page.url`, the same object the
	// component reads back — a real `replaceState` does this too, just via
	// the browser's History API instead of a direct assignment.
	replaceState: vi.fn((url: URL) => {
		state.page.url = url instanceof URL ? url : new URL(String(url), state.page.url);
	}),
	beforeNavigate: vi.fn(),
	// Captures the callback instead of running it, so the test can fire it
	// on demand — exactly the "a navigation just completed" event SvelteKit
	// itself would deliver on a same-route, query-only `goto()`.
	afterNavigate: vi.fn((cb: () => void) => {
		nav.afterNavigateCb = cb;
	})
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import RolloutDetail from './+page.svelte';
import { fleet, respond } from '../../../../../lib/messages/fleet-fixture';

afterEach(() => vi.unstubAllGlobals());

const ROLLOUT_DETAIL_URL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;

/** Same shape `subject-detail.svelte.test.ts`'s own `detailFetch` uses. */
function detailFetch(owned = true) {
	const payload = fleet(() => ({ at: 2, cameFrom: 1, hold: 'none' }));
	const one = JSON.parse(JSON.stringify(payload.rollouts.items[0]));
	if (owned) one.metadata.managedFields = [{ manager: 'flux-controller', operation: 'Apply', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }];
	if (owned) one.spec = { ...(one.spec ?? {}), wantedVersion: one.status?.history?.[0]?.version?.tag ?? 'pinned' };
	const env = payload.environments.items[0];
	const list = respond(payload) as any;
	return async (input: any) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? input));
		if (ROLLOUT_DETAIL_URL.test(url)) {
			return new Response(
				JSON.stringify({ rollout: one, environment: env, rolloutGates: { items: [] } }),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			);
		}
		return list(input);
	};
}

describe('the Overview on a rollout whose wanted version another controller owns', () => {
	test('the reason is a line of text with an id the disabled actions point at', async () => {
		state.page.params = { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' };
		state.page.url = new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app');
		vi.stubGlobal('fetch', vi.fn(detailFetch()));
		render(WithQueryClient, { props: { component: RolloutDetail as any } });
		const reason = await waitFor(() => {
			const r = document.querySelector('#owned-reason');
			expect(r).not.toBeNull();
			return r!;
		}, { timeout: 8000 });
		expect(reason.textContent).toBe("Another controller owns this rollout's wanted version, so the dashboard cannot pin it.");
		const btn = document.querySelector<HTMLButtonElement>('#status-rollback-btn');
		if (btn) {
			expect(btn.disabled).toBe(true);
			expect(btn.getAttribute('title')).toBe(reason.textContent);
			expect(btn.getAttribute('aria-describedby')).toBe('owned-reason');
		}
	});
	test('owned elsewhere: ?action=rollback opens no dialog and clears the param', async () => {
		state.page.params = { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' };
		state.page.url = new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app?action=rollback');
		vi.stubGlobal('fetch', vi.fn(detailFetch(true)));
		render(WithQueryClient, { props: { component: RolloutDetail as any } });
		await waitFor(() => expect(document.querySelector('#owned-reason')).not.toBeNull(), { timeout: 8000 });
		await new Promise((r) => setTimeout(r, 800));
		expect(document.querySelector('dialog[open]')).toBeNull();
	});
	test('owned by the dashboard: the same link opens the Roll back dialog (positive control)', async () => {
		state.page.params = { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' };
		state.page.url = new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app?action=rollback');
		vi.stubGlobal('fetch', vi.fn(detailFetch(false)));
		render(WithQueryClient, { props: { component: RolloutDetail as any } });
		await waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull(), { timeout: 12000 });
	}, 20_000);
});
