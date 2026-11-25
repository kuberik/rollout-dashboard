/**
 * THE /rollouts FILTER (R7, owner 2026-11-21): a pure model over the page's list. ROLE: the one place that knows which rows a search box and three
 * multi-select chip rows keep, what each chip counts, and how the selection is spelt in the URL. The page draws; this file decides.
 * Rules (feedback_rollout_list_design.md, binding): empty selection = everything (no "All" pill); within a chip row OR, across rows AND; the search
 * box matches name, namespace and version, case-insensitive. Filters narrow the "All rollouts" list ONLY: the banner and Attention never pass through here.
 * URL: `?q=&state=progress,waiting,held,rest&env=prod,dev&ns=a,b` (the old ?state values; only `failing` still redirects to #attention, see +page.ts).
 */
import type { RolloutsPage, StrandRow, RestRow, GroupKey } from './rollouts-page';

export type StateKey = 'progress' | 'waiting' | 'held' | 'rest';
export const STATE_KEYS: StateKey[] = ['progress', 'waiting', 'held', 'rest'];
export const STATE_WORD: Record<StateKey, string> = { progress: 'In flight', waiting: 'Waiting', held: 'Held', rest: 'At rest' };
const GROUP_STATE: Record<GroupKey, StateKey> = { moving: 'progress', waiting: 'waiting', held: 'held' };
/** the tiers in the order the product lists environments (prod first, as the rank order everywhere else) */
const TIER_ORDER = ['prod', 'staging', 'test', 'dev'];

export type RolloutFilter = { q: string; state: StateKey[]; env: string[]; ns: string[] };
export const EMPTY_FILTER: RolloutFilter = { q: '', state: [], env: [], ns: [] };

const list = (v: string | null): string[] => [...new Set((v ?? '').split(',').map((x) => x.trim()).filter(Boolean))];

/** the filter a URL spells; unknown `state` words (incl. `failing`, which has no group here) are dropped */
export function parseFilter(params: URLSearchParams): RolloutFilter {
	return {
		q: (params.get('q') ?? '').trim(),
		state: list(params.get('state')).filter((x): x is StateKey => (STATE_KEYS as string[]).includes(x)),
		env: list(params.get('env')).map((x) => x.toLowerCase()),
		ns: list(params.get('ns'))
	};
}
/** `params` with the filter's four keys replaced (every other param, e.g. ?scenario=, is kept); an empty dimension is absent, never `state=` */
export function filterParams(params: URLSearchParams, f: RolloutFilter): URLSearchParams {
	const out = new URLSearchParams(params);
	for (const k of ['q', 'state', 'env', 'ns']) out.delete(k);
	if (f.q.trim()) out.set('q', f.q.trim());
	if (f.state.length) out.set('state', f.state.join(','));
	if (f.env.length) out.set('env', f.env.join(','));
	if (f.ns.length) out.set('ns', f.ns.join(','));
	return out;
}
export const isFiltered = (f: RolloutFilter): boolean => !!(f.q.trim() || f.state.length || f.env.length || f.ns.length);
/** toggle one value of a chip row: in the selection -> out, else in */
export const toggled = <T extends string>(sel: T[], v: T): T[] => (sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]);

