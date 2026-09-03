import type { RevisionRow, RevisionService, RevisionSlot } from './revision-ledger';
import { detectStuck, detectStuckBehind, getDisplayVersion } from '$lib/utils';
import { promotionBlock, promotionCandidates } from './promotion';
import { shortEnvLabel } from '$lib/environment-theme';
import { BAKE_WORD } from '$lib/bake-status';

/**
 * RELEASE COVERAGE — the one question the revision pages exist to answer.
 *
 * From the design project, `fleet-explore.js` concept 07, in the author's own
 * words: *"Take one build and ask: how far has it reached across the fleet? A
 * single coverage bar segments every environment into live / ahead / behind —
 * the release wavefront in one glance."* And the scale note that makes it hold:
 * *"The bar is proportional and the groups are lists — one revision over 4
 * regions or 40 reads as the same four buckets."*
 *
 * THIS MODULE IS THE BUCKETING, AND NOTHING ELSE. It computes no ordering and
 * no rank of its own: every rank it reads comes from `revision-ledger.ts`,
 * which reads `buildLadder` — the product's ONE rank derivation (`env-rank.ts`).
 * A fifth opinion about which build is newer is exactly what that module exists
 * to prevent.
 *
 * A "PLACE" IS A (SERVICE, ENVIRONMENT) SLOT, NEVER A POD. `/api/rollouts` does
 * not carry pod counts — confirmed three times — so a pod ratio here would be
 * invented. The label the UI prints says `places` and the caption says
 * `service × environment`, so the denominator is never mistaken for exposure.
 */

/**
 * FIVE BUCKETS, NOT FOUR, AND THE FIFTH IS AN ADMISSION.
 *
 * Concept 07 names four. A fifth is forced by the product's own rule that an
 * unresolvable comparison may never render as a claim: when a ladder cannot
 * place either this build or the build an environment is currently running,
 * "ahead" and "not yet" are both unsayable. Folding those slots into `ahead`
 * would turn an absence of evidence into a statement about direction. So they
 * get `unplaceable`, which is a NEUTRAL gray and says so in words.
 *
 * It renders only when it is non-empty, so on data that resolves cleanly the
 * page is the four buckets the concept specifies.
 */
export type CoverageKey = 'live' | 'failing' | 'ahead' | 'notYet' | 'unplaceable';

/** Bar order, left to right. Concept 07's table order, with the admission last. */
export const COVERAGE_ORDER: CoverageKey[] = ['live', 'failing', 'ahead', 'notYet', 'unplaceable'];

