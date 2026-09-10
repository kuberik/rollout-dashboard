import { redirect } from '@sveltejs/kit';

/**
 * `/me` → `/changes?mine`.
 *
 * CHANGES-2026-09-10.md §5: `/me` is removed now, not deprecated in place —
 * its shipped form was a flat list of PR titles with a prose tail, which is
 * the exact object the human rejected by name ("just displaying the pull
 * requests doesn't make sense"). It is also `/changes?mine` with extra
 * steps: the same merged-only, 30-day scope, the same viewing user, just
 * without the landing grid, the day grouping or the other filter chips the
 * index gets. `308 Permanent Redirect` so a bookmark or a pasted link keeps
 * working — same shape as `routes/versions/+page.ts`'s own redirect.
 *
 * A GitHub-profile-like `/me` is planned, not built —
 * `.agents-context/design/PROFILE-PLAN-2026-09-10.md`.
 */
export const load = () => {
	redirect(308, '/changes?mine');
};
