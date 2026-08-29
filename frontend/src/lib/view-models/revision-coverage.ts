import type { RevisionRow, RevisionService, RevisionSlot } from './revision-ledger';
import { detectStuck, detectStuckBehind, getDisplayVersion } from '$lib/utils';
import { promotionBlock } from './promotion';
import { shortEnvLabel } from '$lib/environment-theme';

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
	/** The tag a promote would deploy here, or null when no promote is legal. */
	promoteTag: string | null;
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
	 * CAN THIS BUILD STILL ARRIVE ANYWHERE? False when it is live in no place
	 * at all — every environment that ships it has rolled past. It is the
	 * predicate `coverageFill` uses to decide whether `Not yet` is still an
	 * adverse fact or merely an old one; see the block above `coverageFill`.
	 */
	reachable: boolean;
};

const TITLE: Record<CoverageKey, string> = {
	live: 'Live here',
	failing: 'Failing on it',
	ahead: 'Moved ahead',
	notYet: 'Not yet',
	unplaceable: 'Can’t place'
};

const DESCRIPTION: Record<CoverageKey, string> = {
	live: 'running this build now',
	failing: 'deployed here, and the deploy is not healthy',
	ahead: 'already on a newer build — rolled past this one',
	notYet: 'the promotion has not reached here yet',
	unplaceable: 'the release line does not place this build against what is running'
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

const WORD: Record<string, string> = {
	fail: 'deploy failed',
	stuck: 'stuck',
	pending: 'never deployed',
	deploying: 'deploying',
	baking: 'baking',
	ok: 'deploy succeeded'
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
			const block = key === 'notYet' ? promotionBlock(slot.cell.rollout) : null;
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
				promoteTag: slot.promoteTag
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

	return { liveCount, totalCount: row.totalSlots, buckets, reachable: liveCount > 0 };
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

export function coverageSegments(coverage: RevisionCoverage): CoverageSegment[] {
	return coverage.buckets.map((b) => ({
		key: b.key,
		count: b.slots.length,
		title: b.title,
		reachable: coverage.reachable
	}));
}
