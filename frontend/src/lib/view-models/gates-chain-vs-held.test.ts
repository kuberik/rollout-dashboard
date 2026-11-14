/**
 * ⭐ THE GATES TAB NEVER OVERSTATES A CHAIN PREDECESSOR AS A HOLD — ON REAL
 * MOCK DATA. (squad-rollout gates-2 follow-up, 2026-10-11, qa11 finding.)
 *
 * qa11 found three live overstatements on `checkout-api/prod-us-east-2`,
 * all the SAME root cause (a chain predecessor counted as a hold):
 *
 *   1. THE GATE COUNT — the header read "2 of 2 gates holding" by counting
 *      the staging chain predecessor alongside the real `payments-svc`
 *      contract hold. Only a gate that actually refuses HERE may count.
 *   2. THE STAGING NEIGHBOUR TILE — it showed "Holding …" with a held
 *      (pause-glyph) mark. Under the ruling it must read "Waits for …"
 *      in neutral ink, UNLESS staging is itself refused by something (it
 *      is — `payments-svc`) in which case the one-hop clause says so.
 *   3. THIS ROLLOUT'S OWN LINE — the "Held builds" card/header read
 *      "N builds wait here" counting the two chain-refused candidates;
 *      it must read `waitsFor`'s own sentence instead when nothing is
 *      genuinely held here.
 *
 * This file pins all three against the REAL `checkout-api` fixture
 * (`$lib/demo/mock-data.ts`) — no invented data — using the exact
 * functions each page reads: `rolloutNeighbourhood`,
 * `reconcileNeighbourhoodHolds`, `promotionHoldBreakdown` and
 * `heldVerdictForBuild`/`waitsFor` (`held.ts`).
 */
import { describe, it, expect } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { withUsEast2Cleared, WAVE_STAGE } from './wave-reference.testkit';
import { buildGateContext, promotionHoldBreakdown } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { rolloutNeighbourhood, reconcileNeighbourhoodHolds } from '$lib/view-models/rollout-neighbourhood';
import { heldVerdictForBuild, composeHeldLeadSentence } from '$lib/view-models/held';
import { buildRolloutCards, type RolloutCard } from '$lib/rollout-cards';
import type { Rollout } from '../../types';

function fetchCheckoutApiProdUsEast2() {
	resetDemoState('calm');
	const payload = withUsEast2Cleared(JSON.parse(respond('GET', '/api/rollouts').body ?? '{}'));
	const rollouts: Rollout[] = payload.rollouts?.items ?? [];
	const environments = payload.environments?.items ?? [];
	const dependencies = payload.rolloutDependencies?.items ?? [];
	const gateContext = buildGateContext({
		environments: { items: environments },
		rolloutDependencies: { items: dependencies }
	});
	const network = buildRolloutGraph({ rollouts, environments, dependencies, envOrder: [], gates: gateContext });
	const rollout = rollouts.find(
		(r) => r.metadata?.name === 'checkout-api' && r.metadata?.namespace === 'checkout-api-prod-us-east-2'
	)!;
	// `buildRolloutGraph` stamps the rollout's own CLUSTER label onto the
	// node id (`fixtureClusterOf`) — `prod` for every checkout-api prod
	// region in this fixture, never the hub-local `(hub)` sentinel.
	const hood = rolloutNeighbourhood({
		graph: network,
		at: { cluster: 'prod', namespace: 'checkout-api-prod-us-east-2', name: 'checkout-api' }
	});
	const contractHolds = contractHoldsForRollout(network, rollout);
	const breakdown = promotionHoldBreakdown(rollout, gateContext, { place: 'prod-us-east-2', contractHolds });
	const reconciled = reconcileNeighbourhoodHolds(hood.upstream, breakdown);
	return { rollouts, environments, gateContext, network, rollout, hood, breakdown, reconciled };
}

