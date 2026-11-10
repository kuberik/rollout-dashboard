/**
 * THE DEPENDENCY GRAPH — ONE graph, one node set, one edge type.
 *
 * ── ⭐ 2026-08-31 · WHAT THE PREVIOUS TWO REVISIONS GOT WRONG ────────────
 *
 * The human has now said three times that CONTRACT dependencies and
 * ENVIRONMENT dependencies are ONE graph. The revision before this one
 * declared, in a starred comment, that *"a node is a SERVICE, not a
 * (service, environment)"* — and that single decision is what made the
 * second relation undrawable. A promotion runs between two environments OF
 * THE SAME SERVICE; collapse the environment axis into the node and you have
 * deleted the very edge that was asked for.
 *
 * The correct model is smaller than either of the two it replaces, and it
 * comes from the controllers rather than from the UI:
 *
 *   **A `Rollout` IS a (service, environment). That is the node.**
 *   **A `RolloutGate` on a rollout, keyed to ANOTHER rollout, is the edge.**
 *
 * Both controllers write the same shape — a gate on the rollout that WAITS,
 * whose `allowedVersions` are computed from the rollout it waits ON:
 *
 *   | writer              | gate lives on | keyed to        | opens when                       |
 *   |---------------------|---------------|-----------------|----------------------------------|
 *   | `Environment`       | downstream    | upstream env's  | upstream has the build, baked OK |
 *   |  (`status.rolloutGateRef`; the order is tier/wave/leader, sites-waves.ts)  rollout       |
 *   | `RolloutDependency` | consumer      | provider rollout| provider serves the contract     |
 *   |  (`status.gateName`, `spec.providerRef`, `spec.contract`)                                |
 *
 * So **which controller wrote the gate is an ATTRIBUTE of the edge**
 * (`writer`), not a second relation. There is one `edges` array. Nothing is
 * joined at render time. That is why they are one graph.
 *
 * A build therefore moves RIGHTWARDS through environments and SIDEWAYS
 * between services that must ship in order, and `hello-frontend-app` in prod
 * is visibly held by TWO inbound edges at once: staging has not deployed, and
 * the api it needs is a version behind.
 *
 * ── ⛔ A SCHEDULE GATE HAS NO FAR END, AND MUST NOT INVENT ONE ───────────
 *
 * `schedule-gate-nwm62` holds `hello-world-app` in staging and there is no
 * second rollout anywhere in it. A gate with no source node is NOT an edge:
 * it is recorded on the node as a `hold`, with the glyph its `clears` kind
 * earns. Drawing a phantom node for a clock would be drawing a lie in the one
 * place the reader trusts most.
 *
 * ── ⭐ THE ADVERSE PREDICATE IS `promotionBlock`, FOR BOTH KINDS ─────────
 *
 * One predicate, so the two edge kinds cannot disagree, and so the graph
 * cannot disagree with the pages it links to:
 *
 *     edge is BLOCKED  ⟺  its gate name is in `promotionBlock(target).blockingGates`
 *
 * `promotionBlock` is the product's own, already-shipped answer to *"is this
 * gate holding a build this rollout could actually take"*. It is scoped to
 * the target's OWN candidate ladder, so a gate refusing `rel-2` on a rollout
 * running `rel-66` is the gate WORKING and produces no red — the exact split
 * the old `blockedReleases` reasoning had to reach for `Satisfied` to get.
 * The earlier revision could not use it because its nodes were services and
 * it had no rollout to ask; a node that IS a rollout has one.
 *
 * `Satisfied` on the `RolloutDependency` is still read — it carries the
 * constraint and the served version that the sentence prints — but it is no
 * longer the verdict.
 *
 * ⛔ AND A GATE WE CANNOT READ IS `unknown`, NOT `clear`. When the target
 * rollout is absent from the payload, or the gate the CRD names does not
 * appear in that rollout's `status.gates` at all, the edge is DASHED and says
 * so. Reading absence as health is how a dashboard tells an operator to go
 * back to bed.
 *
 * ── ⭐ THIS MODULE HAS NO COORDINATES IN IT ─────────────────────────────
 *
 * The layout is dagre's, inside `GraphCanvas`. What lives here is the graph,
 * its states, its filters, the phone's service lines, and `layoutOrder` —
 * which is an ORDER, not a position: it decides the sequence nodes are handed
 * to dagre in, and dagre assigns every pixel. See its own comment for why
 * that one lever is worth having.
 *
 * Everything here is PURE and deterministic, so it is tested without a DOM.
 */

import type { Rollout, Environment, RolloutDependency } from '../../types';
import { SOURCE_CLUSTER_ANNOTATION } from '$lib/source-dashboard';
import { displayVersionForTag } from '../version-utils';
import { getDisplayVersion } from '$lib/utils';
import {
	buildTopology,
	deployNameOf,
	placeKeyOf,
	siteNodeOf,
	upstreamOf
} from './sites-waves';
import {
	candidatesHeldByGate,
	promotionBlock,
	promotionCandidates,
	type ReleaseRef
} from './promotion';
import {
	blockingStory,
	joinClauses,
	withSchedules,
	EMPTY_GATE_CONTEXT,
	type GateClears,
	type GateContext,
	type ContractHold
} from './blocking-story';
import type { NetworkSchedules, NetworkScheduleObject } from '$lib/api/schedules';

// =========================================================================
// THE MODEL
// =========================================================================

/** Which controller wrote the gate this edge is. */
export type EdgeWriter = 'promotion' | 'contract';

/**
 * `unknown` is NOT a synonym for `clear`. It means we could not read the
 * gate's state on the rollout it sits on — the rollout is not in this
 * payload, or it publishes no summary for that gate.
 */
export type EdgeState = 'blocked' | 'clear' | 'unknown';

/** A gate holding this rollout that has no second rollout on the far end. */
export type NodeHold = {
	/** The Kubernetes object name. A handle, never a headline. */
	gate: string;
	clears: GateClears;
	/** `Outside the Business Hours deploy window`. From `classifyGate`. */
	short: string;
	/** ISO instant it reopens, when `clears === 'clock'`. */
	clearsAt: string | null;
	/**
	 * ⭐ CARRIED STRAIGHT OFF `ClassifiedGate.pending`. (2026-09-04,
	 * load-state audit finding 4) `true` means `short` above is the `check`
	 * fallback's claim ("A check is not passing") printed BEFORE
	 * `/schedules` has been consulted — it might reclassify to a genuine
	 * `clock` gate, with real window text, the moment that request lands.
	 * `undefined`/`false` on every other hold, including the synthetic pin
	 * hold below, which is never speculative. A renderer that draws `short`
	 * while this is `true` is printing the same confident-but-possibly-wrong
	 * sentence the audit's principle 4 bans — see `DependencyNode.svelte`.
	 */
	pending?: boolean;
};

/** ONE ROLLOUT — a (service, environment). */
export type GraphNode = {
	/** `${cluster}/${namespace}/${name}`. */
	id: string;
	cluster: string;
	namespace: string;
	/** The Rollout name — the product's app identity, `/apps/<name>`. */
	name: string;
	/** Environment tier from the `Environment` object; the namespace when unbound. */
	env: string;
	/** Position of `env` in the fleet's promotion order. The column. */
	envRank: number;
	/** True when no Rollout of this identity appears in the payload. */
	unresolved: boolean;
	/** The build it is running now, in the product's display form. */
	build: string | null;
	/** Newer builds it could take. */
	candidateCount: number;
	/** Held at all — including by a clock that reopens on its own. */
	waiting: boolean;
	/**
	 * Held by something that does NOT clear itself: a person, another deploy,
	 * or a rule we cannot attribute. This is the RED predicate, and it is
	 * `blockingStory`'s own `!selfClearing` so a node and the banner on the
	 * page it links to cannot disagree.
	 */
	blocked: boolean;
	/** Gates holding it that are not edges. Clocks, checks, approvals, pins. */
	holds: NodeHold[];
};

export type EdgeKind = 'tier' | 'wave' | 'follow';

/** ONE GATE, between two rollouts. */
export type GraphEdge = {
	key: string;
	/** Node id of the rollout that must move first. */
	from: string;
	/** Node id of the rollout the gate sits on. */
	to: string;
	writer: EdgeWriter;
	/** The `RolloutGate` object name. */
	gate: string;
	state: EdgeState;
	/** `contract` only — the contract name, e.g. `api`. */
	contract: string | null;
	/** `contract` only — what the held candidates ask of it, when they agree. */
	requiredVersion: string | null;
	/** `contract` only — the version the provider has deployed here. */
	providedVersion: string | null;
	/**
	 * `promotion` only — how the version crosses this edge: `tier` (from the
	 * previous tier), `wave` (from the previous wave of the same tier) or
	 * `follow` (a follower takes its wave leader's pick). Null on a contract edge.
	 */
	edgeKind: EdgeKind | null;
	/** The controller's own sentence, for a tooltip. Never rendered as prose. */
	message: string;
	/** True when this edge closes a cycle. Drawn, never hidden. */
	cyclic: boolean;
	/**
	 * Display versions of the gated rollout's (`to`) builds this edge is
	 * holding, newest first. Empty unless `state === 'blocked'`. Decided HERE,
	 * once, so `/dependencies` and the rollout Dependencies tab cannot draw
	 * one edge in two states — see the edge-state loop in `buildRolloutGraph`.
	 */
	held: string[];
};

