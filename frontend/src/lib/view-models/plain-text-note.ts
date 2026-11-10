/**
 * `entry.message` ("Recorded note") is whatever the API stored verbatim —
 * for a human-typed note that is sometimes simple Markdown emphasis
 * (`*deploy now*`, `**urgent**`), which the History ledger used to print
 * literally, asterisks and all (AD round 2, 2026-10-10: "the recorded note
 * renders literal markdown asterisks"). The ledger is plain text, not a
 * Markdown renderer — rather than pull one in for two emphasis markers,
 * this strips `*x*`, `_x_`, `**x**` and `__x__` down to their own text.
 *
 * Deliberately narrow: no links, lists, or code spans — the note field is a
 * one-line string, not a document. A marker only strips when it isn't
 * itself inside a word (`snake_case_name` stays untouched), so this never
 * mangles an identifier a note happens to quote.
 */
export function stripEmphasisMarkers(text: string): string {
	if (!text) return text;
	return text
		.replace(/\*\*([^*\n]+)\*\*/g, '$1')
		.replace(/__([^_\n]+)__/g, '$1')
		.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '$1')
		.replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, '$1');
}
