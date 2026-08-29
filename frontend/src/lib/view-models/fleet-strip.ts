/**
 * ⛔ `FleetStrip.svelte` WAS DELETED 2026-08-27. This view-model was NOT.
 *
 * The component drew the fleet as runs of marks separated by gaps — the third
 * and last graphic form of `/apps`'s criterion-1 column, and the third one the
 * human rejected (*"fleet by build is both not stylistically concise with the
 * rest of dashboard and is still not clear what it shows"*). The full argument
 * for the cut is at the Fleet cell in `src/routes/apps/+page.svelte`.
 *
 * EVERYTHING BELOW STILL SHIPS. `buildFleetStrip` is what computes `spread`,
 * `onHead`, `deployed`, `diverged` and `pending` — the numbers `/apps` now
 * prints as a `count` chip and a caption — and `fleetCaption` writes that
 * caption. `groups` and `marks` are still built and still unit-tested; they are
 * simply not rendered. Do NOT strip them out to "clean up": they are the
 * grouping logic that decides what `spread` MEANS, and the tests that pin it
 * are the tests that pin the chip.
 */
/**
 * THE FLEET STRIP — one app's fleet as ONE MARK PER ENVIRONMENT, grouped by
 * the build each one runs.
 *
 * WHAT QUESTION IT ANSWERS. `/apps` criterion 1 — *"which apps' fleets are
 * consistent?"*, phrased in the IA proposal as **"dots one colour =
 * converged"**. This is that object, with the one channel it may not use
 * removed.
 *
 * ── WHY THIS AND NOT THE 12-SLOT RULER IT REPLACES ──────────────────────
 *
 * The predecessor (`fleet-ruler.ts`, deleted) was a HISTOGRAM OF THE BUILD
 * AXIS: twelve fixed stations of rank distance, bar height = how many
 * environments stood on each. It is a correct chart and it lost on four
 * measurements, all of which come from the same root — **it draws the axis,
 * not the fleet.**
 *
 *   1. IT IS MOSTLY EMPTY, AND THE EMPTINESS IS THE PART THAT SCALES.
 *      A converged fleet occupies 1 of 12 stations. On the live cluster —
 *      four apps, three environments, mostly converged — 92% of the object
 *      is the absence of data. Two rounds were spent making that 92% look
 *      deliberate (round one gave every empty slot a track, round two
 *      darkened one of them) and the verdict on both was *"barely
 *      improved"*, which is what happens when the fix is applied to the
 *      empty part. The strip is 100% marks: N environments, N marks.
 *
 *   2. THE SAME FACT DREW TWO DIFFERENT PICTURES AT TWO FLEET SIZES.
 *      Bar height was `count / max`, so "exactly one environment is behind"
 *      rendered as a HALF-HEIGHT bar on a 3-environment app (1 of 2 on head)
 *      and as a 30% STUB on a 13-environment one (1 of 12 on head). An object
 *      whose picture changes character with N cannot be scanned down a
 *      column of 50 rows. On the strip, one environment behind is one mark
 *      standing apart — the same picture at N=3 and at N=13.
 *
 *   3. IT COULD NOT NAME AN ENVIRONMENT. A column was a bucket of
 *      environments and took the WORST tone of the ones in it, so a stuck
 *      region and a healthy one sharing a build shared one amber bar. A mark
 *      is one environment: the status hue names it, and the `title` names it.
 *
 *   4. IT HAD TO BE TAUGHT. Position on a rank axis means nothing until a
 *      reader has been told that x is distance-from-head and that head is
 *      the right end. That teaching was a footer legend drawn from a DUMMY
 *      RULER; the human deleted it (*"it could be better designed instead of
 *      explaining it with the dummy graphic"*) and the replacement was a
 *      darker station plus a chip — teaching by furniture. The strip's rules
 *      are about the marks themselves: one mark is one environment, marks
 *      that touch run the same build, a tall mark is on the head build.
 *
 * WHAT THE RULER DID BETTER, AND WHERE THAT WENT. Its x-position carried
 * DISTANCE — `−4` was four stations left of head. The strip carries the
 * ORDER (groups run newest to oldest) but not the metric distance. That is
 * a deliberate trade: distance is not criterion 1, and the row already
 * states it twice in words — the lede names the worst un-boxed environment
 * and its exact lag (`PROD-SA-EAST is 4 builds behind`), and each mark's
 * `title` carries its own. Consistency is what had no other carrier.
 *
 * ── THE ENCODING ────────────────────────────────────────────────────────
 *
 *   POSITION / PROXIMITY — the whole answer to criterion 1. Environments
 *   running the same build are drawn as an unbroken run; a gap means the
 *   build changes. One run = converged. Four runs = four builds. Counting
 *   gaps is counting the fleet's fragmentation, which is exactly the sort's
 *   first tiebreak.
 *
 *   ORDER — the head build's group is ALWAYS first, then the rest newest to
 *   oldest, then the environments whose build has no place on the ladder,
 *   then the ones that have never deployed. Reading left to right is reading
 *   backwards through history.
 *
 *   HEIGHT — two values, not a ramp. Full height = runs the head build;
 *   short = does not. This is what separates a fleet that has converged ON
 *   HEAD from one that has converged four builds back, which are the same
 *   shape and very different facts. It is deliberately BINARY: an ordinal
 *   height (or colour) ramp over rank is the `heat(rank)` encoding
 *   `DESIGN.md` measured and killed (dE00 1.70-1.92 against a ~2.3 JND).
 *
 *   THE HEAD SLOT IS DRAWN EVEN WHEN IT IS EMPTY. If no environment is on
 *   the head build the strip opens with ONE hollow full-height mark. That
 *   is the ruler's `HEAD_TRACK` idea — a rank axis needs a visible origin
 *   even with nothing standing on it — reduced from eleven empty stations
 *   to one, and it is also what guarantees a full-height reference is on
 *   screen so the short marks can be READ as short.
 *
 *   LENGTH — the strip is as long as the fleet is big. `/apps` prints no
 *   environment count anywhere (it was dropped as a restatement of the
 *   caption's denominator); the strip restores it for free, and the ruler
 *   could not carry it at all: 12 stations wide whether the app has 3
 *   environments or 30.
 *
 *   COLOUR — deviation only, and ZERO new values. A settled deploy is the
 *   `gray-500 / gray-400` pair `/apps` spent on a settled status dot before
 *   that dot was deleted (2026-08-27); `FleetStrip`'s `MARK` is the only
 *   owner of the mapping now. A mark takes a status hue only when its
 *   environment is
 *   failing, stuck, deploying or baking. Per-sha colour — the categorical
 *   `VERSION_PALETTE` that `DESIGN.md` names as the single biggest
 *   contributor to "too many colors" — is NOT how "all one colour" is
 *   spelled here. The proposal's own test is same-versus-different, and
 *   proximity answers same-versus-different without naming which build.
 */

