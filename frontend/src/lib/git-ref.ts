/**
 * The ref a GitHub "View on GitHub" link points at: the REVISION (commit sha)
 * when the version carries one, else the version tag.
 *
 * (2026-09-10, human: "View on GitHub buttons should use revision instead of
 * version.") A tag can be re-pointed or missing on the remote; a sha is the
 * thing that was actually built. Revisions may arrive as `<tag>@sha1:<sha>`
 * (Flux image policy form) — only the sha part is a git ref.
 */
export function gitRef(revision: string | null | undefined, version: string): string {
	const sha = revisionSha(revision);
	return sha || version;
}

export function revisionSha(revision: string | null | undefined): string {
	if (!revision) return '';
	const at = revision.indexOf('@sha1:');
	const sha = at >= 0 ? revision.slice(at + '@sha1:'.length) : revision;
	return /^[0-9a-f]{7,64}$/i.test(sha) ? sha : '';
}
