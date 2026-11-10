import { describe, expect, it } from 'vitest';
import { axisTicks, bucketize, gridlineValues, pillLeft, placeMarkerLabels, type DeployMarker } from './deploy-bars';

const H = 3_600_000;

describe('bucketize', () => {
	it('always returns a full, ordered set of buckets', () => {
		const b = bucketize([], 0, 24 * H, 24);
		expect(b).toHaveLength(24);
		expect(b[0].startMs).toBe(0);
		expect(b[23].endMs).toBe(24 * H);
		expect(b.every((x) => x.count === 0)).toBe(true);
	});
	it('counts into the right bucket and keeps the end edge in the last one', () => {
		const b = bucketize([0, H - 1, H, 24 * H, 25 * H, -1], 0, 24 * H, 24);
		expect(b[0].count).toBe(2);
		expect(b[1].count).toBe(1);
		expect(b[23].count).toBe(1);
		expect(b.reduce((n, x) => n + x.count, 0)).toBe(4);
	});
});

describe('gridlineValues', () => {
	it('gives round integer ticks ending at or above the max', () => {
		expect(gridlineValues(90)).toEqual([0, 25, 50, 75, 100]);
		expect(gridlineValues(61)).toEqual([0, 20, 40, 60, 80]);
		expect(gridlineValues(3)).toEqual([0, 1, 2, 3]);
	});
	it('never returns duplicates or a single line for an empty window', () => {
		expect(gridlineValues(0)).toEqual([0, 1]);
		expect(new Set(gridlineValues(1)).size).toBe(gridlineValues(1).length);
	});
});

describe('axisTicks', () => {
	it('speaks hours under two days and days above', () => {
		expect(axisTicks(0, 24 * H, 4).map((t) => t.label)).toEqual(['24h ago', '18h ago', '12h ago', '6h ago']);
		expect(axisTicks(0, 7 * 24 * H, 7)[0].label).toBe('7d ago');
	});
});

describe('placeMarkerLabels', () => {
	const m = (key: string, tsMs: number, tone: DeployMarker['tone'] = 'release'): DeployMarker => ({ key, tsMs, label: 'abcdef1', tone });
	const x = (ms: number) => ms;
	const w = () => 60;
	it('drops a label that would collide, keeping the failure', () => {
		const rows = placeMarkerLabels([m('a', 100), m('b', 120, 'failed')], x, w);
		expect(rows.has('b')).toBe(true);
		expect(rows.has('a')).toBe(false);
	});
	it('keeps labels that are far enough apart', () => {
		const rows = placeMarkerLabels([m('a', 100), m('b', 300)], x, w);
		expect([...rows.keys()].sort()).toEqual(['a', 'b']);
	});
	it('tests collisions on the clamped box the pill is drawn in', () => {
		// Both near the right edge: clamped, they overlap even though their lines are 70px apart.
		const rows = placeMarkerLabels([m('a', 930), m('b', 1000, 'failed')], x, w, { minX: 0, maxX: 1000 });
		expect(rows.has('b')).toBe(true);
		expect(rows.has('a')).toBe(false);
		expect(pillLeft(1000, 60, 0, 1000)).toBe(940);
	});
});

import { averageCount, markerText, scaleCeiling, snapToBucket } from './deploy-bars';

describe('round 3 helpers', () => {
	it('auto range ignores one outlier', () => {
		const counts = [3, 2, 4, 3, 2, 3, 60, 1, 2, 3];
		const s = scaleCeiling(counts);
		expect(s.clipped).toBe(true);
		expect(s.ceiling).toBeLessThan(10);
		expect(scaleCeiling([3, 4, 5, 6, 7, 8]).clipped).toBe(false);
	});
	it('puts a verb on failure and rollback markers', () => {
		expect(markerText({ key: 'a', tsMs: 0, label: 'hello-world', tone: 'failed', where: 'dev', when: '01:37' })).toBe('hello-world failed in dev · 01:37');
		expect(markerText({ key: 'b', tsMs: 0, label: 'api', tone: 'rolledBack' })).toBe('api rolled back');
		expect(markerText({ key: 'c', tsMs: 0, label: 'api', tone: 'failed', resolved: true })).toBe('api failed · resolved');
		expect(markerText({ key: 'c', tsMs: 0, label: 'api reached prod', tone: 'release' })).toBe('api reached prod');
	});
	it('snaps a marker to its bucket and averages over every bucket', () => {
		const b = bucketize([1 * H, 1.5 * H, 5 * H], 0, 6 * H, 6);
		expect(snapToBucket(1.2 * H, b)).toBe(1);
		expect(snapToBucket(6 * H, b)).toBe(5);
		expect(snapToBucket(7 * H, b)).toBeNull();
		expect(averageCount(b)).toBe(0.5);
	});
});

import { previousText } from './deploy-bars';
describe('previousText', () => {
	it('says the previous window in words', () => {
		expect(previousText(0, 'the week before')).toBe('none the week before');
		expect(previousText(12, 'the day before')).toBe('12 the day before');
	});
});

import { fitSpan } from './deploy-bars';
describe('fitSpan', () => {
	it('starts just before the data, keeping a minimum width', () => {
		const c = Array(30).fill(0);
		c[28] = 3;
		expect(fitSpan(c)).toBe(22);
		c[5] = 1;
		expect(fitSpan(c)).toBe(4);
		expect(fitSpan(Array(30).fill(0))).toBe(0);
	});
});

describe('averageCount observed window (QA #21)', () => {
	const mk = (i: number, count: number) => ({ startMs: i * 1000, endMs: (i + 1) * 1000, count });
	const b = [mk(0, 0), mk(1, 0), mk(2, 0), mk(3, 6), mk(4, 6)];
	it('whole grid by default', () => expect(averageCount(b)).toBe(12 / 5));
	it('only buckets from the first observation on', () => expect(averageCount(b, 3000)).toBe(6));
});
