/**
 * ONE ROLLOUT'S LOCAL DEPENDENCY GRAPH — what the rollout Dependencies tab
 * draws. (2026-10-05.)
 *
 * The SAME graph `/dependencies` draws (`buildRolloutGraph`: a node is a
 * rollout, an edge is a gate keyed to another rollout, one edge-state
 * predicate for both kinds), read from one node's point of view: every edge
 * INTO the focus is an upstream (what it waits on), every edge OUT of it a
 * downstream (what waits on it). Depth 1, no rectangle closure — the
 * whole-network page needs the services × environments matrix to keep its
 * columns honest; a three-layer picture of one node does not, and the closure
 * is what turned `checkout-api`'s tab into twenty-odd boxes.
 *
 * What this adds over the edge itself is the answer the owner asked to be
 * obvious at first glance: WHICH BUILDS the edge is holding — `GraphEdge.held`.
 *
 * ⛔ THIS MODULE NEVER RE-DECIDES AN EDGE. (2026-10-07.) It used to fall back
 * to an unpublished contract gate's `RolloutDependency` on its own, which
 * `buildRolloutGraph` did not, so the tab drew `6 of 6 held` on `payments-svc`
 * while `/dependencies` drew the same edges as unreported. That fallback now
 * lives in `buildRolloutGraph`, once, and both pages read its state and held
 * builds verbatim.
 */
import { onCluster } from './dependency-graph';
import type { EdgeState, EdgeWriter, GraphEdge, GraphNode, RolloutGraph } from './dependency-graph';
import type { GateBox } from './rollout-gates';
import { tierOf, TIER_ORDER } from './promotion-lanes';

export type NeighbourLink = {
	key: string;
	/** `upstream`: the far end must move first. `downstream`: it waits on the focus. */
	side: 'upstream' | 'downstream';
	writer: EdgeWriter;
	state: EdgeState;
	/** The rollout at the far end of the edge. */
	node: GraphNode;
	/**
	 * Display versions of the builds this edge is holding on the GATED
	 * rollout (the focus for an upstream link, the neighbour for a
	 * downstream one), newest first. Empty unless `state === 'blocked'`.
	 */
	held: string[];
	contract: string | null;
	requiredVersion: string | null;
	providedVersion: string | null;
	cyclic: boolean;
	/**
	 * The `RolloutGate` object name behind this edge (`GraphEdge.gate`,
	 * additive, 2026-10-10 — squad-rollout Lane G round 4, item 1). A
	 * `promotion` link's own gate is keyed the SAME way
	 * `promotionHoldBreakdown`'s `held[].gateNames` is, which is what makes
	 * `reconcileNeighbourhoodHolds` (below) possible: match this edge to the
	 * breakdown's own per-build read by gate name, not by re-deciding
	 * anything.
	 */
	gate: string;
	/**
	 * ⭐ CHAIN PREDECESSOR, NEVER A HOLD. (squad-rollout gates-2 follow-up,
	 * 2026-10-11, shared/held-predicate — qa11 finding.) True exactly for
	 * an UPSTREAM `promotion`-writer link whose far-end environment is in
	 * an EARLIER TIER than the focus's own (`promotion-lanes.ts`'s
	 * `tierOf`, the same bucketing `held.ts`'s `verdictForGates` uses for
	 * the identical rule at the per-build scale) OR a topology edge inside
	 * the tier (`edgeKind` `wave` / `follow`: the previous wave, or this
	 * wave's leader) — the tier's own sequencing, same as `held.ts`.
	 *
	 * This is a property of the EDGE (which two environments, and their
	 * tiers), decided independently of `state`/`held`/the breakdown: qa11's
	 * own finding was exactly that `state` alone cannot carry this
	 * distinction (a chain predecessor's raw edge state and its
	 * `promotionHoldBreakdown`-reconciled state have both been observed
	 * `blocked`, live, for a link that is never a hold). A caller — the
	 * canvas, the "N of M holding" rollup — reads THIS field, never
	 * `state`, to decide whether to count or draw this link as held.
	 */
	chainPredecessor: boolean;
};

export type RolloutNeighbourhood = {
	/** `null` when this rollout is not in the dependency graph at all. */
	focus: GraphNode | null;
	upstream: NeighbourLink[];
	downstream: NeighbourLink[];
	/**
	 * The focus's gates that are not another rollout — deploy windows,
	 * approvals, health, a pin (`rollout-gates.ts`). Drawn in the upstream
	 * column beside the upstream links: they gate THIS rollout.
	 */
	gates: GateBox[];
	/** Links whose state is `blocked`, both sides. */
	heldLinks: number;
	/** Every gate drawn: upstream + downstream links + gate boxes. */
	total: number;
	/** Of `total`, how many are holding a build right now. */
	holding: number;
	/** Distinct builds of the FOCUS held by its upstream links and gate boxes. */
	heldBuilds: string[];
};

