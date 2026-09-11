/**
 * ⛔ SUPERSEDED, KEPT AS A THIN RE-EXPORT OVER `api/changes.ts`.
 * CHANGES-2026-09-10.md §6 (the palette lane): `/api/github/pulls/mine` is
 * gone — every open-PR half of this module's old contract went with it, the
 * human having rejected open PRs on Home/`/me` outright. What survives is
 * the SHAPE `Navbar.svelte`, `CommandPalette.svelte` and `palette-index.ts`
 * (Lane 4, already landed) import from here — `MyPull` and
 * `myPullsQueryOptions` — so none of those files needs an edit for this
 * lane's work.
 *
 * ⭐ SAME `queryKey` AS `changesQueryOptions`, DELIBERATELY. `myPullsQueryKey`
 * is `changesQueryKey` itself, unchanged — so a page already holding the
 * unfiltered `/github/changes` cache warm (the `/changes` index,
 * `YourChangesCard`) makes `Navbar`'s own `myPullsQueryOptions()` call a
 * `select`-only re-shape of that SAME cache entry, never a second request.
 * Two different `queryFn`s under one key would silently race each other's
 * cached value; `select` is what lets each caller read its own shape off one
 * fetch instead.
 *
 * MERGED PULL REQUESTS ONLY, filtered here to the response's own `user` — a
 * bare commit (`kind: 'commit'`) is dropped, because `MyPull.number` is not
 * optional and `palette-index.ts`'s `buildMergedChangeIndex` builds a
 * PR-shaped palette entry from every row it's handed.
 */
import { changesQueryKey, fetchChanges, FetchChangesError, type ChangesResponse } from './changes';
import { pollWhenHealthy } from './errors';

export type MyPullState = 'open' | 'merged' | 'closed';

export type MyPull = {
	owner: string;
	repo: string;
	number: number;
	title: string;
	htmlUrl: string;
	state: MyPullState;
	/** ISO instant, or `null`. Always `null` now — `/github/changes` never
	 *  carries an open PR's opened-at instant, only a merged change's. */
	openedAt: string | null;
	/** ISO instant, or `null` — only set once `state` is `'merged'`. */
	mergedAt: string | null;
	/** The commit the merge produced. `null` until merged. */
	mergeCommitSha: string | null;
	/** The head branch's own current sha. */
	headSha: string | null;
	/** The branch this PR targets, e.g. `main`. */
	base: string;
	/** ISO instant — what the old endpoint sorted by. Mirrors `mergedAt`
	 *  here (the new feed has no separate "last updated" instant). */
	updatedAt: string;
};

export type MyPullsResponse = {
	user: string;
	repos: string[];
	pulls: MyPull[];
};

export const myPullsQueryKey = changesQueryKey;

function toMyPullsResponse(raw: ChangesResponse): MyPullsResponse {
	const pulls: MyPull[] = raw.changes
		.filter(
			(c) => c.kind === 'pr' && c.number != null && c.author.toLowerCase() === raw.user.toLowerCase()
		)
		.map((c) => ({
			owner: c.owner,
			repo: c.repo,
			number: c.number as number,
			title: c.title,
			htmlUrl: c.htmlUrl,
			state: 'merged' as const,
			openedAt: null,
			mergedAt: c.mergedAt,
			mergeCommitSha: c.mergeCommitSha,
			headSha: c.headSha ?? null,
			base: c.base,
			updatedAt: c.mergedAt
		}));
	return { user: raw.user, repos: raw.repos, pulls };
}

/**
 * `pollWhenHealthy(300000, …)` — identical cadence to `changesQueryOptions`,
 * since this reads the same cache entry. `select` runs on every read, not
 * on every fetch, so re-shaping here costs nothing extra per poll.
 */
export function myPullsQueryOptions(args: { days?: number; cluster?: string; enabled?: boolean } = {}) {
	const { days = 30, cluster, enabled = true } = args;
	return {
		queryKey: changesQueryKey(days, cluster),
		queryFn: () => fetchChanges(days, cluster),
		select: toMyPullsResponse,
		enabled,
		staleTime: 60_000,
		gcTime: 30 * 60_000,
		refetchInterval: pollWhenHealthy(300_000),
		refetchOnWindowFocus: false as const,
		retry: (failureCount: number, error: unknown) => {
			if (error instanceof FetchChangesError) return false;
			return failureCount < 1;
		}
	};
}
