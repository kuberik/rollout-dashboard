/**
 * THE ENVIRONMENT PAGE VIEW-MODEL (r39 build, 2026-11-08; mock .work/home-r34/direction/r39/env-detail.html + kit/model.js `envDetail`,
 * LANGUAGE.md "Additions (env-detail…)", AD round 3 SIGNED). Route `/envs/<name>`: ONE environment (a tier) or one production region
 * (`prod-<region>`). The operator's question: "what is running here, what is stuck or failing here and why, what arrives next, what landed
 * here lately?".
 *
 * Pure composition over the SAME helpers the list pages read (data.ts through the live FleetSource that FleetGate installs), so the page can
 * never disagree with them: the header's counts are `environmentsPage`'s own tile, the banner is Rollouts' `bannerOf`, the Attention cards are
 * Home's `askOf` (figure-led, observations when the API has them), the apps are Apps' tiles in THIS environment, At rest / Arriving next are
 * the StrandRow quiet rows. Nothing is parsed from the fixture here.
 *
 * Sites & waves: the drawing of an app's tile is its SITES & WAVES in this environment, from the product's sites-waves view-model
 * (`placeHolds().wave`, which is `buildTopology`): one box per wave (mark + word, the second state as a count), the leading site under it
 * ("eu-west leads · 2 follow"). A one-site app gets one box (its site).
 *
 * Headline rule (coordinator a): an app's headline state here is the MOST SEVERE state among its places (state-words `mostSevere`).
 */
import { newestFirst, latest } from '$lib/instant';
import { heldHere } from '../data';
import { siteCount, siteKey } from '$lib/view-models/regions';
import {
	rollouts, environments, placeHolds, inbound, rowsOf, ago, buildInQuestionFacts, deployedBuild, holdSince, commitHeadline, buildIdentity, isViewer, TIER_NAME, TIERS, apps as appsOf, fleet24hEvents,
	type HomeState, type TierKey, type TRow, type TApp, type PlaceHold, type Inbound
} from '../data';
import { environmentsPage, stateLine, barSegments, type EnvTile } from '../environments-page';
import { askOf, type AskItem } from '../home-page';
import { bannerOf, type BannerModel, type RestRow } from '../rollouts-page';
import { needApprovalCount, approvalWord, mostSevere, severity, stateWord } from '../state-words';
import { runwayRow, rowAction } from '../rollout-view';
import { plural } from '../envs-model';
import { classifyChanges, rc, type Rollup } from '../changes-page';
import { beadsFor } from '$lib/view-models/bead';
import { HELD_BY_PIN } from '$lib/view-models/pin-hold';
import type { EnvCell } from '$lib/components/EnvRow.svelte';

export type EnvTarget = { kind: 'tier'; tier: TierKey } | { kind: 'region'; label: string };

/** `/envs/<name>` -> a target, or null (NotFound). Tier keys are the Environments tiles' links; `prod-<region>` its region cells. */
export function resolveEnv(name: string, hs: HomeState): EnvTarget | null {
	if ((TIERS as readonly string[]).includes(name)) return { kind: 'tier', tier: name as TierKey };
	const m = /^prod-(.+)$/.exec(name);
	if (m && environments(hs).regions.some((r) => r.label === m[1])) return { kind: 'region', label: m[1] };
	return null;
}
/** `/envs/eu-west` is not a page, `/envs/prod-eu-west` is: the near match for NotFound */
export function suggestEnv(name: string, hs: HomeState): string | null {
	const n = name.toLowerCase();
	if (!n) return null;
	const names = [...(TIERS as readonly string[]), ...environments(hs).regions.map((r) => `prod-${r.label}`)];
	return names.find((x) => x !== n && (x.endsWith(`-${n}`) || x.startsWith(n) || n.startsWith(x))) ?? null;
}

