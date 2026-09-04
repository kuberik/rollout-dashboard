/**
 * ⭐ THE BACKEND CONTRACT AS OF 33601e1 — PATH FORM, NOT QUERY FORM.
 *
 * `GET|POST /api/clusters/{cluster}/<rest>` is now equivalent to
 * `/api/<rest>?cluster={cluster}` for every route (the hub-local cluster's
 * own name works in the path form too — it is not a spoke-only shape). The
 * query form still works but is DEPRECATED; every URL builder in
 * `src/lib/api/**` goes through `apiPath` now instead of hand-rolling
 * `?cluster=` (see the call sites this replaced: `fetchRollout`,
 * `fetchRolloutPermissions`, `fetchRolloutTests` in `rollouts.ts`;
 * `fetchScheduleWindow`, `fetchScheduleObjects`, `fetchNetworkSchedules` in
 * `schedules.ts`; `fetchCommits` in `github.ts`; `createLogsStreamUrl` in
 * `logs.ts`).
 *
 * ⛔ ONE ROUTE IS DELIBERATELY NOT ELIGIBLE: `GET /api/events/stream` is
 * 404 under `/api/clusters/{cluster}/events/stream` — the change stream is
 * hub-wide (it fans in every spoke itself; see `./events`'s own doc
 * comment), so `./events.ts` does not and must not call this helper.
 *
 * `path` starts with `/` (e.g. `/rollouts/${ns}/${name}`, or
 * `/schedules?namespace=all` when the caller's own query string is easier to
 * write inline than to append after the call) — either way it lands after
 * the `/api` or `/api/clusters/<cluster>` prefix unchanged, exactly as the
 * old `/api${path}` form did.
 */
export function apiPath(cluster: string | undefined | null, path: string): string {
	if (cluster) return `/api/clusters/${encodeURIComponent(cluster)}${path}`;
	return `/api${path}`;
}
