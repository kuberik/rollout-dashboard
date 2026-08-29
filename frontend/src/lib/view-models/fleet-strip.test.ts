import { describe, it, expect } from 'vitest';
import {
	buildFleetStrip,
	fleetCaption,
	groupTone,
	FLEET_MAX_GROUPS,
	type FleetEnv
} from './fleet-strip';

/**
 * The strip's five ways of being wrong:
 *   1. splitting one build into two runs, or merging two builds into one —
 *      proximity IS the encoding of consistency, so a wrong run is a wrong
 *      answer to the page's first criterion
 *   2. losing an environment. The strip's LENGTH is the fleet's size, so a
 *      dropped mark is a lie about how many places this app runs in
 *   3. claiming a distance it cannot evidence (`unknown`, `diverged`)
 *   4. drawing no head slot when nothing is on head — the reference height
 *      every short mark is read against
 *   5. a caption that says something the picture does not
 */

function env(p: Partial<FleetEnv> & { key: string }): FleetEnv {
	return {
		label: p.key.toUpperCase(),
		version: 'aaaaaaa',
		rank: 0,
		tone: 'settled',
		diverged: false,
		...p
	};
}

const marks = (vm: ReturnType<typeof buildFleetStrip>) =>
	vm.groups.flatMap((g) => g.marks.filter((m) => !m.placeholder));

describe('buildFleetStrip', () => {
	it('groups environments by the BUILD they run, not by their distance', () => {
		const vm = buildFleetStrip([
			env({ key: 'dev', version: 'head000', rank: 0 }),
			env({ key: 'test', version: 'head000', rank: 0 }),
			env({ key: 'staging', version: 'older11', rank: 1 })
		]);
		expect(vm.groups.length).toBe(2);
		expect(vm.groups[0].marks.map((m) => m.key)).toEqual(['dev', 'test']);
		expect(vm.groups[1].marks.map((m) => m.key)).toEqual(['staging']);
		expect(vm.spread).toBe(2);
		expect(vm.onHead).toBe(2);
		expect(vm.behind).toBe(1);
	});

	it('one build = ONE run, which is what "consistent" looks like', () => {
		const vm = buildFleetStrip([
			env({ key: 'a', version: 'old', rank: 3 }),
			env({ key: 'b', version: 'old', rank: 3 }),
			env({ key: 'c', version: 'old', rank: 3 })
		]);
		expect(vm.spread).toBe(1);
		// Converged is NOT the same as up to date: nothing here is on head, so
		// the strip still opens with the hollow head slot.
		expect(vm.onHead).toBe(0);
		expect(vm.behind).toBe(3);
		expect(vm.groups.length).toBe(2);
		expect(vm.groups[0].marks[0].placeholder).toBe(true);
		expect(vm.groups[1].marks.length).toBe(3);
	});

	it('draws the head slot as ONE hollow full-height mark when nothing is on head', () => {
		const vm = buildFleetStrip([env({ key: 'a', version: 'old', rank: 2 })]);
		const head = vm.groups[0];
		expect(head.onHead).toBe(true);
		expect(head.marks.length).toBe(1);
		expect(head.marks[0].placeholder).toBe(true);
		expect(head.marks[0].onHead).toBe(true);
	});

	it('draws NO placeholder when the head build is actually occupied', () => {
		const vm = buildFleetStrip([
			env({ key: 'a', version: 'head', rank: 0 }),
			env({ key: 'b', version: 'old', rank: 4 })
		]);
		expect(vm.groups.some((g) => g.marks.some((m) => m.placeholder))).toBe(false);
		expect(vm.groups[0].onHead).toBe(true);
	});

	it('orders the runs head-first, then newest to oldest', () => {
		const vm = buildFleetStrip([
			env({ key: 'old', version: 'v3', rank: 5 }),
			env({ key: 'mid', version: 'v2', rank: 2 }),
			env({ key: 'new', version: 'v1', rank: 0 })
		]);
		expect(vm.groups.map((g) => g.rank)).toEqual([0, 2, 5]);
	});

	it('never loses an environment — every one gets a mark, however unplaceable', () => {
		const envs = [
			env({ key: 'dev', version: 'head', rank: 0 }),
			env({ key: 'eu', version: 'fork', rank: 2, diverged: true }),
			env({ key: 'ap', version: 'ghost', rank: null }),
			env({ key: 'sa', version: null, tone: 'pending' })
		];
		const vm = buildFleetStrip(envs);
		expect(marks(vm).length).toBe(4);
		expect(vm.total).toBe(4);
		expect(vm.deployed).toBe(3);
		expect(vm.placed).toBe(1);
		// `pending` and `unknown` are counted APART. Never deployed and
		// deployed-but-unrankable are different facts and the caption says so.
		expect(vm.pending).toBe(1);
		expect(vm.unknown).toBe(1);
		expect(vm.diverged).toBe(1);
		expect(vm.unplaced).toBe(3);
	});

	it('puts the un-distanced runs after the ranked ones, never at a rank', () => {
		const vm = buildFleetStrip([
			env({ key: 'dev', version: 'head', rank: 0 }),
			env({ key: 'eu', version: 'fork', rank: 2, diverged: true }),
			env({ key: 'ap', version: 'ghost', rank: null }),
			env({ key: 'sa', version: null, tone: 'pending' })
		]);
		expect(vm.groups.map((g) => g.key)).toEqual([
			'build:head',
			'build:ghost',
			'~diverged:fork',
			'~pending'
		]);
		// A diverged build is not a distance and must not claim one.
		expect(vm.groups[2].rank).toBeNull();
		expect(vm.groups[1].rank).toBeNull();
	});

	it('counts a diverged build as its own build — the ruler did not, and it understated the worst fleets', () => {
		const vm = buildFleetStrip([
			env({ key: 'a', version: 'head', rank: 0 }),
			env({ key: 'b', version: 'fork', rank: 1, diverged: true })
		]);
		expect(vm.spread).toBe(2);
	});

	it('folds every never-deployed environment into ONE run — they cannot disagree', () => {
		const vm = buildFleetStrip([
			env({ key: 'a', version: null, tone: 'pending' }),
			env({ key: 'b', version: null, tone: 'pending' }),
			env({ key: 'c', version: '', tone: 'pending' })
		]);
		expect(vm.groups.length).toBe(2); // hollow head slot + the pending run
		expect(vm.groups[1].marks.length).toBe(3);
		expect(vm.spread).toBe(0);
		expect(vm.deployed).toBe(0);
	});

	it('marks carry their own environment, distance and state — a shape is not an accessible name', () => {
		const vm = buildFleetStrip([env({ key: 'prod', version: 'abc1234', rank: 3, tone: 'stuck' })]);
		const m = marks(vm)[0];
		expect(m.title).toContain('PROD');
		expect(m.title).toContain('3 builds behind head');
		expect(m.title).toContain('abc1234');
		expect(m.title).toContain('stuck');
	});

	it('a mark is ON HEAD only at rank 0, and never when diverged', () => {
		const vm = buildFleetStrip([
			env({ key: 'a', version: 'h', rank: 0 }),
			env({ key: 'b', version: 'f', rank: 0, diverged: true })
		]);
		const byKey = Object.fromEntries(marks(vm).map((m) => [m.key, m]));
		expect(byKey.a.onHead).toBe(true);
		expect(byKey.b.onHead).toBe(false);
	});

	it('folds only the OLDEST runs past the cap, and never a mark', () => {
		const envs: FleetEnv[] = Array.from({ length: 12 }, (_, i) =>
			env({ key: `e${i}`, version: `v${i}`, rank: i })
		);
		const vm = buildFleetStrip(envs);
		expect(vm.groups.length).toBe(FLEET_MAX_GROUPS);
		expect(marks(vm).length).toBe(12);
		const last = vm.groups[vm.groups.length - 1];
		expect(last.folded).toBe(true);
		expect(last.marks.map((m) => m.key)).toEqual(['e7', 'e8', 'e9', 'e10', 'e11']);
		// The true build count is never truncated, whatever the picture folds.
		expect(vm.spread).toBe(12);
	});

	it('tracks the worst resolved rank for the row sort', () => {
		const vm = buildFleetStrip([
			env({ key: 'a', version: 'h', rank: 0 }),
			env({ key: 'b', version: 'o', rank: 7 }),
			env({ key: 'c', version: 'x', rank: null })
		]);
		expect(vm.worstRank).toBe(7);
	});
});

