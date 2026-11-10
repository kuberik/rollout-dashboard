/**
 * FLEET FACTS — the ONE derivation every fleet-wide count reads from.
 * (Integration TL ruling, 2026-10-10: "the same counts disagree across
 * surfaces (deploys 100 vs 105; held 8 vs 4 vs '6 apps in 8 places') because
 * units were never defined." This module defines them, once, and every
 * surface that shows a fleet-wide number is expected to read this file —
 * directly, or through `fleetPulse`/`heldFor`, which now delegate to it.)
 *
 * ── THE UNITS ─────────────────────────────────────────────────────────────
 *
 * PLACE = one rollout = app × environment; each prod region is its own
 * place. `regions` = how many of a set of places are prod-tier regions
 * (`tierOf(env) === 'prod'`).
 *
 * APP = a distinct app name (`card.name`).
 *
 * MAPPED vs UNMAPPED: a rollout with an Environment (`hasEnvironment`) is
 * mapped; the Promotion Map can only draw mapped places (`buildLanes`
 * already drops unmapped cards). STATE facts (held, failed live, in motion,
 * needs you) count ALL places, mapped or not, and also return `unmapped` —
 * how many of them have no Environment — so the map can say "+1 outside the
 * map" instead of disagreeing with this file silently. Totals: `apps` (all),
 * `mappedApps`, `places`, `mappedPlaces`.
 *
 * DEPLOYS (window = the page's range, start..end inclusive, plus the
 * previous period for the delta): every `status.history` entry in the
 * window across ALL rollouts, including apps with no Environment — a deploy
 * happened whether or not it is on the map. `deploys.unmapped` is how many
 * of those entries belong to an unmapped rollout.
 *
 * HELD — ⭐ CORRECTED AGAIN 2026-10-11 (shared/held-predicate, coordinator
 * ruling: "refused here vs not reached yet", `view-models/held.ts`'s own
 * doc has the full ruling). The 2026-10-10 version of this note said a
 * promotion-order gate is HELD "like any other" gate — that was the bug:
 * The environment controller's promotion gate publishes the SAME shape for two
 * different facts, plain chain sequencing (staging has simply not deployed
 * this build yet — nothing refuses it, it has not arrived) and a genuine
 * order gate between SIBLING SITES of one tier (a later wave, or a follower
 * and its leader: one prod region must wait for another, both already eligible). Only the second is a hold. `held` here
 * is still exactly `nodeState(card) === 'held'` (`promotion-lanes.ts`) —
 * the same predicate the Promotion Map draws as an orange cube — but
 * `nodeState`'s own `isHeld` now reads `held.ts`'s `heldVerdict` (via
 * `RolloutCard.held`, precomputed once in `rollout-cards.ts`), which
 * resolves that ambiguity by tier: an upstream environment in an EARLIER
 * tier is chain sequencing (never held — `card.waitsForEnv` names the
 * stage instead); the SAME tier (a sibling region) is a real order gate,
 * counted here exactly as `byCause.order` below already expected. This
 * file needed no code change for the fix — `placeState`/`nodeState`
 * carries it — only this note, which described the pre-fix behaviour as
 * the rule.
 * BEHIND is the complement: a newer build exists and NOTHING is blocking it
 * (`nodeState(card) === 'behind'`) — it just has not been promoted yet
 * (including plain chain sequencing, now).
 *
 * `byCause` splits held places into `order` (an explicit order gate between
 * SIBLINGS — `classifyHold` only ever sees this for a place `nodeState`
 * already confirmed held, so a bare chain gate can never reach this branch
 * mislabelled), `approval` (a person/approval gate — `story.person`),
 * `dependency` (a `RolloutDependency` contract wait — `story.upstream` with
 * `kind === 'dependency'`), and `other` (a schedule, an unattributed rule,
 * or — with no `GateContext` supplied — a hold this file cannot classify
 * at all; see `classifyHold`'s own note). Priority when more than one cause
 * applies to the same held place, same order `holdCausePhrase` already
 * uses: approval > dependency > order > other. `medianMs`/`longestMs`/
 * `longestSubject` are `waitingSince` — how long the build each held
 * rollout is waiting for has existed — exactly as `held-for.ts` always
 * computed it.
 *
 * FAILED: `live` is the rollout's CURRENT state (`nodeState === 'failed'`);
 * `inWindow` is failed history entries inside the window; `resolvedInWindow`
 * is how many of those are no longer their rollout's current state (a
 * resolved failure is history, never an alarm — `fleet-pulse.ts`'s own
 * `isCurrentFailure`, moved here).
 *
 * IN MOTION: `nodeState` `deploying`/`checking`, counted as places.
 *
 * STUCK: `nodeState === 'stuck'`, counted as places.
 *
 * NEEDS YOU: apps/places with any place where `isNeedsYou` (`fleet-groups.ts`
 * — failed live, stuck, or a failing health check) OR held with an
 * APPROVAL cause — an order or dependency hold resolves itself once the
 * rule/provider clears and is never counted here, same as
 * `ControlCenter.svelte`'s own `heldByApproval`.
 *
 * NEWEST EVERYWHERE: mapped apps whose every place is on its newest build
 * (every lane node's `state === 'newest'`) — Home's Fleet header ("N of M
 * apps on the newest everywhere").
 *
 * PER STAGE: `byTier`/`byEnv`, grouped by tier or by environment name — THE
 * UNIT RULE (coordinator ruling, 2026-10-11): a stage/environment head
 * counts APPS BY WORST STATE. Each app counts once per stage; its worst
 * place there wins (product order failed > stuck > held > deploying >
 * checking > behind > newest) — `appsByState`. That is the SAME unit the
 * map draws (one block per app) and the one a caption's "of N apps" must
 * use; `appsByState` replaces the old per-app `plates` field (the name
 * `plates` is gone — this IS the apps count now). `placesByState` is the
 * raw per-PLACE tally (one entry per rollout, mapped or not blended in —
 * regions do NOT collapse). `appsByCause` splits this stage's held apps by
 * `classifyHold`'s cause, same classifier and priority as `held.byCause`/
 * `held.byCauseApps` (home-alt-b's per-tier "N wait for you" split). Places
 * and regions appear only as an explicit "in N places" or as region names in
 * a cell — never folded silently into an apps count, and vice versa.
 */
