import { ApiError, apiJson } from './errors';

export type CommitInfo = {
	sha: string;
	message: string;
	author: string;
	authorUrl: string;
	avatarUrl: string;
	commitDate: string;
	url: string;
};

export type CommitsResponse = {
	// Inferred by the server from the range: 'forward' = commits deployed,
	// 'rollback' = commits reverted (head is behind base; the server re-fetched
	// the swapped range so `commits` lists what was reverted), 'same' = no change.
	direction: 'forward' | 'rollback' | 'same';
	ahead: number;
	behind: number;
	commits: CommitInfo[];
	additions: number;
	deletions: number;
	changedFiles: number;
};

// Distinguishable failure reasons so the UI can show a "Connect GitHub" prompt
// (not-connected) vs. a "you don't have access" note vs. a generic error.
export type CommitsError = 'not_connected' | 'no_access' | 'error';

/**
 * ⛔ IT EXTENDS `ApiError` NOW, AND THAT IS THE WHOLE POINT.
 *
 * A live UX critique measured **16 consecutive 401s** on this endpoint,
 * retried indefinitely, flooding the console with nothing visible on screen.
 * The cause was that this was a plain `Error`: it carried no status, so the
 * query client's retry policy could not tell "the user has not connected
 * GitHub" (an answer — a person has to act) from "the server hiccuped" (worth
 * one more try). Carrying the status makes `isRetryable` correct for free, and
 * `reason` stays for the three different things the UI SAYS.
 */
export class FetchCommitsError extends ApiError {
	reason: CommitsError;
	constructor(reason: CommitsError, message: string, status = 0, detail = '', url = '') {
		super(status, message, detail || message, url);
		this.name = 'FetchCommitsError';
		this.reason = reason;
	}
}

export type GithubStatus = {
	// Whether the server has GitHub App user-auth configured at all.
	configured: boolean;
	// Whether the current user has connected their GitHub account.
	connected: boolean;
	login?: string;
	avatarUrl?: string;
};

/**
 * ⭐ IS THIS RANGE FIXED FOR ALL TIME? THE WHOLE CACHING POLICY TURNS ON IT.
 *
 * A commit sha names an object that cannot change, so the set of commits
 * between two shas — and the diffstat over them — is the same answer today,
 * tomorrow and next year. A branch or tag name is not: `main...release` means
 * something different every time somebody pushes.
 *
 * So the two are cached differently and the distinction is made HERE, once,
 * rather than guessed at four call sites. Strict on purpose: hex only, 7 to 40
 * characters, which is what `pkg/githubcache.IsCommitSHA` accepts on the
 * server. The `@sha1:` form is the OCI spelling of the same fact
 * (`formatRevision` strips it too).
 */
const COMMIT_SHA = /^[0-9a-f]{7,40}$/i;

export function isCommitSha(ref: string | null | undefined): boolean {
	if (!ref) return false;
	const r = ref.includes('@sha1:') ? ref.split('@sha1:')[1] : ref;
	return COMMIT_SHA.test(r);
}

export function isImmutableRange(
	base: string | null | undefined,
	head: string | null | undefined
): boolean {
	return isCommitSha(base) && isCommitSha(head);
}

export const commitsQueryKey = (
	namespace: string,
	name: string,
	base: string,
	head: string,
	cluster?: string
) => ['rollout-commits', namespace, name, base, head, cluster] as const;

export const githubStatusQueryKey = ['github-status'] as const;

export async function fetchCommits(
	namespace: string,
	name: string,
	base: string,
	head: string,
	cluster?: string
): Promise<CommitsResponse> {
	const params = new URLSearchParams({ base, head });
	if (cluster) params.set('cluster', cluster);
	const url = `/api/rollouts/${namespace}/${name}/commits?${params}`;
	const res = await fetch(url).catch(() => null);
	if (!res) {
		throw new FetchCommitsError('error', 'No response from the server', 0, '', url);
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		if (body.error === 'github_not_connected') {
			throw new FetchCommitsError(
				'not_connected',
				'Connect GitHub to see changes',
				res.status,
				'GitHub account not connected',
				url
			);
		}
		if (body.error === 'github_no_access') {
			throw new FetchCommitsError(
				'no_access',
				'You do not have access to this repository',
				res.status,
				body.details || 'No access to this repository',
				url
			);
		}
		throw new FetchCommitsError(
			'error',
			body.error || 'Failed to fetch commit range',
			res.status,
			body.details || body.error || '',
			url
		);
	}
	return (await res.json()) as CommitsResponse;
}

