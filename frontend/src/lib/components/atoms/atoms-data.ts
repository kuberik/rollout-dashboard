/**
 * r42 VISUAL ATOMS — the facts each atom draws, read from the same live source the pages read (no new data):
 *  - progressOf(href): checking = bake elapsed / spec.bakeTime from the place's own history[0].bakeStartTime (the tab's
 *    "Check timer"), words = data.ts `checkClock` ("5 min left"); deploying = steps done / steps (data.ts `stepsOf`, the
 *    tab's "2/6 steps").
 *  - hopsOf(repo, sha): each place's history entry for the change's merge commit (deploy start -> bake end), the first
 *    production arrival only; the origin is the merge.
 */
import { shortRevision } from '$lib/version-utils';
import { source, NOW, type HomeState } from '$lib/components/home/sketch/home-data';
import { rollouts, checkClock } from '$lib/components/new/data';
import type { Hop } from './LeadBar.svelte';

type RawE = { version: { revision?: string; tag?: string }; timestamp: string; bakeStartTime?: string; bakeEndTime?: string; bakeStatus?: string };
type Raw = { metadata: { name: string; namespace: string }; spec?: { bakeTime?: string }; status?: { history?: RawE[] } };
const raws = (): Raw[] => source().rollouts as unknown as Raw[];
const dur = (s: string | undefined): number => {
	const m = /^(\d+)(s|m|h)$/.exec(s ?? '');
	return m ? +m[1] * ({ s: 1e3, m: 60e3, h: 3600e3 } as Record<string, number>)[m[2]] : 0;
};
const hrefKey = (href: string) => {
	const p = href.split('/').filter(Boolean);
	return p[0] === 'rollouts' && p.length >= 4 ? `${p[2]}/${p[3]}` : href;
};

export type Progress = { fraction: number; words: string | null };
export function progressMap(state: HomeState = 'incident'): Map<string, Progress> {
	const out = new Map<string, Progress>();
	const rows = rollouts(state).rows;
	/* checking: any place whose own bake is running (a place the roster files under an approval wait still bakes; the tab shows its timer) */
	for (const raw of raws()) {
		const e = raw.status?.history?.[0], total = dur(raw.spec?.bakeTime);
		if (!e?.bakeStartTime || !total || e.bakeStatus !== 'InProgress') continue;
		const key = `${raw.metadata.namespace}/${raw.metadata.name}`;
		const row = rows.find((r) => hrefKey(r.href) === key);
		const f = (NOW.getTime() - Date.parse(e.bakeStartTime)) / total;
		if (f >= 1) continue;
		out.set(key, { fraction: Math.max(0.04, f), words: row ? checkClock({ ...row, state: 'checking' }) : null });
	}
	for (const r of rows) {
		const key = hrefKey(r.href);
		if (r.state === 'deploying' && r.steps.length > 1 && !out.has(key)) {
			const done = r.steps.filter((s) => s.state === 'done').length;
			out.set(key, { fraction: Math.max(0.04, done / r.steps.length), words: null });
		}
	}
	return out;
}
export const progressOf = (m: Map<string, Progress>, href: string): Progress | null => m.get(hrefKey(href)) ?? null;
export const progressOfPlace = (m: Map<string, Progress>, ns: string, name: string): Progress | null => m.get(`${ns}/${name}`) ?? null;

const TIER: [RegExp, string][] = [[/-dev$|^dev$/, 'dev'], [/-test$|^test$/, 'test'], [/-staging$|^staging$/, 'staging']];
const tierOfNs = (ns: string) => TIER.find(([re]) => re.test(ns))?.[1] ?? (/prod/.test(ns) ? 'prod' : ns === 'default' ? 'dev' : 'staging');

type Chg = { repo: string; number?: number; mergeCommitSha: string; mergedAt: string; htmlUrl?: string };
/** the change's travel: merge, then each environment's deploy -> checks done; null without a production arrival */
export function hopsOf(repo: string, ref: string): { hops: Hop[]; merged: number } | null {
	const chs = source().changes as unknown as Chg[];
	const c = chs.find((x) => x.repo === repo && (ref.startsWith('#') ? `#${x.number ?? (x.htmlUrl ?? '').split('/').pop()}` === ref : x.mergeCommitSha.startsWith(ref)));
	if (!c) return null;
	const sha = shortRevision(c.mergeCommitSha);
	const byTier = new Map<string, Hop>();
	for (const r of raws()) {
		if (!(r.metadata.name.startsWith(repo) || repo.startsWith(r.metadata.name))) continue;
		const e = (r.status?.history ?? []).find((h) => (h.version.revision ?? h.version.tag ?? '').startsWith(sha));
		if (!e) continue;
		const tier = tierOfNs(r.metadata.namespace);
		const start = Date.parse(e.timestamp), end = Date.parse(e.bakeEndTime ?? e.timestamp);
		const prev = byTier.get(tier);
		if (!prev || start < prev.start) byTier.set(tier, { tier, start, end });
	}
	const hops = [...byTier.values()].sort((a, b) => a.start - b.start);
	if (!hops.some((h) => h.tier === 'prod')) return null;
	return { hops: hops.slice(0, hops.findIndex((h) => h.tier === 'prod') + 1), merged: Date.parse(c.mergedAt) };
}
