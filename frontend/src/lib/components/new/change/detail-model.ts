/**
 * r34 v2 CD r2 — view-model of the change detail page (/changes/<slug>). ONE MODEL with the Changes list (S1): the places, the
 * counts, the strip and the History spine all come from data.ts's batch-5 helpers (placesOfChange / historyOfChange /
 * regionStates / runsIn / heldBehind / changeCommits) and change-view's facts; nothing here invents a fact. A place RUNS the
 * change only when its deployed build CONTAINS it (the PR's own containedIn: a "Custom build" does not count).
 * v2 r4: ONE count per page (`countsOf`), every place's state/build/age is the TAB's current deploy (`currentAt`), a place the change does
 * not reach is listed as "not affected", the History spine keeps every place's current deploy and waiting events read in the tab's own age.
 */
import { oldestFirst, newestFirst, earliest, latest, isLater, isNotEarlier } from '$lib/instant';
import type { Rollout } from '$lib/../types';
import { availableReleases, releaseCandidates } from '$lib/releases/registry.svelte';
import {
	changes, candidateBuilds, shortBuild, placesOfChange, historyOfChange, changeCommits, runsIn, rowsOf, rollouts, heldBehind, lastHealthy, ago,
	buildInQuestionFacts, deployedBuild, stepsOf, buildTitle, pathPosition, buildCommitOf,
	type TChange, type TRow, type HomeState, type TierKey, type Step, waitClock, waveInfoOfHref
} from '../data';
import { stateWord, approvalWord } from '../state-words';
import { holdWord as holdText } from '../rollout-view';
import { changeBySha, homeModel } from '$lib/components/home/sketch/home-data';
import { rangeJson, pullJson } from '../github-read.svelte';
import { slots, isViewer, span, folioFacts, type Slot } from '../change-view';
import { lagLabel } from '$lib/view-models/env-rank';
import { source } from '$lib/components/home/sketch/home-data';