describe('checkout-api/prod-us-east-2 Gates tab: the chain predecessor is never counted as a hold', () => {
	const { hood, reconciled } = fetchCheckoutApiProdUsEast2();

	it('item 1 — THE GATE COUNT: only payments-svc counts, the staging chain predecessor never does', () => {
		const waveLinks = hood.upstream.filter((l) => l.writer === 'promotion');
		const paymentsLink = hood.upstream.find((l) => l.writer === 'contract')!;
		// Wave 2 follows EVERY live site of wave 1: one edge per site, none of them a hold.
		expect(waveLinks.map((l) => l.node.env).sort()).toEqual(['prod-eu-central', 'prod-us-east-1']);
		for (const l of waveLinks) expect(l.chainPredecessor).toBe(true);
		expect(paymentsLink.chainPredecessor).toBe(false);
		// The reconciled count — what the header's "N of M holding" rollup
		// prints — is 1 (payments-svc), never 2.
		expect(reconciled.holding).toBe(1);
		// `rolloutNeighbourhood`'s own raw `holding` agrees, independent of
		// reconciliation — the chain exclusion is applied at that layer too.
		expect(hood.holding).toBe(1);
	});

	it('item 2 — THE STAGING NEIGHBOUR TILE: never reconciled to `blocked`, and the LINK\'s own one-hop sentence reads "Waits for staging · staging held on payments-svc"', () => {
		const staging = reconciled.upstream.find((l) => l.node.env === 'prod-eu-central')!;
		// Never promoted to `blocked` by the breakdown — the gate
		// `promotion-prod-us-east-2` DOES name candidates in `breakdown.held`
		// (4.45.0-45, 4.44.0-44), which is exactly the overstatement this
		// guard exists to refuse.
		expect(staging.state).not.toBe('blocked');
		expect(staging.chainPredecessor).toBe(true);

		// ⭐ qa12 CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11):
		// this is the STAGING LINK's own one-hop sentence — composed from
		// whether STAGING ITSELF is held, never from `prod-us-east-2`'s own
		// card (which, under the frontier rule, is now ALSO genuinely held
		// — see `held-predicate.test.ts`'s reference case 2 — an
		// independent fact about a DIFFERENT, older candidate that has
		// nothing to do with this chain link to staging). The chain gate
		// into prod-us-east-2 still genuinely refuses `4.44.0-44`/
		// `4.45.0-45` because staging has not deployed them, regardless of
		// prod-us-east-2's own separate hold on `4.43.0-43`.
		const { rollouts, environments, gateContext, network } = fetchCheckoutApiProdUsEast2();
		const now = new Date();
		const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) =>
			contractHoldsForRollout(network, r)
		);
		// Wave 1's leader is not itself refused by a contract here: it only waits for staging.
		const leaderCard = cards.find((c) => c.name === 'checkout-api' && c.envName === 'prod-eu-central')!;
		expect(leaderCard.held).toBe(false);
		expect(leaderCard.waitsForEnv).toBe('staging');
	});

	it('item 3 — THIS ROLLOUT\'S OWN LINE, PER BUILD: exactly one candidate (4.43.0-43) is genuinely held here; the two newer ones are chain-only', () => {
		const { breakdown } = fetchCheckoutApiProdUsEast2();
		const reallyHeldHere = breakdown.held.filter((h) => heldVerdictForBuild(h, 'prod-us-east-2').held);
		// 4.43.0-43 IS genuinely held here (payments-svc contract) — not
		// zero, but far fewer than the overstated "3 wait here" the raw
		// `breakdown.held.length` would read.
		expect(breakdown.held.length).toBe(3);
		expect(reallyHeldHere.map((h) => h.build)).toEqual(['4.43.0-43']);
		// The two newest candidates are chain-only — waiting, never held.
		for (const build of ['4.45.0-45', '4.44.0-44']) {
			const h = breakdown.held.find((x) => x.build === build)!;
			expect(heldVerdictForBuild(h, 'prod-us-east-2').held, build).toBe(false);
		}
	});
});

describe('the dependency tile agrees with the dependency\'s own refusal (dash-bug, 2026-11-14)', () => {
	const { hood, breakdown } = fetchCheckoutApiProdUsEast2();
	const refused = breakdown.held.filter((h) => h.contract?.provider === 'payments-svc').map((h) => h.build);

	it('the fixture: payments-svc refuses at least one build, and it is a contract link', () => {
		expect(refused.length).toBeGreaterThan(0);
		expect(hood.upstream.some((l) => l.writer === 'contract' && l.node.name === 'payments-svc')).toBe(true);
	});

	it('is `blocked` and counted whether or not the refused build has reached this environment', () => {
		const states = [true, false].map((here) => {
			const r = reconcileNeighbourhoodHolds(hood.upstream, breakdown, { heldHere: () => here });
			const link = r.upstream.find((l) => l.writer === 'contract' && l.node.name === 'payments-svc')!;
			return { state: link.state, held: link.held, holding: r.holding };
		});
		// Same tile, same count: nothing flips when staging passes the build.
		expect(states[1]).toEqual({ state: 'blocked', held: expect.arrayContaining(refused), holding: states[0].holding });
		expect(states[0].state).toBe('blocked');
		expect(states[1].holding).toBeGreaterThanOrEqual(1);
	});
});

