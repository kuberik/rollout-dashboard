/**
 * `GET /api/github/changes?days=30` — every MERGED change (a pull request or
 * a bare commit on the base branch) across every repository this cluster
 * deploys, by everyone, newest first. CHANGES-2026-09-10.md §3's "the
 * developer's unit" — backs the `/changes` index and, filtered client-side to
 * the viewing user's own `author`, Home's "Your changes" card.
 *
 * ⛔ ALWAYS FETCHED UNFILTERED (no `mine=`, no `repo=`). The backend accepts
 * both, but every filter this product offers (`Mine`, one chip per repo,
 * `Not yet everywhere`, `?q=`) is client-side over ONE cached response — the
 * same "no new network cost" rule `my-pulls.ts` documents for its own
 * `?mine=1` cache. Two call sites asking for different server-side filters
 * would be two cache entries and two polls for what is, underneath, one
 * list; asking for the same unfiltered shape everywhere means the index and
 * the Home card (and the palette's own count, `my-pulls.ts`'s thin
 * re-export) are always reading the exact same fetch.
 *
 * ⭐ A TRANSIENT UPSTREAM 502 IS PASSED THROUGH AS A 502, deliberately not
 * swallowed into a softer status — `isRetryable` (`errors.ts`) already
 * treats every 5xx as recoverable, so `pollWhenHealthy` backs off to its own
 * `RECOVERY_POLL_MS` and tries again; the query keeps its last-fetched data
 * on screen in the meantime (TanStack's own default), never a blank page for
 * a hiccup one poll wide.
 */
import { apiPath } from './urls';
import { ApiError } from './errors';
import { pollWhenHealthy } from './errors';

export type ChangeKind = 'pr' | 'commit';

export type Change = {
	owner: string;
	repo: string;
	kind: ChangeKind;
	/** Set only when `kind === 'pr'`. */
	number?: number;
	title: string;
	htmlUrl: string;
	author: string;
	/** ISO instant this change merged (a PR) or was committed (a bare commit). */
	mergedAt: string;
	mergeCommitSha: string;
	/** The PR's own head branch sha, when `kind === 'pr'`. */
	headSha?: string;
	/** The branch this change landed on, e.g. `main`. */
	base: string;
	changedFiles?: number;
	/** Every sha `mergeCommitSha` is itself, or a later commit "since" it on
	 *  `base` — the same set `pr-pipeline.ts`'s `buildContainedSet` folds in,
	 *  capped at 300. */
	containedIn: string[];
	/** `false` means `containedIn` is a COMPLETE account since this change's
	 *  own merge — absence from it is authoritative. `true` means the list
	 *  was truncated at 300 (`pr-pipeline.ts`'s own `containment()` doc). */
	containedInAll: boolean;
};

export type ChangesResponse = {
	user: string;
	repos: string[];
	/** ISO instant — the start of the window this response covers. */
	since: string;
	changes: Change[];
};

export type ChangesFetchErrorReason = 'not_connected' | 'not_found' | 'error';

/**
 * ⛔ EXTENDS `ApiError`, SAME REASONING AS `FetchMyPullsError`: carries
 * `status` so the retry policy tells "connect GitHub" (an answer) apart from
 * "the server hiccuped" (worth another try via `pollWhenHealthy`, not an
 * immediate retry storm). The one 404 this endpoint sends means no rollout on
 * this cluster names a GitHub source at all.
 */
export class FetchChangesError extends ApiError {
	reason: ChangesFetchErrorReason;
	constructor(reason: ChangesFetchErrorReason, message: string, status = 0, detail = '', url = '') {
		super(status, message, detail || message, url);
		this.name = 'FetchChangesError';
		this.reason = reason;
	}
}

export const changesQueryKey = (days: number, cluster?: string) => ['github-changes', days, cluster] as const;

export async function fetchChanges(days = 30, cluster?: string): Promise<ChangesResponse> {
	const url = `${apiPath(cluster, '/github/changes')}?days=${days}`;
	const res = await fetch(url).catch(() => null);
	if (!res) {
		throw new FetchChangesError('error', 'No response from the server', 0, '', url);
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		if (res.status === 401 || body.error === 'github_not_connected') {
			throw new FetchChangesError(
				'not_connected',
				'Connect GitHub to see what merged across the repos this cluster deploys',
				res.status,
				'GitHub account not connected',
				url
			);
		}
		if (res.status === 404) {
			throw new FetchChangesError(
				'not_found',
				'No repository on this cluster is linked to GitHub',
				res.status,
				body.details || body.error || '',
				url
			);
		}
		throw new FetchChangesError(
			'error',
			body.error || 'Failed to load changes',
			res.status,
			body.details || body.error || '',
			url
		);
	}
	return (await res.json()) as ChangesResponse;
}

/**
 * ⭐ `pollWhenHealthy(300000, …)` — THE SAME 5-MINUTE CADENCE `my-pulls.ts`
 * ALREADY USES for what is, in every way that matters, the same kind of
 * fetch (a bounded GitHub lookback, ETag'd `private, no-cache` server-side so
 * a quiet 5 minutes costs a 304, ends on a 4xx that names a person's own
 * action). `not_connected`/`not_found` stop polling for free — both throw
 * with a 4xx `status`, `isRetryable` says no.
 */
export function changesQueryOptions(args: { days?: number; cluster?: string; enabled?: boolean } = {}) {
	const { days = 30, cluster, enabled = true } = args;
	return {
		queryKey: changesQueryKey(days, cluster),
		queryFn: () => fetchChanges(days, cluster),
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
