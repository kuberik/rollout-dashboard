/**
 * Only http(s) URLs may become a link `href` when the URL comes from cluster,
 * GitHub, log or other user-controlled data. A `javascript:`, `data:` or
 * `vbscript:` URL would run (or render) attacker-chosen content on click, and
 * `rel="noopener noreferrer"` does not stop that.
 *
 * Returns the URL (trimmed) when its scheme is http or https, a same-site
 * relative reference (`/x`, `./x`, `?q`, `#h`, `x/y`) as-is, and `undefined`
 * for everything else, so `<a href={safeHref(u)}>` renders with no href
 * (Svelte omits an undefined attribute) and the text stays plain.
 *
 * This is a hand-written check, not the WHATWG URL parser. It strips leading
 * and trailing C0 controls and spaces, drops tab/CR/LF anywhere (as browsers do
 * before parsing), takes the scheme to be the text before the first `:` when
 * that `:` comes before any `/`, `?` or `#`, and allows only `http`/`https`
 * (case-insensitive) or no scheme at all.
 */
export function safeHref(url: string | null | undefined): string | undefined {
	if (typeof url !== 'string') return undefined;
	const trimmed = url.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
	if (!trimmed) return undefined;
	// Browsers drop tab/CR/LF anywhere in the URL before parsing the scheme.
	const squashed = trimmed.replace(/[\t\n\r]/g, '');
	// A scheme is present when `:` precedes any of / ? #.
	const m = /^([^/?#:]*):/.exec(squashed);
	if (!m) {
		// No scheme. Protocol-relative `//host` is still a navigation to http(s).
		return squashed;
	}
	const scheme = m[1].toLowerCase();
	return scheme === 'http' || scheme === 'https' ? squashed : undefined;
}
