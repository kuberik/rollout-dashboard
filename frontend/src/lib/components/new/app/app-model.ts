/**
 * r34 v2 r2 AD — the view-model of /apps/<name>: every sentence the page prints about holds, builds and deploys, from
 * data.ts (placeHolds, gatesOf, rowsOf) and nothing else, so the header, the Places rows, the Builds card and the Holding
 * card cannot disagree. Pure functions; app-model.test.ts pins them on the three demo apps.
 *
 * Gap named for the truth lane: data.ts has no "which build would the chain send to this place" and no per-build gate
 * allowance (allowedVersions stays inside rawOf). `deployTargets` derives it: the newest build a place still lacks that
 * runs HEALTHY in the tier upstream of it, for a place no approval or rule holds.
 */
import { newestFirst } from '$lib/instant';
import { startOfDayMs } from '$lib/display-time';
import { approvalWord, severity } from '../state-words';
import {
	tabPill,
	deployedHistory,
	bakeFailedOn,
	streamBuilds,
	newestBuild,
	noReleasesAt,
	deployedBuild,
	waitClock,
	type HomeState,
	ago,
	builtAgo,
	buildIdentity,
	type PlaceHold,
	type GateInfo,
	type TRow,
	type TierKey
} from '../data';
import { lastFailureMs } from '$lib/view-models/event-age';
import { catalogueOrder } from '$lib/releases/order';
import { rolloutStateChip } from '$lib/view-models/rollout-state-chip';
import { newerBuildsAre } from '$lib/view-models/blocking-story';
import { waitFact } from '$lib/view-models/wait-fact';
import { causeText, joinCause, labelPart, type Cause, type GateLabel } from '$lib/view-models/gate-label';
import { TIERS as TIER_LIST } from '$lib/view-models/sites-waves';

const ORDER: TierKey[] = [...TIER_LIST];
export const tierRank = (t: string) => ORDER.indexOf(t as TierKey);
/* a promotion place hold: the backend's kind, carried as the gate's label (data.ts gateName sets it); never a guess from the gate's name */
export const isPromotion = (p: PlaceHold) => p.gate?.label.kind === 'promotion';

/** the tier upstream of `tier` among the app's own places (dev has none) */
export function upstreamTier(places: PlaceHold[], tier: string): TierKey | null {
	const present = ORDER.filter((t) => places.some((p) => p.tier === t));
	const i = present.indexOf(tier as TierKey);
	return i > 0 ? present[i - 1] : null;
}

/** a place's hold, as the one word the header and the Builds card print: "approval", "health checks", the gate's own name; null when nothing holds it or only sequencing does */
export function holdWord(p: PlaceHold): string | null {
	if (p.holdReason === 'approval') return 'approval';
	if (p.holdReason === 'failed' || p.holdReason === 'health') return 'health checks';
	if (p.holdReason === 'rule' && !isPromotion(p)) return p.gate?.name ?? 'a rule';
	return null;
}

export type HoldGroup = { word: string; places: string[]; tiers: string[] };
/** "5 prod regions" when three or more places are all production regions, else the names ("us-east, us-west"); the header's and the Builds strip's one phrase for a set of places */
export const placesPhrase = (names: string[], tiers: string[]): string =>
	names.length >= 3 && tiers.every((t) => t === 'prod')
		? `${names.length} prod regions`
		: names.join(', ');
/** the holds of an app per place, one group per reason in severity order: [{approval, [us-east, us-west]}, {health checks, [eu-west]}] */
export function holdGroups(places: PlaceHold[]): HoldGroup[] {
	const out = new Map<string, HoldGroup>();
	for (const p of places) {
		const w = holdWord(p);
		if (!w || !p.heldBuilds.length) continue;
		const g = out.get(w) ?? { word: w, places: [], tiers: [] };
		g.places.push(p.place);
		g.tiers.push(p.tier);
		out.set(w, g);
	}
	const rank = (w: string) => (w === 'health checks' ? 0 : w === 'approval' ? 1 : 2);
	return [...out.values()].sort((a, b) => rank(a.word) - rank(b.word));
}
/** the hold reason per place group, said once (the header's meta): "waiting for approval in 5 prod regions" (the tab's words), "held by health checks in eu-west" */
export const holdSentences = (places: PlaceHold[]): string[] =>
	holdGroups(places).map(
		(g) =>
			`${g.word === 'approval' ? 'waiting for approval' : `held by ${g.word}`} in ${placesPhrase(g.places, g.tiers)}`
	);
/** how many of the app's newer builds some gate or failing check holds somewhere (the Builds strip's "N held") */
export const heldCount = (places: PlaceHold[]): number => {
	const s = new Set<string>();
	for (const p of places) if (holdWord(p)) for (const h of p.heldBuilds) s.add(h.build);
	return s.size;
};

/** the build the chain would send to each place: at most ONE per place; none for a place a gate holds or one still deploying */
export function deployTargets(places: PlaceHold[]): Map<string, PlaceHold[]> {
	const out = new Map<string, PlaceHold[]>();
	for (const p of places) {
		if (p.holdReason === 'approval' || p.holdReason === 'rule') continue;
		if (p.state === 'deploying' || p.state === 'checking') continue;
		const up = upstreamTier(places, p.tier);
		if (!up || !p.heldBuilds.length) continue;
		const ready = new Set(
			places
				.filter((x) => x.tier === up && x.state === 'healthy' && x.deployedBuild)
				.map((x) => x.deployedBuild as string)
		);
		const pick = p.heldBuilds.find((h) => ready.has(h.build));
		if (!pick) continue;
		out.set(pick.build, [...(out.get(pick.build) ?? []), p]);
	}
	return out;
}