type TPlace = { app: string; label: string; href: string; state: string; version?: string | null; since?: string | null };
export type EnvWave = {
	n: number; worst: string; adverse: boolean; build: string | null; leader: string; followers: string[];
	/** the states of the wave's sites that are not the worst, as counts ("1 checking") */
	others: string;
};
export type EnvApp = {
	app: string; href: string;
	/** this app's places in this environment (this region on a region page) */
	places: PlaceHold[];
	/** the app's most severe state here */
	worst: string;
	/** the app's most severe row here (null = at rest) */
	row: TRow | null;
	waves: EnvWave[];
	quiet: boolean;
	since: string | null;
	/** the app as Apps draws it, narrowed to this environment (Facia's item): its row, its places */
	item: TApp | null;
};
export type EnvPage = {
	name: string; title: string; tierKey: TierKey; region: string | null;
	meta: string;
	tile: Pick<EnvTile, 'mark' | 'lead' | 'parts' | 'calm' | 'label' | 'failing' | 'waiting' | 'moving' | 'rest'>;
	banner: (BannerModel & { newer: Newer | null }) | null;
	attention: (AskItem & { newer: Newer | null })[]; attentionRollup: Rollup;
	active: EnvApp[]; appsRollup: string[];
	atRest: RestRow[];
	arriving: RestRow[];
	/** r39 body B "Gangway": what waits to enter THIS environment (held / ready), the apps in step, today's deploys here */
	gangway: Gangway;
	empty: boolean;
};

/**
 * A newer build of an app whose place HERE is failing, waiting to enter this environment. One card per app per environment: the failing app is drawn
 * only under Attention (or as the banner), and this fact on that card keeps the promote action from being lost (batch 4 a). `hold` is the gate's word
 * when the build is held on the way in, null when it is ready to promote.
 */
export type Newer = { build: string; from: TierKey | null; hold: string | null };
/** the one sentence a Failing card prints for its `Newer` build */
export const newerNote = (n: Newer): string =>
	n.hold ? `Newer build ${n.build}${n.from ? ` from ${n.from}` : ''} · ${n.hold}` : `Newer build ${n.build} ready${n.from ? ` in ${n.from}` : ''}`;

/** One app with something waiting to enter this environment. `cells` is the EnvRow: the environments before this one that hold its unlanded changes (beads), then this environment's box. */
export type GangTile = {
	app: string; href: string;
	/** the held place's rollout (its detail gives the held-HERE count) */
	rolloutHref: string | null;
	/** "12 changes" on the way, or "1 build" when no merged change is tracked for it */
	/** null while a held tile's held-HERE count is not known yet (the tile shows a pending bar, never a guess) */
	count: string | null;
	hold: 'approval' | 'held' | null; yours: boolean;
	cells: EnvCell[];
	/** the footer: the oldest change still on its way (title, ref, age + its honest label), or the build and where it comes from */
	foot: { title: string | null; ref: string; age: string; ageLabel: string; ageTitle: string; from: string | null };
};
export type DayRow = { key: string; kind: 'deploy' | 'failed' | 'rolledBack'; app: string; href: string; place: string; title: string | null; build: string; who: string; age: string; /** a person pressed deploy (not the controller) */ mark: 'manual' | null; /** the reason they typed, or null (QA #14) */ reason: string | null };
export type Gangway = { held: GangTile[]; ready: GangTile[]; heldRollup: Rollup; inStep: { app: string; href: string }[]; /** apps here that run an older build and have nothing inbound: the same "N behind" the at-rest predicate prints, so they are never listed In step */ behind: { app: string; /** the lagging place's rollout (where the Deploy action is) */ href: string; n: number; /** its site, '' when the environment has one default site */ place: string; /** why nothing is inbound, from the lagging place's own tab data (behindWhy) */ why: string }[]; today: DayRow[]; todayRollup: Rollup };

