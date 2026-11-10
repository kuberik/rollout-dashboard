import { describe, it, expect } from 'vitest';
import { fleetSignals, isLongWait, HOME_PULSE_WORTH_LOOK, type SignalKind } from './fleet-signals';
import { buildRolloutCards, type RolloutCard } from '$lib/rollout-cards';
import { buildLanes } from './promotion-lanes';
import { cardContext } from './card-context';
import { homeInput, FIXTURE_NOW } from './home/fixture';
import type { Rollout } from '../../types';

/**
 * Ported from the home lab's `fleet-signals.test.ts`. The lab ran these on
 * its demo (`calm` / `incident`, a live mock with health checks); main has no
 * demo, so the incident cases run on the pinned incident fixture, built the
 * way `buildHomeModel` builds its signals (no health-check feed). The calm
 * cases and the clock-rot case needed the live mock and are not ported.
 */
function run(at = FIXTURE_NOW, edit?: (rollouts: Rollout[]) => void) {
	const input = homeInput(at);
	if (edit) {
		input.rollouts = structuredClone(input.rollouts);
		edit(input.rollouts);
	}
	const ctx = cardContext({
		rollouts: input.rollouts,
		environments: { items: input.environments },
		rolloutDependencies: input.rolloutDependencies,
		schedulesExpected: false
	});
	const cards = buildRolloutCards(input.rollouts, input.environments, at, ctx.gateContext, ctx.contractHoldsFor);
	return fleetSignals({
		cards,
		lanes: buildLanes(cards),
		healthChecks: null,
		prFor: () => null,
		isApproval: (c: RolloutCard) => c.heldCause === 'person',
		now: at,
		href: (c) => `/r/${c.ns}/${c.name}`,
		appHref: (a) => `/apps/${a}`
	});
}

describe('fleet signals — incident', () => {
	it('failures come first; every signal has evidence of at most 6 words and a since in the past', () => {
		const s = run();
		expect(s.length).toBeGreaterThan(0);
		const firstSignal = s.findIndex((x) => x.severity === 'signal');
		if (firstSignal >= 0) expect(s.slice(firstSignal).every((x) => x.severity === 'signal')).toBe(true);
		for (const x of s) {
			expect(x.evidence.split(/\s+/).length, x.evidence).toBeLessThanOrEqual(6);
			expect(Date.parse(x.since)).toBeLessThanOrEqual(FIXTURE_NOW.getTime() + 1000);
			expect(x.evidence, 'no negative ages').not.toMatch(/(^|\s)-\d/);
		}
	});
	it('the named stories are where the mock told them', () => {
		const s = run();
		const find = (k: SignalKind, app: string) => s.find((x) => x.kind === k && x.app === app);
		// edge-mesh dev is 41m into a 60m bake: on schedule, whatever its earlier bakes took
		expect(find('slow-bake', 'edge-mesh')).toBeUndefined();
		expect(find('rollback', 'checkout-api')?.env).toBe('prod-af-south-1');
	});
	it('the incident has its failures, loud', () => {
		const f = run().filter((x) => x.severity === 'failure');
		expect(f.map((x) => x.app)).toContain('checkout-worker');
	});
});

describe('slow bake — measured against spec.bakeTime, as the controller ends a bake', () => {
	const edgeDev = (rs: Rollout[]) => rs.find((r) => r.metadata?.name === 'edge-mesh' && r.metadata?.namespace === 'edge-mesh-dev')!;
	const startAgo = (min: number) => (rs: Rollout[]) => {
		const h = edgeDev(rs).status!.history![0];
		h.bakeStartTime = new Date(FIXTURE_NOW.getTime() - min * 60e3).toISOString();
		h.timestamp = h.bakeStartTime;
	};
	const slow = (s: ReturnType<typeof run>) => s.find((x) => x.kind === 'slow-bake' && x.app === 'edge-mesh');
	it('a bake past bakeTime by more than the margin is slow, worded from its own bake time', () => {
		const sig = slow(run(FIXTURE_NOW, startAgo(75)));
		expect(sig?.facts).toEqual({ kind: 'slow-bake', spanMs: 75 * 60e3, bakeTimeMs: 60 * 60e3 });
		expect(sig?.evidence).toBe('bake 75m, set to 60m');
	});
	it('a bake within bakeTime plus the margin is on schedule', () => {
		expect(slow(run(FIXTURE_NOW, startAgo(41)))).toBeUndefined();
		expect(slow(run(FIXTURE_NOW, startAgo(60 + 4)))).toBeUndefined();
	});
	it('with no bakeTime the controller ends the bake at once, so a bake is never slow', () => {
		const s = run(FIXTURE_NOW, (rs) => {
			startAgo(300)(rs);
			delete edgeDev(rs).spec!.bakeTime;
		});
		expect(slow(s)).toBeUndefined();
	});
});

describe('long wait — never inside ordinary polling jitter', () => {
	it('a place that usually deploys at once (usual 0s) is not long-waiting at 2m', () => {
		expect(isLongWait(2 * 60e3, 0)).toBe(false);
		expect(isLongWait(2 * 60e3 + 59e3, 0)).toBe(false);
	});
	it('past the 3m floor and past 1.5x the usual, it is', () => {
		expect(isLongWait(3 * 60e3, 0)).toBe(true);
		expect(isLongWait(4 * 60e3, 2 * 60e3)).toBe(true);
	});
	it('a usual above the floor raises the bar to 1.5x the usual', () => {
		expect(isLongWait(4 * 60e3, 3 * 60e3)).toBe(false);
		expect(isLongWait(4.5 * 60e3, 3 * 60e3)).toBe(true);
	});
});

describe('HOME_PULSE_WORTH_LOOK — the Home header fleet pulse excludes idle/stall', () => {
	it('does not include "stall"', () => {
		expect(HOME_PULSE_WORTH_LOOK.has('stall')).toBe(false);
	});
	it('still includes the genuinely actionable early-signal kinds', () => {
		for (const k of ['check-failing', 'check-flapping', 'check-recovered', 'slow-bake', 'long-wait'] as SignalKind[])
			expect(HOME_PULSE_WORTH_LOOK.has(k), k).toBe(true);
	});
	it('hello-world genuinely reports a "stall" signal in the incident scenario (so the exclusion is doing real work, not vacuous)', () => {
		for (const scenario of ['incident'] as const) {
			const s = run().filter((x) => x.app === 'hello-world');
			const stall = s.find((x) => x.kind === 'stall');
			expect(stall, scenario).toBeTruthy();
			expect(stall!.evidence).toContain('idle');
			// The signal exists in `fleetSignals()`'s own output (other
			// consumers — e.g. "needs a person" — still see it); it is only
			// excluded from what the Home header's pulse treats as "worth a
			// look".
			expect(HOME_PULSE_WORTH_LOOK.has(stall!.kind)).toBe(false);
		}
	});
});

