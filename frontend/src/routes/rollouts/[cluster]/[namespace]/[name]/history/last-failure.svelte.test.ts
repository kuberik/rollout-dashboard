/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

/**
 * The History tab's Summary prints "Last failure" as the newest failed deploy's own failure instant (when its bake ended), inside the
 * selected range. This renders the real page, fed a rollout whose failed deploy started 12:35 and failed 12:45 with the clock pinned at
 * 13:05, and reads what the Summary card prints: "20m ago" (the bake end), never "30m ago" (the deploy start).
 */
const NOW = new Date('2026-11-10T13:05:00Z');

const store = vi.hoisted(() => ({ value: null as any }));
vi.mock('$app/stores', async () => {
	const { writable } = await import('svelte/store');
	const page = writable({
		params: { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' },
		url: new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history'),
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
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));
vi.mock('$lib/stores/time', async () => {
	const { readable } = await import('svelte/store');
	return { now: readable(new Date('2026-11-10T13:05:00Z')) };
});

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import History from './+page.svelte';
import { fleet, respond } from '../../../../../../lib/messages/fleet-fixture';

const ROLLOUT_DETAIL_URL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;

const entry = (id: number, timestamp: string, bakeStatus: string, bakeEndTime?: string) => ({
	id,
	version: `1.0.${id}`,
	timestamp,
	bakeStatus,
	...(bakeEndTime ? { bakeEndTime } : {})
});

function stubFetch(history: any[]) {
	const payload = fleet(() => ({ at: 2, cameFrom: 1, hold: 'none' }));
	const one = payload.rollouts.items[0];
	one.status.history = history;
	const env = payload.environments.items[0];
	const list = respond(payload) as any;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: any) => {
			const url = String(typeof input === 'string' ? input : (input?.url ?? input));
			if (ROLLOUT_DETAIL_URL.test(url)) {
				return new Response(JSON.stringify({ rollout: one, environment: env, rolloutGates: { items: [] } }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			}
			return list(input);
		})
	);
}

function setRange(range: string | null) {
	const url = new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app/history');
	if (range) url.searchParams.set('range', range);
	store.value.update((p: any) => ({ ...p, url }));
}

/** The text printed beside the Summary card's "Last failure" label. */
async function printedLastFailure(): Promise<string> {
	const label = await screen.findByText('Last failure', undefined, { timeout: 5000 });
	return (label.parentElement?.textContent ?? '').replace('Last failure', '').trim();
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	setRange(null);
});

describe('History Summary: Last failure', () => {
	test('prints the failure instant (20m ago), not the deploy start (30m ago)', async () => {
		stubFetch([entry(2, '2026-11-10T12:55:00Z', 'Succeeded'), entry(1, '2026-11-10T12:35:00Z', 'Failed', '2026-11-10T12:45:00Z')]);
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(async () => expect(await printedLastFailure()).toBe('20m ago'), { timeout: 5000 });
	});

	test('with two failures the newer one wins', async () => {
		stubFetch([
			entry(3, '2026-11-10T12:55:00Z', 'Succeeded'),
			entry(2, '2026-11-10T12:35:00Z', 'Failed', '2026-11-10T12:45:00Z'),
			entry(1, '2026-11-10T11:00:00Z', 'Failed', '2026-11-10T11:10:00Z')
		]);
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(async () => expect(await printedLastFailure()).toBe('20m ago'), { timeout: 5000 });
	});

	test('a failure outside the selected range is not printed', async () => {
		stubFetch([entry(2, '2026-11-10T12:55:00Z', 'Succeeded'), entry(1, '2026-11-07T12:35:00Z', 'Failed', '2026-11-07T12:45:00Z')]);
		setRange('1d');
		render(WithQueryClient, { props: { component: History as any } });
		await waitFor(async () => expect(await printedLastFailure()).toBe('none in range'), { timeout: 5000 });
	});
});
