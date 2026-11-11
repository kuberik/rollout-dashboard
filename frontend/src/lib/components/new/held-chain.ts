/**
 * "Held by a holder that is itself held": the one quiet line under the Held group on /rollouts.
 *
 * Role: when a cause that holds rollouts ("Waiting on payments-svc") is a provider that is itself held by a BLOCKED contract
 * (payments-svc needs ledger-core ^6.0.0, ledger-core serves 5.1.0), the group says so once. Derived, never typed: the cause comes from
 * `heldCauses`, the chain from the dependency graph the Apps page builds. No chain = no lines. The chain walk is the pure part of the
 * visuals-r41 blocking-map view-model (provider tiles whose `waits on` is non-empty), without the graph drawing.
 */
import type { FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { buildRolloutGraph, EMPTY_GRAPH, type GraphEdge, type RolloutGraph } from '$lib/view-models/dependency-graph';
import { buildGateContext } from '$lib/view-models/blocking-story';
import { compareEnvironmentNames } from '$lib/env-order';

export type CauseIn = { key: string; cause: string; rows: unknown[] };
export type ChainLine = { provider: string; upstream: string; text: string; href: string | null };

/** The graph the Apps page builds (list payload -> gate context -> `buildRolloutGraph`). Empty until the live source is installed. */
export function fleetGraph(src: Pick<FleetSource, 'rollouts' | 'environments' | 'rolloutDependencies'> | null): RolloutGraph {
	if (!src || !src.rollouts.length) return EMPTY_GRAPH;
	const envs = src.environments;
	const gates = buildGateContext({ environments: { items: envs }, rolloutDependencies: src.rolloutDependencies ?? null, rollouts: src.rollouts, rolloutGates: null });
	return buildRolloutGraph({
		rollouts: src.rollouts, environments: envs, dependencies: src.rolloutDependencies?.items ?? [],
		envOrder: [...new Set(envs.map((e) => e.spec?.environment).filter(Boolean) as string[])].sort(compareEnvironmentNames), gates
	});
}

const isBlockedContract = (e: GraphEdge) => e.writer === 'contract' && e.state === 'blocked';

export function heldChain(causes: CauseIn[], graph: RolloutGraph): ChainLine[] {
	if (!causes.length || !graph.nodes.length) return [];
	const byId = new Map(graph.nodes.map((n) => [n.id, n] as const));
	const nameOf = (id: string) => byId.get(id)?.name ?? null;
	const blocked = graph.edges.filter(isBlockedContract);
	const out: ChainLine[] = [];
	const seen = new Set<string>();
	for (const c of causes) {
		const provider = /^Waiting on (.+)$/.exec(c.cause)?.[1];
		if (!provider || !c.rows.length) continue;
		for (const e of blocked.filter((x) => nameOf(x.to) === provider)) {
			const upstream = nameOf(e.from);
			if (!upstream || upstream === provider || seen.has(`${provider}>${upstream}`)) continue;
			seen.add(`${provider}>${upstream}`);
			const n = byId.get(e.from);
			const src = n && !n.unresolved ? n : graph.nodes.find((x) => x.name === upstream && !x.unresolved);
			out.push({
				provider, upstream, text: `${provider} is itself waiting on ${upstream}`,
				href: src ? `/rollouts/${encodeURIComponent(src.cluster)}/${encodeURIComponent(src.namespace)}/${encodeURIComponent(src.name)}` : null
			});
		}
	}
	return out;
}