/**
 * ⭐ ONE SENTENCE PER STATE, PRODUCT-WIDE. (2026-09-03)
 *
 * GitHub's absence had three copies saying three different things about the
 * SAME fact: `ChangeVersionModal`'s dialog said *"GitHub did not answer. You
 * can still proceed."*, `/versions/<rev>` said *"Commit message and author
 * need GitHub, which is not connected."*, and the app-detail `Source` card
 * said nothing at all. A reader moving between them could not tell whether
 * "not connected" meant "nobody has set this dashboard up for GitHub at all"
 * or "the request timed out" — two facts with different remedies (an admin
 * has to act on one; the other might just work on retry).
 *
 * So the wording is a function of `GithubStatus`, computed once:
 *
 *   unreachable (the request itself failed)     → "GitHub did not answer."
 *   `configured === false`                      → "GitHub is not configured
 *                                                   for this dashboard."
 *   `configured === true`, `connected === false` → "GitHub is not connected
 *                                                   for this dashboard."
 *
 * The middle case is the one `ChangeVersionModal`'s own `commitsError ===
 * 'not_connected'` branch already draws correctly (it offers a `Connect
 * GitHub` button only when `configured` is true) — this only gives that same
 * distinction a name every OTHER surface can reuse instead of re-deriving it
 * or collapsing it into "not connected" regardless of cause, which is what
 * `/versions/<rev>` did.
 *
 * A caller that wants the dialog's extra clause appends it itself
 * (`+ ' You can still proceed.'`) — that sentence only belongs where a
 * person is mid-action and needs to know the door is still open, which is
 * not true of an informational card.
 */
export function githubAbsenceSentence(
	status: GithubStatus | null | undefined,
	opts: { unreachable?: boolean } = {}
): string {
	if (opts.unreachable) return 'GitHub did not answer.';
	if (status?.configured) return 'GitHub is not connected for this dashboard.';
	return 'GitHub is not configured for this dashboard.';
}

export async function fetchGithubStatus(): Promise<GithubStatus> {
	// Not being able to ask IS the answer here: "GitHub is not available to
	// you". There is nothing for the reader to do about it and nothing to
	// print, so this one legitimately swallows.
	return apiJson<GithubStatus>('/api/auth/github/status').catch(() => ({
		configured: false,
		connected: false
	}));
}

// Full-page navigation to start the OAuth flow (a 302 to GitHub can't be
// followed by fetch). return_to brings the user back to where they were.
export function connectGithub(
	returnTo: string = window.location.pathname + window.location.search
) {
	const params = new URLSearchParams({ return_to: returnTo });
	window.location.href = `/api/auth/github/login?${params}`;
}

/**
 * ⭐ "OPEN A NEW TAB" IS A DESKTOP IDIOM, NOT A MOBILE-SAFE ONE. (2026-09-03,
 * follow-on to the note below — the human reported "there's no way to login
 * to GitHub on mobile.") `window.open()` from an `onclick` handler is still a
 * user gesture on desktop, so the browser allows it; on a phone browser the
 * SAME call is frequently treated as a popup and silently blocked, and even
 * where it is not blocked, a background tab is the wrong shape on a device
 * that has no tab strip to switch back from. Narrow viewport OR a coarse
 * (touch) pointer is enough to call it a phone — `pointer: coarse` alone
 * would miss a narrow *desktop* window resize test, and viewport alone would
 * miss a tablet in a narrow split-view that still has a touch pointer.
 */
function isMobileConnectContext(): boolean {
	if (typeof window === 'undefined') return false;
	const narrow = window.matchMedia?.('(max-width: 639px)').matches ?? window.innerWidth < 640;
	const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
	return narrow || coarse;
}

