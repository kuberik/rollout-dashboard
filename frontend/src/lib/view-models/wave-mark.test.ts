import { describe, expect, it, test } from 'vitest';
import { familySites, slicePath, waveMark } from './wave-mark';

describe('waveMark', () => {
	it('one state is one slice, not mixed', () => {
		const m = waveMark([{ state: 'done' }, { state: 'done' }], 'Wave 1');
		expect(m.mixed).toBe(false);
		expect(m.slices).toHaveLength(1);
		expect(m.slices[0]).toMatchObject({ kind: 'done', count: 2, share: 1, from: 0, to: 1 });
		expect(m.label).toBe('Wave 1: 2 deployed');
	});
	it('1 deployed + 1 checking is half green, half amber', () => {
		const m = waveMark([{ state: 'checking' }, { state: 'done' }], 'Wave 1');
		expect(m.mixed).toBe(true);
		expect(m.slices.map((s) => [s.kind, s.share])).toEqual([['done', 0.5], ['checking', 0.5]]);
		expect(m.label).toBe('Wave 1: 1 deployed, 1 checking');
	});
	it('shares follow the count and the order is fixed, not the site order', () => {
		const a = waveMark([{ state: 'failed' }, { state: 'done' }, { state: 'done' }, { state: 'deploying' }]);
		const b = waveMark([{ state: 'done' }, { state: 'deploying' }, { state: 'done' }, { state: 'failed' }]);
		expect(a.slices).toEqual(b.slices);
		expect(a.slices.map((s) => [s.kind, s.share])).toEqual([['done', 0.5], ['deploying', 0.25], ['failed', 0.25]]);
		expect(a.slices.at(-1)!.to).toBeCloseTo(1);
	});
	it('approval folds into held', () => {
		const m = waveMark([{ state: 'approval' }, { state: 'held' }]);
		expect(m.slices).toHaveLength(1);
		expect(m.slices[0]).toMatchObject({ kind: 'held', count: 2 });
	});
	it('the label names not reached', () => {
		expect(waveMark([{ state: 'notreached' }], 'prod').label).toBe('prod: 1 not reached');
	});
	it('a full turn is a circle path, a slice is a wedge from the centre', () => {
		expect(slicePath(0, 1, 5)).toContain('a5 5');
		expect(slicePath(0, 0.5, 5)).toMatch(/^M8 8L8\.000 3\.000A5 5 0 0 1 8\.000 13\.000Z$/);
	});
});

describe('familySites (the command palette change row)', () => {
	const st = (o: Partial<Parameters<typeof familySites>[0]>) => ({ tone: 'live' as const, state: null, resolved: false, builtCount: 1, liveCount: 1, ...o });
	const kinds = (o: Partial<Parameters<typeof familySites>[0]>) => waveMark(familySites(st(o))).slices.map((s) => s.kind);
	test('fully live is a done dot; partly live is a pie of done and not reached', () => {
		expect(kinds({ builtCount: 6, liveCount: 6 })).toEqual(['done']);
		expect(kinds({ builtCount: 6, liveCount: 5 })).toEqual(['done', 'notreached']);
	});
	test('resolved, queued and none are the not-reached ring', () => {
		expect(kinds({ tone: 'active', resolved: true })).toEqual(['notreached']);
		expect(kinds({ tone: 'queued' })).toEqual(['notreached']);
		expect(kinds({ tone: 'none' })).toEqual(['notreached']);
	});
	test('stuck is held, failed is failed, active is deploying (checking while baking)', () => {
		expect(kinds({ tone: 'stuck' })).toEqual(['held']);
		expect(kinds({ tone: 'failed' })).toEqual(['failed']);
		expect(kinds({ tone: 'active', state: 'promoting' })).toEqual(['deploying']);
		expect(kinds({ tone: 'active', state: 'baking' })).toEqual(['checking']);
	});
});
