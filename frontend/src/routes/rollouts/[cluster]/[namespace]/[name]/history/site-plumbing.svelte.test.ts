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
 * History names the place of a rollout whose label says only `prod` by the Environment's SITE ("prod · eu-west") in its Change version flow.
 * History reads the page through `$app/stores`, so the mock is a writable store.
 */
const store = vi.hoisted(() => ({ value: null as any, set: null as any }));
vi.mock('$app/stores', async () => {
	const { writable } = await import('svelte/store');
	const page = writable({
		params: { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' },
		url: new URL(
			'http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history?action=rollback'
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
const ROLLOUT_DETAIL_URL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;

function detailFetch() {
	const payload = fleet(() => ({ at: 2, cameFrom: 1, hold: 'none' }));
	const one = JSON.parse(JSON.stringify(payload.rollouts.items[0]));
	const env = JSON.parse(JSON.stringify(payload.environments.items[0]));
	one.metadata.labels = { ...(one.metadata.labels ?? {}), environment: 'prod' };
	env.spec = { ...(env.spec ?? {}), environment: 'prod', site: 'eu-west' };
	const list = respond(payload) as any;
	return async (input: any) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? input));
		if (ROLLOUT_DETAIL_URL.test(url)) {
			return new Response(JSON.stringify({ rollout: one, environment: env, rolloutGates: { items: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}
		return list(input);
	};
}

describe('History names the Environment\'s site in its Change version flow', () => {
	test('?action=rollback: "Roll back prod · eu-west to …"', async () => {
		vi.stubGlobal('fetch', vi.fn(detailFetch()));
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(() => expect(document.querySelector('dialog[open]')).not.toBeNull(), { timeout: 8000 });
		await waitFor(() => expect(document.querySelector('dialog[open]')!.textContent).toMatch(/Roll back prod · eu-west to /), { timeout: 8000 });
	});
});