import { siteCount, regionsPhrase } from './regions';
import type { Rollout } from '../../types';
import type { RolloutCard } from '$lib/rollout-cards';
import { getDisplayVersion, formatDurationMs } from '$lib/utils';
import { median } from './lead-time';
import { isNeedsYou } from './fleet-groups';
import {
	buildLanes,
	hasEnvironment,
	nodeState,
	STATE_ORDER,
	tierOf,
	TIER_ORDER,
	type LaneNode,
	type NodeState,
	type Tier
} from './promotion-lanes';
import { compareEnvironmentNames } from '$lib/env-order';
import { blockingStory, joinClauses, type GateContext, type ContractHolds } from './blocking-story';

// ── THE WINDOW ──────────────────────────────────────────────────────────
// Moved here from `fleet-pulse.ts`, which now imports it back — the window
// a figure is counted over is itself part of "the units", so it lives with
// the rest of them. `fleet-pulse.ts` re-exports these three for its own
// existing callers.
export type PulseRange = '24h' | '7d' | '30d';
export const PULSE_RANGES: PulseRange[] = ['24h', '7d', '30d'];
const H = 3600_000;
const D = 24 * H;
export const RANGE_SPEC: Record<PulseRange, { span: number; bins: number; label: string; prev: string }> = {
	'24h': { span: D, bins: 24, label: 'last 24 hours', prev: 'the 24 hours before' },
	'7d': { span: 7 * D, bins: 28, label: 'last 7 days', prev: 'the 7 days before' },
	'30d': { span: 30 * D, bins: 30, label: 'last 30 days', prev: 'the 30 days before' }
};

export type HoldCause = 'order' | 'approval' | 'dependency' | 'other';

export type FleetFactsOpts = {
	/** The gate join table (`buildGateContext` + `withNetworkSchedules`).
	 *  Omit it and every held place classifies `other` — see `classifyHold`. */
	gateContext?: GateContext;
	/** The same dependency-contract join Home already builds for
	 *  `buildRolloutCards`'s own `held` field. */
	contractHoldsFor?: (rollout: Rollout) => ContractHolds | undefined;
};

/** THE UNIT RULE's seven states, worst to best — same product order as
 *  `STATE_ORDER` minus `'none'`. */
export type StageStateKey = 'failed' | 'stuck' | 'held' | 'deploying' | 'checking' | 'behind' | 'newest';

export type StageFacts = {
	/** Distinct apps with a place in this stage. */
	apps: number;
	/** Every place (one per rollout) in this stage — mapped only, same
	 *  population `byTier`/`byEnv` are built from (`buildLanes`). */
	places: number;
	/** Of `places`, how many are prod-tier (only non-zero for the `prod`
	 *  tier/env entries; kept on every entry so a caller never has to ask
	 *  `tierOf` itself). */
	regions: number;
	/** ⭐ THE UNIT RULE: one count per APP, its WORST place in this stage
	 *  (failed > stuck > held > deploying > checking > behind > newest).
	 *  This IS the map's per-plate block tally (was `plates`) — a caption
	 *  under a stage counts these, never `placesByState`, so it never mixes
	 *  regions into an "of N apps" line (home-map, round-6 read: "held 5 vs
	 *  4"). Sums to `apps`. */
	appsByState: Record<StageStateKey, number>;
	/** The raw per-PLACE tally — one entry per rollout in this stage, no
	 *  app-level folding. Sums to `places`. For the surfaces that speak
	 *  regions/places explicitly, never for an "of N apps" line. */
	placesByState: Record<StageStateKey, number>;
	/** Held apps in this stage, by `classifyHold`'s cause — same classifier
	 *  and priority as `held.byCause`/`held.byCauseApps` (home-alt-b's
	 *  per-tier "N wait for you" split). An app can appear under more than
	 *  one cause if it has multiple held places in the stage with different
	 *  causes, same as the top-level `byCauseApps`. */
	appsByCause: Record<HoldCause, number>;
};