type RawV = { revision?: string; tag?: string; version?: string };
type RawC = { tag?: string; version?: string; revision?: string; created?: string };
type RawH = { version: RawV; timestamp: string; bakeEndTime?: string; bakeStatus?: string; message?: string };
type RawR = { metadata: { name: string; namespace: string }; status: { history?: RawH[] } };
const RAWS = (): RawR[] => source().rollouts as unknown as RawR[];
const rawOf = (href: string): RawR | null => {
	const p = href.split('/').filter(Boolean);
	return p[0] === 'rollouts' ? (RAWS().find((r) => r.metadata.namespace === p[2] && r.metadata.name === p[3]) ?? null) : null;
};
/** CE1: the instant of the place's CURRENT deploy, as the tab's header prints it ("15m ago"): the newest history entry */
export const currentAt = (href: string): string | null => rawOf(href)?.status.history?.[0]?.timestamp ?? null;
/** canonical `/changes/<slug>` for a short `<repo>/pull/<n>` address (CE8): the owner the Changes list links to, else null */
export function canonicalSlug(raw: string, scenario: HomeState = 'incident'): string | null {
	const seg = raw.split('/').filter(Boolean);
	if (seg.length !== 3 || seg[1] !== 'pull') return null;
	const hit = changes(scenario, { rolledBackLands: true }).items.find((i) => (i.changeHref ?? '').endsWith(`/${seg[0]}/pull/${seg[2]}`));
	return hit?.changeHref ? hit.changeHref.replace(/^\/changes\//, '') : null;
}

/** the change a `/changes/<slug>` address names (the same `changeHref` the Changes list links to) */
export function findChange(slug: string, scenario: HomeState): TChange | null {
	const href = `/changes/${slug.replace(/^\/+|\/+$/g, '')}`;
	const xs = changes(scenario, { rolledBackLands: true }).items.filter((i) => i.changeHref === href);
	return xs.find((i) => !i.rolledBack) ?? xs[0] ?? null;
}

export type PlaceKind = 'failed' | 'waiting' | 'running' | 'unaffected';
/** AD r5 N1: an unaffected place whose build is an OLDER build of the same line (the tab says "N builds behind") has simply not been reached yet; only a custom / pinned build is not affected */
export const notReached = (p: Place, scenario: HomeState): string | null => {
	if (p.kind !== 'unaffected' || p.replacedFrom || !p.current) return null;
	const w = runsIn(p.app, scenario).find((r) => r.href === p.href)?.word ?? '';
	const n = /^(\d+) behind$/.exec(w)?.[1];
	if (n) return lagLabel({ builds: Number(n) });
	/* no release list to count from (orders-api prod): the build is on the line when another place of the app has deployed it (its History knows it); the count is then unknown and the detail empty */
	const older = runsIn(p.app, scenario).some((r) => r.href !== p.href && (rawOf(r.href)?.status.history ?? []).some((h) => shortBuild(h.version.version ?? h.version.tag ?? h.version.revision) === p.current));
	return older ? '' : null;
};
/** one PLACE (one region of production, or one non-prod environment): a rollout row when the place needs a look, else none */
export type Unit = { href: string; app: string; tier: TierKey; label: string; row: TRow | null; group: string; state: string; current: string | null; containsChange: boolean };
/** `since` = when the change reached the place (sorting, History); `at` = the age the TAB prints for the place's current deploy (the row's age, CE1) */
export type Place = Unit & { /** the place's CURRENT deploy fails but the change ran healthily earlier (rideTruth): it landed here, the failure is a newer build's */ newerFails?: boolean; /** with newerFails: the build that CARRIED the change here before the failing one (the page's note: "newer than this change's a11c101") */ carried?: string | null; /** with newerFails: the tab's own failing row (its steps), kept off `row` so no action is offered for another change's failure */ tabRow?: TRow | null; /** an unaffected place that once ran a build carrying the change: the build that replaced it is `current` */ replacedFrom?: string | null; kind: PlaceKind; since: string | null; build: string | null; at: string | null };
const KIND_RANK: Record<PlaceKind, number> = { failed: 0, waiting: 1, running: 2, unaffected: 3 };
const TIER_RANK: Record<TierKey, number> = { dev: 0, test: 1, staging: 2, prod: 3 };

/** every place of the change's app(s), each with how it relates to the change; worst first (failing, waiting, running), then furthest tier, then newest */
export function classified(c: TChange, scenario: HomeState): { all: Unit[]; places: Place[]; unaffected: Place[] } {
	const pc = placesOfChange(c, scenario);
	const hist = historyOfChange(c, scenario);
	const all: Unit[] = pc.map((p) => {
		const row = rowsOf(scenario, p.tier, p.place).find((r) => r.app === p.app && r.href === p.href) ?? null;
		return { href: p.href, app: p.app, tier: p.tier, label: p.place, row, group: row?.group ?? 'rest', state: p.state, current: p.build, containsChange: p.containsChange };
	});
	const places: Place[] = [];
	/* the build that FIRST carried the change (the History's oldest deploy): the place that still runs it is the one to open when nothing is adverse */
	const firstBuild = hist[0]?.build ?? null;
	for (const u of all) {
		const mine = hist.filter((h) => h.href === u.href);
		/* rideTruth (change-truth.ts): a place that already ran the change healthily (a Succeeded deploy in its History) did not fail on it: the failing build is a later change's, so the change LANDED there */
		const ranOk = mine.some((h) => h.outcome === 'Succeeded');
		if (u.state === 'failed' && mine.length && !ranOk) { places.push({ ...u, kind: 'failed', since: u.row?.since ?? mine[mine.length - 1].at, build: u.current, at: u.row?.since ?? currentAt(u.href) }); continue; }
		if (u.state === 'failed' && ranOk) { const first = mine.find((h) => h.outcome === 'Succeeded')!; places.push({ ...u, row: null, tabRow: u.row, state: 'healthy', current: u.current, newerFails: true, carried: first.build, kind: 'running', since: first.at, build: u.current, at: currentAt(u.href) ?? first.at }); continue; }
		if (u.containsChange) { const first = mine.find((h) => h.outcome === 'Succeeded') ?? mine[0]; places.push({ ...u, kind: 'running', since: first?.at ?? null, build: u.current, at: currentAt(u.href) ?? first?.at ?? null }); continue; }
		if (u.row && (u.group === 'approval' || u.group === 'held')) {
			/* CE2: the wait is THIS change's build: the OLDEST candidate that carries it (c0d3e88, "Held by a rule · 4h" on the tab), never the newest build behind it (f4a2c19 is the labelled "Newer build") */
			const cand = ((releaseCandidates(rawOf(u.href) as unknown as Rollout) as RawC[] | undefined) ?? []).filter((x) => carriesBuild(c, x)).sort((a, b) => oldestFirst(a.created, b.created))[0];
			if (cand) {
				const cb = shortBuild(cand.version ?? cand.tag ?? cand.revision);
				/* the ONE wait clock, for THIS change's build (data.ts `waitClock(row, s, build)`: never before the build reached the place's gate) */
				const wait = waitClock(u.row, scenario, cb) ?? cand.created ?? u.row.since;
				places.push({ ...u, kind: 'waiting', since: wait, build: cb, at: wait });
			}
		}
	}
	const ownRank = (p: Place) => (p.kind === 'running' && p.current === firstBuild ? 0 : 1);
	/* CE2: a place the change neither runs nor waits for is NOT AFFECTED: it stays on the page (named, with its build) so the count adds up */
	const unaffected: Place[] = all.filter((u) => !places.some((p) => p.href === u.href)).map((u) => ({ ...u, kind: 'unaffected' as const, since: null, build: u.current, at: currentAt(u.href), replacedFrom: hist.find((h) => h.href === u.href && h.outcome === 'Succeeded')?.build ?? null }));
	const rank = (p: Place) => (p.newerFails ? 0.5 : KIND_RANK[p.kind]);
	places.sort((a, b) => rank(a) - rank(b) || TIER_RANK[b.tier] - TIER_RANK[a.tier] || ownRank(a) - ownRank(b) || newestFirst(a.since, b.since));
	return { all, places, unaffected };
}
/** a build is looked up by the CHANGE's repo (platform-telemetry), never by the place's app name (telemetry-indexer), so a multi-service change finds its build on every service */
const carriesBuild = (c: Pick<TChange, 'mergedAt' | 'repo'>, v: RawV) => { const k = changeBySha(c.repo, (v.revision ?? v.tag ?? '').slice(0, 7)); return !!k && isNotEarlier(k.mergedAt, c.mergedAt); };
export const runningN = (ps: Place[]) => ps.filter((p) => p.kind === 'running').length;
/** CE2: THE count of the page, with its unit, read from here by the header, the Places rollup and the tests: "9 places · 3 live · 5 waiting · 1 not affected" */
export function countsOf(all: Unit[], places: Place[]) {
	/* the tab's own words for a place that runs the change: Deployed, Checking (clock), Deploying (arc); a count says each once (CF2). A place whose NEWER build fails is FAILING (the tab's red), not deployed (CE3) */
	const run = places.filter((p) => p.kind === 'running' && !p.newerFails);
	const checking = run.filter((p) => p.row?.state === 'checking').length, deploying = run.filter((p) => p.row?.state === 'deploying').length;
	const waiting = places.filter((p) => p.kind === 'waiting' && p.group !== 'held').length, held = places.filter((p) => p.kind === 'waiting' && p.group === 'held').length, failing = places.filter((p) => p.kind === 'failed' || p.newerFails).length;
	/* AD r2 (2): a place held by a rule is "held", one waiting for an approval is "waiting" (the banner's, the chip's and the row's words) */
	return { places: places.length, live: run.length - checking - deploying, checking, deploying, waiting, held, failing, notAffected: Math.max(0, all.length - places.length) };
}
const countParts = (n: ReturnType<typeof countsOf>) => [n.live ? `${n.live} deployed` : '', n.checking ? `${n.checking} checking` : '', n.deploying ? `${n.deploying} deploying` : '', n.waiting ? `${n.waiting} waiting` : '', n.held ? `${n.held} held` : '', n.failing ? `${n.failing} failing` : ''];
export function countLine(n: ReturnType<typeof countsOf>): string {
	return [`${n.places} place${n.places === 1 ? '' : 's'}`, ...countParts(n), n.notAffected ? `${n.notAffected} not affected` : ''].filter(Boolean).join(' · ');
}
/** the phone's count (owner 2026-11-02 §5, CF5): what RUNS only; "9 places" is the Places card's rollup, and what fails or waits is the banner's word, said once */
export const countShort = (n: ReturnType<typeof countsOf>): string => [n.live ? `${n.live} deployed` : '', n.checking ? `${n.checking} checking` : '', n.deploying ? `${n.deploying} deploying` : ''].filter(Boolean).join(' · ');

/* ═══ the strip (S1/S2): the tab strip's tiles one size up; prod's squares COUNT THE CHANGE (CD2) ═══ */
export type Ink = 'failed' | 'waiting' | 'moving' | 'healthy' | 'behind' | 'checking';
export type Tile = { tier: TierKey; href: string | null; /** "1 build behind" (the tab's lag words), null on the newest */ word: string | null; /** prod: one square per region, in the change's terms; other tiers: one mark only on a place that needs a look */ squares: Ink[]; /** prod: "2/3" = regions that run the change healthily / regions (kept for tests) */ frac: string | null; /** CE15: prod's count in words with its unit and object: "2 of 3 regions run this change" ("2 of 3 run it · 1 failing": the change's position; the squares are the tab's region states) */ label: string | null; own: boolean; /** CF2: "1 not affected", beside the label, never inside its denominator */ aside: string | null; /** CF2: the tab strip outlines a tier whose place is moving: checking (yellow) / deploying (blue) */ flight: 'checking' | 'deploying' | null; /** owner §6: the tile's state MARK (StatusMark state) and ONE state word at every width: Live / Deploying / Checking / Waiting / Held / Failing */ mark: string; state: string };
/**
 * ONE count of the change's production regions, shared by the statement's words ("Live in 5 of 6 places"), the strip's squares and the
 * Folio's Tidemark on /changes: a region is HEALTHY when its deployed build carries the change and does not fail, FAILING when its
 * deploy of the change failed, WAITING when a build that carries the change waits there (approval or rule), BEHIND otherwise (grey:
 * the change has not reached it). `frac` = healthy/regions. EXPORTED for the Folio side (change-view / Folio): import `changeProd`.
 */
export function changeProd(c: TChange, scenario: HomeState): { squares: Ink[]; /** each square in the TAB's region state (regionStates: failed / waiting(held) / moving / checking / healthy): colour = state (AD Changes r5) */ states: Ink[]; healthy: number; of: number; frac: string; /** "2 of 3 run it · 1 failing" | "0 of 3 run it · 2 held" | "3 of 3 run it": the change's position with unit, adverse state after it */ count: string; /** "prod · " + count */ sentence: string; href: string | null; /** v2 r5 (additive): the regions the change can reach (a custom build / a build that does not carry it is NOT AFFECTED and never in a denominator) */ affected: number; notAffected: number; /** `count` over the affected regions, "waiting" for what waits: "0 of 5 run it · 5 waiting" */ countAffected: string } {
	const { all, places } = classified(c, scenario);
	const prod = all.filter((u) => u.tier === 'prod');
	const ink = (u: Unit): Ink => {
		const p = places.find((x) => x.href === u.href);
		return p?.kind === 'failed' || p?.newerFails ? 'failed' : p?.kind === 'waiting' ? 'waiting' : p?.kind === 'running' ? 'healthy' : 'behind';
	};
	const squares = prod.map(ink);
	const healthy = squares.filter((x) => x === 'healthy').length;
	/* CG1: a square is THIS change's state in the region (red only where it fails, orange only where it is held, a Live region neutral/green even when a NEWER build waits there); a region the change does not reach is GREY */
	const states = prod.map((u): Ink => { const p = places.find((x) => x.href === u.href); return !p ? 'behind' : p.kind === 'failed' || p.newerFails ? 'failed' : p.kind === 'waiting' ? 'waiting' : p.row?.state === 'checking' ? 'checking' : p.row?.state === 'deploying' ? 'moving' : 'healthy'; });
	const reached = (u: Unit) => places.some((x) => x.href === u.href);
	const failing = squares.filter((x) => x === 'failed').length;
	const held = prod.filter((u, i) => squares[i] !== 'healthy' && squares[i] !== 'failed' && states[i] === 'waiting').length;
	const count = [`${healthy} of ${prod.length} run it`, failing ? `${failing} failing` : '', held ? `${held} held` : ''].filter(Boolean).join(' · ');
	const affected = prod.filter(reached).length, notAffected = prod.length - affected;
	const waitN = prod.filter((u, i) => squares[i] === 'waiting').length;
	const countAffected = [`${healthy} of ${affected} run it`, failing ? `${failing} failing` : '', waitN ? `${waitN} waiting` : ''].filter(Boolean).join(' · ');
	const worst = prod.find((u) => ink(u) === 'failed') ?? prod.find((u) => ink(u) === 'waiting') ?? prod[0];
	return { squares, states, healthy, of: prod.length, frac: `${healthy}/${prod.length}`, count, sentence: `prod · ${count}`, href: worst?.href ?? null, affected, notAffected, countAffected };
}
/** CE1: the strip's prod sentence in the page's words ("1 failing · 2 deployed"); "Live" is retired as a state word. change-view's squaresSentence still says "live" for the Changes list (not this lane's file). */
const squaresWords = (inks: Ink[]): string => {
	const n = (k: Ink) => inks.filter((x) => x === k).length;
	const out = ([[n('failed'), 'failing'], [n('waiting'), 'waiting'], [n('moving'), 'deploying'], [n('checking'), 'checking'], [n('healthy'), 'deployed']] as [number, string][]).filter(([k]) => k > 0).map(([k, w]) => `${k} ${w}`).join(' · ');
	return out || (inks.length ? 'not reached' : '');
};
const sqInk = (state: string, onNewest: boolean): Ink =>
	state === 'failed' ? 'failed' : state === 'awaiting-approval' || state === 'held-by-rule' ? 'waiting' : state === 'deploying' ? 'moving' : state === 'checking' ? 'checking' : onNewest ? 'healthy' : 'behind';
/** the worst state of the change's places in one tier, as the tab's mark and word */
function tierState(ps: Place[]): { mark: string; state: string } {
	const f = ps.find((p) => p.kind === 'failed' || p.newerFails);
	if (f) return { mark: 'failed', state: 'Failing' };
	const w = ps.find((p) => p.kind === 'waiting');
	if (w) return w.group === 'held' ? { mark: 'held', state: 'Held' } : { mark: 'held', state: 'Waiting' };
	const run = ps.filter((p) => p.kind === 'running');
	if (run.some((p) => p.row?.state === 'checking')) return { mark: 'checking', state: 'Checking' };
	if (run.some((p) => p.row?.state === 'deploying')) return { mark: 'deploying', state: 'Deploying' };
	return run.length ? { mark: 'newest', state: 'Deployed' } : { mark: 'none', state: 'Not reached' };
}
export function stripOf(c: TChange, scenario: HomeState): Tile[] {
	const app = c.apps[0];
	const placesAll = classified(c, scenario).places;
	const runs = c.apps.length === 1 ? runsIn(app, scenario) : [];
	/* the tab draws a mark on a non-prod tile only for a place that needs a look; a place that is merely moving gets none */
	const MARKED = new Set(['failed', 'awaiting-approval', 'held-by-rule']);
	return slots(c).filter((s: Slot) => s.kind !== 'absent').map((s) => {
		const ps = runs.filter((p) => p.tier === s.tier);
		const behind = Math.max(0, ...ps.map((p) => Number(/^(\d+) behind$/.exec(p.word)?.[1] ?? 0)));
		if (s.tier === 'prod') {
			const pr = changeProd(c, scenario);
			if (pr.of > 1) return { tier: s.tier, href: pr.href, word: null, squares: pr.states, frac: `${pr.healthy}/${pr.affected}`, label: squaresWords(pr.states), own: true, aside: pr.notAffected ? `${pr.notAffected} not affected` : null, flight: pr.states.includes('checking') ? 'checking' : pr.states.includes('moving') ? 'deploying' : null, ...tierState(placesAll.filter((p) => p.tier === 'prod')) };
		}
		const own = ps.find((p) => MARKED.has(p.state));
		const href = (own ?? ps[0])?.href ?? null;
		const fl = ps.find((p) => p.state === 'checking' || p.state === 'deploying');
			return { tier: s.tier, href, word: behind > 0 ? lagLabel({ builds: behind }) : null, /* changedetail-8 CD2: a one-place tier's mark already says its state: no second (square) mark beside it */ squares: [], frac: null, label: null, own: !!own, aside: null, flight: fl ? (fl.state === 'checking' ? 'checking' : 'deploying') : null, ...tierState(placesAll.filter((p) => p.tier === s.tier)) };
	});
}

/* ═══ the statement (S3): the tab's banner words; regions = the Places' regions ═══ */
const list = (xs: string[]) => (xs.length <= 3 ? xs.join(xs.length === 2 ? ' and ' : ', ').replace(/, ([^,]+)$/, ' and $1') : `${xs.length} places`);
/** `line` = the statement's ONE sentence for a wait (a failure's sentence is `blockLine`); the page's count is `countLine`, printed once in the header (CE2/CE12) */
export type Statement = { kind: 'failed' | 'waiting' | 'held' | 'landed' | 'healthy'; title: string; line: string | null; /** the phone's cause line (no age: the row carries it once, CF5) */ short: string | null; lead: Place | null };
export function statementOf(c: TChange, places: Place[], all: Unit[]): Statement {
	/* BUILD-R4: an approval reads "5 of 6 prod regions" (the denominator is every prod region of the app) */
	const prodN = all.filter((u) => u.tier === 'prod').length;
	const names = (ps: Place[]) => (ps.length > 3 && ps.every((p) => p.tier === 'prod') ? `${ps.length} of ${prodN} prod regions` : list(ps.map((p) => p.label)));
	const failed = places.filter((p) => p.kind === 'failed');
	const waiting = places.filter((p) => p.kind === 'waiting');
	const running = places.filter((p) => p.kind === 'running');
	/* a change that ships as several services names the one the statement is about (when it is one service) */
	const svc = (ps: Place[]) => (c.apps.length > 1 && new Set(ps.map((p) => p.app)).size === 1 ? ` · ${ps[0].app}` : '');
	if (failed.length) return { kind: 'failed', title: `Failing in ${names(failed)}${svc(failed)}`, line: null, short: null, lead: failed[0] };
	if (waiting.length) {
		const held = waiting.every((p) => p.group === 'held');
		const lead = waiting[0];
		const waited = `${lead.build ?? 'The build'} has waited ${ago(lead.at)}`;
		/* CE5: "you can approve" is said ONCE, here; the rows say "Waiting" (CF5: one wait word, the banner's). CF4: "Nothing promotes itself…" is gone. */
		/* changedetail-8 CD4: the age is the row's and History's, said there once */
		void waited;
		/* r11 CH2: the build is the pane's (once in the fold); the banner carries the action */
		/* detail pass 2026-11-08: the one approval word (approvalWord): "Needs your approval" when the viewer can give it, as every list card says; the line is then redundant */
		const line = null;
		/* changedetail-10 CF9: the phone's banner is the title and the ONE button; the build id and "you can approve it" are the action's and the row's */
		return { kind: held ? 'held' : 'waiting', title: `${held ? stateWord('held') : approvalWord(!!c.youApprove)} in ${names(waiting)}${svc(waiting)}`, line, short: null, lead };
	}
	const prod = running.filter((p) => p.tier === 'prod');
	if (prod.length) return { kind: 'landed', title: `Deployed in ${prod.length === 1 ? prod[0].label : `${prod.length} prod regions`}`, line: null, short: null, lead: running[0] };
	return { kind: 'healthy', title: running.length ? `Deployed in ${list([...new Set(running.map((p) => p.label))])}` : 'Not running anywhere yet', line: null, short: null, lead: running[0] ?? null };
}
/**
 * CE11/CE15: the failure banner's ONE sentence: what the failure costs and what the roll-back target is.
 * "eu-west is failing: 7 newer builds (incl. your #44) wait behind this failure; a11c101 is the build before this change, last healthy 9h ago."
 */
export function blockLine(p: Place | null): string | null {
	if (!p?.row || p.kind !== 'failed') return null;
	const h = heldBehind(p.row);
	const lh = lastHealthy(p.row);
	const mine = h.builds.find((b) => b.mine);
	const cost = h.count ? `${p.label} is failing: ${h.count} newer build${h.count === 1 ? '' : 's'}${mine ? ` (incl. your ${mine.pr != null ? `#${mine.pr}` : 'build'})` : ''} wait${h.count === 1 ? 's' : ''} behind this failure` : '';
	const back = lh ? `${lh.build} is the build before this change, last healthy ${ago(lh.at)} ago` : '';
	const out = [cost, back].filter(Boolean).join('; ');
	return out ? `${out}.` : null;
}
/** changedetail-9 CE2: the build that FIRST carried the change in an app (History's oldest deploy): the build the header, the commit row and Commits name; any later build is the NEWER one */
export const firstBuildOf = (c: TChange, scenario: HomeState, app?: string): string | null => {
	const h = historyOfChange(c, scenario);
	return (app ? h.find((x) => x.app === app) : h[0])?.build ?? null;
};
export const rollbackTo = (p: Place | null): string | null => (p?.row ? (lastHealthy(p.row)?.build ?? null) : null);

/* ═══ commits (S6): the commits of the BUILD in focus as the tab reads them (CD5), builds listed separately ═══ */
export type Commit = { sha: string; title: string; author: string | null };
export type Build = { app: string; build: string; places: string[]; /** the same places with their tier (for the env chip) */ chips: { label: string; tier: TierKey; failed?: boolean }[]; /** changedetail-8 CD1: a build that fails in a place where the change already ran healthily on an OLDER build: "Newer build failed in" */ newer?: boolean };
/**
 * The commits card shows the tab's commits of the build the page is about: the WAITING build when the lead waits (its head commit is
 * candidateBuilds' title and author), else the build that FIRST carried the change (History's oldest deploy) read through the tab's own
 * range endpoint. A BUILD is the subject here, so the person is the commit's author ("Release commit for build a11c202 · mark-collins"),
 * never the PR's; the header carries the PR's author. One commit, one author, on every surface of the page.
 */
export function commitsOf(c: TChange, scenario: HomeState, lead: Place | null = null): { commits: Commit[]; builds: Build[]; stat: { add: number; del: number; files: number } | null } {
	let commits: Commit[] = [];
	const hist0 = historyOfChange(c, scenario);
	const first = hist0[0];
	/* changedetail-10 CF1: the commits of the build are the TAB's range where the build still IS the deployed one (staging's "1 commit deployed · +37 −24 · 1 file"), not the range of the first place that ever ran it (dev's range reads two commits) */
	const cr = carrierRange(c, scenario);
	const bc = cr ?? (first ? buildCommitOf(first.href, first.build) : null);
	commits = (bc?.commits.length ? [...bc.commits].reverse() : []).map((k) => ({ sha: k.sha, title: k.title, author: k.author }));
	/* changedetail-9 CE2: the commit is the build that FIRST carried the change (c0d3e88), also while a NEWER build (f4a2c19) waits; only a change no place has run yet reads the waiting build's head */
	if (!commits.length && lead?.kind === 'waiting' && lead.row) {
		const w = candidateBuilds(lead.row).find((h) => h.build === lead.build) ?? buildInQuestionFacts(lead.row);
		if (w) commits = [{ sha: first?.build ?? w.build, title: w.title ?? '', author: w.author }];
	}
	/* an app with no mocked range: the change's own head commit (the PR's) stands */
	if (!commits.length) commits = changeCommits(c, scenario).commits;
	/* CE6: a PR page always shows its commit: the PR's own head (title and author) when no range is mocked */
	if (!commits.length && c.title) commits = [{ sha: '', title: c.title, author: c.author }];
	const by = new Map<string, Build>();
	/* CE6: EVERY build that carries the change, incl. the one a failing place runs (its deploy of the change is in History) */
	const hist = historyOfChange(c, scenario);
	const cl = classified(c, scenario);
	/* changedetail-9 CE1: ONE row per build; a place where that build failed is a chip with failed:true (a02f1c4: dev live, staging failed), never a second row of the same build */
	const add = (p: { app: string; label: string; tier: TierKey }, build: string, failed: boolean) => { const k = `${p.app}|${build}`; const e = by.get(k) ?? { app: p.app, build, places: [], chips: [] }; if (!e.chips.some((x) => x.label === p.label)) { e.places.push(p.label); e.chips.push({ label: p.label, tier: p.tier, failed }); } by.set(k, e); };
	for (const p of cl.all) if ((p.containsChange || (p.state === 'failed' && hist.some((h) => h.href === p.href && h.build === p.current))) && p.current) add(p, p.current, p.state === 'failed');
	/* changedetail-8 CD1: a place that ran the change healthily and then failed a NEWER build: the carrying build is listed (it is the one Places says is live), the failing one is a chip of the newer build */
	for (const p of cl.places) if (p.newerFails && p.carried) add(p, p.carried, false);
	/* changedetail-9 CE2: a build other than the one that first carried the change is the NEWER build (f4a2c19 on #90, a11c202 on #36) */
	for (const b of by.values()) { const fb = firstBuildOf(c, scenario, b.app); if (fb && fb !== b.build) b.newer = true; }
	/* oldest first: the build that first carried the change leads, as History's "First deployed" does */
	const firstAt = (b: Build) => earliest(hist.filter((h) => h.build === b.build && h.app === b.app).map((h) => h.at));
	const builds = [...by.values()].sort((a, b) => oldestFirst(firstAt(a), firstAt(b)));
	return { commits, builds, stat: cr && cr.files ? { add: cr.additions, del: cr.deletions, files: cr.files } : statOf(c, scenario) };
}
/**
 * changedetail-10 CF1: the range the TAB prints for the build that FIRST carried the change, read at the furthest place whose deployed build it still is
 * ("1 commit deployed · +37 −24 · 1 file" on staging for #90). A range is previous build -> this build PER ROLLOUT, so the same build reads one commit in
 * staging and two in dev; the page follows the place the Places row sends you to. null when no place still runs it (the caller falls back to the first deploy's range).
 */
export type CarrierRange = { title: string; author: string | null; additions: number; deletions: number; files: number; commits: { sha: string; title: string; author: string | null }[] };
export function carrierRange(c: TChange, scenario: HomeState): CarrierRange | null {
	const first = historyOfChange(c, scenario)[0];
	if (!first) return null;
	const u = classified(c, scenario).all.filter((x) => x.app === first.app && x.containsChange && x.current === first.build).sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])[0];
	if (!u) return null;
	/* the range the TABS read: history[1] -> history[0] by full revision (as folioFacts; a short build resolves another ladder rung and reads another commit list) */
	const hist = rawOf(u.href)?.status.history ?? [];
	const base = hist[1]?.version.revision, head = hist[0]?.version.revision;
	const p = u.href.split('/').filter(Boolean);
	if (!base || !head || p[0] !== 'rollouts' || !p[3]) return null;
	try {
		const j = rangeJson(p[2], p[3], base, head, p[1]);
		if (!j) return null;
		const all = (j.commits ?? []).map((k) => ({ sha: k.sha.slice(0, 7), title: String(k.message ?? '').split('\n')[0], author: k.author ?? null }));
		/* the tab keeps only the commits that are themselves an available release (CommitSummary's releaseShas): "1 commit deployed", not the range's filler commits */
		const rel = ((availableReleases(rawOf(u.href) as unknown as Rollout) as { tag?: string; version?: string; revision?: string }[] | undefined) ?? []).flatMap((r) => [r.revision, r.tag, r.version]).filter((x): x is string => !!x).map((x) => x.toLowerCase());
		const own = all.filter((k) => rel.some((r) => r.startsWith(k.sha.toLowerCase()) || k.sha.toLowerCase().startsWith(r)));
		const cs = own.length ? own : all;
		const hc = cs[cs.length - 1];
		return hc ? { title: hc.title, author: hc.author, additions: j.additions ?? 0, deletions: j.deletions ?? 0, files: j.changedFiles ?? 0, commits: cs } : null;
	} catch { return null; }
}
/** the PR's diffstat from the PR endpoint when the mock serves one (the deploy's range is NOT the PR's) */
function statOf(c: TChange, scenario: HomeState): { add: number; del: number; files: number } | null {
	void scenario;
	const m = /\/pull\/(\d+)$/.exec(c.prHref ?? '');
	if (!m) return null;
	try {
		const j = pullJson('exampleco', c.repo.split('/').pop()!, m[1]);
		if (!j) return null;
		return j.changedFiles && (j.additions || j.deletions) ? { add: j.additions ?? 0, del: j.deletions ?? 0, files: j.changedFiles } : null;
	} catch { return null; }
}

