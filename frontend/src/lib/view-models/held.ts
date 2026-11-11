/**
 * ⭐ HELD — REFUSED HERE, VS NOT REACHED YET. ONE PREDICATE. (shared/held-predicate,
 * 2026-10-10/11, coordinator ruling.)
 *
 * ── THE RULING ────────────────────────────────────────────────────────────
 *
 * HELD means the build has passed every earlier stage in its own chain, yet
 * something refuses it HERE: an approval/person gate, a schedule/window, a
 * dependency contract, or an explicit order gate between parallel siblings
 * (e.g. two prod regions, one of which must wait for the other).
 *
 * NOT HELD is plain chain sequencing: the build has not reached the stage
 * before yet. That stage is `behind`, with `waitsFor()` naming the stage in
 * front of it and, when THAT stage is itself held, the reason — "waits for
 * staging · staging held on payments-svc" — never "held" twice for one cause.
 *
 * ── ELIGIBILITY, THE SIGNAL ACTUALLY ON HAND ─────────────────────────────
 *
 * A candidate is ELIGIBLE at environment E exactly when nothing EARLIER in
 * E's own promotion chain is refusing it. The signal for "earlier" is the
 * upstream edge a `promotion`-classified gate already carries (`classifyGate`'s
 * own join over the app's tier/wave/leader topology, surfaced as
 * `ClassifiedGate.upstreamTier` and, when it names a tier,
 * `ClassifiedGate.subject`): read its TIER against E's own tier
 * (`env-order.ts`'s rank, bucketed exactly as `promotion-lanes.ts`'s `tierOf`
 * already buckets it). An upstream environment in an EARLIER tier (dev before
 * staging before prod) names ordinary chain sequencing — the build simply has
 * not gotten here yet, and no other gate's verdict at E matters until it
 * does: a person gate, a contract, or a same-tier order gate refusing a
 * candidate E was never going to see anyway is not a second hold, it is
 * noise upstream of the real one. An upstream environment in the SAME tier
 * (one prod region waiting on another: a later wave, or a follower and its
 * leader) is the one case a topology edge can express that is NOT sequencing
 * — an explicit order gate between siblings — and it only counts as a hold once chain sequencing is
 * out of the way, i.e. once the candidate is actually eligible here.
 *
 * This is deliberately conservative: an upstream reference this module
 * cannot resolve to a real, ranked environment name (no join, or the
 * generic "its upstream environment" fallback `classifyGate` uses when it
 * has evidence of a promotion gate but not which environment) is treated as
 * NEITHER chain nor order — never invented into either kind of hold it
 * cannot prove. It is not nothing, though: a promotion gate is genuinely
 * refusing this build right now, this module just cannot tell whether that
 * is sequencing or an order gate — so it reports `unknown`, the same
 * non-committal answer `blocking-story.ts` already gives an allow-list gate
 * no join could attribute, rather than silently calling it not-held.
 *
 * ── THE SHAPE ─────────────────────────────────────────────────────────────
 *
 * `heldVerdict(story, placeEnv)` is the one predicate: given the
 * `BlockingStory` `blocking-story.ts` already computes for a rollout (gates
 * classified, contracts folded in by the hold-one-rule) and the environment
 * name that story is FOR, it decides held-vs-not-reached-yet and, when held,
 * which of the story's own gate buckets is the cause. `waitsFor(card, ctx)`
 * is the companion fact for the NOT-held case: the stage this card is behind,
 * plus — when that stage's own card says IT is held — the one-line reason,
 * read off that peer's own precomputed `heldCause`/`heldCauseLabel` (one hop
 * only; `waitsFor` never recurses past the immediate stage in front).
 *
 * Every surface reads this: `rollout-cards.ts` calls `heldVerdict` once per
 * card and stores the verdict (`held`, `heldCause`, `heldCauseLabel`,
 * `waitsForEnv`) on the `RolloutCard`; `fleet-groups.ts`'s `isHeld` and
 * `promotion-lanes.ts`'s `nodeState` read those fields exactly as they read
 * any other precomputed card fact, unchanged in shape. A caller holding a
 * `BlockingStory` directly (the rollout detail Overview banner, the Gates
 * tab) calls `heldVerdict`/`heldCauseLabel` itself, the same two functions,
 * so neither surface can draw a different line between held and behind.
 */

import type { RolloutCard } from '$lib/rollout-cards';
import type { BlockingStory, ClassifiedGate, GateContext, PromotionHoldBreakdown } from './blocking-story';
import { blockingStory, joinClauses, promotionHoldBreakdown } from './blocking-story';
import { getEnvironmentRank } from '$lib/env-order';
import { isTrailing } from './fleet-groups';
import { shortenVersion } from '../utils';

/** The worst-first order a held cause is picked in — see `heldVerdict`. */
export type HeldCause = 'person' | 'unknown' | 'dependency' | 'order' | 'clock' | 'check';

/**
 * ⭐ THE FRONTIER CANDIDATE'S OWN VERDICT. (qa12, squad-rollout gates-2
 * follow-up, 2026-10-11, tl-integrate ruling.) `null` exactly when no
 * candidate at the place has cleared every earlier stage — nothing is
 * eligible to be held or clear here yet.
 */
export type FrontierEntry = {
	/** The frontier's own display build id. */
	build: string;
	/** Refused HERE — an approval, a contract, a same-tier order gate, a
	 *  schedule, or a check. `false` when the frontier is eligible and
	 *  nothing refuses it (it simply has not deployed yet). */
	held: boolean;
	/** `null` exactly when `held` is `false`. */
	cause: HeldCause | null;
	/** The same fact as `cause`, in words — `causeLabelForGates` run on the
	 *  frontier's OWN gates, never a blend with any other candidate's. */
	causeLabel: string | null;
	/** an approval also refuses here (see `GateVerdict.alsoAwaitingApproval`), with the other hold it is behind */
	alsoApproval?: AlsoHold;
};

/** One upstream stage, and how many of the place's own candidates are
 *  queued behind it — never reached because an earlier-tier promotion gate
 *  (chain sequencing) refuses them, not a hold. */
