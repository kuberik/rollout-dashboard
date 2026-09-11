import { redirect } from '@sveltejs/kit';
import { changePath } from '$lib/pr-ref';
import type { PageLoad } from './$types';

/**
 * `/pr/<owner>/<repo>/<number>` → `/changes/<repoSlug>/pull/<number>`.
 *
 * ⛔ SUPERSEDED but PERMANENT (CHANGES-2026-09-10.md §1): the human keeps PR
 * tabs open "for longer time", so this route 308s to the change page's
 * address forever and is never deleted — a dead tab is the feature failing
 * at the moment it is used. `changePath` (`lib/pr-ref.ts`) is the one place
 * that builds this address; this route does not re-derive it.
 */
export const load: PageLoad = ({ params }) => {
	const number = Number(params.number);
	redirect(308, changePath(params.owner, params.repo, { number }));
};
