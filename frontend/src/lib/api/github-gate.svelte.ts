/**
 * The ONE gate in front of every GitHub-backed request (QA2 #4). `fetchGithubStatus` records what the server said; the query-options
 * factories (`commitsQueryOptions`, `commitQueryOptions`) read it, so a page never asks GitHub for commits once the dashboard is known
 * not to be connected (each ask was a 401/400 and a console error). Unknown (status not answered yet, or the status call itself failed:
 * `configured === null`) never blocks. It is reactive, so connecting GitHub re-enables the queries without a reload.
 */
const state = $state<{ disconnected: boolean; pending: number; settled: boolean }>({ disconnected: false, pending: 0, settled: false });

/** a status request is in flight: hold GitHub asks until it answers (otherwise the first load asks, and fails, before the answer lands) */
export function githubStatusStarted(): void { state.pending++; }

export function recordGithubStatus(s: { configured?: boolean | null; connected?: boolean } | null | undefined): void {
	state.pending = Math.max(0, state.pending - 1);
	state.settled = true;
	state.disconnected = !!s && s.configured !== null && s.configured !== undefined ? !s.connected : false;
}
/** true only when the server has said GitHub is not connected / not configured */
export const githubKnownDisconnected = (): boolean => state.disconnected;
/** what every GitHub-backed ask checks: known not connected, or the status answer is still on its way */
export const githubAskHeld = (): boolean => state.disconnected || state.pending > 0;
/** the status has answered at least once */
export const githubStatusSettled = (): boolean => state.settled;
