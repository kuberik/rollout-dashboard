/**
 * `GET /api/github/repos/:owner/:repo/commits/:sha` — the commit itself
 * (subject, author, committed date, html url), proxied through this
 * dashboard. Backs the change page's BARE-SHA form (CHANGES-2026-09-10.md
 * item 4): a commit that landed with no PR behind it (`commits/:sha/pulls`,
 * `commit-pulls.ts`, resolves nothing) used to render with only the short
 * sha and the owner/repo pair beside it — this endpoint gives that page a
 * real title (the commit subject) and a real subtitle (`committed N ago by
 * @who`) instead. Fetched LAZILY, once per page, only once GitHub is
 * connected, same convention as `commitPullsQueryOptions`.
 *
 * ⚠️ THIS QUERY DOES NOT WAIT ON `commits/:sha/pulls`. Both fire in
 * parallel the moment a sha change page is known and GitHub is connected;
 * the page prefers a resolved PR's own title/merge sentence when one
 * exists and this query's answer otherwise, rather than sequencing one
 * fetch behind the other and paying a round trip nobody asked for on the
 * common "no PR" path.
 */
import { apiPath } from './urls';
import { ApiError } from './errors';

export type Commit = {
	sha: string;
	subject: string;
	author: string;
	committedAt: string;
	htmlUrl: string;
};

export type FetchCommitErrorReason = 'not_connected' | 'not_found' | 'error';

export class FetchCommitError extends ApiError {
	reason: FetchCommitErrorReason;
	constructor(reason: FetchCommitErrorReason, message: string, status = 0, detail = '', url = '') {
		super(status, message, detail || message, url);
		this.name = 'FetchCommitError';
		this.reason = reason;
	}
}

export const commitQueryKey = (owner: string, repo: string, sha: string, cluster?: string) =>
	['github-commit', owner, repo, sha, cluster] as const;

export async function fetchCommit(
	owner: string,
	repo: string,
	sha: string,
	cluster?: string
): Promise<Commit> {
	const url = apiPath(
		cluster,
		`/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`
	);
	const res = await fetch(url).catch(() => null);
	if (!res) {
		throw new FetchCommitError('error', 'No response from the server', 0, '', url);
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		if (res.status === 401 || body.error === 'github_not_connected') {
			throw new FetchCommitError(
				'not_connected',
				'Connect GitHub to see this commit',
				res.status,
				'GitHub account not connected',
				url
			);
		}
		/**
		 * ⛔ FIX PASS ITEM 7, 2026-09-10 — "COMMIT NOT IN THIS REPO", THE ONE
		 * `not_found` MEANING FOR THIS ENDPOINT. A sha that does not exist in
		 * `owner/repo` at all — a scope error, not "this cluster never built
		 * it" (that case is `pr-pipeline.ts`'s own honest "not built yet"
		 * degrade and never reaches this file). A clean `404` per this
		 * endpoint's own contract (`{"error":"not_found","scope":"sha"}`,
		 * confirmed live) — the backend used to wrap GitHub's own `422 No
		 * commit found for SHA: …` in a `502` instead, which this file matched
		 * defensively via a `details` regex; the backend now translates that
		 * upstream 422 into this clean 404 itself (the same shape
		 * `commits/:sha/pulls` already used for "no PR found"), so the
		 * regex fallback is dead and dropped rather than kept as a second,
		 * unreachable path against a bad sha this endpoint no longer sends.
		 */
		if (res.status === 404) {
			throw new FetchCommitError(
				'not_found',
				`Commit ${sha} is not in ${owner}/${repo}`,
				res.status,
				body.details || body.error || '',
				url
			);
		}
		throw new FetchCommitError(
			'error',
			body.error || 'Failed to fetch this commit',
			res.status,
			body.details || body.error || '',
			url
		);
	}
	return (await res.json()) as Commit;
}

/**
 * `enabled` is the caller's job (same convention as
 * `commitPullsQueryOptions`) — this file has no opinion about connection
 * state, it just refuses to fire with an incomplete key.
 */
export function commitQueryOptions(args: {
	owner: string;
	repo: string;
	sha: string;
	cluster?: string;
	enabled?: boolean;
}) {
	const { owner, repo, sha, cluster, enabled = true } = args;
	return {
		queryKey: commitQueryKey(owner, repo, sha, cluster),
		queryFn: () => fetchCommit(owner, repo, sha, cluster),
		enabled: enabled && !!owner && !!repo && !!sha,
		staleTime: 5 * 60_000,
		gcTime: 60 * 60_000,
		refetchInterval: false as const,
		refetchOnWindowFocus: false as const,
		retry: (failureCount: number, error: unknown) => {
			if (error instanceof FetchCommitError) return false;
			return failureCount < 1;
		}
	};
}