export type WaitingBehind = {
	stage: string;
	count: number;
	/** The gate's own sentence when the wait is on a site/wave/lockstep member, else null. */
	wave?: string | null;
};

export type HeldVerdict = {
	/** Refused HERE — an approval, a contract, a same-tier order gate, a
	 *  schedule, or a check. Never true for plain chain sequencing.
	 *  A THIN DERIVATION of `frontier?.held ?? false` — kept so every
	 *  existing caller of this field keeps compiling and agreeing; a
	 *  caller that also cares WHICH build reads `frontier` itself. */
	held: boolean;
	/** `frontier?.cause ?? null`. `null` exactly when `held` is `false`. */
	cause: HeldCause | null;
	/**
	 * Set exactly when NOT held because NO candidate has cleared every
	 * earlier stage — the newest queued stage's raw name (never a display
	 * label), for `waitsFor` to look the peer card up by. `null` when held,
	 * and `null` when not held for any other reason (nothing blocked at
	 * all). A THIN DERIVATION of `waitingBehind[0]?.stage ?? null`.
	 */
	waitsForEnv: string | null;
	/** `waitingBehind[0]?.wave`: the wave/site wording ("Waiting for us-east-1 to finish checking c6f19d2") when the wait is not on a plain tier. */
	waveWait?: string | null;
	/**
	 * ⭐ THE FRONTIER RULE'S OWN FACT (qa12): the newest candidate that has
	 * cleared every earlier stage, and whether IT is held. `null` when no
	 * candidate is eligible yet (every one is still queued behind an
	 * earlier stage) — see `waitingBehind` for that case instead.
	 */
	frontier: FrontierEntry | null;
	/**
	 * ⭐ EVERY OTHER CANDIDATE, GROUPED BY WHICH STAGE IT IS QUEUED BEHIND
	 * (qa12). A candidate that has not cleared every earlier stage is never
	 * "held" — it is counted here instead, by stage, newest-queued-stage
	 * first. Empty when every candidate (if any) is the frontier itself or
	 * older than it.
	 */
	waitingBehind: WaitingBehind[];
};

const NOT_HELD: HeldVerdict = {
	held: false,
	cause: null,
	waitsForEnv: null,
	frontier: null,
	waitingBehind: []
};

/**
 * `classifyGate`'s literal fallback subject when it has evidence of a
 * promotion gate (an `Environment`-owned `RolloutGate`) but no upstream
 * join to name which environment — never a real environment name, so never
 * read as one here either.
 */
const UNRESOLVED_UPSTREAM = 'its upstream environment';

/**
 * Tier bucket, duplicated from `promotion-lanes.ts`'s `tierOf` rather than
 * imported from it. `promotion-lanes.ts` imports `isHeld`/`isNeedsYou` from
 * `fleet-groups.ts`, and `fleet-groups.ts`'s `isHeld` reads the `held` field
 * THIS module computes — importing `tierOf` back from `promotion-lanes.ts`
 * would close that into a module cycle. The bucketing is copied verbatim
 * (same five buckets, same rank thresholds); `env-order.ts`'s rank is the
 * single source either side reads.
 */
function tierBucket(envName: string | null | undefined): number {
	const r = getEnvironmentRank(envName);
	if (r <= 1) return 0; // dev
	if (r <= 3) return 1; // test
	if (r <= 5) return 2; // staging
	if (r === 6) return 3; // other / unresolvable
	return 4; // prod
}

/** A promotion gate's upstream name, or `null` when it cannot be trusted as
 *  a real, ranked environment (no join, or the generic fallback string). */
function upstreamNameOf(gate: ClassifiedGate): string | null {
	if (gate.kind !== 'promotion') return null;
	if (gate.subjectKind !== 'environment' || !gate.subject) return null;
	if (gate.subject === UNRESOLVED_UPSTREAM) return null;
	return gate.subject;
}

/**
 * Split a story's `promotion`-kind gates into chain sequencing (an earlier
 * tier — not reached yet) and sibling order (the same tier — a real hold
 * once eligible). Both can be present at once (e.g. a prod region whose
 * promotion gate points at a sibling that is itself still waiting on
 * staging) — `heldVerdict` always resolves chain first, so an unreached
 * sibling order never outranks "this hasn't gotten here yet".
 */
function splitPromotionGates(
	gates: readonly ClassifiedGate[],
	placeEnv: string | null | undefined
): { chainUpstream: string | null; chainGate: ClassifiedGate | null; order: boolean; unresolved: boolean } {
	const hereTier = tierBucket(placeEnv);
	let chainUpstream: string | null = null;
	let chainGate: ClassifiedGate | null = null;
	let order = false;
	let unresolved = false;
	for (const g of gates) {
		const after = upstreamNameOf(g);
		// A site name (`eu-west-1`) or a wave (`wave 1 (a, b)`) ranks as nothing;
		// the gate's own `upstreamTier` says which tier it waits on.
		const ref = g.upstreamTier ?? after;
		if (!ref) {
			unresolved = true;
			continue;
		}
		const afterTier = tierBucket(ref);
		if (afterTier < hereTier) {
			if (!chainUpstream) {
				chainUpstream = after ?? ref;
				chainGate = g;
			}
		} else if (afterTier === hereTier && (after ?? ref) !== placeEnv) {
			// A same-tier edge the TOPOLOGY derived (`upstreamTier` set: a later wave
			// waiting on the previous one, a follower waiting on its leader, a site
			// waiting on a sibling's bake) is the tier's own sequencing: the build
			// has not cleared the stage in front of this site yet, so it is
			// `behind`, not `held`. Only a hand-written sibling reference with no
			// topology behind it (no `upstreamTier`) is an explicit order hold.
			if (g.upstreamTier) {
				if (!chainUpstream) {
				chainUpstream = after ?? ref;
				chainGate = g;
			}
			} else {
				order = true;
			}
		}
	}
	return { chainUpstream, chainGate, order, unresolved };
}