export type AppBuild = {
	build: string;
	title: string | null;
	author: string | null;
	created: string | null;
	runsIn: string[];
	runsTiers: string[];
	moving: boolean;
	deployTo: PlaceHold[];
};
/** the builds newer than something: the union over the app's places, newest first, each with where it already runs and where the chain would deploy it */
export function buildsOf(places: PlaceHold[], only: Set<string> | null = null): AppBuild[] {
	const m = new Map<string, AppBuild>();
	const targets = deployTargets(places);
	for (const p of places)
		for (const h of p.heldBuilds) {
			if (m.has(h.build) || (only && !only.has(h.build))) continue;
			const at = places.filter((x) => x.deployedBuild === h.build);
			m.set(h.build, {
				...h,
				runsIn: at.map((x) => x.place),
				runsTiers: at.map((x) => x.tier),
				moving: at.length > 0 && at.every((x) => x.state === 'deploying' || x.state === 'checking'),
				deployTo: targets.get(h.build) ?? []
			});
		}
	return [...m.values()].sort((a, b) => newestFirst(a.created, b.created));
}
/** "live in us-east, us-west" / "deploying in dev" — where a build already is */
export const whereIs = (b: Pick<AppBuild, 'runsIn' | 'moving'>): string | null =>
	b.runsIn.length ? `${b.moving ? 'deploying' : 'running'} in ${b.runsIn.join(', ')}` : null;

/** the Places row's second line: the next build to arrive at a place and what, if anything, holds it. A place with nothing newer (or one that is itself failing / moving, where the pill and the pane already say so) prints nothing.
 *  AP13: an approval is said ONCE per page (the statement and the Holding card), so an approval-held row says only "next f4a2c19"; a health hold uses the tab's own sentence ("7 newer builds · held: waiting for health checks"). */
export function nextOf(places: PlaceHold[], href: string): string | null {
	const p = places.find((x) => x.href === href);
	if (!p) return null;
	const nxt = p.heldBuilds[0];
	if (!nxt) return null;
	const n = p.heldBuilds.length;
	const up = upstreamTier(places, p.tier);
	if (p.holdReason === 'failed' || p.holdReason === 'health')
		return `${n} build${n === 1 ? '' : 's'} behind`; /* r5 AQ5: one phrasing, the failing check is the row's cause and the Holding card's */
	if (p.holdReason === 'approval') return `next ${nxt.build}`;
	if (p.holdReason === 'rule' && isPromotion(p) && up) {
		/* QA #23: a build the upstream tier has already moved PAST will never arrive there: say it was skipped instead of "after staging" */
		const stream = streamBuilds(p.href);
		const at = (b: string | null) => (b ? stream.indexOf(b) : -1);
		const passed = places
			.filter((x) => x.tier === up && at(x.deployedBuild) > at(nxt.build) && at(nxt.build) >= 0)
			.map((x) => x.deployedBuild)[0];
		if (passed) return `${nxt.build} was skipped · ${up} runs ${passed}`;
	}
	if (p.holdReason === 'rule')
		return isPromotion(p)
			? `next ${nxt.build} · ${up ? `after ${up}` : 'in sequence'}`
			: `next ${nxt.build} · held: waiting on ${p.gate?.name ?? 'a rule'}`;
	if (p.state === 'deploying' || p.state === 'checking') return null;
	return `next ${nxt.build} · ready to deploy`;
}

/** the builds an app's page counts as "newer": those the FOCUS place (what production runs) still lacks, so the header, the Builds card and the Holding card count the same builds (the tab's "N newer builds") */
export const newerThan = (focus: PlaceHold | null, places: PlaceHold[]): Set<string> | null =>
	focus ? new Set(focus.heldBuilds.map((h) => h.build)) : null;

/** the places that RUN `build` in the state the pill names: "FAILED in production" lists only failing places, "DEPLOYED in 4 prod regions" only the settled ones */
export function placesInPillState(places: PlaceHold[], build: string, pill: string): PlaceHold[] {
	const on = places.filter((p) => p.deployedBuild === build);
	const word = pill.toUpperCase();
	const want = (p: PlaceHold) =>
		word === 'FAILED'
			? p.state === 'failed'
			: word === 'CHECKING'
				? p.state === 'checking'
				: word === 'DEPLOYING'
					? p.state === 'deploying'
					: p.state !== 'failed' && p.state !== 'checking' && p.state !== 'deploying';
	return on.filter(want);
}

/** the builds some gate or failing check holds somewhere (Builds' held mark) */
export const heldBuilds = (builds: AppBuild[], places: PlaceHold[]): Set<string> =>
	new Set(
		builds
			.filter(
				(b) =>
					!b.moving &&
					places.some((p) => holdWord(p) && p.heldBuilds.some((h) => h.build === b.build))
			)
			.map((b) => b.build)
	);

