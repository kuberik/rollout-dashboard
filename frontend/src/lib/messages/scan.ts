/**
 * THE COMPLETENESS MECHANISM. Everything else in `src/lib/messages` is
 * assertions; this is the thing that makes them EXHAUSTIVE rather than a
 * sample.
 *
 * -- WHY A SCANNER AND NOT A LIST -----------------------------------------
 *
 * Three separate audits of `polish/overnight-craft` found the same defect
 * class -- a sentence that is false for the state that produced it, or that
 * does not name what it is about -- and each one fixed the instances it
 * happened to read. The instances came back, in new strings, on pages nobody
 * had re-read. A list of sentences to check is a list of sentences somebody
 * already thought of.
 *
 * So the suite enumerates the SENTENCE-PRODUCING CODE and pins a census of
 * every operator-visible literal in it. A new string cannot appear without
 * failing `drift.test.ts`, and a new string inside a registered sentence
 * module cannot appear without failing `truth.test.ts` as well -- the second
 * guard is the strong one, because it demands a STATE that produces the
 * string rather than a mention of it.
 *
 * -- WHAT IT SEES ---------------------------------------------------------
 *
 *   - `.svelte` markup text nodes (Svelte `{expressions}` collapsed to a gap)
 *   - `title` / `aria-label` / `alt` / `placeholder` / `aria-description`
 *     attribute values on any element
 *   - string and template literals in `.ts` files and in `<script>` blocks
 *
 * -- WHAT IT CANNOT SEE, STATED HONESTLY ----------------------------------
 *
 *  1. A sentence assembled at runtime from fragments each shorter than the
 *     prose threshold. A template whose halves are both variables is
 *     invisible here. The truth matrix is the answer to that one: it asserts
 *     on the ASSEMBLED output, so a sentence built from parts still has to be
 *     produced by a named state.
 *  2. Strings from a dependency. `flowbite-svelte`'s own aria text, the
 *     browser's validation messages, `Intl` output. Out of scope by design --
 *     they are not this product's claims.
 *  3. Server strings. The Go API's `details` field prints verbatim; that is
 *     deliberate (`api/errors.ts`) and is asserted as pass-through, not as
 *     wording we own.
 *  4. Dead code. A literal in a branch no state reaches is still counted by
 *     the census, which is why `truth.test.ts` fails on it instead of
 *     silently blessing it. That is the intended direction of the error.
 *  5. Concatenation across a module boundary. `joinClauses(parts)` builds
 *     `a, b and c`; the connective is below the threshold and is checked by
 *     the truth matrix, not the census.
 *  6. Anything under `src/lib/paraglide` -- generated, and pinned separately
 *     by `paraglide.test.ts` and by the 160-byte gate.
 */