export type FleetFacts = {
	range: PulseRange;
	start: number;
	end: number;
	hasPrev: boolean;
	apps: number;
	mappedApps: number;
	places: number;
	mappedPlaces: number;
	regions: number;
	deploys: { value: number; prev: number | null; unmapped: number };
	held: {
		/** LANE-gated: apps whose Fleet row itself reads Held (worst node
		 *  wins) — home-map's shipped `heldFor` rule. ⭐ shared/fleet-facts-ids
		 *  (2026-10-11, coordinator ruling): widened to also count an app with
		 *  NO Environment at all when its OWN worst place (no lane to read it
		 *  off, so judged card-by-card the same worst-wins way) is held — a
		 *  dependency-contract hold on an unmapped consumer is a real hold,
		 *  never "outside the map". Exactly `appIds.length`. */
		apps: number;
		/** Every app counted in `apps`, by name, sorted — the lane-gated
		 *  mapped apps plus the unmapped ones described above. `heldLabel`
		 *  names these the same way regardless of which population an app
		 *  came from. */
		appIds: string[];
		/** Of `appIds`, the ones waiting on a PERSON (`RolloutCard.heldCause
		 *  === 'person'` on their held place) — the same population
		 *  `byCauseApps.approval`/Home's "N wait for you" already count, as
		 *  an explicit list rather than a size. Sorted. */
		approvalAppIds: string[];
		/** RAW: every individually-held place/node, mapped or not — the
		 *  original per-region unit. NOT lane-gated: a place can be a real
		 *  held fact even when its app's headline is worse elsewhere. */
		places: number;
		/** The map's own unit — app × stage, production ONE plate. Not
		 *  lane-gated either (same reasoning as `places`). */
		plates: number;
		regions: number;
		unmapped: number;
		/** LANE-gated, same population as `apps`. */
		byCause: Record<HoldCause, number>;
		/** `byCause` in APPS (distinct apps with a held place of that cause,
		 *  same lane-gated population), for a label that speaks apps: Home's
		 *  Held tile, "1 waits for you · 2 held by a rule" (home-map).
		 *  ⭐ shared/fleet-facts-ids (2026-10-11): also includes an unmapped
		 *  app's own cause (same widened population as `apps`/`appIds`) —
		 *  `byCause` itself (the PLACE tally) stays lane-gated-mapped-only. */
		byCauseApps: Record<HoldCause, number>;
		medianMs: number | null;
		longestMs: number | null;
		longestSubject: { app: string; env: string } | null;
		/** ⭐ shared/held-label (2026-10-11): apps held by a RULE — order,
		 *  dependency or other — EXCLUDING approval. Same population as
		 *  `apps`/`appIds` (⭐ shared/fleet-facts-ids widened this to include
		 *  unmapped apps too), read off each card's own precomputed
		 *  `heldCause` (never re-derived). An app with both an approval-held
		 *  place and a
		 *  rule-held place counts here (it IS held by a rule somewhere) AND
		 *  in `needsYou`/`byCauseApps.approval` — the two are not disjoint,
		 *  on purpose: approvals are never folded OUT of a rule count, only
		 *  never folded IN to one. `heldLabel` reads this, not `apps`. */
		ruleApps: number;
		/** Set exactly when `ruleApps === 1` — enough to name the one
		 *  rule-held app as a sentence instead of a count. `env` is the
		 *  refused stage: the one place's env, or — when the app has several
		 *  rule-held places — the earliest tier in its chain (a single prod
		 *  region's name, or `'prod'` when more than one region); `''` when
		 *  the one rule-held app has NO Environment at all (⭐ shared/
		 *  fleet-facts-ids) — there is no stage to name, and `heldLabel`
		 *  drops the "held in <env>" clause rather than print an empty one.
		 *  `causeLabel` is that place's own `heldCauseLabel`
		 *  (`view-models/held.ts`), reused verbatim, never re-phrased. */
		ruleSingle: { app: string; env: string; causeLabel: string } | null;
		/** The longest wait among `ruleApps`' own held places only — NOT
		 *  `longestMs` above, which spans every held cause including
		 *  approval. `heldLabel`'s "longest" reads this one. */
		ruleLongestMs: number | null;
	};
	failed: {
		live: { apps: number; places: number; regions: number; unmapped: number };
		inWindow: { value: number; prev: number | null };
		resolvedInWindow: number;
	};
	inMotion: { apps: number; places: number; deploying: number; checking: number; unmapped: number };
	stuck: { apps: number; places: number };
	needsYou: { apps: number; places: number };
	newestEverywhere: { apps: number; of: number };
	/** ⭐ shared/fleet-facts-ids (2026-10-11): apps whose lane/worst state is
	 *  `'behind'` — the complement of `held` above, same predicate
	 *  (`buildLanes(...).state === 'behind'` for mapped apps, an unmapped
	 *  app's own worst place for apps with no Environment at all). A newer
	 *  build exists and nothing is refusing it; it just has not been
	 *  promoted yet. */
	behind: { apps: number; appIds: string[] };
	byTier: Record<Tier, StageFacts>;
	byEnv: Record<string, StageFacts>;
};

/** When the oldest build newer than the running one was released, or null.
 *  Moved here from `held-for.ts` (which re-exports it) so `fleet-facts.ts`
 *  never has to import that module back — one direction only. */
export function waitingSince(card: RolloutCard): number | null {
	const r = card.rollout;
	const v0 = r.status?.history?.[0]?.version;
	const cur = v0 ? getDisplayVersion(v0) || null : null;
	const rel = r.status?.availableReleases ?? [];
	const curIdx = rel.findIndex((x) => !!x && (x.version === cur || x.tag === cur));
	const newer = (r.status?.releaseCandidates?.length ? r.status.releaseCandidates : rel.slice(curIdx + 1)).filter(
		(x) => !!x?.created
	);
	const ms = newer.reduce((m, x) => Math.min(m, new Date(x.created!).getTime()), Infinity);
	return Number.isFinite(ms) ? ms : null;
}

/**
 * ONE PREDICATE FOR "HELD APP" (coordinator 2026-10-10: the KPI said "5 apps
 * held in 8 places" over a Fleet list with two Held rows). An app is held
 * when its LANE leads with held — the state its Fleet row prints, worst wins
 * (failed > stuck > held > in progress) — over the same population the Fleet
 * and the map draw (`buildLanes`: apps with an environment). Moved here from
 * `held-for.ts` (which re-exports it) for the same one-direction reason as
 * `waitingSince`.
 */
export function heldLanes(cards: readonly RolloutCard[]): ReturnType<typeof buildLanes> {
	return buildLanes([...cards]).filter((l) => l.state === 'held');
}

/**
 * ⭐ THE ONE CALL SITE. Every held/failed/stuck/in-motion/behind/newest fact
 * below reads a place's state through this single function, which today is
 * nothing but `nodeState` (`promotion-lanes.ts`) — so the predicate rewrite
 * the integration TL flagged (distinguishing "refused here" from "hasn't
 * reached this stage yet", `waitsFor`) swaps in at this one line, not at
 * the dozen call sites that would otherwise each need finding again.
 */
function placeState(c: RolloutCard): NodeState {
	return nodeState(c);
}