export type CoverageSlotVM = {
	key: CoverageKey;
	appName: string;
	envName: string;
	envLabel: string;
	slot: RevisionSlot;
	/**
	 * What this service calls the revision, printed ONLY when it differs from
	 * the revision's own sha. The rule is `revision-ledger.ts`'s and it is the
	 * human's original ask: `9f10e49` ships as `1.66.0-66`, `2.66.0-66` and
	 * `9f10e49`, and three of five services would otherwise reprint the sha.
	 */
	label: string;
	labelDiffers: boolean;
	/** Deploy status of the rollout serving this slot, as a dot class. */
	dotClass: string;
	/** The word the dot stands for. A colour is not an accessible name. */
	statusWord: string;
	/** True when the product's own stuck logic fires on this rollout. */
	stuck: boolean;
	/**
	 * What this environment is running RIGHT NOW, in display form. Printed on
	 * the buckets where the row's own build is not the answer — `Moved ahead`
	 * and `Can't place` — so the card says what took its place instead of
	 * leaving the reader to open the app page.
	 */
	runs: string | null;
	/** Rank of the build this environment is running. null = unplaceable. */
	currentRank: number | null;
	/** Rank of THIS revision on the same ladder. null = unplaceable. */
	revRank: number | null;
	/**
	 * How many builds sit between this revision and what the environment runs.
	 * A DISTANCE ON ONE LADDER, so it is sayable; `currentRank` alone is a
	 * distance from the head, which is a different sentence.
	 */
	gap: number | null;
	/**
	 * ⭐ ON THIS REVISION, BUT NOT ON THE ROW'S OWN RELEASE OF IT. (2026-09-03,
	 * operator-walk BLOCKING item) Two releases can share one revision — a
	 * rollback re-ships a build already released once before under a new tag
	 * (`hello-frontend-app` rel-66/rel-67, same commit). `onIt` alone answers
	 * "is this place running the revision" and now decides `live` on its own
	 * (see `classify()`); it does NOT answer "is this place running the row's
	 * own HEADLINE release of it" — `2.67.0-67`, the release `service.rank`
	 * and `service.label` both name. `onOwnRelease` is that second, narrower
	 * question: true only when `slot.currentRank === service.rank`, i.e. this
	 * place is on the EXACT release the row is named for, not merely the same
	 * commit under an older tag. A `live` slot with `onOwnRelease: false` is
	 * the deviation this row's "release-line clause" exists to name — see
	 * `releaseSplit()`.
	 */
	onOwnRelease: boolean;
	/**
	 * WHY IT HAS NOT ARRIVED — named ONLY from the field that establishes it.
	 *
	 * `promotionBlock().blockingGates` is a real gate list or it is empty; when
	 * it is empty this stays empty and the UI states the OBSERVABLE instead
	 * ("4 builds behind"). DESIGN.md: *"`waiting on a gate` is a lie with
	 * better grammar."*
	 */
	blockingGates: string[];
	/**
	 * THE SAME GATES, SPLIT BY WHAT WOULD CLEAR THEM — `promotionBlock`'s own
	 * structural split, carried through instead of thrown away.
	 *
	 * A live UX critique found this page rendering `waiting on ghd-p2fld,
	 * schedule-gate-nwm62`: two generated object names, no type, no owner, no
	 * clear time, while the rollout detail page three clicks away says *"will
	 * be allowed in 2d 1h"*. The split is already computed and it is exactly
	 * the missing distinction:
	 *
	 *   · `awaitingApproval` — the gate published an allow-list and this build
	 *     is not on it. Only a PERSON (or an external system) changes that.
	 *   · `notPassing` — no allow-list, simply not passing. Time- or
	 *     condition-bounded: a schedule window, a health check. It clears on
	 *     its own, and `api/schedules.ts` can say when.
	 *
	 * It is STRUCTURAL, never name-based: gate names like `schedule-gate-q25wv`
	 * are generated and must not be pattern-matched.
	 */
	awaitingApprovalGates: string[];
	notPassingGates: string[];
	/**
	 * IS THIS BUILD EVEN IN THE RUNNING HERE?
	 *
	 * `status.releaseCandidates` is the controller's own answer to *"what could
	 * this rollout deploy next"*. A build that is not on it is not something the
	 * gates are refusing — it is a build the rollout was never going to take,
	 * because nine newer ones sit in front of it.
	 *
	 * THIS EXISTS BECAUSE THE PAGE WAS NAMING A CAUSE FROM THE WRONG EVIDENCE.
	 * `promotionBlock` answers a question about the rollout's NEWEST candidate,
	 * and the page attached its gate list to whatever revision was on screen. On
	 * a never-deployed build nine steps back the page rendered *"blocked from
	 * going further — a deployment window is closed"*, which is true of the
	 * rollout and false of this build. `DESIGN.md`: *"`waiting on a gate` is a
	 * lie with better grammar."*
	 */
	candidate: boolean;
	/** The tag a promote would deploy here, or null when no promote is legal. */
	promoteTag: string | null;
	/** Namespace / name / cluster of the rollout serving this slot. */
	rolloutRef: { namespace: string; name: string; cluster: string } | null;
};

export type CoverageBucket = {
	key: CoverageKey;
	/** The bucket's name, as printed on its card and in the bar's tooltip. */
	title: string;
	/** One line saying what the bucket MEANS. Concept 07's card anatomy. */
	description: string;
	slots: CoverageSlotVM[];
};

export type RevisionCoverage = {
	/** Slots running this build right now, healthy or not. The hero numerator. */
	liveCount: number;
	/** Every slot belonging to a service that ships this build. The denominator. */
	totalCount: number;
	/** Non-empty buckets only, in `COVERAGE_ORDER`. Bar segments and cards both. */
	buckets: CoverageBucket[];
	/**
	 * CAN THIS BUILD STILL ARRIVE ANYWHERE?
	 *
	 * The predicate `coverageFill` uses to decide whether `Not yet` is still an
	 * adverse fact or merely an old one — see the block above `coverageFill`.
	 *
	 * ⚠️ IT WAS `liveCount > 0` AND THAT WAS A PROXY, NOT THE QUESTION. The
	 * colour audit was right that a build every environment has rolled past
	 * should not paint a large amber segment, and it reached for the only signal
	 * available at the time. `candidate` is now available and it IS the
	 * question: `status.releaseCandidates` is the controller's own list of what
	 * a place could deploy next, so a build on it can still arrive there by
	 * definition.
	 *
	 * The proxy failed in exactly one direction, and `RepoLedger.pending` made
	 * that case reachable: a build that has NEVER been deployed but is newer
	 * than what three environments are running is live in zero places, is a
	 * legal candidate in all three, and is held there by a gate. Under the old
	 * predicate its whole bar went gray — "this build is nowhere and that is
	 * settled" — while the banner above it said a schedule window opens in 1d
	 * 3h. Two objects on one page disagreeing about the same fact.
	 *
	 * The audit's own case is unaffected: a build everything has rolled past
	 * appears on nobody's candidate list, so it still takes the gray.
	 */
	reachable: boolean;
};