/** the Builds card's rollup: "6 held · 1 deploying" (the header's, owner §7), else "N newer" when nothing is classified, "on the newest" when there are none */
export function buildRollup(builds: AppBuild[], places: PlaceHold[]): string {
	if (!builds.length) return 'On the newest build';
	const moving = builds.filter((b) => b.moving).length;
	const held = heldBuilds(builds, places).size;
	const parts = [held ? `${held} held` : '', moving ? `${moving} deploying` : ''].filter(Boolean);
	return parts.length ? parts.join(' · ') : `${builds.length} newer`;
}

export type HoldRow = {
	key: string;
	/** a promotion hold's typed label: the card draws `Held by » [SOURCE]` (GateLabel), `name` is only its plain-text form */
	label?: GateLabel;
	kind: 'approval' | 'pin' | 'rule' | 'health' | 'dependency' | 'check' | 'schedule' | 'other';
	name: string;
	holding: boolean;
	places: string[];
	held: string[];
	sentence: string;
	href: string;
	/** the held-HERE count is still unknown: the card shows a pending bar, never a guessed number */ pending?: boolean;
};
/** the gate's name without the app it sits in (the page already says the app): "Invoice api manual approval" -> "Manual approval" */
export const shortGate = (name: string, app: string): string => {
	const a = app.replace(/[-_.]+/g, ' ').toLowerCase();
	const n = name.toLowerCase().startsWith(a + ' ') ? name.slice(a.length + 1) : name;
	return n.charAt(0).toUpperCase() + n.slice(1);
};
/** the Holding card of an app: each of ITS gates (approvals included) once, then the health hold; holding ones first. Links open the first guarded place's Gates tab. */
export function holdRows(
	gates: GateInfo[],
	places: PlaceHold[],
	only: Set<string> | null = null,
	app = '',
	pins: ReadonlySet<string> = new Set(),
	pinVersion: string | null = null
): HoldRow[] {
	const hrefOf = (label: string) => `${places.find((p) => p.place === label)?.href ?? ''}/gates`;
	const rows: HoldRow[] = gates.map((g) => ({
		key: `gate:${g.id}`,
		kind: g.kind === 'promotion' ? 'other' : g.kind,
		name: g.label ? causeText(['Held by ', labelPart(g.label)]) : shortGate(g.name, app),
		...(g.label ? { label: g.label } : {}),
		holding: g.holding,
		pending: g.heldPending,
		places: g.holding ? g.holdsAt : g.places,
		held: only ? g.held.filter((b) => only.has(b)) : g.held,
		sentence: g.sentence,
		href: hrefOf(g.places[0])
	}));
	const hp = places.filter((p) => p.holdReason === 'failed' || p.holdReason === 'health');
	if (hp.length) {
		const held: string[] = [];
		for (const p of hp)
			for (const h of p.heldBuilds)
				if (!held.includes(h.build) && (!only || only.has(h.build))) held.push(h.build);
		rows.push({
			key: 'health',
			kind: 'health',
			name: 'Health checks',
			holding: true,
			places: hp.map((p) => p.place),
			held,
			sentence: 'Releases when the check starts passing',
			href: `${hp[0].href}/gates`
		});
	}
	/* a place the model says is held by a rule while no gate object lists it (the dependency is a RolloutDependency join, not a gate): its own cause is a row, the same words the banner prints */
	for (const p of places.filter((x) => x.state === 'held-by-rule' && x.holdReason === 'rule' && x.gate && !isPromotion(x) && !rows.some((r) => r.holding && r.places.includes(x.place)))) {
		const held = p.heldBuilds.map((h) => h.build).filter((b) => !only || only.has(b));
		const k = `place:${p.gate!.name}`;
		const e = rows.find((r) => r.key === k);
		if (e) { e.places.push(p.place); for (const b of held) if (!e.held.includes(b)) e.held.push(b); continue; }
		rows.push({ key: k, kind: 'rule', name: p.gate!.name, holding: true, places: [p.place], held, sentence: p.gate!.sentence, href: `${p.href}/gates` });
	}
	/* a pin is a hold like any gate: the place rows say "Held by the pin" (`placeWord`), so this card must list it, or the page says "Nothing held" beside a held place */
	const pinned = places.filter((p) => pins.has(p.place));
	if (pinned.length) {
		/* a pin is per place: the builds it holds are those the place's own Overview and Gates tab count (`newerBuildsShown`), not the app baseline's `only` */
		const held: string[] = [];
		for (const p of pinned) for (const b of p.newerShown) if (!held.includes(b)) held.push(b);
		rows.push({ key: 'pin', kind: 'pin', name: pinVersion ? `Pinned to ${pinVersion}` : 'Pinned', holding: true, places: pinned.map((p) => p.place), held, sentence: 'Releases when the pin is cleared', href: `${pinned[0].href}` });
	}
	return rows.sort((a, b) => Number(b.holding) - Number(a.holding));
}

/** the place order of the rows: urgency first, then the promotion order (dev → prod), then the name */
export const placeOrder = (
	a: { tier: string; label: string; rank: number },
	b: { tier: string; label: string; rank: number }
): number =>
	a.rank - b.rank || tierRank(a.tier) - tierRank(b.tier) || a.label.localeCompare(b.label);

export type RegionCell = {
	label: string;
	place: string;
	href: string;
	state: PlaceHold['state'];
	build: string | null;
	word: string;
	action: TRow['action'];
};

/**
 * apps-11 AS2 (truth) — ?calm / ?quiet mask the places (data.ts calm/quiet models) while the tab's pill is read from the served incident
 * fixture: a FAILED pill beside cells the scenario shows Live is two sources. Outside the incident, a FAILED tab word over a place the
 * masked model does not call failed says what the masked place says (the tab's own word for a settled build: DEPLOYED).
 */