export type RolloutGraph = {
	nodes: GraphNode[];
	edges: GraphEdge[];
	/** Every environment the graph touches, in promotion order. The columns. */
	envs: string[];
	blockedEdges: GraphEdge[];
	hasCycle: boolean;
	/**
	 * Rollouts in the payload that no gate keys to another rollout. They are
	 * NOT nodes — a fleet of floating boxes is not a graph — but the count is
	 * printed, because a page that silently drops rollouts is a page that
	 * cannot be trusted about the ones it kept.
	 */
	unlinkedRollouts: number;
};

export const EMPTY_GRAPH: RolloutGraph = {
	nodes: [],
	edges: [],
	envs: [],
	blockedEdges: [],
	hasCycle: false,
	unlinkedRollouts: 0
};

export function nodeId(cluster: string, namespace: string, name: string): string {
	return `${cluster}/${namespace}/${name}`;
}

// =========================================================================
// BUILDING THE GRAPH
// =========================================================================

function clusterOf(obj: { metadata?: { annotations?: Record<string, string> | null } }): string {
	return obj?.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? '';
}

/**
 * Every (cluster, namespace) pair a set of rollouts actually touches, keyed by
 * cluster. What `withNetworkSchedules` needs to know which namespaces on a
 * given cluster's bulk `/api/schedules?namespace=all` response are actually
 * relevant to THIS graph, and which cluster-scoped schedules to fan out to
 * them — see that function's own comment for why this is not simply "every
 * namespace on the response".
 */
export function namespacesByCluster(rollouts: Rollout[]): Map<string, Set<string>> {
	const map = new Map<string, Set<string>>();
	for (const r of rollouts) {
		const ns = r?.metadata?.namespace;
		if (!ns) continue;
		const cluster = clusterOf(r);
		let set = map.get(cluster);
		if (!set) {
			set = new Set();
			map.set(cluster, set);
		}
		set.add(ns);
	}
	return map;
}

function displayBuild(r: Rollout | undefined): string | null {
	const v = r?.status?.history?.[0]?.version;
	if (!v) return null;
	return v.version || v.revision || v.tag || null;
}

/** The one value a set agrees on, or null when it does not agree (or is empty). */
/**
 * Per contract edge: each held DISPLAY version -> the requirement its own
 * build asks of the provider (`blockedReleases[].requiredVersion`). The
 * edge's `requiredVersion` is the value the held builds AGREE on and is null
 * when they disagree (4.43.0-43 needs ~2.9.0, 4.44.0-44 ^3.0.0), but a
 * `ContractHold` is always about ONE build, so `contractHoldsIndex` reads
 * that build's own requirement here (fix7 C: the Overview newer-builds row
 * read "Needs payments-svc · has 2.4.1" with no range). A side table, not a
 * `GraphEdge` field, so no other reader of the edge changes.
 */
const requiredByHeld = new WeakMap<GraphEdge, Map<string, string>>();

function agreed<T>(values: (T | null | undefined)[]): T | null {
	const set = new Set(values.filter((v) => v !== null && v !== undefined) as T[]);
	return set.size === 1 ? [...set][0] : null;
}

/**
 * ⭐ THE SCHEDULE JOIN, FOR A GRAPH OF MANY ROLLOUTS. (2026-09-03,
 * operator-walk finding B1 — "the dependency graph node prints `A check is
 * not passing` for a SCHEDULE gate.")
 *
 * `/dependencies` and the rollout `Dependencies` tab both built their
 * `GateContext` with `buildGateContext` alone, so `ctx.schedule` was always
 * empty and every `RolloutSchedule`-owned gate fell through `classifyGate`
 * to its LAST, most pessimistic branch — `clears: 'check'`, `short: 'A check
 * is not passing'` — the exact wording reserved for a gate that is not
 * passing and publishes no window, printed instead on a gate that names its
 * window and the exact minute it reopens. The rollout's own Overview
 * (`ScheduleStatus`, which DOES call `withSchedules`) said the true thing
 * four clicks away: `Business Hours Only — reopens 1:00 PM`.
 *
 * `fetchNetworkSchedules` (`$lib/api/schedules`) is the one bulk request per
 * CLUSTER this needs (`GET /api/schedules?namespace=all`) — not one request
 * per rollout, which is the `/schedules` storm this product has already paid
 * for once (see `ScheduleStatus.svelte`'s own history). This function is the
 * pure join: it takes that per-cluster response and folds it into the SAME
 * `GateContext` `buildGateContext` produced, one call to `withSchedules` per
 * namespace so a namespace only ever sees its OWN `RolloutSchedule` objects
 * plus its cluster's cluster-scoped ones — never another cluster's, even
 * when two clusters happen to share a namespace name (`key()` in
 * `blocking-story.ts` is namespace-scoped, not cluster-scoped, which is the
 * existing convention `buildGateContext`'s own dependency/promotion maps
 * already accept).
 *
 * `namespaces`, from `namespacesByCluster`, is what stops a cluster's
 * cluster-scoped schedules leaking onto a namespace that cluster does not
 * actually run — and it is also what lets a namespace with ONLY a
 * cluster-scoped schedule (no `RolloutSchedule` of its own) still get the
 * join: the namespace is seeded with the cluster-wide list before any
 * namespaced schedule is added to it.
 */
export function withNetworkSchedules(
	base: GateContext,
	schedulesByCluster: Map<string, NetworkSchedules>,
	namespaces: Map<string, Set<string>>
): GateContext {
	let ctx = base;
	for (const [cluster, data] of schedulesByCluster) {
		const clusterNamespaces = namespaces.get(cluster);
		if (!clusterNamespaces || clusterNamespaces.size === 0) continue;
		const clusterWide = data?.clusterRolloutSchedules?.items ?? [];
		const byNs = new Map<string, NetworkScheduleObject[]>();
		for (const ns of clusterNamespaces) byNs.set(ns, [...clusterWide]);
		for (const s of data?.rolloutSchedules?.items ?? []) {
			const ns = s?.metadata?.namespace;
			if (!ns || !byNs.has(ns)) continue;
			byNs.get(ns)!.push(s);
		}
		for (const [ns, list] of byNs) {
			// ⭐ NO LONGER SKIPPED WHEN `list` IS EMPTY. (2026-09-04, load-state
			// audit finding 4) `withSchedules` is the only place
			// `GateContext.schedulesLoaded` flips to `true`, and it is what
			// tells `classifyGate`'s `check` fallback apart from a gate whose
			// schedule join simply has not been asked for yet (see that
			// field's own doc comment). A namespace with genuinely ZERO
			// `RolloutSchedule`/`ClusterRolloutSchedule` objects still needs
			// that flip — this loop had already resolved the query and knows
			// the true answer is "none" for this namespace, which is exactly
			// the fact `schedulesLoaded` exists to carry. Skipping the call
			// here was a no-op for `ctx.schedule` (an empty list adds no
			// entries either way) but silently left every `check`-classified
			// gate in that namespace `pending` forever.
			ctx = withSchedules(ctx, ns, list);
		}
	}
	return ctx;
}

export type PromotionLink = {
	down: Environment;
	up: Environment;
	gate: string;
	edgeKind: EdgeKind;
};

/**
 * EVERY PROMOTION EDGE THE ENVIRONMENTS DECLARE — `down` waits on `up`
 * through `gate`. The one place that decides what counts as a promotion
 * edge: `buildRolloutGraph` draws exactly these, and `hasDependencyLinks`
 * (the rollout tab's `show:` predicate) counts exactly these, so the tab
 * cannot appear for a rollout whose graph is empty or hide for one whose
 * graph is not.
 *
 * The edges come from the app's TOPOLOGY (`sites-waves.ts`), not from a
 * per-Environment field: a follower waits on its wave leader, a wave-N leader
 * on every live site of the previous wave, a wave-1 leader on every live site
 * of the nearest earlier tier. There is ONE EDGE PER VISIBLE UPSTREAM SITE —
 * the old model could only point at one Environment per tier, which silently
 * dropped every region of a multi-site tier but one.
 *
 * `Environment.spec.name` is the GitHub deployment name and it is
 * REPO-GLOBAL: the same value identifies dev, staging and prod of one
 * service line. It is therefore the join key (`deployNameOf`), and it must
 * NOT be cluster-scoped — on the live fleet dev and staging are on the spoke
 * and prod is on the hub, so a cluster-scoped join loses the staging → prod
 * edge, which is the most important edge on the page.
 */
