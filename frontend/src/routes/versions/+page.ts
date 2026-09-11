import { redirect } from '@sveltejs/kit';

/**
 * `/versions` → `/changes`.
 *
 * (2026-09-03, vocabulary pass; RETARGETED 2026-09-10, CHANGES-2026-09-10.md
 * §1.) This route was `/versions` → `/revisions`'s own redirect; "Revisions"
 * has since been renamed to "Changes" (the developer's unit — a merged PR, a
 * bare commit, a manifest bump are all "changes"), so this now points
 * straight at the CURRENT canonical address rather than through
 * `/revisions`, which is itself only a redirect now. **Never chained
 * twice**: retargeting this route directly is what keeps a `/versions` link
 * a single hop instead of two.
 *
 * `308 Permanent Redirect` preserves the method and tells crawlers/caches
 * the move is durable.
 */
export const load = () => {
	redirect(308, '/changes');
};