/** the namespace of a rollout path /rollouts/<cluster>/<ns>/<name> ('' for anything else) */
export const nsOfHref = (href: string): string => { const p = href.split(/[?#]/)[0]!.split('/').filter(Boolean); return p[0] === 'rollouts' ? (p[2] ?? '') : ''; };

/** one row of the list, whichever kind, as the filter reads it */
type Entry = { state: StateKey; ns: string; tier: string; name: string; version: string };
const entryOfRow = (r: StrandRow, state: StateKey): Entry => ({ state, ns: nsOfHref(r.href), tier: r.tier, name: r.app, version: r.row.version ?? '' });
const entryOfRest = (r: RestRow): Entry => ({ state: 'rest', ns: nsOfHref(r.href), tier: r.tier, name: r.app, version: r.code });

/** `skip` leaves one chip row out, for the counts printed on that row's own chips ("how many would this chip add") */
function matches(e: Entry, f: RolloutFilter, skip?: 'state' | 'env' | 'ns'): boolean {
	const q = f.q.trim().toLowerCase();
	if (q && ![e.name, e.ns, e.version].some((x) => x.toLowerCase().includes(q))) return false;
	if (skip !== 'state' && f.state.length && !f.state.includes(e.state)) return false;
	if (skip !== 'env' && f.env.length && !f.env.includes(e.tier)) return false;
	if (skip !== 'ns' && f.ns.length && !f.ns.includes(e.ns)) return false;
	return true;
}
const entries = (P: Pick<RolloutsPage, 'groups' | 'rest'>): Entry[] => [...P.groups.flatMap((g) => g.rows.map((r) => entryOfRow(r, GROUP_STATE[g.key]))), ...P.rest.map(entryOfRest)];

export type FilteredList = { groups: RolloutsPage['groups']; rest: RestRow[]; restApps: number; counts: RolloutsPage['counts']; shown: number };
/** the page's groups and rest narrowed by the filter; a group with no matching row is gone, counts are the filtered ones */
export function filterList(P: Pick<RolloutsPage, 'groups' | 'rest' | 'counts' | 'restApps'>, f: RolloutFilter): FilteredList {
	if (!isFiltered(f)) return { groups: P.groups, rest: P.rest, restApps: P.restApps, counts: P.counts, shown: P.groups.reduce((n, g) => n + g.rows.length, 0) + P.rest.length };
	const groups = P.groups.map((g) => ({ ...g, rows: g.rows.filter((r) => matches(entryOfRow(r, GROUP_STATE[g.key]), f)) })).filter((g) => g.rows.length);
	const rest = P.rest.filter((r) => matches(entryOfRest(r), f));
	const n = (k: GroupKey) => groups.find((g) => g.key === k)?.rows.length ?? 0;
	return { groups, rest, restApps: new Set(rest.map((r) => r.app)).size, counts: { moving: n('moving'), waiting: n('waiting'), held: n('held'), rest: rest.length }, shown: groups.reduce((a, g) => a + g.rows.length, 0) + rest.length };
}

export type FacetOption = { value: string; /** rows this chip would show given the OTHER rows' selection and the search */ count: number; /** rows carrying the value in the whole list (a stable order for a long row) */ total: number; selected: boolean };
export type Facets = { state: (FacetOption & { value: StateKey })[]; env: FacetOption[]; ns: FacetOption[] };
/** the chips of the three rows: what the list contains (an option with nothing behind it is not offered, unless the URL selected it), each with the rows it would show given the OTHER rows' selection */
export function facets(P: Pick<RolloutsPage, 'groups' | 'rest'>, f: RolloutFilter): Facets {
	const all = entries(P);
	const row = <K extends 'state' | 'env' | 'ns'>(dim: K, key: (e: Entry) => string, order: (a: string, b: string) => number) => {
		const present = new Set([...all.map(key), ...f[dim]]);
		return [...present].filter(Boolean).sort(order).map((value) => ({ value, count: all.filter((e) => key(e) === value && matches(e, f, dim)).length, total: all.filter((e) => key(e) === value).length, selected: (f[dim] as string[]).includes(value) }));
	};
	/* namespaces are many and uneven: the busiest first (a stable order, from the whole list), name breaks ties */
	const nsRow = () => { const o = row('ns', (e) => e.ns, (a, b) => a.localeCompare(b)); return o.sort((a, b) => b.total - a.total || a.value.localeCompare(b.value)); };
	const rank = (list: string[]) => (a: string, b: string) => (list.indexOf(a) + 1 || 99) - (list.indexOf(b) + 1 || 99) || a.localeCompare(b);
	return {
		state: row('state', (e) => e.state, rank(STATE_KEYS)) as Facets['state'],
		env: row('env', (e) => e.tier, rank(TIER_ORDER)),
		ns: nsRow()
	};
}
