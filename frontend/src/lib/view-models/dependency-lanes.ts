/**
 * ENVIRONMENT LANES — the /dependencies take-B view-model (design/deps-b, 2026-11-25).
 *
 * ROLE: fold the fleet's provider network (`cardContext(...).providerNetwork`, a node per ROLLOUT) into a sized
 * matrix: ROWS are services, COLUMNS are environments in promotion order, a CELL is one service in one environment
 * with every region/site of that environment folded into it ("5 regions · 4 held"). Edges fold the same way:
 * one contract link per (provider cell, consumer cell), one promotion link per (cell, next cell) of a row, so a
 * relationship is said ONCE however many regions it spans (owner D4).
 *
 * WHERE AN UNBOUND ROLLOUT GOES (no `Environment` names it, e.g. `platform-prod/ledger-core`). Never guessed from the
 * namespace's spelling. In order, and only when the data says so:
 *   1. `cluster` — every Environment on the rollout's cluster is one tier (the cluster serves exactly one environment);
 *   2. `consumers` — every rollout it serves a contract to sits in one tier;
 *   3. otherwise the one "No environment" lane at the end.
 * The cell remembers how it was placed (`placed`), so the page can say it.
 *
 * Pure: no Svelte, no fetch. The page draws; `dependency-lanes.test.ts` pins the folding and the ranking.
 */
import type { GraphEdge, GraphNode, RolloutGraph } from './dependency-graph';
import type { Environment, RolloutDependency } from '../../types';
import { canonicalTier, siteOf, waveOf, TIERS } from './sites-waves';
import { compareEnvironmentNames } from '$lib/env-order';
import { SOURCE_CLUSTER_ANNOTATION } from '$lib/source-dashboard';

export const NO_ENV = '\u0000none';

export type Placement = 'environment' | 'cluster' | 'consumers' | 'none';

export type LaneSite = {
	node: GraphNode;
	/** `eu-central`, or the namespace when the Environment names no site. */
	site: string;
	wave: number | null;
	held: boolean;
	reason: string | null;
	/** Oldest moment a held edge into this site went held, ISO; null when unknown (the unfolded row's age). */
	since: string | null;
};

export type LaneCell = {
	key: string;
	service: string;
	col: string;
	nodes: GraphNode[];
	/** One per node, wave then site. A single-rollout cell has one. */
	sites: LaneSite[];
	/** Nodes held by anything that needs a person or another deploy (`node.blocked`). */
	held: number;
	/** The build every node runs, when they agree; else null (the sites say it). */
	build: string | null;
	/** What the held side needs, said once for the cell; null when nothing is held. */
	reason: string | null;
	placed: Placement;
};

export type LaneRow = {
	service: string;
	/** Connected component over contract links; rows of one group sit together, providers above consumers. */
	group: number;
	/** Contracts this service serves to others, for the row label. */
	provides: string[];
	cells: Map<string, LaneCell>;
};

export type LaneLink = {
	key: string;
	kind: 'promotion' | 'contract';
	from: string;
	to: string;
	edges: GraphEdge[];
	held: boolean;
	/** Underlying edges that are held (regions). */
	heldCount: number;
	contract: string | null;
	/** What the held consumer builds need, distinct, e.g. `~2.9.0`. */
	needs: string[];
	/** What the provider serves here. */
	serves: string | null;
	/** Oldest moment one of its held edges went held, ISO; null when unknown. */
	since: string | null;
};

export type LaneBlocker = {
	/** The root node (it holds others and nothing deploy-shaped holds it). */
	node: GraphNode;
	cell: LaneCell;
	/** Why it has not moved yet, short: `Waiting for approval`, `e2c9b47 not in dev yet`. */
	why: string;
	/** Rollouts it holds, transitively through held links. */
	frees: GraphNode[];
	/** `frees` folded per cell, in row order: `checkout-api · prod · 4` of the cell's `of` regions (5: af-south-1 is held by
	 *  something else, so it is not this blocker's to free). */
	freesCells: { service: string; col: string; count: number; of: number }[];
	since: string | null;
};