/**
 * ⭐ THE NOVICE TEST OWNS THESE FIVE STRINGS.
 *
 * From the human: *"Key point of good UX is that it draws people in where
 * necessary so that they don't need to be an expert in the tool to know how to
 * use it."* The old names were `Live here` / `Moved ahead` / `Not yet` /
 * `Can't place` — four phrases that only parse once you already hold the model
 * of a build moving along a release line. They are the bar's only explanation,
 * on both revision pages, so every one of them had to survive a reader who has
 * never opened kuberik.
 *
 * Each is now a complete predicate about the build the page is about, in the
 * present tense, with no product noun in it: `Running it now`, `Failing`,
 * `Already moved on`, `Not here yet`, `On a different line`. The DESCRIPTION is
 * the sentence the card prints under its list, and it now says WHO/WHAT rather
 * than restating the title in other words.
 */
const TITLE: Record<CoverageKey, string> = {
	live: 'Running it now',
	failing: 'Failing',
	ahead: 'Already moved on',
	notYet: 'Not here yet',
	unplaceable: 'On a different line'
};

const DESCRIPTION: Record<CoverageKey, string> = {
	live: 'These are running this build right now.',
	failing: 'This build is deployed here, and the deploy is not healthy.',
	ahead: 'These have already deployed a newer build, so this one is behind them.',
	notYet: 'This build has not been deployed here yet.',
	unplaceable: 'These follow a different release line, so this build has no position against what they run.'
};

/**
 * ⭐ THE FILL — AND WHY EACH BUCKET HAS THE COLOUR IT HAS.
 *
 * From the human, about the bar on the revision pages: *"i also don't know why
 * we're using this color."* That is the correct reading of what was here. Every
 * value below used to be borrowed from whatever object happened to be nearby,
 * and the borrowing was made twice on the SAME bucket:
 *
 *   1. `live` was `gray-500` — lifted from `/apps`'s `STATUS_DOT_CLASS`, where
 *      it means `onNewest`, a RANK verdict.
 *   2. Then `live` was `#426d64` — the `newest` CHIP's quiet mint. Also a rank
 *      value. The second fix repeated the first fix's category error one step
 *      over: `Running it now` is not a position on a ladder, it is `Succeeded`,
 *      and its own sibling bucket `Failing` is `Failed`. A teal that the reader
 *      meets elsewhere on the word `newest` cannot also be the product's word
 *      for "deployed and healthy" — that is two meanings on one value, which is
 *      exactly what makes a colour unreadable.
 *
 * THE RULE THE FIVE VALUES NOW OBEY, and every value is one this product
 * already spends somewhere it means the same thing:
 *
 *   · `live` — **the product's health green, `green-700` / `green-400`.** It is
 *     the fill `DeploymentPipelineCard` paints a DONE stage with on the rollout
 *     detail page — the page the human calls beautiful — and the ink
 *     `ResourcesCard`, `HealthChecksCard` and `/environments` use for a healthy
 *     thing. The bucket means "this build is deployed here and it is not
 *     failing", which is the same sentence at fleet scale. Nothing is invented
 *     and nothing is borrowed across axes.
 *   · `failing` — red, unchanged. Red is the adverse hue and this is the one
 *     adverse bucket.
 *   · `ahead` — neutral gray. A place that has moved to a newer build is not
 *     adverse and is not about this build. Drift is the normal state of a
 *     promotion pipeline (`DESIGN-INTENT.md`), so it takes no hue.
 *   · `notYet` — ⛔ **NO LONGER AMBER, AND IT IS DRAWN HOLLOW.** Amber is
 *     `stuck` and nothing else. "This build has not been deployed here yet" is
 *     the ordinary state of a pipeline, not an alarm, and the product already
 *     said so in the object 20px away: `BuildStateMark` gives `notYet`
 *     `tone-mute` and its comment reads *"notYet and ahead take NO colour …
 *     amber belongs to stuck."* The bar and the glyph beside it were disagreeing
 *     about whether the same fact was adverse. There is no honest hue for
 *     "absent", so it takes none — it takes ABSENCE OF FILL, a 1px outlined
 *     cell on the page ground. That is the one distinction the bar actually
 *     needs and it costs zero colour: `live`/`failing`/`ahead` are places
 *     something FILLS, `notYet` is the part of the fleet nothing has filled.
 *   · `unplaceable` — the faintest neutral. It is an admission that no
 *     comparison exists; an admission has no hue.
 *
 * WHAT THIS DELETES. The `reachable` downgrade below existed only to stop a
 * large amber segment appearing on every rolled-past revision — the colour
 * audit measured 29 such rows on `/versions`, each drawing a mark louder than
 * the product's own `stuck` alarm. With amber gone from this table the defect
 * is gone by construction, so the downgrade is a no-op kept only so the two
 * call sites keep one signature.
 *
 * ADVERSITY IS STILL THE HIGHEST CHROMA IN THE OBJECT (DESIGN.md, "THE FIELD
 * CEILING"): red is the only chromatic-adverse value, `live`'s green sits below
 * it, and everything else is achromatic. The bar's loudest pixel is still the
 * segment that wants a person.
 */