export function promotionLinks(environments: Environment[]): PromotionLink[] {
	const topologies = buildTopology(environments);
	const out: PromotionLink[] = [];
	for (const e of environments) {
		const gate = e.status?.rolloutGateRef?.name;
		if (!e.metadata?.namespace || !e.spec?.rolloutRef?.name || !e.spec?.environment) continue;
		if (!gate) continue;
		const topo = topologies.get(deployNameOf(e));
		const node = siteNodeOf(topo, e);
		if (!topo || !node || node.env !== e) continue;
		const ups = upstreamOf(topo, node);
		const edgeKind: EdgeKind = !node.isLeader ? 'follow' : ups[0]?.tier === node.tier ? 'wave' : 'tier';
		for (const u of ups) {
			const up = u.env;
			// ⛔ NO PHANTOM SOURCE. An upstream site this dashboard cannot see
			// (another cluster's, known only from `status.wave.members`) has no
			// far end to draw to. The gate still holds the rollout, so it falls
			// through to the node's `holds` via `classifyGate`, which says
			// `after staging` in words.
			if (!up || !up.metadata?.namespace || !up.spec?.rolloutRef?.name) continue;
			out.push({ down: e, up, gate, edgeKind });
		}
	}
	return out;
}

/**
 * ⭐ DOES THIS ROLLOUT HAVE A DEPENDENCIES TAB — i.e. at least one edge in
 * the dependency graph, at either end. (2026-10-05.)
 *
 * The rollout layout used to ask `environment.status.environmentInfos` (a
 * mirror the controller may leave empty) or a `RolloutDependency` naming the
 * rollout. `hello-world` in dev is bound to three `Environment`s with real
 * promotion gates — staging and prod are held on it — and still had no tab,
 * because neither of those two sources carried that fact. The `Environment`
 * objects on the list payload do, and they are what the graph itself reads.
 *
 * ⛔ THE SAME EDGE RULE AS `buildRolloutGraph`, OR THE TAB OPENS ON NOTHING.
 * (2026-10-07.) A `RolloutDependency` with no `status.gateName` is not an
 * edge there — the controller has not created its gate yet — so it is not
 * one here either; counting it showed a tab whose graph was empty.
 *
 * Matched on cluster too, through `onCluster`: the same (namespace, name)
 * exists on more than one cluster behind a hub. An unstamped (hub-local)
 * object is on `localCluster` when known, else on the route's cluster — the
 * same rule the graph's links use.
 */
export function hasDependencyLinks(args: {
	cluster?: string;
	localCluster?: string;
	namespace: string;
	name: string;
	environments: Environment[];
	dependencies: RolloutDependency[];
}): boolean {
	const { namespace, name } = args;
	const here = (obj: { metadata?: { annotations?: Record<string, string> | null } }) =>
		args.cluster === undefined || onCluster(clusterOf(obj), args.cluster, args.localCluster);
	const isMe = (ns: string | undefined, n: string | undefined) => ns === namespace && n === name;
	for (const d of args.dependencies) {
		const ns = d.metadata?.namespace;
		if (!ns || !d.status?.gateName || !d.spec?.rolloutRef?.name || !d.spec?.providerRef?.name)
			continue;
		if (!here(d)) continue;
		if (isMe(ns, d.spec.rolloutRef.name)) return true;
		if (isMe(d.spec.providerRef.namespace || ns, d.spec.providerRef.name)) return true;
	}
	for (const { down, up } of promotionLinks(args.environments)) {
		if (here(down) && isMe(down.metadata?.namespace, down.spec?.rolloutRef?.name)) return true;
		if (here(up) && isMe(up.metadata?.namespace, up.spec?.rolloutRef?.name)) return true;
	}
	return false;
}

/**
 * Is a node stamped `nodeCluster` on the route's cluster? A hub-local object
 * carries no stamp (`''`): it is on `localCluster` when that is known, and on
 * the route's cluster otherwise — the rule every graph link already uses
 * (`n.cluster || cluster`), so the node a link points at is the node the
 * page it opens finds.
 */
export function onCluster(nodeCluster: string, routeCluster: string, localCluster?: string): boolean {
	return (nodeCluster || localCluster || routeCluster) === routeCluster;
}

