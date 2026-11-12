/**
 * THE STAGES MODEL (change-stages r1; change-strip r1: the Change page's strip reads it, the App view and Rollout overview read
 * PromotionLane's lane): one change's places by (tier, wave) x app, the states of THIS change.
 * The change's pipeline as COLUMNS (tier, wave) x LANES (app) x CELLS (places).
 * One truth: every state comes from detail-model `classified` / `notReached` (the Changes list reads the same), the counts agree with
 * `countsOf`. The SHAPE (columns, lanes, the order of places inside a cell) comes from the TOPOLOGY (`waveInfoOfHref`), never from
 * state, so a state change can never add, drop, reorder or move a tile (owner: "environments jumping").
 */
import { ago, noReleasesAt, placesOf, rowsOf, placeHolds, buildIdentity, rangeOfBuild, type HomeState, type TChange, type TierKey, waveInfoOfHref } from '../data';
import { approvalWord } from '../state-words';
import { holdWord, holdWordParts } from '../rollout-view';
import { causeText, type Cause } from '$lib/view-models/gate-label';
import { ledgerOf } from '../app/app-model';
import { changeBySha } from '$lib/components/home/sketch/home-data';
import { behindWords, classified, countsOf, currentAt, notReached, restSteps, type Place } from '../change/detail-model';

export type StageState = 'deployed' | 'checking' | 'deploying' | 'held' | 'approval' | 'failed' | 'notreached' | 'notaffected' | 'replaced';
export type StagePlace = { href: string; app: string; tier: TierKey; /** the place's own name inside its tile (region / site) */ name: string; leader: boolean; state: StageState; /** the state word (t-meta, line 2) */ word: string; /** the cause of a hold, the one helper `stageCause` decides */ cause: Cause | null; /** "1 of 2" for a place in flight */ progress: string | null; age: string | null; /** the build this place runs, set only when the app's places differ (app and rollout scope), printed on the t-meta line */ build: string | null; /** rollout scope: the place of the rollout being viewed (aria-current="location") */ here: boolean; /** change-strip r2: the build the place runs now and its lag in the words origin/main's "Where it runs" used ("3 builds behind" / "Up to date"); empty while moving, for a newer failure or without releases */ current: string | null; lag: string; /** THE one live object of the drawing: the deploying place, else the checking one (first in lane then column order); carries the product's `is-live` glow */ live: boolean };
export type StageColumn = { key: string; tier: TierKey; wave: number | null; /** the env chip's label */ label: string; /** the tier has more than one wave: "Wave N" is worth printing */ multi: boolean };
export type StageCell = { places: StagePlace[] };
export type StageLane = { app: string; cells: (StageCell | null)[] };
export type StageRollup = { text: string; parts: { text: string; /** the short spelling a narrow card prints ("4 of 5"): chosen by width, never by state */ short?: string; ink: 'danger' | 'held' | 'progress' | 'active' | 'muted' | 'fg' }[] };
export type StagesScope = { kind: 'change'; change: TChange } | { kind: 'app'; app: string };
/** `release`: app scope only, the build the drawing is about (the app's newest, `placesOf(...).newest`), null without releases */
export type Stages = { columns: StageColumn[]; lanes: StageLane[]; rollup: StageRollup; /** the narrow card's rollup (app scope): with more than one adverse count the in-flight ones (checking + deploying) read as one "N in progress"; "N of M places" never shortens */ narrow?: StageRollup; release?: string | null };

const TIER_RANK: Record<string, number> = { dev: 0, test: 1, staging: 2, prod: 3 };

/** THE one place a hold's cause is decided, TYPED (PR #128): a promotion hold keeps its `GateLabel`, so the tile draws » [STAGING]
 *  through `CauseText`/`GateLabel`, never "Promotion from staging" as text. Every tile reads this alone; `causeText` flattens it for titles. */
export function stageCause(p: Place, scenario: HomeState): Cause | null {
	if (p.kind !== 'waiting' || !p.row) return null;
	if (p.row.group === 'approval') return [approvalWord(!!p.row.needsYou)];
	return holdWordParts(p.row, scenario) ?? [holdWord(p.row, scenario) ?? 'Held'];
}

export function stateOf(p: Place, scenario: HomeState): StageState {
	if (p.kind === 'failed' || (p.kind === 'running' && p.newerFails)) return 'failed';
	if (p.kind === 'waiting') return p.row?.group === 'approval' ? 'approval' : 'held';
	if (p.kind === 'running') return p.row?.state === 'checking' ? 'checking' : p.row?.state === 'deploying' ? 'deploying' : 'deployed';
	if (p.replacedFrom) return 'replaced';
	return notReached(p, scenario) !== null ? 'notreached' : 'notaffected';
}

