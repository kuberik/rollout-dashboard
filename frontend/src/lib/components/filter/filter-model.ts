/**
 * THE FILTER MODEL (owner 2026-11-22: "linear-style filter ... also anywhere else where we have the filter").
 * ROLE: the one pure model every list page's filter UI draws from — /rollouts, /activity, /changes, and any page that filters later.
 * A page describes its rows as FACETS (property -> value per row) plus the text a search matches; this file decides which rows a
 * query keeps, what each value would count, and how the query is spelt in the URL. The UI (a Linear-style menu + pills, a query bar,
 * section toggles — the takes) only draws and reports a new `FilterQuery`.
 *
 * Semantics:
 *  - empty query = everything (no "All" option anywhere);
 *  - a CLAUSE is one property with an operator and >=1 values: `is` = row's value is ANY of them (OR), `not` = row's value is NONE of them;
 *  - clauses AND together; the search text ANDs with them (case-insensitive substring over the page's text fields);
 *  - at most one clause per property (setting a property's values replaces its clause; zero values removes it).
 * URL: `?q=<text>&<key>=a,b` for `is`, `?<key>!=a,b` for `not` (URLSearchParams reads the key as `<key>!`). Other params are kept.
 */

export type Op = 'is' | 'not';
export type Clause = { key: string; op: Op; values: string[] };
export type FilterQuery = { q: string; clauses: Clause[] };
export const EMPTY_QUERY: FilterQuery = { q: '', clauses: [] };

/** one filterable property of a page's rows */
export type FacetDef<E> = {
	key: string;
	/** the property's word in menus and pills, e.g. "Environment" */
	label: string;
	/** the row's value for this property ('' = none; such rows never match an `is` clause and always match a `not` clause) */
	of: (e: E) => string;
	/** option order; default: rows carrying the value (busiest first), then name */
	order?: (a: string, b: string) => number;
	/** optional fixed vocabulary (e.g. state words), accepted from the URL even when no row carries it */
	values?: string[];
	/** display word of a value (default: the value) */
	word?: (v: string) => string;
	/** how a query BAR spells the value in text (default: the value) — additive, used by query-syntax.ts only */
	slug?: (v: string) => string;
	/** extra words a query bar accepts for a value (spelt word -> value), e.g. `moving` -> `progress` — additive */
	aliases?: Record<string, string>;
	/** the property has no "is not" form (a query bar offers no switch) — additive */
	single?: boolean;
};

const listOf = (v: string | null): string[] => [...new Set((v ?? '').split(',').map((x) => x.trim()).filter(Boolean))];

/** the query a URL spells, for the given properties (unknown keys are ignored; a `values` vocabulary drops unknown words) */
export function parseQuery(params: URLSearchParams, defs: Pick<FacetDef<unknown>, 'key' | 'values'>[]): FilterQuery {
	const clauses: Clause[] = [];
	for (const d of defs) {
		const ok = (x: string) => !d.values || d.values.includes(x);
		const isV = listOf(params.get(d.key)).filter(ok);
		const notV = listOf(params.get(`${d.key}!`)).filter(ok);
		if (isV.length) clauses.push({ key: d.key, op: 'is', values: isV });
		else if (notV.length) clauses.push({ key: d.key, op: 'not', values: notV });
	}
	return { q: (params.get('q') ?? '').trim(), clauses };
}

/** `params` with the query's keys replaced; every other param (e.g. ?scenario=) is kept; an empty clause is absent, never `env=` */
export function queryParams(params: URLSearchParams, query: FilterQuery, defs: Pick<FacetDef<unknown>, 'key'>[]): URLSearchParams {
	const out = new URLSearchParams(params);
	out.delete('q');
	for (const d of defs) { out.delete(d.key); out.delete(`${d.key}!`); }
	if (query.q.trim()) out.set('q', query.q.trim());
	for (const c of query.clauses) if (c.values.length) out.set(c.op === 'is' ? c.key : `${c.key}!`, c.values.join(','));
	return out;
}
/** the URL search string (`?a=b` or '') — commas stay readable */
export const queryString = (params: URLSearchParams): string => { const s = params.toString().replace(/%2C/gi, ',').replace(/%21=/g, '!='); return s ? `?${s}` : ''; };

export const isFiltered = (query: FilterQuery): boolean => !!(query.q.trim() || query.clauses.some((c) => c.values.length));
export const clauseOf = (query: FilterQuery, key: string): Clause | undefined => query.clauses.find((c) => c.key === key);

