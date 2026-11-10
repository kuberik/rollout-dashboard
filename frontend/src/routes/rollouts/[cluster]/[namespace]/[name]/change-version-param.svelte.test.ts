/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

// jsdom does not implement `<dialog>`'s `showModal`/`close` (a known,
// long-standing gap — https://github.com/jsdom/jsdom/issues/3294). The
// REAL `ChangeVersionModal` renders a native dialog via flowbite-svelte's
// `Dialog`, and this file deliberately opens it twice, so the gap is no
// longer avoidable by accident the way a single-open test can dodge it.
// Minimal polyfill, scoped to this file.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
		this.setAttribute('open', '');
	};
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
		this.removeAttribute('open');
	};
}
// Same jsdom gap, the Web Animations API this time (Svelte's own
// `in:`/`out:` transitions on the dialog call `element.animate()`).
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * ⭐ ROUND 4, ITEM A (AD "REAL BUG", squad-rollout coordinator, 2026-10-10):
 * "Change version…" opened no modal in 3 of 4 runs. The Overview's old
 * `?action=change-version` effect read `page.url` directly inside a plain
 * `$effect`, which fired on the FIRST request (param + loaded `rollout`
 * both true at once) but never re-armed for a SECOND identical request
 * from an already-mounted page — the common path: close the modal, open
 * the palette again, pick "Change version…" a second time. The fix reads
 * the param through `afterNavigate` (SvelteKit's own "a navigation just
 * completed" hook, which fires on a same-route query-only navigation too)
 * into a pending flag, and a separate `$effect` opens the modal once
 * `rollout` is loaded and clears the flag — this file proves two
 * navigations open the modal twice.
 *
 * Mocking pattern copied from `lib/messages/subject-detail.svelte.test.ts`
 * (same reason: `$app/state`/`$app/navigation` need `vi.mock`, which is
 * hoisted per file, so this lives in its own file rather than extending
 * that one).
 */
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
function detailFetch() {
	const payload = fleet();
	const one = payload.rollouts.items[0];
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

describe('the Overview opens Change version from ?action=change-version on every navigation, not just the first', () => {
	test('two navigations with the param open the modal twice', async () => {
		state.page.params = { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' };
		state.page.url = new URL(
			'http://localhost/rollouts/rollout-a/alpha-dev/alpha-app?action=change-version'
		);
		vi.stubGlobal('fetch', vi.fn(detailFetch()));

		render(WithQueryClient, { props: { component: RolloutDetail as any } });

		// FIRST OPEN — the param was already in the URL on mount; the
		// `$effect` fires once `rollout` has loaded. The picker's own search
		// input is the user-visible proof the modal is open.
		await waitFor(
			() => expect(screen.getByPlaceholderText(/Search builds by sha/i)).toBeInTheDocument(),
			{ timeout: 5000 }
		);
		// The effect strips the param once it has opened the modal — this is
		// the signal the SECOND assertion below re-checks, since closing a
		// real `Modal` from outside the component is not something this
		// harness can simulate.
		await waitFor(() => expect(state.page.url.searchParams.get('action')).toBeNull());

		// SECOND NAVIGATION — the palette re-navigates to the SAME route
		// with the SAME param. A real `goto()` would deliver this as an
		// `afterNavigate` event; invoke the captured callback directly,
		// the way SvelteKit's router would.
		state.page.url = new URL(
			'http://localhost/rollouts/rollout-a/alpha-dev/alpha-app?action=change-version'
		);
		expect(nav.afterNavigateCb).not.toBeNull();
		nav.afterNavigateCb?.();

		// SECOND OPEN — if the old bug were still here, `changeVersionPending`
		// would never be set a second time and the param would stay on the
		// URL forever. It must be stripped again, proving the effect fired
		// a second, independent time.
		await waitFor(() => expect(state.page.url.searchParams.get('action')).toBeNull());
	});
});