/** Deploy state of one environment. Same vocabulary as `/apps`'s `CellState`. */
export type FleetTone = 'settled' | 'fail' | 'stuck' | 'deploying' | 'baking' | 'pending';

/** Worst first, for the group tooltip's summary. */
const TONE_SEVERITY: FleetTone[] = ['fail', 'stuck', 'deploying', 'baking', 'settled', 'pending'];

export type FleetEnv = {
	/** Unique within the app. */
	key: string;
	/** What the tooltip names. `DEV`, `US-EAST`. */
	label: string;
	/**
	 * THE BUILD THIS ENVIRONMENT RUNS. This is the grouping key and it is the
	 * only honest one: consistency is "the same build", not "the same
	 * distance". Empty or null means nothing is deployed here.
	 */
	version: string | null;
	/**
	 * Builds behind head on the app's ONE ladder (`env-rank.ts`), or null when
	 * the comparison did not resolve. Null is NOT zero.
	 */
	rank: number | null;
	tone: FleetTone;
	/** Running a build on no environment's release line. */
	diverged: boolean;
};

export type FleetMark = {
	key: string;
	label: string;
	tone: FleetTone;
	/** Runs the head build. Drives the height channel. */
	onHead: boolean;
	/** Nothing is deployed here at all. */
	pending: boolean;
	/** The placeholder that stands in for an EMPTY head slot. */
	placeholder: boolean;
	/** One line, for the mark's own `title`. Never the sole carrier. */
	title: string;
};

export type FleetGroup = {
	/** Stable key for the `{#each}`. */
	key: string;
	/** The build every mark in this group runs. Null = never deployed. */
	version: string | null;
	/** Distance from head, or null when it does not resolve. */
	rank: number | null;
	diverged: boolean;
	onHead: boolean;
	/** True when this group absorbed the builds past `FLEET_MAX_GROUPS`. */
	folded: boolean;
	marks: FleetMark[];
};

