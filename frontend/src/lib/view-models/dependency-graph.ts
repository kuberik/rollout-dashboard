/**
 * THE DEPENDENCY NETWORK — the fleet's contract graph, and its layout.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
 *
 * From the human: *"dependencies we used a full graph to show whole network
 * of dependencies."* What shipped instead was per-rollout bidirectional
 * lists, twice. A list of one rollout's neighbours answers *"what blocks me,
 * what do I block"*. It cannot answer *"what does the network look like"* —
 * which services depend on which, in what release order, and where the
 * network is blocked right now. A map is not a list of my neighbours.
 *
 * ── ⭐ DECISION 1 · A NODE IS A SERVICE, NOT A (SERVICE, ENVIRONMENT) ───
 *
 * A `RolloutDependency` is created once per NAMESPACE, so the live cluster
 * carries three objects — `hello-dep-dev`, `hello-dep-staging`,
 * `hello-dep-prod` — for what is ONE relation. Their specs are
 * byte-identical apart from the namespace:
 *
 *     contract: api   providerRef: hello-api-app   rolloutRef: hello-frontend-app
 *
 * and they must be, because the constraint itself does not live in the
 * dependency at all: it lives in the CONSUMER BUILD's
 * `com.kuberik.rollout.requires.<contract>` OCI annotation, and a build is
 * one artifact promoted through every environment. **The topology is a
 * property of the service. Only the STATE is per-environment.**
 *
 * So a (service, environment) graph would draw the same shape three times
 * and call the repetition information. It triples the node count for zero
 * new edges, and it has no page to link a node to — the product's app
 * identity is the ROLLOUT NAME (`/apps/<name>`, `groupRolloutsByApp`), which
 * is exactly this node.
 *
 * **The environment axis is therefore ON THE EDGE**, as `EdgeEnvState[]`,
 * and it is not folded: an edge satisfied in dev and blocked in prod prints
 * both. `filterByEnv` makes the other model reachable — selecting one
 * environment yields that environment's slice, which IS the
 * (service, environment) graph, one layer at a time instead of 3x at once.
 *
 * ── ⭐ DECISION 2 · `Satisfied` IS THE ADVERSE PREDICATE, NOT `blockedReleases` ──
 *
 * The per-rollout tab splits `blockedReleases` into WANTED and PAST itself,
 * because a gate holding `rel-2` on a rollout running `rel-66` is the gate
 * WORKING and no action follows. That split needs the consumer's build
 * ladder and its per-environment deployed tag — plumbing the fleet page does
 * not have and should not grow.
 *
 * It does not need it. The controller publishes exactly that verdict:
 * `Satisfied` is defined in the CRD as *"no release the consumer could
 * deploy next is held back by this dependency"* — the same predicate,
 * computed by the component that owns the ladder. Live, all three are
 * `Satisfied=False, reason=WaitingForProvider`.
 *
 * ⛔ AND A MISSING CONDITION IS NOT `false`. A gate that has not been
 * evaluated is `'unknown'`, a third state, drawn as a dashed edge. Reading
 * absence as health is how a dashboard tells an operator to go back to bed.
 *
 * ── ⭐ DECISION 3 · THE LAYOUT IS dagre'S, AND ALWAYS SHOULD HAVE BEEN ──
 *
 * A contract graph is a RELEASE ORDER — the controller's own words are
 * *"providers advance before the consumers that depend on them"*. That is a
 * rank, so the drawing is layered (Sugiyama), left to right, and NOT
 * force-directed: a force layout puts release order nowhere and produces a
 * different picture on every load.
 *
 * The first version of this file hand-rolled that layout and argued in its
 * own comments that a graph library was 40-250KB of dependency it would not
 * pay for. **That was wrong, and it was wrong without looking.**
 * `@xyflow/svelte` and `@dagrejs/dagre` were already in `package.json`, and
 * `AppPromotionFlow` had already wired them together in this repo, at
 * this Svelte version, with the LR/TB switching and the measure-then-layout
 * effect both solved. The human's correction was one sentence: *"We used
 * some library before to show the graph."*
 *
 * So ranking, barycentre ordering, virtual nodes, coordinate assignment and
 * the hand-drawn cubic paths are DELETED. `DependencyNetwork` builds nodes
 * and edges and hands them to `GraphCanvas`. This module keeps only what is
 * DOMAIN — the graph, its states, its filters, and the release waves the
 * phone prints — none of which has coordinates in it.
 *
 * ⛔ **DO NOT ASSUME ACYCLIC.** Nothing in the CRD forbids `a → b → a`; it
 * would simply deadlock both. A cycle must RENDER, not crash and not vanish,
 * so back edges are detected by DFS here, excluded from the release-wave
 * ranking, and drawn by the canvas carrying a `cycle` mark.
 *
 * Everything here is PURE and deterministic, so it is tested without a DOM.
 */