export type LaneColumn = { key: string; held: number; cells: number };

export type LaneModel = {
	columns: LaneColumn[];
	rows: LaneRow[];
	cells: Map<string, LaneCell>;
	links: LaneLink[];
	blockers: LaneBlocker[];
	/** Rollouts held by another deploy (targets of held edges). */
	heldByDeploy: number;
	heldLinks: number;
	totalLinks: number;
	oldestSince: string | null;
	newestSince: string | null;
	/** Cells placed by rule 1/2/3 above, for the footnote. */
	unboundCount: number;
};

const clusterOfEnv = (e: Environment) => e.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? '';
export const cellKey = (service: string, col: string) => `${service}|${col}`;

/**
 * When each held contract edge went held: the `Satisfied=False` condition's transition on the RolloutDependency
 * whose gate it is. Promotion edges have no such record and stay unknown.
 */
export function heldSinceByEdge(graph: RolloutGraph, deps: RolloutDependency[]): Map<string, string> {
	const nodes = new Map(graph.nodes.map((n) => [n.id, n] as const));
	const out = new Map<string, string>();
	for (const e of graph.edges) {
		if (e.writer !== 'contract' || e.state !== 'blocked') continue;
		const to = nodes.get(e.to);
		if (!to) continue;
		const d = deps.find(
			(d) =>
				d.metadata?.namespace === to.namespace &&
				(d.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? '') === to.cluster &&
				(d.status as { gateName?: string } | undefined)?.gateName === e.gate
		);
		const c = (d?.status as { conditions?: { type: string; status: string; lastTransitionTime?: string }[] } | undefined)
			?.conditions?.find((c) => c.type === 'Satisfied' && c.status === 'False');
		if (c?.lastTransitionTime) out.set(e.key, c.lastTransitionTime);
	}
	return out;
}

function shortHold(short: string): string {
	if (/approv/i.test(short)) return 'Needs approval';
	if (/upstream environment/i.test(short)) return 'Waiting for its upstream';
	return short;
}

