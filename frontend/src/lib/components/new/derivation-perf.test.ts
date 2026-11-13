/**
 * Pins the cost of the Changes derivation (perf/changes-derivation). `classified` asks `rowsOf` once per (change x place) and `rowsOf` used to rebuild
 * the whole `rollouts()` table each time, ~1 s per /changes derivation on home-incident. Now every table is computed ONCE per derivation scope.
 * The work counter is the load-bearing pin (exact, host-independent); the timing bound is generous (measured ~20 ms, bound 100 ms) so it holds on a loaded host.
 */
import { describe, it, expect } from 'vitest';
import { classifyChanges, changesPage } from './changes-page';
import { plumbOf } from './changes-plumb';
import { rowsOf, rollouts, placesOf } from './data';
import { inScope, scoped, stats } from './derivation-scope';

const misses = (prefix: string) => [...stats.byKey].filter(([k]) => k.startsWith(prefix)).reduce((n, [, v]) => n + v, 0);
stats.track = true;
const reset = () => { stats.hits = 0; stats.misses = 0; stats.byKey.clear(); };

describe('derivation scope', () => {
	it('computes a key once inside a scope, every time outside one, and never keeps it past the scope', () => {
		let n = 0;
		const make = () => ++n;
		expect([scoped('k', make), scoped('k', make)]).toEqual([1, 2]);
		n = 0;
		expect(inScope(() => [scoped('k', make), scoped('k', make), inScope(() => scoped('k', make))])).toEqual([1, 1, 1]);
		expect(scoped('k', make)).toBe(2);
	});
	it('a scoped read equals an unscoped one', () => {
		const alone = rowsOf('incident', 'prod', 'production').map((r) => r.key);
		expect(inScope(() => rowsOf('incident', 'prod', 'production').map((r) => r.key))).toEqual(alone);
		expect(inScope(() => rollouts('incident').rows.length)).toBe(rollouts('incident').rows.length);
		expect(inScope(() => placesOf('incident', 'checkout-api'))).toEqual(placesOf('incident', 'checkout-api'));
	});
});

describe.each(['incident', 'calm'] as const)('%s: the Changes derivation does its work once, not once per change x place', (hs) => {
	it('builds the rollouts table once per page derivation', () => {
		classifyChanges(hs); /* warm */
		reset();
		classifyChanges(hs);
		expect(misses(`rollouts|${hs}`)).toBe(1);
		reset();
		changesPage(hs);
		expect(misses(`rollouts|${hs}`)).toBe(1);
		reset();
		plumbOf(hs);
		expect(misses(`rollouts|${hs}`)).toBe(1);
		expect(misses(`classify|${hs}`)).toBe(1); /* plumbOf + changesPage share ONE classification */
		expect(stats.hits).toBeGreaterThan(stats.misses);
	});
	it('re-runs well under 100 ms (was ~130-370 ms on the same host)', () => {
		const time = (f: () => unknown) => { const t = performance.now(); f(); return performance.now() - t; };
		for (const f of [() => changesPage(hs), () => plumbOf(hs)]) {
			f();
			const runs = Array.from({ length: 5 }, () => time(f)).sort((a, b) => a - b);
			expect(runs[2]).toBeLessThan(100);
		}
	});
});