export function scenarioPill<T extends { word: string; role: string }>(
	pill: T,
	scenario: string,
	placeState: string | null | undefined,
	settled: { word: string; role: string }
): { word: string; role: string } {
	if (scenario !== 'incident' && pill.word === 'FAILED' && placeState !== 'failed') return settled;
	return { word: pill.word, role: pill.role };
}

/**
 * apps-12 AT1 — THE ONE PILL RULE (tile and app page, every lens). The pill beside "name / build" is the tab's own word for the
 * app's HEADLINE place: its production place that most needs reading (failed, waiting, held, deploying, checking, then the rest,
 * name order), else — an app with no production place — its most urgent place. A dev/test place moving does not change the
 * headline (the strip and the NEXT/CHECKING line say it). One function so the two surfaces cannot disagree; the scenario lens
 * only maps a fixture FAILED word the masked model does not call failed (scenarioPill). A DEPLOYED word on an app with a Held cell
 * (approval or rule) is drawn neutral: green is not spent on an app that holds a build.
 */
const POSE: Record<string, number> = {
	failed: 0,
	'awaiting-approval': 1,
	'held-by-rule': 2,
	deploying: 3,
	checking: 4
};
const poseOf = (s: string) => POSE[s] ?? 9;
export function headlinePlace<T extends { tier: string; state: string; label: string }>(
	places: T[]
): T | null {
	const rank = (p: T) => poseOf(p.state);
	const pick = (xs: T[]) =>
		[...xs].sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))[0] ?? null;
	return pick(places.filter((p) => p.tier === 'prod')) ?? pick(places);
}
export function pillOf<T extends { tier: string; state: string; label: string; href: string }>(
	places: T[],
	scenario: string
): { word: string; role: string; place: T } | null {
	const place = headlinePlace(places);
	if (!place) return null;
	const t = tabPill({ href: place.href });
	const c = rolloutStateChip('Succeeded');
	const p = scenarioPill(t, scenario, place.state, { word: c.label.toUpperCase(), role: c.role });
	return { word: p.word, role: p.role, place }; // apps-13 AL4: the tab's own colour for the word (no invented neutral DEPLOYED)
}

/**
 * apps-12 AT7 — the Builds card's rows when nothing is newer: the app's last distinct deployed builds across its places, newest first, each with
 * where it runs now (a settled place) — so a calm app's main column carries rows like the rail beside it. No Deploy (nothing to send).
 */
export function recentBuilds(places: PlaceHold[], limit = 8): AppBuild[] {
	const m = new Map<string, AppBuild>();
	for (const p of places)
		for (const h of deployedHistory(p.href, limit)) {
			if (m.has(h.build)) continue;
			const at = places.filter((x) => x.deployedBuild === h.build);
			m.set(h.build, {
				build: h.build,
				title: h.title,
				author: h.author,
				created: h.at,
				runsIn: at.map((x) => x.place),
				runsTiers: at.map((x) => x.tier),
				moving: false,
				deployTo: []
			});
		}
	return [...m.values()]
		.sort((a, b) => newestFirst(a.created, b.created))
		.slice(0, limit);
}

/**
 * apps-13 AL3 — CURRENCY of a place against the APP's OWN newest build, as that place's rollout tab says it (its "N newer builds" /
 * Newer builds list: data.ts newestBuild). `behind` = builds newer than the one it runs; the word is "Up to date" or "N builds behind".
 * Never a cross-app version. Health is a different fact (the state word); the two are never merged into one word.
 */
/** a place's "N behind": the catalogue distance (releases/order.ts catalogueBehind, through newestBuild), 0 when it runs the newest or has no releases. The strip, the ledger, the tiles and the Builds card all read this. */
export function behindOfPlace(href: string, app = ''): number {
	if (noReleasesAt(href)) return 0;
	return newestBuild({ app, href, state: 'healthy', word: '' } as never)?.count ?? 0;
}
export function currencyOf(href: string, app = ''): { behind: number; word: string } {
	/* no release = not affected: a place without releases has no currency to print (its own word is "No releases yet") */
	if (noReleasesAt(href)) return { behind: 0, word: '' };
	const behind = behindOfPlace(href, app);
	return {
		behind,
		word: behind ? `${behind} build${behind === 1 ? '' : 's'} behind` : 'Up to date'
	};
}

/**
 * The currency word an app tile's rest line carries. Places without releases have no currency (no release = not affected) and
 * are ignored: when every place that HAS releases runs the newest build the app is "Up to date", whatever the headline place is.
 * Otherwise the headline place speaks (currencyOf).
 */
export function restCurrency(
	places: { href: string; currency?: string }[],
	headHref: string | null,
	app = ''
): string {
	const rel = places.filter((p) => p.currency !== 'none');
	if (!rel.length) return '';
	if (rel.every((p) => p.currency === 'newest')) return 'Up to date';
	return headHref ? currencyOf(headHref, app).word : '';
}

