import { safeHref } from './safe-href';

/**
 * Open a URL built from cluster/GitHub data in a new tab, but only when
 * `safeHref` accepts it (http/https or a relative reference). Anything else
 * (`javascript:`, `data:`, empty, null) does nothing: no `window.open`, so no
 * blank tab either. Returns whether a tab was opened.
 */
export function openExternal(url: string | null | undefined): boolean {
	const safe = safeHref(url);
	if (!safe) return false;
	window.open(safe, '_blank', 'noopener,noreferrer');
	return true;
}
