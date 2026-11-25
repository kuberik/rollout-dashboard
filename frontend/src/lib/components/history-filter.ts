/**
 * THE HISTORY TAB'S "COMPARE" ADAPTER (2026-11-22). ROLE: the two chart toggles that used to be pills ("Show environments", "Compare
 * namespace") are ONE property, Compare, of the shared QueryBar: its values are the extra lanes the Deployment timeline draws (`env` = the
 * other environments of this app, `ns` = the other rollouts of this namespace). It adds lanes rather than narrowing rows, so it has no
 * "is not" form (`single`) and no free text (the bar is drawn with `search={false}`). The time-range pills are a window and stay as they were.
 * URL: `?kind=env,ns` in the model's spelling; the old `?kind=env+ns` (a `+` reads back as a space) and `?kind=envns` style links still parse.
 */
import type { FacetDef, FilterQuery, Option } from './filter/filter-model';

export type Lane = 'env' | 'ns';
export const LANES: Lane[] = ['env', 'ns'];
const LANE_WORD: Record<Lane, string> = { env: 'Environments', ns: 'Namespace' };

export const compareDef: FacetDef<unknown> = {
	key: 'kind',
	label: 'Compare',
	of: () => '',
	values: LANES,
	word: (v) => LANE_WORD[v as Lane] ?? v,
	aliases: { environments: 'env', environment: 'env', namespace: 'ns', namespaces: 'ns' },
	single: true
};

/** the lanes an address spells (`env`, `ns`, in any of the separators the old and new links use) */
export function parseKind(raw: string | null): Lane[] {
	if (!raw) return [];
	const t = raw.toLowerCase();
	return LANES.filter((l) => t.includes(l === 'env' ? 'env' : 'ns'));
}
/** the address value for a set of lanes (null = nothing = the param is absent) */
export const kindParam = (on: Lane[]): string | null => (on.length ? LANES.filter((l) => on.includes(l)).join(',') : null);

export const kindQuery = (on: Lane[]): FilterQuery => ({ q: '', clauses: on.length ? [{ key: 'kind', op: 'is', values: LANES.filter((l) => on.includes(l)) }] : [] });
export const lanesOf = (q: FilterQuery): Lane[] => (q.clauses.find((c) => c.key === 'kind')?.values ?? []).filter((v): v is Lane => v === 'env' || v === 'ns');

/** the menu: Environments only when the app runs in other environments; counts are lanes this would add (Namespace: unknown until fetched) */
export function compareOptions(on: Lane[], otherEnvs: number, nsRollouts: number | null): Option[] {
	const all: Option[] = [];
	if (otherEnvs > 0 || on.includes('env')) all.push({ value: 'env', word: LANE_WORD.env, count: otherEnvs, total: otherEnvs, selected: on.includes('env') });
	all.push({ value: 'ns', word: LANE_WORD.ns, count: nsRollouts ?? -1, total: nsRollouts ?? -1, selected: on.includes('ns') });
	return all;
}
