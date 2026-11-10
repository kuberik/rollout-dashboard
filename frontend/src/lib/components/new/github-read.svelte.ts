/**
 * Synchronous reads of GitHub answers for the view-model layer (data.ts is pure and sync; the answers are not).
 * With no live source (unit tests) the demo GitHub universe answers in place. With one, the first ask returns null and starts the real
 * request (`GET /api/...`, the same routes the tabs call), the answer lands in a cache and bumps a reactive tick, so every derivation that
 * asked re-runs and fills in. A null is "not known yet / not available", never an invented value.
 */
import { apiPath } from '$lib/api/urls';
import { githubAskHeld } from '$lib/api/github-gate.svelte';
import { respondGithub } from '$lib/demo/github-data';
import { respondHomeIncident, type HomeFixture } from '$lib/demo/home-incident';
import fixture from '$lib/view-models/home/fixtures/incident-input.json';
import { liveSource } from '$lib/components/home/sketch/fleet-source.svelte';

const cache = new Map<string, unknown>();
const asked = new Set<string>();
let tick = $state(0);

export function githubJson<T = unknown>(path: string, params: Record<string, string> = {}): T | null {
	const q = new URLSearchParams(params);
	const key = q.size ? `${path}?${q}` : path;
	if (!liveSource()) {
		try { const b = respondGithub('GET', path.replace(/^\/api\/clusters\/[^/]+(?=\/)/, '/api'), q)?.body; return b ? (JSON.parse(b) as T) : null; } catch { return null; }
	}
	void tick;
	if (cache.has(key)) return cache.get(key) as T | null; /* an answer already read survives a held gate */
	if (githubAskHeld()) return null; /* the one gate stops NEW asks: not connected (or not yet known) */
	if (!asked.has(key)) {
		asked.add(key);
		fetch(key).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => { cache.set(key, j); tick++; });
	}
	return null;
}
/** forget what was read (a refetch of the fleet may have new builds) */
export function forgetGithubReads(): void { cache.clear(); asked.clear(); tick++; }

/** the commits route for a rollout: cluster-aware (`/api/clusters/<c>/rollouts/..`), same builder as every other fetch */
export const rangeUrl = (ns: string, name: string, cluster?: string | null): string => apiPath(cluster, `/rollouts/${ns}/${name}/commits`);

type Range = { commits?: { sha: string; message: string; author?: string; commitDate?: string; url?: string }[]; additions?: number; deletions?: number; changedFiles?: number };
/** the commit range the tabs read (`GET /api/rollouts/:ns/:name/commits?base&head`); with no live source the home-incident router (it re-headlines a range the demo universe can only answer with "Release commit for build X") then the demo universe */
export function rangeJson(ns: string, name: string, base: string, head: string, cluster?: string | null): Range | null {
	const path = `/api/rollouts/${ns}/${name}/commits`;
	/* the hub only knows its own rollouts at the bare path: a spoke's rollout is asked for through its cluster (QA2 #1) */
	if (liveSource()) return githubJson<Range>(rangeUrl(ns, name, cluster), { base, head });
	try {
		const q = new URLSearchParams({ base, head });
		const res = respondHomeIncident('GET', `${path}?${q}`, fixture as unknown as HomeFixture) ?? respondGithub('GET', path, q);
		return JSON.parse(res?.body ?? '{}') as Range;
	} catch { return null; }
}
/** a PR's own record (files, containment) */
export const pullJson = <T = { additions?: number; deletions?: number; changedFiles?: number; containedIn?: string[] }>(owner: string, repo: string, n: number | string): T | null =>
	githubJson<T>(`/api/github/pulls/${owner}/${repo}/${n}`);