/**
 * ⭐ THE ONE PREDICATE. Given the `BlockingStory` already computed for a
 * rollout (gate-only or with contract holds folded in — this function does
 * not care which) and the raw environment name that story is FOR, decide
 * held vs not-reached-yet.
 *
 * Order of resolution, and why: chain sequencing is checked FIRST and, if
 * present, wins outright — every other bucket (`person`/`unknown`/
 * `dependency`/a same-tier `order` gate/`clock`/`check`) is moot until the
 * candidate actually reaches this environment, so none of them may report a
 * hold of their own while it has not. Once chain sequencing is clear, the
 * remaining buckets are read worst-first, the same order `blockingStory`'s
 * own `iconKind`/`holdCausePhrase` already rank in: a person outranks
 * "we don't know" outranks a named contract outranks a bare promotion order
 * outranks a clock/check (which, alone, name no second party).
 */
/**
 * ⭐ THE FRONTIER RULE, OVER A PLACE'S OWN CANDIDATES. (qa12, squad-rollout
 * gates-2 follow-up, 2026-10-11, tl-integrate ruling.) Walks `perBuild`
 * newest-first (`promotionHoldBreakdown`'s own order) and stops at the
 * first candidate that has cleared every earlier stage — ELIGIBLE, in the
 * ruling's own word: `verdictForGates` on that candidate's OWN
 * `classifiedGates` either names a real cause (`held: true`) or finds
 * nothing refusing it at all (`held: false`, `waitsForEnv: null` — it is
 * simply not deployed yet, nothing to report). Every NEWER candidate the
 * walk passed over on the way there was chain-refused (`waitsForEnv` set)
 * — not eligible, counted in `waitingBehind` by stage, never folded into
 * the frontier's own cause. This is the fix for the exact defect the old
 * whole-rollout `heldVerdict` had: UNION-ing every held candidate's gates
 * into one list let a NEWER candidate's chain gate silently outrank an
 * OLDER candidate's real, local hold (measured live,
 * `checkout-api/prod-us-east-2`: `4.43.0-43` already cleared staging and is
 * refused here by `payments-svc`, while `4.44.0-44`/`4.45.0-45` are merely
 * queued behind staging — the old rule reported "waits for staging" for
 * the WHOLE place, swallowing the real hold). Per-candidate gates were
 * already correct (`heldVerdictForBuild`); this is that same per-candidate
 * read, walked in order, for the PLACE's own one verdict.
 */
function frontierVerdict(
	perBuild: readonly { build: string; classifiedGates: ClassifiedGate[]; contracts: unknown[] }[],
	placeEnv: string | null | undefined
): { frontier: FrontierEntry | null; waitingBehind: WaitingBehind[] } {
	const waitingByStage: string[] = [];
	const countByStage = new Map<string, number>();
	const waveByStage = new Map<string, string | null>();
	for (const b of perBuild) {
		const v = verdictForGates(b.classifiedGates, placeEnv, { hasContract: b.contracts.length > 0 });
		if (!v.held && v.waitsForEnv) {
			if (!countByStage.has(v.waitsForEnv)) {
				waitingByStage.push(v.waitsForEnv);
				waveByStage.set(v.waitsForEnv, v.waveWait ?? null);
			}
			countByStage.set(v.waitsForEnv, (countByStage.get(v.waitsForEnv) ?? 0) + 1);
			continue;
		}
		// ELIGIBLE — the newest candidate that has cleared every earlier
		// stage. Stop here regardless of whether it is held; an older
		// candidate is never consulted once this one is found.
		return {
			frontier: {
				build: b.build,
				held: v.held,
				cause: v.cause,
				causeLabel: causeLabelForGates(b.classifiedGates, v.cause),
				...(v.alsoHold ? { alsoApproval: v.alsoHold } : {})
			},
			waitingBehind: waitingByStage.map((stage) => ({ stage, count: countByStage.get(stage) ?? 0, ...(waveByStage.get(stage) ? { wave: waveByStage.get(stage) } : {}) }))
		};
	}
	// No candidate at the place has cleared every earlier stage.
	return { frontier: null, waitingBehind: waitingByStage.map((stage) => ({ stage, count: countByStage.get(stage) ?? 0, ...(waveByStage.get(stage) ? { wave: waveByStage.get(stage) } : {}) })) };
}

/**
 * ⭐ THE ONE PREDICATE, NOW THE FRONTIER'S OWN. (qa12 ruling, see
 * `frontierVerdict`'s own doc for the full account.) `story.candidates`
 * (`blocking-story.ts`'s `promotionHoldBreakdown.perBuild`, carried onto
 * the story) is what this reads — `held`/`cause`/`waitsForEnv` below are
 * THIN DERIVATIONS of `.frontier`/`.waitingBehind`, kept so every existing
 * caller (`RolloutCard.held`, `isHeldByApproval`, …) compiles and agrees
 * without reading the richer shape itself.
 *
 * `story.candidates` is `undefined` only for a HAND-BUILT `BlockingStory`
 * that never went through `blockingStory()` itself (every real caller's
 * story always carries it) — `reference case 3`'s own synthetic
 * same-tier-order fixture, `promotion-hold-breakdown.test.ts`'s fixtures,
 * and a few render tests' stub stories. For exactly that case this falls
 * back to the OLD whole-story gate read (`verdictForGates(story.gates,
 * placeEnv)`) — the one question a synthetic, candidate-less story CAN
 * still answer — so none of those fixtures have to grow a `perBuild` list
 * they were never built to carry.
 */
