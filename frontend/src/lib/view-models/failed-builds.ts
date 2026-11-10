/**
 * THE ONE "A FAILED BUILD IS NOT COMING" COUNT RULE (batch4 #1), a thin wrapper over `failedHereVerdict` (deploy-risk.ts: a build's MOST RECENT
 * attempt in this place failed; a retry that later passed is clean). It governs the COUNTS only: arriving, inbound, behind and waiting. The
 * controller keeps a failed build as a release candidate, and clearing a pin or deploying it again really redeploys it, so
 * `promotionCandidates`, ClearPinModal, auto-deploy and the rollout detail's "failed here" row do NOT read this.
 * `waveRevs` = the short shas an Environment's own `bake failed on <rev>` blocker names (the wave chain, batch4 #3b).
 */
import type { Environment } from '../../types';
import { liveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { failedHereVerdict, shaNamesBuild, type BuildRef } from './deploy-risk';
import { buildTopology, deployNameOf, siteNodeOf, upstreamOf, waveReady, type AppTopology, type SiteNode } from './sites-waves';

type Hist = { bakeStatus?: string | null; timestamp?: string | null; version?: BuildRef | null };
type Status = { history?: readonly Hist[] | null } | null | undefined;
type RolloutLike = { metadata?: { name?: string; namespace?: string } | null; status?: Status };

/** true when `build` failed its latest attempt in the place whose status is `st`, or a wave blocker names its revision */
export function failedHere(st: Status, build: BuildRef | null | undefined, waveRevs: readonly string[] = []): boolean {
	if (!build) return false;
	if (waveRevs.some((r) => shaNamesBuild(r, build))) return true;
	return failedHereVerdict({ status: st } as never, build).kind === 'failed';
}

/** `xs` (release candidates / available releases) minus the builds that failed here: what every count reads */
export function liveOf<T extends BuildRef>(st: Status, xs: readonly T[], waveRevs: readonly string[] = []): T[] {
	return xs.filter((x) => !failedHere(st, x, waveRevs));
}

/** the fleet lists a place's wave chain lives in: a route's own list query, or (default) the installed live source */
export type Fleet = { environments?: readonly Environment[] | null; rollouts?: readonly unknown[] | null };

/** a build whose bake failed upstream in a place's wave chain; `rolledBack` = the failing site has since replaced it (failedHereVerdict.rolledBackAt) */
export type WaveFailure = { rev: string; rolledBack: boolean };

const TOPOS = new WeakMap<readonly Environment[], ReturnType<typeof buildTopology>>();
const topologyOf = (all: readonly Environment[]): ReturnType<typeof buildTopology> => {
	let t = TOPOS.get(all);
	if (!t) TOPOS.set(all, (t = buildTopology(all as Environment[])));
	return t;
};

/**
 * batch4 #3b: a build whose bake FAILED upstream in the wave chain is not a candidate for the places that wave holds. The wave-2 leader's
 * Environment blocker reads WaitingFor/Bake/<site>/<revision> (the controller sets `outcome: Failed` only on followers), so the failure is
 * resolved from the blocking SITE's own history with the one rule (failedHereVerdict): that site's latest attempt at the revision failed.
 * A site this dashboard cannot see falls back to the blocker's outcome. The chain is walked from a place to its leader and to the wave(s)
 * before it, for every place that is not ready, so a wave-3 leader with no member blocker of its own still reads what failed in wave 1.
 * `envs` / `rollouts` are EXPLICIT (a route's fleet list) or the installed live source's: there is no hidden registry.
 * batch4 #3c: `rolledBack` says the failing site has since replaced the build (failedHereVerdict.rolledBackAt): it then holds nobody.
 */
export function waveFailures(rollout: RolloutLike | null | undefined, fleet?: Fleet | null): WaveFailure[] {
	const all = (fleet?.environments ?? liveSource()?.environments ?? []) as Environment[];
	const ros = (fleet?.rollouts ?? liveSource()?.rollouts ?? []) as readonly RolloutLike[];
	const name = rollout?.metadata?.name, ns = rollout?.metadata?.namespace;
	if (!name || !ns || !all.length) return [];
	const env = all.find((e) => e.metadata?.namespace === ns && e.spec?.rolloutRef?.name === name);
	if (!env) return [];
	const topo = topologyOf(all).get(deployNameOf(env));
	const out = new Map<string, boolean>();
	const seen = new Set<unknown>();
	/** what the blocking site's own history says about the revision: failed (and whether it has been replaced), or unknown when that site is not visible */
	const siteSays = (tier: string, site: string, rev: string): { failed: boolean; rolledBack: boolean } | null => {
		const node = topo?.tiers.find((t) => t.tier === tier)?.waves.flatMap((w) => w.sites).find((s) => s.site === site);
		const ref = node?.env?.spec?.rolloutRef?.name;
		const ro = ref ? ros.find((r) => r.metadata?.name === ref && r.metadata?.namespace === node!.env!.metadata?.namespace) : null;
		if (!ro) return null;
		const entry = ro.status?.history?.find((h) => shaNamesBuild(rev, h?.version));
		if (!entry?.version) return { failed: false, rolledBack: false };
		const v = failedHereVerdict(ro as never, entry.version);
		return { failed: v.kind === 'failed', rolledBack: v.kind === 'failed' && v.rolledBackAt != null };
	};
	const walk = (e: Environment, node: SiteNode | undefined, depth: number): void => {
		if (depth > 6 || seen.has(e)) return;
		seen.add(e);
		const w = waveReady(e), b = w.blocker;
		if (b && b.kind === 'member' && b.what === 'bake' && b.rev) {
			const says = siteSays(b.tier, b.site, b.rev) ?? { failed: b.outcome === 'failed', rolledBack: false };
			if (says.failed) out.set(b.rev, (out.get(b.rev) ?? true) && says.rolledBack);
		}
		if (!node || !topo || w.ready === true) return;
		/* a follower waits on its leader, a leader on the wave before it: whatever failed there failed for this place too */
		for (const up of upstreamOf(topo, node)) if (up.env && up.tier === node.tier) walk(up.env, up, depth + 1);
	};
	walk(env, siteNodeOf(topo as AppTopology | undefined, env), 0);
	return [...out].map(([rev, rolledBack]) => ({ rev, rolledBack }));
}
/** the revisions that failed upstream, rolled back from or not: a COUNT (behind / arriving / waiting) never reads them */
export const waveFailedRevisions = (r: RolloutLike | null | undefined, fleet?: Fleet | null): string[] => waveFailures(r, fleet).map((f) => f.rev);
/** the revisions that failed upstream and whose failing site still RUNS them: only these hold the wave (a rolled-back failure holds nobody) */
export const waveBlockingRevisions = (r: RolloutLike | null | undefined, fleet?: Fleet | null): string[] => waveFailures(r, fleet).filter((f) => !f.rolledBack).map((f) => f.rev);

/** a place's candidates minus what failed here or upstream in its wave chain: THE list behind every "behind" / "arriving" / "waiting" count */
export function liveForPlace<T extends BuildRef>(rollout: RolloutLike | null | undefined, xs: readonly T[], fleet?: Fleet | null): T[] {
	return liveOf(rollout?.status, xs, waveFailedRevisions(rollout, fleet));
}