export function buildRolloutGraph(args: {
	rollouts: Rollout[];
	environments: Environment[];
	dependencies: RolloutDependency[];
	/** Promotion order of the fleet's environments, upstream first. */
	envOrder: string[];
	/**
	 * The join table `blocking-story` builds from the SAME payload. It is what
	 * classifies a node's leftover gates — clock, check, approval, unknown —
	 * and it is passed in rather than rebuilt so the graph and every banner in
	 * the product classify one gate the same way.
	 */
	gates?: GateContext;
	/**
	 * ⭐ A ROLLOUT THAT IS ALWAYS A NODE, EDGES OR NOT. (2026-10-08, the
	 * rollout Gates tab.) The tab draws every gate on one rollout — a deploy
	 * window, an approval — and a rollout whose only gates are those has no
	 * edge, so without this it was not in the graph and its node `holds`
	 * (classified here, by the same `blockingStory` every banner reads) did
	 * not exist. Matched like `rolloutNeighbourhood`'s focus: namespace + name
	 * + `onCluster`. Not counted in `unlinkedRollouts`, because it is drawn.
	 */
	focus?: { cluster: string; namespace: string; name: string; localCluster?: string };
}): RolloutGraph {
	const { rollouts, environments, dependencies, envOrder } = args;
	const ctx = args.gates ?? EMPTY_GATE_CONTEXT;
	const envRank = new Map(envOrder.map((e, i) => [e, i] as const));
	const rankOfEnv = (e: string) => envRank.get(e) ?? 900 + envOrder.length;

	// ── the rollout index, cluster-scoped ────────────────────────────────
	// `hello-api-app` exists in three namespaces across two clusters, so
	// anything less than (cluster, namespace, name) matches the wrong object.
	const rolloutById = new Map<string, Rollout>();
	for (const r of rollouts) {
		const ns = r.metadata?.namespace;
		const name = r.metadata?.name;
		if (!ns || !name) continue;
		rolloutById.set(nodeId(clusterOf(r), ns, name), r);
	}

	// ── namespace → environment tier ─────────────────────────────────────
	// Read off the `Environment` objects, never off the namespace's NAME:
	// `hello-dep-prod` happens to end in the tier word and nothing guarantees
	// it.
	const tierOfNs = new Map<string, string>();
	for (const e of environments) {
		const ns = e.metadata?.namespace;
		const tier = e.spec?.environment;
		// The PLACE, not the raw tier: `prod-eu-west-1` once the tier has several
		// live sites, `prod` while it has one (`placeKey`).
		if (ns && tier) tierOfNs.set(`${clusterOf(e)}/${ns}`, placeKeyOf(e, environments));
	}
	const envOfNs = (cluster: string, ns: string) => tierOfNs.get(`${cluster}/${ns}`) ?? ns;

	const nodes = new Map<string, GraphNode>();
	const node = (cluster: string, namespace: string, name: string, env?: string): GraphNode => {
		const id = nodeId(cluster, namespace, name);
		let n = nodes.get(id);
		if (!n) {
			const r = rolloutById.get(id);
			n = {
				id,
				cluster,
				namespace,
				name,
				// ⛔ `||`, NOT `??`. A caller passing an EMPTY environment name —
				// an `Environment` whose `spec.environment` is `''` — slipped
				// straight through `??` and became a node labelled with nothing,
				// which `DependencyNode` drew as a bordered box with no text in
				// it. Nullish-coalescing is the wrong operator for a field whose
				// empty value is as meaningless as its absence.
				env: env || envOfNs(cluster, namespace),
				envRank: 0,
				unresolved: !r,
				build: displayBuild(r),
				candidateCount: 0,
				waiting: false,
				blocked: false,
				holds: []
			};
			n.envRank = rankOfEnv(n.env);
			nodes.set(id, n);
		}
		return n;
	};

	const edges: GraphEdge[] = [];
	/** The `RolloutDependency` behind each contract edge, by edge key. */
	const depOfEdge = new Map<string, RolloutDependency>();

	// ── PROMOTION EDGES ──────────────────────────────────────────────────
	// Which edges exist is `promotionLinks`' decision (see its doc); this
	// loop only turns them into nodes and edges.
	const seenPromotionKey = new Set<string>();
	for (const { down: e, up, gate, edgeKind } of promotionLinks(environments)) {
		const ns = e.metadata!.namespace!;
		const target = e.spec!.rolloutRef!.name!;
		const upNs = up.metadata!.namespace!;
		const upName = up.spec!.rolloutRef!.name!;

		const to = node(clusterOf(e), ns, target, placeKeyOf(e, environments));
		const from = node(clusterOf(up), upNs, upName, placeKeyOf(up, environments));
		if (from.id === to.id) continue;
		// One gate, several upstream sites: the first edge keeps the historical
		// key, the others are told apart by their far end.
		const baseKey = `promotion:${to.id}:${gate}`;
		const key = seenPromotionKey.has(baseKey) ? `${baseKey}:${from.id}` : baseKey;
		seenPromotionKey.add(baseKey);
		edges.push({
			key,
			from: from.id,
			to: to.id,
			writer: 'promotion',
			gate,
			state: 'unknown',
			contract: null,
			requiredVersion: null,
			providedVersion: null,
			edgeKind,
			message: '',
			cyclic: false,
			held: []
		});
	}

	// ── CONTRACT EDGES ───────────────────────────────────────────────────
	//
	// A `RolloutDependency`, its consumer and its provider are always in ONE
	// namespace on ONE cluster, so this edge is already environment-scoped.
	// That is exactly what lets it be an edge between two nodes rather than a
	// property of a service.
	for (const dep of dependencies) {
		const ns = dep.metadata?.namespace;
		const consumer = dep.spec?.rolloutRef?.name;
		const provider = dep.spec?.providerRef?.name;
		const gate = dep.status?.gateName;
		if (!ns || !consumer || !provider || !gate) continue;
		const cluster = clusterOf(dep);
		const to = node(cluster, ns, consumer);
		const from = node(cluster, dep.spec?.providerRef?.namespace || ns, provider);
		const blocked = dep.status?.blockedReleases ?? [];
		const satisfied = (dep.status?.conditions ?? []).find((c) => c?.type === 'Satisfied');
		const key = `contract:${to.id}:${gate}`;
		depOfEdge.set(key, dep);
		edges.push({
			key,
			from: from.id,
			to: to.id,
			writer: 'contract',
			gate,
			state: 'unknown',
			contract: dep.spec?.contract || provider,
			requiredVersion: agreed(blocked.map((b) => b.requiredVersion ?? null)),
			providedVersion: dep.status?.providedVersion ?? null,
			edgeKind: null,
			message: satisfied?.message ?? '',
			cyclic: false,
			held: []
		});
	}

	// ── THE FOCUS, EVEN WITH NO EDGE ─────────────────────────────────────
	if (args.focus) {
		const f = args.focus;
		for (const r of rollouts) {
			if (
				r.metadata?.namespace === f.namespace &&
				r.metadata?.name === f.name &&
				onCluster(clusterOf(r), f.cluster, f.localCluster)
			) {
				node(clusterOf(r), f.namespace, f.name);
				break;
			}
		}
	}

	// ── EDGE STATE, ONE PREDICATE FOR BOTH KINDS ─────────────────────────
	const blockPerNode = new Map<string, ReturnType<typeof promotionBlock>>();
	const gateNamesPerNode = new Map<string, Set<string>>();
	for (const n of nodes.values()) {
		const r = rolloutById.get(n.id);
		if (!r) continue;
		blockPerNode.set(n.id, promotionBlock(r));
		gateNamesPerNode.set(
			n.id,
			new Set((r.status?.gates ?? []).map((g) => g?.name).filter(Boolean) as string[])
		);
	}
	const display = (cs: ReleaseRef[]) => [
		...new Set(
			cs.map((c) => getDisplayVersion(c as { version?: string; revision?: string; tag: string }))
		)
	];
	/** `requiredByHeld` for a contract edge: each held candidate's own requirement, by display version. */
	const recordRequired = (e: GraphEdge, cs: ReleaseRef[]) => {
		const dep = e.writer === 'contract' ? depOfEdge.get(e.key) : undefined;
		if (!dep) return;
		const byTag = new Map(
			(dep.status?.blockedReleases ?? [])
				.filter((b) => b?.tag && b.requiredVersion)
				.map((b) => [b.tag, b.requiredVersion as string] as const)
		);
		const m = new Map<string, string>();
		for (const c of cs) {
			const req = c.tag ? byTag.get(c.tag) : undefined;
			if (req) m.set(getDisplayVersion(c as { version?: string; revision?: string; tag: string }), req);
		}
		if (m.size) requiredByHeld.set(e, m);
	};
	for (const e of edges) {
		const block = blockPerNode.get(e.to);
		const seen = gateNamesPerNode.get(e.to);
		const gated = rolloutById.get(e.to);
		if (!block || !seen) {
			e.state = 'unknown'; // the gated rollout is not in this payload
		} else if (block.blockingGates.includes(e.gate)) {
			e.state = 'blocked';
			const heldCs = candidatesHeldByGate(gated, e.gate);
			e.held = display(heldCs);
			recordRequired(e, heldCs);
		} else if (seen.has(e.gate)) {
			e.state = 'clear';
		} else {
			// The CRD names a gate the rollout has not published a summary for.
			// For a PROMOTION edge that is an unread instrument: `unknown`, never
			// health.
			//
			// ⭐ FOR A CONTRACT EDGE THE SAME CONTROLLER HAS ALREADY ANSWERED, ONE
			// OBJECT OVER. (2026-10-07, moved here from `rollout-neighbourhood`
			// so this page and the rollout tab decide the edge ONCE.) The
			// `RolloutDependency` reconciler writes the verdict it publishes to
			// the gate onto its own status: `blockedReleases` is the list of
			// consumer candidates it is refusing (each with the constraint that
			// refuses it), and `Satisfied` is its statement that nothing the
			// consumer could deploy next is held (rolloutdependency_types.go).
			// Both are observations the controller made, not inferences — so:
			//   - a refused tag the consumer could actually take next → blocked,
			//     and those are the builds this edge holds;
			//   - `Satisfied=True` → clear (refused tags the rollout is already
			//     past are history, not a hold);
			//   - anything else → still `unknown`.
			e.state = 'unknown';
			const dep = e.writer === 'contract' ? depOfEdge.get(e.key) : undefined;
			if (dep) {
				const refused = new Set(
					(dep.status?.blockedReleases ?? []).map((b) => b?.tag).filter(Boolean)
				);
				const wanted = promotionCandidates(gated).filter((c) => c.tag && refused.has(c.tag));
				const satisfied = (dep.status?.conditions ?? []).find((c) => c?.type === 'Satisfied');
				if (wanted.length > 0) {
					e.state = 'blocked';
					e.held = display(wanted);
					recordRequired(e, wanted);
				} else if (satisfied?.status === 'True') {
					e.state = 'clear';
				}
			}
		}
	}

	// ── NODE STATE, AND THE GATES THAT ARE NOT EDGES ─────────────────────
	const inboundGates = new Map<string, Set<string>>();
	for (const e of edges) {
		let s = inboundGates.get(e.to);
		if (!s) inboundGates.set(e.to, (s = new Set()));
		s.add(e.gate);
	}
	/**
	 * ⭐ THE HOLD-ONE-RULE, FOR EVERY NODE THIS GRAPH DRAWS. (2026-10-09,
	 * coordinator ruling.) `node.blocked`/`node.waiting` below feed `/apps`'
	 * fleet tiles, Home's `isNeedsYou` (`fleet-groups.ts`) and every other
	 * reader of a `GraphNode` — so if THIS read stayed gate-only, every one
	 * of them would still miss a contract hold the controller never
	 * published on `rollout.status.gates`, no matter how many call sites
	 * learn to pass `contractHolds` of their own.
	 *
	 * ⭐ NO LONGER A HAND-ROLLED SECOND LOOP OVER `edges`. (2026-10-10, QA
	 * finding.) This used to fold every `contract`/`blocked` edge into its
	 * own `Map<string, ContractHold>` with `Map.set` — so a build held by
	 * TWO contracts at once (`payments-svc` and `auth` both refusing the
	 * same consumer version) silently kept only whichever edge this loop
	 * visited last, and the banner named one provider instead of both. That
	 * logic now lives in exactly one place, `contractHoldsIndex`.
	 *
	 * ⭐ CALLED ONCE, NOT ONCE PER NODE. (2026-10-10, QA finding — perf.) The
	 * fix above first called `contractHoldsForRollout` from INSIDE this loop
	 * — once per node — and that adapter filters the WHOLE edge list on
	 * every call, so a fleet's own `buildRolloutGraph` call was
	 * O(nodes × edges) just for this step. `contractHoldsIndex` builds every
	 * node's hold map in ONE scan of `edges`, done ONCE here, before the
	 * loop; each node then does an O(1) `Map.get` by its own id.
	 * `contractHoldsForRollout` (below, the adapter other pages call once
	 * per `Rollout`) reads off the exact same index, so the two can never
	 * disagree about which edges count.
	 */
	const holdsIndex = contractHoldsIndex({ nodes: [...nodes.values()], edges });
	for (const n of nodes.values()) {
		const r = rolloutById.get(n.id);
		if (!r) continue;
		const contractHolds = holdsIndex.get(n.id);
		const story = blockingStory(r, ctx, { place: n.env, contractHolds });
		n.candidateCount = story.candidateCount;
		n.waiting = story.blocked;
		n.blocked = story.blocked && !story.selfClearing;
		const drawn = inboundGates.get(n.id) ?? new Set<string>();
		n.holds = story.gates
			// ⛔ A SYNTHETIC CONTRACT GATE (`id` starting `contract:` —
			// `classifyContractHold`'s own convention, `blocking-story.ts`) is
			// NEVER "a gate that is not an edge" here: `contractHoldsByNode`
			// above is built directly off THIS function's own `contract`/
			// `blocked` edges, so every one of these synthetic entries always
			// has a matching edge already drawn. Without this, the SAME
			// contract hold drew twice — once as the edge, once as a
			// `holds` entry with no `RolloutGate` object behind it — on
			// `checkout-api/staging`'s own Gates tab (`deps-story.test.ts`).
			.filter((g) => !drawn.has(g.id) && !g.id.startsWith('contract:'))
			.map((g) => ({
				gate: g.id,
				clears: g.clears,
				short: g.short,
				clearsAt: g.clearsAt,
				pending: g.pending
			}));
		// A PIN IS NOT A GATE AND IT OUTRANKS EVERY GATE. `blockingStory`
		// short-circuits on `spec.wantedVersion` and returns no gates at all, so
		// without this the node would render red with nothing on it saying why.
		if (story.pinnedTo) {
			// ⭐ THE RAW OCI TAG NEVER PRINTS. `displayVersionForTag` is the one
			// lookup the product uses everywhere else (`/apps`, rollout detail)
			// to turn a 60-char tag like `main-1788002370-0afab6f…` into the
			// short sha every other surface names the build by (`0afab6f`). A
			// bare `story.pinnedTo` here was the one place that shortener was
			// skipped, so the node printed the tag in full.
			n.holds = [
				{
					gate: story.pinnedTo,
					clears: 'person',
					short: `Pinned to ${displayVersionForTag(r, story.pinnedTo)}`,
					clearsAt: null
				}
			];
		}
	}

	markCycles(edges);

	// Deterministic ordering, so two loads of one fleet read identically.
	edges.sort(
		(a, b) =>
			a.writer.localeCompare(b.writer) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)
	);
	const nodeList = [...nodes.values()].sort(
		(a, b) => a.name.localeCompare(b.name) || a.envRank - b.envRank || a.env.localeCompare(b.env)
	);

	const envsSeen = new Set(nodeList.map((n) => n.env));
	const envs = envOrder
		.filter((e) => envsSeen.has(e))
		.concat([...envsSeen].filter((e) => !envRank.has(e)).sort());

	const linked = new Set(nodeList.map((n) => n.id));
	const unlinkedRollouts = [...rolloutById.keys()].filter((id) => !linked.has(id)).length;

	return {
		nodes: nodeList,
		edges,
		envs,
		blockedEdges: edges.filter((e) => e.state === 'blocked'),
		hasCycle: edges.some((e) => e.cyclic),
		unlinkedRollouts
	};
}