import type { RolloutDependency } from '../../types';
import {
	dependencyCondition,
	dependencySourceCluster
} from '../../types/rollout-dependency-types';

// =========================================================================
// THE MODEL
// =========================================================================

/**
 * What one gate says right now.
 *
 * `unknown` is NOT a synonym for `satisfied`. It means the controller has
 * written no `Satisfied` condition for this gate — the CRD has not been
 * evaluated, or the cluster serving it is a version that does not publish
 * one. The UI draws it dashed and says so.
 */
export type EdgeState = 'blocked' | 'satisfied' | 'unknown';

/** One environment's reading of one contract edge. */
export type EdgeEnvState = {
	/** Environment tier — `dev`, `prod-eu-central`. Falls back to the namespace. */
	env: string;
	namespace: string;
	/** Source cluster, for multi-cluster attribution. Null on a single-cluster payload. */
	cluster: string | null;
	state: EdgeState;
	/** `Ready=False` — the gate could not be evaluated. A different fact from blocked. */
	ready: boolean;
	/** Consumer candidate tags this gate holds. Verbatim from `blockedReleases`. */
	blockedTags: string[];
	/** The constraint the held candidates ask of the contract, when they agree. */
	requiredVersion: string | null;
	/** Contract version the provider has deployed HERE. */
	providedVersion: string | null;
	providedTag: string | null;
	/** The controller's own sentence, for a tooltip. Never rendered as prose. */
	message: string;
	gateName: string | null;
};

/**
 * ONE CONTRACT RELATION BETWEEN TWO SERVICES, across every environment.
 *
 * `from` is the PROVIDER and `to` is the CONSUMER, so the edge points the way
 * releases must travel: the provider ships first. That is the direction the
 * layered ranking uses and the direction the arrowhead is drawn in, and it is
 * chosen rather than the "depends-on" convention because a left-to-right rank
 * that reads backwards is worse than a convention broken on purpose. The UI
 * states it in words on the card header.
 */
export type GraphEdge = {
	key: string;
	/** Provider — ships first. */
	from: string;
	/** Consumer — waits. */
	to: string;
	contract: string;
	/** Per-environment readings, in the order given by `envOrder`. */
	envs: EdgeEnvState[];
	/** Rollup across `envs`: blocked if ANY environment is blocked. */
	state: EdgeState;
	/** Environments where this edge is blocked, in order. */
	blockedEnvs: string[];
	/** Environments that read no `Satisfied` condition at all, in order. */
	unknownEnvs: string[];
	/**
	 * The constraint to print — only when every BLOCKED environment asks the
	 * same thing. They normally do (one build, one annotation); when they do
	 * not there is no single answer and the UI prints none rather than
	 * picking one.
	 */
	requiredVersion: string | null;
	/** The provider's deployed contract version, when every environment agrees. */
	providedVersion: string | null;
	/** True when the environments disagree about what the provider is on. */
	providedVaries: boolean;
	/**
	 * True when this edge closes a cycle. It is excluded from ranking and
	 * drawn as an arc — never hidden.
	 */
	cyclic: boolean;
};

export type GraphNode = {
	/** The Rollout name. This is the product's app identity — `/apps/<id>`. */
	id: string;
	/**
	 * True when no Rollout of this name appears in the payload: a `providerRef`
	 * pointing at something this dashboard cannot see. Drawn as a hollow node,
	 * never silently dropped — a dangling provider is a real misconfiguration.
	 */
	unresolved: boolean;
	/** Providers this service waits on. */
	providers: string[];
	/** Services waiting on this one. */
	consumers: string[];
	/** True when an inbound edge is blocked — this service cannot advance. */
	blocked: boolean;
	/** Environments where this service is held, in order. */
	blockedEnvs: string[];
	/** True when this service holds someone else back. */
	blocking: boolean;
};

