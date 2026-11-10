/**
 * ⭐ "WAITS FOR" VS "HELD", PER BUILD — ON REAL MOCK FIXTURES. (squad-rollout
 * gates-2 follow-up, 2026-10-11, shared/held-predicate)
 *
 * The defect this pins: the "Newer builds" rows (Overview, Gates,
 * `BlockedRow`) all read `promotionHoldBreakdown.held` and used to print
 * `held · N rule` for EVERY entry, including a candidate refused only by
 * plain chain sequencing (this environment simply has not deployed it yet —
 * an earlier-tier promotion gate, never a hold). `heldVerdictForBuild`
 * (`held.ts`) is the fix: it runs the SAME chain-dominance predicate
 * `heldVerdict` applies rollout-wide, scoped to one candidate's own
 * `classifiedGates`.
 *
 * There is no `hello-world-app` fixture in this dashboard's mock data (the
 * name in the task's own illustrative wording belongs to the live kind
 * cluster, not `$lib/demo/mock-data.ts`) — this uses the real fixture that
 * DOES carry both shapes at once, `checkout-api`, exactly the app the
 * `promotionHoldBreakdown`/`blockingStory` doc comments were already written
 * against for this identical defect (`prod-us-east-2`'s own "measured live"
 * note in `blocking-story.ts`). No fixture is invented here — every
 * assertion below was checked against `$lib/demo/mock-data.ts` as it
 * stands.
 */
import { describe, it, expect } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { withUsEast2Cleared, WAVE_STAGE } from './wave-reference.testkit';
import { buildGateContext, promotionHoldBreakdown } from '$lib/view-models/blocking-story';
import { buildRolloutGraph, contractHoldsForRollout } from '$lib/view-models/dependency-graph';
import { heldVerdictForBuild, causeLabelForGates } from '$lib/view-models/held';
import { buildRolloutCards, type RolloutCard } from '$lib/rollout-cards';
import type { Rollout } from '../../types';

function fetchCheckoutApi() {
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
	const now = new Date();
	const cards = buildRolloutCards(rollouts, environments, now, gateContext, (r) =>
		contractHoldsForRollout(network, r)
	);
	const byNs = (ns: string) =>
		rollouts.find((r) => r.metadata?.name === 'checkout-api' && r.metadata?.namespace === ns);
	return { rollouts, gateContext, network, cards, byNs };
}

/** `waitsFor`'s own "neutral" sentence — never the word "held". */
function waitsForSentence(stage: string, heldCause?: string): string {
	return `Waits for ${stage}${heldCause ? ` · ${heldCause}` : ''}`;
}