/* a NAMED site: not empty and not a tier word (regions.ts siteKey, the one default-site rule) */
const SITE_NOT = (_tier: string) => (l: string) => siteKey(l) !== 'default';
const MARK_STATE: Record<string, 'failed' | 'held' | 'approval' | 'checking' | 'deploying'> = { failed: 'failed', 'awaiting-approval': 'approval', 'held-by-rule': 'held', checking: 'checking', deploying: 'deploying' };
const OTHER_WORD: Record<string, string> = { failed: 'failing', 'awaiting-approval': 'waiting', 'held-by-rule': 'held', checking: 'checking', deploying: 'deploying' };
const WORD: Record<string, string> = { failed: 'Failing', 'held-by-rule': 'Held', checking: 'Checking', deploying: 'Deploying' };
const ADVERSE = new Set(Object.keys(MARK_STATE));
const isSite = (tier: string, p: { label: string }) => SITE_NOT(tier)(p.label);

/** the waves of one app in this environment: [] when it has fewer than two sites here (one box, its site) */
export function wavesOf(places: PlaceHold[], tier: string): EnvWave[] {
	if (places.filter((p) => isSite(tier, p)).length < 2) return [];
	const by = new Map<number, PlaceHold[]>();
	for (const p of places) by.set(p.wave?.wave ?? 1, [...(by.get(p.wave?.wave ?? 1) ?? []), p]);
	return [...by.entries()].sort(([a], [b]) => a - b).map(([n, ps]) => {
		const sorted = [...ps].sort((x, y) => Number(!!y.wave?.leader) - Number(!!x.wave?.leader) || x.label.localeCompare(y.label));
		const worst = mostSevere(sorted, (p) => p.state)!.state;
		const others = Object.entries(sorted.reduce<Record<string, number>>((o, p) => (p.state !== worst && OTHER_WORD[p.state] ? ((o[p.state] = (o[p.state] ?? 0) + 1), o) : o), {})).map(([k, c]) => `${c} ${OTHER_WORD[k]}`).join(' · ');
		return { n, worst, adverse: ADVERSE.has(worst), build: sorted[0].deployedBuild ?? null, leader: sorted[0].label, followers: sorted.slice(1).map((p) => p.label), others };
	});
}

/** the app's environment row for this page: one box per wave (mark + word, natural width), the leading site under it; a one-site app gets its site. EnvRow draws it. */
export function cellsOf(a: Pick<EnvApp, 'waves' | 'places' | 'row'>, tier: string, region: string | null): EnvCell[] {
	const yours = !!a.row && a.row.state === 'awaiting-approval' && !!rowAction(a.row);
	const mark = (s: string): EnvCell['mark'] => (MARK_STATE[s] ? { state: MARK_STATE[s], tone: s === 'awaiting-approval' ? (yours ? 'held' : 'neutral') : undefined } : undefined);
	const word = (s: string) => (s === 'awaiting-approval' ? approvalWord(yours) : WORD[s]);
	const ink = (s: string) => (s === 'failed' ? 'text-danger' : s === 'checking' ? 'text-progress' : s === 'deploying' ? 'text-active' : 'text-held');
	if (a.waves.length) {
		return a.waves.map((w): EnvCell => ({
			key: `wave-${w.n}`, label: `Wave ${w.n}`,
			title: `Wave ${w.n}${w.build ? ` · ${w.build}` : ''}\n${w.leader} leads${w.followers.length ? `; follow: ${w.followers.join(', ')}` : ''}`,
			...(w.adverse ? { mark: mark(w.worst), word: word(w.worst), wordInk: ink(w.worst) } : { word: 'Healthy' }),
			...(w.others ? { fact: w.others, factKind: 'detail' as const } : {}),
			hang: { lead: w.leader, text: w.followers.length ? ` leads · ${w.followers.length === 1 ? `${w.followers[0]} follows` : `${w.followers.length} follow`}` : ' leads' }
		}));
	}
	const p = a.places[0];
	const st = a.row?.state ?? p?.state ?? 'healthy';
	const label = !p || p.label === tier || p.label === 'production' ? (region ? `prod-${region}`.replace(/^prod-/, '') : tier) : p.label;
	/* the state line above already says the word: the one box carries its site and the mark */
	return [{ key: 'site', label, ...(ADVERSE.has(st) ? { mark: mark(st) } : {}) }];
}