/**
 * ⛔ NEVER `connectGithub()` FROM AN OPEN DIALOG — ON DESKTOP. (operator
 * walk, 2026-09-03)
 *
 * A live walk pressed `Connect GitHub` inside `ChangeVersionModal`'s
 * COMMITS REVERTED/DEPLOYED block, which called plain `connectGithub()` —
 * a full-page navigation — and it took the whole tab to
 * `/api/auth/github/login?return_to=…`, which 503'd (`GitHub integration
 * not configured`) as raw JSON, no chrome, with the half-filled rollback
 * dialog gone. A caller with an OPEN DIALOG cannot risk that: this opens
 * the exact same OAuth entry in a new tab instead, so a 503 lands
 * somewhere the reader can just close, and the dialog underneath — its
 * typed confirmation, its picked version — survives either way.
 *
 * ⚠️ ON A PHONE THAT PROTECTION BACKFIRES (see `isMobileConnectContext`
 * above): the "new tab" this function promises either never opens (silently
 * blocked) or opens somewhere the reader has to know how to find. So on a
 * phone this falls through to the SAME-TAB navigation `connectGithub()`
 * already does — the OAuth round-trip's own `return_to` is what gets the
 * reader back to the dialog's URL, not tab isolation. The caller (this repo's
 * `ChangeVersionModal`) does not need to know which path ran; both leave
 * `returnTo` pointing at where the reader was.
 */
export function connectGithubInNewTab(
	returnTo: string = window.location.pathname + window.location.search
) {
	if (isMobileConnectContext()) {
		connectGithub(returnTo);
		return;
	}
	const params = new URLSearchParams({ return_to: returnTo });
	window.open(`/api/auth/github/login?${params}`, '_blank', 'noopener,noreferrer');
}

export async function disconnectGithub(): Promise<void> {
	await fetch('/api/auth/github/logout', { method: 'POST' });
}

// First line of a commit message, truncated for compact display.
export function formatCommitMessage(message: string): string {
	const firstLine = message.split('\n')[0];
	return firstLine.length > 80 ? firstLine.slice(0, 77) + '...' : firstLine;
}

/**
 * ⛔ FOUR COPIES OF THIS OPTIONS BLOCK, AND ONE OF THEM WAS WRONG.
 *
 * `CommitSummary`, `ChangeList` and `WaitingBuilds` each carried the same
 * hand-written `staleTime` / `refetchInterval: false` / `retry` triple, and
 * `ChangeVersionModal` — the one screen a person sits in front of while
 * deciding whether to change production — carried NONE of it. It therefore
 * inherited the app defaults (`staleTime: 1000`, `refetchInterval: 5000`) and
 * re-asked GitHub for the SAME IMMUTABLE COMMIT RANGE every five seconds for
 * as long as the modal stayed open. Polling every 5s is right for rollout
 * state, which is what those defaults are for; it is pure waste for a diff
 * between two shas that cannot change.
 *
 * One factory, so the policy cannot drift again:
 *
 *   immutable range (sha…sha)  never stale, kept for an hour
 *   mutable range   (a branch) stale after 5 minutes
 *   either way                 never polled, never refetched on focus, and an
 *                              auth failure is never retried — it cannot be
 *                              retried into success (see `FetchCommitsError`).
 *
 * The server caches the same call conditionally (`pkg/githubcache`), so even a
 * genuine refetch usually costs GitHub a `304` and no rate-limit budget.
 */
export function commitsQueryOptions(args: {
	namespace: string;
	name: string;
	base: string | null | undefined;
	head: string | null | undefined;
	cluster?: string;
	/** Extra condition from the caller, e.g. "the panel is open". */
	enabled?: boolean;
}) {
	const { namespace, name, base, head, cluster, enabled = true } = args;
	const immutable = isImmutableRange(base, head);
	const rangeOk = !!namespace && !!name && !!base && !!head && base !== head;
	return {
		queryKey: commitsQueryKey(namespace, name, base ?? '', head ?? '', cluster),
		queryFn: () => fetchCommits(namespace, name, base!, head!, cluster),
		enabled: enabled && rangeOk,
		staleTime: immutable ? Infinity : 5 * 60_000,
		gcTime: immutable ? 60 * 60_000 : 5 * 60_000,
		refetchInterval: false as const,
		refetchOnWindowFocus: false as const,
		refetchOnReconnect: false as const,
		retry: (failureCount: number, error: unknown) => {
			if (error instanceof FetchCommitsError) return false;
			return failureCount < 1;
		}
	};
}
