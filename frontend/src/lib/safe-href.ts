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
 * Parsing is done by the WHATWG URL parser, which strips the leading C0
 * control/space characters and the tab/newline characters inside the scheme
 * exactly as a browser does, so `"\x01 JaVa\nScRiPt:..."` is judged by the same
 * rule the browser will apply.
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
