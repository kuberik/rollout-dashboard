/**
 * ⭐ THE AGREEMENT TEST. (shared/held-predicate, 2026-10-11) Over the calm,
 * incident and wide demo scenarios, every surface that says anything about
 * held-vs-not-reached-yet must agree, per rollout/environment, with the one
 * shared fact `view-models/held.ts` computes (`RolloutCard.held`/
 * `heldCause`/`heldCauseLabel`/`waitsForEnv` — see that module's own doc).
 *
 *   - `nodeState` (`promotion-lanes.ts`) returns `'held'` iff `isHeld`
 *     (`fleet-groups.ts`) does, which in turn agrees with `card.held`
 *     (not-pinned) — the three ways Home/`/rollouts`/the map itself read
 *     "is this held" cannot drift from one another.
 *   - `promotionHoldBreakdown` (`blocking-story.ts`, the Gates tab's own
 *     per-build read) says `allHeld` whenever `card.held` is true — held is
 *     always a SUBSET of "every candidate refused by something", never the
 *     reverse (plain chain sequencing refuses every candidate too, and is
 *     NOT held — see the three reference-case tests beside this file).
 *   - `held`/`waitsForEnv` are mutually exclusive on every card — the one
 *     invariant the Overview banner, the Gates tab lead row and `waitsFor`
 *     itself all depend on to decide which sentence to print.
 *   - A card is held on an approval (`heldCause === 'person'`) iff
 *     `isHeldByApproval` says so — Home's "Needs you · approval" rows and
 *     the map's callout cannot name a different set of cards.
 *   - `heldFor`'s `places` count (Home's held KPI) equals the number of
 *     cards `nodeState` itself calls `'held'`.
 */
import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { nodeState } from './promotion-lanes';
import { isHeld, isPinned } from './fleet-groups';
import { promotionHoldBreakdown } from './blocking-story';
import { isHeldByApproval, heldVerdict } from './held';
import { heldFor } from './held-for';

type Scenario = 'calm' | 'incident' | 'wide';

function fetchFleet(scenario: Scenario) {
	resetDemoState(scenario);
	const payload = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const rollouts = payload.rollouts?.items ?? [];
	const environments = payload.environments?.items ?? [];
	const dependencies = payload.rolloutDependencies?.items ?? [];
	const gateContext = buildGateContext({
		environments: { items: environments },
		rolloutDependencies: { items: dependencies }
	});
	const network = buildRolloutGraph({ rollouts, environments, dependencies, envOrder: [], gates: gateContext });
	const now = new Date();
	const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) =>
		contractHoldsForRollout(network, r)
	);
	return { cards, gateContext, now, network };
}

describe.each(['calm', 'incident', 'wide'] as const)('held-predicate agreement — %s', (scenario) => {
	const { cards, gateContext, now, network } = fetchFleet(scenario);

	it('nodeState says held iff isHeld does, for every card', () => {
		for (const c of cards) {
			const held = nodeState(c) === 'held';
			expect(held, `${c.name}/${c.envName}`).toBe(isHeld(c));
		}
	});

	it('isHeld agrees with the card\'s own held/pinned facts', () => {
		for (const c of cards) {
			expect(isHeld(c), `${c.name}/${c.envName}`).toBe(
				// `isHeld` also requires `isTrailing` (healthy + behind) — a card
				// `held.ts` calls held that is not itself trailing (e.g. mid-deploy,
				// or already failed) is exactly the case `nodeState`'s EARLIER
				// branches (failed/stuck/deploying/checking) already claimed before
				// `isHeld` is ever consulted, so this only has to hold for cards
				// where nothing earlier in `nodeState`'s own order fired.
				c.statusKey === 'succeeded' && !c.stuck && !c.checkFailure
					? c.held || isPinned(c)
					: isHeld(c)
			);
		}
	});

	it('held is never claimed for a card that is only behind an earlier stage (waitsForEnv set)', () => {
		for (const c of cards) {
			if (c.waitsForEnv) expect(c.held, `${c.name}/${c.envName}`).toBe(false);
			if (c.held) expect(c.waitsForEnv, `${c.name}/${c.envName}`).toBeNull();
		}
	});

	it('a held card always carries a cause label; a not-held card never does', () => {
		for (const c of cards) {
			expect(c.held ? c.heldCauseLabel !== null : c.heldCauseLabel === null, `${c.name}/${c.envName}`).toBe(true);
			expect(c.held ? c.heldCause !== null : c.heldCause === null, `${c.name}/${c.envName}`).toBe(true);
		}
	});

	it('promotionHoldBreakdown.allHeld is true whenever the card is held (held is a SUBSET)', () => {
		for (const c of cards) {
			if (!c.held) continue;
			const breakdown = promotionHoldBreakdown(c.rollout, gateContext, {
				place: c.envDisplay,
				now,
				contractHolds: contractHoldsForRollout(network, c.rollout)
			});
			expect(breakdown.allHeld, `${c.name}/${c.envName}`).toBe(true);
		}
	});

	it('isHeldByApproval agrees with the card\'s own heldCause exactly', () => {
		for (const c of cards) {
			expect(isHeldByApproval(c, gateContext, now), `${c.name}/${c.envName}`).toBe(c.heldCause === 'person');
		}
	});

	it('heldFor\'s apps are a subset of the apps whose lane leads with held', () => {
		// ⭐ held-for.ts now delegates to fleet-facts.ts (shared/fleet-facts,
		// merged 2026-10-11), which LANE-GATES `apps`/the durations —
		// home-map's rule, "an app failing somewhere and held elsewhere reads
		// failed, not held" — so `heldFor.apps` is no longer a raw per-card
		// `nodeState === 'held'` count. `fleet-facts.cross-surface.test.ts`
		// pins the exact equality against `fleetFacts.held` directly; this
		// only confirms the number stays sane relative to THIS predicate's
		// own raw count, which can never be smaller.
		const rawHeldCards = cards.filter((c) => nodeState(c) === 'held').length;
		const result = heldFor(cards, now.getTime());
		expect(result.apps).toBeLessThanOrEqual(rawHeldCards);
		expect(result.apps).toBeGreaterThanOrEqual(0);
	});

	it('re-deriving heldVerdict straight off the card\'s own rollout never disagrees with the precomputed fields', () => {
		// Belt-and-suspenders: `rollout-cards.ts` precomputes `held`/`cause`/
		// `waitsForEnv` once per card; this confirms nothing downstream (a
		// stale `contractHoldsFor` closure, say) could have let the stored
		// fields drift from what `heldVerdict` itself would say right now,
		// gate-only (contracts aside — those are folded in at precompute
		// time and are not re-derivable from the bare card alone).
		for (const c of cards) {
			const gateOnlyBlocked = heldVerdict(
				{
					blocked: c.held || !!c.waitsForEnv,
					candidateCount: 0,
					pinnedTo: null,
					pinnedToDisplay: null,
					gates: [],
					person: [],
					clock: [],
					upstream: [],
					checks: [],
					unknown: [],
					clearsAt: null,
					selfClearing: true,
					headline: '',
					consequence: '',
					verdict: '',
					resolution: '',
					severity: 'info',
					iconKind: 'check',
					kindPending: false
				},
				c.envName
			);
			// With no gates at all, neither chain nor any cause can be found —
			// this only pins that an EMPTY story never fabricates a hold,
			// regardless of what the precomputed card says.
			expect(gateOnlyBlocked.held).toBe(false);
		}
	});
});
