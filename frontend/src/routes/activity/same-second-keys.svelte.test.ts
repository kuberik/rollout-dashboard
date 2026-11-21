/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Activity from './+page.svelte';
import { respond } from '../../lib/messages/fleet-fixture';

/**
 * ⛔ (2026-11-21, owner: "Uncaught Svelte error: each_key_duplicate — Keyed
 * each block has duplicate key `hello-multi-dev/hello-multi-app/
 * 2026-11-21T14:23:02Z` at indexes 3 and 4 … in DeployBars.svelte")
 * History `timestamp`s have second precision, and an automatic rollback is
 * deployed in the same second its failed deploy is judged. This is
 * hello-multi-app's real history on the kind preview: ids 25 and 26 share a
 * timestamp outright, and id 27 FAILED at 14:23:02 (its `bakeEndTime`, the
 * instant this page prints for a failure) — the second id 28 rolled back.
 */
const history = [
	{ id: 28, version: { tag: 'v5', version: 'v5' }, timestamp: '2026-11-21T14:23:02Z', bakeStatus: 'Succeeded', bakeEndTime: '2026-11-21T14:23:49Z', deployKind: 'AutoRollback', message: 'Automatic rollback' },
	{ id: 27, version: { tag: 'v6', version: 'v6' }, timestamp: '2026-11-21T14:22:00Z', bakeStatus: 'Failed', bakeStartTime: '2026-11-21T14:22:00Z', bakeEndTime: '2026-11-21T14:23:02Z' },
	{ id: 26, version: { tag: 'v5', version: 'v5' }, timestamp: '2026-11-21T14:18:11Z', bakeStatus: 'Succeeded', bakeEndTime: '2026-11-21T14:20:29Z', deployKind: 'AutoRollback' },
	{ id: 25, version: { tag: 'v4', version: 'v4' }, timestamp: '2026-11-21T14:18:11Z', bakeStatus: 'Failed', bakeStartTime: '2026-11-21T14:18:11Z', bakeEndTime: '2026-11-21T14:18:11Z' },
	{ id: 24, version: { tag: 'v5', version: 'v5' }, timestamp: '2026-11-21T14:00:00Z', bakeStatus: 'Succeeded', bakeEndTime: '2026-11-21T14:02:00Z' }
];

const payload = {
	rollouts: {
		items: [
			{
				metadata: { name: 'hello-multi-app', namespace: 'hello-multi-dev' },
				spec: {},
				status: { availableReleases: ['v4', 'v5', 'v6'].map((t) => ({ tag: t, version: t })), releaseCandidates: [], gates: [], conditions: [], history }
			}
		]
	},
	environments: { items: [] },
	rolloutDependencies: { items: [] },
	clusters: [{ name: 'rollout-a', url: 'https://rollout-a' }],
	clusterErrors: []
};

const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
beforeEach(() => {
	// jsdom has no layout: give the chart a width so its markers draw.
	Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(new Date('2026-11-21T15:00:00Z'));
});
afterEach(() => {
	if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDesc);
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('two history entries in the same second', () => {
	test('render every row and chart marker without a duplicate key', async () => {
		const errors: unknown[] = [];
		vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a));
		const onError = (e: ErrorEvent) => errors.push(e.error ?? e.message);
		window.addEventListener('error', onError);
		vi.stubGlobal('fetch', vi.fn(respond(payload)));
		try {
			render(WithQueryClient, { props: { component: Activity as any } });
			await waitFor(() => expect(screen.getAllByText(/hello-multi-app/i).length).toBeGreaterThan(0), { timeout: 5000 });
			await vi.advanceTimersByTimeAsync(300);
		} finally {
			window.removeEventListener('error', onError);
		}
		expect(errors.map(String).filter((s) => /each_key_duplicate|duplicate key/i.test(s))).toEqual([]);
		// The chart drew, and each of the two failures has its own marker line.
		expect(document.querySelector('.db svg')).not.toBeNull();
		const markers = [...document.querySelectorAll('.db svg .db-marker')];
		expect(markers.length).toBeGreaterThanOrEqual(2);
	});
});