export const EMPTY_NEIGHBOURHOOD: RolloutNeighbourhood = {
	focus: null,
	upstream: [],
	downstream: [],
	gates: [],
	heldLinks: 0,
	total: 0,
	holding: 0,
	heldBuilds: []
};

const STATE_ORDER: Record<EdgeState, number> = { blocked: 0, unknown: 1, clear: 2 };

/**
 * Held first — the answer goes at the top of each column, where the eye
 * lands — then the same service's own promotion line before other services,
 * then promotion order, then name, so two loads read identically.
 */
function compareLinks(a: NeighbourLink, b: NeighbourLink): number {
	return (
		STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
		(a.writer === b.writer ? 0 : a.writer === 'promotion' ? -1 : 1) ||
		a.node.envRank - b.node.envRank ||
		a.node.name.localeCompare(b.node.name) ||
		a.node.env.localeCompare(b.node.env)
	);
}

/**
 * The focus node, matched on cluster, namespace AND name (`onCluster` for the
 * unstamped hub-local case). Three rollouts share the name `hello-api-app`,
 * and the same (namespace, name) can exist on two clusters, so nothing less
 * is an identity.
 */
function findFocus(
	graph: RolloutGraph,
	at: { cluster: string; namespace: string; name: string },
	localCluster?: string
): GraphNode | null {
	return (
		graph.nodes.find(
			(n) =>
				n.namespace === at.namespace &&
				n.name === at.name &&
				onCluster(n.cluster, at.cluster, localCluster)
		) ?? null
	);
}

export function rolloutNeighbourhood(args: {
	graph: RolloutGraph;
	at: { cluster: string; namespace: string; name: string };
	/** The hub's own cluster name, for unstamped (hub-local) nodes. */
	localCluster?: string;
	/** The focus's non-rollout gates (`rolloutGateBoxes`), already decided. */
	gates?: GateBox[];
}): RolloutNeighbourhood {
	const focus = findFocus(args.graph, args.at, args.localCluster);
	if (!focus) return EMPTY_NEIGHBOURHOOD;
	const byId = new Map(args.graph.nodes.map((n) => [n.id, n] as const));

	const focusTier = TIER_ORDER.indexOf(tierOf(focus.env));
	const link = (e: GraphEdge, side: NeighbourLink['side']): NeighbourLink | null => {
		const far = byId.get(side === 'upstream' ? e.from : e.to);
		if (!far) return null;
		const chainPredecessor =
			side === 'upstream' &&
			e.writer === 'promotion' &&
			// An earlier tier, or a topology edge inside the tier (the previous wave, or
			// this wave's leader): either way the stage in front, never a hold of its own.
			(TIER_ORDER.indexOf(tierOf(far.env)) < focusTier ||
				e.edgeKind === 'wave' ||
				e.edgeKind === 'follow');
		return {
			key: e.key,
			side,
			writer: e.writer,
			state: e.state,
			node: far,
			held: e.held,
			contract: e.contract,
			requiredVersion: e.requiredVersion,
			providedVersion: e.providedVersion,
			cyclic: e.cyclic,
			gate: e.gate,
			chainPredecessor
		};
	};

	const upstream: NeighbourLink[] = [];
	const downstream: NeighbourLink[] = [];
	for (const e of args.graph.edges) {
		// A self-loop is drawn on /dependencies; here it would put the focus on
		// both sides of itself. It is still counted through `heldLinks`.
		if (e.from === focus.id && e.to === focus.id) continue;
		if (e.to === focus.id) {
			const l = link(e, 'upstream');
			if (l) upstream.push(l);
		} else if (e.from === focus.id) {
			const l = link(e, 'downstream');
			if (l) downstream.push(l);
		}
	}
	upstream.sort(compareLinks);
	downstream.sort(compareLinks);

	const gates = args.gates ?? [];
	// ⭐ A CHAIN PREDECESSOR NEVER COUNTS AS HELD (qa11 finding). Excluded
	// from `heldLinks`/`holding`/`heldBuilds` here, at the SAME point every
	// other "is this held" read in this function happens — never patched
	// on top by a caller, which is exactly how the raw and the reconciled
	// state both read `blocked` for a link that is never a hold.
	const heldLinks = [...upstream, ...downstream].filter(
		(l) => l.state === 'blocked' && !l.chainPredecessor
	).length;
	return {
		focus,
		upstream,
		downstream,
		gates,
		heldLinks,
		total: upstream.length + downstream.length + gates.length,
		holding: heldLinks + gates.filter((g) => g.state === 'blocked').length,
		heldBuilds: [
			...new Set([
				...upstream.filter((l) => !l.chainPredecessor).flatMap((l) => l.held),
				...gates.flatMap((g) => g.held)
			])
		]
	};
}