export function buildLanes(args: {
	graph: RolloutGraph;
	environments: Environment[];
	/** Node ids to keep (the filter); null = all. Held contract providers of a kept node are always kept. */
	keep?: Set<string> | null;
	/** The range a held contract edge's build needs (the Gates tab's reading); defaults to the edge's own. */
	needOf?: (e: GraphEdge) => string | null;
	heldSince?: Map<string, string>;
}): LaneModel {
	const { graph, environments } = args;
	const needOf = args.needOf ?? ((e: GraphEdge) => e.requiredVersion ?? e.requiredVersions?.[0] ?? null);
	const since = args.heldSince ?? new Map<string, string>();
	const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));

	// ── placement ───────────────────────────────────────────────────────────
	const envOfNode = new Map<string, Environment>();
	for (const n of graph.nodes) {
		const e = environments.find(
			(e) =>
				e.metadata?.namespace === n.namespace &&
				clusterOfEnv(e) === n.cluster &&
				(e.spec?.rolloutRef?.name ?? e.metadata?.name) === n.name
		);
		if (e) envOfNode.set(n.id, e);
	}
	const tierOfEnv = (e: Environment) => canonicalTier(e.spec?.environment) ?? e.spec?.environment ?? NO_ENV;
	const tiersOnCluster = new Map<string, Set<string>>();
	for (const e of environments) {
		const c = clusterOfEnv(e);
		if (!tiersOnCluster.has(c)) tiersOnCluster.set(c, new Set());
		tiersOnCluster.get(c)!.add(tierOfEnv(e));
	}
	const colOf = new Map<string, { col: string; placed: Placement }>();
	for (const n of graph.nodes) {
		const e = envOfNode.get(n.id);
		if (e) colOf.set(n.id, { col: tierOfEnv(e), placed: 'environment' });
	}
	for (const n of graph.nodes) {
		if (colOf.has(n.id)) continue;
		const onCluster = tiersOnCluster.get(n.cluster);
		if (onCluster && onCluster.size === 1) {
			colOf.set(n.id, { col: [...onCluster][0], placed: 'cluster' });
		}
	}
	// consumers: iterate to a fixed point so a provider of a provider is placed too
	for (let pass = 0; pass < 4; pass++) {
		for (const n of graph.nodes) {
			if (colOf.has(n.id)) continue;
			const cols = new Set(
				graph.edges
					.filter((e) => e.writer === 'contract' && e.from === n.id)
					.map((e) => colOf.get(e.to)?.col)
					.filter((c): c is string => !!c && c !== NO_ENV)
			);
			if (cols.size === 1) colOf.set(n.id, { col: [...cols][0], placed: 'consumers' });
		}
	}
	for (const n of graph.nodes) if (!colOf.has(n.id)) colOf.set(n.id, { col: NO_ENV, placed: 'none' });

	// ── keep set (filter + the held providers of what it keeps) ─────────────
	let keep: Set<string> | null = args.keep ? new Set(args.keep) : null;
	if (keep) {
		let grew = true;
		while (grew) {
			grew = false;
			for (const e of graph.edges) {
				if (e.writer === 'contract' && e.state === 'blocked' && keep.has(e.to) && !keep.has(e.from)) {
					keep.add(e.from);
					grew = true;
				}
			}
		}
	}
	const kept = (id: string) => !keep || keep.has(id);
	const nodes = graph.nodes.filter((n) => kept(n.id));
	const edges = graph.edges.filter((e) => kept(e.from) && kept(e.to));
	const cellOfNode = (id: string) => {
		const n = byId.get(id)!;
		return cellKey(n.name, colOf.get(id)!.col);
	};

	// ── per-node reason ─────────────────────────────────────────────────────
	const inHeld = new Map<string, GraphEdge[]>();
	for (const e of edges) if (e.state === 'blocked') (inHeld.get(e.to) ?? inHeld.set(e.to, []).get(e.to)!).push(e);
	const colLabel = (c: string) => (c === NO_ENV ? 'its upstream' : c);
	const reasonOf = (n: GraphNode): string | null => {
		if (!n.blocked && !(inHeld.get(n.id)?.length ?? 0)) return null;
		const held = inHeld.get(n.id) ?? [];
		const contract = held.filter((e) => e.writer === 'contract');
		if (contract.length) {
			return contract
				.map((e) => {
					const need = needOf(e);
					return `needs ${e.contract ?? 'a contract'}${need ? ` ${need}` : ''}`;
				})
				.join(', ');
		}
		const promo = held.find((e) => e.writer === 'promotion');
		if (promo) {
			const from = byId.get(promo.from);
			const fromCol = from ? colOf.get(from.id)!.col : NO_ENV;
			const sameCol = fromCol === colOf.get(n.id)!.col;
			const env = from ? envOfNode.get(from.id) : undefined;
			if (sameCol && env) return `waits for ${siteOf(env)}`;
			return `waits for ${colLabel(fromCol)}`;
		}
		const h = n.holds[0];
		return h ? shortHold(h.short) : 'held';
	};

	// ── cells ───────────────────────────────────────────────────────────────
	const cells = new Map<string, LaneCell>();
	for (const n of nodes) {
		const { col, placed } = colOf.get(n.id)!;
		const k = cellKey(n.name, col);
		let c = cells.get(k);
		if (!c) {
			c = { key: k, service: n.name, col, nodes: [], sites: [], held: 0, build: null, reason: null, placed };
			cells.set(k, c);
		}
		c.nodes.push(n);
		const env = envOfNode.get(n.id);
		const reason = reasonOf(n);
		const siteSince =
			(inHeld.get(n.id) ?? [])
				.map((e) => since.get(e.key))
				.filter((t): t is string => !!t)
				.sort()[0] ?? null;
		c.sites.push({
			node: n,
			site: env?.spec?.site ? siteOf(env) : n.namespace,
			wave: env?.spec?.wave != null ? waveOf(env) : null,
			held: n.blocked || reason !== null,
			reason,
			since: siteSince
		});
		if (placed !== 'environment') c.placed = placed;
	}
	for (const c of cells.values()) {
		c.sites.sort((a, b) => (a.wave ?? 0) - (b.wave ?? 0) || a.site.localeCompare(b.site));
		c.held = c.sites.filter((s) => s.held).length;
		const builds = new Set(c.nodes.map((n) => n.build));
		c.build = builds.size === 1 ? [...builds][0] : null;
		// the cell's reason: the one most held sites share; a second distinct one is counted, not listed
		const counts = new Map<string, number>();
		for (const s of c.sites) if (s.reason) counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
		const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
		c.reason = ranked.length ? ranked[0][0] : null;
	}

	// ── links ───────────────────────────────────────────────────────────────
	const links = new Map<string, LaneLink>();
	for (const e of edges) {
		const from = cellOfNode(e.from);
		const to = cellOfNode(e.to);
		if (from === to) continue; // a wave edge inside one environment: the cell's own site order
		const k = `${e.writer}:${from}>${to}`;
		let l = links.get(k);
		if (!l) {
			l = { key: k, kind: e.writer, from, to, edges: [], held: false, heldCount: 0, contract: e.contract, needs: [], serves: null, since: null };
			links.set(k, l);
		}
		l.edges.push(e);
		if (e.state === 'blocked') {
			l.held = true;
			l.heldCount++;
			const need = e.writer === 'contract' ? needOf(e) : null;
			if (need && !l.needs.includes(need)) l.needs.push(need);
			const s = since.get(e.key);
			if (s && (!l.since || s < l.since)) l.since = s;
		}
		if (e.providedVersion) l.serves = e.providedVersion;
	}

	// ── rows: groups over contract links, providers first ──────────────────
	const services = [...new Set([...cells.values()].map((c) => c.service))];
	const svcEdges = [...links.values()].filter((l) => l.kind === 'contract').map((l) => [cells.get(l.from)!.service, cells.get(l.to)!.service] as const);
	const parent = new Map(services.map((s) => [s, s] as const));
	const find = (s: string): string => (parent.get(s) === s ? s : find(parent.get(s)!));
	for (const [a, b] of svcEdges) parent.set(find(a), find(b));
	const depth = new Map<string, number>(services.map((s) => [s, 0]));
	for (let i = 0; i < services.length; i++)
		for (const [a, b] of svcEdges) if (a !== b && depth.get(b)! < depth.get(a)! + 1 && depth.get(a)! < services.length) depth.set(b, depth.get(a)! + 1);
	const groups = new Map<string, string[]>();
	for (const s of services) (groups.get(find(s)) ?? groups.set(find(s), []).get(find(s))!).push(s);
	const heldIn = (svc: string) => [...cells.values()].filter((c) => c.service === svc).reduce((a, c) => a + c.held, 0);
	const groupList = [...groups.values()]
		.map((g) => g.sort((a, b) => depth.get(a)! - depth.get(b)! || a.localeCompare(b)))
		.sort((a, b) => {
			const ha = a.reduce((x, s) => x + heldIn(s), 0);
			const hb = b.reduce((x, s) => x + heldIn(s), 0);
			return (hb > 0 ? 1 : 0) - (ha > 0 ? 1 : 0) || b.length - a.length || hb - ha || a[0].localeCompare(b[0]);
		});
	const rows: LaneRow[] = [];
	groupList.forEach((g, gi) => {
		for (const s of g) {
			const rowCells = new Map<string, LaneCell>();
			for (const c of cells.values()) if (c.service === s) rowCells.set(c.col, c);
			const provides = [
				...new Set(
					[...links.values()]
						.filter((l) => l.kind === 'contract' && cells.get(l.from)!.service === s && l.contract)
						.map((l) => l.contract!)
				)
			];
			rows.push({ service: s, group: gi, provides, cells: rowCells });
		}
	});

	// ── columns ─────────────────────────────────────────────────────────────
	const colKeys = [...new Set([...cells.values()].map((c) => c.col))].sort((a, b) => {
		if (a === NO_ENV) return 1;
		if (b === NO_ENV) return -1;
		const ta = (TIERS as readonly string[]).indexOf(a);
		const tb = (TIERS as readonly string[]).indexOf(b);
		if (ta >= 0 && tb >= 0) return ta - tb;
		return compareEnvironmentNames(a, b);
	});
	const columns: LaneColumn[] = colKeys.map((k) => {
		const cs = [...cells.values()].filter((c) => c.col === k);
		return { key: k, cells: cs.length, held: cs.reduce((a, c) => a + c.held, 0) };
	});

	// ── blockers: roots of held chains, ranked by what they free ───────────
	const outHeld = new Map<string, GraphEdge[]>();
	for (const e of edges) if (e.state === 'blocked') (outHeld.get(e.from) ?? outHeld.set(e.from, []).get(e.from)!).push(e);
	const rowIndex = new Map(rows.map((r, i) => [r.service, i] as const));
	const blockers: LaneBlocker[] = [];
	for (const n of nodes) {
		if (!outHeld.has(n.id) || inHeld.has(n.id)) continue;
		const seen = new Set<string>();
		const stack = [n.id];
		while (stack.length) {
			const id = stack.pop()!;
			for (const e of outHeld.get(id) ?? []) if (!seen.has(e.to) && e.to !== n.id) { seen.add(e.to); stack.push(e.to); }
		}
		const frees = [...seen].map((id) => byId.get(id)!).filter(Boolean);
		const fold = new Map<string, { service: string; col: string; count: number; of: number }>();
		for (const f of frees) {
			const k = cellOfNode(f.id);
			const c = cells.get(k)!;
			const x = fold.get(k) ?? { service: c.service, col: c.col, count: 0, of: c.sites.length };
			x.count++;
			fold.set(k, x);
		}
		const freesCells = [...fold.values()].sort(
			(a, b) => rowIndex.get(a.service)! - rowIndex.get(b.service)! || colKeys.indexOf(a.col) - colKeys.indexOf(b.col)
		);
		let why: string;
		if (n.holds.length) why = shortHold(n.holds[0].short);
		else if (n.blocked) why = 'Held';
		else {
			const p = (outHeld.get(n.id) ?? []).find((e) => e.writer === 'promotion' && e.held.length);
			const col = colOf.get(n.id)!.col;
			why = p ? `${p.held[0]} not in ${colLabel(col)} yet` : `Has not shipped what they need`;
		}
		let s: string | null = null;
		for (const e of outHeld.get(n.id) ?? []) {
			const t = since.get(e.key);
			if (t && (!s || t < s)) s = t;
		}
		for (const id of seen) for (const e of outHeld.get(id) ?? []) {
			const t = since.get(e.key);
			if (t && (!s || t < s)) s = t;
		}
		blockers.push({ node: n, cell: cells.get(cellOfNode(n.id))!, why, frees, freesCells, since: s });
	}
	blockers.sort((a, b) => b.frees.length - a.frees.length || a.node.name.localeCompare(b.node.name));

	const heldEdges = edges.filter((e) => e.state === 'blocked');
	const allSince = heldEdges.map((e) => since.get(e.key)).filter((s): s is string => !!s).sort();
	return {
		columns,
		rows,
		cells,
		links: [...links.values()],
		blockers,
		heldByDeploy: new Set(heldEdges.map((e) => e.to)).size,
		heldLinks: heldEdges.length,
		totalLinks: edges.length,
		oldestSince: allSince[0] ?? null,
		newestSince: allSince[allSince.length - 1] ?? null,
		unboundCount: [...cells.values()].filter((c) => c.placed !== 'environment').length
	};
}