/**
 * r34 builds-lag (B) — THE SOUNDING LEDGER's model. One app, one build sequence (newest first), every place exactly once, standing on the
 * build it runs. The sequence is the release catalogue's ONE order (releases/order.ts: every place's own catalogue joined, because spokes trim
 * on their own schedule and a position inside one list means nothing in another). The stop at index 0 is "Newest" even when it failed (its row
 * says so), and LAG = the build's distance from it: c1 is 2 behind c3 whatever happened to c2. The tab's own list (`tabLag`: what a place is
 * OFFERED, minus builds that failed upstream or are gated) can be shorter; the row says so (`placeNote`), the stop never relabels. A place on a
 * build that is not in the order is a "Custom build": labelled, never counted. Only an app with no catalogue at all (a mock, a list that has not
 * loaded) falls back to the places' own newer-build lists: the longest is the spine.
 */
export type Stop = {
	key: string;
	build: string;
	title: string | null;
	author: string | null;
	created: string | null;
	age: string;
	/** the build's own age, labelled ("built 11mo ago"): what the Builds card prints, so a bare "11mo" never reads as the place's or a wait's clock */
	ageLabel: string;
	pr: number | null;
	/** index in the sequence = builds behind the newest; null for a custom build */ index:
		| number
		| null;
	custom: boolean;
	places: PlaceHold[];
	deployTo: PlaceHold[];
};
export const lagWord = (n: number): string =>
	n === 0 ? 'Up to date' : `${n} build${n === 1 ? '' : 's'} behind`;
/**
 * (No longer the ledger's order, see byTopology.) Where a place sits among the places of ONE stop: THE ONE SEVERITY ORDER (state-words `severity`: failing, waiting for approval, held,
 * deploying, checking, rolled back, healthy), so the place that needs reading is the first row under its build, never the last of five
 * regions alphabetised. A healthy place a promotion gate holds a newer build from (it waits on its wave) ranks with the held places, not at rest.
 * Array.sort is stable: places of one rank keep the order they came in.
 */
export const placeRank = (p: PlaceHold): number =>
	p.state === 'healthy' && p.holdReason === 'rule' && p.heldBuilds.length
		? severity('held-by-rule')
		: severity(p.state);
/**
 * The order of the places under one build is the TOPOLOGY's, never the state's (owner 2026-11-12, "environments jumping"): tier (dev → prod), then
 * wave, leader first, then site name. A place that fails, deploys or finishes keeps its row; only its word and mark change.
 */
export const byTopology = (places: PlaceHold[]): PlaceHold[] =>
	[...places].sort(
		(a, b) =>
			tierRank(a.tier) - tierRank(b.tier) ||
			(a.wave?.wave ?? 0) - (b.wave?.wave ?? 0) ||
			Number(!!b.wave?.leader) - Number(!!a.wave?.leader) ||
			a.label.localeCompare(b.label)
	);
/** the state-severity order, kept for callers that want the place needing a read first (the ledger no longer uses it) */
export const bySeverity = (places: PlaceHold[]): PlaceHold[] =>
	[...places].sort((a, b) => placeRank(a) - placeRank(b));
export function ledgerOf(places: PlaceHold[]): Stop[] {
	if (!places.length) return [];
	/* the sequence is the release catalogue's order (releases/order.ts), newest first, from its newest build down to the oldest build a place runs:
	   Newest is the catalogue's newest even when it failed, and a build's index is its distance from it. Places without releases are not counted. */
	const order = catalogueOrder(places.filter((p) => !noReleasesAt(p.href)).map((p) => streamBuilds(p.href)));
	const lowest = Math.min(...places.map((p) => (p.deployedBuild ? order.lastIndexOf(p.deployedBuild) : -1)).filter((i) => i >= 0), order.length - 1);
	let seq: string[] = order.length ? order.slice(lowest).reverse() : [];
	if (!seq.length) {
		/* no catalogue anywhere (a mock, a place whose list has not loaded): the places' own newer-build lists give the sequence, the longest is the spine */
		const spinePlace = [...places].sort((a, b) => b.heldBuilds.length - a.heldBuilds.length)[0];
		const spine = spinePlace.heldBuilds.map((h) => h.build);
		seq = spine.length && spinePlace.deployedBuild ? [...spine, spinePlace.deployedBuild] : spine;
	}
	if (!seq.length) {
		/* nothing newer anywhere: every place is on the newest; the newest deploy names it, any other build is custom */
		const top = [...places]
			.filter((p) => p.deployedBuild)
			.sort((a, b) =>
				newestFirst(deployedHistory(a.href, 1)[0]?.at, deployedHistory(b.href, 1)[0]?.at)
			)[0]?.deployedBuild;
		seq = top ? [top] : [];
	}
	const info = new Map<
		string,
		{ title: string | null; author: string | null; created: string | null }
	>();
	for (const p of places) {
		for (const h of p.heldBuilds)
			if (!info.has(h.build))
				info.set(h.build, { title: h.title, author: h.author, created: h.created });
	}
	for (const p of places)
		for (const h of deployedHistory(p.href, 8)) {
			const cur = info.get(h.build);
			if (!cur) info.set(h.build, { title: h.title, author: h.author, created: h.at });
			else if (!cur.title && h.title)
				info.set(h.build, { ...cur, title: h.title, author: cur.author ?? h.author });
		}
	const targets = deployTargets(places);
	const mk = (build: string, index: number | null, custom: boolean): Stop => {
		const i = info.get(build);
		return {
			key: build,
			build,
			title: i?.title ?? null,
			author: i?.author ?? null,
			created: i?.created ?? null,
			age: ago(i?.created),
			ageLabel: builtAgo(i?.created),
			pr: buildIdentity(build, places[0]?.href)?.pr ?? null,
			index,
			custom,
			places: byTopology(places.filter((p) => p.deployedBuild === build)),
			deployTo: targets.get(build) ?? []
		};
	};
	const stops = seq.map((b, i) => mk(b, i, false));
	const outside = [
		...new Set(
			places.map((p) => p.deployedBuild).filter((b): b is string => !!b && !seq.includes(b))
		)
	];
	const custom = outside;
	return [
		...stops,
		...custom.map((b) => mk(b, null, true))
	];
}
export type LedgerItem =
	| { kind: 'stop'; stop: Stop }
	| { kind: 'fold'; key: string; stops: Stop[] };
