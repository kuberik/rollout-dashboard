/**
 * THE STAGES MODEL (change-stages r1; change-strip r1: the Change page's strip reads it, the App view and Rollout overview read
 * PromotionLane's lane): one change's places by (tier, wave) x app, the states of THIS change.
 * The change's pipeline as COLUMNS (tier, wave) x LANES (app) x CELLS (places).
 * One truth: every state comes from detail-model `classified` / `notReached` (the Changes list reads the same), the counts agree with
 * `countsOf`. The SHAPE (columns, lanes, the order of places inside a cell) comes from the TOPOLOGY (`waveInfoOfHref`), never from
 * state, so a state change can never add, drop, reorder or move a tile (owner: "environments jumping").
 */
import { ago, noReleasesAt, placesOf, rowsOf, placeHolds, buildIdentity, changes, type HomeState, type TChange, type TierKey, waveInfoOfHref } from '../data';
import { approvalWord } from '../state-words';
import { holdWord, holdWordParts } from '../rollout-view';
import { causeText, type Cause } from '$lib/view-models/gate-label';
import { ledgerOf, type Stop } from '../app/app-model';
import type { MarkSiteState } from '$lib/view-models/wave-mark';
import { changeBySha } from '$lib/components/home/sketch/home-data';
import { behindWords, classified, countsOf, currentAt, notReached, restSteps, type Place } from '../change/detail-model';
import { TIER_RANK as TIER_RANKS } from '$lib/view-models/sites-waves';

export type StageState = 'deployed' | 'checking' | 'deploying' | 'held' | 'approval' | 'failed' | 'notreached' | 'notaffected' | 'replaced';
export type StagePlace = { href: string; /** an approval the viewer can give (the strip draws it with the viewer's ring) */ yours?: boolean; app: string; tier: TierKey; /** the place's own name inside its tile (region / site) */ name: string; leader: boolean; state: StageState; /** the state word (t-meta, line 2) */ word: string; /** the cause of a hold, the one helper `stageCause` decides */ cause: Cause | null; /** "1 of 2" for a place in flight */ progress: string | null; age: string | null; /** the build this place runs, set only when the app's places differ (app and rollout scope), printed on the t-meta line */ build: string | null; /** rollout scope: the place of the rollout being viewed (aria-current="location") */ here: boolean; /** change-strip r2: the build the place runs now and its lag in the words origin/main's "Where it runs" used ("3 builds behind" / "Up to date"); empty while moving, for a newer failure or without releases */ current: string | null; lag: string; /** app scope: the place runs a build NEWER than the selected release ("ahead"): drawn On <build>, or its own checking/deploying mark; never live, never counted as in flight */ ahead: boolean; /** THE one live object of the drawing: the deploying place, else the checking one (first in lane then column order); carries the product's `is-live` glow */ live: boolean };
export type StageColumn = { key: string; tier: TierKey; wave: number | null; /** the env chip's label */ label: string; /** the tier has more than one wave: "Wave N" is worth printing */ multi: boolean };
export type StageCell = { places: StagePlace[] };
export type StageLane = { app: string; cells: (StageCell | null)[] };
export type StageRollup = { text: string; parts: { text: string; /** the short spelling a narrow card prints ("4 of 5"): chosen by width, never by state */ short?: string; ink: 'danger' | 'held' | 'muted' | 'fg'; /** a count of places that move on their own (checking / deploying): neutral ink like their state word (state-tone.ts), folded on a narrow card */ moving?: true }[] };
export type StagesScope = { kind: 'change'; change: TChange } | { kind: 'app'; app: string; /** the selected release (a build of the Builds card's ledger); unknown or absent = the default */ release?: string | null };
/** `release`: app scope only, the build the drawing is about (the app's newest, `placesOf(...).newest`), null without releases */
export type Stages = { columns: StageColumn[]; lanes: StageLane[]; rollup: StageRollup; /** the narrow card's rollup (app scope): with more than one adverse count the in-flight ones (checking + deploying) read as one "N in progress"; "N of M places" never shortens */ narrow?: StageRollup; release?: string | null };