export type DependencyGraph = {
	nodes: GraphNode[];
	edges: GraphEdge[];
	/** Every environment the network touches, in the caller's promotion order. */
	envs: string[];
	/** Edges whose `state` is `blocked`. */
	blockedEdges: GraphEdge[];
	/** True when at least one back edge was found. */
	hasCycle: boolean;
};

// =========================================================================
// BUILDING THE GRAPH
// =========================================================================

function envStateOf(dep: RolloutDependency): EdgeState {
	const c = dependencyCondition(dep, 'Satisfied');
	if (!c) return 'unknown';
	if (c.status === 'True') return 'satisfied';
	if (c.status === 'False') return 'blocked';
	return 'unknown';
}

/** The one value a set agrees on, or null when it does not agree (or is empty). */
function agreed<T>(values: (T | null | undefined)[]): T | null {
	const set = new Set(values.filter((v) => v !== null && v !== undefined) as T[]);
	return set.size === 1 ? [...set][0] : null;
}

export function buildDependencyGraph(args: {
	deps: RolloutDependency[];
	/** Environment tier for a dependency's namespace. Null when unknown. */
	envOf: (namespace: string) => string | null;
	/** Promotion order of the fleet's environments, upstream first. */
	envOrder: string[];
	/** Rollout names the payload actually carries, for the `unresolved` mark. */
	knownRollouts: Set<string> | string[];
}): DependencyGraph {
	const { deps, envOf, envOrder } = args;
	const known =
		args.knownRollouts instanceof Set ? args.knownRollouts : new Set(args.knownRollouts);
	const envRank = new Map(envOrder.map((e, i) => [e, i] as const));
	const rankOfEnv = (e: string) => envRank.get(e) ?? 900 + e.charCodeAt(0);

	const byKey = new Map<string, GraphEdge>();
	const envsSeen = new Set<string>();

	for (const dep of deps) {
		const consumer = dep.spec?.rolloutRef?.name;
		const provider = dep.spec?.providerRef?.name;
		if (!consumer || !provider) continue;
		const ns = dep.metadata?.namespace ?? '';
		// A dependency in a namespace with no Environment binding is still a
		// real edge; it is labelled by its namespace rather than dropped.
		const env = envOf(ns) ?? ns;
		envsSeen.add(env);
		const contract = dep.spec?.contract || provider;
		const key = `${provider} ${consumer} ${contract}`;
		let edge = byKey.get(key);
		if (!edge) {
			edge = {
				key,
				from: provider,
				to: consumer,
				contract,
				envs: [],
				state: 'satisfied',
				blockedEnvs: [],
				unknownEnvs: [],
				requiredVersion: null,
				providedVersion: null,
				providedVaries: false,
				cyclic: false
			};
			byKey.set(key, edge);
		}
		const blocked = dep.status?.blockedReleases ?? [];
		edge.envs.push({
			env,
			namespace: ns,
			cluster: dependencySourceCluster(dep) ?? null,
			state: envStateOf(dep),
			ready: dependencyCondition(dep, 'Ready')?.status === 'True',
			blockedTags: blocked.map((b) => b.tag),
			requiredVersion: agreed(blocked.map((b) => b.requiredVersion ?? null)),
			providedVersion: dep.status?.providedVersion ?? null,
			providedTag: dep.status?.providedTag ?? null,
			message: dependencyCondition(dep, 'Satisfied')?.message ?? '',
			gateName: dep.status?.gateName ?? null
		});
	}

	const edges = [...byKey.values()];
	for (const e of edges) {
		e.envs.sort((a, b) => rankOfEnv(a.env) - rankOfEnv(b.env) || a.env.localeCompare(b.env));
		e.blockedEnvs = e.envs.filter((x) => x.state === 'blocked').map((x) => x.env);
		e.unknownEnvs = e.envs.filter((x) => x.state === 'unknown').map((x) => x.env);
		e.state =
			e.blockedEnvs.length > 0 ? 'blocked' : e.unknownEnvs.length > 0 ? 'unknown' : 'satisfied';
		e.requiredVersion = agreed(
			e.envs.filter((x) => x.state === 'blocked').map((x) => x.requiredVersion)
		);
		const provided = e.envs.map((x) => x.providedVersion).filter((v) => v !== null) as string[];
		e.providedVersion = agreed(provided);
		e.providedVaries = new Set(provided).size > 1;
	}
	// Deterministic: provider, then consumer, then contract.
	edges.sort(
		(a, b) =>
			a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.contract.localeCompare(b.contract)
	);

	// --- nodes -----------------------------------------------------------
	const nodes = new Map<string, GraphNode>();
	const node = (id: string) => {
		let n = nodes.get(id);
		if (!n) {
			n = {
				id,
				unresolved: !known.has(id),
				providers: [],
				consumers: [],
				blocked: false,
				blockedEnvs: [],
				blocking: false
			};
			nodes.set(id, n);
		}
		return n;
	};
	for (const e of edges) {
		const from = node(e.from);
		const to = node(e.to);
		if (!from.consumers.includes(e.to)) from.consumers.push(e.to);
		if (!to.providers.includes(e.from)) to.providers.push(e.from);
		if (e.state === 'blocked') {
			to.blocked = true;
			from.blocking = true;
			for (const env of e.blockedEnvs) if (!to.blockedEnvs.includes(env)) to.blockedEnvs.push(env);
		}
	}
	for (const n of nodes.values()) {
		n.blockedEnvs.sort((a, b) => rankOfEnv(a) - rankOfEnv(b) || a.localeCompare(b));
	}

	markCycles(edges);

	return {
		nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
		edges,
		envs: envOrder.filter((e) => envsSeen.has(e)).concat(
			[...envsSeen].filter((e) => !envRank.has(e)).sort()
		),
		blockedEdges: edges.filter((e) => e.state === 'blocked'),
		hasCycle: edges.some((e) => e.cyclic)
	};
}

