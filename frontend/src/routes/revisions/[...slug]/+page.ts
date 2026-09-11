import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * `/revisions/<repoSlug>` and `/revisions/<repoSlug>/<key>` → the identical
 * shape under `/changes` — CHANGES-2026-09-10.md §1. The whole rest-param
 * slug carries through unchanged; `/changes/[...slug]` resolves it exactly
 * as this route used to (repository page first against the whole slug, a
 * `pull/<n>` tail as a PR-keyed change, everything else as a build key).
 *
 * `308 Permanent Redirect`, one hop — this route no longer renders a page of
 * its own, so nothing here can chain a second redirect.
 */
export const load: PageLoad = ({ params }) => {
	redirect(308, `/changes/${params.slug}`);
};
