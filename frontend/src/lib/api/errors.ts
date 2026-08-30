/**
 * ⛔ A REQUEST THAT HAS FAILED MUST NOT LOOK LIKE A REQUEST THAT IS LOADING.
 *
 * A live UX critique opened `/rollouts/prod/hello-world-prod/does-not-exist`
 * and watched it render five skeleton placeholders **forever**. Measured: the
 * API answered `500` with
 * `{"details":"failed to get rollout: rollouts.kuberik.com \"does-not-exist\"
 * not found"}` and the page fired the same request **15 times in 35 seconds**,
 * showed no message, offered no way back, and threw the server's own sentence
 * away. The same shape produced **16 consecutive 401s** on `/commits` — a
 * console flood and nothing at all on screen. It is also what the human hit in
 * person: a session expired and the dashboard became a blank shell.
 *
 * Three things were wrong and all three live here now:
 *
 * 1. **The server's explanation was discarded.** Every `fetch` wrapper threw
 *    `new Error('Failed to load rollout')` — a string written months ago by
 *    someone who could not know what would go wrong — while the response body
 *    carried a sentence that named the actual object. `ApiError` keeps
 *    `status` and `detail` so the UI can print what the SERVER said.
 *
 * 2. **`isLoading` was doing double duty.** TanStack's `isLoading` is
 *    `isPending && isFetching`; with unlimited retries a query never leaves
 *    pending, so `{#if loading}` is true for the rest of the session. The cure
 *    is a bounded retry policy, so the query reaches `error` and the page can
 *    branch on it.
 *
 * 3. **The retry policy was `retry: infinity` by default, for every status.**
 *    See `isRetryable` — retrying a 404 or a 401 cannot change the answer.
 */

/** What the Go API returns on failure: `{"error": "...", "details": "..."}`. */
type ApiErrorBody = { error?: string; details?: string };

export class ApiError extends Error {
	/** HTTP status. `0` means the request never got an answer (offline, TLS, DNS). */
	readonly status: number;
	/** The server's own sentence, verbatim. Empty when it did not send one. */
	readonly detail: string;
	readonly url: string;

	constructor(status: number, message: string, detail: string, url: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.detail = detail;
		this.url = url;
	}

	/**
	 * The session is gone or was never there. This is the state that made the
	 * dashboard "a blank shell" — it must be legible, and the way out is a FULL
	 * page navigation, because the oauth2 proxy answers with a 302 that `fetch`
	 * cannot follow.
	 */
	get isAuth(): boolean {
		return this.status === 401 || this.status === 403;
	}

	/**
	 * ⚠️ THE BACKEND ANSWERS 500 FOR A MISSING ROLLOUT. Verified on the live
	 * hub: `GET /api/rollouts/prod/does-not-exist` → `500` with
	 * `details: 'failed to get rollout: rollouts.kuberik.com "does-not-exist"
	 * not found'`. That is a backend bug, but the UI still has to be right
	 * today, and "this object does not exist" is the one 5xx that retrying can
	 * never fix.
	 *
	 * The match is on the SERVER'S OWN WORDS and it only changes the RETRY
	 * POLICY and the HEADLINE — the detail line always prints verbatim, so a
	 * false positive here still shows the reader exactly what came back.
	 */
	get isMissing(): boolean {
		if (this.status === 404) return true;
		return this.status >= 500 && /\bnot found\b/i.test(this.detail);
	}
}

/**
 * THE RETRY POLICY, DECIDED RATHER THAN INHERITED.
 *
 * - **4xx: never.** 400/401/403/404/409/422 are answers, not accidents. The
 *   request was understood and refused; sending it again at 1s intervals for
 *   the rest of the session produces a console flood and zero new information.
 *   401 in particular needs a PERSON (sign in again), and a retry loop is
 *   exactly what hides that from them.
 * - **408 / 429: yes, bounded.** These name a timing problem, which is the one
 *   4xx class that a later attempt genuinely changes.
 * - **5xx: yes, bounded** (see `MAX_RETRIES`) — a controller restart or a
 *   proxy blip is real and self-healing. Except `isMissing`, above.
 * - **No response at all (`status === 0`): yes, bounded.** Offline, a dropped
 *   tunnel, a restarting dev server.
 */
