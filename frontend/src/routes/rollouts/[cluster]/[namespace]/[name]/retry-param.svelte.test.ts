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

/** `?action=retry` on a rollout that has nothing to retry: the param goes and no dialog opens (harness copied from change-version-param). */
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

describe('?action=retry on a rollout that is not failed', () => {
	test('the param is cleared and no Retry dialog opens', async () => {
		state.page.params = { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' };
		state.page.url = new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app?action=retry');
		vi.stubGlobal('fetch', vi.fn(detailFetch()));
		render(WithQueryClient, { props: { component: RolloutDetail as any } });
		await waitFor(() => expect(state.page.url.searchParams.get('action')).toBeNull(), { timeout: 5000 });
		expect(document.querySelector('#rcm-title')).toBeNull();
		expect(document.querySelector('#failure-retry-btn')).toBeNull();
	});
});