export const COVERAGE_FILL: Record<CoverageKey, string> = {
	// ⚠️ THE DARK STEP IS `green-600`, NOT THE `green-400` THE GLYPHS USE, AND
	// THAT IS A FIELD-vs-INK DECISION. `green-400` is the right INK on a dark
	// card — a 16px tick needs the lightness to carry. Measured as a FILL at
	// 1216 × 26 on the dark theme it is a neon slab that out-shouts everything
	// on the page including the brand mark. `green-600` is the same hue two
	// steps down, still unmistakably the health green, and it is the only
	// value in this table that differs between ink and fill.
	live: 'bg-green-700 dark:bg-green-600',
	failing: 'bg-red-700 dark:bg-red-500',
	ahead: 'bg-gray-300 dark:bg-gray-600',
	// THE TRACK. Faintest fill in the object, because this is the part of the
	// fleet the build has NOT reached — the bar visibly stopping short is the
	// strongest statement of that, and it is the reading a proportional bar
	// already carries without being taught.
	//
	// ⛔ AND IN DARK IT NEEDS THE EDGE, BECAUSE THE FILL IS THE CARD.
	// (2026-09-02, measured on the running page: the cell resolved to
	// `oklch(0.278 0.033 256.848)` and `Card`'s own `dark:bg-gray-800` ground
	// resolved to `oklch(0.278 0.033 256.848)` — dE00 **0.0**. A `5 of 6` lead
	// drew FIVE countable cells in dark and six in light, so the denominator
	// the cells exist to carry was missing in exactly one theme.) This is the
	// same defect `COVERAGE_SWATCH` already names one table down — *"it borrows
	// a border only because gray-100 at 12px on a white card has no edge at
	// all"* — one theme over and at 26px, and it takes the SAME VALUE, so the
	// swatch and the segment stay one encoding. Light is untouched: gray-100 on
	// white is faint by design and has always been visible.
	notYet: 'bg-gray-100 dark:border dark:border-gray-600 dark:bg-gray-800',
	// HOLLOW. An outlined cell with no fill is the one shape that says "there
	// is a place here and no answer for it" — which is exactly what this
	// bucket admits. It is also the rarest bucket, so the busiest treatment
	// costs the least.
	unplaceable: 'bg-transparent border border-gray-400 dark:border-gray-500'
};

/**
 * ⚠️ `notYet` IS ONLY ADVERSE WHILE THE BUILD CAN STILL ARRIVE (2026-08-27,
 * colour audit §8).
 *
 * The rule above says amber is the one crossing — *"the build is absent AND
 * someone may need to act, so adversity wins"*. The second half of that
 * sentence is FALSE on a revision that is live nowhere: a build every
 * environment has already rolled past will never reach the places it has not
 * reached, so `not yet` there means "absent and nobody will ever act".
 *
 * Measured on `/versions` at 1440 before this change: the list rendered **29
 * `rolled past everywhere` rows against 19 with a live place**, and every
 * rolled-past row drew a large amber segment — so the loudest mark on the page
 * (202.9, above the `stuck` alarm chip anywhere in the product) was a bar
 * segment meaning "this build is old". A page whose top eight marks are seven
 * amber segments and one red one reads as a list of alarms.
 *
 * So an unreachable `notYet` takes `ahead`'s gray, which is the bucket it is
 * now semantically a sibling of: both mean "this build is not here and that is
 * settled". FIELD CEILING §1 still holds on the rows that keep the amber —
 * they are exactly the rows that still have a live or failing place, i.e. the
 * ones where an adverse segment is the loudest pixel for a reason.
 *
 * ZERO NEW COLOUR VALUES: it is `ahead`'s existing pair.
 */
export function coverageFill(key: CoverageKey, _reachable = true): string {
	return COVERAGE_FILL[key];
}

export function coverageSwatch(key: CoverageKey, _reachable = true): string {
	return COVERAGE_SWATCH[key];
}

/**
 * The swatch on a bucket card and in the list's key IS the bar's own fill, at
 * 12px. No border and no second palette: a legend that is not the same value as
 * the thing it explains is a second encoding to keep in sync. `unplaceable` is
 * the one exception — `gray-100` on a white card has no edge at all, so it
 * borrows a 1px `gray-300` perimeter, which is ink on ~48px rather than area.
 */
