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
 * THE FILL — CHROMATIC MEANS "ABOUT THIS BUILD"; ACHROMATIC MEANS "NOT ABOUT
 * THIS BUILD". Lightness carries presence; chroma carries adversity.
 *
 * THIS PALETTE WAS GRAY ONCE AND THAT WAS A MISREAD, TWICE OVER. The first
 * build painted all five buckets in their status hue at the `-100` FIELD step,
 * measured `green-100` against `gray-200` at 8px, found them indistinguishable,
 * and concluded — correctly for that family — that no legible green fits the
 * `area × chroma` ceiling, since a ~25,000px² bar under 10x the `alarm` chip's
 * ~159 ink units caps the fill at OKLCH chroma 0.078, below `green-200`. It
 * then shipped `live` as `gray-500`. Both steps were wrong:
 *
 *   1. THE SEARCH ONLY LOOKED AT LIGHT TINTS. At 8px against `gray-300`, the
 *      channel that separates two fills is LIGHTNESS, not chroma — which is the
 *      same argument that module already makes for its two grays. A DARK,
 *      LOW-CHROMA green is legible at 8px at a chroma the ceiling never
 *      threatens. The quiet mint this product already owns measures
 *      **L 0.539 / C 0.0384 / H 179.8** against `gray-500`'s
 *      **L 0.551 / C 0.0267 / H 264.3**: ΔL is 0.012, so it is a DROP-IN for
 *      the gray in the lightness hierarchy that made the bar readable, and it
 *      moves 84° of hue and 1.4x of chroma. Nothing about the presence system
 *      changes; only the hue channel stops saying "gray".
 *   2. THE CEILING IT INVOKED IS SATISFIED ANYWAY. Measured on the shipped
 *      detail bar at 1440: 976 x 26 = 25,376px², `live` at 14/15 is ~23,600px²,
 *      and 23,600 x 0.0384 = **906 ink units — 5.7x the alarm, inside the same
 *      10x bound the gray decision was justified by.** The arithmetic never
 *      ruled out a chromatic `live`; it ruled out a chromatic `-100` TINT.
 *
 * AND THE SUBSTITUTION WAS ON THE WRONG AXIS. `gray-500` came from `/apps`'s
 * `STATUS_DOT_CLASS`, where it means `onNewest` — a RANK verdict. `Live here`
 * is not a rank verdict; it is `Succeeded`, and its own sibling bucket
 * `Failing on it` is `Failed`. Painting `Failed` red and `Succeeded` gray in
 * one object is half an encoding. `/environments` already refuses to do that:
 * `EnvHealthStrip` draws a healthy app as a `green-700` dash at SIX pixels
 * tall, shipped, on the page next door.
 *
 * THE RULE THE FIVE VALUES NOW OBEY, and it is readable straight off the bar:
 *
 *   · CHROMATIC = this build is here. `live` mint, `failing` red.
 *   · ACHROMATIC = this build is not here. `ahead` and `unplaceable` gray.
 *   · `notYet` is the one crossing: the build is absent AND someone may need to
 *     act, so adversity wins and it keeps amber.
 *
 * WITHIN THE OBJECT, ADVERSITY IS ALWAYS THE HIGHER CHROMA — the invariant that
 * replaces a total-ink cap on a field (see DESIGN.md, "THE FIELD CEILING").
 * Measured: `live` 0.0503 against `notYet` 0.1728 (**3.4x**) and `failing`
 * 0.2086 (**4.1x**); dark, 0.0495 against 0.1712 (3.5x) and 0.2373 (4.8x). A
 * bar that is nine-tenths live still has its loudest PIXEL in the segment that
 * wants a person.
 *
 * ZERO NEW COLOUR VALUES. The mint is `#426d64` / `#83b0a8`, the pair the
 * `newest` chip owns, and `ExposureBar` already paints its newest-build segment
 * with it — which is the same sentence this bucket says ("the part of the whole
 * that is on the build in question"), so the two proportional bars in this
 * product now agree on their one shared segment instead of disagreeing.
 * `failing`, `notYet` and the two grays are unchanged.
 */
export const COVERAGE_FILL: Record<CoverageKey, string> = {
	live: 'bg-[#426d64] dark:bg-[#83b0a8]',
	failing: 'bg-red-700 dark:bg-red-500',
	ahead: 'bg-gray-300 dark:bg-gray-600',
	notYet: 'bg-amber-500 dark:bg-amber-400',
	unplaceable: 'bg-gray-100 dark:bg-gray-800'
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
export function coverageFill(key: CoverageKey, reachable = true): string {
	if (key === 'notYet' && !reachable) return COVERAGE_FILL.ahead;
	return COVERAGE_FILL[key];
}

export function coverageSwatch(key: CoverageKey, reachable = true): string {
	if (key === 'notYet' && !reachable) return COVERAGE_SWATCH.ahead;
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
	live: 'bg-[#426d64] dark:bg-[#83b0a8] border-transparent',
	failing: 'bg-red-700 dark:bg-red-500 border-transparent',
	ahead: 'bg-gray-300 dark:bg-gray-600 border-transparent',
	notYet: 'bg-amber-500 dark:bg-amber-400 border-transparent',
	unplaceable: 'bg-gray-100 border-gray-300 dark:bg-gray-800 dark:border-gray-600'
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

function classify(service: RevisionService, slot: RevisionSlot, state: SlotState): CoverageKey {
	if (slot.onIt) return state === 'fail' ? 'failing' : 'live';
	// A rank is a position on the service's OWN ladder, so both ends of the
	// comparison have to be placed on it before a direction can be claimed.
	if (service.rank === null || slot.currentRank === null) return 'unplaceable';
	if (slot.currentRank < service.rank) return 'ahead';
	if (slot.currentRank > service.rank) return 'notYet';
	// Equal rank but not on it: two ladder entries collapsed to one rank. The
	// comparison resolves to nothing, so it is not rendered as one.
	return 'unplaceable';
}

export function revisionCoverage(row: RevisionRow, refNow: Date = new Date()): RevisionCoverage {
	const byKey = new Map<CoverageKey, CoverageSlotVM[]>();
	for (const k of COVERAGE_ORDER) byKey.set(k, []);

	for (const service of row.services) {
		for (const slot of service.slots) {
			const state = slotState(slot, refNow, service.slots);
			const key = classify(service, slot, state);
			// A CANDIDATE IS A BUILD THE CONTROLLER WOULD CONSIDER. Compared on the
			// TAG, which is what `allowedVersions` and `releaseCandidates` are keyed
			// on — comparing the display version makes every gate look like it
			// blocks everything (see `promotion.ts`, `gateKeyOf`).
			const candidate =
				!!slot.tag &&
				promotionCandidates(slot.cell.rollout).some(
					(c) => (c.tag ?? c.version ?? c.revision ?? '') === slot.tag
				);
			// Gates are only attributable where the build is actually in the
			// running. Everywhere else the honest statement is the observable.
			const block = key === 'notYet' && candidate ? promotionBlock(slot.cell.rollout) : null;
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
	key: 'failing' | 'notYet' | 'ahead' | 'done' | 'nowhere';
	/** The row's word. Lower case: it follows a sha in running text. */
	word: string;
	/** The long form, for a `title` — same fact, room to name the unit. */
	title: string;
};

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

	return {
		key: 'done',
		word: 'fully rolled out',
		title: 'Every place that can run this build is running it'
	};
}

export function coverageSegments(coverage: RevisionCoverage): CoverageSegment[] {
	return coverage.buckets.map((b) => ({
		key: b.key,
		count: b.slots.length,
		title: b.title,
		reachable: coverage.reachable
	}));
}
