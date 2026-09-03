import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/versions/<repo>/<key>` → `/revisions/<repo>/<key>`.
 *
 * The deep-link half of the `/versions` → `/revisions` rename — see
 * `../+page.ts`. A revision link bookmarked or pasted under the old address
 * still resolves, and it lands at the canonical one, where `resolveRevision`
 * still accepts a 7-char sha, a 12-char slug, a full 40-char revision or a
 * pre-migration display label.
 */
export const load: PageLoad = ({ params }) => {
	redirect(308, `/revisions/${params.slug}`);
};
