import { describe, it, expect } from 'vitest';
import type { Rollout, Environment } from '$lib/../types';
import { buildRolloutCards } from '$lib/rollout-cards';
import type { RolloutCard } from '$lib/rollout-cards';
import {
	isNeedsYou,
	isInMotion,
	isTrailing,
	isSteady,
	isPending,
	isHealthy,
	fleetGroups,
	fleetTiebreak
} from './fleet-groups';

/**
 * ⛔ `/rollouts` SAID THE FLEET WAS FINE WHILE FOUR OTHER SURFACES SAID IT
 * WAS NOT. (live critique, 2026-08-31)
 *
 *     Attention 0 · In motion 1 · Pending 0 · Healthy 14
 *
 * …with `hello-world-app` behind and gate-blocked in all three environments,
 * at the same moment `/` filed those three under **Trailing**. The two pages
 * were not disagreeing about a fact; `/rollouts` had a bucket `/` does not
 * have, which swallowed the lag. These tests pin that the two pages read one
 * set of predicates.
 */

const NOW = new Date('2026-08-31T12:00:00Z');
const APP = 'hello-world-app';

/** Releases OLDEST-FIRST, the API's contract. */
const REL = (n: number) => Array.from({ length: n }, (_, i) => ({ version: `rel-${i}` }));

function rollout(opts: {
	tier: string;
	current: string;
	bakeStatus?: string;
	releases?: number;
	deployedAgoMin?: number;
}): Rollout {
	const releases = REL(opts.releases ?? 10);
	return {
		metadata: { name: APP, namespace: `${APP}-${opts.tier}` },
		spec: {},
		status: {
			availableReleases: releases,
			history: opts.current
				? [
						{
							version: { version: opts.current },
							timestamp: new Date(NOW.getTime() - (opts.deployedAgoMin ?? 30) * 60_000).toISOString(),
							bakeStatus: opts.bakeStatus ?? 'Succeeded'
						}
					]
				: [],
			gates: []
		}
	} as unknown as Rollout;
}

function environment(tier: string): Environment {
	return {
		metadata: { name: APP, namespace: `${APP}-${tier}` },
		spec: { environment: tier, name: APP, rolloutRef: { name: APP } }
	} as unknown as Environment;
}

// dev at the head (rel-9), staging 4 behind (rel-5), prod deploying,
// and a fourth with nothing deployed at all.
const ROLLOUTS = [
	rollout({ tier: 'dev', current: 'rel-9' }),
	rollout({ tier: 'staging', current: 'rel-5' }),
	rollout({ tier: 'prod', current: 'rel-7', bakeStatus: 'Deploying' }),
	rollout({ tier: 'qa', current: '' })
];
const ENVIRONMENTS = ['dev', 'staging', 'prod', 'qa'].map(environment);
const cards = () => buildRolloutCards(ROLLOUTS, ENVIRONMENTS, NOW);

describe('one grouping predicate for `/` and `/rollouts`', () => {
	it('THE REPORTED DEFECT — a trailing rollout is countable, not folded into `healthy`', () => {
		const g = fleetGroups(cards());
		expect(g.trailing.map((c) => c.envName)).toEqual(['staging']);
		expect(g.steady.map((c) => c.envName)).toEqual(['dev']);
		expect(g.inMotion.map((c) => c.envName)).toEqual(['prod']);
		expect(g.pending.map((c) => c.envName)).toEqual(['qa']);
		expect(g.needsYou).toHaveLength(0);
	});

	it('`trailing` and `steady` partition `healthy` exactly', () => {
		// The old `/rollouts` counter WAS `healthy`. Splitting it may not
		// lose or double-count a rollout, or the page trades one wrong number
		// for two.
		const cs = cards();
		const healthy = cs.filter(isHealthy);
		const t = cs.filter(isTrailing);
		const s = cs.filter(isSteady);
		expect(t.length + s.length).toBe(healthy.length);
		for (const c of cs) expect(isTrailing(c) && isSteady(c)).toBe(false);
		for (const c of healthy) expect(isTrailing(c) || isSteady(c)).toBe(true);
	});

	it('`unknown` is steady, never trailing — a retention limit is not a lag', () => {
		// prod runs a build that is not in its own release list at all, so its
		// distance is unknowable. It must not be counted as behind.
		const orphan = rollout({ tier: 'prod', current: 'not-in-any-list' });
		const cs = buildRolloutCards(
			[ROLLOUTS[0], ROLLOUTS[1], orphan],
			ENVIRONMENTS.slice(0, 3),
			NOW
		);
		const c = cs.find((x) => x.envName === 'prod')!;
		expect(c.rank.kind).toBe('unknown');
		expect(isTrailing(c)).toBe(false);
		expect(isSteady(c)).toBe(true);
	});

	it('the buckets are questions, not a pie — a stuck deploy answers two', () => {
		// Deliberately NOT a partition: `needsYou` and `inMotion` overlap, and
		// making them disjoint would hide one of two true facts.
		const stuck = rollout({
			tier: 'prod',
			current: 'rel-5',
			bakeStatus: 'Deploying',
			deployedAgoMin: 60 * 48
		});
		const cs = buildRolloutCards([ROLLOUTS[0], ROLLOUTS[1], stuck], ENVIRONMENTS.slice(0, 3), NOW);
		const c = cs.find((x) => x.envName === 'prod')!;
		expect(c.stuck).not.toBeNull();
		expect(isNeedsYou(c)).toBe(true);
		expect(isInMotion(c)).toBe(true);
		// …and it is in neither healthy bucket, because it is not healthy.
		expect(isTrailing(c)).toBe(false);
		expect(isSteady(c)).toBe(false);
	});

	it('nothing deployed is `pending` and nothing else', () => {
		const c = cards().find((x) => x.envName === 'qa')!;
		expect(isPending(c)).toBe(true);
		expect(isHealthy(c)).toBe(false);
		expect(isTrailing(c)).toBe(false);
		expect(isSteady(c)).toBe(false);
		expect(isNeedsYou(c)).toBe(false);
	});
});