/**
 * Mark back edges with a colour DFS, so the ordering below sees a DAG.
 *
 * ⛔ DO NOT ASSUME ACYCLIC. Nothing forbids `a → b → a` across the two
 * writers — a contract edge one way and a promotion edge the other would
 * simply deadlock both — so a cycle must RENDER, not crash and not vanish.
 *
 * Iterative, because a deep chain must not blow the stack, and deterministic:
 * roots and out-edges are both visited in sorted order, so the SAME edge of a
 * cycle is chosen as the back edge on every load. A cycle that moved every
 * refresh would be unreadable.
 */
function markCycles(edges: GraphEdge[]): void {
	const out = new Map<string, GraphEdge[]>();
	const ids = new Set<string>();
	for (const e of [...edges].sort((a, b) => a.key.localeCompare(b.key))) {
		ids.add(e.from);
		ids.add(e.to);
		const list = out.get(e.from);
		if (list) list.push(e);
		else out.set(e.from, [e]);
	}
	const WHITE = 0,
		GRAY = 1,
		BLACK = 2;
	const colour = new Map<string, number>();
	for (const id of ids) colour.set(id, WHITE);

	for (const root of [...ids].sort()) {
		if (colour.get(root) !== WHITE) continue;
		const stack: [string, number][] = [[root, 0]];
		colour.set(root, GRAY);
		while (stack.length > 0) {
			const frame = stack[stack.length - 1];
			const list = out.get(frame[0]) ?? [];
			if (frame[1] >= list.length) {
				colour.set(frame[0], BLACK);
				stack.pop();
				continue;
			}
			const edge = list[frame[1]++];
			const c = colour.get(edge.to);
			if (c === GRAY) {
				edge.cyclic = true; // back edge, including the self-loop `a → a`
			} else if (c === WHITE) {
				colour.set(edge.to, GRAY);
				stack.push([edge.to, 0]);
			}
		}
	}
}

/**
 * ⭐ THE CONTRACT HOLD SET FOR ONE ROLLOUT, OFF THIS GRAPH — AND NOTHING
 * ELSE. (2026-10-09, integration round 4 — follow-up to the U-5 fix in
 * `change-version-held-agreement.test.ts`.)
 *
 * Rollout detail's `holdEdgesIn` (that page's own `+page.svelte`) answered
 * exactly this question inline — inbound edges on `providerFocusId` whose
 * `writer` is `contract` and whose `state` is `blocked`, flattened to the
 * DISPLAY-VERSION set `e.held` already carries — and handed the result to
 * `ChangeVersionModal` as a `contractHeldVersions` prop. Every OTHER call
 * site of that dialog (history, `/envs/<name>`, `/apps/<name>`,
 * `FailurePanel`) never built that graph at all, so the prop silently
 * defaulted to empty and `checkout-api`/`prod-us-east-2`'s `4.43.0-43` read
 * plain `Ready` from every entry point except the one that happened to pass
 * the prop. Pulling the one-line filter out to here — rather than teaching
 * four more route files to build the graph by hand — is what lets the dialog
 * compute its OWN answer from the SAME shared `/api/rollouts` payload
 * (`buildRolloutGraph`), so it cannot drift from whatever rollout detail
 * passes as an override.
 */
export function contractHeldVersionsFor(graph: RolloutGraph, focusId: string): Set<string> {
	const held = graph.edges.filter(
		(e) => e.to === focusId && e.writer === 'contract' && e.state === 'blocked'
	);
	return new Set(held.flatMap((e) => e.held));
}

/**
 * ⭐ ONE PASS OVER THE EDGES, EVERY NODE'S CONTRACT HOLDS AT ONCE. (2026-10-10,
 * QA finding — perf.) The join `contractHoldsForRollout` answers (below) —
 * "every `ContractHold` on each DISPLAY version a node's inbound `contract`/
 * `blocked` edges carry" — used to be re-derived by filtering the WHOLE edge
 * list on every call. `buildRolloutGraph` called that adapter once PER NODE,
 * which made ONE `buildRolloutGraph` call O(nodes × edges) for this step
 * alone on a fleet whose node and edge counts both grow with it.
 *
 * This builds the index for EVERY node in a single scan of `edges` —
 * `nodeId -> (display version -> every ContractHold on it)` — so
 * `buildRolloutGraph` can call it ONCE and look its own nodes up by id in
 * O(1), and `contractHoldsForRollout` reads off the exact same index for the
 * one node it resolves, so the two can never disagree about which edges
 * count. Takes `nodes`/`edges` rather than a full `RolloutGraph` because that
 * is all either caller has settled at the point it calls this — a
 * `buildRolloutGraph` in progress has not yet computed `envs`/`blockedEdges`/
 * `hasCycle`/`unlinkedRollouts`, and this never reads them.
 */
function contractHoldsIndex(graph: {
	nodes: readonly GraphNode[];
	edges: readonly GraphEdge[];
}): Map<string, Map<string, ContractHold[]>> {
	const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
	const index = new Map<string, Map<string, ContractHold[]>>();
	for (const e of graph.edges) {
		if (e.writer !== 'contract' || e.state !== 'blocked') continue;
		let holdsForNode = index.get(e.to);
		if (!holdsForNode) index.set(e.to, (holdsForNode = new Map()));
		const provider = byId.get(e.from)?.name ?? 'another service';
		const own = requiredByHeld.get(e);
		for (const v of e.held) {
			// the build's own requirement; the edge's agreed one only when it has none recorded
			const hold: ContractHold = {
				provider,
				required: own?.get(v) ?? e.requiredVersion ?? undefined,
				has: e.providedVersion ?? undefined,
				gate: e.gate || undefined
			};
			const list = holdsForNode.get(v);
			if (list) list.push(hold);
			else holdsForNode.set(v, [hold]);
		}
	}
	return index;
}