/** changedetail-12 CD1: the cause the rollout tab prints for a rollback ("Rolled back: duplicate invoice numbers" -> "duplicate invoice numbers") */
const causeOf = (href: string, at: string): string | null => {
	const m = rawOf(href)?.status.history?.find((x) => x.timestamp === at)?.message;
	return m ? m.replace(/^Rolled back:\s*/i, '') : null;
};
/* ═══ History (S7): the PR's life on a spine, oldest first ═══ */
export type EvKind = 'merged' | 'released' | 'deployed' | 'moving' | 'failed' | 'rollback' | 'redeploy' | 'waiting' | 'held';
export type EvPlace = { label: string; tier: TierKey; href: string };
export type Ev = { /** CE4: a rollback's source, as the tab prints it ("Rolled back from a11c303") */ from?: string; /** AD r4 (1): the instant the event sorts by when it differs from `at` (a wait sits after the deploys of its build) */ order?: string; /** AD r5 N2: the app the event belongs to (a change in two apps names it on every row) */ app?: string; key: string; kind: EvKind; build: string | null; /** the first place (kept for text dumps and single-place rows) */ place: string | null; /** every place the event happened in (a waiting build waits in five regions = ONE event, five chips) */ places: EvPlace[]; tier: TierKey | null; at: string | null; who: string | null; words: string; href: string | null; /** changedetail-12 CD1: why the tab says it was rolled back ("duplicate invoice numbers"), the rollback row's muted second-line cause */ cause?: string; /** changedetail-9 CE3: a failure of a NEWER build in a place that already ran this change healthily: not this change's own failed deploy */ newer?: boolean; /** change-strip r2: the event in which the change first finished deploying to a production place (the ONE "reached production" rule) */ reachedProd?: string; /** change-strip r2: the prod wave a deploy event is about (null: the whole tier) */ wave?: number | null };
/**
 * THE RELEASE INSTANT of the build that first carried the change in an app: the `created` of that build's release in the catalogue of any
 * place's rollout (availableReleases + releaseCandidates), the oldest wins. null when no catalogue lists the build (then History says nothing:
 * the data has no release time, it is not invented).
 */
