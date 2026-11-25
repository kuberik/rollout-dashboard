/**
 * THE /changes FILTER (2026-11-22). ROLE: describes the in-flight changes as one facet (Repo) for filter/filter-model.ts so the shared
 * QueryBar can narrow the plumb line; the search words match a change's title, repo and #ref. Views ("my changes" vs a repo's changes) are not
 * filters and live outside this file. URL: `?repo=a,b` (is any of), `?repo!=a` (none of), `?q=words`. The old spelling (?repo=a&repo=b, repeated)
 * still parses: repeated values are joined before the model reads them.
 */
import { parseQuery, queryParams, matches, type FacetDef, type FilterQuery } from '../filter/filter-model';
import type { Plumb, PlumbKeep } from './changes-plumb';

export type ChangeEntry = { repo: string; ref: string; title: string };
export const changeText = (e: ChangeEntry): string[] => [e.title, e.repo, e.ref];
export const changeDefs: FacetDef<ChangeEntry>[] = [{ key: 'repo', label: 'Repo', of: (e) => e.repo }];

/** every in-flight change of the (unfiltered) plumb: the rows the option counts are drawn from */
export const changeEntries = (P: Pick<Plumb, 'stops'>): ChangeEntry[] => P.stops.flatMap((s) => s.rows.map((r) => ({ repo: r.repo, ref: r.ref, title: r.title })));

/** repeated `repo=` / `repo!=` params collapse into one comma list, then the shared parser reads it */
export function parseChangeFilter(params: URLSearchParams): FilterQuery {
	const p = new URLSearchParams(params);
	for (const k of ['repo', 'repo!']) { const all = params.getAll(k); if (all.length > 1) p.set(k, all.join(',')); }
	return parseQuery(p, changeDefs);
}
export const changeParams = (params: URLSearchParams, f: FilterQuery): URLSearchParams => queryParams(params, f, changeDefs);
/** the predicate plumbOf narrows with */
export const keepChange = (f: FilterQuery): PlumbKeep => (c) => matches(c, f, changeDefs, changeText);
