import { redirect } from '@sveltejs/kit';
import { href } from '$lib/paths';
import type { PageLoad } from './$types';

/**
 * `/rollouts/<cluster>/<namespace>/<name>/dependencies` → `.../gates`.
 *
 * (2026-10-08.) This tab was renamed from "Dependencies" to "Gates" — it now
 * draws every kind of gate on one rollout, both directions, not only the
 * cross-service contract edges the old name implied. The whole-NETWORK page
 * at `/dependencies` is untouched; only this per-rollout tab moved.
 *
 * Same shape as `routes/versions/+page.ts`'s own redirect: `308 Permanent
 * Redirect` so a bookmark or a pasted link under the old address still
 * resolves, with the cluster/namespace/name params and any query string
 * (e.g. `?deploy=<revision>`) carried through untouched.
 */
export const load: PageLoad = ({ params, url }) => {
	const cluster = encodeURIComponent(params.cluster);
	const namespace = encodeURIComponent(params.namespace);
	const name = encodeURIComponent(params.name);
	redirect(308, href(`/rollouts/${cluster}/${namespace}/${name}/gates${url.search}`));
};