export function releasedAtOf(app: string, hist: { app: string; build: string; href: string }[]): { build: string; at: string } | null {
	const first = hist.find((h) => h.app === app);
	if (!first) return null;
	const ts: string[] = [];
	for (const h of hist.filter((x) => x.app === app)) {
		const raw = rawOf(h.href);
		if (!raw) continue;
		for (const r of [...((availableReleases(raw as unknown as Rollout) as RawC[] | undefined) ?? []), ...((releaseCandidates(raw as unknown as Rollout) as RawC[] | undefined) ?? [])]) {
			if (r.created && shortBuild(r.version ?? r.tag ?? r.revision) === first.build) ts.push(r.created);
		}
	}
	const at = earliest(ts);
	return at ? { build: first.build, at } : null;
}
/**
 * Every deploy of the build(s) that carried the change, per place, oldest first (CD6: a place's LATER deploys of newer builds that still
 * carry it — us-east's a11c303 and a11c404 — are events too), SCENARIO-MASKED (CD3): calm and quiet have no failures and no rollbacks, so
 * a deploy the incident fixture records as failed reads as the successful deploy it is in that scenario, and the rollback is dropped.
 * Waiting events of one build at one moment collapse into one event with every place (CD7).
 */
export function spineOf(c: TChange, scenario: HomeState, places: Place[]): Ev[] {
	const out: Ev[] = [{ key: 'merged', kind: 'merged', build: null, place: null, places: [], tier: null, at: c.mergedAt, who: c.author, words: c.prNumber != null ? 'Merged' : 'Committed', href: c.prHref }];
	const incident = scenario === 'incident';
	const seen = new Set<string>();
	let prodFirst: { at: string; href: string } | null = null;
	const groups = new Map<string, { app: string; tier: TierKey; wave: number | null; items: { href: string; label: string; at: string; moving: boolean; checking: boolean; who: string | null; build: string }[] }>();
	const hist = historyOfChange(c, scenario);
	/* a place that was ever rolled back tells its whole story (every deploy of a build carrying the change, as its tab lists them);
	   every other place tells only how it first got the change, not each routine release that followed */
	const storied = new Set(hist.filter((h) => h.kind === 'rollback').map((h) => h.href));
	/* CE4: the tab prints a rollback as "Rolled back from a11c303" on the row of the build it went back TO; the deploy it undid is that row's `from`, not an event of its own (the page's clock cannot date it the way the tab's served History does) */
	const fromOf = new Map<string, { build: string; at: string }>();
	for (const h of hist) if (h.kind === 'rollback') {
		const rh = rawOf(h.href)?.status.history ?? [];
		const i = rh.findIndex((x) => x.timestamp === h.at);
		const prev = i >= 0 ? rh[i + 1] : undefined;
		if (prev) fromOf.set(`${h.href}|${h.at}`, { build: shortBuild(prev.version.version ?? prev.version.tag ?? prev.version.revision) ?? '', at: prev.timestamp });
	}
	const undone = new Set([...fromOf.entries()].map(([k, v]) => `${k.split('|')[0]}|${v.at}`));
	for (const h of hist) {
		if (undone.has(`${h.href}|${h.at}`)) continue;
		/* CE4: a place's CURRENT deploy is always an event (the History must agree with the place's tab), even while it is still deploying or checking */
		const cur = currentAt(h.href) === h.at;
		const moving = cur && h.outcome !== 'Succeeded' && h.outcome !== 'Failed';
		if (!moving && (h.outcome === 'InProgress' || h.outcome === 'Deploying')) continue;
		if (!incident && h.kind === 'rollback') continue;
		const first = !seen.has(h.href); seen.add(h.href);
		if (!first && h.kind === 'deploy' && h.outcome !== 'Failed' && !storied.has(h.href) && !cur) continue;
		const pl = places.find((p) => p.href === h.href);
		const tier = pl?.tier ?? null;
		const failed = incident && h.outcome === 'Failed';
		const kind: EvKind = failed ? 'failed' : moving ? 'moving' : h.kind === 'rollback' ? 'rollback' : h.kind === 'redeploy' ? 'redeploy' : 'deployed';
		/* change-strip r2 (owner: "history cards is pretty bland"): a deploy is told per TIER, and in a tier that rolls out in waves per WAVE
		   ("Deployed to staging", "Wave 1 deployed · eu-central, us-east-1"), never per site row; the strip keeps the at-a-glance progression */
		if (kind === 'deployed' || kind === 'redeploy' || kind === 'moving') {
			if (kind !== 'moving' && tier === 'prod' && (!prodFirst || oldestFirst(h.at, prodFirst.at) < 0)) prodFirst = { at: h.at, href: h.href };
			if (!tier || (!first && !moving)) continue;
			const wi = waveInfoOfHref(h.href);
			const wave = wi?.multi ? wi.wave : null;
			const gk = `${h.app}|${tier}|${wave ?? 0}`;
			const g = groups.get(gk) ?? { app: h.app, tier, wave, items: [] };
			g.items.push({ href: h.href, label: wi?.site && wi.site !== 'default' ? wi.site : h.place, at: h.at, moving, checking: moving && pl?.row?.state === 'checking', who: h.who, build: h.build });
			groups.set(gk, g);
			continue;
		}
		const newerFail = failed && !!pl?.newerFails;
		const words = newerFail ? 'Newer build failed' : failed ? 'Failed' : kind === 'rollback' ? 'Rolled back to' : 'Deployed';
		/* changedetail-9 CE4: the change's own failure is ONE instant on the page: the place row's (the tab banner's), not the deploy's start */
		const at = failed && !newerFail && pl?.kind === 'failed' && cur && pl.at ? pl.at : h.at;
		out.push({ key: `${h.href}|${h.at}`, kind, app: h.app, build: h.build, place: h.place, places: tier ? [{ label: h.place, tier, href: h.href }] : [], tier, at, who: h.who, words, href: `${h.href}/history`, ...(newerFail ? { newer: true } : {}), ...(kind === 'rollback' && fromOf.get(`${h.href}|${h.at}`) ? { from: fromOf.get(`${h.href}|${h.at}`)!.build } : {}), ...(kind === 'rollback' && causeOf(h.href, h.at) ? { cause: causeOf(h.href, h.at)! } : {}) });
	}
	for (const [gk, g] of groups) {
		const mv = g.items.find((x) => x.moving);
		const done = g.items.filter((x) => !x.moving);
		const where = g.wave != null ? `wave ${g.wave}` : g.tier;
		const evPlaces = g.items.map((x) => ({ label: x.label, tier: g.tier, href: x.href }));
		if (mv) {
			out.push({ key: `moving|${gk}`, kind: 'moving', app: g.app, build: mv.build, place: mv.label, places: evPlaces, tier: g.tier, wave: g.wave, at: mv.at, who: mv.who, words: mv.checking ? 'Checking' : 'Deploying', href: mv.href });
		} else {
			const last = done.reduce((a, b) => (oldestFirst(a.at, b.at) < 0 ? b : a));
			const reached = !!prodFirst && g.tier === 'prod' && done.some((x) => x.href === prodFirst!.href);
			out.push({ key: `deployed|${gk}`, kind: 'deployed', app: g.app, build: last.build, place: last.label, places: evPlaces, tier: g.tier, wave: g.wave, at: last.at, who: done.every((x) => x.who === last.who) ? last.who : null, words: g.wave != null ? `Wave ${g.wave} deployed` : `Deployed to ${where}`, href: last.href, ...(reached && prodFirst ? { reachedProd: prodFirst.at } : {}) });
		}
	}
	/* RELEASED: the build that first carried the change in each app was released (created in the catalogue) after the merge; only when the data has that instant */
	/* apps that shipped the SAME release (a monorepo build: four services, one build, one instant) are ONE event; a lone app is named */
	const rels = new Map<string, { build: string; at: string; apps: string[] }>();
	for (const app of c.apps) {
		const rel = releasedAtOf(app, hist);
		if (!rel || !isNotEarlier(rel.at, c.mergedAt)) continue;
		const k = `${rel.build}|${rel.at}`;
		const g = rels.get(k) ?? { ...rel, apps: [] };
		g.apps.push(app); rels.set(k, g);
	}
	for (const [k, g] of rels) out.push({ key: `released|${k}`, kind: 'released', ...(c.apps.length > 1 && g.apps.length === 1 ? { app: g.apps[0] } : {}), build: g.build, place: null, places: [], tier: null, at: g.at, who: null, words: 'Released', href: null });
	const waits = new Map<string, Ev>();
	for (const p of places.filter((x) => x.kind === 'waiting')) {
		const kind: EvKind = p.group === 'held' ? 'held' : 'waiting';
		const k = `${kind}|${p.app}|${p.build}`;
		const e = waits.get(k);
		/* one event per waiting build; each place carries its own hold clock (waitClock), the event prints the oldest */
		if (e) { e.places.push({ label: p.label, tier: p.tier, href: p.href }); if (p.since && (!e.at || isLater(e.at, p.since))) { e.at = p.since; const ld = latest(hist.filter((h) => h.build === p.build && h.app === p.app && h.kind !== 'rollback').map((h) => h.at)) ?? ''; e.order = isLater(ld, p.since) ? ld : p.since; } continue; }
		/* AD r4 (1): a wait cannot precede the deploys of the build it waits for (the candidate is created at build time, before dev ever ran it): its `at` (the printed age) stays the tab's candidate age, its `order` (where it sits on the spine) is the later of that and the last deploy of the build in an earlier place, so the spine stays causal */
		const lastDeploy = latest(hist.filter((h) => h.build === p.build && h.app === p.app && h.kind !== 'rollback').map((h) => h.at)) ?? '';
		waits.set(k, { key: k, kind, app: p.app, build: p.build, place: p.label, places: [{ label: p.label, tier: p.tier, href: p.href }], tier: p.tier, at: p.since, order: (p.since && isLater(lastDeploy, p.since) ? lastDeploy : p.since) ?? undefined, who: null, words: kind === 'held' ? 'Held' : 'Waiting for approval', href: `${p.href}/gates` });
	}
	/* changedetail-12 CD2: ONE clock. A wait is dated by the instant the tab prints for it (the candidate's age = when the wait began), so the list is sorted by event time, oldest first, ages never rising down the list (the waits used to be appended and broke it) */
	/* cs3: failures and rollbacks name the place in words, never in an env chip */
	for (const e of out) if ((e.kind === 'failed' || e.kind === 'rollback') && e.places[0]) { e.words = `${e.words.replace(/ to$/, '')} in ${envFull(e.places[0].tier, e.places[0].label)}`; e.places = []; }
	/* cs3: a hold says WHERE and WHY in words (no env chip): "Held in staging" + the cause "Waits on payments-svc"; five regions of one tier fold into "in 5 production regions" */
	for (const e of waits.values()) {
		const n = e.places.length, t = e.places[0]?.tier;
		const where = n === 1 ? envFull(e.places[0].tier, e.places[0].label) : t === 'prod' ? `${n} prod regions` : `${n} places`;
		const p0 = places.find((x) => x.href === e.places[0]?.href);
		const cause = e.kind === 'held' && p0?.row ? holdText(p0.row, scenario) : null;
		e.words = `${e.kind === 'held' ? 'Held' : 'Waiting for approval'} in ${where}`;
		if (cause) e.cause = cause;
		e.places = [];
	}
	/* change-strip r2: events at one instant keep the pipeline's order (tier, then wave), never the order the history was read in */
	const rank = (e: Ev) => ({ dev: 0, test: 1, staging: 2, prod: 3 } as Record<string, number>)[e.tier ?? ''] ?? -1;
	return [...out, ...waits.values()].sort((a, b) => oldestFirst(a.order ?? a.at, b.order ?? b.at) || rank(a) - rank(b) || (a.wave ?? 0) - (b.wave ?? 0));
}

