/**
 * THE ONE "A FAILED BUILD IS NOT COMING" COUNT RULE (batch4 #1), a thin wrapper over `failedHereVerdict` (deploy-risk.ts: a build's MOST RECENT
 * attempt in this place failed; a retry that later passed is clean). It governs the COUNTS only: arriving, inbound, behind and waiting. The
 * controller keeps a failed build as a release candidate, and clearing a pin or deploying it again really redeploys it, so
 * `promotionCandidates`, ClearPinModal, auto-deploy and the rollout detail's "failed here" row do NOT read this.
 * `waveRevs` = the short shas an Environment's own `bake failed on <rev>` blocker names (the wave chain, batch4 #3b).
 */
import { failedHereVerdict, shaNamesBuild, type BuildRef } from './deploy-risk';

type Status = { history?: readonly { bakeStatus?: string | null; timestamp?: string | null; version?: BuildRef | null }[] | null } | null | undefined;

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
