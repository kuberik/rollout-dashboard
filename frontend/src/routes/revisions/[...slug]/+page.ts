import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/revisions/<repo>/<key>` → `/versions/<repo>/<key>`.
 *
 * The deep-link half of the `/revisions` alias. A revision link pasted with the
 * word the sidebar prints resolves instead of 404ing, and it arrives at the
 * canonical address — where `resolveRevision` still accepts a 7-char sha, a
 * 12-char slug, a full 40-char revision or a pre-migration display label.
 */
export const load: PageLoad = ({ params }) => {
	redirect(308, `/versions/${params.slug}`);
};
