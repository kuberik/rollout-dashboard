/**
 * r29 POCKET (data copied from lane compass, a530b18b+c8def986) — the composed overview's data, derived once from the real HomeModel (home-data's
 * pinned home-incident fixture, incident / calm / quiet) plus the raw rollout histories the model
 * does not carry (deploy volume over 24h, recent prod arrivals and failures).
 *
 * One module, one question:
 *   tiers     "how is each environment doing, and what is moving between them?"   → the promotion drawing
 *   pulse     "how much is shipping, and did anything fail, over the last day?"   → the deploy histogram
 *   apps      "which apps are behind, and by how much?"                           → reach meters
 *   yours     "where are my changes?"                                            → journey ticks
 *   activity  "what just happened?"                                              → a spined timeline
 */
import { newestFirst } from '$lib/instant';
import type { EnvState, HomeModel } from '$lib/view-models/home-model';
import { changeBySha, homeModel, source, NOW, type HomeState } from '../sketch/home-data';
import { buildView, type HomeView } from '../sketch/home-view';

export type TierKey = 'dev' | 'test' | 'staging' | 'prod';
export const TIERS: TierKey[] = ['dev', 'test', 'staging', 'prod'];
export type Place = { app: string; env: string; label: string; state: EnvState; href: string; version: string | null; since: string | null; mine: boolean };
export type Tier = {
	key: TierKey;
	places: Place[];
	healthy: number;
	moving: Place[];
	held: Place[];
	failed: Place[];
	apps: number;
};
export type Bin = { start: number; ok: number; failed: number; live: number };
export type Pulse = { bins: Bin[]; total: number; failed: number; prodArrivals: number; peak: number; windowH: number };
export type AppRow = {
	app: string;
	href: string;
	places: number;
	onNewest: number;
	newest: string | null;
	state: 'failed' | 'moving' | 'held' | 'healthy';
	where: string | null;
	prodRegions: number;
};
export type Act = { key: string; at: string; kind: 'prod' | 'failed' | 'rolledback'; app: string; env: string; ref: string | null; title: string | null; author: string | null; href: string };
export type Ev = { t: number; tier: TierKey; app: string; env: string; kind: 'ok' | 'failed' | 'live'; sha: string };
export type Compass = { events: Ev[]; m: HomeModel; v: HomeView; tiers: Tier[]; pulse: Pulse; apps: AppRow[]; activity: Act[]; places: number };

const tierOf = (e: { isProdRegion: boolean; tier: string }): TierKey =>
	e.isProdRegion || e.tier === 'prod' ? 'prod' : e.tier === 'dev' ? 'dev' : e.tier === 'test' ? 'test' : 'staging';
const isMoving = (s: EnvState) => s === 'deploying' || s === 'checking';
/** only a hold a PERSON can clear spends the held hue; a rule's hold is the pipeline's normal state */
const isHeld = (s: EnvState) => s === 'awaiting-approval';
const isFailed = (s: EnvState) => s === 'failed';

type Raw = {
	metadata: { name: string; namespace: string };
	status: { history?: { version: { revision?: string; tag?: string }; timestamp: string; bakeStatus?: string }[] };
};
const rawList = (): Raw[] => source().rollouts as unknown as Raw[];

/**
 * QA2 #2: which of an app's places a raw rollout (namespace, name) is. The place's own href NAMES the rollout (/rollouts/<cluster>/<ns>/<name>), so that is the
 * truth; matching the namespace to the environment's name only works when the Environment resource carries one. An app whose environments have no name
 * (`env` is "") matched nothing, so its prod arrivals never reached the activity feed and "Arrived in prod" omitted it while /envs/prod listed the same deploy.
 */
export function envForRollout<E extends { env: string; href: string }>(envs: readonly E[], ns: string, name: string): E | null {
	const byHref = envs.find((e) => { const p = e.href.split('/').filter(Boolean); return p[0] === 'rollouts' && p[2] === ns && p[3] === name; });
	return byHref ?? envs.find((e) => !!e.env && (ns === e.env || ns.endsWith(`-${e.env}`))) ?? null;
}