export type FleetStripVM = {
	groups: FleetGroup[];
	/** Environments, i.e. marks drawn. The strip's length. */
	total: number;
	/** Environments with something deployed (`total` minus never-deployed). */
	deployed: number;
	/** Rank resolved AND on a release line — the ones an `−N` is true of. */
	placed: number;
	onHead: number;
	behind: number;
	diverged: number;
	/** Never deployed. */
	pending: number;
	/** Deployed, but the rank did not resolve — NOT the same as zero. */
	unknown: number;
	/** `diverged + pending + unknown` — everything with no distance. */
	unplaced: number;
	/**
	 * DISTINCT BUILDS across the environments that have deployed. **1 = the
	 * fleet is consistent**, which is criterion 1 as a number. Counts
	 * diverged and unrankable builds too: an environment off the release line
	 * is not agreeing with anybody, and the ruler's `spread` excluded it,
	 * which understated exactly the worst fleets.
	 */
	spread: number;
	/** The worst rank actually resolved, for sorting. */
	worstRank: number;
};

/**
 * Above this the group GAPS alone stop fitting the 96px column: 8px per gap
 * plus a 2px floor per mark puts the bound at 9 groups over 13 environments.
 * Older builds beyond it fold into one final run, flagged `folded` so the
 * component can say so — `DESIGN.md` forbids truncating silently, and the
 * caption states the true build count regardless.
 */
export const FLEET_MAX_GROUPS = 8;

function worstTone(a: FleetTone, b: FleetTone): FleetTone {
	return TONE_SEVERITY.indexOf(a) <= TONE_SEVERITY.indexOf(b) ? a : b;
}

function distanceWord(rank: number | null, diverged: boolean, pending: boolean): string {
	if (pending) return 'never deployed';
	if (diverged) return 'on no environment’s release line';
	if (rank === null) return 'build is on no release list — distance unknown';
	if (rank === 0) return 'on the head build';
	return `${rank} build${rank === 1 ? '' : 's'} behind head`;
}

const TONE_WORD: Record<FleetTone, string> = {
	fail: 'deploy failed',
	stuck: 'stuck',
	deploying: 'deploying',
	baking: 'baking',
	settled: 'deploy succeeded',
	pending: 'never deployed'
};