/**
 * The cause of ONE held place. Needs the gate join table to tell an approval
 * gate from a bare promotion-order one, or a dependency contract from both —
 * `blockingStory`'s own classification, read in the same priority
 * `holdCausePhrase` already uses (approval leads, the contract leads over a
 * bare order, per that function's "THE CONTRACT LEADS" note).
 *
 * With no `GateContext` (a caller that has not built one — `buildRolloutCards`
 * itself falls back to `promotionBlock(r).blocked` in exactly this case, "safe
 * to compute for every card on every list surface"), a held place classifies
 * `other`: this file cannot tell an order gate from an approval without the
 * join table, and guessing would be inventing a fact, not measuring one.
 */
function classifyHold(c: RolloutCard, opts: FleetFactsOpts): HoldCause {
	if (!opts.gateContext) return 'other';
	const story = blockingStory(c.rollout, opts.gateContext, {
		contractHolds: opts.contractHoldsFor?.(c.rollout)
	});
	if (!story.blocked) return 'other';
	if (story.person.length > 0) return 'approval';
	if (story.upstream.some((g) => g.kind === 'dependency')) return 'dependency';
	if (story.upstream.some((g) => g.kind === 'promotion')) return 'order';
	return 'other';
}

type Entry = { ms: number; status: string; rollout: Rollout; mapped: boolean };

function deployEntries(rollouts: Rollout[], cardByRollout: Map<Rollout, RolloutCard>): Entry[] {
	const out: Entry[] = [];
	for (const r of rollouts) {
		const card = cardByRollout.get(r);
		const mapped = card ? hasEnvironment(card) : false;
		for (const h of r.status?.history ?? []) {
			if (!h.timestamp) continue;
			const ms = new Date(h.timestamp).getTime();
			if (!Number.isFinite(ms)) continue;
			out.push({ ms, status: h.bakeStatus ?? '', rollout: r, mapped });
		}
	}
	return out;
}

/** A failed entry that is still the rollout's newest deploy is a current
 *  failure — moved verbatim from `fleet-pulse.ts`'s own `isCurrentFailure`. */
function isCurrentFailure(e: Pick<Entry, 'ms' | 'rollout'>): boolean {
	const h0 = e.rollout.status?.history?.[0];
	return !!h0 && h0.bakeStatus === 'Failed' && !!h0.timestamp && new Date(h0.timestamp).getTime() === e.ms;
}

function emptyStageState(): Record<StageStateKey, number> {
	return { failed: 0, stuck: 0, held: 0, deploying: 0, checking: 0, behind: 0, newest: 0 };
}

function emptyStage(): {
	apps: Set<string>;
	places: number;
	regions: number;
	/** distinct prod place labels: regions are SITES (QA #10), never one per app */
	regionNames: Set<string>;
	placesByState: Record<StageStateKey, number>;
	worst: Map<string, NodeState>;
	causeApps: Record<HoldCause, Set<string>>;
} {
	return {
		apps: new Set(),
		places: 0,
		regions: 0,
		regionNames: new Set(),
		placesByState: emptyStageState(),
		worst: new Map(),
		causeApps: { order: new Set(), approval: new Set(), dependency: new Set(), other: new Set() }
	};
}

function tally(acc: ReturnType<typeof emptyStage>, app: string, n: LaneNode, opts: FleetFactsOpts): void {
	const state = n.state;
	acc.apps.add(app);
	const was = acc.worst.get(app);
	if (was == null || STATE_ORDER.indexOf(state) < STATE_ORDER.indexOf(was)) acc.worst.set(app, state);
	acc.places++;
	if (n.tier === 'prod') {
		acc.regionNames.add(n.env);
		acc.regions = siteCount([...acc.regionNames]);
	}
	if (state in acc.placesByState) acc.placesByState[state as StageStateKey]++;
	if (state === 'held') {
		const cause = classifyHold(n.card, opts);
		acc.causeApps[cause].add(app);
	}
}

function toStageFacts(acc: ReturnType<typeof emptyStage>): StageFacts {
	return {
		apps: acc.apps.size,
		places: acc.places,
		regions: acc.regions,
		appsByState: appsByStateTally(acc.worst),
		placesByState: acc.placesByState,
		appsByCause: {
			order: acc.causeApps.order.size,
			approval: acc.causeApps.approval.size,
			dependency: acc.causeApps.dependency.size,
			other: acc.causeApps.other.size
		}
	};
}

function appsByStateTally(worst: Map<string, NodeState>): Record<StageStateKey, number> {
	const out = emptyStageState();
	for (const st of worst.values()) if (st in out) out[st as StageStateKey]++;
	return out;
}

/**
 * THE PARTIAL-REGION RULE (coordinator ruling, 2026-10-12), one place: the
 * held places of ONE app in ONE tier, named. The tier word ("prod") only when
 * every place of the app in that tier is held (and there is more than one);
 * 1–2 held places are named; 3+ are counted ("3 prod regions"). Shared by
 * `heldLabel`'s single-app clause and the Promotion Map's held callouts.
 */
export function heldPlacesPhrase(held: readonly string[], of: number, tier: string): string[] {
	const names = [...new Set(held)];
	if (names.length === of && names.length > 1) return [tier];
	if (names.length <= 2) return names.sort(compareEnvironmentNames);
	return [regionsPhrase(siteCount(names), tier) ?? names.join(', ')];
}

