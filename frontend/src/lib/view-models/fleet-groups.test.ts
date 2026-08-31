import { describe, it, expect } from 'vitest';
import type { Rollout, Environment } from '$lib/../types';
import { buildRolloutCards } from '$lib/rollout-cards';
import {
	isNeedsYou,
	isInMotion,
	isTrailing,
	isSteady,
	isPending,
	isHealthy,
	fleetGroups
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