const TIER_RANK: Record<string, number> = TIER_RANKS;

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

type Item = { p: Place; col: StageColumn; site: string; leader: boolean; build: string | null; /** app scope: the state decided against the release (else `stateOf`) */ st?: StageState; /** app scope: the word of a place moving a build that is not the release */ word?: string; /** app scope: runs a build newer than the release */ ahead?: boolean };

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
		return { href: i.p.href, yours: st === 'approval' && !!i.p.row?.needsYou, app: i.p.app, tier: i.p.tier, name: i.site, leader: i.leader, state: st, word: i.word ?? (st === 'held' || st === 'approval' ? causeText(stageCause(i.p, scenario) ?? [WORD[st]]) : st === 'notaffected' && noReleasesAt(i.p.href) ? 'No releases' : WORD[st]), cause: st === 'held' || st === 'approval' ? stageCause(i.p, scenario) : null, progress: !i.ahead && (st === 'checking' || st === 'deploying') ? `${done} of ${steps.length}` : null, age: i.ahead ? null : st === 'deployed' ? ago(currentAt(i.p.href) ?? i.p.at ?? i.p.since) : st === 'failed' || st === 'checking' || st === 'deploying' ? ago(i.p.at ?? i.p.since) : null, build: i.build, here: here === i.p.href, ahead: !!i.ahead, live: false, current: i.p.current ?? null, lag: lagOf(i.p, st, scenario) };
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
	const live = flat.find((p) => !p.ahead && p.state === 'deploying') ?? flat.find((p) => !p.ahead && p.state === 'checking');
	if (live) live.live = true;
	return { columns, lanes, rollup };
}