const WORD: Record<StageState, string> = { deployed: 'Deployed', checking: 'Checking', deploying: 'Deploying', held: 'Held', approval: 'Waiting for approval', failed: 'Failed', notreached: 'Not reached', notaffected: 'Not affected', replaced: 'Replaced' };

function lagOf(p: Place, st: StageState, scenario: HomeState): string {
	if (st === 'checking' || st === 'deploying' || st === 'notaffected' || st === 'replaced' || p.newerFails || noReleasesAt(p.href)) return '';
	const w = behindWords(p.app, p.href, scenario);
	/* QA r1 (4): only a counted lag or the newest; a bare "behind" (a custom build) says nothing here */
	return w === 'on the newest' ? 'Up to date' : /^\d/.test(w) ? w : '';
}

type Item = { p: Place; col: StageColumn; site: string; leader: boolean; build: string | null; /** app scope: the state decided against the release (else `stateOf`) */ st?: StageState; /** app scope: the word of a place moving a build that is not the release */ word?: string };

/** columns (tier, wave) sorted tier then wave; a tier is "multi" for every one of its columns when any of them says so */
function columnsOf(cols: Map<string, StageColumn>): StageColumn[] {
	const columns = [...cols.values()].sort((a, b) => (TIER_RANK[a.tier] ?? 9) - (TIER_RANK[b.tier] ?? 9) || (a.wave ?? 0) - (b.wave ?? 0));
	for (const col of columns) col.multi = columns.some((x) => x.tier === col.tier && x.multi);
	return columns;
}
function columnFor(cols: Map<string, StageColumn>, href: string, tier: TierKey): { col: StageColumn; wi: ReturnType<typeof waveInfoOfHref> } {
	const wi = waveInfoOfHref(href);
	const key = `${tier}:${wi?.wave ?? 0}`;
	let col = cols.get(key);
	if (!col) cols.set(key, (col = { key, tier, wave: wi?.wave ?? null, label: tier, multi: false }));
	if (wi?.multi) col.multi = true;
	return { col, wi };
}
const siteOf = (wi: ReturnType<typeof waveInfoOfHref>, label: string, tier: TierKey) => (!wi?.site || wi.site === 'default' ? (label === 'default' ? tier : label) : wi.site);

function assemble(apps: string[], items: Item[], columns: StageColumn[], scenario: HomeState, rollup: StageRollup, here: string | null): Stages {
	const toPlace = (i: Item): StagePlace => {
		const st = i.st ?? stateOf(i.p, scenario);
		const steps = i.p.row?.steps ?? restSteps(i.p.app, scenario, i.p.href);
		const done = steps.filter((s) => s.state === 'done').length;
		return { href: i.p.href, app: i.p.app, tier: i.p.tier, name: i.site, leader: i.leader, state: st, word: i.word ?? (st === 'held' || st === 'approval' ? causeText(stageCause(i.p, scenario) ?? [WORD[st]]) : st === 'notaffected' && noReleasesAt(i.p.href) ? 'No releases' : WORD[st]), cause: st === 'held' || st === 'approval' ? stageCause(i.p, scenario) : null, progress: st === 'checking' || st === 'deploying' ? `${done} of ${steps.length}` : null, age: st === 'deployed' ? ago(currentAt(i.p.href) ?? i.p.at ?? i.p.since) : st === 'failed' || st === 'checking' || st === 'deploying' ? ago(i.p.at ?? i.p.since) : null, build: i.build, here: here === i.p.href, live: false, current: i.p.current ?? null, lag: lagOf(i.p, st, scenario) };
	};
	const lanes: StageLane[] = apps.map((app) => ({
		app,
		cells: columns.map((col) => {
			const mine = items.filter((i) => i.p.app === app && i.col === col);
			if (!mine.length) return null;
			/* leader first, then the site's name: never by state */
			mine.sort((a, b) => Number(b.leader) - Number(a.leader) || a.site.localeCompare(b.site));
			return { places: mine.map(toPlace) };
		})
	}));
	/* exactly one live object: the first deploying place, else the first checking one, in lane then column order (shape-neutral: style only) */
	const flat = lanes.flatMap((l) => l.cells.flatMap((c) => c?.places ?? []));
	const live = flat.find((p) => p.state === 'deploying') ?? flat.find((p) => p.state === 'checking');
	if (live) live.live = true;
	return { columns, lanes, rollup };
}

export function stagesOf(scope: StagesScope, scenario: HomeState): Stages {
	const cols = new Map<string, StageColumn>();
	if (scope.kind === 'app') return appStages(scope.app, cols, scenario);
	{
		const c = scope.change;
		const cl = classified(c, scenario);
		const byHref = new Map<string, Place>();
		for (const p of [...cl.places, ...cl.unaffected]) byHref.set(p.href, p);
		const items: Item[] = [];
		for (const u of cl.all) {
			const p = byHref.get(u.href);
			if (!p) continue;
			const { col, wi } = columnFor(cols, u.href, u.tier);
			items.push({ p, col, site: siteOf(wi, u.label, u.tier), leader: wi?.leader ?? false, build: null });
		}
		return assemble(c.apps, items, columnsOf(cols), scenario, rollupOf(c, scenario), null);
	}
}

