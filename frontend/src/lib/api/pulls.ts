/**
 * `GET /api/github/pulls/:owner/:repo/:number` — the PR-centric view's one
 * network call for a pull request's own facts. See the design doc's backend
 * section (`luka-polish-revisions-pass-6-design-20260910-092839.md`) for the
 * contract this mirrors.
 *
 * ⛔ SCOPED TO THE CLUSTER, ON PURPOSE. The endpoint answers 404 unless
 * `{owner}/{repo}` is a repository some rollout on this cluster (hub or a
 * spoke) actually deploys — this is not a general GitHub proxy. A 404 here
 * therefore means "no service on this cluster deploys this repository", not
 * "this PR does not exist", and the two are told apart the same way
 * `github.ts`'s `FetchCommitsError` already tells "not connected" apart from
 * "no access": a typed reason on the thrown error, never a guess from the
 * status code alone at the call site.
 */
import { apiPath } from './urls';
import { ApiError } from './errors';

export type PrGithubState = 'open' | 'merged' | 'closed';

export type PullRequestInfo = {
	number: number;
	title: string;
	htmlUrl: string;
	author: string;
	state: PrGithubState;
	/** ISO instant, or `null` — only set once `state` is `'merged'`. */
	mergedAt: string | null;
	/** The commit the merge produced. `null` until merged. */
	mergeCommitSha: string | null;
	/** The branch this PR targets, e.g. `main`. */
	base: string;
	/**
	 * Every commit sha this cluster can currently prove carries this PR's
	 * change: `mergeCommitSha` itself plus every commit on `base` since
	 * `mergedAt`, capped server-side at 300 (see `containedInAll`).
	 */
	containedIn: string[];
	/**
	 * `true` when `containedIn` is a COMPLETE account of every commit since
	 * the merge (fewer than the server's pagination cap). `false` means the
	 * list was truncated and a release NOT in it is not provably absent —
	 * `pr-pipeline.ts`'s `buildPrPipeline` falls back to comparing
	 * `release.created` against `mergedAt` in that case, never asserting
	 * containment it cannot back up.
	 */
	containedInAll: boolean;
};

/** Distinguishable failure reasons, same shape as `github.ts`'s `CommitsError`. */
export type PullFetchErrorReason = 'not_connected' | 'not_found' | 'error';

/**
 * ⛔ EXTENDS `ApiError`, SAME REASON AS `FetchCommitsError`: a caller's retry
 * policy needs the STATUS to tell "GitHub is not connected" (an answer — a
 * person has to act) apart from "the server hiccuped" (worth one more try),
 * and `reason` stays for the three different sentences the UI says.
 */
export class FetchPullError extends ApiError {
	reason: PullFetchErrorReason;
	constructor(reason: PullFetchErrorReason, message: string, status = 0, detail = '', url = '') {
		super(status, message, detail || message, url);
		this.name = 'FetchPullError';
		this.reason = reason;
	}
}

export const pullQueryKey = (owner: string, repo: string, number: number, cluster?: string) =>
	['github-pull', owner, repo, number, cluster] as const;

export async function fetchPull(
	owner: string,
	repo: string,
	number: number,
	cluster?: string
): Promise<PullRequestInfo> {
	const url = apiPath(
		cluster,
		`/github/pulls/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${number}`
	);
	const res = await fetch(url).catch(() => null);
	if (!res) {
		throw new FetchPullError('error', 'No response from the server', 0, '', url);
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		// Match how `github.ts` treats the commits endpoint's not-connected
		// case: a 401, OR the server's own `github_not_connected` sentinel —
		// whichever the backend actually sends, this does not need to guess.
		if (res.status === 401 || body.error === 'github_not_connected') {
			throw new FetchPullError(
				'not_connected',
				'Connect GitHub to see this pull request',
				res.status,
				'GitHub account not connected',
				url
			);
		}
		if (res.status === 404) {
			throw new FetchPullError(
				'not_found',
				'No service on this cluster deploys this repository',
				res.status,
				body.details || body.error || '',
				url
			);
		}
		throw new FetchPullError(
			'error',
			body.error || 'Failed to fetch pull request',
			res.status,
			body.details || body.error || '',
			url
		);
	}
	return (await res.json()) as PullRequestInfo;
}

/**
 * ⭐ PR STATE IS AN IMMUTABLE FACT ONCE MERGED OR CLOSED, POLLED-BUT-CHEAP
 * WHILE OPEN. Mirrors `commitsQueryOptions`' own reasoning: an open PR can
 * still change (more commits, a merge, a close), so it is not cached
 * forever — but a merged/closed PR's own record never changes again, and the
 * `containedIn` set is refreshed by the caller's own debounced re-fetch (see
 * `stores/pr-meta.svelte.ts`), never by a blind poll.
 */
export function pullQueryOptions(args: {
	owner: string;
	repo: string;
	number: number;
	cluster?: string;
	enabled?: boolean;
}) {
	const { owner, repo, number, cluster, enabled = true } = args;
	return {
		queryKey: pullQueryKey(owner, repo, number, cluster),
		queryFn: () => fetchPull(owner, repo, number, cluster),
		enabled: enabled && !!owner && !!repo && Number.isFinite(number),
		staleTime: 5 * 60_000,
		gcTime: 60 * 60_000,
		refetchInterval: false as const,
		refetchOnWindowFocus: false as const,
		refetchOnReconnect: false as const,
		retry: (failureCount: number, error: unknown) => {
			if (error instanceof FetchPullError) return false;
			return failureCount < 1;
		}
	};
}