/**
 * changedetail-10 CF4: the History fold is ONE contiguous window of the chronological list. The merge (first row), the newest row, every failure and the
 * first live row stay OUTSIDE it, so "Show N more" sits between two visible runs and a visible row never precedes a hidden event that belongs below it.
 * Returns [start, end) of the hidden rows, or null when the list is short enough (or no window fits).
 */
export function foldWindow(events: Pick<Ev, 'kind' | 'words' | 'reachedProd'>[], keep = 10): [number, number] | null {
	const n = events.length;
	if (n <= keep) return null;
	const pinned = new Set<number>([0, n - 1]);
	events.forEach((e, i) => { if (e.kind === 'failed') pinned.add(i); });
	const fl = events.findIndex((e) => !!e.reachedProd);
	if (fl > 0) pinned.add(fl);
	for (let len = n - keep; len >= 2; len--) {
		for (let start = 1; start + len <= n - 1; start++) {
			let ok = true;
			for (let i = start; i < start + len; i++) if (pinned.has(i)) { ok = false; break; }
			if (ok) return [start, start + len];
		}
	}
	return null;
}

/* ═══ How it's going ═══ */
export function howFacts(c: TChange, places: Place[], all: Unit[], events: Ev[] | null = null) {
	const run = places.filter((p) => p.kind === 'running');
	const prod = run.filter((p) => p.tier === 'prod').sort((a, b) => oldestFirst(a.since, b.since))[0];
	/* AD r1 (1): production means production. A change whose only deploy to a prod place FAILED has reached production; the fact says so, with the outcome */
	const prodFailed = !prod ? places.filter((p) => p.tier === 'prod' && p.kind === 'failed' && p.since).sort((a, b) => oldestFirst(a.since, b.since))[0] : null;
	/* r2 gate: ONE rule for "reached production": History's reachedProd event (a finished deploy in prod; an in-flight one has not reached it yet) */
	const prodReached = events?.find((e) => e.reachedProd)?.reachedProd ?? null;
	const first = [...places].filter((p) => p.kind !== 'waiting').sort((a, b) => oldestFirst(a.since, b.since))[0];
	/* the page's ONE age form is `ago` ("2d", "9h", "10m"): a duration is the age of the instant that far before now */
	const gap = (iso: string | null | undefined) => {
		if (!iso || !c.mergedAt) return null;
		const ms = Math.max(0, Date.parse(iso) - Date.parse(c.mergedAt));
		/* one clock read: whole minutes between the two instants (History prints the same instants), days past a day */
		return ms >= 86_400_000 ? `${Math.floor(ms / 86_400_000)}d` : span(Math.round(ms / 60_000) * 60_000);
	};
	return { running: run.length, of: all.length, /* changedetail-8 CD1: the same failures History prints (a place that ran the change and then failed a newer build still failed once) */ failed: events ? events.filter((e) => e.kind === 'failed' && !e.newer).length : places.filter((p) => p.kind === 'failed').length, toFirst: gap(first?.since), toProd: prodReached ? gap(prodReached) : prod && !events ? gap(prod.since) : prodFailed ? `${gap(prodFailed.since)} · failed` : null };
}
export { candidateBuilds, isViewer };