/**
 * ONE REGION COUNT (R2-DES-B-3). A cell's fold says its total ("5 regions"); wherever a part of it is meant — what one
 * blocker holds, what one relationship holds — the share is said against that total: `4 of 5 regions`. All of them is
 * the total; a single-region cell has no region phrase. `null` when there is nothing to say.
 */
export function regionShare(count: number, of: number): string | null {
	if (of <= 1) return null;
	return count < of ? `${count} of ${of} regions` : `${of} regions`;
}

/** `checkout-api · 4 of 5 regions`, `payments-svc`, for a blocker's frees list. */
export function freesPhrase(f: { service: string; col: string; count: number; of?: number }): string {
	const share = regionShare(f.count, f.of ?? f.count);
	return share ? `${f.service} · ${share}` : f.service;
}

/** A blocker's frees folded per service: `checkout-api in prod (4 of 5 regions)`, `hello-world in staging, prod`. */
export function freesByService(cells: { service: string; col: string; count: number; of?: number }[], word: (c: string) => string = (c) => c): string[] {
	const by = new Map<string, { cols: string[]; count: number }>();
	for (const c of cells) {
		const x = by.get(c.service) ?? { cols: [], count: 0 };
		const share = regionShare(c.count, c.of ?? c.count);
		x.cols.push(word(c.col) + (share ? ` (${share})` : ''));
		x.count += c.count;
		by.set(c.service, x);
	}
	return [...by.entries()].map(([s, x]) => `${s} in ${x.cols.join(', ')}`);
}

