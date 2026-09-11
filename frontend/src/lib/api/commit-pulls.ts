/**
 * `GET /api/github/repos/:owner/:repo/commits/:sha/pulls` — the pull
 * request(s) associated with a single commit (GitHub's own "list pull
 * requests associated with a commit", proxied through this dashboard).
 * Backs the revisions build page's "Pull requests" line (design doc,
 * Approach B, item D) — fetched LAZILY, once per page, only once GitHub is
 * connected, never a per-row cost on any list.
 *
 * ⛔ AN EMPTY RESULT IS NOT AN ERROR. GitHub's own API returns `200` with
 * `[]` when no pull request produced this commit — this module's callers
 * print "no pull request found for this commit" for an empty array, not a
 * failure state. The only failures this throws are the shared not-connected
 * / not-on-this-cluster / generic trio every other `api/*.ts` PR module
 * already uses.
 */
import { apiPath } from './urls';
import { ApiError } from './errors';

export type CommitPullState = 'open' | 'merged' | 'closed';

export type CommitPull = {
	number: number;
	title: string;
	htmlUrl: string;
	state: CommitPullState;
	mergedAt: string | null;
	author: string;
};

export type CommitPullsFetchErrorReason = 'not_connected' | 'not_found' | 'error';

export class FetchCommitPullsError extends ApiError {
	reason: CommitPullsFetchErrorReason;
	constructor(reason: CommitPullsFetchErrorReason, message: string, status = 0, detail = '', url = '') {
		super(status, message, detail || message, url);
		this.name = 'FetchCommitPullsError';
		this.reason = reason;
	}
}

export const commitPullsQueryKey = (owner: string, repo: string, sha: string, cluster?: string) =>
	['github-commit-pulls', owner, repo, sha, cluster] as const;

export async function fetchCommitPulls(
	owner: string,
	repo: string,
	sha: string,
	cluster?: string
): Promise<CommitPull[]> {
	const url = apiPath(
		cluster,
		`/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}/pulls`
	);
	const res = await fetch(url).catch(() => null);
	if (!res) {
		throw new FetchCommitPullsError('error', 'No response from the server', 0, '', url);
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		if (res.status === 401 || body.error === 'github_not_connected') {
			throw new FetchCommitPullsError(
				'not_connected',
				'Connect GitHub to see pull requests for this commit',
				res.status,
				'GitHub account not connected',
				url
			);
		}
		if (res.status === 404) {
			throw new FetchCommitPullsError(
				'not_found',
				`No service on this cluster deploys ${owner}/${repo}`,
				res.status,
				body.details || body.error || '',
				url
			);
		}
		throw new FetchCommitPullsError(
			'error',
			body.error || 'Failed to fetch pull requests for this commit',
			res.status,
			body.details || body.error || '',
			url
		);
	}
	return (await res.json()) as CommitPull[];
}

/**
 * `enabled` is the caller's job (the design doc: "lazily fetch … once per
 * page, only when GitHub is connected") — this file has no opinion about
 * connection state, it just refuses to fire with an incomplete key.
 */
export function commitPullsQueryOptions(args: {
	owner: string;
	repo: string;
	sha: string;
	cluster?: string;
	enabled?: boolean;
}) {
	const { owner, repo, sha, cluster, enabled = true } = args;
	return {
		queryKey: commitPullsQueryKey(owner, repo, sha, cluster),
		queryFn: () => fetchCommitPulls(owner, repo, sha, cluster),
		enabled: enabled && !!owner && !!repo && !!sha,
		staleTime: 5 * 60_000,
		gcTime: 60 * 60_000,
		refetchInterval: false as const,
		refetchOnWindowFocus: false as const,
		retry: (failureCount: number, error: unknown) => {
			if (error instanceof FetchCommitPullsError) return false;
			return failureCount < 1;
		}
	};
}
