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

/**
 * ⭐ APPROACH B, ITEM E. `'none'` means the merge sha has no check runs at
 * all (nothing configured, or GitHub simply has nothing to report) — the
 * PR page prints NOTHING for this state (design doc: "nothing for none"),
 * distinct from `'pending'` (checks exist and are still running).
 */
export type PrCheckState = 'success' | 'failure' | 'pending' | 'none';

export type PrChecks = {
	state: PrCheckState;
	total: number;
	failed: number;
	/** Deep link to GitHub's own checks tab, or `null`. */
	url: string | null;
};

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
	 * ⛔ NAME IS THE BACKEND'S, READ IT LITERALLY: `true` means the since-list
	 * was TRUNCATED at the server's 300-commit cap — i.e. `containedIn` is
	 * NOT a complete account, and a revision absent from it is not provably
	 * absent. Only THEN does `pr-pipeline.ts`'s `buildPrPipeline` fall back
	 * to comparing `release.created` against `mergedAt` per release (nil
	 * `created` → unverified, never contained).
	 * `false` means `containedIn` IS a complete, authoritative account of
	 * every commit since the merge: a release whose revision is not in it is
	 * simply not built, no fallback, whatever its `created` timestamp says.
	 */
	containedInAll: boolean;
	/** ISO instant the PR was opened. Present regardless of `state`. */
	openedAt: string | null;
	/** The head branch's own current sha — item 8's "an open PR still has a head". */
	headSha: string | null;
	/** File count from the same `pulls/{n}` response, no second GitHub call. */
	changedFiles: number | null;
	/**
	 * ⭐ APPROACH B, ITEM E. Added to this same endpoint's response (design
	 * doc backend contract) rather than a second call — the PR page's head
	 * band renders ONE "Tests" line off it (`checksSummary`, `pr-cell-copy.ts`).
	 * Optional so a page holding onto data cached before this field existed
	 * (or a backend mid-rollout) degrades to "no line printed" rather than a
	 * runtime error on a missing property.
	 */
	checks?: PrChecks;
};

/** Distinguishable failure reasons, same shape as `github.ts`'s `CommitsError`. */
export type PullFetchErrorReason = 'not_connected' | 'not_found' | 'error';

/**
 * ⛔ Only meaningful when `reason === 'not_found'`. Mirrors the backend's own
 * `scope` field (`main_github_pulls.go`): `'repo'` means no service on this
 * cluster deploys `{owner}/{repo}` at all (the cluster-scope check failed
 * before any GitHub call); `'pr'` means the repo IS deployed here but GitHub
 * says this PR number doesn't exist (or the viewing user can't see it) — a
 * WRONG PR NUMBER, not a wrong/undeployed repo, and the two need different
 * sentences (see `+page.svelte`).
 */
export type PullNotFoundScope = 'repo' | 'pr';

/**
 * ⛔ EXTENDS `ApiError`, SAME REASON AS `FetchCommitsError`: a caller's retry
 * policy needs the STATUS to tell "GitHub is not connected" (an answer — a
 * person has to act) apart from "the server hiccuped" (worth one more try),
 * and `reason` stays for the three different sentences the UI says.
 */
export class FetchPullError extends ApiError {
	reason: PullFetchErrorReason;
	/** Set only when `reason === 'not_found'`. See `PullNotFoundScope`. */
	scope: PullNotFoundScope | null;
	constructor(
		reason: PullFetchErrorReason,
		message: string,
		status = 0,
		detail = '',
		url = '',
		scope: PullNotFoundScope | null = null
	) {
		super(status, message, detail || message, url);
		this.name = 'FetchPullError';
		this.reason = reason;
		this.scope = scope;
	}
}

/**
 * ⭐ RULING 1 (CHANGES-2026-09-10 fix pass, "SUPERSEDED IS LIVE"). Always
 * `true` for a genuinely resolved `pulls/{n}` response: `pr-pipeline.ts`'s
 * `buildPrPipeline` otherwise DEFAULTS `containmentKnown` to
 * `containedIn.length > 0 || containedInAll`, which reads an empty
 * `containedIn` as "we never asked" (the `{containedIn: [], containedInAll:
 * false}` bare-sha stub `changes.ts`'s module doc describes) rather than
 * "verified: zero commits since merge". A real PR fetch never carries that
 * ambiguity — `containedIn`/`containedInAll` here are always the backend's
 * own authoritative computation, empty or not — so a caller building this
 * PR's own `PrPipelineMeta` should set `containmentKnown` from this, never
 * leave it to the default.
 */
export function containmentKnownFor(_pull: Pick<PullRequestInfo, 'containedIn' | 'containedInAll'>): true {
	return true;
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
			const scope: PullNotFoundScope = body.scope === 'pr' ? 'pr' : 'repo';
			throw new FetchPullError(
				'not_found',
				scope === 'pr'
					? `PR #${number} not found in ${owner}/${repo} (or you cannot see it)`
					: `No service on this cluster deploys ${owner}/${repo}`,
				res.status,
				body.details || body.error || '',
				url,
				scope
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
