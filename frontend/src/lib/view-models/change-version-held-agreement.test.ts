import { describe, expect, it } from 'vitest';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { withUsEast2Cleared, WAVE_STAGE } from './wave-reference.testkit';
import { buildRolloutGraph, contractHeldVersionsFor } from './dependency-graph';
import { blockingGateNames, isDeployable, promotionCandidates } from './promotion';
import { getDisplayVersion } from '$lib/utils';
import type { Environment, Rollout, RolloutDependency } from '../../types';

type ReleaseRef = { tag?: string; version?: string; revision?: string };

/**
 * ⛔ U-5 CLASS BUG, PINNED (2026-10-09, integration round 3, item 3).
 *
 * The coordinator's finding: on `checkout-api`/`prod-us-east-2` (calm
 * scenario), Overview's "Newer builds" ledger and the Gates tab both mark
 * `4.43.0-43`/`4.44.0-44`/`4.45.0-45` HELD — payments-svc hasn't shipped the
 * version this build needs — but `ChangeVersionModal`'s picker marked only
 * the two GATE-blocked builds (`4.45.0-45`, `4.44.0-44`) and left
 * `4.43.0-43` reading plain `Ready`.
 *
 * The cause: the dialog's `isHeld` read only `isDeployable` (this file,
 * `rollout.status.gates`-only), never the dependency graph's inbound
 * contract edges — the same split `promotionBlock`'s own U-5 doc comment
 * above already traces for the Overview-vs-Gates version of this bug one
 * layer down. `ChangeVersionModal` now takes a `contractHeldVersions` set
 * (the rollout detail page's `holdEdgesIn`, flattened — see both doc
 * comments) and ORs it into `isHeld`. This test builds the SAME dependency
 * graph the real page builds, from the SAME fixture the coordinator
 * measured against, and asserts every release candidate on
 * `checkout-api`/`prod-us-east-2` gets the identical HELD verdict whichever
 * of the three formulas computes it:
 *
 *   · dialogHeld   — `ChangeVersionModal`'s own formula, reproduced here
 *                     (gate-blocked OR contract-held)
 *   · canonicalHeld — `blockingGateNames(...).length > 0 ||
 *                      contractHeldVersions.has(displayVersion)`, the one
 *                      predicate Overview's `isBlocked` and the Gates tab's
 *                      per-candidate read both reduce to
 *
 * A regression that makes the dialog read only gate-blocking again (or the
 * graph read only gate-blocking) fails this test on `4.43.0-43` specifically
 * — the one candidate that is contract-held and NOT gate-blocked, which is
 * exactly the case a formula missing the OR cannot produce.
 *
 * ⭐ (2026-10-09, integration round 4, item follow-up) `contractHeldVersions`
 * below is now built with `contractHeldVersionsFor` — the ONE pure function
 * `dependency-graph.ts` exports for this exact filter — rather than the
 * inline flatMap this file used to repeat. `ChangeVersionModal.svelte` calls
 * the SAME function from its own self-built graph (see its `selfHeldGraph`
 * derivation) whenever a caller does not pass the prop, which rollout detail
 * is now the only one that does; `ChangeVersionModal.svelte.test.ts`'s
 * "self-derivation" describe block proves the dialog agrees with THIS test's
 * `canonicalHeld` from a mount that looks like `/apps/<name>` or history —
 * no `contractHeldVersions` prop, no rollout-detail-only wiring.
 */

type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};

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
 * `ReleaseRef` declares it optional (real payload objects always have it —
 * see that type's own comment). Coercing here, once, keeps every call site
 * below a plain `dv(candidate)` instead of repeating the `?? ''`.
 */
function dv(candidate: ReleaseRef): string {
	return getDisplayVersion({ ...candidate, tag: candidate.tag ?? '' });
}

/**
 * Reproduces `ChangeVersionModal`'s `isHeld` for one candidate. Matches the
 * real component exactly: it resolves `displayVersion` from the full
 * `availableRelease` object (tag + version), never from the bare tag — a
 * mock tag like `b-43` has no relation to its own display version
 * (`4.43.0-43`), so a helper that forgot this would silently test nothing.
 */
function dialogHeld(rollout: Rollout, candidate: ReleaseRef, contractHeldVersions: Set<string>): boolean {
	const tag = candidate.tag ?? candidate.version ?? '';
	const displayVersion = dv(candidate);
	return !isDeployable(rollout, tag) || contractHeldVersions.has(displayVersion);
}

/** The one predicate Overview's ledger and the Gates tab both reduce to. */
function canonicalHeld(
	rollout: Rollout,
	candidate: ReleaseRef,
	contractHeldVersions: Set<string>
): boolean {
	const tag = candidate.tag ?? candidate.version ?? '';
	const displayVersion = dv(candidate);
	return blockingGateNames(rollout, tag).length > 0 || contractHeldVersions.has(displayVersion);
}

describe('ChangeVersionModal / Overview / Gates agree on HELD (checkout-api/prod-us-east-2, calm)', () => {
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

	const contractHeldVersions = contractHeldVersionsFor(graph, focusId);

	const candidates = promotionCandidates(rollout);

	it('the fixture actually has a candidate held by contract alone, so this test can fail', () => {
		// Pins the coordinator's own repro: 4.43.0-43 is held ONLY by the
		// payments-svc contract — no gate in `status.gates` refuses it — which
		// is exactly the shape `isDeployable` alone cannot see.
		const b43 = candidates.find((c) => dv(c) === '4.43.0-43');
		expect(b43, 'fixture must carry 4.43.0-43 as a candidate').toBeTruthy();
		const tag = b43!.tag ?? b43!.version ?? '';
		expect(blockingGateNames(rollout, tag)).toEqual([]);
		expect(contractHeldVersions.has(dv(b43!))).toBe(true);
	});

	it.each(candidates.map((c) => ({ c, label: dv(c) })))(
		'candidate $label: dialog === canonical',
		({ c }) => {
			expect(dialogHeld(rollout, c, contractHeldVersions)).toBe(
				canonicalHeld(rollout, c, contractHeldVersions)
			);
		}
	);

	it('every one of 4.43.0-43 / 4.44.0-44 / 4.45.0-45 reads HELD everywhere', () => {
		for (const wantDv of ['4.43.0-43', '4.44.0-44', '4.45.0-45']) {
			const c = candidates.find((cand) => dv(cand) === wantDv);
			expect(c, `${wantDv} must be a candidate in this fixture`).toBeTruthy();
			expect(dialogHeld(rollout, c!, contractHeldVersions), `${wantDv} dialog`).toBe(true);
			expect(canonicalHeld(rollout, c!, contractHeldVersions), `${wantDv} canonical`).toBe(true);
		}
	});
});
