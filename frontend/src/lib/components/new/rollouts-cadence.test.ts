import { describe, it, expect } from 'vitest';
import { deployCadence } from './rollouts-cadence';
import type { Rollout } from '../../../types';

const NOW = new Date('2026-11-21T12:00:00Z').getTime();
const day = 86_400_000;
const r = (name: string, ns: string, ago: number[]): Rollout => ({ metadata: { name, namespace: ns }, status: { history: ago.map((d) => ({ timestamp: new Date(NOW - d * day).toISOString() })) } } as unknown as Rollout);

describe('deployCadence', () => {
	it('groups places of one app, counts per calendar day (today last), busiest app first, name breaks ties', () => {
		const out = deployCadence([r('b-app', 'x-dev', [0, 0, 1]), r('b-app', 'x-prod', [3]), r('a-app', 'y', [0, 2, 20]), r('c-app', 'z', [])], NOW, 14);
		expect(out.map((a) => [a.app, a.total])).toEqual([['b-app', 4], ['a-app', 2]]);
		expect(out[0].counts.length).toBe(14);
		expect(out[0].counts[13]).toBe(2);
		expect(out[0].counts[12]).toBe(1);
		expect(out[0].counts[10]).toBe(1);
	});
	it('ties order by name; an app with no deploy in the window is not listed', () => {
		expect(deployCadence([r('zz', 'a', [1]), r('aa', 'b', [1]), r('old', 'c', [30])], NOW).map((a) => a.app)).toEqual(['aa', 'zz']);
	});
});