/**
 * ⭐ THE GATES TAB'S FOUR WORDING CONTRADICTIONS, FIXED. (squad-rollout
 * gates-2 follow-up, 2026-10-11, second coordinator correction.) The chain
 * fix above was right but incomplete: `checkout-api/prod-us-east-2` has a
 * build genuinely held HERE (`4.43.0-43`, by `payments-svc` — the gate
 * count's own "1" above) alongside two chain-only candidates, and the
 * page's OWN rollout-level lead row used to pick the chain sentence
 * anyway, because the rollout-wide `heldVerdict` blends every held
 * candidate's gates into ONE list before checking chain dominance — correct
 * for one candidate, wrong the moment two DIFFERENT candidates have two
 * DIFFERENT causes. The fix routes the lead/card/header through
 * `reallyHeldHere` (`heldVerdictForBuild` applied PER CANDIDATE) instead of
 * the blended `RolloutCard.held`/`waitsForEnv`, which is immune to the
 * blend. This file pins the two testable guarantees without rendering the
 * whole route:
 *
 *   1. the lead sentence names the REALLY held build and its cause
 *      (`composeHeldLeadSentence`, extracted from the route unchanged);
 *   2. the "Held here"/"Waiting for `<stage>`" split the card renders is an
 *      exact, non-overlapping partition of `promotionHoldBreakdown.held` —
 *      which is what makes "the card's counts equal its rows" true by
 *      construction, wherever the template renders it.
 */
describe('checkout-api/prod-us-east-2 Gates tab: the lead names the real hold, not the chain', () => {
	const { breakdown } = fetchCheckoutApiProdUsEast2();
	const reallyHeldHere = breakdown.held.filter((h) => heldVerdictForBuild(h, 'prod-us-east-2').held);
	const chainOnlyHere = breakdown.held.filter((h) => !reallyHeldHere.includes(h));

	it('composeHeldLeadSentence names the held build (4.43.0-43) and its gate (payments-svc), never staging', () => {
		const { headline, consequence } = composeHeldLeadSentence(reallyHeldHere, breakdown.deployable);
		expect(headline).toContain('4.43.0-43');
		expect(headline).toContain('payments-svc');
		expect(headline).not.toContain('wave 1');
		// Nothing newer can deploy either — both chain-refused candidates are
		// held back from this environment's point of view.
		expect(consequence).toBe('Nothing promotes itself here yet; a deploy you start by hand still applies immediately.');
	});

	/**
	 * ⭐ qa11b, item 2 correction (squad-rollout gates-2 follow-up,
	 * 2026-10-11): "held", never "wait(s)" — that verb is reserved for a
	 * build merely queued behind an earlier stage, never one refused
	 * HERE. The exact live wording the coordinator asked for.
	 */
	it('reads "4.43.0-43 is held by payments-svc until it ships ~2.9.0 (has 2.4.1)" — never "waits"', () => {
		const { headline } = composeHeldLeadSentence(reallyHeldHere, breakdown.deployable);
		expect(headline).toBe('4.43.0-43 is held by payments-svc until it ships ~2.9.0 (has 2.4.1)');
		expect(headline).not.toMatch(/\bwaits?\b/);
	});

	it('"Held here" (reallyHeldHere) and "Waiting for staging" (chainOnlyHere) partition breakdown.held exactly — no build in both, none left out', () => {
		expect(reallyHeldHere.map((h) => h.build)).toEqual(['4.43.0-43']);
		expect(chainOnlyHere.map((h) => h.build).sort()).toEqual(['4.44.0-44', '4.45.0-45']);
		// The partition is exhaustive and disjoint: every build in the raw
		// breakdown is in exactly one of the two groups, which is what makes
		// "Held here: 1" + "Waiting for staging: 2" sum to the card's own
		// "3 held" total the raw `holdBreakdown.held.length` still reports —
		// never a build silently dropped from both groups.
		expect(reallyHeldHere.length + chainOnlyHere.length).toBe(breakdown.held.length);
		const seen = new Set([...reallyHeldHere, ...chainOnlyHere].map((h) => h.build));
		expect(seen.size).toBe(breakdown.held.length);
	});

	it('every chain-only build waits for the SAME stage (staging), so the group label names it: "Waiting for staging"', () => {
		const stages = new Set(chainOnlyHere.map((h) => heldVerdictForBuild(h, 'prod-us-east-2').waitsForEnv));
		expect(stages).toEqual(new Set([WAVE_STAGE]));
	});
});