export function buildFleetStrip(
	envs: readonly FleetEnv[],
	maxGroups = FLEET_MAX_GROUPS
): FleetStripVM {
	type Bucket = {
		key: string;
		version: string | null;
		rank: number | null;
		diverged: boolean;
		pending: boolean;
		envs: FleetEnv[];
	};

	const buckets: Bucket[] = [];
	let onHead = 0;
	let behind = 0;
	let diverged = 0;
	let pending = 0;
	let unknown = 0;
	let placed = 0;
	let worstRank = 0;

	for (const e of envs) {
		const isPending = e.tone === 'pending' || !e.version;
		// EVERY environment that has never deployed shares ONE bucket. They run
		// no build, so they cannot disagree with each other — folding them into
		// separate runs would report fragmentation that does not exist.
		const key = isPending
			? '~pending'
			: e.diverged
				? `~diverged:${e.version}`
				: `build:${e.version}`;

		let b = buckets.find((x) => x.key === key);
		if (!b) {
			b = {
				key,
				version: isPending ? null : e.version,
				rank: isPending || e.diverged ? null : (e.rank ?? null),
				diverged: !isPending && e.diverged,
				pending: isPending,
				envs: []
			};
			buckets.push(b);
		}
		b.envs.push(e);

		if (isPending) {
			pending++;
		} else if (e.diverged) {
			diverged++;
		} else if (e.rank === null || e.rank < 0) {
			unknown++;
		} else {
			placed++;
			if (e.rank === 0) onHead++;
			else behind++;
			if (e.rank > worstRank) worstRank = e.rank;
		}
	}

	// ORDER: head first, then newest-to-oldest, then the builds with no
	// distance (unrankable, then diverged), then never-deployed last. Reading
	// left to right is reading backwards through the app's history.
	function orderOf(b: Bucket): number {
		if (b.pending) return 3;
		if (b.diverged) return 2;
		if (b.rank === null) return 1;
		return 0;
	}
	buckets.sort((a, b) => {
		const oa = orderOf(a);
		const ob = orderOf(b);
		if (oa !== ob) return oa - ob;
		if (oa === 0) return (a.rank ?? 0) - (b.rank ?? 0);
		return (a.version ?? '').localeCompare(b.version ?? '');
	});

	const deployed = envs.length - pending;
	// `spread` counts BUILDS, so the one never-deployed bucket is not one.
	const spread = buckets.filter((b) => !b.pending).length;

	const groups: FleetGroup[] = [];

	// THE HEAD SLOT IS ALWAYS THE FIRST GROUP. When nothing stands on it, one
	// hollow full-height mark stands in — the origin of a rank order has to be
	// visible even when it is empty, and it is also the full-height reference
	// that lets every short mark be read as short.
	if (onHead === 0) {
		groups.push({
			key: '~head-empty',
			version: null,
			rank: 0,
			diverged: false,
			onHead: true,
			folded: false,
			marks: [
				{
					key: '~head-empty',
					label: 'head',
					tone: 'pending',
					onHead: true,
					pending: false,
					placeholder: true,
					title:
						envs.length === 0
							? 'no environments'
							: 'the head build — no environment is running it'
				}
			]
		});
	}

	for (const b of buckets) {
		const marks: FleetMark[] = b.envs.map((e) => {
			const isPending = e.tone === 'pending' || !e.version;
			const where = distanceWord(isPending ? null : e.rank, e.diverged, isPending);
			return {
				key: e.key,
				label: e.label,
				tone: e.tone,
				onHead: !isPending && !e.diverged && e.rank === 0,
				pending: isPending,
				placeholder: false,
				title: `${e.label} · ${where}${e.version && !isPending ? ` · ${e.version}` : ''} · ${TONE_WORD[e.tone]}`
			};
		});
		groups.push({
			key: b.key,
			version: b.version,
			rank: b.rank,
			diverged: b.diverged,
			onHead: !b.pending && !b.diverged && b.rank === 0,
			folded: false,
			marks
		});
	}

	// THE FOLD. Only the GAPS between the oldest builds are given up; every
	// environment still draws its own mark, so the strip's length still equals
	// the fleet's size. Flagged, tooltipped, and the caption keeps stating the
	// true build count.
	if (groups.length > maxGroups) {
		const kept = groups.slice(0, maxGroups - 1);
		const tail = groups.slice(maxGroups - 1);
		kept.push({
			key: '~folded',
			version: null,
			rank: null,
			diverged: tail.some((g) => g.diverged),
			onHead: false,
			folded: true,
			marks: tail.flatMap((g) => g.marks)
		});
		groups.length = 0;
		groups.push(...kept);
	}

	return {
		groups,
		total: envs.length,
		deployed,
		placed,
		onHead,
		behind,
		diverged,
		pending,
		unknown,
		unplaced: diverged + pending + unknown,
		spread,
		worstRank
	};
}

/** The worst tone in a group, for its summary tooltip. */
export function groupTone(g: FleetGroup): FleetTone {
	let t: FleetTone = 'pending';
	for (const m of g.marks) t = worstTone(t, m.tone);
	return t;
}

/**
 * The caption under the strip. It states the two ratios the picture encodes
 * and nothing it does not — never the individual `−N` distances, which are
 * the row's lede and the marks' own tooltips.
 *
 * `N builds` prints only when the fleet is fragmented. A converged row's
 * caption stays a single clause, which is the "mark the deviation, never the
 * norm" rule applied to prose.
 */
export function fleetCaption(vm: FleetStripVM, opts?: { omitSpread?: boolean }): string {
	if (vm.total === 0) return 'no environments';
	if (vm.deployed === 0) return 'never deployed';
	const parts: string[] = [];
	if (vm.deployed > 0) parts.push(`${vm.onHead} of ${vm.deployed} on head`);
	// `omitSpread` is for the caller that prints `N builds` as its own MARK —
	// `/apps`, where the spread is the column's chip and repeating it 4px below
	// would be the caption restating the mark it sits under. Default OFF, so
	// every existing caller and every existing test is byte-identical.
	if (vm.spread > 1 && !opts?.omitSpread) parts.push(`${vm.spread} builds`);
	if (vm.pending > 0) parts.push(`${vm.pending} pending`);
	if (vm.diverged > 0) parts.push(`${vm.diverged} diverged`);
	if (vm.unknown > 0) parts.push(`${vm.unknown} unknown`);
	return parts.join(' · ');
}