/**
 * ⭐ THE SAME CONTRACT HOLD SET, WITH ENOUGH SHAPE TO NAME IT. (2026-10-09,
 * coordinator ruling — design-rollout TL.) `contractHeldVersionsFor` above
 * answers "is this candidate held", a bare display-version set with no
 * provider or range attached — exactly what `ChangeVersionModal`'s row
 * glyphs need and nothing more. `blockingStory`'s hold-one-rule needs the
 * OTHER half too: WHO holds it and WHAT they need, so the banner can say
 * "Needs payments-svc ~2.9.0" instead of a bare chip.
 *
 * Built off the exact same inbound `contract`/`blocked` edges, into every
 * `ContractHold` on each DISPLAY version (`GraphEdge.held`'s own form, and
 * the same key `promotionHoldBreakdown`'s `build` field uses) — `provider`
 * is the OTHER rollout's own name, read off the edge's `from` node (never
 * the `RolloutDependency` object's own name, which is an implementation
 * detail no reader has ever seen); `required`/`has` are the edge's own
 * `requiredVersion`/`providedVersion`, undefined exactly when the edge
 * itself does not carry one.
 *
 * ⭐ A LIST, NOT THE LAST ONE WRITTEN. (2026-10-10, QA finding.) Two
 * `RolloutDependency` edges can both refuse the SAME consumer version —
 * `payments-svc` and `auth` each holding `4.43.0-43` back — and a map keyed
 * on a bare `ContractHold` kept only whichever edge this loop visited last.
 * The value is the full list of holds on that version instead, so a caller
 * that needs "who, of possibly several" never has to re-walk the graph.
 *
 * The node lookup mirrors `app-tasks.ts`'s `graphNodeForRollout` (namespace +
 * name, broken by `cluster` only on a genuine tie) rather than importing it —
 * `app-tasks.ts` already imports FROM this module, and importing it back
 * would be the same cycle `promotion.ts`'s own top comment warns this file's
 * sibling away from. Any caller holding a `GraphNode` already (the Overview
 * page, which built `providerNetwork` for other reasons) should read
 * `contractHeldVersionsFor`-style edges directly rather than re-deriving a
 * node id here — this is for callers that only have the `Rollout` object.
 *
 * Reads off `contractHoldsIndex`, the ONE place this join is computed — see
 * its own doc for why `buildRolloutGraph` no longer calls this adapter from
 * inside its per-node loop.
 */
export function contractHoldsForRollout(
	graph: RolloutGraph,
	rollout: Rollout,
	namespace: string | undefined = rollout.metadata?.namespace,
	cluster?: string
): Map<string, ContractHold[]> {
	const name = rollout.metadata?.name;
	const candidates = graph.nodes.filter((n) => n.namespace === namespace && n.name === name);
	const node =
		candidates.length < 2
			? candidates[0] ?? null
			: (candidates.find((n) => n.cluster === (clusterOf(rollout) || (cluster ?? ''))) ??
				candidates[0]);
	if (!node) return new Map();

	return contractHoldsIndex(graph).get(node.id) ?? new Map();
}

// =========================================================================
// FILTER AND FOCUS
// =========================================================================

/**
 * ⭐ THE ENV CHIPS FILTER WHICH COLUMNS RENDER — NOT WHICH EDGES EXIST.
 *
 * A node IS a (service, environment), so selecting `prod` drops every node
 * that is not in prod, and with it every edge that had an end there. A
 * promotion edge into prod from staging therefore disappears when staging is
 * hidden, which is correct: the column it came from is not on screen, and an
 * arrow from nowhere is worse than no arrow.
 *
 * An empty selection means EVERY environment. Same multi-select convention as
 * `/rollouts` — no `All` pill, no dropdown.
 */
export function filterByEnv(graph: RolloutGraph, envs: string[]): RolloutGraph {
	if (envs.length === 0) return graph;
	const want = new Set(envs);
	const nodes = graph.nodes.filter((n) => want.has(n.env));
	const keep = new Set(nodes.map((n) => n.id));
	const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
	return {
		...graph,
		nodes,
		edges,
		blockedEdges: edges.filter((e) => e.state === 'blocked'),
		hasCycle: edges.some((e) => e.cyclic)
	};
}

/**
 * The subgraph around `focus`: its OWN promotion line in full, plus `depth`
 * hops of contract neighbours from every rollout on that line.
 *
 * This is what the rollout tab renders: THE SAME GRAPH LANGUAGE at one node's
 * scale, so the fleet page and the tab are one idea at two scales rather than
 * two designs. Returns an empty graph when `focus` is not in the network at
 * all.
 *
 * ⭐ THE TWO AXES DO NOT SHARE ONE HOP COUNT, AND THAT WAS A BUG. (2026-09-02,
 * from a live disagreement: the rollout tab for `hello-frontend-app` in prod
 * headlined *"3 of 4 blocked"* while its own side panels — built from the
 * unfiltered dependency list — named the SAME held chain in dev, staging AND
 * prod.) The old single hop count walked BOTH edge kinds together, so
 * `neighbourhood(g, feProd, 1)` reached `feStaging` (one promotion hop) and
 * `apiProd` (one contract hop) but not `feDev` — dev is TWO promotion hops
 * from prod on a three-environment line, and the drawing silently dropped a
 * held leg the header then under-counted against.
 *
 * The fix is not a bigger hop count — a fixed depth is always some fleet's
 * counter-example — it is recognising the two axes have different SHAPES:
 *
 *   · the PROMOTION axis is `focus`'s own service, moving through
 *     environments. It is a single line with two ends, so walking it to
 *     completion is bounded by the fleet's own (always small) environment
 *     count — there is no far end to wander off into.
 *   · the CONTRACT axis is *other services*, and walking it unboundedly
 *     really can wander into an unrelated corner of the fleet through a
 *     chain of "A depends on B depends on C". That is what `depth` still
 *     rations, exactly as it did before.
 *
 * Every rollout on the completed promotion line contributes its own contract
 * hop, so a service reached through ANY environment on the line is on the
 * graph — `hello-api-app` needs no direct hit in dev to appear there, because
 * dev is now a touched environment and the rectangle closure below still
 * draws its whole column once any of its rollouts is `keep`.
 */
export function neighbourhood(graph: RolloutGraph, focus: string, depth = 1): RolloutGraph {
	if (!graph.nodes.some((n) => n.id === focus)) return { ...EMPTY_GRAPH, envs: graph.envs };

	// AXIS 1 — `focus`'s own promotion line, walked to both ends. Not hop-
	// limited: see the comment above for why that is safe here and was not
	// safe for the contract axis below.
	const chain = new Set<string>([focus]);
	let chainFrontier = new Set([focus]);
	while (chainFrontier.size > 0) {
		const next = new Set<string>();
		for (const e of graph.edges) {
			if (e.writer !== 'promotion') continue;
			if (chainFrontier.has(e.from) && !chain.has(e.to)) {
				chain.add(e.to);
				next.add(e.to);
			}
			if (chainFrontier.has(e.to) && !chain.has(e.from)) {
				chain.add(e.from);
				next.add(e.from);
			}
		}
		chainFrontier = next;
	}

	// AXIS 2 — from every rollout on that line, `depth` hops of CONTRACT
	// neighbours: the other services it (or its promotion neighbours) ship
	// alongside.
	const keep = new Set(chain);
	let frontier = new Set(chain);
	for (let d = 0; d < depth; d++) {
		const next = new Set<string>();
		for (const e of graph.edges) {
			if (e.writer !== 'contract') continue;
			if (frontier.has(e.from) && !keep.has(e.to)) {
				keep.add(e.to);
				next.add(e.to);
			}
			if (frontier.has(e.to) && !keep.has(e.from)) {
				keep.add(e.from);
				next.add(e.from);
			}
		}
		frontier = next;
		if (frontier.size === 0) break;
	}
	/**
	 * ⭐ THE NEIGHBOURHOOD IS CLOSED INTO A RECTANGLE, and it has to be.
	 *
	 * The hop expansion alone returns a RAGGED set — from `frontend@prod` it
	 * reaches `frontend@staging` (promotion) and `api@prod` (contract), and
	 * `api@prod` is then the only node of its service. It has no promotion edge
	 * inside the subgraph, so nothing tells dagre which rank it belongs in, and
	 * it was drawn in STAGING's column. A column a reader believes is an
	 * environment and is not is the one defect this layout exists to avoid.
	 *
	 * So the subgraph is closed over its own axes: every service it reached ×
	 * every environment it reached. That is the same matrix as the fleet page,
	 * cropped to the rows and columns this rollout is actually in — which is
	 * also why the crop is bounded: the fleet has few environments, and the
	 * hop limit still bounds the services.
	 */
	const services = new Set<string>();
	const envs = new Set<string>();
	for (const n of graph.nodes) {
		if (!keep.has(n.id)) continue;
		services.add(n.name);
		envs.add(n.env);
	}
	const nodes = graph.nodes.filter((n) => services.has(n.name) && envs.has(n.env));
	const rect = new Set(nodes.map((n) => n.id));
	const edges = graph.edges.filter((e) => rect.has(e.from) && rect.has(e.to));
	return {
		nodes,
		edges,
		envs: graph.envs.filter((env) => envs.has(env)),
		blockedEdges: edges.filter((e) => e.state === 'blocked'),
		hasCycle: edges.some((e) => e.cyclic),
		unlinkedRollouts: 0
	};
}

