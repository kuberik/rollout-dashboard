/**
 * The browsable tree URL of a rollout's `status.source` at a ref.
 *
 * Sources arrive in every shape a person (or the mock) types: with or
 * without a scheme (`github.com/org/repo`), as an SSH remote
 * (`git@github.com:org/repo.git`), with a `.git` suffix or a trailing
 * slash. A source with no scheme used to become a RELATIVE href and 404
 * inside the dashboard (qa9 B3), so the scheme is always made explicit.
 * Returns '' when there is no source.
 */
export function sourceTreeUrl(source: string | null | undefined, ref: string): string {
	let url = (source ?? '').trim();
	if (!url) return '';
	const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(url);
	if (ssh) url = `https://${ssh[1]}/${ssh[2]}`;
	else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `https://${url.replace(/^\/+/, '')}`;
	url = url.replace(/\/+$/, '').replace(/\.git$/, '');
	return `${url}/tree/${ref}`;
}
