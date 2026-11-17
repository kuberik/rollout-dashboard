import { describe, it, expect } from 'vitest';
import { inFlightRollouts, inFlightFacts, deployRateSub } from './activity-figures';
import { medianTimeToProdMs } from './activity-time-to-prod';

const H = 3_600_000;
describe('deployRateSub (QA #21)', () => {
	const now = Date.parse('2026-11-09T15:00:00Z');
	it('young cluster: no per-hour rate over a 24h window when less than an hour observed', () => {
		expect(deployRateSub(32, 24 * H, now - 25 * 60_000, now)).toBeUndefined();
	});
	it('uses the observed span, not the nominal window', () => {
		expect(deployRateSub(30, 24 * H, now - 3 * H, now)).toBe('10 an hour');
	});
	it('full window keeps the nominal span', () => {
		expect(deployRateSub(48, 24 * H, now - 40 * H, now)).toBe('2 an hour');
		expect(deployRateSub(70, 7 * 24 * H, now - 30 * 24 * H, now)).toBe('10 a day');
	});
});
describe('inFlightRollouts', () => {
	it('counts rollouts once, not history rows', () => {
		const r = inFlightRollouts([
			{ rolloutKey: 'a', bakeStatus: 'InProgress' },
			{ rolloutKey: 'a', bakeStatus: 'Deploying' },
			{ rolloutKey: 'b', bakeStatus: 'InProgress' },
			{ rolloutKey: 'c', bakeStatus: 'Succeeded' }
		]);
		expect(r).toEqual({ total: 2, checking: 1, paused: 0, deploying: 1 });
	});
	it('words a paused bake as paused, not checking, and still counts it in flight', () => {
		const r = inFlightRollouts([
			{ rolloutKey: 'a', bakeStatus: 'InProgress', bakePaused: true },
			{ rolloutKey: 'b', bakeStatus: 'InProgress' }
		]);
		expect(r).toEqual({ total: 2, checking: 1, paused: 1, deploying: 0 });
	});
});
describe('median to prod excludes rollbacks (QA #21)', () => {
	it('a rollback to an old release is not a transit time', () => {
		const t0 = 1_000_000;
		const base = [
			{ releaseKey: 'x', timestampMs: t0, isProd: false },
			{ releaseKey: 'x', timestampMs: t0 + 2 * 60_000, isProd: true }
		];
		const rb = [
			{ releaseKey: 'old', timestampMs: t0 - 20 * H, isProd: false },
			{ releaseKey: 'old', timestampMs: t0 + 5 * 60_000, isProd: true, isRollback: true }
		];
		expect(medianTimeToProdMs([...base, ...rb])).toBe(2 * 60_000);
	});
});

import { isInFlightEntry } from './activity-figures';
describe('isInFlightEntry (QA #21 review): one predicate for tile, pill, rollup and filter', () => {
	it('only the live entry of a rollout can be in flight', () => {
		expect(isInFlightEntry({ bakeStatus: 'Deploying', isLive: true })).toBe(true);
		expect(isInFlightEntry({ bakeStatus: 'InProgress', isLive: true })).toBe(true);
		expect(isInFlightEntry({ bakeStatus: 'InProgress', isLive: false })).toBe(false);
		expect(isInFlightEntry({ bakeStatus: 'Succeeded', isLive: true })).toBe(false);
	});
});

describe('inFlightFacts', () => {
	it('is one fact per count-and-noun, joined by a no-break space, absent states omitted', () => {
		expect(inFlightFacts({ checking: 3, paused: 1, deploying: 1 })).toEqual(['3 checking', '1 paused', '1 deploying']);
		expect(inFlightFacts({ checking: 0, paused: 0, deploying: 2 })).toEqual(['2 deploying']);
		expect(inFlightFacts({ checking: 0, paused: 0, deploying: 0 })).toEqual([]);
	});
});
