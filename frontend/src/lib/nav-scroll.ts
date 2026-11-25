/**
 * Whether a navigation only rewrote the query string (or hash) of the page
 * already on screen — a filter, search or view change written to the URL with
 * `goto(..., { replaceState, noScroll })`. Such a navigation is not a new page:
 * the root layout's `afterNavigate` must leave the scroll offset alone, or every
 * filter click jumps the list back to the top (2026-11-22, filter takes).
 *
 * Back/Forward (`popstate`) is excluded: it keeps restoring the offset saved for
 * the URL it lands on. A first load (`enter`) has no `from` and is never one.
 */
export function isQueryOnlyNavigation(nav: {
	type: string;
	from?: { url: URL } | null;
	to?: { url: URL } | null;
}): boolean {
	if (nav.type === 'popstate' || nav.type === 'enter') return false;
	if (!nav.from?.url || !nav.to?.url) return false;
	return nav.from.url.origin === nav.to.url.origin && nav.from.url.pathname === nav.to.url.pathname;
}
