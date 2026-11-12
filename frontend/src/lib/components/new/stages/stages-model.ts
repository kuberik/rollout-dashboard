/**
 * THE STAGES MODEL (change-stages r1; change-strip r1: the Change page's strip reads it, the App view and Rollout overview read
 * PromotionLane's lane): one change's places by (tier, wave) x app, the states of THIS change.
 * The change's pipeline as COLUMNS (tier, wave) x LANES (app) x CELLS (places).
 * One truth: every state comes from detail-model `classified` / `notReached` (the Changes list reads the same), the counts agree with
 * `countsOf`. The SHAPE (columns, lanes, the order of places inside a cell) comes from the TOPOLOGY (`waveInfoOfHref`), never from
 * state, so a state change can never add, drop, reorder or move a tile (owner: "environments jumping").
 */
import { ago, type HomeState, type TChange, type TierKey, waveInfoOfHref } from '../data';
import { approvalWord } from '../state-words';
import { holdWord, holdWordParts } from '../rollout-view';
import { causeText, type Cause } from '$lib/view-models/gate-label';
import { classified, countsOf, notReached, restSteps, type Place } from '../change/detail-model';

export type StageState = 'deployed' | 'checking' | 'deploying' | 'held' | 'approval' | 'failed' | 'notreached' | 'notaffected' | 'replaced';
export type StagePlace = { href: string; app: string; tier: TierKey; /** the place's own name inside its tile (region / site) */ name: string; leader: boolean; state: StageState; /** the state word (t-meta, line 2) */ word: string; /** the cause of a hold, the one helper `stageCause` decides */ cause: Cause | null; /** "1 of 2" for a place in flight */ progress: string | null; age: string | null; /** the build this place runs, set only when the app's places differ (app and rollout scope), printed on the t-meta line */ build: string | null; /** rollout scope: the place of the rollout being viewed (aria-current="location") */ here: boolean; /** THE one live object of the drawing: the deploying place, else the checking one (first in lane then column order); carries the product's `is-live` glow */ live: boolean };
export type StageColumn = { key: string; tier: TierKey; wave: number | null; /** the env chip's label */ label: string; /** the tier has more than one wave: "Wave N" is worth printing */ multi: boolean };
export type StageCell = { places: StagePlace[] };
export type StageLane = { app: string; cells: (StageCell | null)[] };
export type StageRollup = { text: string; parts: { text: string; /** the short spelling a narrow card prints ("4 of 5"): chosen by width, never by state */ short?: string; ink: 'danger' | 'held' | 'progress' | 'active' | 'muted' | 'fg' }[] };
export type StagesScope = { kind: 'change'; change: TChange };
export type Stages = { columns: StageColumn[]; lanes: StageLane[]; rollup: StageRollup };

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

type Item = { p: Place; col: StageColumn; site: string; leader: boolean; build: string | null };

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
		const st = stateOf(i.p, scenario);
		const steps = i.p.row?.steps ?? restSteps(i.p.app, scenario, i.p.href);
		const done = steps.filter((s) => s.state === 'done').length;
		return { href: i.p.href, app: i.p.app, tier: i.p.tier, name: i.site, leader: i.leader, state: st, word: st === 'held' || st === 'approval' ? causeText(stageCause(i.p, scenario) ?? [WORD[st]]) : WORD[st], cause: st === 'held' || st === 'approval' ? stageCause(i.p, scenario) : null, progress: st === 'checking' || st === 'deploying' ? `${done} of ${steps.length}` : null, age: st === 'deployed' ? ago(i.p.since ?? i.p.at) : st === 'failed' || st === 'checking' || st === 'deploying' ? ago(i.p.at ?? i.p.since) : null, build: i.build, here: here === i.p.href, live: false };
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