/**
 * ⭐ THE CANVAS AGREES WITH THE BREAKDOWN, BY CONSTRUCTION. (2026-10-10 —
 * squad-rollout Lane G round 4, item 1, AD ruling.) Live-measured on
 * `checkout-api/prod-us-east-2`: the staging-first PROMOTION link drew
 * "Nothing held · staging deploys first" (green) while `4.45.0-45` and
 * `4.44.0-44` below it read "Held, staging deploys it first" — two
 * contradictory reads of the SAME gate. The edge's own `state`
 * (`buildRolloutGraph`'s `candidatesHeldByGate` over `allDeps`) and
 * `promotionHoldBreakdown`'s `held[].gateNames` (`rollout.status.gates`) are
 * two different sources for "is this gate holding anything", and they can
 * disagree for the same reason every other hold-one-rule fix in this round
 * exists: one of the two did not see the whole picture.
 *
 * This takes `promotionHoldBreakdown`'s OWN per-build read as the one true
 * source for every UPSTREAM link, keyed by `gate` (a promotion link) or by
 * provider name (a contract link, matched the same way `contractHoldsForRollout`
 * attributes a hold to a provider). A link named in the breakdown is
 * `blocked` with EXACTLY the breakdown's own builds; a link the breakdown
 * does not name keeps its own edge-state verbatim (a contract edge into a
 * DIFFERENT environment's rollout, say, which this breakdown — scoped to
 * ONE rollout — never claims to answer for). Downstream links and gate boxes
 * are untouched: the breakdown only ever describes the focus's OWN held
 * candidates, never what the focus holds on someone else.
 */
export function reconcileNeighbourhoodHolds(
	upstream: readonly NeighbourLink[],
	breakdown: {
		held: readonly { build: string; gateNames: readonly string[]; contract?: { provider: string } }[];
	},
	options: {
		/**
		 * ⭐ HELD HERE, NOT MERELY REFUSED. `breakdown.held` names every candidate a
		 * gate refuses, including ones this environment has not reached yet (they
		 * wait for an earlier stage). The signed held predicate counts only a build
		 * refused HERE; when given, a build for which this returns false is not
		 * counted on any link, and a link whose every named build is such a build
		 * reads clear. Omitted = every named build counts (the old behaviour).
		 */
		heldHere?: (h: { build: string; gateNames: readonly string[] }) => boolean;
	} = {}
): {
	upstream: NeighbourLink[];
	/**
	 * How many of the RECONCILED upstream links are now `blocked` — this
	 * breakdown only ever describes the focus's own held candidates (its
	 * upstream), never what it holds on someone else, so a caller computing
	 * the FULL "N of M holding" rollup adds `hood.downstream`/`hood.gates`'
	 * own blocked counts on top of this one, unreconciled (nothing here
	 * claims to correct them).
	 */
	holding: number;
} {
	const byGate = new Map<string, string[]>();
	const byProvider = new Map<string, string[]>();
	for (const h of breakdown.held) {
		const counts = options.heldHere ? options.heldHere(h) : true;
		for (const g of h.gateNames) {
			const arr = byGate.get(g) ?? [];
			if (counts) arr.push(h.build);
			byGate.set(g, arr);
		}
		if (h.contract) {
			const arr = byProvider.get(h.contract.provider) ?? [];
			if (counts) arr.push(h.build);
			byProvider.set(h.contract.provider, arr);
		}
	}
	const reconciled = upstream.map((l) => {
		// ⭐ A CHAIN PREDECESSOR IS NEVER RECONCILED INTO `blocked` (qa11
		// finding). `promotionHoldBreakdown.held` names every candidate a
		// chain gate refuses too (chain sequencing refuses every candidate
		// exactly as completely as a real hold), so without this guard the
		// override above would re-introduce the identical overstatement
		// `rolloutNeighbourhood`'s own `chainPredecessor` exclusion already
		// closed for the RAW edge — this function must not undo that.
		if (l.chainPredecessor) return l;
		const override =
			l.writer === 'promotion' ? byGate.get(l.gate) : l.writer === 'contract' ? byProvider.get(l.node.name) : undefined;
		if (!override) return l;
		// Named by the breakdown, but only for builds this environment has not
		// reached: nothing is refused HERE through this link.
		if (override.length === 0) return options.heldHere ? { ...l, state: 'clear' as const, held: [] } : l;
		return { ...l, state: 'blocked' as const, held: override };
	});
	const holding = reconciled.filter((l) => l.state === 'blocked' && !l.chainPredecessor).length;
	return { upstream: reconciled, holding };
}