/** runs of FOLD or more consecutive stops no place stands on fold into one grey row (the sequence's first and last stops never fold); `open` lists fold keys the reader expanded */
export function foldLedger(
	stops: Stop[],
	open: ReadonlySet<string> = new Set(),
	fold = 4
): LedgerItem[] {
	const out: LedgerItem[] = [];
	let run: Stop[] = [];
	const flush = (edge: boolean) => {
		if (run.length >= fold && !edge && !open.has(run[0].key))
			out.push({ kind: 'fold', key: run[0].key, stops: run });
		else for (const s of run) out.push({ kind: 'stop', stop: s });
		run = [];
	};
	stops.forEach((s, i) => {
		const unused = !s.places.length && !s.custom && i > 0 && i < stops.length - 1;
		if (unused) run.push(s);
		else {
			flush(false);
			out.push({ kind: 'stop', stop: s });
		}
	});
	flush(false);
	return out;
}
/** the tab's own count for a place: how many entries its "Newer builds" list has */
export const tabLag = (p: PlaceHold): number => p.heldBuilds.length;

/** what a place says when its tab's own list (what it is OFFERED: builds that failed here or upstream, or that are gated, are not) has fewer builds than the stop it stands on counts: it names the gap in the place's own words, "4 to deploy · 4.41.0-41 failed here" when the missing builds failed in this place, "4 to deploy here" otherwise. Null when they agree. Never "Up to date" on a row under a build that is behind. */
export const placeNote = (stop: Pick<Stop, 'index' | 'custom'>, p: PlaceHold): string | null => {
	if (stop.custom || stop.index === tabLag(p)) return null;
	const n = tabLag(p);
	const lead = n ? `${n} to deploy` : 'Nothing to deploy';
	const failed = p.failedHere ?? [];
	if (!failed.length) return `${lead} here`;
	return `${lead} · ${failed.length === 1 ? failed[0] : `${failed.length} builds`} failed here`;
};
/** the stop's own word: "Newest", "N builds behind" (the tab's count), "Custom build" (never counted) */
export const stopWord = (s: Pick<Stop, 'index' | 'custom'>): string =>
	s.custom ? 'Custom build' : s.index === 0 ? 'Newest' : lagWord(s.index ?? 0);

/** r2 apps fix 8: the stop's lag as the ledger's 64px right track prints it ("Newest", "5 behind"); the full words ("5 builds behind") stay in the row's title and aria-label */
export const stopShort = (s: Pick<Stop, 'index' | 'custom'>): string =>
	s.custom ? 'Custom' : s.index === 0 ? 'Newest' : `${s.index ?? 0} behind`;

/** The wave clause of a place row: "wave 2" / "follows eu-west-1", null where the tier has one wave and no follower (nothing to say).
 *  The row prints it after the state word as `Healthy · wave 2`: a real space, then the dot GLUED to the clause (non-breaking), so a wrap never strands the dot at a line end. */
export function waveFactOf(
	w:
		| { site: string; leader: boolean; follows: string | null; multi: boolean; wave: number }
		| null
		| undefined
): string | null {
	if (!w || w.site === '') return null;
	if (!w.leader) return `follows ${w.follows ?? 'its leader'}`;
	return w.multi ? `wave ${w.wave}` : null;
}
/** the separator + clause as drawn: dot and clause joined by a non-breaking space */
export const waveClause = (fact: string): string => `\u00b7\u00a0${fact}`;
/** the place's ONE state word, the strip cell's own (never "Live"): at rest "Healthy"; a place the pin holds says the tab's cause, "Held by the pin" */
export function placeWord(p: Pick<PlaceHold, 'state'>, pinned = false, yours = false): string {
	if (pinned) return 'Held by the pin';
	/* detail pass 2026-11-08: one approval word on every page (approvalWord): "Needs your approval" when the viewer can give it */
	return (
		(
			{
				failed: 'Failing',
				'awaiting-approval': approvalWord(yours),
				'held-by-rule': 'Held',
				deploying: 'Deploying',
				checking: 'Checking',
				'rolled-back': 'Rolled back'
			} as Record<string, string>
		)[p.state] ?? 'Healthy'
	);
}
/**
 * landing v5 (2026-11-10): a place that runs a build older than the newest while its rollout order has not reached it was printed
 * "Healthy · follows ap-southeast-2" (health, and a fact that reads as "in step"): the word contradicted the state. It is WAITING, and the
 * product's sentence names the build and on whom (state-words vocabulary (a): "waiting for X" is the cause, "held" the state).
 * `on` = the site it waits for (a follower: its wave's leader; a wave leader: the nearest earlier wave of its tier, else the tier before it),
 * `fact` = what it will do and to which build ("to deploy 4.46.0-46"; "to finish checking ..." once that site has started it).
 * Only a HEALTHY place a promotion gate keeps a newer build from: one a real rule, an approval or a failing check holds has its own word.
 */
