import { base } from '$app/paths';

/**
 * Prefix SvelteKit's `paths.base` onto an app-internal, root-relative path —
 * the one thing `href="..."`, `goto(...)` and `redirect(...)` never do for
 * you. Every literal the app writes for its own routes (`/rollouts`,
 * `/changes/${slug}`, …) must go through this before it reaches an anchor,
 * `goto`, `redirect`, or `history.pushState`/`replaceState`.
 *
 * `base` never has a trailing slash (SvelteKit's own contract), so the root
 * path is a special case: `href('/')` returns `base` itself (e.g. `/demo`),
 * never `${base}/` (`/demo/`). Pick this convention and never the other —
 * `appPath` below is its exact inverse under it. With an empty `base` (a
 * plain, non-sub-path build) `href` is the identity function.
 *
 * Total and boring: never throws, never parses a URL, correct for `base === ''`.
 */
export function href(path: string): string {
	if (path === '/') return base || '/';
	return `${base}${path}`;
}

/**
 * The inverse of `href`: strip `base` off a real `page.url.pathname` so the
 * rest of the app can keep comparing against the base-less literals it
 * already uses (`pathname === '/rollouts'`, `.startsWith('/rollouts/')`)
 * unchanged, regardless of what sub-path the app is hosted under.
 *
 * Only strips `base` when what follows is the whole path (`pathname ===
 * base`, → `/`) or is followed by a `/` — a path that merely starts with
 * the same characters as `base` (`/demonstration` when `base` is `/demo`)
 * is a DIFFERENT path and must come back unmangled. With an empty `base`
 * this is the identity function.
 */
export function appPath(pathname: string): string {
	if (!base) return pathname;
	if (pathname === base || pathname === `${base}/`) return '/';
	if (pathname.startsWith(`${base}/`)) return pathname.slice(base.length);
	return pathname;
}