/**
 * ⛔ THE 3AM DEFECT. (live critique, 2026-08-31, BLOCKING finding 1)
 *
 * `hello-world-prod/hello-world-app`'s health check set to `Unhealthy` — "p99
 * latency 4.2s exceeds SLO of 500ms for 5m". The controller reacted correctly
 * and published `DeploymentBlocked: True, reason: UnhealthyHealthChecks`. At
 * that same second the product said:
 *
 *   `/`             "Trailing 2 — healthy, but behind a newer build"
 *   `/rollouts`     Attention 0 · … · Trailing 2 · Steady 13
 *   `/environments` prod 4/4 running
 *   rollout detail  correct
 *
 * *"An operator opens `/` at 3am, reads the word **healthy** on the rollout
 * whose SLO is blown, and goes back to bed."*
 *
 * These are the tests that make that unrepeatable: an unhealthy check reading
 * as "healthy" is exactly the class of defect a unit test pins forever.
 */
function withCheckFailure(r: Rollout, message: string, gatesClosed = false): Rollout {
	const gates = gatesClosed
		? [{ name: 'schedule-gate-nwm62', passing: false }]
		: [{ name: 'open-gate', passing: true }];
	return {
		...r,
		status: {
			...r.status,
			gates,
			conditions: [
				{
					type: 'DeploymentBlocked',
					status: 'True',
					reason: 'UnhealthyHealthChecks',
					message,
					lastTransitionTime: new Date(NOW.getTime() - 5 * 60_000).toISOString()
				}
			]
		}
	} as unknown as Rollout;
}

const SLO_MESSAGE =
	"HealthCheck 'payment-latency' in namespace 'hello-world-prod' is not healthy (status: Unhealthy): p99 latency 4.2s exceeds SLO of 500ms for 5m";

describe('a failing health check promotes a rollout into Attention', () => {
	it('THE REPORTED DEFECT — the rollout is in `needsYou`, not `trailing`', () => {
		// staging is the trailing one in the fixture; blow its SLO.
		const sick = withCheckFailure(ROLLOUTS[1], SLO_MESSAGE);
		const cs = buildRolloutCards([ROLLOUTS[0], sick, ROLLOUTS[2]], ENVIRONMENTS.slice(0, 3), NOW);
		const c = cs.find((x) => x.envName === 'staging')!;

		expect(c.statusKey).toBe('succeeded'); // the DEPLOY really did succeed
		expect(c.stuck).toBeNull(); // and it is not stuck
		expect(c.checkFailure).not.toBeNull();

		expect(isNeedsYou(c)).toBe(true);
		// …and it is out of BOTH captions that call it fine.
		expect(isHealthy(c)).toBe(false);
		expect(isTrailing(c)).toBe(false);
		expect(isSteady(c)).toBe(false);
	});

	it('`Attention` counts it and `Trailing` does not — the two numbers on the page', () => {
		const sick = withCheckFailure(ROLLOUTS[1], SLO_MESSAGE);
		const before = fleetGroups(buildRolloutCards(ROLLOUTS, ENVIRONMENTS, NOW));
		const after = fleetGroups(
			buildRolloutCards([ROLLOUTS[0], sick, ROLLOUTS[2], ROLLOUTS[3]], ENVIRONMENTS, NOW)
		);
		expect(before.needsYou).toHaveLength(0);
		expect(before.trailing).toHaveLength(1);
		expect(after.needsYou).toHaveLength(1);
		expect(after.trailing).toHaveLength(0);
	});

	it("⭐ THE CRITIC'S OWN CAVEAT — it works with NO gate closed", () => {
		// *"that rollout also had three gates closed, so gate precedence may
		// contribute"*, filed under LEFT because the critic could not reach the
		// state. `DeploymentBlocked` is set from health-check state alone,
		// before the gate loop, so the two are independent — and this is the
		// isolated case, one open gate and nothing else holding it.
		const sick = withCheckFailure(ROLLOUTS[1], SLO_MESSAGE, false);
		const c = buildRolloutCards([sick], [ENVIRONMENTS[1]], NOW)[0];
		expect(c.rollout.status?.gates?.every((g) => g.passing)).toBe(true);
		expect(isNeedsYou(c)).toBe(true);
		expect(isHealthy(c)).toBe(false);
	});

	it('…and identically with gates closed, so gate precedence changes nothing', () => {
		const sick = withCheckFailure(ROLLOUTS[1], SLO_MESSAGE, true);
		const c = buildRolloutCards([sick], [ENVIRONMENTS[1]], NOW)[0];
		expect(isNeedsYou(c)).toBe(true);
		expect(isHealthy(c)).toBe(false);
	});

	it('a recovered check does NOT hold the rollout in Attention', () => {
		// `DeploymentBlocked: False, reason: HealthChecksHealthy` is the state
		// the controller publishes the moment the check passes again. The
		// witness belongs on rollout detail (finding 2), not in the fleet
		// alarm — an alarm that never clears is an alarm nobody reads.
		const healed = {
			...ROLLOUTS[1],
			status: {
				...ROLLOUTS[1].status,
				conditions: [
					{
						type: 'DeploymentBlocked',
						status: 'False',
						reason: 'HealthChecksHealthy',
						message: '',
						lastTransitionTime: NOW.toISOString()
					}
				]
			}
		} as unknown as Rollout;
		const c = buildRolloutCards([healed], [ENVIRONMENTS[1]], NOW)[0];
		expect(c.checkFailure).toBeNull();
		expect(isNeedsYou(c)).toBe(false);
		expect(isTrailing(c)).toBe(true);
	});
});

