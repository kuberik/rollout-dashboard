<!-- r34 v2: the Footprint tile became Facia.svelte; this module keeps the two data helpers the Apps page and the Facia share (laneOf, approvalOf). -->
<script module lang="ts">
	import { oldestFirst, latest } from '$lib/instant';
	import type { EnvState } from '$lib/view-models/home-model';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { severityRank } from '$lib/view-models/severity';
	import { type Lane, type LaneNode, type NodeState, type Tier } from '$lib/view-models/promotion-lanes';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import { waveInfoOfHref, type TApp, type TRow } from './data';
	import { currentAt } from './change/detail-model';
	import { rowAction, actionLabel, actionHref } from './rollout-view';
	import { stateWord } from './state-words';
	import { placeStateWithPin } from '$lib/view-models/pin-hold';

	type Ev = { t: number; app: string; sha: string };
	/* Y3: a pin ('rolled-back') draws no mark of its own (no second warm hue on the strip); the text says it. Waiting = the one hollow ring. */
	const STATE: Partial<Record<EnvState, NodeState>> = { failed: 'failed', 'awaiting-approval': 'held', 'held-by-rule': 'held', deploying: 'deploying', checking: 'checking' };
	/** a place's lane node state as the held counts read it (a place a pin holds is held); undefined = the place's own health decides. ONE map for the model lane and the live lane (Apps.svelte's `masked`). */
	export const nodeStateOfPlace = (p: { state: EnvState; pinned?: boolean }): NodeState | undefined => STATE[placeStateWithPin(p.state, p.pinned)];
	const ORDER: Tier[] = ['dev', 'test', 'staging', 'other', 'prod'];

	/**
	 * W4/C1 — an app that waits for a person's approval anywhere: read from the rows of Rollouts' own Waiting-for-approval
	 * group for this state (`rollouts(state).groups` key 'approval'), never from the model's place states — so quiet (no
	 * such group) has no approval line, and the sentence, place words and age are the Rollouts row's.
	 */
	export function approvalOf(item: TApp, rows: TRow[]): { text: string; href: string; n: number; row: TRow } | null {
		const mine = rows.filter((r) => r.app === item.app).sort((p, q) => oldestFirst(p.since, q.since));
		if (!mine.length) return null;
		const yours = mine.some((r) => rowAction(r)?.kind === 'approve'); /* Rollouts' own word: "your" when the viewer can give it */
		return { text: `${stateWord('approval', { yours })} in ${mine.map((r) => r.place).join(' and ')}`, href: mine[0].href, n: mine.length, row: mine[0] };
	}

	/**
	 * The app's promotion lane — the Lane the rollout tab's `PromotionLane` draws — built from data.ts's `placeList`
	 * (no RolloutCards here). `behind` counts builds between a place's build and the newest, read off the app's own
	 * deploy events in arrival order. TODO(truth): data.ts should hand the lane its lag; a build the events do not
	 * know (semver apps vs sha events) reads 0 = no lag word rather than a guessed one.
	 */
	export function laneOf(item: TApp, m: { apps: { app: string; envs: { arrivedAt: string | null; state: EnvState }[] }[] }, events: Ev[]): { lane: Lane; last: string | null } {
		const app = item.app, newest = item.newest;
		const first = new Map<string, number>();
		for (const e of events) if (e.app === app) first.set(e.sha, Math.min(first.get(e.sha) ?? Infinity, e.t));
		const seq = [...first.entries()].sort((p, q) => p[1] - q[1]).map(([s]) => s);
		if (newest && !seq.includes(newest)) seq.push(newest);
		const newIdx = newest ? seq.indexOf(newest) : -1;
		const behindOf = (v: string | null) => { const i = v ? seq.indexOf(v) : -1; return i < 0 || newIdx < 0 ? 0 : Math.max(0, newIdx - i); };
		const nodes: LaneNode[] = item.placeList.map((e) => {
			const tier: Tier = e.tier === 'prod' ? 'prod' : e.tier === 'dev' ? 'dev' : e.tier === 'test' ? 'test' : 'staging';
			const state: NodeState = nodeStateOfPlace(e) ?? (e.currency === 'none' ? 'none' : e.onNewest ? 'newest' : behindOf(e.version) > 0 ? 'behind' : 'newest');
			const theme = getRolloutEnvironmentTheme(null, tier);
			/* change-strip r1: the place's site and wave from the topology, so the strip can draw prod's waves and name each site */
			const wi = e.href ? waveInfoOfHref(e.href) : null;
			const card = { ns: e.label, name: app, version: e.version, theme, envDisplay: e.label || tier, href: e.href, heldCause: e.state === 'awaiting-approval' ? 'person' : undefined, site: wi?.site ?? null, wave: wi?.wave ?? null, timestamp: e.href ? currentAt(e.href) : null, role: wi ? (wi.leader ? 'Leader' : 'Follower') : null } as unknown as RolloutCard;
			return { card, tier, env: (tier === 'prod' ? e.label : shortEnvLabel(theme) || e.label) || tier, /* QA #11: an env-less place has a blank label; the tier names it, a box is never empty */ state, behind: state === 'behind' ? behindOf(e.version) : 0, ...(e.currency === 'none' ? { noReleases: true } : {}) };
		});
		const byTier: Partial<Record<Tier, LaneNode[]>> = {};
		for (const n of nodes) (byTier[n.tier] ??= []).push(n);
		for (const t of ORDER) byTier[t]?.sort((p, q) => p.env.localeCompare(q.env));
		const prod = byTier.prod ?? [];
		const stages = ORDER.filter((t) => t !== 'prod').flatMap((t) => byTier[t] ?? []);
		const lead = nodes.reduce<LaneNode | null>((b, n) => (!b || severityRank(n.state) < severityRank(b.state) ? n : b), null);
		const last = latest((m.apps.find((x) => x.app === app)?.envs ?? []).map((e) => e.arrivedAt));
		return { lane: { app, byTier, stages, prod, state: lead?.state ?? 'none', lead }, last };
	}
</script>
