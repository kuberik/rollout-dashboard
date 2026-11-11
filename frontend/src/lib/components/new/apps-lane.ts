import { STATE_ORDER, type Lane, type LaneNode, type NodeState, type Tier } from '$lib/view-models/promotion-lanes';
import { rolloutPath } from '$lib/source-dashboard';
import type { TApp } from './data';

/**
 * A1 — the strip's states are the SAME scenario-masked row states the pill uses (`TApp.placeList`, from rows(state)),
 * never the raw health the list query carries: a node whose masked place is not failing/held/moving is drawn neutral
 * (newest, or behind when it lags), a node whose masked place is in a state takes that state. The lead is re-picked.
 * A place without releases is a 'none' node WITH `noReleases`: 'none' alone is also a never-deployed place, which is not at rest.
 */
const NS: Partial<Record<string, NodeState>> = { failed: 'failed', 'awaiting-approval': 'held', 'held-by-rule': 'held', deploying: 'deploying', checking: 'checking' };
export const NOISY = new Set<NodeState>(['failed', 'stuck', 'held', 'deploying', 'checking']);
export const nodeHref = (n: LaneNode) => { const c = n.card as unknown as { href?: string; sourceCluster?: string; ns: string; name: string }; return c.href ?? rolloutPath(c.sourceCluster || '', c.ns, c.name); };
export function maskLane(a: TApp, lane: Lane): Lane {
	const byHref = new Map(a.placeList.map((p) => [p.href, p]));
	const fix = (n: LaneNode): LaneNode => {
		const p = byHref.get(nodeHref(n));
		if (!p) return n;
		const want = NS[p.state] ?? (p.currency === 'none' ? 'none' : NOISY.has(n.state) ? (n.behind > 0 ? 'behind' : 'newest') : n.state);
		const flag = want === 'none' && p.currency === 'none';
		return want === n.state && (!flag || n.noReleases) ? n : { ...n, state: want, ...(flag ? { noReleases: true } : {}) };
	};
	const byTier: Lane['byTier'] = {};
	for (const [t, ns] of Object.entries(lane.byTier)) byTier[t as Tier] = ns!.map(fix);
	const stages = lane.stages.map((n) => byTier[n.tier]!.find((m) => m.card === n.card) ?? n);
	const prod = lane.prod.map((n) => byTier.prod!.find((m) => m.card === n.card) ?? n);
	const lead = [...stages, ...prod].reduce<LaneNode | null>((b, n) => (!b || STATE_ORDER.indexOf(n.state) < STATE_ORDER.indexOf(b.state) ? n : b), null);
	return { ...lane, byTier, stages, prod, lead, state: lead?.state ?? 'none' };
}
