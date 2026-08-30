import { redirect } from '@sveltejs/kit';

/**
 * `/revisions` → `/versions`.
 *
 * THE SIDEBAR SAYS "REVISIONS", THE URL SAYS `/versions`, AND `/revisions` WAS
 * A HARD 404. A live UX critique found it: the product renamed the concept in
 * every place a person reads and in none of the places a person types. Typing
 * the word the navigation shows you should never be an error.
 *
 * A REDIRECT, NOT A RENAME. `/versions` is the canonical address — it is what
 * `revisionPath()` generates, what every existing link and bookmark points at,
 * and what the detail page's `replaceState` canonicalisation settles on. Making
 * `/revisions` canonical would invalidate all of that for a vocabulary fix.
 * This makes the word the sidebar prints WORK without making it a second key.
 */
export const load = () => {
	redirect(308, '/versions');
};
