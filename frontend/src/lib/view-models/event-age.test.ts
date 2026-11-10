import { describe, it, expect } from 'vitest';
import type { Rollout } from '../../types';
import { buildRolloutCards } from '$lib/rollout-cards';
import { eventAge, historyEntrySince } from './event-age';

const NOW = new Date('2026-10-12T12:00:00Z');

const mkRollout = (overrides: Record<string, unknown> = {}): Rollout =>
	({
		metadata: { name: 'checkout-worker', namespace: 'ns' },
		spec: {},
		status: { history: [] },
		...overrides
	}) as unknown as Rollout;

function cardFor(rollout: Rollout) {
	return buildRolloutCards([rollout], [], NOW)[0];
}

describe('eventAge', () => {
	it('failed: reads the failed history entry bakeEndTime over timestamp', () => {
		const rollout = mkRollout({
			status: {
				history: [
					{
						version: { tag: 'bad', version: '1.0.0' },
						bakeStatus: 'Failed',
						timestamp: '2026-10-12T11:17:00Z',
						bakeEndTime: '2026-10-12T11:23:00Z'
					}
				]
			}
		});
		const card = cardFor(rollout);
		expect(eventAge(card, 'failed')).toBe('2026-10-12T11:23:00Z');
	});

	it('failed: falls back to timestamp when there is no bakeEndTime', () => {
		const rollout = mkRollout({
			status: {
				history: [
					{ version: { tag: 'bad', version: '1.0.0' }, bakeStatus: 'Failed', timestamp: '2026-10-12T11:17:00Z' }
				]
			}
		});
		const card = cardFor(rollout);
		expect(eventAge(card, 'failed')).toBe('2026-10-12T11:17:00Z');
	});

	it('failed: a health check failure reads the condition transition, not the deploy entry', () => {
		const rollout = mkRollout({
			status: {
				history: [
					{
						version: { tag: 'ok', version: '1.0.0' },
						bakeStatus: 'Succeeded',
						timestamp: '2026-10-12T09:00:00Z',
						bakeEndTime: '2026-10-12T09:05:00Z'
					}
				],
				conditions: [
					{
						type: 'DeploymentBlocked',
						status: 'True',
						lastTransitionTime: '2026-10-12T11:39:00Z',
						message: "HealthCheck 'checkout-worker-hc' in namespace 'ns' is not healthy (status: Unhealthy): p99 latency too high"
					}
				]
			}
		});
		const card = cardFor(rollout);
		expect(eventAge(card, 'failed')).toBe('2026-10-12T11:39:00Z');
	});

	it('deploying/checking/stuck: the head entry start', () => {
		const rollout = mkRollout({
			status: {
				history: [
					{ version: { tag: 'v2', version: '2.0.0' }, bakeStatus: 'Deploying', timestamp: '2026-10-12T11:50:00Z' }
				]
			}
		});
		const card = cardFor(rollout);
		expect(eventAge(card, 'deploying')).toBe('2026-10-12T11:50:00Z');
		expect(eventAge(card, 'checking')).toBe('2026-10-12T11:50:00Z');
		expect(eventAge(card, 'stuck')).toBe('2026-10-12T11:50:00Z');
	});

	it('held/behind: waitingSince — the oldest newer release', () => {
		const rollout = mkRollout({
			status: {
				history: [{ version: { tag: 'old', version: '1.0.0' }, bakeStatus: 'Succeeded', timestamp: '2026-10-01T00:00:00Z' }],
				availableReleases: [
					{ tag: 'old', version: '1.0.0', created: '2026-10-01T00:00:00Z' },
					{ tag: 'new1', version: '2.0.0', created: '2026-10-11T10:00:00Z' },
					{ tag: 'new2', version: '3.0.0', created: '2026-10-12T10:00:00Z' }
				]
			}
		});
		const card = cardFor(rollout);
		expect(eventAge(card, 'held')).toBe('2026-10-11T10:00:00.000Z');
		expect(eventAge(card, 'behind')).toBe('2026-10-11T10:00:00.000Z');
	});

	it('held/behind: null when nothing newer is resolvable', () => {
		const rollout = mkRollout({
			status: {
				history: [{ version: { tag: 'old', version: '1.0.0' }, bakeStatus: 'Succeeded', timestamp: '2026-10-01T00:00:00Z' }]
			}
		});
		const card = cardFor(rollout);
		expect(eventAge(card, 'held')).toBeNull();
	});
});

describe('historyEntrySince', () => {
	it('bakeEndTime over timestamp', () => {
		expect(historyEntrySince({ timestamp: 'a', bakeEndTime: 'b' })).toBe('b');
	});
	it('falls back to timestamp', () => {
		expect(historyEntrySince({ timestamp: 'a' })).toBe('a');
	});
	it('null for nothing', () => {
		expect(historyEntrySince(null)).toBeNull();
		expect(historyEntrySince(undefined)).toBeNull();
	});
});

describe('the incident failure — one instant across every surface (shared/age-lag-total)', () => {
	it('every kind-aware caller derives the same ms for checkout-worker', () => {
		const rollout = mkRollout({
			status: {
				history: [
					{
						version: { tag: 'bad', version: '1.0.0' },
						bakeStatus: 'Failed',
						timestamp: '2026-10-12T11:17:00Z',
						bakeEndTime: '2026-10-12T11:23:00Z'
					}
				]
			}
		});
		const card = cardFor(rollout);
		// FleetRow, BlockedRow/NeedsYouCard, PromotionMap and FailurePanel all
		// resolve "failed" through the same call — assert the SAME ms, not just
		// the same ISO string, so a timezone-sensitive formatter downstream
		// cannot reintroduce the disagreement this module exists to end.
		const expectedMs = new Date('2026-10-12T11:23:00Z').getTime();
		expect(new Date(eventAge(card, 'failed')!).getTime()).toBe(expectedMs);
		// historyEntrySince (ActivityRail's own, card-free path) agrees too.
		expect(new Date(historyEntrySince(rollout.status!.history![0])!).getTime()).toBe(expectedMs);
	});
});
