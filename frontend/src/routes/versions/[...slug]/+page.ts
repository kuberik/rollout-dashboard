import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/versions/<repo>/<key>` → `/changes/<repo>/<key>`.
 *
 * RETARGETED 2026-09-10 (CHANGES-2026-09-10.md §1) — see `../+page.ts`'s own
 * comment: this used to point at `/revisions/...`, which is itself only a
 * redirect now, so pointing here directly keeps the hop count at one. A
 * revision link bookmarked or pasted under the old `/versions` address still
 * resolves, and it lands at the canonical one, where `resolveRevision` still
 * accepts a 7-char sha, a 12-char slug, a full 40-char revision or a
 * pre-migration display label.
 */
export const load: PageLoad = ({ params }) => {
	redirect(308, `/changes/${params.slug}`);
};
