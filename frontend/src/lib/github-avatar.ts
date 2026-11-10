/**
 * ⭐ THE ONE AVATAR LOOKUP BY LOGIN, SHARED ACROSS CALLERS THAT ONLY HAVE A
 * NAME. (qa11, 2026-10-11.) `danielreed` read with a real photo on
 * `CommitSummary`/`ChangeVersionModal` (both already had an `avatarUrl` the
 * API handed them for that login) and with the generated monogram on the
 * diff rail's two `<Avatar>` calls (the deploy's `triggeredBy.name` and the
 * commit's `author`) — the identical person, two renderings, because
 * neither call site checked whether the bare login it had WAS the
 * signed-in account `fetchGithubStatus` already names a picture for.
 *
 * `githubStatus` is the one source of "who is this, and what is their
 * picture" for the signed-in account — the same query `GithubConnectButton`
 * already reads to draw the navbar chip. A login that is NOT the signed-in
 * account resolves to `undefined` (no picture to show, correctly: this
 * product never fetches a stranger's avatar), which `Avatar.svelte` then
 * draws as the hashed-colour monogram, same as before.
 */
export function avatarForLogin(
	login: string | null | undefined,
	status: { login?: string | null; avatarUrl?: string | null } | null | undefined
): string | undefined {
	if (!login || !status?.avatarUrl || !status.login) return undefined;
	return login.toLowerCase() === status.login.toLowerCase() ? status.avatarUrl : undefined;
}