export const COVERAGE_SWATCH: Record<CoverageKey, string> = {
	live: 'bg-green-700 dark:bg-green-600 border-transparent',
	failing: 'bg-red-700 dark:bg-red-500 border-transparent',
	ahead: 'bg-gray-300 dark:bg-gray-600 border-transparent',
	// The swatch is the bar's own treatment at 12px, so the two neutral
	// buckets keep the bar's own distinction: `notYet` is the faint TRACK (it
	// borrows a border only because gray-100 at 12px on a white card has no
	// edge at all), `unplaceable` is HOLLOW. A swatch drawn in a value the
	// segment does not use is a second encoding to keep in sync.
	notYet: 'bg-gray-100 border-gray-300 dark:bg-gray-800 dark:border-gray-600',
	unplaceable: 'bg-transparent border-gray-400 dark:border-gray-500'
};

const DOT: Record<string, string> = {
	fail: 'bg-red-700 dark:bg-red-500',
	stuck: 'bg-amber-500 dark:bg-amber-400',
	pending: 'bg-gray-200 dark:bg-gray-700',
	deploying: 'bg-blue-700 dark:bg-blue-400',
	baking: 'bg-yellow-700 dark:bg-yellow-400',
	ok: 'bg-gray-500 dark:bg-gray-400'
};

// THE WORDS COME FROM `bake-status.ts` (2026-08-30). This table used to
// spell `baking` itself, which is how one state came to have two spellings
// on adjacent pages. Only the two states that are NOT a bake status —
// `stuck` and `pending` — are written here.
const WORD: Record<string, string> = {
	fail: BAKE_WORD.Failed,
	stuck: 'stuck',
	pending: 'never deployed',
	deploying: BAKE_WORD.Deploying,
	baking: BAKE_WORD.InProgress,
	ok: BAKE_WORD.Succeeded
};

type SlotState = keyof typeof DOT;

/**
 * One slot's deploy state, from the SAME fields `/apps` classifies on and in
 * the same precedence. Reused rather than re-derived: a second opinion about
 * whether a rollout is stuck is the defect `env-rank.ts` was written to close,
 * one axis over.
 */
function slotState(slot: RevisionSlot, refNow: Date, peers: RevisionSlot[]): SlotState {
	const rollout = slot.cell.rollout;
	const latest = rollout?.status?.history?.[0];
	const bake = latest?.bakeStatus || 'None';

	if (bake === 'Failed') return 'fail';

	let stuckReason = detectStuck(rollout, { now: refNow });
	if (!stuckReason) {
		for (const peer of peers) {
			if (peer === slot) continue;
			const r = detectStuckBehind(rollout, peer.cell.rollout, peer.envName, { now: refNow });
			if (r) {
				stuckReason = r;
				break;
			}
		}
	}
	if (stuckReason) return 'stuck';

	if (bake === 'Deploying') return 'deploying';
	if (bake === 'InProgress') return 'baking';
	if (!latest) return 'pending';
	return 'ok';
}

/** What this environment is running right now, in display form. */
export function runningLabel(slot: RevisionSlot): string | null {
	const v = slot.cell.rollout?.status?.history?.[0]?.version;
	if (!v) return null;
	return getDisplayVersion(v as { version?: string; revision?: string; tag: string }) || null;
}

/**
 * ⛔ `onIt` DECIDES THE BUCKET; THE RANK COMPARISON DECIDES SOMETHING ELSE.
 * (2026-09-03, operator-walk BLOCKING item — supersedes the 2026-09-02 fix
 * kept below for the measurement it recorded.)
 *
 * `onIt` is REVISION-scoped (`currentKeyOf(cell, ctx) === revision`, a
 * git-sha match): it answers "is this place running the build this ROW is
 * about", which is the row's own thesis (`/versions` keys rows by revision
 * precisely so one commit is one row). The 2026-09-02 fix made `live` depend
 * on a SECOND, narrower question too — is this place on the row's own
 * HEADLINE release of the revision (`service.rank`), not merely the same
 * commit under an older tag — and let that second question overrule the
 * first. Measured on the live cluster: `hello-frontend-app` rel-66 and
 * rel-67 share revision `9f10e494d560`; every environment ran rel-66 while
 * rel-67 (held by a contract) had landed nowhere. Gating `live` on rank
 * equality fixed the FALSE POSITIVE (`6 of 6 · fully rolled out`) by
 * introducing a FALSE NEGATIVE one bucket over: the SAME three places, which
 * genuinely run the row's revision, printed `3 of 6 places running it` and
 * were filed under `Not here yet` — an operator asking "did this reach
 * PROD?" read `Not here yet — PROD` about a place that had run this exact
 * commit for days, and went hunting a stuck deploy that did not exist.
 * Moving the false claim from one sentence to an adjacent one is not a fix.
 *
 * THE TWO QUESTIONS ARE BOTH REAL AND NEITHER MAY ANSWER FOR THE OTHER.
 * `onIt` decides the BUCKET — `live`/`failing` the moment the commit
 * matches, full stop, because that is what "running this revision" means and
 * it is the row's own denominator (`row.liveSlots`, already computed this
 * way in `revision-ledger.ts` and never wrong). The rank comparison becomes
 * `onOwnRelease` on the slot instead (below) — a fact ABOUT a `live` slot,
 * never a gate that reclassifies it out of `live`. A page that wants to say
 * "these three are on an older release of it, and the newer one is held"
 * reads `onOwnRelease` and `blockingGates`; it does not need — and must not
 * need — a bucket named `Not here yet` to say something that IS here.
 */