export function heldVerdict(story: BlockingStory, placeEnv: string | null | undefined): HeldVerdict {
	if (story.candidates === undefined) {
		if (!story.blocked) return NOT_HELD;
		const v = verdictForGates(story.gates, placeEnv);
		if (!v.held) {
			return {
				held: false,
				cause: null,
				waitsForEnv: v.waitsForEnv,
				...(v.waveWait ? { waveWait: v.waveWait } : {}),
				frontier: null,
				waitingBehind: v.waitsForEnv ? [{ stage: v.waitsForEnv, count: 1, ...(v.waveWait ? { wave: v.waveWait } : {}) }] : []
			};
		}
		return {
			held: true,
			cause: v.cause,
			waitsForEnv: null,
			frontier: { build: '', held: true, cause: v.cause, causeLabel: causeLabelForGates(story.gates, v.cause), ...(v.alsoHold ? { alsoApproval: v.alsoHold } : {}) },
			waitingBehind: v.waitsForEnv ? [{ stage: v.waitsForEnv, count: 1 }] : []
		};
	}
	const { frontier, waitingBehind } = frontierVerdict(story.candidates, placeEnv);
	if (!frontier) {
		return { held: false, cause: null, waitsForEnv: waitingBehind[0]?.stage ?? null, ...(waitingBehind[0]?.wave ? { waveWait: waitingBehind[0].wave } : {}), frontier: null, waitingBehind };
	}
	return { held: frontier.held, cause: frontier.cause, waitsForEnv: null, frontier, waitingBehind };
}

/**
 * ⭐ THE SAME PREDICATE, OFF A BARE GATE LIST. (squad-rollout gates-2 follow-up,
 * 2026-10-11) `heldVerdict` only ever had a whole-rollout `BlockingStory` to
 * read — this is the identical ruling for a caller that has classified a
 * SPECIFIC BUILD's own gates (`promotionHoldBreakdown`'s per-candidate read,
 * never the whole rollout's). `heldVerdict` now delegates here with
 * `story.gates` (the union every bucket on a `BlockingStory` is filtered
 * from, so this is behaviour-preserving for every existing caller) —
 * extracted, not duplicated, so the "Newer builds" rows (Overview, Gates,
 * `BlockedRow`) can ask the identical question about ONE candidate without a
 * second copy of the chain-dominance rule.
 *
 * `options.hasContract` folds in a `RolloutDependency` contract hold that a
 * caller tracks OUTSIDE the gate list (`ContractHolds`, keyed by display
 * version — never a `RolloutGate`, so it cannot appear in `gates` itself).
 * It counts as a `dependency` cause, subject to the SAME chain-dominance
 * rule as every other cause: a contract on a build this environment has not
 * even reached yet is still moot until chain sequencing clears.
 */
/**
 * ONE CANDIDATE'S OWN VERDICT — never the frontier rule's richer shape
 * (`HeldVerdict`, which describes a PLACE across every candidate). Returned
 * by `verdictForGates`/`heldVerdictForBuild`, and by `frontierVerdict`
 * internally while it walks candidates looking for the eligible one.
 */
export type GateVerdict = {
	held: boolean;
	cause: HeldCause | null;
	waitsForEnv: string | null;
	waveWait?: string | null;
	/** An approval also refuses here but is NOT the primary cause (a rule gate is): set from the same refusers list as `cause`, never a second rule. The row says "also needs approval" and Home keeps the ask. */
	alsoAwaitingApproval?: boolean;
	/** the other hold an approval is behind: a window or promotion order clears by itself; anything else (a failing check, a dependency, an unattributed rule) does not */
	alsoHold?: AlsoHold;
};

/** `window`/`order` clear on their own; `hold` does not, and `other` names it (its display name, or a dependency's provider). */
export type AlsoHold = { kind: 'window' | 'order' | 'hold'; other: string };

const GATE_NOT_HELD: GateVerdict = { held: false, cause: null, waitsForEnv: null };

/**
 * The gate's own sentence when the wait is on a site, wave, follower leader or
 * lockstep member; null for plain tier sequencing ("Waits for staging").
 */
function waveWaitOf(g: ClassifiedGate | null): string | null {
	if (!g || !g.short) return null;
	// Plain tier/wave sequencing keeps the short "Waits for <stage>" line.
	if (/ to deploy (it first|this build)$/.test(g.short)) return null;
	return g.short;
}

export function verdictForGates(
	gates: readonly ClassifiedGate[],
	placeEnv: string | null | undefined,
	options: { hasContract?: boolean } = {}
): GateVerdict {
	/* ONE classification per gate within a verdict: a gate the backend calls `schedule` is a window (clock) even before the schedule join has loaded and `classifyGate` could only call it a check (F2, rule: classify by backend kind) */
	const byKind = gates.map((x) => (x.backendKind === 'schedule' && x.clears !== 'clock' && x.clears !== 'person' ? { ...x, clears: 'clock' as const } : x));
	gates = byKind;
	const v = verdictForGatesPrimary(gates, placeEnv, options);
	if (!(v.held && v.cause !== 'person' && gates.some((g) => g.clears === 'person'))) return v;
	return { ...v, alsoAwaitingApproval: true, alsoHold: alsoHoldOf(gates, !!options.hasContract) };
}

/** What an approval is behind, read off the same gates as the cause. A refuser that does not clear by itself (a check, a dependency, an unattributed rule) decides: approving ahead will not deploy until IT clears, and the ask names it. Only when EVERY non-approval refuser is a window or promotion order does the ask say the build deploys when it opens. A gate the backend calls `schedule` is a window even before the schedule join has loaded. */
function alsoHoldOf(gates: readonly ClassifiedGate[], hasContract: boolean): AlsoHold {
	const rules = gates.filter((g) => g.clears !== 'person');
	const name = (g: ClassifiedGate) => g.displayName ?? g.label;
	const isWindow = (g: ClassifiedGate) => g.kind === 'schedule' || g.backendKind === 'schedule';
	const persistent = rules.find((g) => !isWindow(g) && (g.clears === 'unknown' || g.clears === 'check' || (g.clears === 'upstream' && g.kind === 'dependency')));
	if (persistent) return { kind: 'hold', other: persistent.kind === 'dependency' && persistent.subject ? persistent.subject : name(persistent) };
	if (hasContract) return { kind: 'hold', other: 'a dependency' };
	const order = rules.find((g) => g.clears === 'upstream');
	if (order) return { kind: 'order', other: 'promotion order' };
	const win = rules.find((g) => g.clears === 'clock' || isWindow(g));
	return { kind: 'window', other: win ? name(win) : 'a deploy window' };
}