export function compass(state: HomeState): Compass {
	const m = homeModel(state);
	const v = buildView(m, state);
	const now = NOW.getTime();

	/* ── tiers ── */
	const tiers: Tier[] = TIERS.map((key) => {
		const places: Place[] = [];
		for (const a of m.apps)
			for (const e of a.envs) {
				if (tierOf(e) !== key || e.state === 'not-deployed') continue;
				places.push({ app: a.app, env: e.env, label: e.label, state: e.state, href: e.href, version: e.version, since: e.arrivedAt, mine: e.myChanges.length > 0 });
			}
		return {
			key,
			places,
			healthy: places.filter((p) => p.state === 'healthy' || p.state === 'superseded' || p.state === 'rolled-back').length,
			moving: places.filter((p) => isMoving(p.state)),
			held: places.filter((p) => isHeld(p.state)),
			failed: places.filter((p) => isFailed(p.state)),
			apps: new Set(places.map((p) => p.app)).size
		};
	}).filter((t) => t.places.length);

	/* places failing NOW in the incident; in calm/quiet their recent failures did not happen */
	const incidentFailed = new Set<string>();
	for (const a of homeModel('incident').apps) for (const e of a.envs) if (e.state === 'failed') incidentFailed.add(`${a.app}|${e.env}`);
	const envOf = (ns: string, app: string) => envForRollout(m.apps.find((x) => x.app === app)?.envs ?? [], ns, app);

	/* ── pulse: 24h in 15-minute bins ── */
	const windowH = 24, binMs = 15 * 60000, n = (windowH * 3600000) / binMs;
	const start = now - n * binMs;
	const bins: Bin[] = Array.from({ length: n }, (_, i) => ({ start: start + i * binMs, ok: 0, failed: 0, live: 0 }));
	const acts: Act[] = [];
	let prodArrivals = 0;
	const events: Ev[] = [];
	for (const r of rawList()) {
		const env = envOf(r.metadata.namespace, r.metadata.name);
		if (!env) continue;
		const hist = r.status.history ?? [];
		hist.forEach((h, idx) => {
			const t = Date.parse(h.timestamp);
			let bake = h.bakeStatus ?? 'Succeeded';
			if (bake === 'Failed' && state !== 'incident' && incidentFailed.has(`${r.metadata.name}|${env.env}`) && idx === 0) bake = 'Succeeded';
			const prod = env.isProdRegion || env.tier === 'prod';
			if (t >= start && t <= now) {
				events.push({ t, tier: tierOf(env), app: r.metadata.name, env: env.label, kind: bake === 'Failed' ? 'failed' : bake === 'Deploying' || bake === 'InProgress' ? 'live' : 'ok', sha: (h.version.revision ?? h.version.tag ?? '').slice(0, 7) });
				const b = bins[Math.min(n - 1, Math.floor((t - start) / binMs))];
				if (bake === 'Failed') b.failed++;
				else if (bake === 'Deploying' || bake === 'InProgress') b.live++;
				else b.ok++;
				if (prod && bake !== 'Failed') prodArrivals++;
			}
			if (now - t < 12 * 3600000 && (prod || bake === 'Failed')) {
				const sha = (h.version.revision ?? h.version.tag ?? '').slice(0, 7);
				const ch = changeBySha(r.metadata.name, sha);
				acts.push({
					key: `${r.metadata.namespace}/${r.metadata.name}/${idx}`,
					at: h.timestamp,
					kind: bake === 'Failed' ? 'failed' : 'prod',
					app: r.metadata.name,
					env: env.label,
					ref: ch?.ref ?? (sha || null),
					title: ch?.title ?? null,
					author: ch?.author ?? null,
					href: env.href
				});
			}
		});
	}
	const total = bins.reduce((s, b) => s + b.ok + b.failed + b.live, 0);
	const failed = bins.reduce((s, b) => s + b.failed, 0);
	const peak = Math.max(1, ...bins.map((b) => b.ok + b.failed + b.live));

	/* recent activity: newest first, prod arrivals of one build across regions folded into one entry */
	acts.sort((a, b) => newestFirst(a.at, b.at));
	const activity: Act[] = [];
	for (const a of acts) {
		const same = activity.find((x) => x.kind === a.kind && x.app === a.app && x.ref === a.ref && Math.abs(Date.parse(x.at) - Date.parse(a.at)) < 30 * 60000);
		if (same) {
			if (!same.env.includes(' regions')) same.env = `2 regions`;
			else same.env = `${parseInt(same.env) + 1} regions`;
			continue;
		}
		activity.push({ ...a });
	}

	/* ── apps: how much of each app runs its newest build ── */
	const apps: AppRow[] = m.apps
		.map((a) => {
			const envs = a.envs.filter((e) => e.state !== 'not-deployed' && e.version);
			const newestEnv = [...envs].sort((x, y) => newestFirst(x.arrivedAt, y.arrivedAt))[0];
			const newest = newestEnv?.version ?? null;
			const st: AppRow['state'] = envs.some((e) => isFailed(e.state)) ? 'failed' : envs.some((e) => isMoving(e.state)) ? 'moving' : envs.some((e) => isHeld(e.state)) ? 'held' : 'healthy';
			const w = envs.find((e) => (st === 'failed' ? isFailed(e.state) : st === 'moving' ? isMoving(e.state) : st === 'held' ? isHeld(e.state) : false));
			return {
				app: a.app,
				href: a.href,
				places: envs.length,
				onNewest: envs.filter((e) => e.version === newest).length,
				newest: newest ? newest.slice(0, 7) : null,
				state: st,
				where: w?.label ?? null,
				prodRegions: envs.filter((e) => e.isProdRegion || e.tier === 'prod').length
			};
		})
		.filter((a) => a.places > 0);

	return { events, m, v, tiers, pulse: { bins, total, failed, prodArrivals, peak, windowH }, apps, activity, places: tiers.reduce((s, t) => s + t.places.length, 0) };
}