function classify(service: RevisionService, slot: RevisionSlot, state: SlotState): CoverageKey {
	// THE ONLY QUESTION THIS FUNCTION ANSWERS NOW: is this place running the
	// REVISION. A rank comparison against `service.rank` no longer gates it —
	// see the doc above and `onOwnRelease`, computed alongside this in the
	// caller, for the release-line question that used to live here.
	if (slot.onIt) return state === 'fail' ? 'failing' : 'live';
	if (service.rank === null || slot.currentRank === null) return 'unplaceable';
	if (slot.currentRank === service.rank) {
		// Equal rank but NOT onIt: two ladder entries collapsed to one rank —
		// the comparison resolves to nothing, so it is not rendered as one.
		return 'unplaceable';
	}
	if (slot.currentRank < service.rank) return 'ahead';
	return 'notYet';
}

export function revisionCoverage(row: RevisionRow, refNow: Date = new Date()): RevisionCoverage {
	const byKey = new Map<CoverageKey, CoverageSlotVM[]>();
	for (const k of COVERAGE_ORDER) byKey.set(k, []);

	for (const service of row.services) {
		for (const slot of service.slots) {
			const state = slotState(slot, refNow, service.slots);
			const key = classify(service, slot, state);
			// ⭐ ON THIS REVISION, BUT ON THE ROW'S OWN RELEASE OF IT? See the
			// field's own doc comment on `CoverageSlotVM.onOwnRelease`. Computed
			// for every slot, not only `live` ones, because a slot that is not
			// even `onIt` is trivially not on the row's own release either —
			// the flag stays meaningful (false) rather than undefined there.
			const onOwnRelease =
				slot.onIt && service.rank !== null && slot.currentRank === service.rank;
			// A CANDIDATE IS A BUILD THE CONTROLLER WOULD CONSIDER. Compared on the
			// TAG, which is what `allowedVersions` and `releaseCandidates` are keyed
			// on — comparing the display version makes every gate look like it
			// blocks everything (see `promotion.ts`, `gateKeyOf`).
			const candidate =
				!!slot.tag &&
				promotionCandidates(slot.cell.rollout).some(
					(c) => (c.tag ?? c.version ?? c.revision ?? '') === slot.tag
				);
			// ⭐ GATES ARE ALSO ATTRIBUTABLE ON A `live` SLOT THAT IS NOT ON ITS
			// OWN RELEASE. (2026-09-03) `notYet` used to be the only place this
			// row's evidence for "why hasn't it moved" was computed — but a
			// place on an OLDER release sharing this revision has exactly the
			// same question and the same answer available (`promotionBlock`
			// reads the rollout, not the bucket), and `classify()` no longer
			// routes it through `notYet` to get one. Everywhere else the
			// honest statement is the observable, same as before.
			const block =
				(key === 'notYet' || (key === 'live' && !onOwnRelease)) && candidate
					? promotionBlock(slot.cell.rollout)
					: null;
			const meta = slot.cell.rollout?.metadata;
			byKey.get(key)!.push({
				key,
				appName: service.appName,
				envName: slot.envName,
				envLabel: shortEnvLabel(slot.cell.theme) || slot.envName,
				slot,
				label: service.label,
				labelDiffers: service.labelDiffers,
				dotClass: DOT[state],
				statusWord: WORD[state],
				stuck: state === 'stuck',
				runs: runningLabel(slot),
				currentRank: slot.currentRank,
				revRank: service.rank,
				onOwnRelease,
				gap:
					service.rank !== null && slot.currentRank !== null
						? slot.currentRank - service.rank
						: null,
				blockingGates: block?.blocked ? block.blockingGates : [],
				awaitingApprovalGates: block?.blocked ? block.awaitingApprovalGates : [],
				notPassingGates: block?.blocked ? block.notPassingGates : [],
				candidate,
				promoteTag: slot.promoteTag,
				// WHERE THE PROBLEM ACTUALLY LIVES. Every `Not yet` row used to
				// link to `/apps/<name>` — so a DEV row and a STAGING row of the
				// same service resolved to ONE url, and the page discarded the
				// environment it had just printed. The rollout is the object the
				// gate is attached to and the page that can clear it.
				rolloutRef:
					meta?.name && meta?.namespace
						? {
								namespace: meta.namespace,
								name: meta.name,
								cluster: slot.cell.sourceCluster || ''
							}
						: null
			});
		}
	}

	const buckets: CoverageBucket[] = [];
	for (const key of COVERAGE_ORDER) {
		const slots = byKey.get(key)!;
		if (slots.length === 0) continue;
		buckets.push({ key, title: TITLE[key], description: DESCRIPTION[key], slots });
	}

	const liveCount = (byKey.get('live')!.length || 0) + (byKey.get('failing')!.length || 0);
	const stillArriving = byKey.get('notYet')!.some((s) => s.candidate);

	return {
		liveCount,
		totalCount: row.totalSlots,
		buckets,
		reachable: liveCount > 0 || stillArriving
	};
}