function verdictForGatesPrimary(
	gates: readonly ClassifiedGate[],
	placeEnv: string | null | undefined,
	options: { hasContract?: boolean } = {}
): GateVerdict {
	const upstream = gates.filter((g) => g.clears === 'upstream');
	const promo = upstream.filter((g) => g.kind === 'promotion');
	const { chainUpstream, chainGate, order, unresolved } = splitPromotionGates(promo, placeEnv);
	if (chainUpstream) {
		const waveWait = waveWaitOf(chainGate);
		return { held: false, cause: null, waitsForEnv: chainUpstream, ...(waveWait ? { waveWait } : {}) };
	}

	const person = gates.filter((g) => g.clears === 'person');
	const unknown = gates.filter((g) => g.clears === 'unknown');
	const clock = gates.filter((g) => g.clears === 'clock');
	const checks = gates.filter((g) => g.clears === 'check');

	/* BLAME ORDER (tl ruling, batch4 #92): rule gates (anything refusing that is not the approval) come before the approval. The approval is the cause only when it is the SOLE thing between the build and deploying: no approval can unblock a build another gate refuses, so asking for one is a false call to action. */
	if (person.length > 0 && person.length === gates.length) return { held: true, cause: 'person', waitsForEnv: null };
	if (unknown.length > 0) return { held: true, cause: 'unknown', waitsForEnv: null };
	if (upstream.some((g) => g.kind === 'dependency') || options.hasContract) {
		return { held: true, cause: 'dependency', waitsForEnv: null };
	}
	if (checks.length > 0 && (order || clock.length > 0)) return { held: true, cause: 'check', waitsForEnv: null }; /* a persistent hold is the cause over one that clears by itself */
	if (order) return { held: true, cause: 'order', waitsForEnv: null };
	if (clock.length > 0) return { held: true, cause: 'clock', waitsForEnv: null };
	if (checks.length > 0) return { held: true, cause: 'check', waitsForEnv: null };
	// A promotion gate IS present (so this environment really is refused by
	// something right now) but it names no resolvable upstream at all — not
	// the sentinel fallback string, not an upstream this module can rank
	// (`blocking-story.ts`'s own "Relationship not ready yet" state: the
	// environment controller assigned the gate before publishing which
	// environment it is after). This is NEITHER provably chain nor provably
	// order, so it is never invented into either — but it is also not
	// nothing: `unknown` says exactly that, the same as an allow-list gate
	// no join could attribute at all.
	if (unresolved) return { held: true, cause: 'unknown', waitsForEnv: null };
	if (person.length > 0) return { held: true, cause: 'person', waitsForEnv: null };
	return GATE_NOT_HELD;
}

/**
 * ⭐ ONE PER-BUILD CANDIDATE, FROM `promotionHoldBreakdown`. (squad-rollout
 * gates-2 follow-up, 2026-10-11) The "Newer builds" rows (Overview, Gates,
 * `BlockedRow`) each used to print `held · N rule` for every entry
 * `promotionHoldBreakdown.held` named — including a candidate refused ONLY
 * by plain chain sequencing (an earlier-tier promotion gate: the build has
 * not reached this environment yet, not something refusing it here). This
 * is `verdictForGates` applied to that entry's own `classifiedGates`
 * (already folding its `contracts` in, see that field's own doc comment),
 * so a row reads it exactly like any other `heldVerdict` call: `held` false
 * with `waitsForEnv` set means "Waits for `<stage>`", neutral; `held` true
 * means this environment genuinely refuses it, and `cause`/
 * `causeLabelForGates(build.classifiedGates, cause)` name why.
 */
export function heldVerdictForBuild(
	build: Pick<PromotionHoldBreakdown['held'][number], 'classifiedGates'>,
	placeEnv: string | null | undefined
): GateVerdict {
	return verdictForGates(build.classifiedGates, placeEnv);
}

/**
 * ⭐ THE ONE HELD-BUILD COUNT (QA round 2, A5). "How many builds does this place's hold refuse HERE" was computed four ways (the Gates tab's
 * "Held builds", the approval box's "+N", the detail banner, the app and env pages) and read 6, 4, 4 and 1 for one rollout. A candidate is
 * held HERE exactly when `heldVerdictForBuild` says so; one refused only by plain chain sequencing (an earlier stage has not deployed it)
 * is `waiting` for that stage and is never counted as held. Everything that prints a held count reads `held.length` of this.
 */
export function heldBuilds(
	breakdown: Pick<PromotionHoldBreakdown, 'held'>,
	placeEnv: string | null | undefined,
	/**
	 * QA round 2 A8. `skipped(entry, stage)`: true when `stage` already runs a NEWER build than `entry`, so the build will never reach it ("staging
	 * runs e7c1b60; 1e6c579 was skipped"). Such a build is `skipped`, not `waiting`: nothing is coming for it. Callers that cannot rank builds omit it.
	 */
	skipped?: (entry: { tag: string }, stage: string) => boolean
): {
	held: PromotionHoldBreakdown['held'];
	waiting: { entry: PromotionHoldBreakdown['held'][number]; stage: string | null }[];
	skipped: { entry: PromotionHoldBreakdown['held'][number]; stage: string }[];
} {
	const held: PromotionHoldBreakdown['held'] = [];
	const waiting: { entry: PromotionHoldBreakdown['held'][number]; stage: string | null }[] = [];
	const skippedOut: { entry: PromotionHoldBreakdown['held'][number]; stage: string }[] = [];
	for (const h of breakdown.held) {
		const v = heldVerdictForBuild(h, placeEnv);
		if (v.held) held.push(h);
		else if (v.waitsForEnv && skipped?.(h, v.waitsForEnv)) skippedOut.push({ entry: h, stage: v.waitsForEnv });
		else waiting.push({ entry: h, stage: v.waitsForEnv });
	}
	return { held, waiting, skipped: skippedOut };
}

