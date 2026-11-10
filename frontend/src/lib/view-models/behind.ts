/**
 * THE ONE "HOW MANY BUILDS BEHIND" (QA #12). A rollout's tab prints "N newer builds" from `status.releaseCandidates`; the Apps tile, the
 * app page's strip and ledger, Environments, the palette and the matrix all print the SAME number, from this function. Only a rollout that
 * carries no such list (`releaseCandidates` absent) falls back to its position in `availableReleases`, and then to the cross-peer rank.
 */
import { rankBehindBy, type RankVerdict } from './env-rank';
import { liveForPlace, type Fleet } from './failed-builds';

type Status = { releaseCandidates?: unknown[]; currentVersion?: string; availableReleases?: { tag?: string; version?: string; revision?: string }[]; history?: { bakeStatus?: string | null; version?: { tag?: string; version?: string; revision?: string } | null }[] } | null | undefined;

type Ro = { metadata?: { name?: string; namespace?: string } | null; status?: unknown } | null | undefined;
/** candidates minus the builds that failed here (latest attempt) or upstream in this place's wave chain (failed-builds.ts: the ONE rule) */
const live = <T>(r: Ro, xs: T[], fleet?: Fleet | null): T[] => liveForPlace(r as never, xs as never, fleet) as unknown as T[];

/** the place's own count: `rollout` is the rollout object (metadata + status), `envs` the Environments its wave chain lives in (default: the live source's) */
export function behindOfStatus(rollout: Ro, fleet?: Fleet | null): number {
	const st = rollout?.status as Status;
	if (!st) return 0;
	if (Array.isArray(st.releaseCandidates)) return live(rollout, st.releaseCandidates, fleet).length;
	const rel = st.availableReleases ?? [];
	const idx = rel.findIndex((r) => r.tag === st.currentVersion || r.version === st.currentVersion);
	return idx < 0 ? 0 : live(rollout, rel.slice(idx + 1), fleet).length;
}

/** a rollout card / matrix cell: its own list when it has one, else the rank's distance */
export function behindOfRollout(rollout: Ro, rank?: RankVerdict | null, fleet?: Fleet | null): number {
	const st = rollout?.status as Status;
	if (st && Array.isArray(st.releaseCandidates)) return live(rollout, st.releaseCandidates, fleet).length;
	return rank ? rankBehindBy(rank) : behindOfStatus(rollout, fleet);
}