/**
 * APP SCOPE (app-pipeline r0): the app's newest build is THE RELEASE and every place is drawn against it. One lane, one tile per
 * (tier, wave); the shape is topology, the states are this moment's. Order of precedence: no releases (not affected, never counted)
 * > failed > approval / held (the row group) > deploying / checking (the row state) > deployed (runs the release) > not reached
 * (runs an older build, which line 2 prints). A held or approval place is held / approval with its cause whatever build it runs (the Overview and the banner say the same).
 * "N of M places" is the Builds card's own count (places on the newest build, no-release places left out).
 */
function appStages(app: string, cols: Map<string, StageColumn>, scenario: HomeState): Stages {
	const places = placesOf(scenario, app);
	const release = places.find((x) => x.newest)?.newest ?? null;
	const items: Item[] = [];
	for (const x of places) {
		const row = rowsOf(scenario, x.tier, x.label).find((r) => r.app === app && r.href === x.href) ?? null;
		const kind: Place['kind'] = x.state === 'failed' ? 'failed' : row && (row.group === 'approval' || row.group === 'held') ? 'waiting' : 'running';
		const p: Place = { href: x.href, app, tier: x.tier, label: x.label, row, group: row?.group ?? 'rest', state: x.state, current: x.version, containsChange: true, kind, since: row?.since ?? currentAt(x.href), build: x.version, at: currentAt(x.href) };
		const { col, wi } = columnFor(cols, x.href, x.tier);
		const inFlight = row?.state === 'checking' || row?.state === 'deploying';
		const onRelease = !!release && x.version === release;
		let st: StageState;
		if (noReleasesAt(x.href)) st = 'notaffected';
		else if (kind === 'failed') st = 'failed';
		else if (kind === 'waiting') st = row?.group === 'approval' ? 'approval' : 'held';
		else if (inFlight && onRelease) st = row?.state === 'checking' ? 'checking' : 'deploying';
		else st = onRelease ? 'deployed' : 'notreached';
		/* a place moving a build that is NOT the release: quiet, its own state as plain words (no glow, not counted) */
		const word = inFlight && !onRelease && st === 'notreached' ? (row?.state === 'checking' ? 'Checking' : 'Deploying') : undefined;
		items.push({ p, col, site: siteOf(wi, x.label, x.tier), leader: wi?.leader ?? false, build: st === 'held' || st === 'approval' ? null : st === 'notreached' || (st !== 'notaffected' && !onRelease) ? x.version : null, st, word });
	}
	const out = assemble([app], items, columnsOf(cols), scenario, { text: '', parts: [] }, null);
	const ps = out.lanes[0].cells.flatMap((c) => c?.places ?? []);
	const counted = ps.filter((p) => p.state !== 'notaffected');
	const k = (s: StageState) => ps.filter((p) => p.state === s).length;
	const ran = counted.filter((p) => items.find((i) => i.p.href === p.href)?.p.current === release).length;
	const parts: StageRollup['parts'] = release ? [{ text: `${ran} of ${counted.length} place${counted.length === 1 ? '' : 's'}`, ink: 'muted' }] : [{ text: 'No releases', ink: 'muted' }];
	if (k('failed')) parts.push({ text: `${k('failed')} failing`, ink: 'danger' });
	if (k('approval')) parts.push({ text: `${k('approval')} waiting`, ink: 'held' });
	if (k('held')) parts.push({ text: `${k('held')} held`, ink: 'held' });
	if (k('checking')) parts.push({ text: `${k('checking')} checking`, ink: 'progress' });
	if (k('deploying')) parts.push({ text: `${k('deploying')} deploying`, ink: 'active' });
	out.rollup = { text: parts.map((p) => p.text).join(' · '), parts };
	out.narrow = narrowRollup(out.rollup, k('checking') + k('deploying'));
	out.release = release;
	return out;
}

function rollupOf(c: TChange, scenario: HomeState): StageRollup {
	const cl = classified(c, scenario);
	const n = countsOf(cl.all, cl.places);
	const unreached = cl.unaffected.filter((p) => !p.replacedFrom && notReached(p, scenario) !== null).length;
	const total = cl.places.length + unreached;
	const ran = n.live + n.checking + n.deploying;
	const parts: StageRollup['parts'] = [{ text: `${ran} of ${total} place${total === 1 ? '' : 's'}`, short: `${ran} of ${total}`, ink: 'muted' }];
	if (n.failing) parts.push({ text: `${n.failing} failing`, ink: 'danger' });
	if (n.waiting) parts.push({ text: `${n.waiting} waiting`, ink: 'held' });
	if (n.held) parts.push({ text: `${n.held} held`, ink: 'held' });
	if (n.checking) parts.push({ text: `${n.checking} checking`, ink: 'progress' });
	if (n.deploying) parts.push({ text: `${n.deploying} deploying`, ink: 'active' });
	return { text: parts.map((p) => p.text).join(' · '), parts };
}