export function fleetFacts(
	cards: RolloutCard[],
	rollouts: Rollout[],
	nowMs: number,
	range: PulseRange,
	opts: FleetFactsOpts = {}
): FleetFacts {
	const spec = RANGE_SPEC[range];
	const end = nowMs;
	const start = end - spec.span;
	const prevStart = start - spec.span;

	const cardByRollout = new Map(cards.map((c) => [c.rollout, c] as const));
	const all = deployEntries(rollouts, cardByRollout);
	const oldest = all.reduce((m, e) => Math.min(m, e.ms), Infinity);
	const hasPrev = Number.isFinite(oldest) && oldest <= prevStart + spec.span * 0.05;

	let deploys = 0;
	let prevDeploys = 0;
	let unmappedDeploys = 0;
	let failedInWindow = 0;
	let prevFailed = 0;
	let resolvedInWindow = 0;
	for (const e of all) {
		if (e.ms >= start && e.ms <= end) {
			deploys++;
			if (!e.mapped) unmappedDeploys++;
			if (e.status === 'Failed') {
				failedInWindow++;
				if (!isCurrentFailure(e)) resolvedInWindow++;
			}
		} else if (hasPrev && e.ms >= prevStart && e.ms < start) {
			prevDeploys++;
			if (e.status === 'Failed') prevFailed++;
		}
	}

	// ── TOTALS ──
	const apps = new Set(cards.map((c) => c.name)).size;
	const mappedCards = cards.filter(hasEnvironment);
	const mappedApps = new Set(mappedCards.map((c) => c.name)).size;
	const places = cards.length;
	const mappedPlaces = mappedCards.length;
	const regions = cards.filter((c) => tierOf(c.envName) === 'prod').length;

	// ── HELD ── Two populations, on purpose (home-map's shipped `heldFor`
	// rule, kept exactly: "an app failing somewhere and held elsewhere reads
	// failed, so it is not counted here" for apps/cause/duration — but a held
	// PLACE is still a real, true fact independent of its app's worse sibling,
	// so `places`/`regions`/`unmapped` below count every individually-held
	// node, raw, same as every other STATE fact in this file).
	const lanes = buildLanes(cards);
	const heldCardsRaw = cards.filter((c) => placeState(c) === 'held');
	// `apps`/the cause/the durations are LANE-GATED: an app only reads "held"
	// when ITS LANE leads with held (worst node wins, same precedence the
	// Fleet row and the map draw) — a node that is held but whose app is
	// worse off elsewhere (failing) is a real place-level fact (counted in
	// `places`/the map's plates) but not an "app held" fact nor a reason this
	// file will give for it.
	const heldLaneApps = lanes.filter((l) => l.state === 'held');
	const heldCardsGated = heldLaneApps.flatMap((l) =>
		[...l.stages, ...l.prod].filter((n) => n.state === 'held').map((n) => n.card)
	);

	// ── UNMAPPED APPS, JUDGED BY THEIR OWN WORST STATE (coordinator ruling,
	// 2026-10-11: "apps WITHOUT an Environment that are held on a dependency
	// contract are real holds and COUNT"). `buildLanes` drops every card with
	// no Environment, so an app with NO mapped card at all (e.g. a provider's
	// consumer that lives entirely in a namespace, never an Environment) gets
	// no lane and so far never reached `heldLaneApps`/`ruleHeldCards` even
	// when a `RolloutDependency` contract genuinely refuses it. This block
	// finds those apps (never apps with a MIX of mapped and unmapped cards —
	// those already have a lane and read through the gated path above,
	// unchanged) and gives each one the same "worst node wins" treatment a
	// lane gives its mapped cards, read off `placeState` alone since there is
	// no `LaneNode`/tier to sort by.
	const mappedAppNames = new Set(lanes.map((l) => l.app));
	const cardsByApp = new Map<string, RolloutCard[]>();
	for (const c of cards) {
		const list = cardsByApp.get(c.name) ?? [];
		list.push(c);
		cardsByApp.set(c.name, list);
	}
	const unmappedAppNames = [...cardsByApp.keys()].filter((n) => !mappedAppNames.has(n));
	const unmappedWorst = new Map<string, { card: RolloutCard; state: NodeState }>();
	for (const name of unmappedAppNames) {
		let best: { card: RolloutCard; state: NodeState } | null = null;
		for (const c of cardsByApp.get(name)!) {
			const state = placeState(c);
			if (!best || STATE_ORDER.indexOf(state) < STATE_ORDER.indexOf(best.state)) best = { card: c, state };
		}
		unmappedWorst.set(name, best!);
	}
	const unmappedHeldApps = unmappedAppNames.filter((n) => unmappedWorst.get(n)!.state === 'held');
	const unmappedBehindApps = unmappedAppNames.filter((n) => unmappedWorst.get(n)!.state === 'behind');
	// `plates` — the map's own unit, app × stage, production ONE plate
	// (home-map's shipped `heldFor`: "places are the map's held blocks").
	// Counted per LANE regardless of the lane's overall state (a held place
	// is still a held BLOCK on the map even when its app's headline is
	// worse elsewhere) — distinct TIERS with a held node, not raw nodes, so
	// an app held across three prod regions is one plate, not three.
	// Counted as the map draws it: per app per tier, its WORST place there
	// (an app held in one prod region and failing in another is a red block,
	// not an orange one), so the tile's "in N places" == the orange blocks ==
	// the sum of the map's held captions (home-map, 2026-10-11).
	let plates = 0;
	for (const lane of lanes) {
		const worst = new Map<Tier, NodeState>();
		for (const n of [...lane.stages, ...lane.prod]) {
			const w = worst.get(n.tier);
			if (w == null || STATE_ORDER.indexOf(n.state) < STATE_ORDER.indexOf(w)) worst.set(n.tier, n.state);
		}
		for (const st of worst.values()) if (st === 'held') plates++;
	}
	const byCause: Record<HoldCause, number> = { order: 0, approval: 0, dependency: 0, other: 0 };
	const waits: { ms: number; app: string; env: string }[] = [];
	const causeApps: Record<HoldCause, Set<string>> = { order: new Set(), approval: new Set(), dependency: new Set(), other: new Set() };
	for (const c of heldCardsGated) {
		const cause = classifyHold(c, opts);
		byCause[cause]++;
		causeApps[cause].add(c.name);
		const since = waitingSince(c);
		if (since != null) waits.push({ ms: Math.max(0, nowMs - since), app: c.name, env: c.envDisplay || c.envName || '' });
	}
	const longestWait = waits.reduce<(typeof waits)[number] | null>((w, x) => (!w || x.ms > w.ms ? x : w), null);
	// Unmapped held apps join `causeApps` (so `byCauseApps`/`approvalAppIds`
	// count them, same ruling) but never `byCause`/`waits` — those are the
	// raw held-PLACE tally and the overall median/longest, unchanged by this
	// ruling (only the app-level counts widen).
	for (const name of unmappedHeldApps) {
		const cause = classifyHold(unmappedWorst.get(name)!.card, opts);
		causeApps[cause].add(name);
	}

	// ── HELD BY A RULE (shared/held-label) — a sub-population of the SAME
	// lane-gated `heldCardsGated`, read off each card's own precomputed
	// `heldCause` (`view-models/held.ts`, never re-derived here) rather than
	// `classifyHold`'s GateContext-joined bucket: an approval is `person`,
	// everything else (`order`/`dependency`/`unknown`/`clock`/`check`) is a
	// rule. ──
	const ruleHeldCards = heldCardsGated.filter((c) => c.heldCause !== 'person');
	// Unmapped rule-held apps (same coordinator ruling as `causeApps` above)
	// join the SAME population `ruleApps`/`ruleSingle`/`ruleLongestMs` read —
	// an app with no Environment held on a dependency contract waits on a
	// rule exactly like a mapped one; there is no "person" branch for it
	// (no Environment means no approval gate to publish one), so its own
	// `heldCause` is already never `person` in practice, but the same guard
	// is kept for symmetry with the mapped filter above.
	const unmappedRuleHeldApps = unmappedHeldApps.filter((n) => unmappedWorst.get(n)!.card.heldCause !== 'person');
	const ruleHeldAppNames = new Set([...ruleHeldCards.map((c) => c.name), ...unmappedRuleHeldApps]);
	const ruleWaits: number[] = [];
	for (const c of ruleHeldCards) {
		const since = waitingSince(c);
		if (since != null) ruleWaits.push(Math.max(0, nowMs - since));
	}
	for (const name of unmappedRuleHeldApps) {
		const since = waitingSince(unmappedWorst.get(name)!.card);
		if (since != null) ruleWaits.push(Math.max(0, nowMs - since));
	}
	const ruleLongestMs = ruleWaits.length > 0 ? Math.max(...ruleWaits) : null;
	let ruleSingle: { app: string; env: string; causeLabel: string } | null = null;
	if (ruleHeldAppNames.size === 1) {
		const appName = [...ruleHeldAppNames][0];
		// Every place of this app the shared verdict holds on a rule — not only
		// the lane's held NODES: a place can be held AND checking its running
		// build at once (checkout-api prod-us-east-2), and its node then reads
		// the in-flight state, yet the place IS held and the label must name it.
		const appCards = cards.filter((c) => c.name === appName && c.held && c.heldCause !== 'person' && c.envName);
		if (appCards.length > 0) {
			// ⭐ EVERY HELD TIER OF THE ONE APP, NOT ONLY ITS EARLIEST (qa12,
			// squad-rollout gates-2 follow-up, 2026-10-11, tl-integrate
			// ruling — the frontier rule's own knock-on). This used to narrow
			// to the EARLIEST tier among the app's held cards and silently
			// drop every later one — correct while a hold could only ever be
			// chain-dominant at one tier, wrong now that a prod region can
			// carry its own real, local hold alongside staging's (measured:
			// `checkout-api` held in `staging`, `prod-us-east-2` AND
			// `prod-ap-southeast-2` at once, verified against the real
			// fixture — see `held-predicate.test.ts`'s reference case 2).
			//
			// Grouped by TIER, earliest first (`TIER_ORDER`) — the SAME
			// "several regions in one tier collapse to the tier word"
			// behaviour this already had for a single tier (`prod-us-east-1`
			// + `prod-us-east-2` → `prod`), just applied once per tier that
			// is actually held, then joined across tiers with the house
			// list joiner: "staging and prod", never "staging,
			// prod-ap-southeast-2 and prod-us-east-2" (naming a region by
			// name is still right when its OWN tier holds only the one).
			const byTier = new Map<number, RolloutCard[]>();
			for (const c of appCards) {
				const idx = TIER_ORDER.indexOf(tierOf(c.envName));
				(byTier.get(idx) ?? byTier.set(idx, []).get(idx)!).push(c);
			}
			const tierPhrases = [...byTier.entries()]
				.sort(([a], [b]) => a - b)
				.map(([idx, tierCards]) => {
					// ⭐ PARTIAL REGIONS ARE NAMED (coordinator ruling, 2026-10-12):
					// the tier word ("prod") only when EVERY place of this app in
					// that tier is held; 1–2 held places are named; 3+ are counted
					// ("3 prod regions"). "held in staging and prod" over 2 of 5
					// regions read as all of prod.
					const heldEnvs = [...new Map(tierCards.map((c) => [c.envName, c])).values()];
					const tier = TIER_ORDER[idx];
					const allEnvs = new Set(cards.filter((c) => c.name === appName && tierOf(c.envName) === tier).map((c) => c.envName));
					return heldPlacesPhrase(
						heldEnvs.map((c) => c.envDisplay || c.envName || tierOf(c.envName)),
						allEnvs.size,
						tier
					);
				});
			const env = joinClauses(tierPhrases.flat());
			const earliestTierIdx = Math.min(...byTier.keys());
			const first = byTier.get(earliestTierIdx)![0];
			ruleSingle = { app: appName, env, causeLabel: first.heldCauseLabel ?? 'a rule' };
		} else {
			// The one rule-held app has no Environment at all — no stage to
			// name, so `env` is `''` and `heldLabel` drops the "held in <env>"
			// clause rather than print an empty one (coordinator ruling,
			// 2026-10-11: "no env phrase when the app has none").
			const rep = unmappedWorst.get(appName)!.card;
			ruleSingle = { app: appName, env: '', causeLabel: rep.heldCauseLabel ?? 'a rule' };
		}
	}

	// ── FAILED LIVE ──
	const failedLiveCards = cards.filter((c) => placeState(c) === 'failed');

	// ── IN MOTION / STUCK ──
	const deployingCards = cards.filter((c) => placeState(c) === 'deploying');
	const checkingCards = cards.filter((c) => placeState(c) === 'checking');
	const stuckCards = cards.filter((c) => placeState(c) === 'stuck');

	// ── NEEDS YOU: failed live + stuck + a person-held approval, among the
	// SAME lane-gated held population as the cause/duration above (an app
	// failing elsewhere already wakes someone up via `isNeedsYou`; its
	// OTHER, merely-held place must not ALSO contribute an approval-needs-
	// you reason the Fleet row does not draw). ──
	const needsYouCards = cards.filter(
		(c) => isNeedsYou(c) || (heldCardsGated.includes(c) && classifyHold(c, opts) === 'approval')
	);

	// ── NEWEST EVERYWHERE ──
	const newestApps = lanes.filter((l) => [...l.stages, ...l.prod].every((n) => n.state === 'newest')).length;

	// ── HELD / BEHIND APP LISTS (shared/fleet-facts-ids, 2026-10-11) — every
	// app whose Fleet row itself reads held/behind, mapped or not, sorted.
	// Mapped: `lanes`' own worst-wins state (the SAME population `apps`
	// above is lane-gated over); unmapped: `unmappedWorst`'s own worst-wins
	// state, computed the identical way with no lane to read it off. ──
	const heldAppIds = [...new Set([...heldLaneApps.map((l) => l.app), ...unmappedHeldApps])].sort();
	const behindAppIds = [
		...new Set([...lanes.filter((l) => l.state === 'behind').map((l) => l.app), ...unmappedBehindApps])
	].sort();

	// ── PER STAGE (byTier/byEnv) — the map can only draw mapped places, so
	// these are built off `lanes` (already `hasEnvironment`-filtered). ──
	const byTierAcc: Record<Tier, ReturnType<typeof emptyStage>> = {
		dev: emptyStage(),
		test: emptyStage(),
		staging: emptyStage(),
		other: emptyStage(),
		prod: emptyStage()
	};
	const byEnvAcc = new Map<string, ReturnType<typeof emptyStage>>();
	for (const lane of lanes) {
		for (const n of [...lane.stages, ...lane.prod]) {
			tally(byTierAcc[n.tier], lane.app, n, opts);
			const key = n.env || n.tier;
			tally(byEnvAcc.get(key) ?? byEnvAcc.set(key, emptyStage()).get(key)!, lane.app, n, opts);
		}
	}
	const byTier = Object.fromEntries(TIER_ORDER.map((t) => [t, toStageFacts(byTierAcc[t])])) as Record<Tier, StageFacts>;
	const byEnv: Record<string, StageFacts> = {};
	for (const [k, acc] of byEnvAcc) byEnv[k] = toStageFacts(acc);

	const unmappedOf = (list: RolloutCard[]) => list.filter((c) => !hasEnvironment(c)).length;

	return {
		range,
		start,
		end,
		hasPrev,
		apps,
		mappedApps,
		places,
		mappedPlaces,
		regions,
		deploys: { value: deploys, prev: hasPrev ? prevDeploys : null, unmapped: unmappedDeploys },
		held: {
			apps: heldAppIds.length,
			appIds: heldAppIds,
			approvalAppIds: [...causeApps.approval].sort(),
			places: heldCardsRaw.length,
			plates,
			regions: heldCardsRaw.filter((c) => tierOf(c.envName) === 'prod').length,
			unmapped: unmappedOf(heldCardsRaw),
			byCause,
			byCauseApps: { order: causeApps.order.size, approval: causeApps.approval.size, dependency: causeApps.dependency.size, other: causeApps.other.size },
			medianMs: median(waits.map((w) => w.ms)),
			longestMs: longestWait?.ms ?? null,
			longestSubject: longestWait ? { app: longestWait.app, env: longestWait.env } : null,
			ruleApps: ruleHeldAppNames.size,
			ruleSingle,
			ruleLongestMs
		},
		failed: {
			live: {
				apps: new Set(failedLiveCards.map((c) => c.name)).size,
				places: failedLiveCards.length,
				regions: failedLiveCards.filter((c) => tierOf(c.envName) === 'prod').length,
				unmapped: unmappedOf(failedLiveCards)
			},
			inWindow: { value: failedInWindow, prev: hasPrev ? prevFailed : null },
			resolvedInWindow
		},
		inMotion: {
			apps: new Set([...deployingCards, ...checkingCards].map((c) => c.name)).size,
			places: deployingCards.length + checkingCards.length,
			deploying: deployingCards.length,
			checking: checkingCards.length,
			unmapped: unmappedOf([...deployingCards, ...checkingCards])
		},
		stuck: { apps: new Set(stuckCards.map((c) => c.name)).size, places: stuckCards.length },
		needsYou: {
			apps: new Set(needsYouCards.map((c) => c.name)).size,
			places: needsYouCards.length
		},
		newestEverywhere: { apps: newestApps, of: mappedApps },
		behind: { apps: behindAppIds.length, appIds: behindAppIds },
		byTier,
		byEnv
	};
}