/** the miniature of a place at rest: the app's own step names, all done (a place with no rollout row has finished its last deploy) */
export function restSteps(app: string, scenario: HomeState, href?: string): { name: string; state: 'done' }[] {
	/* the PLACE's own pipeline when the model has it (invoice-api prod: Started · Check), every node done */
	const env = href ? homeModel(scenario).apps.find((x) => x.app === app)?.envs.find((e) => e.href === href) : null;
	if (env?.pipeline) return stepsOf({ state: 'healthy', pipeline: env.pipeline } as never).map((s) => ({ name: s.name, state: 'done' as const }));
	const r = rollouts(scenario).rows.find((x) => x.app === app && x.steps.length);
	const names = (r?.steps ?? []).filter((s) => !s.gate).map((s) => s.name);
	return (names.length ? names : ['Started', 'Check']).map((name) => ({ name, state: 'done' as const }));
}
/** the tab's words for a place that runs the change: "on the newest" / "5 builds behind" (runsIn's word, lagLabel's unit) */
export function behindWords(app: string, href: string, scenario: HomeState): string {
	const w = runsIn(app, scenario).find((r) => r.href === href)?.word ?? '';
	const n = /^(\d+) behind$/.exec(w)?.[1];
	return n ? lagLabel({ builds: Number(n) }) : w === 'on the newest' ? 'on the newest' : w || '';
}

