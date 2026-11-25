/**
 * THE LOGS TAB'S FILTER ADAPTER (2026-11-22). ROLE: describes what the Logs toolbar narrows by — LEVEL and POD — as filter-model
 * facets for the shared QueryBar, and spells them in the address (`?level=error,warn&pod!=checkout-7d9f&q=timeout`; `?tab=` is kept).
 * The Pods/Tests switch is NOT here: it chooses which stream is read (a source), not a way to narrow it. Search words are `query.q`.
 * Negation is real: `level!=debug` shows everything but debug. `effective` turns a clause into the set the stream filter wants (an `is`
 * clause is its values; an `is not` clause is the universe minus its values).
 */
import { parseQuery, queryParams, rankBy, type Clause, type FacetDef, type FilterQuery, type Option } from './filter/filter-model';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export const LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];
export const LEVEL_WORD: Record<LogLevel, string> = { error: 'Error', warn: 'Warning', info: 'Info', debug: 'Debug' };

const LEVEL: FacetDef<unknown> = {
	key: 'level',
	label: 'Level',
	of: () => '',
	values: LEVELS,
	order: rankBy(LEVELS),
	word: (v) => LEVEL_WORD[v as LogLevel] ?? v,
	aliases: { warning: 'warn', err: 'error', fatal: 'error' }
};
const POD: FacetDef<unknown> = { key: 'pod', label: 'Pod', of: () => '' };

/** the properties the toolbar offers: Pod only when there is more than one pod (a filter with one answer filters nothing) */
export const logDefs = (pods: number): FacetDef<unknown>[] => (pods > 1 ? [LEVEL, POD] : [LEVEL]);
/** what the address can spell (pod always parses: a link into a stream whose pods have not arrived yet stays valid) */
const URL_DEFS: FacetDef<unknown>[] = [LEVEL, POD];

/** the query an address spells: `?level=`/`?level!=` (the word `warning` is accepted for `warn`), `?pod=`/`?pod!=`, `?q=` */
export function parseLogFilter(params: URLSearchParams): FilterQuery {
	const p = new URLSearchParams(params);
	for (const k of ['level', 'level!']) {
		const v = p.get(k);
		if (v) p.set(k, v.split(',').map((x) => (x.trim().toLowerCase() === 'warning' ? 'warn' : x.trim().toLowerCase())).join(','));
	}
	return parseQuery(p, URL_DEFS);
}
/** `params` with the query's keys replaced (`?tab=` and every other param is kept) */
export const logFilterParams = (params: URLSearchParams, f: FilterQuery): URLSearchParams => queryParams(params, f, URL_DEFS);

/** the set a clause selects out of `universe` (nothing selected = an empty set, which the stream filter reads as "all") */
export function effective<T extends string>(c: Clause | undefined, universe: readonly T[]): Set<T> {
	if (!c || !c.values.length) return new Set();
	const vals = new Set(c.values);
	return c.op === 'is' ? new Set(universe.filter((u) => vals.has(u)).concat(c.values.filter((v) => !universe.includes(v as T)) as T[])) : new Set(universe.filter((u) => !vals.has(u)));
}

/** the property's options with the buffer's line counts; a selected value stays listed even at zero */
export function logOptions(key: string, query: FilterQuery, levelCounts: Record<LogLevel, number>, pods: { name: string; lines: number }[]): Option[] {
	const sel = new Set(query.clauses.find((c) => c.key === key)?.values ?? []);
	if (key === 'level') return LEVELS.map((v) => ({ value: v, word: LEVEL_WORD[v], count: levelCounts[v], total: levelCounts[v], selected: sel.has(v) }));
	return pods.map((p) => ({ value: p.name, word: p.name, count: p.lines, total: p.lines, selected: sel.has(p.name) })).sort((a, b) => b.total - a.total || a.word.localeCompare(b.word));
}