export type PlaceWait = { on: string; fact: string };
/** the places a waiting place waits on (placeWait's rule), by name; null when it is not waiting */
/** `viaFailure`: also a place an APPROVAL holds, when a build failed upstream in its wave chain (`upstreamFailed`): the approval must not mask the failure */
function waitingOn(
	p: PlaceHold,
	places: PlaceHold[],
	viaFailure = false
): { on: PlaceHold[]; name: string } | null {
	const w = p.wave;
	if (
		!w ||
		p.state !== 'healthy' ||
		(p.holdReason !== 'rule' && !(viaFailure && p.holdReason === 'approval' && p.upstreamFailed)) ||
		(holdWord(p) && !(viaFailure && p.holdReason === 'approval')) ||
		!(p.heldBuilds.length || p.upstreamFailed)
	)
		return null;
	let on: PlaceHold[];
	let name: string;
	if (!w.leader) {
		on = places.filter((q) => q.tier === p.tier && q.wave?.site === w.follows);
		name = w.follows ?? 'its leader';
	} else {
		const before = places.filter((q) => q.tier === p.tier && q.wave && q.wave.wave < w.wave);
		const top = Math.max(...before.map((q) => q.wave!.wave));
		on = before.filter((q) => q.wave!.wave === top);
		name = placesPhrase(
			on.map((q) => q.wave!.site),
			on.map((q) => q.tier)
		);
		if (!on.length) {
			const t = upstreamTier(places, p.tier);
			on = t ? places.filter((q) => q.tier === t) : [];
			name = t ?? '';
		}
	}
	return on.length ? { on, name } : null;
}
export function placeWait(p: PlaceHold, places: PlaceHold[]): PlaceWait | null {
	const o = waitingOn(p, places);
	if (!o || !p.heldBuilds.length)
		return null; /* a place held only by a build that failed upstream has no build waiting: the sentence is waveHold's */
	return { on: o.name, fact: waitFact(o.on.map((q) => q.state), (p.heldBuilds[0]?.build ?? p.upstreamFailed)!) };
}
/**
 * batch4 #3 (landing v5 R5): the same wait, with its CAUSE. After a wave-1 catch (us-east-1 failed the bake) the wave-2 places the environment
 * controller refuses read plain "healthy" on Environments. They are healthy on the old build, but a wave holds them, and the page says so:
 * `on` = who they wait on (placeWait's own name, one blocker source), `failed` = the site(s) among them that failed the held build, else null.
 */
export function waveHold(
	p: PlaceHold,
	places: PlaceHold[],
	failedAt: (q: PlaceHold, build: string) => boolean = bakeFailedOn
): { on: string; failed: string | null } | null {
	const o = waitingOn(p, places, true);
	if (!o) return null;
	/* an approval hold on a NEWER build must not mask an upstream failure: ask about the failed build first, then the held one, and show the failure (QA8 ruling 4) */
	const builds = [p.upstreamFailed, p.heldBuilds[0]?.build].filter((b): b is string => !!b);
	if (!builds.length)
		return null; /* nothing is held here (a rolled-back failure holds nobody): no wave line at all */
	const f = [...new Set(builds.flatMap((b) => failedAlong(p, b, places, failedAt)))];
	return { on: o.name, failed: f.length ? f.join(', ') : null };
}
/**
 * batch4 #3d (H-new): the sites that failed `build` anywhere along `p`'s wave chain. A follower waits on its LEADER, and a leader held by an upstream
 * failure is held by it too, so the failure is followed leader by leader (a place is "held by the failure" when it carries `upstreamFailed` or still
 * lists the build as held). A plain wave-order wait, with no failure anywhere upstream, resolves to [].
 */
function failedAlong(
	p: PlaceHold,
	build: string,
	places: PlaceHold[],
	failedAt: (q: PlaceHold, build: string) => boolean,
	depth = 0
): string[] {
	const o = waitingOn(p, places, true);
	if (!o || depth > 6) return [];
	const direct = o.on.filter((q) => failedAt(q, build)).map((q) => q.label);
	if (direct.length) return direct;
	return o.on
		.filter((q) => q.upstreamFailed === build || q.heldBuilds.some((b) => b.build === build))
		.flatMap((q) => failedAlong(q, build, places, failedAt, depth + 1));
}
/** the ONE build every "Pinned to <build> in <place>" hold names (the Holding row's title); null when there are none or they name different builds */
export const pinnedVersion = (holds: string[]): string | null => {
	const v = new Set(holds.map((h) => /^Pinned to (\S+) in /.exec(h)?.[1]).filter((x): x is string => !!x));
	return v.size === 1 ? [...v][0] : null;
};
/** the places a "Pinned to <build> in <place>" hold (data.ts holds) names, by PlaceHold.place */
export const pinnedPlaces = (holds: string[]): Set<string> =>
	new Set(holds.map((h) => /^Pinned to \S+ in (.+)$/.exec(h)?.[1]).filter((x): x is string => !!x));