/** set one property's values (op kept, or `is` for a new clause); [] removes the clause. Order of clauses = order they were added. */
export function setValues(query: FilterQuery, key: string, values: string[], op?: Op): FilterQuery {
	const cur = clauseOf(query, key);
	if (!values.length) return { ...query, clauses: query.clauses.filter((c) => c.key !== key) };
	const next: Clause = { key, op: op ?? cur?.op ?? 'is', values };
	return { ...query, clauses: cur ? query.clauses.map((c) => (c.key === key ? next : c)) : [...query.clauses, next] };
}
/** toggle one value in a property's clause */
export function toggleValue(query: FilterQuery, key: string, value: string): FilterQuery {
	const cur = clauseOf(query, key)?.values ?? [];
	return setValues(query, key, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]);
}
export const setOp = (query: FilterQuery, key: string, op: Op): FilterQuery => ({ ...query, clauses: query.clauses.map((c) => (c.key === key ? { ...c, op } : c)) });
export const removeClause = (query: FilterQuery, key: string): FilterQuery => ({ ...query, clauses: query.clauses.filter((c) => c.key !== key) });
export const setText = (query: FilterQuery, q: string): FilterQuery => ({ ...query, q });

function clauseKeeps<E>(e: E, c: Clause, def: FacetDef<E> | undefined): boolean {
	if (!def || !c.values.length) return true;
	const v = def.of(e);
	const hit = c.values.includes(v);
	return c.op === 'is' ? hit : !hit;
}
/** does the row pass the query; `skip` leaves one property out (for that property's own option counts) */
export function matches<E>(e: E, query: FilterQuery, defs: FacetDef<E>[], text: (e: E) => string[], skip?: string): boolean {
	const q = query.q.trim().toLowerCase();
	if (q && !text(e).some((x) => x.toLowerCase().includes(q))) return false;
	return query.clauses.every((c) => c.key === skip || clauseKeeps(e, c, defs.find((d) => d.key === c.key)));
}
export const applyQuery = <E>(rows: E[], query: FilterQuery, defs: FacetDef<E>[], text: (e: E) => string[]): E[] =>
	isFiltered(query) ? rows.filter((e) => matches(e, query, defs, text)) : rows;

export type Option = {
	value: string;
	word: string;
	/** rows this value would show, given every OTHER clause and the search ("how many would picking this add") */
	count: number;
	/** rows carrying the value in the whole list (stable, for ordering a long list) */
	total: number;
	selected: boolean;
};
/** the options of one property: every value the rows carry (plus selected ones the rows no longer carry), ordered */
export function optionsOf<E>(rows: E[], query: FilterQuery, defs: FacetDef<E>[], text: (e: E) => string[], key: string): Option[] {
	const def = defs.find((d) => d.key === key);
	if (!def) return [];
	const sel = clauseOf(query, key)?.values ?? [];
	const present = new Set([...rows.map(def.of), ...sel].filter(Boolean));
	const totals = new Map<string, number>();
	const counts = new Map<string, number>();
	for (const e of rows) {
		const v = def.of(e);
		if (!v) continue;
		totals.set(v, (totals.get(v) ?? 0) + 1);
		if (matches(e, query, defs, text, key)) counts.set(v, (counts.get(v) ?? 0) + 1);
	}
	const order = def.order ?? ((a: string, b: string) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a.localeCompare(b));
	return [...present].sort(order).map((value) => ({ value, word: def.word?.(value) ?? value, count: counts.get(value) ?? 0, total: totals.get(value) ?? 0, selected: sel.includes(value) }));
}

/** rank order from a fixed list (e.g. prod, staging, test, dev), unknowns after, by name */
export const rankBy = (list: string[]) => (a: string, b: string) => (list.indexOf(a) + 1 || 999) - (list.indexOf(b) + 1 || 999) || a.localeCompare(b);

/** a pill's value phrase, Linear-style: one value -> its word; 2+ -> "any of N" (is) / "none of N" (not) is the caller's choice; this gives the parts */
export function pillParts(c: Clause, word: (v: string) => string = (v) => v): { op: string; value: string; many: boolean } {
	const many = c.values.length > 1;
	const op = c.op === 'is' ? (many ? 'is any of' : 'is') : many ? 'is none of' : 'is not';
	const value = many ? (c.values.length <= 2 ? c.values.map(word).join(', ') : `${c.values.length} values`) : word(c.values[0]!);
	return { op, value, many };
}
