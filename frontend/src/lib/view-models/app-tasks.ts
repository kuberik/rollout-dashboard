/**
 * App page (`/apps/[name]`) task building: which build an environment's
 * "Ready to promote" task offers.
 *
 * Lives here, not in the page, so the agreement test
 * (`apps-promote-contract-agreement.test.ts`) exercises the real function
 * the page calls rather than a copy of it.
 *
 * "Ready to promote" means gate-allowed AND not contract-held. A
 * `RolloutDependency` contract hold is not always published on
 * `rollout.status.gates`, so `newestDeployableCandidate` (`promotion.ts`,
 * gates only) cannot see it; this adds the same `contractHeldVersionsFor`
 * (`dependency-graph.ts`) that rollout detail, the Gates tab and
 * `ChangeVersionModal` read, off the same graph.
 */
import type { Rollout } from '../../types';
import { getDisplayVersion } from '$lib/utils';
import { sourceClusterName } from '$lib/source-dashboard';
import { contractHeldVersionsFor, type GraphNode, type RolloutGraph } from './dependency-graph';
import { isDeployable, promotionCandidates, type ReleaseRef } from './promotion';

/**
 * The graph node for a rollout, matched on the node's own namespace and
 * name. A built id would mismatch for hub-local rollouts: the page maps an
 * unstamped cluster to `localClusterName`, while node ids key off the raw
 * `source-cluster` annotation (`''`).
 *
 * ⭐ ITEM 4 (coordinator, 2026-10-09). NAMESPACE + NAME ALONE IS AMBIGUOUS
 * ACROSS SPOKES. Two spokes can genuinely run the SAME (namespace, name) —
 * a multi-cluster fleet where `checkout-api-prod` exists once per region,
 * say — and before this fix the FIRST node `Array.find` happened to reach
 * won regardless of which one the caller actually meant, silently reading
 * the wrong rollout's held state.
 *
 * `cluster` is a NEW, OPTIONAL fourth parameter — the caller's own cluster
 * context, in the PAGE's convention (`undefined` on a hub route, the
 * spoke's name on a spoke route, same as `ChangeVersionModal`'s own
 * `cluster` prop). It is read ONLY to break a genuine tie (more than one
 * node shares this namespace+name), never to filter a graph that already
 * has just one match — so the hub-local `''`-vs-`localClusterName` case
 * item (c) fixed (matching on namespace+name alone, ignoring a built id's
 * cluster segment entirely) keeps working byte-for-byte: with a single
 * candidate, `cluster` is never even consulted.
 *
 * When there IS a tie, the rollout's OWN `source-cluster` annotation
 * (`sourceClusterName`, `$lib/source-dashboard`) is tried FIRST — it is the
 * SAME raw value every node's own `cluster` field was built from
 * (`clusterOf` inside `dependency-graph.ts`), stamped directly on this
 * exact object by the hub's LIST endpoints, so it cannot disagree with the
 * convention the graph itself used. Only when the rollout carries no such
 * annotation (a single-rollout DETAIL fetch, which is not list-stamped, or
 * a genuinely hub-local rollout) does the caller's `cluster` argument get
 * used, translated the same way `ChangeVersionModal`'s own fix already
 * established: `undefined` (hub route) reads as `''`, never a page's
 * display fallback like `localClusterName`.
 */
export function graphNodeForRollout(
	graph: RolloutGraph,
	rollout: Rollout,
	namespace: string | undefined = rollout.metadata?.namespace,
	cluster?: string
): GraphNode | null {
	const name = rollout.metadata?.name;
	const candidates = graph.nodes.filter((n) => n.namespace === namespace && n.name === name);
	if (candidates.length < 2) return candidates[0] ?? null;
	const wanted = sourceClusterName(rollout) || (cluster ?? '');
	return candidates.find((n) => n.cluster === wanted) ?? candidates[0];
}

/** Display versions held by an inbound blocked contract edge; empty when the rollout is not in the graph. */
export function contractHeldVersionsForRollout(
	graph: RolloutGraph,
	rollout: Rollout,
	namespace?: string,
	cluster?: string
): Set<string> {
	const node = graphNodeForRollout(graph, rollout, namespace, cluster);
	return node ? contractHeldVersionsFor(graph, node.id) : new Set<string>();
}

/**
 * The newest candidate an environment can be offered: gate-deployable
 * (`isDeployable`) and not contract-held. `null` when every newer build is
 * held one way or the other.
 */
export function newestPromotableCandidate(
	graph: RolloutGraph,
	rollout: Rollout,
	namespace?: string,
	cluster?: string
): ReleaseRef | null {
	const held = contractHeldVersionsForRollout(graph, rollout, namespace, cluster);
	for (const c of promotionCandidates(rollout)) {
		const tag = c.tag ?? null;
		if (!tag || !isDeployable(rollout, tag)) continue;
		const dv = getDisplayVersion(c as { version?: string; revision?: string; tag: string });
		if (held.has(dv)) continue;
		return c;
	}
	return null;
}