/** A signed relative change, rounded: +12%, −40%. null when there is nothing
 *  to compare against. Moved from `fleet-pulse.ts`, which re-exports it. */
export function deltaPct(f: { value: number | null; prev: number | null }, minSample = 10): number | null {
	if (f.value == null || f.prev == null || f.prev < minSample) return null;
	return Math.round(((f.value - f.prev) / f.prev) * 100);
}

// ── LABEL HELPERS — every one SAYS THE UNIT, per the integration TL's rule
// ("counts disagree because units were never defined — fix is to say the
// unit, not just the number") — EXCEPT never in the words "places" or "the
// map" (shared/held-label, 2026-10-11: those read as jargon and named a
// region that most pages drawing these labels do not even have). A unit
// still gets said, just as a plain noun ("rollouts", "regions", an app
// name) or, for one held app, a full sentence naming its stage and cause. ──

/**
 * ⭐ shared/held-label (2026-10-11, coordinator ruling): HELD READS AS A
 * SENTENCE, not a unit count. Approvals are never folded in here — they are
 * "waits for you" (`needsYouLabel`/`isHeldByApproval`); this reads only
 * `held.ruleApps` (order/dependency/other). `''` when the only holds are
 * approvals (or nothing is held) — the caller then shows nothing, or its own
 * waits-for-you figure. Never mentions "places" or "the map": a single
 * rule-held app gets the exact stage and cause (`<app> held in <env> ·
 * waits on <cause>`, `<cause>` being `ruleSingle.causeLabel`, straight off
 * `view-models/held.ts`'s `heldCauseLabel` — never re-phrased here); several
 * get a count and the longest wait among them.
 */