describe('groupTone', () => {
	it('a run summarises to its WORST environment, and fail outranks stuck', () => {
		const vm = buildFleetStrip([
			env({ key: 'a', version: 'v', rank: 1, tone: 'settled' }),
			env({ key: 'b', version: 'v', rank: 1, tone: 'stuck' }),
			env({ key: 'c', version: 'v', rank: 1, tone: 'fail' })
		]);
		const run = vm.groups.find((g) => g.version === 'v')!;
		expect(groupTone(run)).toBe('fail');
	});
});

describe('fleetCaption', () => {
	it('states the ratio, and the build count only when the fleet is fragmented', () => {
		expect(
			fleetCaption(
				buildFleetStrip([
					env({ key: 'a', version: 'h', rank: 0 }),
					env({ key: 'b', version: 'o', rank: 4 })
				])
			)
		).toBe('1 of 2 on head · 2 builds');
	});

	it('stays a single clause on a converged fleet — mark the deviation, never the norm', () => {
		expect(
			fleetCaption(
				buildFleetStrip([
					env({ key: 'a', version: 'h', rank: 0 }),
					env({ key: 'b', version: 'h', rank: 0 })
				])
			)
		).toBe('2 of 2 on head');
	});

	it('names what the marks cannot say for themselves, so the count adds up', () => {
		const vm = buildFleetStrip([
			env({ key: 'a', version: 'h', rank: 0 }),
			env({ key: 'b', version: 'f', rank: 1, diverged: true }),
			env({ key: 'c', version: null, tone: 'pending' })
		]);
		expect(fleetCaption(vm)).toBe('1 of 2 on head · 2 builds · 1 pending · 1 diverged');
	});

	it('says nothing it cannot evidence when the app has never deployed', () => {
		expect(fleetCaption(buildFleetStrip([env({ key: 'a', version: null, tone: 'pending' })]))).toBe(
			'never deployed'
		);
	});

	it('an unrankable build is deployed — it is not "never deployed"', () => {
		expect(fleetCaption(buildFleetStrip([env({ key: 'a', version: 'ghost', rank: null })]))).toBe(
			'0 of 1 on head · 1 unknown'
		);
	});
});