/* ── r29 POCKET: the RISER — one vertical line, dev at the top, prod at the bottom; each station carries
   its count and its one meter, and only the things a person should see hang off it (failing, held for a
   person, in flight). Lineage: new object, name never used before (compass drew tiers as a horizontal
   stage/crossing chart, conduit as bands on a canvas; this is the phone's own axis). ── */
export type Hang = {
	key: string;
	kind: 'failed' | 'held' | 'moving';
	app: string;
	ref: string | null;
	title: string | null;
	where: string;
	since: string | null;
	href: string;
	mine: boolean;
	lead: boolean;
	yourCall: boolean;
};
export type Station = Tier & { hang: Hang[]; quietHeld: number; quietMoving: number };

export function riser(c: Compass): Station[] {
	const { v } = c;
	const L = v.lead;
	const leadApp = L ? L.meta.split(' · ')[0] : null;
	return c.tiers.map((t) => {
		const hang: Hang[] = [];
		const byApp = (ps: Place[]) => {
			const g = new Map<string, Place[]>();
			for (const p of ps) g.set(p.app, [...(g.get(p.app) ?? []), p]);
			return [...g.entries()];
		};
		for (const [app, ps] of byApp(t.failed)) {
			const f = v.failures.find((x) => x.app === app);
			const isLead = !!L && L.kind === 'failing' && leadApp === app;
			hang.push({
				key: `f-${t.key}-${app}`,
				kind: 'failed',
				app,
				ref: (isLead ? L!.ref : f?.ref) ?? null,
				title: (isLead ? L!.title : f?.title) ?? null,
				where: ps.length > 1 ? `${ps.length} regions` : ps[0].label,
				since: ps.map((p) => p.since).filter(Boolean).sort()[0] ?? null,
				href: ps[0].href,
				mine: ps.some((p) => p.mine) || !!f,
				lead: isLead,
				yourCall: false
			});
		}
		for (const [app, ps] of byApp(t.held)) {
			const a = v.approvals.find((x) => x.app === app);
			const w = v.waiting.find((x) => x.app === app);
			hang.push({
				key: `h-${t.key}-${app}`,
				kind: 'held',
				app,
				ref: a?.ref ?? a?.build ?? w?.ref ?? (L?.kind === 'approval' && leadApp === app ? L.ref : null),
				title: a?.title ?? w?.title ?? null,
				where: ps.length > 1 ? `${ps.length} regions` : ps[0].label,
				since: a?.since ?? w?.since ?? ps[0].since,
				href: a?.href ?? w?.href ?? ps[0].href,
				mine: !!w,
				lead: !!L && L.kind === 'approval' && leadApp === app,
				yourCall: !!a
			});
		}
		for (const [app, ps] of byApp(t.moving)) {
			const m = v.moving.find((x) => x.app === app);
			hang.push({
				key: `m-${t.key}-${app}`,
				kind: 'moving',
				app,
				ref: m?.ref ?? null,
				title: m?.title ?? null,
				where: ps.length > 1 ? `${ps.length} regions` : ps[0].label,
				since: ps[0].since,
				href: m?.href ?? ps[0].href,
				mine: !!m || ps.some((p) => p.mine),
				lead: !!L && L.kind === 'moving' && !!m && L.href === m.href,
				yourCall: false
			});
		}
		const rank = (h: Hang) => (h.lead ? 0 : h.kind === 'failed' ? 1 : h.yourCall ? 2 : h.mine ? 3 : 4);
		hang.sort((a, b) => rank(a) - rank(b));
		/* a hold no person of yours can clear stays a count, never a row (calm) */
		const shown = hang.filter((h) => h.kind === 'failed' || h.yourCall || h.mine || h.lead);
		return {
			...t,
			hang: shown,
			quietHeld: hang.filter((h) => h.kind === 'held' && !shown.includes(h)).length,
			quietMoving: hang.filter((h) => h.kind === 'moving' && !shown.includes(h)).length
		};
	});
}

