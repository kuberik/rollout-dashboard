/**
 * `GET /api/github/pulls/mine?days=30` — the viewing operator's own recent
 * pull requests across every repository this cluster deploys (hub AND every
 * spoke — the same fan-in `main_fanout.go` already unions rollouts across,
 * per the design doc's Approach B). Backs Home's "Your pull requests" card
 * and `/me`; the palette's title-matching (`palette-index.ts`'s
 * `buildMyPullTitlePaletteResults` / `prResultTitle`) reads the same cached
 * response rather than fetching it again.
 *
 * ⛔ NOT SCOPED BY `:owner/:repo` THE WAY `pulls/:owner/:repo/:number` IS —
 * this endpoint decides the repo set itself (every distinct `status.source`
 * the viewing user can see) and hands it back as `repos`, so no caller has
 * to enumerate them first.
 *
 * ⭐ SORTED BY THE BACKEND (`updatedAt` desc) — this module does not re-sort.
 */
import { apiPath } from './urls';
import { ApiError } from './errors';
import { pollWhenHealthy } from './errors';

export type MyPullState = 'open' | 'merged' | 'closed';

export type MyPull = {
	owner: string;
	repo: string;
	number: number;
	title: string;
	htmlUrl: string;
	state: MyPullState;
	/** ISO instant, or `null`. */
	openedAt: string | null;
	/** ISO instant, or `null` — only set once `state` is `'merged'`. */
	mergedAt: string | null;
	/** The commit the merge produced. `null` until merged. */
	mergeCommitSha: string | null;
	/** The head branch's own current sha. */
	headSha: string | null;
	/** The branch this PR targets, e.g. `main`. */
	base: string;
	/** ISO instant — what the response is sorted by (desc). */
	updatedAt: string;
};

export type MyPullsResponse = {
	user: string;
	repos: string[];
	pulls: MyPull[];
};

export type MyPullsFetchErrorReason = 'not_connected' | 'not_found' | 'error';

/**
 * ⛔ EXTENDS `ApiError`, SAME REASONING AS `FetchPullError`/`FetchCommitsError`:
 * carries `status` so the retry policy can tell "connect GitHub" (an answer)
 * apart from "the server hiccuped" (worth one more try), and `reason` stays
 * for the UI's two different sentences. The one 404 this endpoint can send
 * means no rollout on this cluster names a GitHub source at all — there is
 * nothing to look up, which is a different fact from "connected, but zero
 * PRs in the last 30 days" (a normal, empty `200`).
 */
export class FetchMyPullsError extends ApiError {
	reason: MyPullsFetchErrorReason;
	constructor(reason: MyPullsFetchErrorReason, message: string, status = 0, detail = '', url = '') {
		super(status, message, detail || message, url);
		this.name = 'FetchMyPullsError';
		this.reason = reason;
	}
}

export const myPullsQueryKey = (days: number, cluster?: string) =>
	['github-my-pulls', days, cluster] as const;

export async function fetchMyPulls(days = 30, cluster?: string): Promise<MyPullsResponse> {
	const url = `${apiPath(cluster, '/github/pulls/mine')}?days=${days}`;
	const res = await fetch(url).catch(() => null);
	if (!res) {
		throw new FetchMyPullsError('error', 'No response from the server', 0, '', url);
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		if (res.status === 401 || body.error === 'github_not_connected') {
			throw new FetchMyPullsError(
				'not_connected',
				'Connect GitHub to see your pull requests',
				res.status,
				'GitHub account not connected',
				url
			);
		}
		if (res.status === 404) {
			throw new FetchMyPullsError(
				'not_found',
				'No repository on this cluster is linked to GitHub',
				res.status,
				body.details || body.error || '',
				url
			);
		}
		throw new FetchMyPullsError(
			'error',
			body.error || 'Failed to fetch your pull requests',
			res.status,
			body.details || body.error || '',
			url
		);
	}
	return (await res.json()) as MyPullsResponse;
}

/**
 * ⭐ `pollWhenHealthy(300000, …)` — THE DESIGN DOC'S OWN CADENCE (5 minutes),
 * unchanged from the task, and it ALREADY STOPS on `not_connected` /
 * `not_found` for free: both throw with a 4xx `status`, `isRetryable` says
 * no, and `pollWhenHealthy` reads that off the query's own error state. The
 * server ETags the response (per the design doc) so a quiet 5 minutes costs
 * a 304, not a re-parse — nothing extra to do client-side for that half;
 * `If-None-Match` on a plain `fetch` is the browser HTTP cache's job, same
 * as every other conditional-request endpoint this app already calls this
 * way (no client here hand-rolls ETag storage).
 */
export function myPullsQueryOptions(args: { days?: number; cluster?: string; enabled?: boolean } = {}) {
	const { days = 30, cluster, enabled = true } = args;
	return {
		queryKey: myPullsQueryKey(days, cluster),
		queryFn: () => fetchMyPulls(days, cluster),
		enabled,
		staleTime: 60_000,
		gcTime: 30 * 60_000,
		refetchInterval: pollWhenHealthy(300_000),
		refetchOnWindowFocus: false as const,
		retry: (failureCount: number, error: unknown) => {
			if (error instanceof FetchMyPullsError) return false;
			return failureCount < 1;
		}
	};
}
