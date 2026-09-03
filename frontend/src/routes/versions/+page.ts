import { redirect } from '@sveltejs/kit';

/**
 * `/versions` → `/revisions`.
 *
 * (2026-09-03, vocabulary pass.) The concept was "Revisions" in the nav, the
 * URL, the chip labels and everywhere a person reads it — except the address
 * bar, which said `/versions`, and the object itself, which the body text
 * called a "version"/"tag"/"release" almost as often as a "build". This pass
 * closed that: the nav label ("Revisions"), the page's own labels, and the
 * canonical URL all now agree. `revisionPath()`/`versionPath()`
 * (`lib/version-utils.ts`) generate `/revisions/...` directly.
 *
 * This redirect exists so a bookmark, a pasted link, or a person who types
 * the OLD address does not 404. `308 Permanent Redirect` preserves the
 * method and tells crawlers/caches the move is durable, which it is — this
 * is the second time this exact pair of routes has traded which one is
 * canonical (see git history), and this time the rename goes all the way
 * through: nav, URL, and body copy agree, so there is no reason to reverse
 * it again.
 */
export const load = () => {
	redirect(308, '/revisions');
};