/**
 * Mark back edges with a colour DFS, so ranking sees a DAG.
 *
 * Iterative, because a deep chain must not blow the stack, and deterministic:
 * roots and out-edges are both visited in sorted order, so the SAME edge of a
 * cycle is chosen as the back edge on every load. A cycle that moved every
 * refresh would be unreadable.
 */
function markCycles(edges: GraphEdge[]): void {
	const out = new Map<string, GraphEdge[]>();
	const ids = new Set<string>();
	for (const e of edges) {
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
		// frame = [node, index into its out-edges]
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
				// Back edge — including the self-loop `a → a`.
				edge.cyclic = true;
			} else if (c === WHITE) {
				colour.set(edge.to, GRAY);
				stack.push([edge.to, 0]);
			}
		}
	}
}

// =========================================================================
// FOCUS AND FILTER — the two ways out of the fleet view
// =========================================================================

/**
 * The subgraph within `depth` hops of `focus`, ignoring direction.
 *
 * This is what the per-rollout tab renders: THE SAME GRAPH LANGUAGE at one
 * node's scale, so the fleet page and the tab are one idea at two scales
 * rather than two designs. Returns an empty graph when `focus` is not in the
 * network at all.
 */
export function neighbourhood(
	graph: DependencyGraph,
	focus: string,
	depth = 1
): DependencyGraph {
	if (!graph.nodes.some((n) => n.id === focus)) {
		return { nodes: [], edges: [], envs: graph.envs, blockedEdges: [], hasCycle: false };
	}
	const keep = new Set<string>([focus]);
	let frontier = [focus];
	for (let d = 0; d < depth; d++) {
		const next: string[] = [];
		for (const e of graph.edges) {
			if (frontier.includes(e.from) && !keep.has(e.to)) {
				keep.add(e.to);
				next.push(e.to);
			}
			if (frontier.includes(e.to) && !keep.has(e.from)) {
				keep.add(e.from);
				next.push(e.from);
			}
		}
		frontier = next;
		if (frontier.length === 0) break;
	}
	const edges = graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
	return {
		nodes: graph.nodes.filter((n) => keep.has(n.id)),
		edges,
		envs: graph.envs,
		blockedEdges: edges.filter((e) => e.state === 'blocked'),
		hasCycle: edges.some((e) => e.cyclic)
	};
}