/**
 * The bar, at both scales, is the SAME OBJECT — so the list and the detail page
 * are one idea rather than two designs that rhyme. This is the shape both feed
 * to `CoverageBar.svelte`.
 *
 * ⛔ THE `'held'` SEGMENT IS GONE — ONE BAR, ONE FILL. (2026-09-03, direct
 * from the human, overriding design pass 7 finding #5 and the legend built
 * on top of it: *"I don't like that revisions status bars are split in
 * two."*) The same human had already rejected a segmented bar on THIS page
 * once before; splitting `live` into a green "done" slice and an orange
 * "held" slice reintroduced exactly that shape, however well-reasoned the
 * colour math behind it was. The held fact is not deleted — it still lives
 * in `buildState()`'s word (`held in N places`), in the hero rollup
 * (`6 of 6 running it · 3 held on a newer release`) and in
 * `releaseSplitSentence`'s caption — it just no longer gets a second colour
 * on the bar itself. Every place that runs the revision paints the same
 * green `live` fill, whichever release it is on.
 */
export type CoverageSegment = {
	key: CoverageKey;
	count: number;
	title: string;
	/** Carried per segment so the bar needs no second prop; see `coverageFill`. */
	reachable: boolean;
};

/**
 * ⭐ THE BUILD'S ONE-LINE ANSWER, IN WORDS A NOVICE ALREADY OWNS.
 *
 * `/versions` printed `has places left to reach`, `partly rolled past` and
 * `live everywhere it is carried`; the human named all three as strings that
 * assume the domain. They were also computed in the PAGE, so the list row's
 * word and the lead panel's word were two implementations of one sentence and
 * could drift.
 *
 * One function now, read off the same buckets the bar is drawn from, so the
 * glyph, the word and the bar cannot disagree. Every phrase is CONCRETE — it
 * carries the count it is about — because `3 places still to go` is a fact a
 * reader can check against the bar beside it and `has places left to reach` is
 * a claim they have to take on faith.
 *
 * PRIORITY IS SEVERITY, not bucket order: something failing outranks something
 * merely unfinished, which outranks something being replaced.
 */
export type BuildState = {
	key: 'failing' | 'notYet' | 'ahead' | 'held' | 'done' | 'nowhere';
	/** The row's word. Lower case: it follows a sha in running text. */
	word: string;
	/** The long form, for a `title` — same fact, room to name the unit. */
	title: string;
};

/**
 * ⛔ EVERY PLACE RUNNING THE REVISION IS NOT THE SAME CLAIM AS "FULLY ROLLED
 * OUT". (2026-09-03, operator-walk BLOCKING item) `classify()` now counts
 * `live` the moment a place is `onIt` — correct, and the fix `liveCount ===
 * totalCount` alone is not enough to say the row is DONE with: a `live` slot
 * can still be on an OLDER release than the row's own headline one, with that
 * newer release held by a gate (`onOwnRelease: false`). The live cluster's
 * exact shape — `hello-frontend-app` rel-66/rel-67 sharing one revision — is
 * `6 of 6 places running it`, and it is not "fully rolled out": the row's
 * own `2.67.0-67` has landed nowhere. `heldBehind()` below is read BEFORE the
 * `done` fallback for exactly this reason.
 */
function heldBehind(coverage: RevisionCoverage): CoverageSlotVM[] {
	return coverage.buckets.find((b) => b.key === 'live')?.slots.filter((s) => !s.onOwnRelease) ?? [];
}