const SOURCES = import.meta.glob('/src/**/*.{ts,svelte}', {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

/** The character every interpolation collapses to. */
export const HOLE = '…';

export type Literal = {
	/** Path relative to `src/`, e.g. `lib/view-models/blocking-story.ts`. */
	file: string;
	/** `text` | `title` | `aria-label` | `alt` | `placeholder` | `code`. */
	kind: string;
	/**
	 * The string with every interpolation replaced by HOLE, whitespace
	 * collapsed. That is deliberate: two strings that differ only in a
	 * substituted value are ONE message.
	 */
	text: string;
};

const SKIP_DIR = /^(lib\/paraglide|lib\/messages|lib\/testing)\//;
const SKIP_FILE = /(\.test\.ts|\.spec\.ts|\.svelte\.test\.ts)$/;

/**
 * Comments and REGEX LITERALS. A rule written in a comment is not a claim,
 * and neither is a pattern: `/is not healthy \(([^)]*)\)/` carries `'...'`
 * pairs that a naive string scanner reads as prose. `health-witness.ts`'s
 * condition parser produced exactly that -- the census reported `in namespace`
 * as an untested message.
 *
 * `/` starts a regex only where a VALUE may start, which is everywhere except
 * directly after an identifier, a number, `)`, `]` or a closing quote. That is
 * the standard heuristic and it is sufficient here: a false negative leaves a
 * pattern in, which the prose filter then rejects anyway.
 */
function stripComments(src: string): string {
	let out = '';
	let i = 0;
	let mode: 'code' | 'line' | 'block' | 's' | 'd' | 't' = 'code';
	const regexMayStart = (): boolean => {
		for (let k = out.length - 1; k >= 0; k--) {
			const ch = out[k];
			if (/\s/.test(ch)) continue;
			return !/[A-Za-z0-9_$)\]'"`]/.test(ch);
		}
		return true;
	};
	while (i < src.length) {
		const c = src[i];
		const n = src[i + 1];
		if (mode === 'code') {
			if (c === '/' && n !== '/' && n !== '*' && regexMayStart()) {
				// consume the regex literal, honouring escapes and classes
				let j = i + 1;
				let inClass = false;
				for (; j < src.length; j++) {
					const d = src[j];
					if (d === '\\') {
						j++;
						continue;
					}
					if (d === '\n') break; // not a regex after all
					if (d === '[') inClass = true;
					else if (d === ']') inClass = false;
					else if (d === '/' && !inClass) break;
				}
				out += ' ';
				i = j + 1;
				continue;
			}
			if (c === '/' && n === '*') {
				mode = 'block';
				out += '  ';
				i += 2;
				continue;
			}
			if (c === '/' && n === '/') {
				mode = 'line';
				out += '  ';
				i += 2;
				continue;
			}
			if (c === "'") mode = 's';
			else if (c === '"') mode = 'd';
			else if (c === '`') mode = 't';
			out += c;
			i++;
			continue;
		}
		if (mode === 'line') {
			if (c === '\n') {
				mode = 'code';
				out += c;
			}
			i++;
			continue;
		}
		if (mode === 'block') {
			if (c === '*' && n === '/') {
				mode = 'code';
				i += 2;
				continue;
			}
			i++;
			continue;
		}
		// inside a string literal -- copy verbatim, honour escapes
		if (c === '\\') {
			out += c + (n ?? '');
			i += 2;
			continue;
		}
		if ((mode === 's' && c === "'") || (mode === 'd' && c === '"') || (mode === 't' && c === '`'))
			mode = 'code';
		out += c;
		i++;
	}
	return out;
}

/**
 * A Tailwind class list is not a sentence. The test is structural -- a
 * majority of tokens carrying a `-` or a variant `:` -- rather than a list of
 * known utilities, so a class the design system adds tomorrow still filters.
 */
function looksLikeClasses(s: string): boolean {
	const words = s.trim().split(/\s+/).filter(Boolean);
	if (words.length < 2) return false;
	const utility = words.filter(
		(w) =>
			/^-?[a-z0-9]+(-[a-z0-9./[\]%#()]+)+$/.test(w) ||
			/^(dark|hover|focus|focus-visible|active|group-hover|peer-focus|sm|md|lg|xl|2xl|max-sm|max-md|motion-safe|motion-reduce|first|last|odd|even|print)[:]/.test(
				w
			) ||
			/^\[[^\]]*\]:/.test(w) ||
			/^(flex|grid|block|inline|inline-flex|inline-block|hidden|contents|truncate|relative|absolute|fixed|sticky|italic|underline|uppercase|lowercase|capitalize|grow|shrink|tabular-nums|antialiased|border|rounded|shadow|ring|transition)$/.test(
				w
			)
	).length;
	return utility / words.length >= 0.55;
}

const NOT_PROSE = [
	/^https?:/i,
	/^\/(?!\s)/, // a path
	/^\.\.?\//,
	/^\$(lib|app)\b/,
	/^[A-Za-z-]+\/[A-Za-z-]+$/, // ns/name
	/^[a-z]+([A-Z][a-z]+)+$/, // camelCase identifier
	/^\d+(\.\d+)*$/,
	/^application\//i,
	/^(text|image|audio|video)\//i
];

/**
 * Is this a sentence a person reads, as opposed to a class list, an
 * identifier, a MIME type or a URL?
 *
 * THE THRESHOLD IS TWO WORDS AND SIX CHARACTERS, AND IT IS A REAL BLIND SPOT.
 * `Steady`, `Pending`, `newest`, `Retry` are one word and are NOT in the
 * census. They are covered instead by the truth matrix, which asserts them as
 * OUTPUTS of named states -- a stronger check than counting them here would
 * be, because a one-word label's defect is never its spelling.
 */
export function isProse(s: string): boolean {
	const t = s.trim();
	if (t.length < 6) return false;
	if (!/[A-Za-z]/.test(t)) return false;
	if (t.split(/\s+/).filter(Boolean).length < 2) return false;
	if (NOT_PROSE.some((re) => re.test(t))) return false;
	if (looksLikeClasses(t)) return false;
	// A fragment of markup that survived tag-stripping is not a sentence.
	if (/[<>]|=\s*["'{]|\{@|\{#|\{:|\{\//.test(t)) return false;
	return true;
}

function normalise(s: string): string {
	return s
		.replace(/\$\{[^{}]*\}/g, HOLE)
		.replace(/\\n/g, ' ')
		.replace(/\\t/g, ' ')
		.replace(/\\'/g, "'")
		.replace(/\\"/g, '"')
		.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
		.replace(/\s+/g, ' ')
		.trim();
}

/** String and template literals, minus anything handed to `console.*`. */
function scanScript(src: string, file: string, out: Literal[]): void {
	const code = stripComments(src).replace(/console\.\w+\([^)]*\)/g, ' ');
	const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(code))) {
		const raw = m[1] ?? m[2] ?? m[3] ?? '';
		const text = normalise(raw);
		if (isProse(text)) out.push({ file, kind: 'code', text });
	}
}

const ATTRS = new Set(['title', 'aria-label', 'alt', 'placeholder', 'aria-description']);

/**
 * A hand-rolled walk rather than a regex, because a Svelte tag can span
 * several lines and carry `{}` expressions with `>` inside them -- the shape
 * that made a regex splitter emit half-tags as if they were prose.
 */
function scanMarkup(src: string, file: string, out: Literal[]): void {
	const markup = src
		.replace(/<script[\s\S]*?<\/script>/g, ' ')
		.replace(/<style[\s\S]*?<\/style>/g, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ');

	let i = 0;
	let text = '';
	const flush = () => {
		for (const part of text.split(/\n\s*\n/)) {
			const t = normalise(part);
			if (isProse(t)) out.push({ file, kind: 'text', text: t });
		}
		text = '';
	};
	/** Skip a `{...}` expression, honouring nesting and quotes. */
	const skipExpr = (start: number): number => {
		let d = 0;
		let j = start;
		let q: string | null = null;
		for (; j < markup.length; j++) {
			const c = markup[j];
			if (q) {
				if (c === '\\') j++;
				else if (c === q) q = null;
				continue;
			}
			if (c === '"' || c === "'" || c === '`') {
				q = c;
				continue;
			}
			if (c === '{') d++;
			else if (c === '}') {
				d--;
				if (d === 0) return j + 1;
			}
		}
		return markup.length;
	};

	while (i < markup.length) {
		const c = markup[i];
		if (c === '{') {
			text += ` ${HOLE} `;
			i = skipExpr(i);
			continue;
		}
		if (c === '<') {
			flush();
			// consume the tag, harvesting whitelisted attributes
			let j = i + 1;
			let q: string | null = null;
			let tag = '';
			for (; j < markup.length; j++) {
				const d = markup[j];
				if (q) {
					if (d === q) q = null;
					tag += d;
					continue;
				}
				if (d === '{') {
					const e = skipExpr(j);
					tag += HOLE;
					j = e - 1;
					continue;
				}
				if (d === '"' || d === "'") {
					q = d;
					tag += d;
					continue;
				}
				if (d === '>') break;
				tag += d;
			}
			const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
			let a: RegExpExecArray | null;
			while ((a = attrRe.exec(tag))) {
				if (!ATTRS.has(a[1])) continue;
				// A `{...}` inside a QUOTED attribute is Svelte interpolation and
				// is a hole like any other. It is collapsed here rather than in
				// `normalise` because a `{` in a TS string literal is usually a
				// brace, not a hole.
				const t = normalise((a[3] ?? a[4] ?? '').replace(/\{[^{}]*\}/g, HOLE));
				if (isProse(t)) out.push({ file, kind: a[1], text: t });
			}
			i = j + 1;
			continue;
		}
		text += c;
		i++;
	}
	flush();
}

let cache: Literal[] | null = null;

/** Every operator-visible literal in the product, deduplicated per file. */
export function scanLiterals(): Literal[] {
	if (cache) return cache;
	const out: Literal[] = [];
	for (const [path, src] of Object.entries(SOURCES)) {
		const file = path.replace(/^\/?src\//, '');
		if (SKIP_DIR.test(file) || SKIP_FILE.test(file)) continue;
		if (file.endsWith('.svelte')) {
			scanMarkup(src, file, out);
			for (const s of src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
				scanScript(s[1], file, out);
			}
		} else {
			scanScript(src, file, out);
		}
	}
	const seen = new Set<string>();
	cache = out
		.filter((l) => {
			const k = `${l.file} ${l.kind} ${l.text}`;
			if (seen.has(k)) return false;
			seen.add(k);
			return true;
		})
		.sort(
			(a, b) =>
				a.file.localeCompare(b.file) ||
				a.text.localeCompare(b.text) ||
				a.kind.localeCompare(b.kind)
		);
	return cache;
}

/** Only the literals belonging to one module. */
export function literalsIn(file: string): Literal[] {
	return scanLiterals().filter((l) => l.file === file);
}

/** The census, in the exact shape `catalogue.txt` holds. */
export function serialiseCatalogue(literals: Literal[] = scanLiterals()): string {
	return literals.map((l) => `${l.file}\t${l.kind}\t${l.text}`).join('\n') + '\n';
}