/**
 * ⭐ THE (SERVICE, ENVIRONMENT) GRAPH, REACHABLE.
 *
 * Restrict every edge to the given environments and re-derive its state, then
 * drop edges that exist in none of them — a `RolloutDependency` collection is
 * SPARSE, so an edge with no object in `prod` is genuinely not a prod edge and
 * must not be drawn as a satisfied one.
 *
 * An empty selection means "every environment" and returns the graph as-is,
 * which is the multi-select chip convention this product already uses on
 * `/rollouts`. There is no `All` pill.
 */
export function filterByEnv(graph: DependencyGraph, envs: string[]): DependencyGraph {
	if (envs.length === 0) return graph;
	const want = new Set(envs);
	const edges: GraphEdge[] = [];
	for (const e of graph.edges) {
		const kept = e.envs.filter((x) => want.has(x.env));
		if (kept.length === 0) continue;
		const blockedEnvs = kept.filter((x) => x.state === 'blocked').map((x) => x.env);
		const unknownEnvs = kept.filter((x) => x.state === 'unknown').map((x) => x.env);
		const provided = kept.map((x) => x.providedVersion).filter((v) => v !== null) as string[];
		edges.push({
			...e,
			envs: kept,
			blockedEnvs,
			unknownEnvs,
			state: blockedEnvs.length > 0 ? 'blocked' : unknownEnvs.length > 0 ? 'unknown' : 'satisfied',
			requiredVersion: agreed(
				kept.filter((x) => x.state === 'blocked').map((x) => x.requiredVersion)
			),
			providedVersion: agreed(provided),
			providedVaries: new Set(provided).size > 1
		});
	}
	const keep = new Set<string>();
	for (const e of edges) {
		keep.add(e.from);
		keep.add(e.to);
	}
	const nodes = graph.nodes
		.filter((n) => keep.has(n.id))
		.map((n) => {
			const inbound = edges.filter((e) => e.to === n.id);
			const outbound = edges.filter((e) => e.from === n.id);
			const blockedEnvs: string[] = [];
			for (const e of inbound)
				for (const env of e.blockedEnvs) if (!blockedEnvs.includes(env)) blockedEnvs.push(env);
			return {
				...n,
				providers: inbound.map((e) => e.from),
				consumers: outbound.map((e) => e.to),
				blocked: inbound.some((e) => e.state === 'blocked'),
				blocking: outbound.some((e) => e.state === 'blocked'),
				blockedEnvs
			};
		});
	return {
		nodes,
		edges,
		envs: graph.envs,
		blockedEdges: edges.filter((e) => e.state === 'blocked'),
		hasCycle: edges.some((e) => e.cyclic)
	};
}

// =========================================================================
// RELEASE WAVES — the ONLY ordering this module still computes
// =========================================================================

/**
 * ⭐ THE LAYOUT LIVES IN dagre NOW, AND THIS IS NOT THE LAYOUT.
 *
 * Everything that used to be below this line — longest-path ranking feeding a
 * barycentre ordering pass, virtual nodes to route long edges, coordinate
 * assignment, hand-drawn cubic paths and arc-routed cycles — has been deleted.
 * `@xyflow/svelte` and `@dagrejs/dagre` were ALREADY dependencies of this
 * repo, already wired together in `AppPromotionFlow`, and dagre does all
 * five passes better than 150 hand-written lines ever will. The claim in the
 * first version of this file that a graph library was too heavy to add was
 * simply wrong: nothing had to be added.
 *
 * What survives is this one function, and it is NOT geometry — it produces no
 * pixels, no paths and no coordinates. It answers a DOMAIN question the phone
 * asks and the canvas does not: *in the earliest wave, which services can ship
 * at all?*
 *
 * -- WHY NOT dagre's RANKS --------------------------------------------------
 *
 * Measured, on `a->b->c->d->e` plus `x->e`:
 *
 *   dagre `network-simplex` / `tight-tree`  ->  [[a],[b],[c],[d,x],[e]]
 *   dagre `longest-path`                    ->  as-late-as-possible, worse
 *   longest path from the SOURCES (below)   ->  [[a,x],[b],[c],[d],[e]]
 *
 * dagre is minimising edge length, which is the right objective for a DRAWING
 * and the wrong one for a CLAIM. `x` waits on nothing, so `x` can ship in the
 * first wave; putting it in the fourth because that shortens a line is a
 * statement about ink, not about releases. The phone prints `Ships 1st`,
 * `Ships 2nd` — a promise about what a person can deploy this morning — so it
 * takes the earliest-possible ranking and the canvas takes dagre's.
 */