export function heldLabel(f: FleetFacts): string {
	const h = f.held;
	if (h.ruleApps === 0) return '';
	if (h.ruleApps === 1 && h.ruleSingle) {
		const { app, env, causeLabel } = h.ruleSingle;
		// ⭐ shared/fleet-facts-ids (2026-10-11): an app with no Environment
		// has no stage to name — "edge-mesh held · waits on payments-svc",
		// never "held in " with nothing after it.
		return env ? `${app} held in ${env} · waits on ${causeLabel}` : `${app} held · waits on ${causeLabel}`;
	}
	const dur = h.ruleLongestMs != null ? formatDurationMs(h.ruleLongestMs) : null;
	return `${h.ruleApps} apps held by a rule${dur ? ` · longest ${dur}` : ''}`;
}

export function failedLiveLabel(f: FleetFacts): string {
	const n = f.failed.live;
	if (n.apps === 0) return 'nothing failing';
	let s = `${n.apps} app${n.apps === 1 ? '' : 's'} failing`;
	const r = regionsPhrase(n.regions);
	if (r) s += `, incl. ${r}`;
	return s;
}

export function deploysLabel(f: FleetFacts): string {
	const d = f.deploys;
	return `${d.value} deploy${d.value === 1 ? '' : 's'}`;
}

