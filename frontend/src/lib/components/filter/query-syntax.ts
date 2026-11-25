/**
 * THE QUERY SYNTAX (2026-11-22; GitHub issues search / Datadog / Sentry, in kuberik's words).
 * ROLE: the pure two-way bridge between the text of a query bar and the shared `FilterQuery` (filter-model.ts). The bar draws and edits text;
 * this file tokenises it (for the highlight), says which tokens are valid and why not (for the suggestion panel), turns it into a `FilterQuery`
 * (for the list and the URL), spells a `FilterQuery` back as text (a pasted link shows the same tokens), and says what the caret is editing (for autocomplete).
 * Grammar: `key:value`, `key:a,b` (any of), `-key:value` (is not), `key:"odd name"`; every other word is search text (joined with spaces, one substring,
 * exactly what `?q=` is). Unknown keys and unknown values stay in the text, are marked, and are NOT applied — except the token the caret is still
 * typing, which is applied only once every value in it is known (so `ns:pay` does not blank the list, `ns:payments` narrows it at once).
 * Same property twice: values merge when the operator agrees; the later token with the other operator is marked as conflicting.
 */
import type { Clause, FacetDef, FilterQuery } from './filter-model';

export type SyntaxDef = Pick<FacetDef<never>, 'key' | 'label' | 'slug' | 'aliases' | 'values' | 'word'>;
/** values the rows carry, per property key (for resolving `ns:payments` and for the panel) */
export type Known = Record<string, string[]>;

export type ValueTok = { start: number; end: number; raw: string; value: string | null };
export type Token = {
	kind: 'word' | 'qual';
	start: number;
	end: number;
	raw: string;
	/** word: its text without quotes */
	text: string;
	neg: boolean;
	key: string;
	keyKnown: boolean;
	/** index of the first value character (just after the colon) */
	valueStart: number;
	values: ValueTok[];
	/** why the token is not (fully) applied; undefined = fine */
	problem?: string;
	/** the caret is inside it, so it is judged leniently */
	pending: boolean;
};

