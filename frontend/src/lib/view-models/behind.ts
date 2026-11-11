/**
 * THE ONE "HOW MANY BUILDS BEHIND" (QA #12). A rollout's tab prints "N newer builds" from `status.releaseCandidates`; the Apps tile, the
 * app page's strip and ledger, Environments, the palette and the matrix all print the SAME number, from this function. Only a rollout that
 * carries no such list (`releaseCandidates` absent) falls back to its position in `availableReleases`, and then to the cross-peer rank.
 */
import type { Rollout } from '$lib/../types';
import { availableReleases, releaseCandidates } from '$lib/releases/registry.svelte';
import { releaseSourceRequiredMessage } from '$lib/releases/catalogue';
import { rankBehindBy, type RankVerdict } from './env-rank';
import { liveForPlace, newerReleaseCountLive, type Fleet } from './failed-builds';

type Rel = { tag?: string; version?: string; revision?: string };
type Status = { currentVersion?: string; history?: { bakeStatus?: string | null; version?: { tag?: string; version?: string; revision?: string } | null }[] } | null | undefined;

type Ro = { metadata?: { name?: string; namespace?: string } | null; status?: unknown } | null | undefined;
/** candidates minus the builds that failed here (latest attempt) or upstream in this place's wave chain (failed-builds.ts: the ONE rule) */
const live = <T>(r: Ro, xs: T[], fleet?: Fleet | null): T[] => liveForPlace(r as never, xs as never, fleet) as unknown as T[];

/** the place's own count: `rollout` is the rollout object (metadata + status), `fleet` the Environments + rollouts its wave chain lives in (none: nothing is subtracted) */
export function behindOfStatus(rollout: Ro, fleet?: Fleet | null): number {
	if (releaseSourceRequiredMessage(rollout as unknown as Rollout)) return 0; /* no release source: no builds to be behind */
	const st = rollout?.status as Status;
	if (!st) return 0;
	const n = newerReleaseCountLive(rollout as never, fleet); /* the ONE count: shared with the rank, so no surface can disagree */
	if (n !== null) return n;
	const cands = releaseCandidates(rollout as unknown as Rollout);
	if (Array.isArray(cands)) return live(rollout, cands, fleet).length;
	const rel = (availableReleases(rollout as unknown as Rollout) ?? []) as Rel[];
	const idx = rel.findIndex((r) => r.tag === st.currentVersion || r.version === st.currentVersion);
	return idx < 0 ? 0 : live(rollout, rel.slice(idx + 1), fleet).length;
}

/** a rollout card / matrix cell: its own list when it has one, else the rank's distance */
export function behindOfRollout(rollout: Ro, rank?: RankVerdict | null, fleet?: Fleet | null): number {
	if (releaseSourceRequiredMessage(rollout as unknown as Rollout)) return 0; /* no release source: no builds to be behind */
	const st = rollout?.status as Status;
	const cands = releaseCandidates(rollout as unknown as Rollout);
	if (st && Array.isArray(cands)) return live(rollout, cands, fleet).length;
	return rank ? rankBehindBy(rank) : behindOfStatus(rollout, fleet);
}

/** THE settle rule for every route that prints a behind / newer count off the fleet query: answered, by success or by error (then the list-only count stays). */
export const fleetSettled = (q: { isSuccess: boolean; isError: boolean }): boolean => q.isSuccess || q.isError;

/**
 * The count a ROUTE prints while its fleet query loads: `null` until the fleet has answered (success, or error: then the best list-only count and it
 * stays), never a number that is later corrected by the wave subtraction. A surface given null prints NO count (batch4 #3d, QA8).
 */
export function behindWhenSettled(rollout: Ro, fleet: Fleet | null | undefined, settled: boolean, rank?: RankVerdict | null): number | null {
	if (!settled) return null;
	/* an UNKNOWN lag (the current build aged out of availableReleases: the rank says null) is no count, never 0 / "Up to date" (batch4 #3d, QA17) */
	if (!rank && newerReleaseCountLive(rollout as never, fleet) === null) return null;
	return behindOfRollout(rollout, rank, fleet);
}
