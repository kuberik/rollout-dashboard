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
 *   |  (`status.rolloutGateRef`, `spec.relationship`)  rollout                                |
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
import { promotionBlock } from './promotion';
import {
	blockingStory,
	joinClauses,
	EMPTY_GATE_CONTEXT,
	type GateClears,
	type GateContext
} from './blocking-story';

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
	/** `promotion` only — `After` or `Parallel`. */
	relType: 'After' | 'Parallel' | null;
	/** The controller's own sentence, for a tooltip. Never rendered as prose. */
	message: string;
	/** True when this edge closes a cycle. Drawn, never hidden. */
	cyclic: boolean;
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

function displayBuild(r: Rollout | undefined): string | null {
	const v = r?.status?.history?.[0]?.version;
	if (!v) return null;
	return v.version || v.revision || v.tag || null;
}

/** The one value a set agrees on, or null when it does not agree (or is empty). */
function agreed<T>(values: (T | null | undefined)[]): T | null {
	const set = new Set(values.filter((v) => v !== null && v !== undefined) as T[]);
	return set.size === 1 ? [...set][0] : null;
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
		if (ns && tier) tierOfNs.set(`${clusterOf(e)}/${ns}`, tier);
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
				env: env ?? envOfNs(cluster, namespace),
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

	// ── PROMOTION EDGES ──────────────────────────────────────────────────
	//
	// `Environment.spec.name` is the GitHub deployment name and it is
	// REPO-GLOBAL: the same value identifies dev, staging and prod of one
	// service line. It is therefore the join key, and it must NOT be
	// cluster-scoped — on the live fleet dev and staging are on the spoke and
	// prod is on the hub, so a cluster-scoped join loses the staging → prod
	// edge, which is the most important edge on the page.
	const lineByDeployName = new Map<string, Map<string, Environment>>();
	for (const e of environments) {
		const line = e.spec?.name;
		const tier = e.spec?.environment;
		if (!line || !tier) continue;
		let byTier = lineByDeployName.get(line);
		if (!byTier) lineByDeployName.set(line, (byTier = new Map()));
		if (!byTier.has(tier)) byTier.set(tier, e);
	}

	for (const e of environments) {
		const ns = e.metadata?.namespace;
		const target = e.spec?.rolloutRef?.name;
		const tier = e.spec?.environment;
		const gate = e.status?.rolloutGateRef?.name;
		const rel = e.spec?.relationship;
		if (!ns || !target || !tier || !gate || !rel?.environment) continue;
		const up = lineByDeployName.get(e.spec?.name ?? '')?.get(rel.environment);
		const upNs = up?.metadata?.namespace;
		const upName = up?.spec?.rolloutRef?.name;
		// ⛔ NO PHANTOM SOURCE. An `After staging` relationship whose staging
		// Environment this dashboard cannot see has no far end to draw to. The
		// gate still holds the rollout, so it falls through to the node's
		// `holds` via `classifyGate`, which says `after staging` in words.
		if (!up || !upNs || !upName) continue;

		const to = node(clusterOf(e), ns, target, tier);
		const from = node(clusterOf(up), upNs, upName, up.spec?.environment ?? rel.environment);
		if (from.id === to.id) continue;
		edges.push({
			key: `promotion:${to.id}:${gate}`,
			from: from.id,
			to: to.id,
			writer: 'promotion',
			gate,
			state: 'unknown',
			contract: null,
			requiredVersion: null,
			providedVersion: null,
			relType: rel.type ?? null,
			message: '',
			cyclic: false
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
		edges.push({
			key: `contract:${to.id}:${gate}`,
			from: from.id,
			to: to.id,
			writer: 'contract',
			gate,
			state: 'unknown',
			contract: dep.spec?.contract || provider,
			requiredVersion: agreed(blocked.map((b) => b.requiredVersion ?? null)),
			providedVersion: dep.status?.providedVersion ?? null,
			relType: null,
			message: satisfied?.message ?? '',
			cyclic: false
		});
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
	for (const e of edges) {
		const block = blockPerNode.get(e.to);
		const seen = gateNamesPerNode.get(e.to);
		if (!block || !seen) {
			e.state = 'unknown'; // the gated rollout is not in this payload
		} else if (block.blockingGates.includes(e.gate)) {
			e.state = 'blocked';
		} else if (!seen.has(e.gate)) {
			// The CRD names a gate the rollout has not published a summary for.
			// Not health — an unread instrument.
			e.state = 'unknown';
		} else {
			e.state = 'clear';
		}
	}

	// ── NODE STATE, AND THE GATES THAT ARE NOT EDGES ─────────────────────
	const inboundGates = new Map<string, Set<string>>();
	for (const e of edges) {
		let s = inboundGates.get(e.to);
		if (!s) inboundGates.set(e.to, (s = new Set()));
		s.add(e.gate);
	}
	for (const n of nodes.values()) {
		const r = rolloutById.get(n.id);
		if (!r) continue;
		const story = blockingStory(r, ctx, { place: n.env });
		n.candidateCount = story.candidateCount;
		n.waiting = story.blocked;
		n.blocked = story.blocked && !story.selfClearing;
		const drawn = inboundGates.get(n.id) ?? new Set<string>();
		n.holds = story.gates
			.filter((g) => !drawn.has(g.id))
			.map((g) => ({ gate: g.id, clears: g.clears, short: g.short, clearsAt: g.clearsAt }));
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
 * ⚠️ GROUPED BY (provider, contract, requiredVersion) — the live cluster has
 * THREE blocked edges (dev/staging/prod) that are all the same clause, so the
 * sentence must not say `hello-api-app ships api ^1.67.0` three times.
 *
 * ⛔ MIXED WRITERS SAY BOTH, joined with `and` — never pick one and drop the
 * other, and never invent one clause that pretends to cover a promotion gate
 * and a contract gate at once.
 */
export function heldClause(edges: GraphEdge[], nodes: Map<string, GraphNode>): string {
	const contractEdges = edges.filter((e) => e.writer === 'contract');
	const promotionEdges = edges.filter((e) => e.writer === 'promotion');

	const PROMOTION_CLAUSE = 'the deploy in front of each of them lands';

	if (contractEdges.length === 0) return PROMOTION_CLAUSE;

	const order: string[] = [];
	const byKey = new Map<
		string,
		{ provider: string; contract: string; requiredVersion: string | null }
	>();
	for (const e of contractEdges) {
		const provider = nodes.get(e.from)?.name ?? e.from;
		const contract = e.contract ?? 'a contract';
		const key = `${provider}::${contract}::${e.requiredVersion ?? ''}`;
		if (!byKey.has(key)) {
			order.push(key);
			byKey.set(key, { provider, contract, requiredVersion: e.requiredVersion });
		}
	}
	const contractPhrases = order.map((k) => {
		const { provider, contract, requiredVersion } = byKey.get(k)!;
		const needs = requiredVersion ? ` ${requiredVersion}` : '';
		return `${provider} ships ${contract}${needs}`;
	});
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

	return independentPromotion ? `${contractClause} and ${PROMOTION_CLAUSE}` : contractClause;
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
		const verb = e.relType === 'Parallel' ? 'deploys it alongside' : 'deploys it first';
		if (e.state === 'blocked')
			return `${toName} cannot take its next build until ${from?.env ?? 'its upstream'} ${verb}`;
		if (e.state === 'unknown')
			return `${toName} waits on ${from?.env ?? 'its upstream'} — this gate has not been read`;
		return `${from?.env ?? 'upstream'} ${verb}, and it has`;
	}
	const contract = e.contract ?? 'a contract';
	if (e.state === 'blocked') {
		const needs = e.requiredVersion ? ` ${e.requiredVersion}` : '';
		const has = e.providedVersion ? `, ${from?.name ?? e.from} serves ${e.providedVersion}` : '';
		return `${toName} needs ${contract}${needs}${has} — held`;
	}
	if (e.state === 'unknown')
		return `${toName} depends on ${contract} from ${fromName} — this gate has not been read`;
	return `${toName} depends on ${contract} from ${fromName} — satisfied`;
}

/** The whole graph in one line, for a card's right-aligned rollup. */
export function networkVerdict(graph: RolloutGraph): {
	text: string;
	tone: 'neutral' | 'good' | 'adverse';
} {
	const links = graph.edges.length;
	if (links === 0) return { text: 'no links', tone: 'neutral' };
	const blocked = graph.blockedEdges.length;
	if (blocked > 0) return { text: `${blocked} of ${links} blocked`, tone: 'adverse' };
	const unknown = graph.edges.filter((e) => e.state === 'unknown').length;
	if (unknown > 0) return { text: `${unknown} of ${links} not read`, tone: 'neutral' };
	return { text: `${links} link${links === 1 ? '' : 's'} open`, tone: 'neutral' };
}
