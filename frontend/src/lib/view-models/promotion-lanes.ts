/**
 * PROMOTION LANES — one lane per app, its own chain, drawn as stages on a LINE
 * and production regions as a SET. (Design language, 2026-10-08, Home and
 * Overview redesign.)
 *
 * The domain rule this encodes (`DESIGN-INTENT.md`): every app owns its own
 * promotion chain and chains differ per app; stages (dev → test → staging) are
 * a line, production regions are a set. So a lane never assumes a shared set
 * of columns: it lists the stages this app actually has, in promotion order,
 * then folds every production-tier environment into one set.
 *
 * Pure: built from the `RolloutCard`s Home already derives, so the lane can
 * never disagree with the rest of the page about a rollout's state.
 */
import { behindOfRollout } from './behind';
import { severityRank } from '$lib/view-models/severity';
import { noReleasesOf } from '$lib/releases/registry.svelte';
import type { RolloutCard } from '$lib/rollout-cards';
import { getEnvironmentRank } from '$lib/env-order';
import { canonicalTier, TIERS_WITH_OTHER, type TierOrOther } from '$lib/view-models/sites-waves';
import { shortEnvLabel } from '$lib/environment-theme';
import { isHeld, isNeedsYou } from '$lib/view-models/fleet-groups';
import { rankBehindBy } from '$lib/view-models/env-rank';

/** What a node is, in the order of who needs a person first. */
export type NodeState = 'failed' | 'stuck' | 'deploying' | 'checking' | 'held' | 'behind' | 'newest' | 'none';

/** The column a node sits in. Stages are a line; `prod` is a set. */
export type Tier = TierOrOther;
export const TIER_ORDER: Tier[] = [...TIERS_WITH_OTHER];

export function tierOf(envName: string): Tier {
	const canon = canonicalTier(envName);
	if (canon) return canon;
	const r = getEnvironmentRank(envName);
	if (r <= 1) return 'dev';
	if (r <= 3) return 'test';
	if (r <= 5) return 'staging';
	if (r === 6) return 'other';
	return 'prod';
}

export type LaneNode = {
	card: RolloutCard;
	tier: Tier;
	/** Short environment label (`dev`, `prod-us-east-2`). */
	env: string;
	state: NodeState;
	/** Builds behind the newest; 0 when on it or unknown. */
	behind: number;
	/** The place has no releases in the catalogue: drawn neutral (state 'none'), health only, never a currency claim. */
	noReleases?: boolean;
};

export type Lane = {
	app: string;
	/** Nodes per tier, in promotion order; `prod` may hold many (a set). */
	byTier: Partial<Record<Tier, LaneNode[]>>;
	/** Stages in promotion order (rank < production). */
	stages: LaneNode[];
	/** Production-tier environments, as a set. Empty when the app has none. */
	prod: LaneNode[];
	/** The lane's own headline state: the most urgent node's state. */
	state: NodeState;
	/** The node that state comes from (for the lane's status line). */
	lead: LaneNode | null;
};

const PROD_RANK = 7;

/** Worst first is `severity.ts`'s ONE order (a lane state is one of its slots: held already includes an approval wait). */

export function nodeState(c: RolloutCard): NodeState {
	if (c.statusKey === 'failed' || c.checkFailure != null) return 'failed';
	if (c.stuck != null) return 'stuck';
	if (c.bakeStatus === 'Deploying') return 'deploying';
	if (c.bakeStatus === 'InProgress') return 'checking';
	if (c.statusKey === 'pending' || c.bakeStatus === 'None') return 'none';
	if (isHeld(c)) return 'held';
	if (rankBehindBy(c.rank) > 0 || c.rank.kind === 'diverged') return 'behind';
	return 'newest';
}

function toNode(c: RolloutCard): LaneNode {
	const env = shortEnvLabel(c.theme) || c.envName || c.envDisplay || '';
	/* no release = no currency: health (failed, held, moving) still wins; a place that would read newest/behind is drawn 'none', from the catalogue rule, never a label */
	const base = nodeState(c);
	const none = (base === 'newest' || base === 'behind' || base === 'none') && !!noReleasesOf(c.rollout);
	return {
		card: c,
		tier: tierOf(c.envName || env),
		env,
		state: none ? 'none' : base,
		behind: none ? 0 : (c.behindCount ?? behindOfRollout(c.rollout, c.rank)),
		...(none ? { noReleases: true } : {})
	};
}

