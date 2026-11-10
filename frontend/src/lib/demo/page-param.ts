/**
 * `?page=` — THE DEMO BUILD'S ONLY ROUTING CONCESSION, AND ITS ONE SHARP EDGE.
 *
 * kuberik.com serves the demo build as static files under `/demo/`, and a
 * static host cannot rewrite `/demo/rollouts/...` to `/demo/index.html`. So
 * each showcase iframe opens `/demo/?page=<app path>` and the root layout's
 * `load` performs the rewrite itself, before anything renders.
 *
 * ⛔ THE PARAMETER IS AN OPEN REDIRECT UNLESS IT IS VALIDATED. `page` arrives
 * from the URL, which means from whoever wrote the link. `//evil.com` is a
 * PROTOCOL-RELATIVE URL, not a path: the browser resolves it to
 * `https://evil.com`, so a naive `page.startsWith('/')` check hands an
 * attacker a redirect off-site under kuberik.com's own link. A backslash is
 * the same bug wearing a different hat — several URL parsers normalise
 * `/\evil.com` to `//evil.com`. Today a non-empty `base` masks both (they land
 * under `/demo/`), which is exactly the kind of accident that stops being true
 * the day someone builds the demo without `DEMO_BASE`.
 *
 * So: EXACTLY ONE leading slash, the next character may not be another slash
 * or a backslash, and no segment may be `..`. Anything else is ignored rather
 * than corrected — a malformed `page` leaves the visitor on Home, which is a
 * safe page, and the showcase looks wrong in a way its author will notice.
 *
 * ⚠️ `..` IS REJECTED EVEN THOUGH IT CANNOT LEAVE THE ORIGIN. An earlier
 * version of this file allowed it and said so in a comment, on the grounds
 * that the router merely resolves it and the worst case is another page of
 * this same app. That is true and it is still not a reason to honour it:
 * `/demo/..` climbs OUT of the base the whole build is mounted under, landing
 * on the marketing site with a half-booted dashboard behind it, and no
 * legitimate showcase link has ever contained one. A path this app would
 * never generate is a path this app should not follow.
 */

const DOT_DOT_SEGMENT = /(^|[/\\])\.\.($|[/\\?#])/;

/** `/rollouts/dev/default/hello-world` yes; `//evil.com`, `/\evil.com`, `/../x` no. */
export function isSafeDemoPagePath(page: string | null): boolean {
	if (!page) return false;
	if (!/^\/(?![/\\])/.test(page)) return false;
	return !DOT_DOT_SEGMENT.test(page);
}

/**
 * The path to redirect to, or `null` to stay put. `base` is SvelteKit's
 * `paths.base` (`/demo` in the demo build, `''` everywhere else).
 */
export function demoRedirectTarget(url: URL, base: string): string | null {
	const page = url.searchParams.get('page');
	return isSafeDemoPagePath(page) ? `${base}${page}` : null;
}
