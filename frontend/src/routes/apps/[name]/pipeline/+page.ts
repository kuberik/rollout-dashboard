import { redirect } from '@sveltejs/kit';
import { href } from '$lib/paths';
import type { PageLoad } from './$types';

/**
 * `/apps/<name>/pipeline` → `/apps/<name>/progress`. The App page's Pipeline tab was renamed Progress (owner, 2026-11-12). Same shape as
 * the rollout `dependencies` → `gates` redirect: 308, the param and the query string (`?release=`, `?calm=1`) carried through.
 */
/** SSR on for this one route: under the dev/SSR server the redirect is a real HTTP 308; under the static build the same load throws in the browser (client redirect), so old links work either way. */
/** NOTE: in production (static build, no server runtime) this redirect is CLIENT-SIDE; the Go server is not involved. */
export const ssr = true;

export const load: PageLoad = ({ params, url }) => {
	redirect(308, href(`/apps/${encodeURIComponent(params.name)}/progress${url.search}`));
};
