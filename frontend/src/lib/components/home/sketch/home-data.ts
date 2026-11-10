/**
 * r28 CONSOLIDATED Home (/lab/home) — the real HomeModel over the pinned home-incident fixture,
 * in three states: incident (as captured), calm (`calmModel`: no failures) and quiet
 * (`quietModel`: no failures, no approvals).
 *
 * ONE MOCK-DATA CORRECTION, applied here rather than in the shared fixture (the parity test pins
 * that file to the lab export): the captured fixture has hello-frontend-app's rel-66 arriving in
 * dev, staging and prod in the SAME second, and #13 merged 16h before its own build was cut. No
 * real pipeline does that, and the lead's timed track would draw it as a lie. Here #13 merges at
 * 18:33, rel-66 (cut 18:41) reaches dev 18:46, staging 18:58, prod 19:11 (unchanged), bake fails
 * 19:21 (unchanged).
 */
import { buildHomeModel, type HomeModel } from '$lib/view-models/home-model';
import { homeInput, FIXTURE_NOW, FIXTURE_ME } from '$lib/view-models/home/fixture';
import { calmModel, quietModel } from './sketch-home';
import { approvalRev } from '$lib/components/new/approval-rev.svelte';
import type { NetworkSchedules } from '$lib/api/schedules';
import { liveSource, type FleetSource } from './fleet-source.svelte';

/** the clock the pages count ages from: the live source's `now`, the fixture's capture instant when nothing is installed. A Date, so every `NOW.getTime()` / `NOW.toISOString()` reads the current source. */
class SourceClock extends Date {
	constructor() { super(FIXTURE_NOW.getTime()); }
	private ms(): number { return (liveSource()?.now ?? FIXTURE_NOW).getTime(); }
	override getTime(): number { return this.ms(); }
	override valueOf(): number { return this.ms(); }
	override toISOString(): string { return new Date(this.ms()).toISOString(); }
}
export const NOW: Date = new SourceClock();
/** the pinned fixture's viewer; pages ask `viewerLogin()` */
export const ME = FIXTURE_ME;
/** the signed-in viewer's lower-cased GitHub login: the source's `me`, the fixture's when nothing is installed ('' = GitHub not connected) */
export const viewerLogin = (): string => (liveSource() ? liveSource()!.me : FIXTURE_ME);
export const liveViewer = (): boolean => liveSource() !== null;
export type HomeState = 'incident' | 'calm' | 'quiet';

const ARRIVE: Record<string, string> = {
	'hello-dep-dev': '2026-10-24T18:46:26.893Z',
	'hello-dep-staging': '2026-10-24T18:58:26.893Z'
};
const MERGED_13 = '2026-10-24T18:33:49.255Z';

type R = { metadata: { name: string; namespace: string }; status: { history?: { timestamp: string }[] } };
type E = { metadata: { name: string; namespace: string }; status: { lastStatusChangeTime?: string } };
type C = { repo: string; number?: number; mergedAt: string };

function corrected() {
	const base = homeInput(FIXTURE_NOW);
	const rollouts = (base.rollouts as unknown as R[]).map((r) => {
		const t = ARRIVE[r.metadata.namespace];
		if (!t || r.metadata.name !== 'hello-frontend-app' || !r.status.history?.length) return r;
		const [h0, ...rest] = r.status.history;
		return { ...r, status: { ...r.status, history: [{ ...h0, timestamp: t }, ...rest] } };
	});
	const environments = (base.environments as unknown as E[]).map((e) => {
		const t = ARRIVE[e.metadata.namespace];
		return t && e.metadata.name === 'hello-frontend-app' ? { ...e, status: { ...e.status, lastStatusChangeTime: t } } : e;
	});
	const changes = (base.changes as unknown as C[]).map((c) =>
		c.repo === 'hello-frontend-app' && c.number === 13 ? { ...c, mergedAt: MERGED_13 } : c
	);
	return { ...base, rollouts, environments, changes } as unknown as typeof base;
}