const slugOf = (d: SyntaxDef, v: string) => (d.slug ? d.slug(v) : v);
export const needsQuote = (s: string) => /[\s,"]/.test(s);
const quoted = (s: string) => (needsQuote(s) ? `"${s.replace(/"/g, '')}"` : s);
const unquote = (s: string) => (s.startsWith('"') ? s.slice(1).replace(/"$/, '') : s);

/** the property's value a spelt word means, or null */
export function resolve(d: SyntaxDef, word: string, known: string[]): string | null {
	const w = word.toLowerCase();
	if (!w) return null;
	if (d.aliases && d.aliases[w]) return d.aliases[w]!;
	return [...known, ...(d.values ?? [])].find((v) => v.toLowerCase() === w || slugOf(d, v).toLowerCase() === w) ?? null;
}

/** split `s` (offset `base` in the text) at top-level `sep`s, honouring quotes */
function split(s: string, base: number, sep: (c: string) => boolean): { start: number; end: number; raw: string }[] {
	const out: { start: number; end: number; raw: string }[] = [];
	let from = -1;
	let q = false;
	for (let i = 0; i <= s.length; i++) {
		const c = s[i];
		const cut = i === s.length || (!q && sep(c!));
		if (cut) {
			if (from >= 0) out.push({ start: base + from, end: base + i, raw: s.slice(from, i) });
			from = -1;
			if (i < s.length && sep(c!) && !q) { /* separator is not part of any piece */ }
			continue;
		}
		if (from < 0) from = i;
		if (c === '"') q = !q;
	}
	return out;
}

export function tokenize(text: string, defs: SyntaxDef[], known: Known, caret: number | null = null): Token[] {
	return split(text, 0, (c) => /\s/.test(c)).map((p) => {
		const pending = caret !== null && p.start <= caret && caret <= p.end;
		const m = /^(-?)([A-Za-z]+):/.exec(p.raw);
		if (!m) return { kind: 'word', start: p.start, end: p.end, raw: p.raw, text: unquote(p.raw), neg: false, key: '', keyKnown: false, valueStart: p.start, values: [], pending } as Token;
		const key = m[2]!.toLowerCase();
		const def = defs.find((d) => d.key === key);
		const valueStart = p.start + m[0].length;
		const rest = p.raw.slice(m[0].length);
		const values: ValueTok[] = [];
		// a comma split that also keeps a trailing empty piece, so `ns:a,` is seen as "adding another"
		let from = 0;
		let q = false;
		const pieces: [number, number][] = [];
		for (let i = 0; i <= rest.length; i++) {
			if (i === rest.length || (!q && rest[i] === ',')) { pieces.push([from, i]); from = i + 1; continue; }
			if (rest[i] === '"') q = !q;
		}
		for (const [a, b] of pieces) {
			const raw = rest.slice(a, b);
			if (!raw) continue;
			const word = unquote(raw);
			values.push({ start: valueStart + a, end: valueStart + b, raw, value: def ? resolve(def, word, known[key] ?? []) : null });
		}
		let problem: string | undefined;
		if (!def) problem = `No filter “${m[2]}”. Try ${defs.map((d) => d.key).join(', ')}.`;
		else if (!values.length) problem = `${key}: needs a value`;
		else {
			const bad = values.find((v) => v.value === null);
			if (bad) problem = `No ${def.label.toLowerCase()} named “${unquote(bad.raw)}”`;
		}
		return { kind: 'qual', start: p.start, end: p.end, raw: p.raw, text: '', neg: !!m[1], key, keyKnown: !!def, valueStart, values, problem, pending } as Token;
	});
}

export type Parsed = { query: FilterQuery; tokens: Token[] };
/** text -> query + tokens (a token that is not applied carries its `problem`, unless it is the one being typed) */
export function parseText(text: string, defs: SyntaxDef[], known: Known, caret: number | null = null): Parsed {
	const tokens = tokenize(text, defs, known, caret);
	const words: string[] = [];
	const clauses: Clause[] = [];
	for (const t of tokens) {
		if (t.kind === 'word') { words.push(t.text); continue; }
		const bad = !t.keyKnown || !t.values.length || t.values.some((v) => v.value === null);
		if (bad) { if (t.pending) t.problem = undefined; continue; }
		const have = clauses.find((c) => c.key === t.key);
		const op = t.neg ? 'not' : 'is';
		const vals = t.values.map((v) => v.value!);
		if (!have) clauses.push({ key: t.key, op, values: [...new Set(vals)] });
		else if (have.op === op) have.values = [...new Set([...have.values, ...vals])];
		else t.problem = `Conflicts with the earlier ${t.key}: filter`;
	}
	return { query: { q: words.join(' ').trim(), clauses }, tokens };
}

/** query -> text: qualifiers first (in the order they were added), then the search text */
export function spell(query: FilterQuery, defs: SyntaxDef[]): string {
	const parts = query.clauses.filter((c) => c.values.length).map((c) => {
		const d = defs.find((x) => x.key === c.key);
		return `${c.op === 'not' ? '-' : ''}${c.key}:${c.values.map((v) => quoted(d ? slugOf(d, v) : v)).join(',')}`;
	});
	const q = query.q.trim();
	if (q) parts.push(q.includes(':') || q.startsWith('"') ? `"${q.replace(/"/g, '')}"` : q);
	return parts.join(' ');
}

/** what the caret is editing: a key (or nothing yet), a value of a known key, or a key that does not exist */
export type Context =
	| { mode: 'key'; start: number; end: number; neg: boolean; prefix: string }
	| { mode: 'value'; start: number; end: number; key: string; neg: boolean; fragment: string; tokenEnd: number; taken: string[] }
	| { mode: 'badkey'; start: number; end: number; problem: string };
export function contextAt(text: string, caret: number, defs: SyntaxDef[], known: Known): Context {
	const t = tokenize(text, defs, known, caret).find((x) => x.start <= caret && caret <= x.end);
	if (!t) return { mode: 'key', start: caret, end: caret, neg: false, prefix: '' };
	if (t.kind === 'word') {
		if (t.raw.startsWith('"')) return { mode: 'key', start: caret, end: caret, neg: false, prefix: '\u0000' };
		const neg = t.raw.startsWith('-');
		return { mode: 'key', start: t.start, end: t.end, neg, prefix: t.raw.slice(neg ? 1 : 0).toLowerCase() };
	}
	if (!t.keyKnown) return { mode: 'badkey', start: t.start, end: t.end, problem: t.problem ?? '' };
	if (caret < t.valueStart) return { mode: 'key', start: t.start, end: t.end, neg: t.neg, prefix: t.key };
	// the value piece under the caret: from the last top-level comma before it to the next one after
	let a = t.valueStart;
	let q = false;
	for (let i = t.valueStart; i < caret; i++) { if (text[i] === '"') q = !q; if (!q && text[i] === ',') a = i + 1; }
	let b = t.end;
	q = false;
	for (let i = a; i < t.end; i++) { if (text[i] === '"') q = !q; if (!q && text[i] === ',') { b = i; break; } }
	const taken = t.values.filter((v) => v.value !== null && !(v.start >= a && v.start < b)).map((v) => v.value!);
	return { mode: 'value', start: a, end: b, key: t.key, neg: t.neg, fragment: unquote(text.slice(a, caret)).toLowerCase(), tokenEnd: t.end, taken };
}

export type Edit = { text: string; caret: number };
/** accept a key: the token becomes `key:` (negation kept), caret after the colon */
export function applyKey(text: string, c: Extract<Context, { mode: 'key' }>, key: string): Edit {
	const ins = `${c.neg ? '-' : ''}${key}:`;
	return { text: text.slice(0, c.start) + ins + text.slice(c.end), caret: c.start + ins.length };
}
/** accept a value: it replaces the piece under the caret; a last value is followed by one space so the next token starts clean */
export function applyValue(text: string, c: Extract<Context, { mode: 'value' }>, spelt: string): Edit {
	const v = quoted(spelt);
	let out = text.slice(0, c.start) + v + text.slice(c.end);
	let caret = c.start + v.length;
	if (c.end === c.tokenEnd) {
		if (out[caret] !== ' ') out = out.slice(0, caret) + ' ' + out.slice(caret);
		caret += 1;
	}
	return { text: out, caret };
}
