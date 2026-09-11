import { redirect } from '@sveltejs/kit';

/**
 * `/revisions` → `/changes`.
 *
 * CHANGES-2026-09-10.md §1: the developer's unit is renamed from "Revisions"
 * to "Changes" — sidebar label, page titles, and the canonical URL prefix
 * all move together. This redirect exists so a bookmark, a pasted link, or
 * a person who types the OLD address does not 404, same reasoning as the
 * `/versions` → `/revisions` redirect this route itself used to be the
 * target of (see git history — this is the second time this exact rename
 * has happened; `/versions/+page.ts` now points straight at `/changes`
 * rather than through here, so no address is ever redirected twice).
 * `308 Permanent Redirect` preserves the method and tells crawlers/caches
 * the move is durable.
 */
export const load = () => {
	redirect(308, '/changes');
};
