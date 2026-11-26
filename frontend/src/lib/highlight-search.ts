/**
 * Escape-first search highlighting for `{@html}` sinks.
 *
 * Log text is untrusted (any workload can print `<img src=x onerror=...>`),
 * so every piece is HTML-escaped BEFORE the only markup we add (`<mark>`)
 * is inserted. Never build the markup first and escape after.
 */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function highlightSearch(text: string, query: string): string {
	if (!query.trim()) return escapeHtml(text);
	const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
	// A search match is not a status: it takes the neutral selected token.
	// Odd indexes of a capturing split are the matches.
	return text
		.split(regex)
		.map((part, i) =>
			i % 2 === 1
				? `<mark class="rounded-xs bg-selected text-fg">${escapeHtml(part)}</mark>`
				: escapeHtml(part)
		)
		.join('');
}