/** CE15: the Gates tab's rollup with its unit, as its OWN line: "Newest build a11c909 runs in 1 of 6 places" (never the build this change is in) */
export function newestLine(app: string, scenario: HomeState): string {
	const t = pathPosition({ app }, scenario);
	const nb = runsIn(app, scenario).find((r) => r.word === 'on the newest')?.build ?? null;
	const some = /^(\d+) of (\d+) places on the newest build$/.exec(t);
	const all = /^All (\d+) places on the newest build$/.exec(t);
	if (all) return nb ? `Newest build ${nb} runs in all ${all[1]} places` : `All ${all[1]} places run the newest build`;
	if (some) return nb ? `Newest build ${nb} runs in ${some[1]} of ${some[2]} places` : `${some[1]} of ${some[2]} places run the newest build`;
	return t;
}

/* ═══ the opened object (CD1/CD9): the CHANGE's own build in the place, as the tab's Deployment-pipeline card reads it ═══ */
export type Opened = {
	state: 'failed' | 'waiting' | 'moving' | 'rest';
	/** the pane's state title: "Deployment failed", "Waiting for approval", "Live in us-west" */
	title: string;
	/** how long, in the page's one age form; for a waiting build it is the time the build has WAITED (buildInQuestionFacts's candidate), never the deployed build's age */
	since: string;
	/** a failed deploy's timer, finished: "Check failed after 1m" (never PENDING) */
	took: string | null;
	/** the change's build in this place: the failed build, the waiting build, or the build the place runs */
	build: string | null;
	/** "last healthy a11c101 · 9h" | "ap-south runs 9b7e410 · 20h"; null when there is nothing to compare */
	relation: { word: string; build: string; age: string | null } | null;
	/** the build's commit as the tab prints it (title + author): a BUILD is the subject, so the person is the commit's author */
	commit: { title: string; author: string | null } | null;
	steps: Step[];
	selected: string | null;
	/** the Gates tab's rollup, its own line: "Newest build a11c909 runs in 1 of 6 places" */
	facts: string;
	/** CE2: a waiting build's gate as a RULE line, never a pipeline step: "Waiting for approval" + the Gates tab it links to */
	rule: { text: string; href: string } | null;
	/** CE2: the newest build that waits behind this change's (the tab's "Newer builds" row), a labelled fact "f4a2c19 · 19m" */
	newerBuild: { build: string; age: string } | null;
	/** changedetail-8 CD3: a failed deploy's cost, as dl facts: how many newer builds wait behind it, and whether yours is one of them */
	newer: { count: number; mine: string | null } | null;
};
export function openedOf(p: Place, scenario: HomeState, landed = false): Opened {
	void landed;
	const row = p.row;
	const facts = newestLine(p.app, scenario);
	let steps: Step[] = (row?.steps as Step[] | undefined) ?? (restSteps(p.app, scenario, p.href) as Step[]);
	/* a WAITING build has not started (CG5): the pane draws ITS pipeline, the gate first, never the deployed build's done steps */
	/* CE2: the tab's steps (Started, Check), none started; the approval is the rule line, not a node (RULES: step names are the tab's) */
	if (p.kind === 'waiting') steps = steps.filter((s) => !s.gate && s.name !== 'Approval').map((s) => ({ name: s.name, state: 'todo' as const }));
	const pick = (xs: Step[]) => (xs.find((s) => s.state === 'fail') ?? xs.find((s) => s.state === 'active' || s.state === 'hold') ?? xs[xs.length - 1])?.name ?? null;
	if (row && p.kind === 'failed') {
		const lh = lastHealthy(row);
		const bc = buildCommitOf(p.href, p.current);
		/* r11 CH2: the pane's heading is the tab's own name for the step that failed ("Final check") and its age; the banner above states the failure once */
		const failName = steps.find((s) => s.state === 'fail')?.name;
		return { state: 'failed', title: !failName || failName === 'Check' ? 'Final check' : failName, since: ago(row.since), took: null, build: p.current ?? buildTitle(row), relation: lh ? { word: 'last healthy', build: lh.build, age: ago(lh.at) } : null, commit: bc ? { title: bc.title, author: bc.author } : null, steps, selected: pick(steps), facts, rule: null, newerBuild: null, newer: (() => { const h = heldBehind(row); return h.count ? { count: h.count, mine: h.builds.find((b) => b.mine)?.pr != null ? `#${h.builds.find((b) => b.mine)!.pr}` : h.includesViewer ? 'yours' : null } : null; })() };
	}
	if (row && p.kind === 'waiting') {
		const hb = candidateBuilds(row).find((h) => h.build === p.build);
		const w = hb ? { build: hb.build, title: hb.title, author: hb.author, at: hb.created } : (() => { const x = buildInQuestionFacts(row); return x ? { build: x.build, title: x.title, author: x.author, at: x.since } : null; })();
		const dep = deployedBuild(row);
		return { state: 'waiting', title: row.group === 'approval' ? stateWord('approval')! : row.word, since: ago(waitClock(row, scenario, p.build) ?? p.since ?? w?.at), took: null, build: w?.build ?? p.build, relation: dep.build ? { word: `${p.label} runs`, build: dep.build, age: ago(dep.at) } : null, commit: w ? { title: w.title ?? '', author: w.author } : null, steps, selected: pick(steps), facts, rule: { text: row.group === 'approval' ? 'Waiting for approval' : (holdText(row, scenario) ?? 'Held by a rule'), href: `${p.href}/gates` }, newerBuild: (() => { const n = candidateBuilds(row).filter((h) => h.build !== (w?.build ?? p.build) && (w?.at ? isLater(h.created, w.at) : !!h.created)).sort((a, b) => newestFirst(a.created, b.created))[0]; return n ? { build: n.build, age: ago(n.created) } : null; })(), newer: null };
	}
	const bc = buildCommitOf(p.href, p.current);
	const moving = !!row && (row.state === 'deploying' || row.state === 'checking');
	return {
		state: moving ? 'moving' : 'rest',
		title: moving && row ? (row.state === 'checking' ? `Checking in ${p.label}` : `Deploying to ${p.label}`) : `Deployed in ${p.label}`,
		since: ago(p.at ?? p.since), took: null, build: p.current, relation: null,
		commit: bc ? { title: bc.title, author: bc.author } : null, steps, selected: pick(steps), facts, rule: null, newerBuild: null, newer: null
	};
}
/** "1m": how long the failed deploy ran before its check failed (the History tab's "Failed after 1m") */
const deployTimesOf = (href: string): string | null => {
	const h = rawOf(href)?.status.history?.[0];
	const took = h?.bakeEndTime && h.timestamp ? Date.parse(h.bakeEndTime) - Date.parse(h.timestamp) : NaN;
	return isNaN(took) ? null : span(took);
};