function mostUrgent(nodes: LaneNode[]): LaneNode | null {
	let best: LaneNode | null = null;
	for (const n of nodes) {
		if (!best || severityRank(n.state) < severityRank(best.state)) best = n;
	}
	return best;
}

/** An app with no Environment on any of its rollouts has no chain to draw. */
export function hasEnvironment(c: RolloutCard): boolean {
	return !!(c.envName || shortEnvLabel(c.theme));
}

export function buildLanes(cards: RolloutCard[]): Lane[] {
	const byApp = new Map<string, RolloutCard[]>();
	for (const c of cards) {
		if (!hasEnvironment(c)) continue;
		// A DuplicateSite object claims a site another Environment owns: it is not a place.
		if (c.duplicateSite) continue;
		const list = byApp.get(c.name) ?? [];
		list.push(c);
		byApp.set(c.name, list);
	}
	const lanes: Lane[] = [];
	for (const [app, list] of byApp) {
		const nodes = list.map(toNode);
		const byTier: Partial<Record<Tier, LaneNode[]>> = {};
		for (const n of nodes) (byTier[n.tier] ??= []).push(n);
		for (const t of TIER_ORDER) byTier[t]?.sort((a, b) => a.env.localeCompare(b.env));
		const stages = TIER_ORDER.filter((t) => t !== 'prod').flatMap((t) => byTier[t] ?? []);
		const prod = byTier.prod ?? [];
		const lead = mostUrgent(nodes);
		lanes.push({ app, byTier, stages, prod, state: lead?.state ?? 'none', lead });
	}
	// Who needs a person first; then alphabetical, so the order is stable.
	return lanes.sort(
		(a, b) => severityRank(a.state) - severityRank(b.state) || a.app.localeCompare(b.app)
	);
}

/** The tier columns a set of lanes needs, in promotion order. */
export function laneTiers(lanes: Lane[]): Tier[] {
	return TIER_ORDER.filter((t) => lanes.some((l) => (l.byTier[t]?.length ?? 0) > 0));
}

/**
 * Apps with at least one rollout that carries no Environment: listed, never
 * drawn as a chain.
 *
 * ⛔ U-12 (2026-10-08, mirrors `version-utils.ts`'s `groupRolloutsByApp` fix
 * of the same name): THIS USED TO FILTER OUT A NAME THE MOMENT **ANY** card
 * of that name HAD an Environment (`withEnv`, a `Set<string>` keyed by
 * name) — so a real, unbound rollout sharing its name with a bound app (the
 * bound app's own lane sits fine in `buildLanes`; this ORPHAN rollout is a
 * second, unrelated object) silently vanished from both this list and
 * Home's own "not in a promotion chain" footer. Counted by CARD now, never
 * by filtering the whole name out: a name appears here whenever at least one
 * of its cards has no Environment, independent of its other, bound cards.
 */
export function appsWithoutEnvironment(cards: RolloutCard[]): string[] {
	return [...new Set(cards.filter((c) => !hasEnvironment(c)).map((c) => c.name))].sort();
}

/** True when a lane holds anything a person must act on. */
export function laneNeedsYou(l: Lane): boolean {
	return [...l.stages, ...l.prod].some((n) => isNeedsYou(n.card));
}

/**
 * THE STAIRCASE GEOMETRY of a drawn row (FleetRow `uniformStops`, /changes'
 * ChangeTrackRow): one shared answer so every drawn chain lands on the same
 * steps. `stairRise` lifts a stop's plate by its tier's index among the
 * columns in play (0 = first tier, 1 = production); `stairColumns` is the
 * grid template those columns share (a stage 1fr, production 1.5fr, with
 * floors so a name never squeezes).
 */
export function stairRise(tier: Tier, tiers: readonly Tier[]): number {
	const i = tiers.indexOf(tier);
	if (i < 0 || tiers.length < 2) return 0;
	return i / (tiers.length - 1);
}

export function stairColumns(tiers: readonly Tier[]): string {
	return tiers.map((t) => (t === 'prod' ? 'minmax(160px, 1.5fr)' : 'minmax(88px, 1fr)')).join(' ');
}