/**
 * r2 apps fix 4 — the figures of the detail page's "Summary" card (the History tab's own HistorySummaryCard pattern: a rollup plus a few stat
 * figures, failures in their own ink). Folds the retained histories of every place of the app over the last `days` days:
 * deploys, failed, rolled back (history-marks' deployActs, the tab's own definition), the median time to healthy (the tab's own formula),
 * the newest failure, and `daysWithData` (distinct days holding a deploy: below 2 the card collapses to a short list of facts).
 * `openFailure` is true while a place's NEWEST deploy is itself failed (a superseded failure is not the page's alarm).
 */
export type WeekHistory = { timestamp?: string; bakeStatus?: string; bakeEndTime?: string };
export type WeekRollout = { history: WeekHistory[]; rolledBack: boolean[] };
export function weekSummary(
	rollouts: WeekRollout[],
	days: number,
	nowMs: number
): {
	deploys: number;
	failed: number;
	rolledBack: number;
	medianHealthyMs: number | null;
	lastFailureMs: number | null;
	daysWithData: number;
	openFailure: boolean;
} {
	const from = nowMs - days * 86_400_000;
	let deploys = 0,
		failed = 0,
		rolledBack = 0,
		open = false;
	const durations: number[] = [];
	const day = new Set<number>();
	for (const r of rollouts) {
		r.history.forEach((h, i) => {
			const t = h.timestamp ? new Date(h.timestamp).getTime() : NaN;
			if (!(t >= from && t <= nowMs)) return;
			deploys++;
			day.add(startOfDayMs(new Date(t)));
			if (r.rolledBack[i]) rolledBack++;
			if (h.bakeStatus === 'Failed') {
				failed++;
				if (i === 0) open = true;
			}
			if (h.bakeStatus === 'Succeeded' && h.bakeEndTime) {
				const e = new Date(h.bakeEndTime).getTime();
				if (e > t) durations.push(e - t);
			}
		});
	}
	durations.sort((a, b) => a - b);
	const mid = Math.floor(durations.length / 2);
	const medianHealthyMs = durations.length
		? durations.length % 2
			? durations[mid]
			: (durations[mid - 1] + durations[mid]) / 2
		: null;
	return {
		deploys,
		failed,
		rolledBack,
		medianHealthyMs,
		lastFailureMs: lastFailureMs(
			rollouts.map((r) => r.history),
			from,
			nowMs
		),
		daysWithData: day.size,
		openFailure: open
	};
}

/** the approval banner's line: the count only once the place's held-HERE answer is known; while it is pending the sentence carries no number (never a guess that flips) */
export const waitingSentence = (heldN: number | null): string =>
	`${newerBuildsAre(heldN ?? 0, heldN == null)} waiting here.`;

/**
 * landing v5 (2026-11-10): an approval at the head of a rollout order opens the order, it does not finish it. The places that come AFTER a
 * place in its tier's rollout order (sites and waves: every later wave, and the followers of its own wave when it leads), counted off the
 * app's own places. Empty when the place has no wave facts (a tier of one place, an unbound rollout) or nothing comes after it.
 */
export function placesAfter(p: Pick<PlaceHold, 'tier' | 'wave'>, places: PlaceHold[]): PlaceHold[] {
	const w = p.wave;
	if (!w) return [];
	return places.filter(
		(q) =>
			q.wave &&
			q.tier === p.tier &&
			q.wave.site !== w.site &&
			(q.wave.wave > w.wave || (w.leader && q.wave.wave === w.wave && !q.wave.leader))
	);
}
/** "Then 4 more regions follow." (prod places are regions, the product's word for several prod sites; any other tier says places). null when none follow. */
export function followSentence(after: readonly Pick<PlaceHold, 'tier'>[]): string | null {
	const n = after.length;
	if (!n) return null;
	const noun = after.every((q) => q.tier === 'prod')
		? n === 1
			? 'region'
			: 'regions'
		: n === 1
			? 'place'
			: 'places';
	return `Then ${n} more ${noun} follow${n === 1 ? 's' : ''}.`;
}
/** the approval banner's message for the place it names: what waits here, then what comes after it ("1 newer build is waiting here. Then 4 more regions follow.") */
export const approvalMessage = (
	heldN: number | null,
	focus: PlaceHold | null,
	places: PlaceHold[]
): string =>
	[waitingSentence(heldN), focus ? followSentence(placesAfter(focus, places)) : null]
		.filter(Boolean)
		.join(' ');

/** the time-in-state a PlaceRow prints. A place that WAITS (approval / rule) prints the one clock of a wait, `waitClock` (the figure the /rollouts row prints);
 *  every other place prints since its deployed build landed. The waiting build's own age is not this row's to say. */
export const placeAge = (row: TRow, hs: HomeState = 'incident'): string =>
	ago((row.group === 'approval' || row.group === 'held') && !row.stillChecking ? waitClock(row, hs) : (deployedBuild(row)?.at ?? row.since));

/** The banner message of a single-cause app: the parts after the lead, minus any that repeats the lead (the held cause and the app's own fact can both carry the hold's sentence). Null when nothing is left. */
/** `causeLine` over typed causes: what the banner's message adds beyond its lead, a promotion label kept as a label */
export function causeLineOf(parts: Cause[]): Cause | null {
	const rest = parts.slice(1).filter((p) => causeText(p) !== causeText(parts[0] ?? []));
	return rest.length ? joinCause(...rest.flatMap((c, i) => (i ? [' · ', c] : [c]))) : null;
}
export function causeLine(parts: string[]): string | null {
	return (
		parts
			.slice(1)
			.filter((p) => p !== parts[0])
			.join(' · ') || null
	);
}
