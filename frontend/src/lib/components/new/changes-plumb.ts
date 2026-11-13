/**
 * THE PLUMB LINE VIEW-MODEL (Changes page main object, gallery candidate 10b on design/visuals-r42 226ffc78, rebuilt on the product's own
 * placement). Pure composition over `classifyChanges` / `changesPage`: a change's stop (`col`), state and spread come from PChange (which reads
 * change/service-spread.ts: least advanced service's stop, the worst service's state, one severity order), so the line, the repo cards and
 * Home cannot disagree. Nothing is invented here: this file only groups, filters by repo and words.
 *   stops    merged -> dev -> test -> staging -> prod, each with its in-flight changes, worst first (empty stops stay, printed "none")
 *   chips    one per repo with something in flight (count = its in-flight changes); none selected = every repo
 *   landed   landed today, then the at-rest repos whose newest landing is older (one list, newest first)
 */
import { ago, NOW, type HomeState } from './data';
import { beadRank } from '$lib/view-models/severity';
import { inScope } from './derivation-scope';
import { classifyChanges, changesPage, type PChange } from './changes-page';
import type { Svc } from './change/service-spread';
import { TIERS as TIER_LIST } from '$lib/view-models/sites-waves';

export const STOPS = ['merged', 'dev', 'test', 'staging', 'prod'] as const;
const RANK: Record<string, number> = { merged: 0, ...Object.fromEntries(TIER_LIST.map((t, i) => [t, i + 1])) };
/** a bead state's rank: `severity.ts`'s one order */
const SEV = (s: string): number => beadRank(s);

export type PlumbRow = {
	key: string; repo: string; ref: string; title: string; href: string; state: string; col: string; age: string; since: number;
	/** the service named under the state word (a multi-service change whose worst service is not every service) */
	worst: string | null; services: Svc[] | null;
};
export type PlumbStop = { col: string; rows: PlumbRow[] };
export type PlumbLanded = { key: string; repo: string; ref: string; title: string; href: string; age: string; at: number };
export type PlumbChip = { repo: string; count: number };
export type Plumb = { stops: PlumbStop[]; total: number; chips: PlumbChip[]; landed: PlumbLanded[] };

const sinceOf = (p: PChange) => p.ride.since ?? p.c.since ?? p.c.mergedAt;

/** the whole line, narrowed to `repos` (empty = every repo) */
export function plumbOf(hs: HomeState, repos: readonly string[] = []): Plumb {
	return inScope(() => plumbOfRaw(hs, repos));
}
function plumbOfRaw(hs: HomeState, repos: readonly string[]): Plumb {
	const { mineP } = classifyChanges(hs);
	const P = changesPage(hs);
	const keep = (repo: string) => !repos.length || repos.includes(repo);
	const flying = mineP.filter((p) => p.state !== 'landed');
	const counts = new Map<string, number>();
	for (const p of flying) counts.set(p.c.repo, (counts.get(p.c.repo) ?? 0) + 1);
	const chips = [...counts].map(([repo, count]) => ({ repo, count })).sort((a, b) => b.count - a.count || a.repo.localeCompare(b.repo));

	const rows: PlumbRow[] = flying.filter((p) => keep(p.c.repo)).map((p) => ({
		key: p.c.key, repo: p.c.repo, ref: p.ref, title: p.c.title, href: p.c.changeHref ?? p.c.href, state: p.state, col: p.col, age: ago(sinceOf(p)), since: Date.parse(sinceOf(p)),
		worst: p.services && p.worst && p.services.some((s) => s.app !== p.worst) ? p.worst : null, services: p.services ?? null
	}));
	const stops = STOPS.map((col) => ({ col, rows: rows.filter((r) => r.col === col).sort((a, b) => SEV(a.state) - SEV(b.state) || a.since - b.since) }));

	const day = NOW.toISOString().slice(0, 10);
	const today: PlumbLanded[] = mineP.filter((p) => p.state === 'landed' && keep(p.c.repo) && sinceOf(p).slice(0, 10) === day)
		.map((p) => ({ key: p.c.key, repo: p.c.repo, ref: p.ref, title: p.c.title, href: p.c.changeHref ?? p.c.href, age: ago(sinceOf(p)), at: Date.parse(sinceOf(p)) }))
		.sort((a, b) => b.at - a.at);
	const rest: PlumbLanded[] = P.rest.filter((r) => keep(r.repo) && !today.some((l) => l.repo === r.repo && l.ref === r.ref))
		.map((r) => ({ key: r.key, repo: r.repo, ref: r.ref, title: r.title, href: r.href, age: r.age.replace(/^landed /, ''), at: 0 }));
	return { stops, total: rows.length, chips, landed: [...today, ...rest] };
}

/** a service's own place, worded for its row: "Needs your approval for prod", "Failing in staging" */
export function serviceWord(s: Svc): string {
	switch (s.state) {
		case 'failed': return `Failing in ${s.tier}`;
		case 'approval-yours': return `Needs your approval for ${s.next}`;
		case 'approval': return `Waiting for approval for ${s.next}`;
		case 'held': return `Held before ${s.next}`;
		case 'deploying': return `Deploying to ${s.tier}`;
		case 'checking': return `Checking in ${s.tier}`;
		default: return `In ${s.tier}`;
	}
}
/** services in the product's severity order, then by how far along they are */
export const servicesByUrgency = (s: Svc[]): Svc[] => [...s].sort((a, b) => SEV(a.state) - SEV(b.state) || (RANK[a.tier] ?? 0) - (RANK[b.tier] ?? 0) || a.app.localeCompare(b.app));
/** the stages a change's services stand in, each with its services (the spread line) */
export const spreadStages = (s: Svc[]) => STOPS.filter((c) => s.some((x) => x.tier === c)).map((c) => ({ tier: c, apps: s.filter((x) => x.tier === c) }));

/** ?repo=a&repo=b -> the selected repos that exist (stale names fall away) */
export const reposFromQuery = (q: URLSearchParams, known: readonly string[]): string[] => [...new Set(q.getAll('repo').flatMap((v) => v.split(',')))].filter((r) => known.includes(r));
/** toggle one repo in the selection */
export const toggleRepo = (sel: readonly string[], repo: string): string[] => (sel.includes(repo) ? sel.filter((r) => r !== repo) : [...sel, repo]);