/**
 * A short noun phrase for a held cause, read off the WHOLE STORY'S blended
 * `gates` — "payments-svc" (joined, when more than one provider holds it),
 * "an approval", "promotion order", a schedule's own label, or "a check".
 * `null` exactly when `cause` is `null`.
 *
 * ⭐ qa12: THIS IS NOT THE FRONTIER'S OWN LABEL. `heldVerdict(...).
 * frontier.causeLabel` is — it is read off the frontier candidate's OWN
 * `classifiedGates` alone, never a blend. This function has no `placeEnv`
 * to find the frontier with, so it stays the coarser, whole-story answer;
 * `RolloutCard.heldCauseLabel` reads the frontier's own field now, not
 * this one (`rollout-cards.ts`). Kept for a caller that genuinely has
 * nothing but a `BlockingStory` and a `cause` — e.g. a hand-built
 * same-tier-order fixture with no per-candidate list at all.
 */
export function heldCauseLabel(story: BlockingStory, cause: HeldCause | null): string | null {
	return causeLabelForGates(story.gates, cause);
}

/**
 * The same label, off a bare gate list — what `heldCauseLabel` now delegates
 * to, and what `verdictForGates`'s own per-build callers (the "Newer
 * builds" rows, squad-rollout gates-2 follow-up) read for a build's own
 * `classifiedGates` rather than a whole-rollout `BlockingStory`. A build's
 * `classifiedGates` already carries its contract holds AS `dependency`-kind
 * classified entries (`promotionHoldBreakdown`'s own `classifyContractHold`
 * fold), so no separate contracts parameter is needed here.
 */
export function causeLabelForGates(gates: readonly ClassifiedGate[], cause: HeldCause | null): string | null {
	if (!cause) return null;
	switch (cause) {
		case 'person':
			return 'an approval';
		case 'unknown':
			return 'a rule this dashboard cannot attribute';
		case 'dependency': {
			const names = [
				...new Set(
					gates
						.filter((g) => g.clears === 'upstream' && g.kind === 'dependency' && g.subject)
						.map((g) => g.subject as string)
				)
			];
			return names.length > 0 ? joinClauses(names) : 'a dependency';
		}
		case 'order':
			return 'promotion order';
		case 'clock':
			return gates.find((g) => g.clears === 'clock')?.label ?? 'a deploy window';
		case 'check': {
			const names = [...new Set(gates.filter((g) => g.clears === 'check' && g.label).map((g) => g.label))];
			return names.length > 0 ? joinClauses(names) : 'a check';
		}
	}
}

/** The fact `waitsFor` states: which stage this card is behind, and —
 *  one hop only — why that stage itself is not moving, when it is held. */
export type WaitsFor = {
	/** The upstream environment's raw name. */
	stage: string;
	/** `"<stage> held on <cause>"`, present only when that peer card is
	 *  itself held. Absent (never a guess) when the peer is unknown, is
	 *  itself just behind a further stage, or carries no `RolloutCard` in
	 *  `ctx.peersByEnv`. */
	heldCause?: string;
	/** The wave/site sentence ("Waiting for us-east-1 to finish checking c6f19d2") when the wait is not on a plain tier; surfaces print it instead of "Waits for <stage>". */
	wave?: string;
};

export type HeldContext = {
	/**
	 * Every other `RolloutCard` for the SAME app, keyed by its raw
	 * `envName` — how `waitsFor` finds the stage immediately in front of
	 * this one. Omit on a caller holding only one card; `waitsFor` still
	 * names the stage, just without `heldCause`.
	 */
	peersByEnv?: Map<string, RolloutCard>;
};

/**
 * ⭐ THE WAITSFOR HELPER. `card.waitsForEnv` is `heldVerdict`'s own output,
 * precomputed once per card (`rollout-cards.ts`) — this function never
 * re-derives it, it only looks up the peer and composes the one-hop
 * sentence fragment.
 */
export function waitsFor(card: Partial<Pick<RolloutCard, 'waveWait'>> & Pick<RolloutCard, 'waitsForEnv'>, ctx: HeldContext = {}): WaitsFor | null {
	const stage = card.waitsForEnv;
	if (!stage) return null;
	const peer = ctx.peersByEnv?.get(stage);
	if (peer?.held && peer.heldCauseLabel) {
		return { stage, heldCause: `${stage} held on ${peer.heldCauseLabel}`, ...(card.waveWait ? { wave: card.waveWait } : {}) };
	}
	return card.waveWait ? { stage, wave: card.waveWait } : { stage };
}

/**
 * ⭐ HELD BY APPROVAL, SPECIFICALLY — the predicate Home's "Needs you ·
 * approval" rows and the identical copy on `/apps` both re-derived
 * page-local (coordinator finding, 2026-10-11: `ControlCenter.svelte`'s
 * `heldByApproval` was `isHeld(c) && !isPinned(c) && rankBehindBy(c.rank) >
 * 0 && cardStory(c).person.length > 0`). Lifted here so both pages read one
 * function, and so it inherits THIS module's chain-dominance fix for free —
 * `isHeld` alone already refuses to say "held" for a build that is merely
 * behind an earlier stage, but the OLD four-clause form re-tested `.person`
 * directly off a freshly-built story, which is exactly the seam a future
 * edit could reopen by trusting `person` before checking chain dominance.
 * Routing through `heldVerdict` closes that for good: `cause === 'person'`
 * can only be true when `held` is also true, which can only be true once
 * chain sequencing has already been ruled out.
 *
 * ⭐ ANSWERS THE OPEN QUESTION: `story.person` NEVER DEPENDS ON CONTRACTS.
 * A `RolloutDependency` contract hold is folded into `BlockingStory.upstream`
 * as a `dependency`-kind entry (`classifyContractHold`) — it is never
 * classified `person`, and the chain-dominance split this module applies
 * reads `upstream`'s `promotion`-kind entries only. So "is this build held
 * on an approval" is decidable from `GateContext` ALONE — no
 * `contractHoldsForRollout`/provider graph required. The one thing
 * `GateContext` must still carry correctly is `sources.dependencies`
 * (`buildGateContext`'s own flag, set whenever a `rolloutDependencies`
 * payload — the bare array, not the built graph — was passed in): a caller
 * that never sees that payload at all under-reports provenance and some
 * genuine approvals may fall to `unknown` instead, which is the SAME
 * fallback-of-doubt `blocking-story.ts`'s own "(3) WE DID NOT LOOK
 * EVERYWHERE" branch already documents — never a false `person`. A caller
 * with only a `GateContext` (no provider network in hand, e.g. a command
 * palette) calls this exactly as `ControlCenter.svelte` does.
 *
 * ⛔ `isTrailing` IS STILL REQUIRED, NOT A LEFTOVER OF THE OLD FOUR-CLAUSE
 * FORM. `cause === 'person'` only ever comes out of a `blocked` story, and a
 * FRESH story built here (gate-only, no `contractHolds`) can disagree with
 * the precomputed `card.held` on whether a candidate even EXISTS for a
 * `stuck`/`failed`/checking card whose `rollout` object is mid-transition —
 * `isTrailing` (healthy + behind) is the same guard `isHeld`/the old
 * `heldByApproval` both already had, and dropping it reopened exactly the
 * defect `needs-you` + `heldByApproval` disjointness exists to prevent: a
 * stuck card that also carries a person gate rendered in BOTH lists at
 * once, a duplicate key on Home's own `NeedsYouCard` (caught by the full
 * suite, `subject.svelte.test.ts`, immediately after this export landed).
 */