// =========================================================================
// ORDER — the one lever this module keeps on the drawing
// =========================================================================

/**
 * ⭐ THE ORDER NODES ARE HANDED TO dagre IN. NOT A LAYOUT.
 *
 * This function produces no pixels. dagre assigns every coordinate; what it
 * cannot know is which of several equally short drawings a human wants, and
 * its within-rank ordering is seeded by insertion order. Two things are worth
 * buying with that seed, and both were measured on a 40-service × 4-environment
 * fixture:
 *
 *  1. **Contract partners land in adjacent rows.** Contract edges are NOT
 *     given to dagre (they are same-rank, and dagre throws on `minlen: 0` —
 *     see `DependencyNetwork`), so nothing else pulls a provider next to its
 *     consumer. Ordering each contract component in topological order put 13
 *     of 13 contract edges at exactly one row's distance, i.e. a short
 *     vertical line in the column gutter.
 *
 *  2. **Held service lines come first.** At 40 services the canvas is taller
 *     than any frame and opens at the top, so the top is where the answer has
 *     to be. Hoisting is by COMPONENT, never by service: hoisting a single
 *     blocked service out of its component stretched its contract edge to
 *     2280px, which is not an edge, it is a stripe.
 *
 * Ties break alphabetically so two loads of one fleet read identically.
 */
export function layoutOrder(graph: RolloutGraph): string[] {
	const services = [...new Set(graph.nodes.map((n) => n.name))].sort();
	// Union-find over CONTRACT edges only: promotion edges join a service to
	// itself, so they say nothing about which services want to be neighbours.
	const parent = new Map(services.map((s) => [s, s] as const));
	const find = (s: string): string => {
		let r = s;
		while (parent.get(r) !== r) r = parent.get(r) as string;
		let cur = s;
		while (parent.get(cur) !== r) {
			const next = parent.get(cur) as string;
			parent.set(cur, r);
			cur = next;
		}
		return r;
	};
	const nameOf = new Map(graph.nodes.map((n) => [n.id, n.name] as const));
	const contractPairs: [string, string][] = [];
	for (const e of graph.edges) {
		if (e.writer !== 'contract') continue;
		const a = nameOf.get(e.from);
		const b = nameOf.get(e.to);
		if (!a || !b || a === b) continue;
		contractPairs.push([a, b]);
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent.set(ra, rb);
	}

	const comps = new Map<string, string[]>();
	for (const s of services) {
		const r = find(s);
		const list = comps.get(r);
		if (list) list.push(s);
		else comps.set(r, [s]);
	}

	/** Providers before consumers, alphabetical among equals. */
	const topo = (members: string[]): string[] => {
		const set = new Set(members);
		const deg = new Map<string, number>(members.map((m) => [m, 0]));
		for (const [a, b] of contractPairs)
			if (set.has(a) && set.has(b)) deg.set(b, (deg.get(b) ?? 0) + 1);
		const queue = members.filter((m) => (deg.get(m) ?? 0) === 0).sort();
		const out: string[] = [];
		const done = new Set<string>();
		while (queue.length > 0) {
			const n = queue.shift() as string;
			if (done.has(n)) continue;
			done.add(n);
			out.push(n);
			for (const [a, b] of contractPairs) {
				if (a !== n || !set.has(b) || done.has(b)) continue;
				deg.set(b, (deg.get(b) ?? 1) - 1);
				if ((deg.get(b) ?? 0) === 0) {
					queue.push(b);
					queue.sort();
				}
			}
		}
		// A cycle leaves members unqueued. They still render, in name order.
		for (const m of [...members].sort()) if (!done.has(m)) out.push(m);
		return out;
	};

	const adverse = new Set<string>();
	for (const n of graph.nodes) if (n.blocked) adverse.add(n.name);
	for (const e of graph.edges) {
		if (e.state !== 'blocked') continue;
		const b = nameOf.get(e.to);
		if (b) adverse.add(b);
	}

	const ordered = [...comps.values()]
		.map((members) => ({ members: topo(members), held: members.some((m) => adverse.has(m)) }))
		.sort(
			(a, b) => Number(b.held) - Number(a.held) || a.members[0].localeCompare(b.members[0])
		);

	const rank = new Map<string, number>();
	ordered.flatMap((c) => c.members).forEach((s, i) => rank.set(s, i));
	return [...graph.nodes]
		.sort(
			(a, b) =>
				(rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0) ||
				a.envRank - b.envRank ||
				a.env.localeCompare(b.env)
		)
		.map((n) => n.id);
}

// =========================================================================
// THE SENTENCES — one place, so the canvas and the list cannot drift
// =========================================================================

export function nodeLabel(n: GraphNode): string {
	return `${n.name} in ${n.env}`;
}

/**
 * ⭐ THE SAME APP IN N ENVIRONMENTS IS ONE SUBJECT, NOT N SUBJECTS.
 * (2026-09-02.) `/dependencies`' banner mapped every held node through
 * `nodeLabel` and joined the result, so one app held in three environments
 * printed *"hello-frontend-app in dev, hello-frontend-app in staging,
 * hello-frontend-app in prod"* — the app named three times in eleven words,
 * and the ONE thing the reader has to take from it (that it is a single app,
 * held all the way down its chain) buried under the repetition.
 *
 * It is a property of the SENTENCE BUILDER and not of the banner, because two
 * surfaces must not disagree about how a set of held rollouts is said, and
 * because the folding rule is the interesting part and belongs somewhere a
 * test can reach it.
 *
 * ⚠️ ORDER IS THE GRAPH'S, NEVER ALPHABETICAL — the caller passes nodes in
 * promotion order and that order is the story (dev before prod).
 *
 * ⚠️ A LIST WHOSE ITEMS CONTAIN COMMAS IS SEPARATED BY SEMICOLONS. With two
 * apps and `and` at both levels, `…, staging and prod and hello-api-app in
 * dev` reads as if `hello-api-app` were an environment. The semicolon only
 * appears in the mixed case; the common single-app case is a plain English
 * list.
 */
export function heldSubjects(nodes: GraphNode[]): string {
	const order: string[] = [];
	const envsByName = new Map<string, string[]>();
	for (const n of nodes) {
		let envs = envsByName.get(n.name);
		if (!envs) {
			envs = [];
			envsByName.set(n.name, envs);
			order.push(n.name);
		}
		if (!envs.includes(n.env)) envs.push(n.env);
	}
	const phrases = order.map((name) => `${name} in ${joinClauses(envsByName.get(name)!)}`);
	return phrases.length > 1 && phrases.some((p) => p.includes(','))
		? phrases.join('; ')
		: joinClauses(phrases);
}

/**
 * ⭐ THE SUBJECT OF `/dependencies`' BANNER, KEPT SHORT. (2026-10-09.)
 *
 * `heldSubjects` names every held app with every environment, which on the
 * demo fleet was five apps and ten places before the verb — four lines at
 * 1440. The banner's job is the count and the worst of it; the full list is
 * already the graph and the "Held links" card right below it. So:
 *
 *   - up to two apps: `heldSubjects`, unchanged (it is short);
 *   - more: the count, then the two apps held in the most environments
 *     (ties keep the graph's order) — `5 services, mostly checkout-api and
 *     hello-world,` — or `including …` when every app is held in one place,
 *     since "mostly" would then be false. No per-app counts: they cost a
 *     line at 390 and the graph below draws every environment.
 */
export function heldSummary(nodes: GraphNode[]): string {
	const order: string[] = [];
	const envs = new Map<string, Set<string>>();
	for (const n of nodes) {
		if (!envs.has(n.name)) {
			envs.set(n.name, new Set());
			order.push(n.name);
		}
		envs.get(n.name)!.add(n.env);
	}
	if (order.length <= 2) return heldSubjects(nodes);
	const ranked = order
		.map((name, i) => ({ name, n: envs.get(name)!.size, i }))
		.sort((a, b) => b.n - a.n || a.i - b.i)
		.slice(0, 2);
	const named =
		ranked[0].n > 1
			? `mostly ${ranked[0].name} and ${ranked[1].name}`
			: `including ${ranked[0].name} and ${ranked[1].name}`;
	return `${order.length} services, ${named},`;
}

