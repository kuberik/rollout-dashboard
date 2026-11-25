/**
 * THE /dependencies FILTER (2026-11-22). ROLE: the graph's columns are "environments"; a column the fleet cannot bind to an Environment
 * record is a NAMESPACE fallback (see the page's "namespaces are not environments" note). The filter keeps that split as two properties of one
 * query bar: Environment (real tiers) and Namespace (the fallback columns). Rows are the graph's nodes, so option counts are rollouts per column.
 * URL: `?env=prod,dev` / `?env!=dev`, `?ns=a` / `?ns!=a`, `?q=` matches a rollout's name. Pure logic; the page draws.
 */
import { parseQuery, queryParams, applyQuery, type FacetDef, type FilterQuery } from './filter/filter-model';
import { rankBy } from './filter/filter-model';

export type DepEntry = { env: string; ns: string; name: string };
/** `isEnv(column)`: is the column a real Environment (vs a namespace fallback) */
export const depEntries = (nodes: { env: string; name: string }[], isEnv: (env: string) => boolean): DepEntry[] =>
	nodes.map((n) => ({ env: isEnv(n.env) ? n.env : '', ns: isEnv(n.env) ? '' : n.env, name: n.name }));
export const depText = (e: DepEntry): string[] => [e.name];

export function depDefs(order: string[], word: (env: string) => string = (v) => v): FacetDef<DepEntry>[] {
	return [
		{ key: 'env', label: 'Environment', of: (e) => e.env, order: rankBy(order), word },
		{ key: 'ns', label: 'Namespace', of: (e) => e.ns }
	];
}
const URL_DEFS = depDefs([]);
export const parseDepFilter = (params: URLSearchParams): FilterQuery => parseQuery(params, URL_DEFS);
export const depParams = (params: URLSearchParams, f: FilterQuery): URLSearchParams => queryParams(params, f, URL_DEFS);

/** the columns (env values of the nodes) the query keeps; null = no filter, keep everything */
export function keptColumns(entries: DepEntry[], f: FilterQuery, defs: FacetDef<DepEntry>[]): string[] | null {
	const kept = applyQuery(entries, f, defs, depText);
	return kept === entries ? null : [...new Set(kept.map((e) => e.env || e.ns))];
}