export function isHeldByApproval(card: RolloutCard, gateContext: GateContext, now?: Date): boolean {
	if (!isTrailing(card)) return false;
	const story = blockingStory(card.rollout, gateContext, { place: card.envDisplay, now });
	return heldVerdict(story, card.envName).cause === 'person';
}

/**
 * ⭐ shared/approval-words (2026-10-12, coordinator ruling): THE ONE APPROVAL
 * CELL — "running 7b3c9f1 … 4a8d2e6 waits for you", NEVER THE RUNNING SHA
 * ALONE. A live incident (telemetry-indexer, prod) found every cell/row that
 * draws a waiting approval — Home's Fleet row, the PromotionMap's callout and
 * its cube tooltip, the Needs-you row — printing only `card.version`, the
 * rollout's CURRENTLY DEPLOYED build (`rollout-cards.ts`'s own doc: the most
 * recent `status.history` entry). A reader has no way to tell that build
 * apart from the one actually waiting on a person — the two are different
 * shas, and the dashboard named only one of them. `BlockedRow.svelte`'s own
 * `blockedBuild` already carried half the fix (the WAITING build, never the
 * running one, for a `held` row's main build label) — this lifts that half
 * into one function and adds the other: BOTH builds, both labelled, so a
 * reader is never asked to infer which is which.
 *
 * `running`: the rollout's current build (`card.version`), `null` when there
 * is none. `pending`: the newest promotion candidate a gate actually refuses
 * (`promotionHoldBreakdown`'s own `held[0].build` — the SAME fact
 * `BlockedRow`'s `blockedBuild` reads), `null` when nothing is held. Neither
 * field asks the caller to have already run `isHeldByApproval`/`heldVerdict`
 * — a caller unsure whether `card` is actually an approval wait (as opposed
 * to a rule hold) runs that check first and only reads `pending` once it is
 * true, same as every other surface in this ruling.
 */
export type ApprovalCellText = {
	/** "running 7b3c9f1" — the build this rollout is CURRENTLY on. `null`
	 *  with no deploy history yet. */
	running: string | null;
	/** "4a8d2e6 waits for you" — the newest candidate a gate refuses. `null`
	 *  when nothing is held (nothing for a caller to print). */
	pending: string | null;
};

export function approvalCellText(card: RolloutCard): ApprovalCellText {
	const running = card.version ? `running ${shortenVersion(card.version)}` : null;
	const waitingBuild = promotionHoldBreakdown(card.rollout).held[0]?.build ?? null;
	const pending = waitingBuild ? `${shortenVersion(waitingBuild)} waits for you` : null;
	return { running, pending };
}

/** One build's own held fact, as `composeHeldLeadSentence` reads it — a
 *  narrowed `PromotionHoldBreakdown['held'][number]`, never the whole type,
 *  so a caller that only has the build/clauses/contract (not the
 *  `classifiedGates`/`contracts` fields) can still use it. */
export type HeldLeadBuild = {
	build: string;
	clauses: string[];
	contract?: { provider: string; required?: string; has?: string };
};

/**
 * ⭐ THE GATES TAB'S LEAD SENTENCE, FOR BUILDS GENUINELY HELD HERE —
 * EXTRACTED, TESTABLE. (qa11b, items 1 and 2, squad-rollout gates-2
 * follow-up, 2026-10-11) This is the "mixed case" composition the Gates
 * route used to keep inline: group the builds by their exact cause clause
 * ("held UNTIL staging deploys them" / "held BY payments-svc until it
 * ships ~2.9.0 (has 2.4.1)") and name each group once. Moved here so it
 * can be pinned against a real fixture without rendering the whole route —
 * the caller passes ONLY the builds `heldVerdictForBuild` already calls
 * genuinely held (`reallyHeldHere`), never a chain-only candidate: this
 * function has no tier/chain knowledge of its own and trusts its caller
 * for that split entirely. `is`/`are held`, never `wait(s)` — that verb is
 * reserved for a build merely queued behind an earlier stage, never one
 * this environment refuses directly.
 */