const REST_FILL = 'On the newest';

/**
 * ONE predicate for "how far behind its newest build is this app HERE" (an app's places in this environment, or in the one region): the at-rest rows'
 * "N behind" and the In step / Behind lists both read it, so an app cannot be 1 behind in one place on the page and in step in another.
 */
export const behindOfApp = (base: { placeList: readonly { tier: string; label: string; behind: number; currency?: string }[] } | null, tierKey: string, region: string | null): number =>
	/* THIS environment's own distance (the largest over its places), never the app's maximum over all of its places */
	base ? Math.max(0, ...base.placeList.filter((x) => x.tier === tierKey && (!region || x.label === region) && x.currency !== 'none').map((x) => x.behind)) : 0;
/** why a Behind row has nothing to promote, from the lagging place's own data (the tab's "Newer builds" list): "nothing inbound" only when that list is empty; otherwise what the tab offers, "1 to deploy", or "1 waiting on a check" while the place is held on its health check. */
export const behindWhy = (p: { heldBuilds: readonly unknown[]; holdReason: string | null } | null | undefined): string => {
	const n = p?.heldBuilds.length ?? 0;
	return !n ? 'nothing inbound' : p?.holdReason === 'health' ? `${n} waiting on a check` : `${n} to deploy`;
};
/** the apps with nothing inbound split by that predicate: on the newest build (In step) or an older one (Behind, with its number) */
export function stepSplit<A extends { app: string; href: string }>(apps: readonly A[], behindOf: (app: string) => number): { inStep: { app: string; href: string }[]; behind: { app: string; href: string; n: number }[] } {
	return {
		inStep: apps.filter((a) => behindOf(a.app) === 0).map((a) => ({ app: a.app, href: a.href })),
		behind: apps.filter((a) => behindOf(a.app) > 0).map((a) => ({ app: a.app, href: a.href, n: behindOf(a.app) }))
	};
}

