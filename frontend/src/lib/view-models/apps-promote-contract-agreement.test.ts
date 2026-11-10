import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { withUsEast2Cleared, WAVE_STAGE } from './wave-reference.testkit';
import { buildRolloutGraph, contractHeldVersionsFor } from './dependency-graph';
import { newestPromotableCandidate } from './app-tasks';
import { blockingGateNames, isDeployable, promotionCandidates } from './promotion';
import { getDisplayVersion } from '$lib/utils';
import type { Environment, Rollout, RolloutDependency } from '../../types';

/**
 * ⛔ F1 (2026-10-09, coordinator follow-up to the ChangeVersionModal U-5
 * fix in 767d9b4). The measured defect: `/apps/checkout-api`'s "Ready to
 * promote" card offered `Deploy 4.43.0-43 to us-east-2` while Overview's
 * "Newer builds" ledger, the Gates tab and `ChangeVersionModal`'s own
 * picker all read `4.43.0-43` HELD — payments-svc has not shipped the
 * version this build needs.
 *
 * The cause: `routes/apps/[name]/+page.svelte`'s promote-bucket builder
 * used `newestDeployableCandidate` (`promotion.ts`), which reads
 * `rollout.status.gates` only — the same split traced in
 * `change-version-held-agreement.test.ts` and in `ChangeVersionModal`'s own
 * `contractHeldVersions` doc comment. The page's fix,
 * `newestPromotableCandidate` (`app-tasks.ts`), additionally excludes any
 * candidate in `contractHeldVersionsFor(network, focusId)` — THE SAME
 * shared pure function the dialog and rollout detail both call, off the
 * SAME dependency graph.
 *
 * The page's rule now lives in `app-tasks.ts`, and this test calls that
 * real export (not a copy) against the SAME `checkout-api`/
 * `prod-us-east-2` fixture (calm scenario), and asserts the page's formula
 * agrees with the canonical held predicate for every release candidate:
 * nothing the formula would offer as "ready to promote" may be held by
 * Overview/Gates' own canonical predicate, and nothing canonical-held may
 * ever be offered.
 */

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

type ReleaseRef = { tag?: string; version?: string; revision?: string };

function fixtureList(): List {
	return withUsEast2Cleared(JSON.parse(respond('GET', '/api/rollouts').body ?? '{}')) as List;
}

function graphFor(list: List) {
	return buildRolloutGraph({
		rollouts: list.rollouts.items,
		environments: list.environments.items,
		dependencies: list.rolloutDependencies.items,
		envOrder: []
	});
}

/**
 * `getDisplayVersion` requires `tag: string`; `promotionCandidates`' own
 * `ReleaseRef` declares it optional (real payload objects always have it).
 * Coerced once, same convention `change-version-held-agreement.test.ts`
 * uses for its own `dv`.
 */
function dv(candidate: ReleaseRef): string {
	return getDisplayVersion({ ...candidate, tag: candidate.tag ?? '' });
}

/** The one predicate Overview's ledger and the Gates tab both reduce to — same as `change-version-held-agreement.test.ts`'s `canonicalHeld`. */
function canonicalHeld(rollout: Rollout, candidate: ReleaseRef, held: Set<string>): boolean {
	const tag = candidate.tag ?? candidate.version ?? '';
	return blockingGateNames(rollout, tag).length > 0 || held.has(dv(candidate));
}

describe('apps task list agrees with Overview/Gates on which build is deployable (checkout-api/prod-us-east-2, calm)', () => {
	resetDemoState('calm');
	const list = fixtureList();
	const rollout = list.rollouts.items.find(
		(r) =>
			r.metadata?.name === 'checkout-api' &&
			r.metadata?.namespace === 'checkout-api-prod-us-east-2'
	);
	if (!rollout) throw new Error('checkout-api/prod-us-east-2 not found in the calm fixture');

	const graph = graphFor(list);
	const focusId = graph.nodes.find(
		(n) => n.namespace === rollout.metadata?.namespace && n.name === rollout.metadata?.name
	)?.id;
	if (!focusId) throw new Error('checkout-api/prod-us-east-2 not found in its own dependency graph');

	const held = contractHeldVersionsFor(graph, focusId);
	const candidates = promotionCandidates(rollout);

	it('the fixture actually has a gate-deployable candidate that is contract-held, so this test can fail', () => {
		// Pins the coordinator's own repro: 4.43.0-43 passes every gate in
		// `status.gates` (so `isDeployable` alone calls it ready) and is held
		// ONLY by the payments-svc contract — exactly the shape
		// `newestDeployableCandidate` cannot see.
		const b43 = candidates.find((c) => dv(c) === '4.43.0-43');
		expect(b43, 'fixture must carry 4.43.0-43 as a candidate').toBeTruthy();
		const tag = b43!.tag ?? '';
		expect(isDeployable(rollout, tag), '4.43.0-43 must be gate-deployable').toBe(true);
		expect(held.has(dv(b43!)), '4.43.0-43 must be contract-held').toBe(true);
	});

	it('the task list never offers a build Overview/Gates call held', () => {
		const offered = newestPromotableCandidate(graph, rollout);
		if (!offered) return; // nothing offered is trivially not a disagreement
		expect(
			canonicalHeld(rollout, offered, held),
			`${dv(offered)} is offered as ready to promote but Overview/Gates call it held`
		).toBe(false);
	});

	it('the task list offers exactly the newest build Overview/Gates do not hold', () => {
		const expected = candidates.find((c) => !canonicalHeld(rollout, c, held)) ?? null;
		const offered = newestPromotableCandidate(graph, rollout);
		expect(offered ? dv(offered) : null).toBe(expected ? dv(expected) : null);
		expect(offered ? dv(offered) : null).not.toBe('4.43.0-43');
	});
});