export function composeHeldLeadSentence(
	reallyHeld: readonly HeldLeadBuild[],
	deployable: readonly string[]
): { headline: string; consequence: string } {
	// ⭐ qa11b CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11, item
	// 2): "held", never "wait(s)" — every build this function is handed is
	// ALREADY the "really held" subset (its caller's own filter, see this
	// function's own doc comment), so "waits on payments-svc" or "waits
	// until staging deploys it first" claimed the wrong verb for the exact
	// fact the Gates tab's own ruling reserves "wait(s)" for: a build
	// merely QUEUED behind an earlier stage. A build named here is refused
	// HERE — "held by payments-svc until it ships ~2.9.0 (has 2.4.1)" /
	// "held until staging deploys it first".
	type Group = { kind: 'gate' | 'contract' | 'both'; text: string; builds: string[] };
	const groups: Group[] = [];
	const versionClause = (contract: { required?: string; has?: string }): string => {
		const parts: string[] = [];
		if (contract.required) parts.push(contract.required);
		if (contract.has) parts.push(`(has ${contract.has})`);
		return parts.join(' ');
	};
	for (const b of reallyHeld) {
		let kind: Group['kind'];
		let text: string;
		if (b.clauses.length > 0) {
			const gateClause = joinClauses(b.clauses);
			if (b.contract) {
				kind = 'both';
				const vc = versionClause(b.contract);
				text = `${gateClause} and by ${b.contract.provider} until it ships${vc ? ` ${vc}` : ''}`;
			} else {
				kind = 'gate';
				text = gateClause;
			}
		} else if (b.contract) {
			kind = 'contract';
			const vc = versionClause(b.contract);
			text = `${b.contract.provider} until it ships${vc ? ` ${vc}` : ''}`;
		} else {
			continue;
		}
		const existing = groups.find((g) => g.kind === kind && g.text === text);
		if (existing) existing.builds.push(b.build);
		else groups.push({ kind, text, builds: [b.build] });
	}
	const headline = groups
		.map((g) => {
			const plural = g.builds.length > 1;
			// `classifyGate`'s own clause text is written for ONE held
			// subject ("staging deploys it first") — a local pronoun swap
			// when two+ builds share it, same fix the first pass made.
			const text = g.kind !== 'contract' && plural ? g.text.replace(/\bit\b/g, 'them') : g.text;
			const connector = g.kind === 'contract' ? 'by' : 'until';
			return `${joinClauses(g.builds)} ${plural ? 'are' : 'is'} held ${connector} ${text}`;
		})
		.join('; ');
	const consequence =
		deployable.length > 0 ? `${joinClauses([...deployable])} can deploy.` : 'Nothing promotes itself here yet; a deploy you start by hand still applies immediately.';
	return { headline, consequence };
}

/**
 * ⭐ THE CAUSES HOLDING ONE ENVIRONMENT, AS ITS GATES TAB NAMES THEM.
 * (2026-10-25) The Gates tab reads its lead row off `reallyHeldHere`:
 * `promotionHoldBreakdown(...).held` filtered by `heldVerdictForBuild(h,
 * env).held`, so a build merely queued behind an earlier stage is never named
 * as a hold, and a build refused HERE is named by its own gates and contract
 * holds (`payments-svc ships ~2.9.0`). Only when every candidate is held and
 * every held one is really held here does it print `blockingStory`'s own
 * words. A page that keys a cause off the whole story's blended `gates`
 * instead reads the dependency gate's own, vaguer clause (`ships a newer
 * payments than 2.4.1`) for an environment whose frontier build needs
 * `~2.9.0`, and folds it into another environment's different hold.
 *
 * `story` must be built WITH the contract holds (`cardContext().storyFor`),
 * so its `candidates` carry them. Without a held candidate (a pinned
 * rollout, nothing newer) this returns `story.gates` unchanged.
 */
export function heldHereGates(
	story: BlockingStory,
	placeEnv: string | null | undefined
): ClassifiedGate[] {
	const candidates = story.candidates ?? [];
	if (candidates.length === 0) return story.gates;
	const held = candidates.filter((c) => c.gateNames.length > 0 || c.contracts.length > 0);
	const really = held.filter((c) => heldVerdictForBuild(c, placeEnv).held);
	if (held.length === 0) return story.gates;
	// Only queued behind an earlier stage: the chain is the whole cause, as the
	// Gates tab's "Waits for <stage>" lead says. A contract that refuses those
	// queued builds is the earlier stage's hold, not this one's.
	if (really.length === 0) return story.gates.filter((g) => g.kind === 'promotion');
	if (held.length === candidates.length && really.length === held.length) return story.gates;
	const out: ClassifiedGate[] = [];
	const seen = new Set<string>();
	for (const g of really.flatMap((c) => c.classifiedGates)) {
		const k = `${g.kind}|${g.clause}|${g.clearsAt ?? ''}`;
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(g);
	}
	return out;
}

/**
 * ⭐ THE STORY OF ONE ENVIRONMENT, IN THE GATES TAB'S WORDS. (2026-10-25)
 * `/environments`, `/envs/<name>` and `/changes/<slug>` printed
 * `blockingStory`'s whole-rollout prose for every environment, so a prod region
 * whose frontier build needs `payments-svc ~2.9.0` read the staging hold's
 * "ships a newer payments than 2.4.1". The Gates tab's lead row picks per
 * environment: `blockingStory`'s own words when every candidate is really held
 * here, else `composeHeldLeadSentence` over the builds really held here. This
 * is that choice, off `story.candidates` (so `story` must come from
 * `cardContext().storyFor`, which carries the contract holds).
 *
 * Returns `story` itself when nothing narrows (pinned, nothing held, only
 * queued behind an earlier stage, or every candidate really held), otherwise a
 * copy whose `gates` are `heldHereGates` and whose `headline`/`consequence`
 * read "<build> is held by <provider> until it ships <range>. <deployable
 * clause>" , the Gates tab's title and body as one line.
 */
export function heldHereStory(story: BlockingStory, placeEnv: string | null | undefined): BlockingStory {
	const candidates = story.candidates ?? [];
	const held = candidates.filter((c) => c.gateNames.length > 0 || c.contracts.length > 0);
	if (held.length === 0) return story;
	const really = held.filter((c) => heldVerdictForBuild(c, placeEnv).held);
	if (really.length === 0) return story;
	if (held.length === candidates.length && really.length === held.length) return story;
	const deployable = candidates
		.filter((c) => c.gateNames.length === 0 && c.contracts.length === 0)
		.map((c) => c.build);
	const lead = composeHeldLeadSentence(really, deployable);
	return {
		...story,
		gates: heldHereGates(story, placeEnv),
		headline: lead.headline,
		consequence: `${lead.headline}. ${lead.consequence}`
	};
}