export function buildState(coverage: RevisionCoverage): BuildState {
	const n = (key: CoverageKey) =>
		coverage.buckets.find((b) => b.key === key)?.slots.length ?? 0;
	const plural = (c: number) => (c === 1 ? '' : 's');

	const failing = n('failing');
	if (failing > 0)
		return {
			key: 'failing',
			word: `failing in ${failing} place${plural(failing)}`,
			title: `Deployed in ${failing} place${plural(failing)} where the deploy is not healthy`
		};

	/*
	 * BETWEEN "STILL ARRIVING" AND "BEING REPLACED", THE BIGGER NUMBER WINS.
	 *
	 * A fixed `notYet` > `ahead` order said `1 place still to go` about a build
	 * that one place had yet to take and SIX had already rolled past — true, and
	 * the opposite of what is happening to it. The larger bucket is the one the
	 * bar is mostly drawn from, so the word and the shape beside it agree.
	 * `failing` is not in this comparison: one unhealthy place outranks any
	 * amount of ordinary movement.
	 */
	const notYet = n('notYet');
	const ahead = n('ahead') + n('unplaceable');

	if (notYet > 0 && (notYet >= ahead || coverage.liveCount === 0))
		return {
			key: 'notYet',
			word: `${notYet} place${plural(notYet)} still to go`,
			title: `${notYet} place${plural(notYet)} have not deployed this build yet`
		};

	if (ahead > 0 && coverage.liveCount > 0)
		return {
			key: 'ahead',
			word: `${ahead} place${plural(ahead)} moved on`,
			title: `${ahead} place${plural(ahead)} have already deployed a newer build`
		};

	if (coverage.liveCount === 0)
		return {
			key: 'nowhere',
			word: 'not running anywhere',
			title: 'No service is running this build right now'
		};

	// ⛔ CHECKED BEFORE `done`, NOT INSTEAD OF IT — see `heldBehind`'s doc
	// above. `notYet`/`ahead` already covered the places that have not taken
	// this REVISION at all; this is the narrower remainder: places that HAVE,
	// just not under the row's own headline release of it.
	const behind = heldBehind(coverage);
	if (behind.length > 0) {
		const held = behind.some((s) => s.blockingGates.length > 0);
		return held
			? {
					key: 'held',
					word: `held in ${behind.length} place${plural(behind.length)}`,
					title: `${behind.length} place${plural(behind.length)} run this revision on an older release, and a newer one is held by a gate`
				}
			: {
					key: 'held',
					word: `${behind.length} place${plural(behind.length)} on an older release of it`,
					title: `${behind.length} place${plural(behind.length)} run this revision on an older release than the newest one carries`
				};
	}

	return {
		key: 'done',
		word: 'fully rolled out',
		title: 'Every place that can run this build is running it'
	};
}

/**
 * ⭐ THE RELEASE-LINE CLAUSE — the fact `classify()` deliberately no longer
 * folds into the coverage count. (2026-09-03, operator-walk BLOCKING item)
 * `6 of 6 places running it` answers "does this place run the revision" —
 * the coverage bar's whole job. It is silent on WHICH release each place
 * calls it, and that silence is right for the ordinary case (every live
 * place is on the row's own headline release, nothing to say) and wrong the
 * moment it is not. This groups the `live` bucket's `onOwnRelease: false`
 * slots — same commit, older release — by what they actually run, so the
 * page can say the missing half as its OWN sentence: *"3 of them on
 * 2.66.0-66; 2.67.0-67 is held in dev, staging and prod."* Empty when every
 * live place already carries the row's own release — the common case.
 */
export type ReleaseSplitLine = {
	/** What these places actually run — an OLDER release under this revision. */
	behindLabel: string;
	count: number;
	/** Environment labels, ready to join into prose. */
	envLabels: string[];
	/** The row's own headline release for this service — what they have not taken. */
	aheadLabel: string;
	/**
	 * True when a gate is refusing every candidate ahead at EVERY one of
	 * these places — `false` does not mean nothing is holding them, only that
	 * this module found no gate evidence for at least one, and `DESIGN.md`
	 * forbids naming a mechanism it cannot evidence.
	 */
	held: boolean;
};

export function releaseSplit(coverage: RevisionCoverage): ReleaseSplitLine[] {
	const live = coverage.buckets.find((b) => b.key === 'live');
	if (!live) return [];
	const behind = live.slots.filter((s) => !s.onOwnRelease && s.runs);
	if (behind.length === 0) return [];
	const byKey = new Map<string, CoverageSlotVM[]>();
	for (const s of behind) {
		const key = `${s.runs}\u0000${s.label}`;
		const list = byKey.get(key) ?? [];
		list.push(s);
		byKey.set(key, list);
	}
	return [...byKey.values()].map((slots) => ({
		behindLabel: slots[0].runs!,
		count: slots.length,
		envLabels: slots.map((s) => s.envLabel),
		aheadLabel: slots[0].label,
		held: slots.every((s) => s.blockingGates.length > 0)
	}));
}

export function coverageSegments(coverage: RevisionCoverage): CoverageSegment[] {
	// ⛔ NO PER-BUCKET SPECIAL CASE. (2026-09-03, direct from the human —
	// see this function's own type doc.) Every bucket, `live` included,
	// draws as ONE segment at its own fill. A `live` slot on an older
	// release still paints plain `live` green; the fact that a newer
	// release is held lives in the WORD (`buildState()`), not in a second
	// colour carved out of this segment.
	return coverage.buckets.map((b) => ({
		key: b.key,
		count: b.slots.length,
		title: b.title,
		reachable: coverage.reachable
	}));
}
