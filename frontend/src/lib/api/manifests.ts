import { apiPath } from '$lib/api/urls';
import { ApiError, apiJson } from '$lib/api/errors';

/** One build's rendered manifest files, keyed by file name. */
export type ManifestFiles = Record<string, string>;

/**
 * Fetch one build's manifest files. `null` means the server holds none for
 * that build (the registry dropped it, or this source never recorded one):
 * an honest absence, not an error. Any other failure throws.
 */
export async function fetchManifest(
	cluster: string | undefined,
	namespace: string,
	name: string,
	tag: string
): Promise<ManifestFiles | null> {
	try {
		const res = await apiJson<{ files?: ManifestFiles }>(
			apiPath(cluster, `/rollouts/${namespace}/${name}/manifest/${encodeURIComponent(tag)}`)
		);
		return res?.files ?? null;
	} catch (e) {
		if (e instanceof ApiError && e.isMissing) return null;
		throw e;
	}
}

export function manifestQueryKey(
	cluster: string | undefined,
	namespace: string,
	name: string,
	tag: string
) {
	return ['manifest', cluster ?? '', namespace, name, tag] as const;
}