let fixtureSrc: FleetSource | null = null;
/** the pinned fixture as a FleetSource: unit tests and truth expectations only, never a page's data */
export function fixtureSource(): FleetSource {
	if (fixtureSrc) return fixtureSrc;
	const c = corrected();
	return (fixtureSrc = {
		rollouts: c.rollouts, environments: c.environments, rolloutDependencies: c.rolloutDependencies, kustomizations: c.kustomizations,
		kruiseRollouts: c.kruiseRollouts, changes: c.changes as FleetSource['changes'], changesState: 'ok', healthChecks: c.healthChecks,
		github: { configured: true, connected: true, login: FIXTURE_ME }, me: FIXTURE_ME, now: FIXTURE_NOW
	});
}
/** what the pages read from: the live source when a provider installed one, else the fixture */
export const source = (): FleetSource => liveSource() ?? fixtureSource();
export const isLive = (): boolean => liveSource() !== null;

const built = new WeakMap<FleetSource, HomeModel>();
/** an approval changed the fixture in place: the next homeModel() rebuilds from it (r34 r3-approve) */
export function resetHomeModel(): void { built.delete(source()); }
export function homeModel(state: HomeState): HomeModel {
	approvalRev(); /* reactive: pages re-derive when an approval is applied or undone */
	const s = source();
	let m = built.get(s);
	if (!m) {
		m = buildHomeModel({
			changes: s.changes, rollouts: s.rollouts, environments: s.environments, rolloutDependencies: s.rolloutDependencies,
			kustomizations: s.kustomizations, kruiseRollouts: s.kruiseRollouts, me: s.me, now: s.now, healthChecks: s.healthChecks, schedulesByCluster: (s.schedules ?? undefined) as Map<string, NetworkSchedules> | undefined
		});
		built.set(s, m);
	}
	/* the calm / quiet lenses are the fixture's review scenarios; live data is never masked (the mock API serves those scenarios itself) */
	if (liveSource()) return m;
	return state === 'quiet' ? quietModel(m) : state === 'calm' ? calmModel(m) : m;
}

/** Raw fixture lookups the model does not carry: a change by its merge sha, an env's rollout history. */
type FxChange = { repo: string; number?: number; title: string; htmlUrl: string; author: string; mergedAt: string; mergeCommitSha: string };
export function changeBySha(repoPrefix: string, sha: string | null) {
	if (!sha) return null;
	const fx = source().changes as unknown as FxChange[];
	const hit = (x: FxChange) => x.mergeCommitSha.startsWith(sha) || sha.startsWith(x.mergeCommitSha.slice(0, 7));
	/* the first argument is an APP name; an app named after its repo prefix-matches it, but a multi-service repo (platform-telemetry ships telemetry-indexer, -worker, ...) does not: a
	   merge commit names one commit in one repo, so a full 7-char sha identifies the change on its own */
	const c = fx.find((x) => repoPrefix.startsWith(x.repo) && hit(x)) ?? (sha.length >= 7 ? fx.find(hit) : null);
	if (!c) return null;
	const last = c.htmlUrl.split('/').pop() ?? '';
	return { ref: /^\d+$/.test(last) ? `#${last}` : last.slice(0, 7), title: c.title, author: c.author, mergedAt: c.mergedAt, href: c.htmlUrl };
}

/** One place's deploy history for an app (newest first), from the raw rollout. */
type FxRollout = {
	metadata: { name: string; namespace: string };
	status: { history?: { version: { revision?: string; tag?: string }; timestamp: string; bakeStatus?: string; bakeStartTime?: string; bakeEndTime?: string }[] };
};
export function historyAt(app: string, env: string) {
	const r = (source().rollouts as unknown as FxRollout[]).find((x) => x.metadata.name === app && x.metadata.namespace.endsWith(`-${env}`));
	return (r?.status.history ?? []).map((h) => ({
		sha: (h.version.revision ?? h.version.tag ?? '').slice(0, 7),
		at: h.timestamp,
		bake: h.bakeStatus ?? null,
		bakeStart: h.bakeStartTime ?? null,
		bakeEnd: h.bakeEndTime ?? null
	}));
}
