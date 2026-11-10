/**
 * THE ONE "HOW MANY BUILDS BEHIND" (QA #12). A rollout's tab prints "N newer builds" from `status.releaseCandidates`; the Apps tile, the
 * app page's strip and ledger, Environments, the palette and the matrix all print the SAME number, from this function. Only a rollout that
 * carries no such list (`releaseCandidates` absent) falls back to its position in `availableReleases`, and then to the cross-peer rank.
 */
import { rankBehindBy, type RankVerdict } from './env-rank';

type Status = { releaseCandidates?: unknown[]; currentVersion?: string; availableReleases?: { tag?: string; version?: string }[] } | null | undefined;

export function behindOfStatus(st: Status): number {
	if (!st) return 0;
	if (Array.isArray(st.releaseCandidates)) return st.releaseCandidates.length;
	const rel = st.availableReleases ?? [];
	const idx = rel.findIndex((r) => r.tag === st.currentVersion || r.version === st.currentVersion);
	return idx < 0 ? 0 : rel.length - 1 - idx;
}

/** a rollout card / matrix cell: its own list when it has one, else the rank's distance */
export function behindOfRollout(rollout: { status?: unknown } | null | undefined, rank?: RankVerdict | null): number {
	const st = rollout?.status as Status;
	if (st && Array.isArray(st.releaseCandidates)) return st.releaseCandidates.length;
	return rank ? rankBehindBy(rank) : behindOfStatus(st);
}