/* ── r29 POCKET v03: the doorway data ── */
const chgList = () => source().changes as unknown as { repo: string; number?: number; title: string; htmlUrl: string; author: string; mergedAt: string; mergeCommitSha: string }[];
const pretty = (login: string) =>
	login.includes('-') ? login.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : login === 'danielreed' ? 'Daniel Reed' : login;
export type ChangeRow = { key: string; ref: string; title: string; app: string; who: string; mine: boolean; at: string; reached: TierKey | null; href: string };
export type ChangesDoor = { merged24: number; mine24: number; reach: Record<TierKey | 'none', number>; rows: ChangeRow[] };
/** "what got merged, by whom, and how far has it gone?" — every change merged in the last 24h, the furthest tier its build reached. */
export function changesDoor(state: HomeState): ChangesDoor {
	const now = NOW.getTime();
	const m = homeModel(state);
	const rank: Record<TierKey, number> = { dev: 0, test: 1, staging: 2, prod: 3 };
	const rows: ChangeRow[] = [];
	for (const ch of chgList()) {
		const t = Date.parse(ch.mergedAt);
		if (!(t <= now && now - t < 24 * 3600000)) continue;
		const sha = ch.mergeCommitSha.slice(0, 7);
		let best: TierKey | null = null;
		for (const r of rawList()) {
			if (!r.metadata.name.startsWith(ch.repo)) continue;
			const a = m.apps.find((x) => x.app === r.metadata.name);
			const env = a?.envs.find((e) => r.metadata.namespace === e.env || r.metadata.namespace.endsWith(`-${e.env}`));
			if (!env) continue;
			const hit = (r.status.history ?? []).some((h) => (h.version.revision ?? h.version.tag ?? '').startsWith(sha) && (h.bakeStatus ?? 'Succeeded') !== 'Failed');
			const tk = tierOf(env);
			if (hit && (!best || rank[tk] > rank[best])) best = tk;
		}
		const last = ch.htmlUrl.split('/').pop() ?? '';
		rows.push({ key: ch.htmlUrl, ref: /^\d+$/.test(last) ? `#${last}` : sha, title: ch.title, app: ch.repo, who: pretty(ch.author), mine: ch.author === 'danielreed', at: ch.mergedAt, reached: best, href: ch.htmlUrl });
	}
	rows.sort((a, b) => newestFirst(a.at, b.at));
	const reach = { dev: 0, test: 0, staging: 0, prod: 0, none: 0 } as Record<TierKey | 'none', number>;
	for (const r of rows) reach[r.reached ?? 'none']++;
	return { merged24: rows.length, mine24: rows.filter((r) => r.mine).length, reach, rows };
}