export function isRetryable(error: unknown): boolean {
	if (!(error instanceof ApiError)) return true; // unknown shape — give it the benefit
	if (error.isMissing) return false;
	if (error.status === 0) return true;
	if (error.status === 408 || error.status === 429) return true;
	if (error.status >= 400 && error.status < 500) return false;
	return true;
}

/** Two retries ≈ 1s + 2s. Past that the UI says what happened instead. */
export const MAX_RETRIES = 2;

export function queryRetry(failureCount: number, error: unknown): boolean {
	return isRetryable(error) && failureCount < MAX_RETRIES;
}

export function queryRetryDelay(attemptIndex: number): number {
	return Math.min(1000 * 2 ** attemptIndex, 5000);
}

/**
 * Polling that STOPS when polling is pointless.
 *
 * A `refetchInterval` NUMBER keeps firing after the query has errored, which is
 * how a dead URL produced one request every five seconds for as long as the tab
 * stayed open. As a function it can read the query's own state:
 *
 * - healthy → the caller's interval
 * - errored, not retryable (404 / 401) → **stop**. Nothing about a second
 *   attempt is different, and the UI is already showing the reason and a way out.
 * - errored, retryable (5xx, offline) → back off to `RECOVERY_POLL_MS`, so a
 *   backend that comes back heals the page without a reload, but a backend that
 *   stays down costs one request every 30s instead of six.
 */
export const RECOVERY_POLL_MS = 30000;

export function pollWhenHealthy(ms: number) {
	return (query: { state: { status: string; error: unknown } }): number | false => {
		if (query.state.status !== 'error') return ms;
		return isRetryable(query.state.error) ? RECOVERY_POLL_MS : false;
	};
}

/**
 * ONE HEADLINE PER FAILURE CLASS, IN ORDINARY ENGLISH.
 *
 * The novice test applies: none of these names a mechanism. The server's own
 * `detail` is rendered BELOW this, never instead of it — a headline a reader
 * understands plus the exact sentence an engineer needs.
 *
 * `subject` names the thing that could not be loaded ("this rollout", "the
 * rollout list"), so the headline is about the page and not about HTTP.
 */
export function errorHeadline(error: unknown, subject = 'this page'): string {
	if (!(error instanceof ApiError)) {
		return `Could not load ${subject}`;
	}
	if (error.isAuth) {
		return error.status === 403 ? "You don't have access to this" : 'Your session has expired';
	}
	if (error.isMissing) {
		return `${subject[0].toUpperCase()}${subject.slice(1)} does not exist`;
	}
	if (error.status === 0) {
		return `Could not reach the dashboard server`;
	}
	return `Could not load ${subject}`;
}

/**
 * The one line that says what happens NEXT, so the state is never a dead end.
 */
export function errorConsequence(error: unknown): string {
	if (error instanceof ApiError) {
		if (error.isAuth) {
			return error.status === 403
				? 'Your account can read the cluster but not this namespace. Ask whoever granted your access.'
				: 'Sign in again to carry on. Nothing you were looking at was lost.';
		}
		if (error.isMissing) {
			return 'It may have been deleted, or the address may be wrong.';
		}
	}
	return `The dashboard tried ${MAX_RETRIES + 1} times and gave up. It keeps checking every ${
		RECOVERY_POLL_MS / 1000
	}s, so this clears itself if the server comes back.`;
}

/** The server's own sentence, or nothing. Never invented. */
export function errorDetail(error: unknown): string | undefined {
	if (error instanceof ApiError) {
		return error.detail || (error.status ? `HTTP ${error.status}` : undefined);
	}
	if (error instanceof Error && error.message) return error.message;
	return undefined;
}

/**
 * `fetch` + the whole failure contract in one call. Every API wrapper in
 * `src/lib/api` goes through this so that no call site can quietly invent its
 * own error string again.
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
	let res: Response;
	try {
		res = await fetch(url, init);
	} catch (e) {
		throw new ApiError(0, 'No response from the server', e instanceof Error ? e.message : '', url);
	}
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
		throw new ApiError(
			res.status,
			body.error || `Request failed (${res.status})`,
			body.details || body.error || '',
			url
		);
	}
	return res;
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await apiFetch(url, init);
	return (await res.json()) as T;
}

/**
 * Leaving the SPA on purpose. `fetch` follows the oauth2 proxy's 302 and hands
 * back HTML, so the only thing that can actually re-authenticate a user is a
 * document navigation.
 */
export function reauthenticate(): void {
	window.location.reload();
}