describe('checkout-api/prod-us-east-2 — chain-refused builds read "Waits for staging", never "held"', () => {
	const { gateContext, network, cards, byNs } = fetchCheckoutApi();
	const rollout = byNs('checkout-api-prod-us-east-2')!;
	const contractHolds = contractHoldsForRollout(network, rollout);
	const breakdown = promotionHoldBreakdown(rollout, gateContext, { place: 'prod-us-east-2', contractHolds });

	it('names 4.45.0-45, 4.44.0-44 (gate-refused) and 4.43.0-43 (contract-refused), newest first', () => {
		expect(breakdown.held.map((h) => h.build)).toEqual(['4.45.0-45', '4.44.0-44', '4.43.0-43']);
	});

	it('4.45.0-45 and 4.44.0-44 are plain chain sequencing — not held, waiting for the wave in front', () => {
		for (const build of ['4.45.0-45', '4.44.0-44']) {
			const h = breakdown.held.find((x) => x.build === build)!;
			const verdict = heldVerdictForBuild(h, 'prod-us-east-2');
			expect(verdict, build).toEqual({ held: false, cause: null, waitsForEnv: WAVE_STAGE });
			// The row's own text never claims a held cause for this build.
			expect(causeLabelForGates(h.classifiedGates, verdict.cause)).toBeNull();
		}
	});

	it('4.43.0-43 is genuinely held here — refused by the payments-svc contract, not the chain', () => {
		const h = breakdown.held.find((x) => x.build === '4.43.0-43')!;
		const verdict = heldVerdictForBuild(h, 'prod-us-east-2');
		expect(verdict.held).toBe(true);
		expect(verdict.cause).toBe('dependency');
		expect(verdict.waitsForEnv).toBeNull();
		expect(causeLabelForGates(h.classifiedGates, verdict.cause)).toBe('payments-svc');
	});

	it('the ROLLOUT-level card agrees: prod-us-east-2 reads "Waits for staging · staging held on payments-svc"', () => {
		// The one-hop composition every surface reads (`waitsFor`) — the
		// card's own `waitsForEnv` (set by `heldVerdict` at precompute time,
		// `rollout-cards.ts`) resolved against its peers, the SAME map the
		// Overview/Gates "Newer builds" rows build.
		const peersByEnv = new Map<string, RolloutCard>();
		for (const c of cards.filter((x) => x.name === 'checkout-api')) {
			if (c.envName) peersByEnv.set(c.envName, c);
		}
		// ⭐ qa12 CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11,
		// tl-integrate ruling — the frontier rule). This used to assert
		// `here.held === false` / `waitsForEnv === 'staging'`: the OLD
		// whole-rollout `heldVerdict` unioned every held candidate's gates
		// into one list, so the NEWER candidates' chain gate (4.44.0-44,
		// 4.45.0-45 — refused because staging has not deployed them)
		// silently outranked `4.43.0-43`'s own real, local hold. The
		// frontier rule reads per-candidate: `4.43.0-43` already cleared
		// staging (`ckHistory('staging')`'s head entry IS `4.43.0-43`,
		// `bakeStatus: 'Succeeded'`) and is refused HERE by `payments-svc`
		// — the place genuinely IS held, at that build.
		const here = peersByEnv.get('prod-us-east-2')!;
		expect(here.held).toBe(true);
		expect(here.heldCause).toBe('dependency');
		expect(here.heldCauseLabel).toBe('payments-svc');
		expect(here.waitsForEnv).toBeNull();
	});
});

describe('checkout-api/prod-ap-southeast-2 — the same chain shape; its own two newest candidates still only wait', () => {
	// `/calm hello-world/` from the task's own wording has no fixture here
	// (see the module doc comment) — `prod-ap-southeast-2` is the SAME
	// app's second region with the identical gate shape AND, per qa12's
	// correction, the identical `payments-svc` contract shape too (a second
	// `ckDep({ env: 'prod-ap-southeast-2', … })` entry, `mock-data.ts`):
	// `4.43.0-43` is genuinely held here as well, exactly like
	// `prod-us-east-2` above — see `held-predicate.test.ts`'s own reference
	// case 2 for the rollout-level assertion. This file only pins the
	// NEWEST two candidates, `4.44.0-44`/`4.45.0-45`, which are chain-only
	// here regardless: staging has not deployed them, so they still read
	// "Waits for staging", never held.
	const { gateContext, network, byNs } = fetchCheckoutApi();
	const rollout = byNs('checkout-api-prod-ap-southeast-2')!;
	const contractHolds = contractHoldsForRollout(network, rollout);
	const breakdown = promotionHoldBreakdown(rollout, gateContext, {
		place: 'prod-ap-southeast-2',
		contractHolds
	});

	it('reads "Waits for af-south-1" (its leader) for its newest candidates, with no held cause at all', () => {
		expect(breakdown.anyHeld).toBe(true);
		for (const h of breakdown.held.filter((x) => x.build !== '4.43.0-43')) {
			const verdict = heldVerdictForBuild(h, 'prod-ap-southeast-2');
			expect(verdict.held, h.build).toBe(false);
			// ap-southeast-2 is a FOLLOWER of af-south-1: it waits for its leader.
			expect(verdict.waitsForEnv, h.build).toBe('af-south-1');
			expect(waitsForSentence(verdict.waitsForEnv!)).toBe('Waits for af-south-1');
		}
	});
});