export function stagesOf(scope: StagesScope, scenario: HomeState): Stages {
	if (scope.kind === 'app') return appStages(scope.app, scenario, scope.release);
	const cols = new Map<string, StageColumn>();
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
 * APP SCOPE (pipeline release switcher; lineage: app-pipeline r0): the Pipeline card draws ONE SELECTED RELEASE, `release` (a stop of the
 * Builds card's ledger, `ledgerOf(placeHolds(...))`, index 0 = newest) or, without one, the DEFAULT: the OLDEST release that has not
 * reached every place yet (nothing in flight: the newest). One lane, one tile per (tier, wave); the shape is topology, the states are this
 * moment's, so switching the release repaints marks and words and moves nothing.
 *
 * A place REACHED release R when it runs a NEWER build, or runs R itself and is at rest (not deploying / checking / failed). Per place, v = the
 * build it runs / moves:
 *   - no releases: not affected, never counted.
 *   - v newer than R ("ahead"): Deployed, tail "on <v>" (never glows, never "Not reached", never held); a failure there still draws failed
 *     (adverse; the place has reached R).
 *   - v is R: failed; deploying / checking (THE live object); else Deployed (a hold on it is about other builds).
 *   - v older than R (or a custom build): the old rules: failed > approval / held (with the cause) > in flight on its older build (quiet
 *     "Checking" / "Deploying" word, no glow) > not reached, the line 2 printing the build it still runs.
 * "N of M places on R": N = the places RUNNING R in any state (the Builds card's count: in flight, held and failed included; the adverse ones also print as their own part, "1 checking"); M = the places on a catalogue build (custom-build and not-affected places are left out). Ahead places draw "On <build>" and are not in N. "Reached" (newer build, or R at rest) only decides the default selection and the rail.
 */
type Entry = { x: ReturnType<typeof placesOf>[number]; p: Place; row: ReturnType<typeof rowsOf>[number] | null; kind: Place['kind']; col: StageColumn; site: string; leader: boolean; v: string | null; idx: number | null; inFlight: boolean; counted: boolean };
type AppCtx = { stops: Stop[]; entries: Entry[]; columns: StageColumn[]; by: Map<string, Stop> };

/** the stops a release can be: catalogue builds with an index (custom builds are not releases), newest first */
const releaseStops = (stops: Stop[]) => stops.filter((s) => s.index != null && !s.custom);

function appCtx(app: string, scenario: HomeState): AppCtx {
	const holds = placeHolds(app, scenario).filter((p) => !noReleasesAt(p.href));
	const stops = ledgerOf(holds);
	const by = new Map(stops.map((s) => [s.build, s]));
	const cols = new Map<string, StageColumn>();
	const entries: Entry[] = placesOf(scenario, app).map((x) => {
		const row = rowsOf(scenario, x.tier, x.label).find((r) => r.app === app && r.href === x.href) ?? null;
		const kind: Place['kind'] = x.state === 'failed' ? 'failed' : row && (row.group === 'approval' || row.group === 'held') ? 'waiting' : 'running';
		const p: Place = { href: x.href, app, tier: x.tier, label: x.label, row, group: row?.group ?? 'rest', state: x.state, current: x.version, containsChange: true, kind, since: row?.since ?? currentAt(x.href), build: x.version, at: currentAt(x.href) };
		const { col, wi } = columnFor(cols, x.href, x.tier);
		const idx = x.version ? by.get(x.version)?.index ?? null : null;
		return { x, p, row, kind, col, site: siteOf(wi, x.label, x.tier), leader: wi?.leader ?? false, v: x.version ?? null, idx, inFlight: row?.state === 'checking' || row?.state === 'deploying', counted: !noReleasesAt(x.href) && idx != null };
	});
	return { stops, entries, columns: columnsOf(cols), by };
}

/** has this place reached the release at index `r`? (newer build, or the release itself at rest) */
const reached = (e: Entry, r: number) => e.counted && ((e.idx as number) < r || ((e.idx as number) === r && !e.inFlight && e.kind !== 'failed'));

function inFlightOf(c: AppCtx): Stop[] {
	return releaseStops(c.stops).filter((s) => c.entries.some((e) => e.counted && !reached(e, s.index as number))).sort((a, b) => (b.index as number) - (a.index as number));
}
const defaultOf = (c: AppCtx): string | null => inFlightOf(c)[0]?.build ?? releaseStops(c.stops)[0]?.build ?? null;

/** the selected release: the param when it names a ledger stop, else the default (oldest in flight, else the newest); null without releases */
export function resolveRelease(app: string, scenario: HomeState, param?: string | null): string | null {
	const c = appCtx(app, scenario);
	return param && releaseStops(c.stops).some((s) => s.build === param) ? param : defaultOf(c);
}

/** the strip's vocabulary: a stage state is one site's MarkSiteState (the graph and the rail read the same map) */
/** a place's site state for the strip: an approval the viewer can give carries the viewer's ring */
export const siteMarkOf = (p: Pick<StagePlace, 'state' | 'yours'>): MarkSiteState => (p.state === 'approval' && p.yours ? 'approval-yours' : SITE_MARK[p.state]);
export const SITE_MARK: Record<StageState, MarkSiteState> = { deployed: 'done', checking: 'checking', deploying: 'deploying', held: 'held', approval: 'approval', failed: 'failed', notreached: 'notreached', notaffected: 'notaffected', replaced: 'notaffected' };

function drawRelease(app: string, c: AppCtx, scenario: HomeState, release: string | null): Stages {
	const r = release ? c.by.get(release)?.index ?? null : null;
	const items: Item[] = c.entries.map((e) => {
		const { x, row, kind } = e;
		const ahead = r != null && e.counted && (e.idx as number) < r;
		const onRelease = r != null && e.idx === r;
		let st: StageState;
		let build: string | null = null;
		let word: string | undefined;
		if (noReleasesAt(x.href)) st = 'notaffected';
		else if (ahead) {
			/* newer than the release: its own mark (failed, checking, deploying) or Deployed; line 2 "On <build>" / "Checking <build>" */
			st = kind === 'failed' ? 'failed' : e.inFlight ? (row?.state === 'checking' ? 'checking' : 'deploying') : 'deployed';
			build = e.v;
			if (st !== 'failed') word = 'On'; /* the mark carries checking / deploying; the tile's title holds the full words */
		}
		else if (kind === 'failed') { st = 'failed'; build = onRelease ? null : e.v; }
		else if (onRelease) st = e.inFlight ? (row?.state === 'checking' ? 'checking' : 'deploying') : 'deployed';
		else if (kind === 'waiting') st = row?.group === 'approval' ? 'approval' : 'held';
		else { st = 'notreached'; build = e.v; if (e.inFlight) word = row?.state === 'checking' ? 'Checking' : 'Deploying'; }
		return { p: e.p, col: e.col, site: e.site, leader: e.leader, build, st, word, ahead };
	});
	const out = assemble([app], items, c.columns, scenario, { text: '', parts: [] }, null);
	const ps = out.lanes[0].cells.flatMap((cell) => cell?.places ?? []);
	const k = (s: StageState) => ps.filter((p) => p.state === s && !((s === 'checking' || s === 'deploying') && p.ahead)).length;
	/* THE BUILDS CARD'S COUNT: N = the places RUNNING this release in any state (in flight, held and failed included; the adverse ones also print as their own part), M = the places on a catalogue build (custom-build and not-affected places are left out, as the Builds card leaves them) */
	const ran = r == null ? 0 : c.entries.filter((e) => e.counted && e.idx === r).length;
	const total = c.entries.filter((e) => e.counted).length;
	const parts: StageRollup['parts'] = release ? [{ text: `${ran} of ${total} place${total === 1 ? '' : 's'} on ${release}`, short: `${ran} of ${total} on ${release}`, ink: 'muted' }] : [{ text: 'No releases yet', ink: 'muted' }];
	if (k('failed')) parts.push({ text: `${k('failed')} failing`, ink: 'danger' });
	if (k('approval')) parts.push({ text: `${k('approval')} waiting`, ink: 'held' });
	if (k('held')) parts.push({ text: `${k('held')} held`, ink: 'held' });
	if (k('checking')) parts.push({ text: `${k('checking')} checking`, ink: 'muted', moving: true });
	if (k('deploying')) parts.push({ text: `${k('deploying')} deploying`, ink: 'muted', moving: true });
	out.rollup = { text: parts.map((p) => p.text).join(' · '), parts };
	out.narrow = narrowRollup(out.rollup, k('checking') + k('deploying'));
	out.release = release;
	return out;
}

function appStages(app: string, scenario: HomeState, param?: string | null): Stages {
	const c = appCtx(app, scenario);
	const rel = param && releaseStops(c.stops).some((s) => s.build === param) ? param : defaultOf(c);
	return drawRelease(app, c, scenario, rel);
}

/**
 * THE RELEASE RAIL's rows: the releases on their way out (in flight), OLDEST FIRST (the default is the first row; the strips read as a
 * staircase, the top row furthest along). One row per release: build, commit title, author and the release's own mini strip = one entry
 * per tier (topology order), each the per-site MarkSiteState list of that release's stages. The shape is the same for every row.
 */
export type RailItem = { build: string; title: string | null; author: string | null; /** the default selection (the oldest in flight) */ oldest: boolean; tiers: { tier: TierKey; sites: MarkSiteState[] }[] };
export function releasesInFlight(app: string, scenario: HomeState): { items: RailItem[]; selectedDefault: string | null } {
	const c = appCtx(app, scenario);
	const flight = inFlightOf(c);
	const items = flight.map((s, i): RailItem => {
		const st = drawRelease(app, c, scenario, s.build);
		const tiers: RailItem['tiers'] = [];
		for (let ci = 0; ci < st.columns.length; ci++) {
			const t = st.columns[ci].tier;
			let g = tiers.find((x) => x.tier === t);
			if (!g) tiers.push((g = { tier: t, sites: [] }));
			for (const p of st.lanes[0].cells[ci]?.places ?? []) g.sites.push(SITE_MARK[p.state]);
		}
		const id = buildIdentity(s.build, c.entries[0]?.x.href);
		return { build: s.build, title: s.title ?? id?.title ?? null, author: s.author ?? id?.author ?? null, oldest: i === 0, tiers };
	});
	return { items, selectedDefault: items[0]?.build ?? releaseStops(c.stops)[0]?.build ?? null };
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
	if (n.checking) parts.push({ text: `${n.checking} checking`, ink: 'muted', moving: true });
	if (n.deploying) parts.push({ text: `${n.deploying} deploying`, ink: 'muted', moving: true });
	return { text: parts.map((p) => p.text).join(' · '), parts };
}

/** the dashboard's change page for a GitHub url, only when the Changes list HAS that change (a link must never land on "does not exist") */
const changeHrefOf = (html: string | null | undefined, scenario: HomeState): string | null => {
	if (!html || !/^https?:/.test(html)) return null;
	const href = '/changes/github.com' + new URL(html).pathname.replace(/\/commit\//, '/');
	return changes(scenario, { rolledBackLands: true }).items.some((i) => i.changeHref === href) ? href : null;
};

/**
 * THE RELEASE LINE of the Pipeline card: the SELECTED release (default: the Builds card's lead stop, one truth) with its commit title, author, how
 * long ago it was built, and the change page that carries it when the fleet knows one. null without releases.
 */
export type ReleaseLine = { build: string; title: string | null; author: string | null; built: string; /** the dashboard's change page, when one exists */ href: string | null };
export function releaseLine(app: string, scenario: HomeState, build?: string | null): ReleaseLine | null {
	const places = placeHolds(app, scenario).filter((p) => !noReleasesAt(p.href));
	const stops = ledgerOf(places);
	const lead = (build ? stops.find((s) => s.build === build) : null) ?? stops[0];
	if (!lead || lead.custom) return null;
	const id = buildIdentity(lead.build, places[0]?.href);
	return { build: lead.build, title: lead.title ?? id?.title ?? null, author: lead.author ?? id?.author ?? null, built: lead.ageLabel, href: changeHrefOf(changeBySha(app, lead.build)?.href ?? id?.href, scenario) };
}


/** the narrow form of an app rollup: more than one adverse count collapses checking + deploying into one "N in progress" (neutral, like the words it folds); held and failed keep their own */
export function narrowRollup(r: StageRollup, inFlight: number): StageRollup {
	/* the narrow card prints the short spelling ("3 of 5 on 4.44.0-44"): chosen by width (this form is the container's narrow branch), never by state */
	r = { text: '', parts: r.parts.map((p) => (p.short ? { ...p, text: p.short } : p)) };
	r.text = r.parts.map((p) => p.text).join(' · ');
	const live = r.parts.filter((p) => p.moving);
	if (r.parts.length - 1 < 2 || live.length < 2) return r;
	const parts: StageRollup['parts'] = [...r.parts.filter((p) => !p.moving), { text: `${inFlight} in progress`, ink: 'muted', moving: true }];
	return { text: parts.map((p) => p.text).join(' · '), parts };
}

/** The width a graph column is drawn at: the canvas minus its 32px padding, the gaps and the lane-label track, shared equally, capped at `cap` (the grid's minmax). Decided by width and column count only. */
export function columnWidth(canvas: number, columns: number, gaps: number, label: number, cap = 280): number {
	return Math.min(cap, (canvas - 32 - gaps - label) / Math.max(1, columns));
}

/** App scope: below this column width every row stacks its build on its own line (line 3); at or above it the build sits beside the state word. */
export const TAIL_BESIDE = 192;
/** The narrowest column that still shows every word and build in full once the tail is stacked (the build is the widest unit, ~70px, plus the longest cause ~137px under the tile's 6px padding). */
export const MIN_TAIL = 152;