/**
 * v2 r5 CF8: the header's facts = the /changes lead row's: the build the change is in (the 20 mono) and the diffstat when the range carries one.
 * The PR endpoint of the mock serves `changedFiles` only (no additions / deletions), so the full "+39 −24 · 3 files" is the lead place's deploy range
 * (the same range the tab and the /changes row read, via `folioFacts`); with no range the PR's own file count stands alone ("3 files").
 */
export function headFacts(c: TChange, lead: Place | null, scenario: HomeState = 'incident'): { build: string | null; stat: { add: number | null; del: number | null; files: number } | null } {
	if (!lead) return { build: null, stat: null };
	const state = lead.kind === 'failed' ? 'failed' : lead.kind === 'waiting' ? (lead.group === 'held' ? 'held' : 'approval') : lead.row?.state === 'checking' ? 'checking' : lead.row?.state === 'deploying' ? 'deploying' : 'landed';
	const f = folioFacts({ state, row: lead.row, href: lead.href } as never);
	const files = (() => { const m = /\/pull\/(\d+)$/.exec(c.prHref ?? ''); if (!m) return null; try { const j = pullJson('exampleco', c.repo.split('/').pop()!, m[1]); return j?.changedFiles ?? null; } catch { return null; } })();
	const cr = carrierRange(c, scenario);
	return { build: firstBuildOf(c, scenario, lead.app) ?? (lead.kind === 'waiting' ? lead.build : lead.current) ?? f.build, stat: f.stat ?? (cr?.files ? { add: cr.additions, del: cr.deletions, files: cr.files } : files ? { add: null, del: null, files } : null) };
}

/**
 * r34 r2: the FULL place name an env badge splits ("prod-eu-west" -> [PROD | eu-west]). A change's place label is the region alone
 * ("eu-west"), which `splitEnvName` would split at its first hyphen into [EU | west]; the badge needs the tier prefix.
 * A label that already is the tier ("dev") or starts with it passes through unchanged.
 */
export function envFull(tier: string, label: string): string {
	const l = (label ?? '').trim();
	if (!l || l === tier || l.startsWith(`${tier}-`)) return l || tier;
	return `${tier}-${l}`;
}

/* ═══ r4 (BUILD-R4, premium-changes mock): "Where it runs", the place rows GROUPED BY BUILD ═══ */
/**
 * ONE group per build that a place runs (or waits for), each saying what the build is TO THIS CHANGE: its own build (the first that carried it),
 * a later build that carries it "+N newer changes" (N = the app's changes merged after this one and in that build), the newest one, or a build
 * that does not carry it (the not-affected places). Replaces the Commits card's "Builds" band (which said neither what a build was to the change
 * nor that Places already listed the same places). The places inside keep the Places row anatomy; the lead (first row) stays the open one.
 * Order: own build first, then by the first time the build carried the change (oldest first, as History reads), builds that do not carry it last.
 */
export type BuildGroup = { key: string; app: string; build: string; own: boolean; carries: boolean; newest: boolean; /** changes of the app merged after this one that the build carries; null when the build's change is unknown */ newer: number | null; rows: { p: Place; also: Place[] }[] };
export function buildGroups(c: TChange, scenario: HomeState, rows: { p: Place; also: Place[] }[], unaffected: Place[] = []): BuildGroup[] {
	const hist = historyOfChange(c, scenario);
	const by = new Map<string, BuildGroup>();
	const items = changes(scenario, { rolledBackLands: true }).items;
	const add = (r: { p: Place; also: Place[] }, carries: boolean) => {
		const p = r.p;
		const build = (p.kind === 'waiting' ? p.build : p.current) ?? p.build ?? '';
		const k = `${p.app}|${build}`;
		let g = by.get(k);
		if (!g) {
			const own = firstBuildOf(c, scenario, p.app) === build;
			const kc = carries ? changeBySha(c.repo, build) : null;
			const newer = carries && !own ? (kc ? items.filter((i) => i.apps.includes(p.app) && i.changeHref !== c.changeHref && isLater(i.mergedAt, c.mergedAt) && isNotEarlier(kc.mergedAt, i.mergedAt)).length : null) : 0;
			const newest = runsIn(p.app, scenario).some((x) => x.word === 'on the newest' && x.build === build);
			g = { key: k, app: p.app, build, own, carries, newest, newer, rows: [] };
			by.set(k, g);
		}
		g.rows.push(r);
	};
	for (const r of rows) add(r, true);
	for (const u of unaffected) add({ p: u, also: [] }, false);
	const firstAt = (g: BuildGroup) => earliest(hist.filter((h) => h.build === g.build && h.app === g.app).map((h) => h.at)) ?? g.rows[0]?.p.at ?? null;
	/* AD r2 (7): an app's builds stay together (the change's app order), then the own build, then by first carry; builds that do not carry it last within the app */
	const appRank = (g: BuildGroup) => { const i = c.apps.indexOf(g.app); return i < 0 ? c.apps.length : i; };
	return [...by.values()].sort((a, b) => appRank(a) - appRank(b) || Number(b.carries) - Number(a.carries) || Number(b.own) - Number(a.own) || oldestFirst(firstAt(a), firstAt(b)));
}