const changeHrefOf = (html: string | null | undefined): string | null => (html && /^https?:/.test(html) ? '/changes/github.com' + new URL(html).pathname.replace(/\/commit\//, '/') : null);

/**
 * THE RELEASE LINE of the Pipeline card: the app's newest build (the Builds card's lead stop, one truth) with its commit title, author, how
 * long ago it was built, and the change page that carries it when the fleet knows one. null without releases.
 */
export type ReleaseLine = { build: string; title: string | null; author: string | null; built: string; /** the dashboard's change page, when one exists */ href: string | null };
export function releaseLine(app: string, scenario: HomeState): ReleaseLine | null {
	const places = placeHolds(app, scenario);
	const lead = ledgerOf(places)[0];
	if (!lead || lead.custom) return null;
	const id = buildIdentity(lead.build, places[0]?.href);
	return { build: lead.build, title: lead.title ?? id?.title ?? null, author: lead.author ?? id?.author ?? null, built: lead.ageLabel, href: changeHrefOf(changeBySha(app, lead.build)?.href ?? id?.href) };
}

/**
 * "IN THIS RELEASE" (app-pipeline r2): the builds between what production runs and the release, newest first, one row per build with its
 * commit title, author, sha, diffstat (+/-, where the tab's range knows it) and the change page that carries it.
 * `base` is the OLDEST build a production place runs (any place when the app has no production place); a place already on the release
 * asks nothing. status: 'none' (no releases: the card is not drawn) | 'empty' (every counted place runs the release) | 'ready'.
 */
export type ReleaseCommit = { sha: string; title: string; author: string | null; add: number | null; del: number | null; href: string | null };
export type ReleaseCommits = { status: 'none' | 'empty' | 'ready'; release: string | null; base: string | null; commits: ReleaseCommit[]; /** the lead build's change page (the "N more" link) */ href: string | null };
export function releaseCommits(app: string, scenario: HomeState): ReleaseCommits {
	const places = placeHolds(app, scenario).filter((p) => !noReleasesAt(p.href));
	const stops = ledgerOf(places);
	const lead = stops[0];
	if (!lead || lead.custom) return { status: 'none', release: null, base: null, commits: [], href: null };
	const prod = places.filter((p) => p.tier === 'prod');
	const pool = (prod.length ? prod : places).filter((p) => p.deployedBuild && p.deployedBuild !== lead.build);
	const idx = (p: (typeof pool)[number]) => stops.find((s) => s.build === p.deployedBuild)?.index ?? null;
	const known = pool.filter((p) => idx(p) != null);
	const oldest = known.sort((a, b) => (idx(b) as number) - (idx(a) as number))[0];
	const leadHref = changeHrefOf(changeBySha(app, lead.build)?.href ?? buildIdentity(lead.build, places[0]?.href)?.href);
	if (!oldest) return { status: 'empty', release: lead.build, base: null, commits: [], href: leadHref };
	const ask = oldest.href;
	const rows = stops.filter((s) => s.index != null && s.index < (idx(oldest) as number)).map((s): ReleaseCommit => {
		const r = rangeOfBuild(ask, s.build);
		const id = buildIdentity(s.build, ask);
		return { sha: s.build, title: s.title ?? r?.title ?? id?.title ?? s.build, author: s.author ?? r?.author ?? id?.author ?? null, add: r ? r.additions : null, del: r ? r.deletions : null, href: changeHrefOf(changeBySha(app, s.build)?.href ?? id?.href) };
	});
	return { status: rows.length ? 'ready' : 'empty', release: lead.build, base: oldest.deployedBuild, commits: rows, href: leadHref };
}

/** the narrow form of an app rollup: more than one adverse count collapses checking + deploying into one "N in progress" (active ink); held and failed keep their own */
export function narrowRollup(r: StageRollup, inFlight: number): StageRollup {
	const live = r.parts.filter((p) => p.ink === 'progress' || p.ink === 'active');
	if (r.parts.length - 1 < 2 || live.length < 2) return r;
	const parts: StageRollup['parts'] = [...r.parts.filter((p) => p.ink !== 'progress' && p.ink !== 'active'), { text: `${inFlight} in progress`, ink: 'active' }];
	return { text: parts.map((p) => p.text).join(' · '), parts };
}