/**
 * ⭐ THE CLAUSE THAT FINISHES "<subjects> cannot take their next release
 * until …" — and it is a function of `writer`, never one fixed verb.
 * (2026-09-02, a headline bug: the banner said *"…until the deploy in front
 * of each of them lands"* for EVERY held rollout, including ones held by a
 * `RolloutDependency` contract. A contract gate does not clear when a deploy
 * lands — it clears when the PROVIDER SHIPS a version that satisfies the
 * range. Only a promotion-order gate (written by `Environment`) clears "when
 * the deploy in front lands". The `Blocked links` rows already said the right
 * thing per edge (`consequence` in `/dependencies`); this is what makes the
 * headline agree with them instead of overriding every row with one verb.
 *
 * ⚠️ GROUPED BY (provider, contract) — the live cluster has
 * THREE blocked edges (dev/staging/prod) that are all the same clause, so the
 * sentence must not say `hello-api-app ships api ^1.67.0` three times.
 *
 * ⛔ MIXED WRITERS SAY BOTH, joined with `and` — never pick one and drop the
 * other, and never invent one clause that pretends to cover a promotion gate
 * and a contract gate at once.
 */
export function heldClause(
	edges: GraphEdge[],
	nodes: Map<string, GraphNode>,
	opts: { brief?: boolean } = {}
): string {
	const contractEdges = edges.filter((e) => e.writer === 'contract');
	const promotionEdges = edges.filter((e) => e.writer === 'promotion');

	/**
	 * ⭐ `brief`: PROVIDERS ONLY, VERSIONS LEFT TO THE GRAPH. (2026-10-09.)
	 * `/dependencies`' banner is a summary over a graph that draws every
	 * contract, range and served version right below it; spelling them in the
	 * sentence made it nine lines at 390. Brief names each provider once and
	 * says what they must do: `ledger-core and payments-svc ship the versions
	 * they need and the deploys ahead of them land`.
	 */
	const PROMOTION_CLAUSE = opts.brief
		? 'the deploys ahead of them land'
		: 'the deploy in front of each of them lands';

	if (contractEdges.length === 0) return PROMOTION_CLAUSE;

	// ⭐ ONE PHRASE PER (provider, contract), NEVER ONE PER REQUIREMENT.
	// (2026-10-09.) Grouping on the required version too printed
	// "payments-svc ships payments ~2.9.0, payments-svc ships payments and
	// payments-svc ships payments ^3.0.0" once more consumers were held on the
	// same contract with different ranges. The provider and contract are the
	// thing to ship; the ranges are a detail, listed once inside the phrase
	// when there is more than one, in first-seen order.
	const order: string[] = [];
	const byKey = new Map<string, { provider: string; contract: string; needs: string[] }>();
	for (const e of contractEdges) {
		const provider = nodes.get(e.from)?.name ?? e.from;
		const contract = e.contract ?? 'a contract';
		const key = `${provider}::${contract}`;
		let g = byKey.get(key);
		if (!g) {
			g = { provider, contract, needs: [] };
			byKey.set(key, g);
			order.push(key);
		}
		if (e.requiredVersion && !g.needs.includes(e.requiredVersion)) g.needs.push(e.requiredVersion);
	}
	const contractPhrases = order.map((k) => {
		const { provider, contract, needs } = byKey.get(k)!;
		if (needs.length === 0) return `${provider} ships ${contract}`;
		if (needs.length === 1) return `${provider} ships ${contract} ${needs[0]}`;
		const ranges = needs.join(', ');
		return `${provider} ships the ${contract} each of them needs (${ranges})`;
	});
	if (opts.brief) {
		const providers = [...new Set(order.map((k) => byKey.get(k)!.provider))];
		const verb = providers.length === 1 ? 'ships' : 'ship';
		contractPhrases.splice(
			0,
			contractPhrases.length,
			`${joinClauses(providers)} ${verb} the versions they need`
		);
	}
	const contractClause = joinClauses(contractPhrases);

	/**
	 * ⭐ THE CONTRACT LEADS, AND A PROMOTION GATE DOWNSTREAM OF THE SAME
	 * CONTRACT IS DROPPED, NOT RESTATED. (2026-09-02, a coordinator
	 * correction to the mixed-writer case: on the live fleet `dev` has no
	 * promotion edge at all — it is the first environment — so "the deploy
	 * in front of each of them lands" was false FOR IT, and for `staging`
	 * and `prod` the promotion gate is refusing `rel-67` for the exact same
	 * reason the contract is: the frontend cannot even take a build that
	 * satisfies the contract, so nothing new ever reaches the promotion
	 * gate to be refused independently. Naming both was one cause said
	 * twice, in the wrong order.
	 *
	 * A promotion hold only earns its own clause when it targets a subject
	 * the contract set does NOT already hold — a genuinely independent
	 * order gate, unrelated to this contract. Where every promotion-blocked
	 * target is also contract-blocked, the order clause is dropped
	 * entirely: it is downstream of the same cause, and the contract
	 * clause already says what actually has to happen.
	 */
	const contractTargets = new Set(contractEdges.map((e) => e.to));
	const independentPromotion = promotionEdges.some((e) => !contractTargets.has(e.to));

	// One list, one `and`: "A, B and C", never "A and B and C".
	return independentPromotion ? joinClauses([...contractPhrases, PROMOTION_CLAUSE]) : contractClause;
}

/**
 * What one edge is doing, in English. The tooltip, the blocked-links card and
 * the phone's rows all print this, so the two scales cannot disagree.
 */
export function edgeSentence(e: GraphEdge, nodes: Map<string, GraphNode>): string {
	const from = nodes.get(e.from);
	const to = nodes.get(e.to);
	const fromName = from ? nodeLabel(from) : e.from;
	const toName = to ? nodeLabel(to) : e.to;
	if (e.writer === 'promotion') {
		// ⛔ "…until staging deploys IT" is ambiguous when both ends are running
		// the same build, which is the normal case. The thing waiting is the
		// NEXT build, and the sentence has to name it.
		const verb = e.edgeKind === 'follow' ? 'picks it first' : 'deploys it first';
		if (e.state === 'blocked')
			return `${toName} cannot take its next build until ${from?.env ?? 'its upstream'} ${verb}`;
		if (e.state === 'unknown')
			return `${toName} waits on ${from?.env ?? 'its upstream'} — this rule has not been read`;
		return `${from?.env ?? 'upstream'} ${verb}, and it has`;
	}
	const contract = e.contract ?? 'a contract';
	if (e.state === 'blocked') {
		const needs = e.requiredVersion ? ` ${e.requiredVersion}` : '';
		const has = e.providedVersion ? `, ${from?.name ?? e.from} serves ${e.providedVersion}` : '';
		return `${toName} needs ${contract}${needs}${has} — held`;
	}
	if (e.state === 'unknown')
		return `${toName} depends on ${contract} from ${fromName} — this rule has not been read`;
	return `${toName} depends on ${contract} from ${fromName} — satisfied`;
}

/** The whole graph in one line, for a card's right-aligned rollup. */
export function networkVerdict(graph: RolloutGraph): {
	text: string;
	tone: 'neutral' | 'good' | 'adverse' | 'held';
} {
	/**
	 * ⭐ EVERY ROLLUP NAMES ITS NOUN, AND THIS ONE HAD STOPPED TO.
	 * (2026-09-02, coordinator correction: `5 of 7 blocked` sat beside a
	 * drawing of 6 NODES, so a reader counting boxes found a mismatch — the
	 * 7 is edges, not nodes, and nothing on the rollup said so. `4/4
	 * healthy`, `2 services` — every other rollup in the product counts a
	 * named thing. `links` is not invented here: it is the noun the
	 * `Blocked links` card beside this one already uses for the same
	 * objects, so the two cannot disagree about what they are counting.
	 */
	const links = graph.edges.length;
	if (links === 0) return { text: 'no links', tone: 'neutral' };
	const blocked = graph.blockedEdges.length;
	// `held`, not `adverse`: a held link needs a person or another deploy, the
	// product's orange; red beside the amber HELD chips read as failed.
	if (blocked > 0) return { text: `${blocked} of ${links} links held`, tone: 'held' };
	const unknown = graph.edges.filter((e) => e.state === 'unknown').length;
	if (unknown > 0) return { text: `${unknown} of ${links} links not read`, tone: 'neutral' };
	return { text: `${links} link${links === 1 ? '' : 's'} open`, tone: 'neutral' };
}