export function envPage(hs: HomeState, name: string): EnvPage | null {
	const target = resolveEnv(name, hs);
	if (!target) return null;
	const tierKey: TierKey = target.kind === 'tier' ? target.tier : 'prod';
	const region = target.kind === 'region' ? target.label : null;
	const E = environments(hs);
	const T = E.tiers.find((t) => t.key === tierKey);
	if (!T) return null;
	const R = rollouts(hs);
	const A = appsOf(hs);

	/* the places this page speaks for */
	const allPlaces = (T.placesList as unknown as TPlace[]).filter((p) => !region || p.label === region);
	const rows: TRow[] = region ? rowsOf(hs, 'prod', region) : R.rows.filter((r) => r.tier === tierKey);

	/* header: the Environments tile's own state line and bar (a region: the same words over its own places) */
	const listTile = (() => { const P = environmentsPage(hs); return tierKey === 'prod' ? P.prod : P.tiles.find((t) => t.key === tierKey); })();
	const counts = region
		? (() => {
			const c = { failing: 0, waiting: 0, moving: 0, rest: 0 };
			for (const p of allPlaces) { if (p.state === 'failed') c.failing++; else if (p.state === 'awaiting-approval' || p.state === 'held-by-rule') c.waiting++; else if (p.state === 'deploying' || p.state === 'checking') c.moving++; else c.rest++; }
			return c;
		})()
		: { failing: listTile?.failing ?? 0, waiting: listTile?.waiting ?? 0, moving: listTile?.moving ?? 0, rest: listTile?.rest ?? 0 };
	const yoursN = rows.filter((r) => r.group === 'approval' && r.needsYou && !r.stillChecking).reduce((n, r) => n + Math.max(1, r.regions.length), 0);
	const movingWord = rows.some((r) => r.stillChecking || r.state === 'checking') && !rows.some((r) => r.state === 'deploying') ? 'checking' : 'deploying';
	const s = region ? stateLine({ places: allPlaces.length, ...counts, yours: Math.min(counts.waiting, yoursN) }, movingWord) : null;
	const tile: EnvPage['tile'] = region
		? { ...counts, mark: s!.mark, lead: s!.lead, parts: s!.parts, calm: !counts.failing && !counts.waiting && !counts.moving, label: `${allPlaces.length} places: ${counts.failing} failing, ${counts.waiting} waiting, ${counts.moving} ${movingWord}, ${counts.rest} healthy` }
		: { failing: counts.failing, waiting: counts.waiting, moving: counts.moving, rest: counts.rest, mark: listTile!.mark, lead: listTile!.lead, parts: listTile!.parts, calm: listTile!.calm, label: listTile!.label };

	/* banner + Attention: the lead failure here, then the other failures and the approvals the viewer can give */
	const failed = rows.filter((r) => r.group === 'failed');
	const lead = runwayRow(failed);
	const yours = rows.filter((r) => r.group === 'approval' && r.needsYou && !r.stillChecking);
	const attRows = [...failed.filter((r) => r !== lead), ...yours];
	const placeOf = (r: TRow) => (region ? '' : (r.regions.length > 1 ? `${r.regions.length} regions` : r.where === r.tier || ['production', 'staging', 'dev', 'test'].includes(r.where) ? '' : r.where));
	const attention = attRows.map((r) => { const it = askOf(r, hs, { noTier: true }); const pl = placeOf(r); return pl ? { ...it, id: { ...it.id, name: `${r.app} · ${pl}` } } : it; });
	const nF = attention.filter((a) => a.failed).length, nA = attention.length - nF;
	const attentionRollup: Rollup = [...(nF ? [{ text: `${nF} failing`, ink: 'danger' as const }] : []), ...(nA ? [{ text: `${nA} to approve`, ink: 'held' as const }] : [])];

	/* apps here: each app's places in this environment, its most severe row, its waves */
	const byApp = new Map<string, TPlace[]>();
	for (const p of allPlaces) byApp.set(p.app, [...(byApp.get(p.app) ?? []), p]);
	/* a failure the banner or an Attention card already states is not stated a third time: its tile says only "Failing" (+ place) */
	const shownAbove = new Set([lead, ...attRows].filter(Boolean).map((r) => r!.key));
	const apps: EnvApp[] = [...byApp.keys()].map((app) => {
		const places = placeHolds(app, hs).filter((p) => p.tier === tierKey && (!region || p.label === region));
		const mine = rows.filter((r) => r.app === app);
		const row = [...mine].sort((a, b) => severity(a.state) - severity(b.state) || Number(!!b.needsYou) - Number(!!a.needsYou) || newestFirst(a.since, b.since))[0] ?? null;
		const worst = mostSevere(places, (p) => p.state)?.state ?? 'healthy';
		const waves = wavesOf(places, tierKey);
		const since = latest((byApp.get(app) ?? []).map((p) => p.since));
		const base = A.items.find((x) => x.app === app) ?? null;
		const tileRow = row && row.group === 'failed' && shownAbove.has(row.key) ? ({ ...row, failure: { check: null, message: null, phrase: null, line: 'Failing' } } as TRow) : row;
		const item: TApp | null = base ? { ...base, row: tileRow, placeList: base.placeList.filter((p) => p.tier === tierKey && (!region || p.label === region)), group: row ? (row.group === 'failed' ? 'needs' : row.group === 'moving' ? 'moving' : 'waiting') : 'quiet', glyph: row ? (row.group === 'failed' ? 'failed' : row.group === 'approval' ? 'approval' : row.group === 'held' ? 'waiting' : 'deploying') : 'rest' } as TApp : null;
		return { app, href: `/apps/${app}`, places, worst, row, waves, quiet: !row, since, item };
	}).sort((a, b) => severity(a.worst) - severity(b.worst) || Number(a.quiet) - Number(b.quiet) || a.app.localeCompare(b.app));
	/* the body: every app not at rest here, apps with waves first (their drawing is taller; they share rows) */
	const act = apps.filter((a) => !a.quiet);
	const active = [...act.filter((a) => a.waves.length), ...act.filter((a) => !a.waves.length)];
	const appsRollup = [`${act.length} not at rest`];

	const behindHere = (app: string): number => behindOfApp(A.items.find((x) => x.app === app) ?? null, tierKey, region);
	/* At rest: a quiet row per app that has nothing to say here, newest deploy first */
	const restApps = apps.filter((a) => a.quiet);
	const atRest: RestRow[] = restApps.map((a) => {
		const p = (byApp.get(a.app) ?? [])[0];
		const ph = a.places[0];
		if (a.waves.length) return { key: `rest-${a.app}`, app: a.app, href: a.href, place: plural(a.places.length, 'region'), rep: false, sentence: `${a.waves.length} builds`, code: a.waves.map((w) => w.build ?? '').filter(Boolean).join(' · '), age: ago(a.since), tier: tierKey };
		const label = !ph || ph.label === tierKey || ph.label === 'production' ? '' : ph.label;
		const base = A.items.find((x) => x.app === a.app);
		const behind = behindHere(a.app);
		return { key: `rest-${a.app}`, app: a.app, href: ph?.href ?? a.href, place: label, rep: false, sentence: ph?.state === 'rolled-back' ? 'Rolled back' : behind ? `${behind} behind` : ph && base?.placeList.some((x) => x.href === ph.href && x.currency === 'none') ? 'No releases yet' : REST_FILL, code: ph?.deployedBuild ?? p?.version ?? '', age: ago(p?.since ?? a.since), tier: tierKey };
	}).sort((x, y) => 0 * (x.age.length - y.age.length));
	const sinceOf = new Map(apps.map((a) => [a.app, a.since ?? '']));
	atRest.sort((x, y) => newestFirst(sinceOf.get(x.app), sinceOf.get(y.app)) || x.app.localeCompare(y.app));

	/* Arriving next: builds NOT yet here and not already named by a tile (a tile for a waiting / held place names the waiting build; a moving one its own) */
	const named = new Set<string>();
	for (const a of active) {
		const r = a.row;
		if (!r) continue;
		const b = r.state === 'awaiting-approval' || r.state === 'held-by-rule' ? buildInQuestionFacts(r)?.build : deployedBuild(r).build;
		if (b) named.add(`${a.app}@${b}`);
	}
	const here = new Set(byApp.keys());
	const arrivingIn = inbound(hs, tierKey).filter((x) => here.has(x.app) && !named.has(`${x.app}@${x.build}`));
	const gateWord = (x: Inbound): string => {
		if (!x.reason) return '';
		if (/^Waiting for approval$/.test(x.reason)) return approvalWord(!!rows.find((r) => r.href === x.href)?.needsYou);
		return x.reason.replace(/^Waiting on /, 'Waits on ');
	};
	const arriving: RestRow[] = arrivingIn.map((x) => ({ key: `arr-${x.app}-${x.build}`, app: x.app, href: x.href ?? `/apps/${x.app}`, place: x.from ? `from ${x.from}` : '', rep: false, sentence: gateWord(x), code: x.build, age: '', tier: tierKey, codeFirst: true }));

	/* ── body B "Gangway" ── */
	const hereRank = TIERS.indexOf(tierKey);
	const { mineP, teamP } = classifyChanges(hs);
	const unlanded = [...mineP, ...teamP].filter((p) => p.state !== 'landed' && (TIERS as readonly string[]).indexOf(p.col) >= 0 && (TIERS as readonly string[]).indexOf(p.col) < hereRank);
	const yoursRow = (r: TRow | undefined) => !!r && r.state === 'awaiting-approval' && !!rowAction(r);
	const mkTile = (x: Inbound): GangTile => {
		const mine = unlanded.filter((p) => p.c.apps.includes(x.app));
		const row = rows.filter((r) => r.app === x.app && (r.state === 'awaiting-approval' || r.state === 'held-by-rule')).sort((a, b) => severity(a.state) - severity(b.state))[0];
		const approval = row ? row.state === 'awaiting-approval' : /^Waiting for approval$/.test(x.reason ?? '');
		const hold: GangTile['hold'] = row || x.reason ? (approval ? 'approval' : 'held') : null;
		const yours = approval && yoursRow(row);
		const tiers = TIERS.filter((t) => TIERS.indexOf(t) < hereRank && (mine.some((p) => p.col === t) || t === x.from));
		const cells: EnvCell[] = tiers.map((t) => {
			const here = mine.filter((p) => p.col === t);
			return { key: t, label: t, ...(here.length ? { beads: beadsFor(here.map(rc), { team: true }) } : t === x.from ? { fact: x.build, factKind: 'detail' as const } : {}) };
		});
		const places = allPlaces.filter((p) => p.app === x.app);
		const versions = [...new Set(places.map((p) => p.version).filter(Boolean))] as string[];
		const word = approval ? approvalWord(yours) : (x.reason ?? 'Held').replace(/^Waiting on /, 'Waits on ');
		cells.push({
			key: tierKey, label: tierKey, title: `${tierKey}: ${versions.length > 1 ? `${versions.length} builds across ${places.length} places` : versions[0] ?? ''}`,
			...(hold ? { mark: { state: approval ? 'approval' : 'held', tone: approval ? (yours ? 'held' : 'neutral') : undefined }, word, wordInk: approval && !yours ? 'text-fg-muted' : 'text-held' } : (versions.length === 1 ? { fact: versions[0], factKind: 'detail' as const } : versions.length ? { fact: `${versions.length} builds`, factKind: 'detail' as const } : {}))
		});
		const oldest = [...mine].sort((a, b) => Date.parse(a.c.mergedAt) - Date.parse(b.c.mergedAt))[0];
		const since = row ? holdSince(row, hs) : null;
		const foot: GangTile['foot'] = oldest
			? since ? { title: oldest.c.title, ref: oldest.ref, age: ago(since), ageLabel: 'waiting', ageTitle: 'Since the build began waiting', from: null }
				: { title: oldest.c.title, ref: oldest.ref, age: ago(oldest.c.mergedAt), ageLabel: 'merged', ageTitle: 'When the oldest waiting change was merged', from: null }
			: { title: null, ref: x.build, age: '', ageLabel: '', ageTitle: '', from: x.from };
		/* round 2 B5: with no tracked change the count is the builds this place's hold refuses HERE (heldHere), one build only while that is not known yet */
		const hereN = row && hold ? heldHere(row.href)?.count : null;
		return { app: x.app, href: x.href ?? `/apps/${x.app}`, rolloutHref: row?.href ?? null, count: mine.length ? plural(mine.length, 'change') : row && hold && hereN == null ? null : plural(hereN ?? 1, 'build'), hold, yours, cells, foot };
	};
	const inb = inbound(hs, tierKey).filter((x) => here.has(x.app)).map(mkTile).sort((a, b) => Number(!a.hold) - Number(!b.hold) || (a.hold === b.hold ? 0 : a.hold === 'approval' ? -1 : 1) || Number(b.yours) - Number(a.yours) || (parseInt(b.count ?? "") || 0) - (parseInt(a.count ?? "") || 0) || a.app.localeCompare(b.app));
	/* one card per app per environment: a failing app is not also a Held / Ready tile; its newer build rides on its Failing card */
	const failedApps = new Set(rows.filter((r) => r.group === 'failed').map((r) => r.app));
	const newerOf = (app: string): Newer | null => {
		const t = failedApps.has(app) ? inb.find((x) => x.app === app) : null;
		const x = t ? inbound(hs, tierKey).find((i) => i.app === app) : null;
		/* a pin on the failing place refuses the newer build too (pinHoldsBuilds, whatever the place's health) */
		const pinned = (A.items.find((i) => i.app === app)?.placeList ?? []).some((p) => p.tier === tierKey && (!region || p.label === region) && p.pinned);
		return t && x ? { build: x.build, from: x.from, hold: t.hold ? (x.reason ?? 'Held').replace(/^Waiting on /, 'Waits on ') : pinned ? HELD_BY_PIN : null } : null;
	};
	/* the same rule for an approval the viewer can give: its Attention card is the app's one card here */
	const carded = new Set([...failedApps, ...attRows.map((r) => r.app)]);
	const held = inb.filter((t) => t.hold && !carded.has(t.app)), ready = inb.filter((t) => !t.hold && !carded.has(t.app));
	const nAp = held.filter((t) => t.hold === 'approval').length;
	const heldRollup: Rollup = [...(nAp ? [{ text: needApprovalCount(nAp), ink: 'held' as const }] : []), ...(held.length - nAp ? [`${held.length - nAp} held`] : [])];
	const inSet = new Set(inb.map((t) => t.app));
	const split = stepSplit(apps.filter((a) => !inSet.has(a.app) && !failedApps.has(a.app)), behindHere);
	const { inStep } = split;
	/* a Behind row names the place that lags and links to ITS rollout, the page that has the action; the app page prints the same lag for that place */
	const behind = split.behind.map((b) => {
		const lag = (A.items.find((x) => x.app === b.app)?.placeList ?? []).filter((x) => x.tier === tierKey && (!region || x.label === region) && x.currency !== 'none').sort((x, y) => y.behind - x.behind)[0];
		return { ...b, href: lag?.href ?? b.href, place: !lag || lag.label === tierKey || ['prod', 'production'].includes(lag.label) ? '' : lag.label, why: behindWhy(lag ? placeHolds(b.app, hs).find((h) => h.href === lag.href) : null) };
	});
	const evs = fleet24hEvents(hs, tierKey).filter((e) => !region || e.place === region || e.place === `prod-${region}` || e.place.endsWith(region));
	const today: DayRow[] = evs.map((e, i) => {
		const pl = e.place.replace(/^prod-/, '');
		const raw = commitHeadline(e.href, e.build)?.title ?? buildIdentity(e.build, e.href)?.title ?? null;
		const title = raw && !/^(Initial commit|Release commit for build )/.test(raw) ? raw : null;
		return { key: `${e.app}-${e.place}-${e.at}-${i}`, kind: e.kind, app: e.app, href: e.href, place: ['prod', 'production', 'staging', 'dev', 'test'].includes(pl) ? '' : pl, title, build: e.build, who: isViewer(e.trigger) ? 'you' : e.who, age: ago(e.at), mark: e.mark, reason: e.reason };
	});
	const nFailed = today.filter((d) => d.kind === 'failed').length;
	const todayRollup: Rollup = [plural(today.length, 'deploy'), ...(nFailed ? [{ text: `${nFailed} failed`, ink: 'danger' as const }] : [])];
	const gangway: Gangway = { held, ready, heldRollup, inStep, behind, today, todayRollup };

	void fleet24hEvents; void TIER_NAME; void stateWord; void barSegments;
	const title = region ? `prod-${region}` : (TIER_NAME[tierKey] ?? tierKey);
	/* QA #10 / round 2 B3: sites, never environments; a lone default site has no region wording */
	const nSites = siteCount(allPlaces.map((p) => p.label));
	const regionsN = !region && tierKey === 'prod' && nSites > 1 ? nSites : 0;
	const meta = [plural(allPlaces.length, 'place'), plural(new Set(allPlaces.map((p) => p.app)).size, 'app'), ...(regionsN ? [plural(regionsN, 'region')] : [])].join(' · ');
	return { name, title, tierKey, region, meta, tile, banner: lead ? { ...bannerOf(lead), newer: newerOf(lead.app) } : null, attention: attention.map((a) => ({ ...a, newer: newerOf(a.app) })), attentionRollup, active, appsRollup, atRest, arriving, gangway, empty: !allPlaces.length };
}