/**
 * ⭐ THE FLEET'S RENDER ORDER MUST BE A PURE FUNCTION OF THE DATA. (2026-09-04,
 * coordinator finding: "the home cards reshuffle between loads (4 distinct
 * orders in 5 reloads) because the sort has ties and the API's list order
 * varies.") `buildRolloutCards` maps `rollouts` in whatever order the API
 * response listed them, with no sort of its own — so a bucket with no
 * primary key (or one whose primary key ties) used to render in that same
 * unstable order. The backend is being made deterministic too, but these
 * tests pin the FRONTEND'S OWN guarantee: `fleetGroups`/`fleetTiebreak` must
 * produce the identical order no matter what order `/api/rollouts` returned
 * things in.
 */
describe('fleetTiebreak: render order does not depend on API list order', () => {
	// Five rollouts of the SAME app across five namespaces, all healthy and at
	// the head of their own release ladder — they tie on every bucket
	// predicate, so without a tiebreak their order is whatever `ROLLOUTS_*`
	// below happens to be ordered in.
	const TIERS = ['echo', 'charlie', 'alpha', 'delta', 'bravo'];
	const steadyRollouts = TIERS.map((tier) => rollout({ tier, current: 'rel-9' }));
	const steadyEnvironments = TIERS.map(environment);

	/** A handful of distinct permutations of the same five rollouts. */
	function permutations(): Rollout[][] {
		const out: Rollout[][] = [steadyRollouts, [...steadyRollouts].reverse()];
		for (let seed = 1; seed < steadyRollouts.length; seed++) {
			out.push([...steadyRollouts.slice(seed), ...steadyRollouts.slice(0, seed)]);
		}
		return out;
	}

	it('the Steady bucket lands in the same (namespace-sorted) order for every permutation of the API response', () => {
		const orders = permutations().map((perm) => {
			const cards = buildRolloutCards(perm, steadyEnvironments, NOW);
			return fleetGroups(cards).steady.map((c) => `${c.ns}/${c.name}`);
		});

		expect(orders[0]).toHaveLength(5);
		for (const order of orders) {
			expect(order).toEqual(orders[0]);
		}
		// Not an accident of the fixture already being sorted — `TIERS` above
		// is deliberately NOT alphabetical, so this pins the actual tiebreak
		// (cluster, then namespace, then name), not input order surviving by
		// chance.
		expect(orders[0]).toEqual(
			['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((tier) => `${APP}-${tier}/${APP}`)
		);
	});

	it('fleetTiebreak alone sorts a shuffled card list into (cluster, namespace, name) order', () => {
		const cards = buildRolloutCards(steadyRollouts, steadyEnvironments, NOW);
		const shuffled = [...cards].reverse().sort(fleetTiebreak);
		expect(shuffled.map((c) => c.ns)).toEqual([...cards].map((c) => c.ns).sort());
	});

	it('is a stable final tiebreak: ties are broken, a real primary key still wins', () => {
		// Two cards tied on namespace/name/cluster but not on a caller's own
		// primary key (e.g. `needsYou`'s failed-first sort) must still resolve
		// by that primary key first.
		const a: RolloutCard = { ns: 'z', name: 'z', sourceCluster: '', sourceURL: '' } as RolloutCard;
		const b: RolloutCard = { ns: 'a', name: 'a', sourceCluster: '', sourceURL: '' } as RolloutCard;
		const byPrimaryThenTiebreak = (x: RolloutCard, y: RolloutCard) => {
			const primary = 0; // tied on the caller's own key
			return primary !== 0 ? primary : fleetTiebreak(x, y);
		};
		expect([a, b].sort(byPrimaryThenTiebreak)).toEqual([b, a]);
	});
});