export function needsYouLabel(f: FleetFacts): string {
	const n = f.needsYou;
	if (n.apps === 0) return 'nothing needs you';
	return `${n.apps} app${n.apps === 1 ? '' : 's'} need${n.apps === 1 ? 's' : ''} you`;
}

export function newestEverywhereLabel(f: FleetFacts): string {
	return `${f.newestEverywhere.apps} of ${f.newestEverywhere.of} apps on the newest everywhere`;
}

/** `'apps'` (default) reads `appsByState` — THE UNIT RULE's one-block-per-app
 *  count, the same unit the map draws (the old `'plates'` unit is gone; it
 *  IS `'apps'` now). `'places'`/`'regions'` read `placesByState`, the raw
 *  per-rollout tally — `'regions'` is just `'places'` under a name for a
 *  caller that already knows the stage is prod-only (squad-fleet2's own
 *  ask, for /apps/[name], /envs/[name], /ns pages showing a single app's own
 *  chain: `stageLabel(facts.byTier.prod, { unit: 'regions' })` →
 *  "3 of 5 regions on the newest"). A whole-fleet caller leaves `unit` at
 *  its default, `apps`. */
export type StageUnit = 'apps' | 'places' | 'regions';

/** The display noun for a `StageUnit` — the internal unit key (`'places'`
 *  included) never changes, only the word a label prints for it. `'places'`
 *  reads "rollouts" (THE UNITS: "PLACE = one rollout = app × environment"),
 *  a plain count noun, never jargon ("places", "outside the map"). */
function unitWord(unit: StageUnit): string {
	return unit === 'places' ? 'rollouts' : unit;
}

export function stageLabel(s: StageFacts, opts: { unit?: StageUnit } = {}): string {
	const unit = opts.unit ?? 'apps';
	const n = unit === 'apps' ? s.apps : s.places;
	const newest = unit === 'apps' ? s.appsByState.newest : s.placesByState.newest;
	const word = unitWord(unit);
	if (n === 0) return 'nothing here';
	if (newest >= n) return `All ${n} ${word} on the newest`;
	return `${newest} of ${n} ${word} on the newest`;
}

/**
 * ⭐ shared/age-lag-total (2026-10-12, coordinator ruling): THE APPS TOTAL
 * EXPLAINS ITSELF. Home's header said "18 apps" while the Promotion Map and
 * Fleet list below it showed 13 — both numbers were real (`apps` counts
 * every distinct rollout name; `mappedApps` counts the ones with an
 * Environment, which is all the map/Fleet list can ever draw — see this
 * file's own "MAPPED vs UNMAPPED" note), but the header never said which one
 * it was giving, so the gap read as a bug rather than as a fact.
 *
 * This is the ONE label for that total, read by the header AND by the "+N
 * apps without an environment" fold already sitting under the Fleet list
 * (`ControlCenter.svelte`'s own `envless`) — both now count the same two
 * numbers (`facts.apps`, `facts.mappedApps`), so a header that says "5
 * without" and a fold that opens to five rows can never again be two
 * numbers for one fleet.
 *
 * `18 apps · 13 in environments · 5 without` — omitted to a bare `N apps`
 * when every app has an Environment (`without === 0`): a fleet with no gap
 * has nothing to explain, and "0 without" would be the "0 need you" defect
 * this product already refuses elsewhere (`fleetFacts`'s own needsYou/held
 * labels never print a zero clause).
 */
export function appsTotalLabel(f: Pick<FleetFacts, 'apps' | 'mappedApps'>): string {
	const without = f.apps - f.mappedApps;
	const apps = `${f.apps} app${f.apps === 1 ? '' : 's'}`;
	if (without <= 0) return apps;
	// "in environments" is a fixed phrase (not pluralised by `mappedApps`,
	// the same way `stageLabel`'s "on the newest" never pluralises) — it
	// names the population, not a count of environments.
	return `${apps} · ${f.mappedApps} in environments · ${without} without`;
}