/**
 * Longest path from the sources: the earliest wave a service could ship in.
 *
 * Longest rather than shortest, because rank IS release order — a service that
 * waits on something two hops deep cannot ship in wave 1, and shortest path
 * would put it there. Back edges and self-loops are excluded; a cycle has no
 * release order, and `markCycles` has already marked which edge closes it.
 */
export function rankNodes(graph: DependencyGraph): Map<string, number> {
	const ids = graph.nodes.map((n) => n.id);
	const incoming = new Map<string, string[]>();
	for (const id of ids) incoming.set(id, []);
	for (const e of graph.edges) {
		if (e.cyclic || e.from === e.to) continue;
		incoming.get(e.to)?.push(e.from);
	}
	const rank = new Map<string, number>();
	const visiting = new Set<string>();
	const resolve = (id: string): number => {
		const cached = rank.get(id);
		if (cached !== undefined) return cached;
		// Defensive: `markCycles` should have removed every back edge, but a
		// rank of 0 is better than an infinite recursion if it ever misses one.
		if (visiting.has(id)) return 0;
		visiting.add(id);
		let r = 0;
		for (const p of incoming.get(id) ?? []) r = Math.max(r, resolve(p) + 1);
		visiting.delete(id);
		rank.set(id, r);
		return r;
	};
	for (const id of [...ids].sort()) resolve(id);
	return rank;
}

/**
 * THE PHONE'S DATA: node ids per wave, wave 0 first, names sorted inside a
 * wave so two loads of the same fleet read identically.
 */
export function releaseWaves(graph: DependencyGraph): string[][] {
	if (graph.nodes.length === 0) return [];
	const rank = rankNodes(graph);
	const depth = Math.max(0, ...rank.values());
	const waves: string[][] = Array.from({ length: depth + 1 }, () => []);
	for (const n of graph.nodes) waves[rank.get(n.id) ?? 0].push(n.id);
	for (const w of waves) w.sort((a, b) => a.localeCompare(b));
	return waves;
}

// =========================================================================
// THE SENTENCE — one place, so the graph and the list say the same thing
// =========================================================================

/**
 * What an edge is doing, in English. The card header, the tooltip and the
 * phone's wave rows all print this, so the two scales cannot drift apart.
 */
export function edgeSentence(e: GraphEdge): string {
	if (e.state === 'blocked') {
		const where = e.blockedEnvs.length > 0 ? ` in ${e.blockedEnvs.join(', ')}` : '';
		const needs = e.requiredVersion ? ` ${e.requiredVersion}` : '';
		const has = e.providedVersion ? `, ${e.from} serves ${e.providedVersion}` : '';
		return `${e.to} needs ${e.contract}${needs}${has} — held${where}`;
	}
	if (e.state === 'unknown') {
		return `${e.to} depends on ${e.contract} from ${e.from} — this gate has not been evaluated`;
	}
	return `${e.to} depends on ${e.contract} from ${e.from} — satisfied`;
}

/** The whole network in one line, for a card's right-aligned rollup. */
export function networkVerdict(graph: DependencyGraph): {
	text: string;
	tone: 'neutral' | 'good' | 'adverse';
} {
	const links = graph.edges.length;
	if (links === 0) return { text: 'no links', tone: 'neutral' };
	const blocked = graph.blockedEdges.length;
	if (blocked > 0) {
		return { text: `${blocked} of ${links} blocked`, tone: 'adverse' };
	}
	const unknown = graph.edges.filter((e) => e.state === 'unknown').length;
	if (unknown > 0) return { text: `${unknown} of ${links} not evaluated`, tone: 'neutral' };
	return { text: `${links} link${links === 1 ? '' : 's'} satisfied`, tone: 'neutral' };
}