/** Compact age: `45m`, `3h`, `2d`. */
export function ageOf(iso: string | null, now: Date): string | null {
	if (!iso) return null;
	const ms = now.getTime() - new Date(iso).getTime();
	if (!(ms >= 0)) return null;
	const m = Math.round(ms / 60000);
	if (m < 60) return `${Math.max(1, m)}m`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h`;
	return `${Math.round(h / 24)}d`;
}

/**
 * THE HOLDS THAT ARE NOT ANOTHER DEPLOY (R2-DES-B-5). A held site whose reason is a person's or a rule's (an approval, a
 * pin, a window) rather than a contract or the promotion order: the word the phone stop prints under it, and the kind the
 * calm header counts. `null` for a dependency hold ("needs payments ~2.9.0", "waits for dev") and for nothing held.
 */
export function holdWord(reason: string | null): 'approval' | 'pinned' | 'held' | null {
	if (!reason) return null;
	if (/^(needs |waits for )/.test(reason)) return null;
	if (/approv/i.test(reason)) return 'approval';
	if (/\bpin/i.test(reason)) return 'pinned';
	return 'held';
}

/**
 * The calm header's second half: what IS held when no deploy holds another, counted in rollouts (sites):
 * `{ n: 4, by: 'approvals or pins' }`, `{ n: 1, by: 'an approval' }`. `null` when nothing is held that way.
 */
export function otherHoldsPhrase(model: LaneModel): { n: number; by: string } | null {
	let n = 0;
	const kinds = new Set<'approval' | 'pinned' | 'held'>();
	for (const c of model.cells.values())
		for (const s of c.sites) {
			const w = s.held ? holdWord(s.reason) : null;
			if (!w) continue;
			n++;
			kinds.add(w);
		}
	if (!n) return null;
	const one = { approval: 'an approval', pinned: 'a pin', held: 'a rule' } as const;
	const many = { approval: 'approvals', pinned: 'pins', held: 'other rules' } as const;
	const order = (['approval', 'pinned', 'held'] as const).filter((k) => kinds.has(k));
	return { n, by: order.map((k) => (n === 1 ? one[k] : many[k])).join(' or ') };
}
