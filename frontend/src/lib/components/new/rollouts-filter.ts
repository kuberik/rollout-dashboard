/**
 * THE /rollouts FILTER (R7, owner 2026-11-21; re-expressed on the shared filter model 2026-11-22). ROLE: describes the page's rows as facets
 * (state, environment, namespace, cluster when there is more than one) for filter/filter-model.ts and narrows the list with a query. The page and
 * the filter UI draws; this file decides which rows are kept. Rules: empty
 * query = everything (no "All"); `is` = any of, `not` = none of, across properties AND; search matches name, namespace and version, case-insensitive.
 * Filters narrow the "All rollouts" list ONLY: the banner and Attention never pass through here.
 * URL: `?q=&state=progress,waiting,held,rest&env=prod,dev&ns=a,b&ns!=c` (the old ?state values; only `failing` still redirects to #attention, see +page.ts).
 */
import type { RolloutsPage, StrandRow, RestRow, GroupKey } from './rollouts-page';
import { parseQuery, queryParams, matches, rankBy, type FacetDef, type FilterQuery } from '../filter/filter-model';

export { isFiltered, EMPTY_QUERY } from '../filter/filter-model';
export type StateKey = 'progress' | 'waiting' | 'held' | 'rest';
export const STATE_KEYS: StateKey[] = ['progress', 'waiting', 'held', 'rest'];
export const STATE_WORD: Record<StateKey, string> = { progress: 'In flight', waiting: 'Waiting', held: 'Held', rest: 'At rest' };
const GROUP_STATE: Record<GroupKey, StateKey> = { moving: 'progress', waiting: 'waiting', held: 'held' };
/** the tiers in the order the product lists environments (prod first, as the rank order everywhere else) */
const TIER_ORDER = ['prod', 'staging', 'test', 'dev'];
const STATE_SLUG: Record<StateKey, string> = { progress: 'in-flight', waiting: 'waiting', held: 'held', rest: 'at-rest' };

/** path segment i of a rollout path /rollouts/<cluster>/<ns>/<name> ('' for anything else) */
const seg = (href: string, i: number): string => { const p = href.split(/[?#]/)[0]!.split('/').filter(Boolean); return p[0] === 'rollouts' ? (p[i] ?? '') : ''; };
/** the namespace of a rollout path */
export const nsOfHref = (href: string): string => seg(href, 2);

/** one row of the list, whichever kind, as the filter reads it */
export type Entry = { state: StateKey; ns: string; tier: string; cluster: string; name: string; version: string };
const entryOfRow = (r: StrandRow, state: StateKey): Entry => ({ state, ns: nsOfHref(r.href), tier: r.tier, cluster: seg(r.href, 1), name: r.app, version: r.row.version ?? '' });
const entryOfRest = (r: RestRow): Entry => ({ state: 'rest', ns: nsOfHref(r.href), tier: r.tier, cluster: seg(r.href, 1), name: r.app, version: r.code });
export const entries = (P: Pick<RolloutsPage, 'groups' | 'rest'>): Entry[] => [...P.groups.flatMap((g) => g.rows.map((r) => entryOfRow(r, GROUP_STATE[g.key]))), ...P.rest.map(entryOfRest)];
/** the text a search matches */
export const entryText = (e: Entry): string[] => [e.name, e.ns, e.version];

const stateAliases: Record<string, string> = { moving: 'progress', inflight: 'progress', progress: 'progress', rest: 'rest', idle: 'rest' };
const CLUSTER: FacetDef<Entry> = { key: 'cluster', label: 'Cluster', of: (e) => e.cluster };
/** every property the page can filter by; `cluster` is offered only when the list spans more than one cluster */
export function rolloutDefs(rows: Entry[] = []): FacetDef<Entry>[] {
	const defs: FacetDef<Entry>[] = [
		{ key: 'state', label: 'State', of: (e) => e.state, values: STATE_KEYS, order: rankBy(STATE_KEYS), word: (v) => STATE_WORD[v as StateKey] ?? v, slug: (v) => STATE_SLUG[v as StateKey] ?? v, aliases: stateAliases },
		{ key: 'env', label: 'Environment', of: (e) => e.tier, order: rankBy(TIER_ORDER) },
		{ key: 'ns', label: 'Namespace', of: (e) => e.ns }
	];
	if (new Set(rows.map((e) => e.cluster).filter(Boolean)).size > 1) defs.push(CLUSTER);
	return defs;
}
/** what the URL can spell (cluster always parses: a link into a two-cluster fleet stays valid while the list is momentarily empty) */
const URL_DEFS: FacetDef<Entry>[] = [...rolloutDefs(), CLUSTER];

/** the query a URL spells; unknown `state` words (incl. `failing`, which has no group here) are dropped, env is lower-cased */
export function parseFilter(params: URLSearchParams): FilterQuery {
	const q = parseQuery(params, URL_DEFS);
	return { ...q, clauses: q.clauses.map((c) => (c.key === 'env' ? { ...c, values: c.values.map((v) => v.toLowerCase()) } : c)) };
}
/** `params` with the query's keys replaced (every other param, e.g. ?scenario=, is kept) */
export const filterParams = (params: URLSearchParams, f: FilterQuery): URLSearchParams => queryParams(params, f, URL_DEFS);

export type FilteredList = { groups: RolloutsPage['groups']; rest: RestRow[]; restApps: number; counts: RolloutsPage['counts']; shown: number };
/** the page's groups and rest narrowed by the query; a group with no matching row is gone, counts are the filtered ones */
export function filterList(P: Pick<RolloutsPage, 'groups' | 'rest' | 'counts' | 'restApps'>, f: FilterQuery): FilteredList {
	const total = P.groups.reduce((n, g) => n + g.rows.length, 0) + P.rest.length;
	if (!f.q.trim() && !f.clauses.some((c) => c.values.length)) return { groups: P.groups, rest: P.rest, restApps: P.restApps, counts: P.counts, shown: total };
	const defs = rolloutDefs(entries(P));
	const keep = (e: Entry) => matches(e, f, defs, entryText);
	const groups = P.groups.map((g) => ({ ...g, rows: g.rows.filter((r) => keep(entryOfRow(r, GROUP_STATE[g.key]))) })).filter((g) => g.rows.length);
	const rest = P.rest.filter((r) => keep(entryOfRest(r)));
	const n = (k: GroupKey) => groups.find((g) => g.key === k)?.rows.length ?? 0;
	return { groups, rest, restApps: new Set(rest.map((r) => r.app)).size, counts: { moving: n('moving'), waiting: n('waiting'), held: n('held'), rest: rest.length }, shown: groups.reduce((a, g) => a + g.rows.length, 0) + rest.length };
}
