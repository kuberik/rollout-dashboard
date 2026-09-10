import { redirect } from '@sveltejs/kit';

/**
 * `/me` → `/changes`.
 *
 * CHANGES-2026-09-10.md §5: `/me` is removed now, not deprecated in place —
 * its shipped form was a flat list of PR titles with a prose tail, which is
 * the exact object the human rejected by name ("just displaying the pull
 * requests doesn't make sense"). It is also `/changes` with extra steps:
 * the same merged-only, 30-day scope, the same viewing user, just without
 * the landing grid, the day grouping or the other filter chips the index
 * used to get.
 *
 * ⭐ COORDINATOR FIX (fourth operator walk, item 5, 2026-09-10). Used to
 * redirect to `/changes?mine` — but Round 3 ruling B ("two views, not one
 * list") retired the `mine`/`pending`/`kind` chips entirely; `/changes`
 * reads no `mine` param and would have silently dropped it. "Your changes"
 * is the FIRST block on `/changes` unconditionally (it needs no filter to
 * find it), so the redirect target is the plain index. `308 Permanent
 * Redirect` so a bookmark or a pasted link keeps working — same shape as
 * `routes/versions/+page.ts`'s own redirect.
 *
 * A GitHub-profile-like `/me` is planned, not built —
 * `.agents-context/design/PROFILE-PLAN-2026-09-10.md`.
 */
export const load = () => {
	redirect(308, '/changes');
};
