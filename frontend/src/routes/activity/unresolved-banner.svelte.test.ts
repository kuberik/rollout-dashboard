/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Activity from './+page.svelte';
import { respond } from '../../lib/messages/fleet-fixture';

/**
 * ⭐ A FAILED DEPLOY THAT HAS SINCE BEEN REDEPLOYED IS RESOLVED. (round 4
 * review, 2026-10-09, AD finding 6: a red "A deploy failed" banner showed
 * up in the CALM scenario, naming a failure from 5 hours ago whose rollout
 * had since redeployed successfully.) `blocker` (`+page.svelte`) now reads
 * only `unresolvedFailures` — failed history entries that are ALSO the
 * rollout's current (`isLive`) entry — not every failed entry ever recorded
 * in the window. These fixtures are hand-built (not `fleet()`, which only
 * ever writes one failed/one succeeded entry per rollout, never both on the
 * same one) so the history can carry a Failed entry superseded by a later
 * Succeeded one.
 */

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(new Date('2026-09-02T12:00:00Z'));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function rolloutWith(history: any[]) {
	return {
		metadata: { name: 'checkout-worker', namespace: 'checkout-dev' },
		spec: {},
		status: {
			availableReleases: [],
			releaseCandidates: [],
			gates: [],
			conditions: [],
			history
		}
	};
}

function payloadFor(history: any[]) {
	return {
		rollouts: { items: [rolloutWith(history)] },
		environments: { items: [] },
		rolloutDependencies: { items: [] },
		clusters: [{ name: 'rollout-a', url: 'https://rollout-a' }],
		clusterErrors: []
	};
}

describe('the failed-deploy banner only fires while the failure is unresolved', () => {
	test('no banner when the failed entry has since been redeployed past', async () => {
		const history = [
			{
				id: 2,
				version: { tag: 'v2', version: 'v2' },
				timestamp: '2026-09-02T10:00:00Z',
				bakeStatus: 'Succeeded'
			},
			{
				id: 1,
				version: { tag: 'v1', version: 'v1' },
				timestamp: '2026-09-02T05:00:00Z',
				bakeStatus: 'Failed'
			}
		];
		vi.stubGlobal('fetch', vi.fn(respond(payloadFor(history))));
		render(WithQueryClient, { props: { component: Activity as any } });
		await waitFor(() => expect(screen.getAllByText(/checkout-worker/i).length).toBeGreaterThan(0), {
			timeout: 5000
		});
		await vi.advanceTimersByTimeAsync(300);
		expect(screen.queryByText('A deploy failed')).toBeNull();
	});

	test('the banner fires when the failed entry is the rollout\'s current state', async () => {
		const history = [
			{
				id: 1,
				version: { tag: 'v1', version: 'v1' },
				timestamp: '2026-09-02T05:00:00Z',
				bakeStatus: 'Failed'
			}
		];
		vi.stubGlobal('fetch', vi.fn(respond(payloadFor(history))));
		render(WithQueryClient, { props: { component: Activity as any } });
		await waitFor(() => expect(screen.getAllByText(/checkout-worker/i).length).toBeGreaterThan(0), {
			timeout: 5000
		});
		await vi.advanceTimersByTimeAsync(300);
		expect(screen.getByText('A deploy failed')).toBeTruthy();
	});

	/**
	 * ⭐ shared/age-lag-total (2026-10-12): ONE AGE PER EVENT. This page builds
	 * its own entry list (never `ActivityRail.svelte`, which Home's rail
	 * uses), so the "failed N ago" banner and the activity row's own clock
	 * must read `event-age.ts`'s `historyEntrySince` (`bakeEndTime ??
	 * timestamp`) too, or this page keeps the deploy's START as "the failure
	 * instant" while every other surface (FleetRow, Needs-you, Your changes)
	 * has already moved to the failed attempt's END.
	 */
	test('the banner age reads the failed attempt\'s end, not its start', async () => {
		const history = [
			{
				id: 1,
				version: { tag: 'v1', version: 'v1' },
				timestamp: '2026-09-02T11:17:00Z',
				bakeStartTime: '2026-09-02T11:17:00Z',
				bakeEndTime: '2026-09-02T11:58:00Z',
				bakeStatus: 'Failed'
			}
		];
		vi.stubGlobal('fetch', vi.fn(respond(payloadFor(history))));
		render(WithQueryClient, { props: { component: Activity as any } });
		await waitFor(() => expect(screen.getByText('A deploy failed')).toBeTruthy(), { timeout: 5000 });
		// 12:00 system time minus the 11:58 bakeEndTime is 2 minutes; minus
		// the 11:17 timestamp (the deploy's start) would read 43 minutes —
		// the exact "43m vs 8m vs 7m" disagreement this module exists to end.
		expect(screen.getByText(/failed 2 minutes ago/i)).toBeTruthy();
		expect(screen.queryByText(/failed 43 minutes ago/i)).toBeNull();
	});
});
