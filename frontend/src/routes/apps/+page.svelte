<svelte:options runes={true} />

<script lang="ts">
	/**
	 * APPS LIST — ONE ROW PER APP, LEGIBLE AT 50.
	 *
	 * The three questions a reader arrives with (`PAGE-CRITERIA.md` §03):
	 *
	 *   1. WHICH APPS' FLEETS ARE CONSISTENT?  → the Fleet column: a `count`
	 *      chip reading `N builds` when the fleet is split across more than
	 *      one, and NOTHING when it is converged. See the tombstone at that
	 *      cell for why the third graphic form of this column was cut.
	 *   2. WHICH ARE CHURNY?                   → `DeployVolumeSparkline` over
	 *      7 days, plus the count.
	 *   3. WHICH SHIP SLOWLY?                  → the Lead column: median
	 *      measured time for a build to get from the first environment to the
	 *      first production region (`view-models/lead-time.ts`).
	 *
	 *   Health is the leading status circle — the product's own atom, the same
	 *   one `/`, `/rollouts` and the rollout-detail panels use.
	 *
	 * WHAT THIS REPLACES, AND WHY. The row was a CONVERGENCE BAR: one joined
	 * `[status][ENV][−N]` box per environment, wrapped. It answered "which
	 * environment is behind" precisely and answered none of the three questions
	 * above. Measured on the 13-environment fixture it took THREE WRAPPED LINES
	 * and printed `PROD-US…` four times — four different regions, ellipsised to
	 * the same eleven characters, so the one thing the box existed to carry
	 * (which environment) was the thing the width destroyed. It also cost
	 * O(environments) of row height, which is the opposite of "legible at 50".
	 *
	 * The identity it carried is not deleted, it is RE-ALLOCATED. Any
	 * environment that is failing, stuck or diverged gets its own named box —
	 * those are the rows that need a person and a person needs the name — and
	 * the row's one sentence names the worst environment that has NO box
	 * (`PROD-SA-EAST is 4 builds behind`). What is gone is the twelfth copy of
	 * `−1` on an app where every region is one build behind: that is a SHAPE,
	 * and the strip draws it in 96px.
	 *
	 * ── EACH ENVIRONMENT IS NAMED ONCE PER ROW (2026-08-26). ────────────────
	 *
	 * The row used to say the same thing twice on every attention row: a lede
	 * `PROD is stuck` beside a box `[●][PROD][STUCK]`. Neither half was
	 * redundant on its own — the box carries identity colour, the status hue
	 * and (for `stuck`) the alarm's fill, none of which prose may carry; the
	 * lede carried the word `failing`, which the red dot cannot say. So the
	 * fix was to make the BOX SELF-SUFFICIENT rather than to delete a half:
	 * every adverse state now prints its word in the box (`stuck` / `failing`
	 * / `diverged`), and the env chip inside it is `wide`, so `PROD-EU-CENTRAL`
	 * prints whole instead of ellipsising to `PROD-EU…` while the sentence
	 * beside it spelled the name out in full.
	 *
	 * **If an environment has a box, it is not in the sentence.** The sentence
	 * then reports the worst environment that has none — in motion first, then
	 * the deepest lag — and prints nothing when there is none. Measured on the
	 * mock fixture at 1440: the string `PROD` appeared twice per attention row
	 * and now appears once; `edge-mesh` with five failing regions reads
	 * `[PROD-EU-WEST-1 FAILING] [PROD-US-EAST-1 FAILING] [PROD-US-EAST-2
	 * FAILING] +2 more` instead of a five-name sentence over three chips that
	 * all ellipsised to `PROD-US…`.
	 *
	 * ── `Fleet by build` DIED AT THE THIRD ATTEMPT. (2026-08-27) ────────────
	 *
	 * Four graphic forms of criterion 1 were built and rejected: a 12-slot rank
	 * ruler, the ruler with a visible track, the ruler with a head anchor, and
	 * the mark-and-gap run strip. The full argument for the cut is at the Fleet
	 * cell in the markup. The short version is that all four were pictures of a
	 * quantity — *how far apart are these builds* — that is **never adverse**
	 * (*"drift is the normal state of a promotion pipeline; the only adverse
	 * state is stuck"*), on the one row of the product where something IS
	 * adverse. They were the loudest structure on the row and the least
	 * urgent fact on it.
	 *
	 * `Head` stopped being a column in the same pass and did not come back: it
	 * named the strip's leftmost run, and with the strip gone an absolute sha
	 * is *"usually noise"* (`DESIGN-INTENT.md`). Its second line (`N envs ·
	 * Xm ago`) had already split — `N envs` was a restatement of the caption's
	 * own denominator, and the last-deploy time lives in `Deploys · 7d`, where
	 * recency belongs beside volume.
	 *
	 * ── THE ADVERSE ROW IS A ROW, NOT A BADGE. (2026-08-27) ─────────────────
	 * > *"I think there's also a better way to show issues such as stuck on the
	 * > apps list page instead of just showing a badge."*
	 *
	 * A row with something wrong now carries a full-bleed neutral GROUND
	 * (`bg-gray-100 dark:bg-gray-700/60`) and its hover steps up rather than
	 * down. THE PREDICATE IS `rank === 0`, which is the same predicate the
	 * page's own header counts as *"N need attention"* — failing or stuck, and
	 * never merely `diverged` or `behind`. The band and the headline can
	 * therefore never disagree, and the norm is never marked: on the live
	 * cluster, which is converged, no row is banded at all. The ground is neutral by arithmetic, not by taste: presence is
	 * `area x chroma`, the row's box is ~1130x66 = 74,580px2, and the palest
	 * chromatic step in the palette (`red-50`, C 0.013) would cost 970 ink
	 * units against the `stuck` alarm's 218.6 — a 4.4x inversion of the one
	 * ceiling this product holds. That is the same measurement that deleted
	 * `/apps/[name]`'s `bg-red-50/80` field. At row scale the only channel
	 * available is LIGHTNESS, and both values are already spent on this page,
	 * so the treatment costs ZERO colour values.
	 *
	 * THE GRID IS FIXED-TRACK, and its breakpoint is a CONTAINER QUERY. The
	 * sidebar is 176px at `sm`+ and absent below it, so this panel is 607px
	 * wide at a 639px viewport and 416px at a 640px viewport — a viewport media
	 * query flips the layout the WRONG WAY across that boundary. Same lesson
	 * `/apps/[name]`'s env cards learned.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { groupRolloutsByApp } from '$lib/version-utils';
	import type { AppGroup, AppCell } from '$lib/version-utils';
	import { buildMatrix } from '$lib/view-models/matrix';
	import type { MatrixCellVM } from '$lib/view-models/matrix';
	import type { RankVerdict } from '$lib/view-models/env-rank';
	import { buildFleetStrip } from '$lib/view-models/fleet-strip';
	import { promotionBlock } from '$lib/view-models/promotion';
	import {
		buildGateContext,
		withSchedules,
		blockingStory,
		type GateContext,
		type BlockingStory
	} from '$lib/view-models/blocking-story';
	import { sourceClusterName } from '$lib/source-dashboard';
	import { fetchScheduleObjects, type ScheduleObject } from '$lib/api/schedules';
	import BlockingStoryPanel from '$lib/components/BlockingStoryPanel.svelte';
	import type { PromotionBlock } from '$lib/view-models/promotion';
	import type { FleetEnv, FleetStripVM, FleetTone } from '$lib/view-models/fleet-strip';
	import { leadTime, compactSpan } from '$lib/view-models/lead-time';
	import type { LeadEnv, LeadTimeVM } from '$lib/view-models/lead-time';
	import { getEnvironmentRank } from '$lib/env-order';
	import {
		detectStuck,
		detectStuckBehind,
		formatTimeAgoCompact,
		formatDate,
		getDisplayVersion
	} from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { shortEnvLabel } from '$lib/environment-theme';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import { getStatusCircleClass, BAKE_WORD } from '$lib/bake-status';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Card from '$lib/components/Card.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import UpToDate from '$lib/components/UpToDate.svelte';
	import NextStep from '$lib/components/NextStep.svelte';
	import type { Step } from '$lib/components/NextStep.svelte';
	// THE BANNER BORROWS `BlockReason`'S SENTENCE, NOT ITS MARKUP. The
	// component paints `gray-500` prose for a white card; the banner is a
	// filled amber field and owns its own ink. Sharing the FUNCTION is what
	// stops the most-read line on the page from spelling the fact a second
	// way, which is exactly what it was doing.
	import { blockReason } from '$lib/components/BlockReason.svelte';
	import {
		RocketSolid,
		ExclamationCircleSolid,
		ClockSolid,
		ChevronRightOutline,
		PauseSolid,
		ArrowRightOutline
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../../types';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: pollWhenHealthy(15000) } })
	);

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	// `groups` gives the raw per-cell rollout (bakeStatus / stuck / pin);
	// `matrix` gives the sorted env tiers plus the SHARED rank (`env-rank.ts`),
	// which is the same number `/apps/[name]` prints for the same rollout.
	// Combining both here is presentation glue — neither derivation is
	// duplicated.
	const groups = $derived.by<Map<string, AppGroup>>(() =>
		groupRolloutsByApp(rollouts, environments)
	);
	const matrix = $derived.by(() => buildMatrix(rollouts, environments));

	type CellState =
		| 'fail'
		| 'stuck'
		| 'deploying'
		| 'baking'
		| 'pending'
		| 'onNewest'
		| 'behind1'
		| 'behind2';

	type RowCell = {
		tier: string;
		envLabel: string;
		theme: EnvironmentTheme | null;
		version: string;
		/** THE SHARED RANK (`env-rank.ts`). */
		rank: RankVerdict;
		behindBy: number;
		state: CellState;
		/** Pinned to a wanted version — the lag is deliberate, not drift. */
		held: boolean;
		/**
		 * THE BUILD SOMEONE PINNED IT TO. Carried because the page's banner has
		 * to be able to NAME THE CAUSE: a live UX critique found this page (and
		 * `/apps/[name]`) blaming an approval gate for a production that was
		 * behind, when *"the actual cause was the pin, which the page never
		 * mentions"*. A cause you cannot name is a cause you will get wrong.
		 */
		wantedVersion: string | null;
		/**
		 * WHY NOTHING NEWER HAS ARRIVED — the SHARED derivation
		 * (`view-models/promotion.ts`), the same one `/apps/[name]` and rollout
		 * detail use. Its split is the whole reason the banner can be honest:
		 * `awaitingApprovalGates` is a gate that has an opinion and the answer
		 * is NO — only a person changes that; `notPassingGates` is a schedule
		 * window or a health check, which clears on its own. A page that renders
		 * those two the same way is telling a reader to act on something that
		 * needs no action.
		 */
		block: PromotionBlock;
		/**
		 * ⭐ EVERY GATE HOLDING THIS CELL, each with whether it clears on a
		 * clock, on another deploy, or on a person — the SHARED
		 * `view-models/blocking-story` derivation, the same object
		 * `/apps/[name]`, `/environments` and rollout detail render.
		 *
		 * `block` above splits gates by whether they published an allow-list,
		 * which is structural and TRUE but is not the same question as who has
		 * to move: three of the four things that write a `RolloutGate` publish
		 * an allow-list, so this page captioned an environment-controller gate
		 * *"waiting on an approval"* and named a human who cannot exist.
		 */
		story: BlockingStory;
		timestamp: string | null;
	};

	type AppRow = {
		appName: string;
		/**
		 * `status.title`, but ONLY when it is not a re-spelling of the name.
		 * Empty string means "print nothing". See `descriptionFor`.
		 */
		desc: string;
		cells: RowCell[];
		/** Only the environments that need a person, named. Never all of them. */
		adverse: RowCell[];
		/** How many adverse environments the 3-box cap left out. Never silent. */
		adverseMore: number;
		/** Those environments, named — the `+N more` tooltip. */
		adverseRest: string;
		worstLag: number;
		worst: CellState;
		/** The bake state the row's circle paints — `worst` with `stuck` skipped. */
		circle: CellState;
		rank: number;
		fleet: FleetStripVM;
		/** The whole statement, for the cell's `title`. */
		fleetFull: string;
		lead: LeadTimeVM | null;
		deploys7d: number;
		rolloutsForSpark: Rollout[];
		mostRecentTs: string | null;
		lede: string;
		/**
		 * EVERY DEPLOYED ENVIRONMENT IS ON HEAD. The predicate the green tick
		 * is now gated on, and the one criterion 1 actually asks about.
		 */
		fullyOnHead: boolean;
		/** Deployed environments sitting on ONE build — consistent, head or not. */
		converged: boolean;
		/** The pinned environment furthest behind, if any. The banner's cause. */
		heldCell: RowCell | null;
		/**
		 * ── THE ROW'S NEXT STEP, AND WHY A LIST ROW HAS ONE AT ALL ───────
		 *
		 * `DESIGN-INTENT.md`: *"Be actionable. Showing a problem without
		 * offering the action is an unfinished design."* This page stated a
		 * problem on every attention row and offered nothing on any of them —
		 * the row was a link to somewhere else and the reader had to guess
		 * what was waiting for them there.
		 *
		 * It also had no VISUAL ENTRY POINT. Four rows rendered near-identical
		 * and the eye had nowhere to land except the banner. A column that is
		 * EMPTY on every settled row and holds a button on the two that need a
		 * person is the cheapest possible answer to that: the eye lands on
		 * exactly the rows where something is wanted, which is what "draw the
		 * reader in" means in practice.
		 *
		 * `null` on a row where nothing is wanted. An action on every row is a
		 * column of noise, and it would be marking the norm.
		 */
		step: Step | null;
		/** Which environment the step is about — the button's `title`. */
		stepEnv: string;
	};

	// ⛔ `STATUS_DOT_CLASS` IS DELETED (2026-08-27). There is no per-environment
	// status dot on this row any more — the human rejected it inside the badge
	// and then outside it, and the badge's second section carries the state as a
	// WORD instead. `FleetStrip`'s own `MARK` map is the sole owner of the
	// status-hue-per-cell-state mapping now; it was a copy of this one, and a
	// value that exists twice is a value that will diverge.
	// THE STATE, IN WORDS. It is the badge's TOOLTIP now rather than the
	// accessible name of a dot — with the dot gone this is the only place a
	// row states whether an adverse environment's last deploy succeeded, failed
	// or is still in flight, so it may not be dropped with the mark it used to
	// annotate.
	// ONE SPELLING, FROM `bake-status.ts` (2026-08-30). `baking` was this
	// product's own word and this table was one of six copies of it.
	const STATUS_WORD: Record<CellState, string> = {
		fail: BAKE_WORD.Failed,
		stuck: 'stuck',
		pending: 'never deployed',
		deploying: BAKE_WORD.Deploying,
		baking: BAKE_WORD.InProgress,
		onNewest: BAKE_WORD.Succeeded,
		behind1: BAKE_WORD.Succeeded,
		behind2: BAKE_WORD.Succeeded
	};

	const FLEET_TONE: Record<CellState, FleetTone> = {
		fail: 'fail',
		stuck: 'stuck',
		deploying: 'deploying',
		baking: 'baking',
		pending: 'pending',
		onNewest: 'settled',
		behind1: 'settled',
		behind2: 'settled'
	};

	// Worst-first priority — drives the "needs attention" sort rank and the
	// row's leading status circle. NOTE the circle walks this list with `stuck`
	// SKIPPED; see `circleBakeStatus`.
	const SEVERITY: CellState[] = [
		'fail',
		'stuck',
		'deploying',
		'baking',
		'behind2',
		'behind1',
		'pending',
		'onNewest'
	];

	/**
	 * THE DESCRIPTION HAS TO EARN THE SPACE IT TAKES FROM THE NAME.
	 *
	 * `status.title` is free text an operator sets, and on the live cluster it
	 * is usually the app name re-spelled: `hello-world-app` carries the title
	 * `Hello World app`. The old guard was `title !== appName`, which a single
	 * space or capital defeats, so four rows printed a second copy of their own
	 * identifier beside the first — and at 390px BOTH were ellipsised, which
	 * is how the page ended up rendering `hello-worl…  Hello Wor…`.
	 *
	 * Compare on the slug: strip everything but letters and digits, lowercase,
	 * and if the two agree the title is saying nothing the name did not. This
	 * is the same defect the convergence bar died of — a truncation that leaves
	 * two different rows printing the same string — caught one layer earlier.
	 *
	 * The description is additionally hidden below the container breakpoint
	 * (see `.apps-desc`): at phone width the name is the whole identity of the
	 * row and it may not share its line.
	 */
	function descriptionFor(appName: string, title: string): string {
		if (!title) return '';
		const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
		return slug(title) === slug(appName) ? '' : title;
	}

	/** Below this a chart is a rendering glitch drawn at the size of data. */
	const SPARK_MIN = 3;
	const SPARK_DAYS = 7;

	// Classify one app's cell at one env tier. Reuses `detectStuck` /
	// `detectStuckBehind` (the product's one stuck logic) and
	// `vm.statusKey` / `behindBy` from `buildMatrix` — no new status
	// vocabulary is invented here.
	function classifyCell(
		group: AppGroup,
		tier: string,
		vm: MatrixCellVM,
		refNow: Date,
		ctx: GateContext
	): {
		state: CellState;
		theme: EnvironmentTheme | null;
		held: boolean;
		wantedVersion: string | null;
		block: PromotionBlock;
		story: BlockingStory;
		timestamp: string | null;
	} {
		const cell = group.cells.find((c) => c.environment?.spec?.environment === tier);
		const rollout = cell?.rollout ?? null;
		const bakeStatus = rollout?.status?.history?.[0]?.bakeStatus || 'None';
		const timestamp = rollout?.status?.history?.[0]?.timestamp ?? null;
		const pinned = !!rollout?.spec?.wantedVersion;
		// `spec.wantedVersion` is already the plain tag string — NOT a version
		// object, so it does not go through `getDisplayVersion`.
		const wantedVersion = rollout?.spec?.wantedVersion ?? null;
		const block = promotionBlock(rollout);
		const story = blockingStory(rollout, ctx, { place: tier, now: refNow });

		let stuckReason = detectStuck(rollout, { now: refNow });
		if (!stuckReason && cell) {
			for (const peer of group.cells) {
				if (peer === cell) continue;
				const r = detectStuckBehind(rollout, peer.rollout, peer.envName, { now: refNow });
				if (r) {
					stuckReason = r;
					break;
				}
			}
		}

		const theme = cell?.theme ?? null;
		const held = pinned && vm.rank.kind !== 'newest';

		if (vm.statusKey === 'failed')
			return { state: 'fail', theme, held, wantedVersion, block, story, timestamp };
		if (stuckReason) return { state: 'stuck', theme, held, wantedVersion, block, story, timestamp };
		if (bakeStatus === 'Deploying')
			return { state: 'deploying', theme, held, wantedVersion, block, story, timestamp };
		if (bakeStatus === 'InProgress')
			return { state: 'baking', theme, held, wantedVersion, block, story, timestamp };
		if (vm.statusKey === 'pending')
			return { state: 'pending', theme, held: false, wantedVersion, block, story, timestamp };
		// ⛔ `behindBy === 0` IS NOT `onNewest`. (2026-08-30) `rankBehindBy`
		// returns 0 for THREE different verdicts — `newest`, `diverged` and
		// `unknown` — and `matrix.ts`'s own doc comment says so. Testing the
		// number therefore filed "we cannot resolve this comparison" under
		// the page's good-news state. The verdict decides; the number is for
		// counting only.
		if (vm.rank.kind === 'newest')
			return { state: 'onNewest', theme, held, wantedVersion, block, story, timestamp };
		const behindState: CellState = vm.behindBy >= 2 ? 'behind2' : 'behind1';
		return { state: behindState, theme, held, wantedVersion, block, story, timestamp };
	}

	/**
	 * THE CIRCLE SHOWS THE ROW'S TRUE BAKE GLYPH, AND `stuck` IS NOT ONE.
	 *
	 * `stuck` sits second in `SEVERITY` because it is second in urgency, and
	 * feeding that straight to the circle produced a measurable lie:
	 * `checkout-edge`'s production is BAKING and has been for three days, so
	 * the row's worst state is `stuck`, so the circle fell through to
	 * `Succeeded` and painted GREEN — on the one row of the page that most
	 * needed a person, next to its own amber `stuck` chip.
	 *
	 * The rule the product already settled on is "a stuck app shows its TRUE
	 * bake glyph, with the alarm carried by a chip beside the environment that
	 * is actually stuck". A bake status is one of five values and `stuck` is
	 * none of them — it is a fact about how long a state has lasted, computed
	 * by `detectStuck`, and the chip is what carries it. So the circle walks
	 * the same severity list with `stuck` skipped, which for `checkout-edge`
	 * lands on `baking` and paints YELLOW, and for a stuck-but-settled rollout
	 * (blocked on a gate, deploy long since succeeded) still lands on green.
	 */
	function circleState(cells: RowCell[]): CellState {
		for (const s of SEVERITY) {
			if (s === 'stuck') continue;
			if (cells.some((c) => c.state === s)) return s;
		}
		return 'onNewest';
	}

	/**
	 * ⛔ A GREEN TICK MEANS THE WHOLE FLEET IS ON HEAD. NOTHING WEAKER. (2026-08-30)
	 *
	 * From a live UX critique of the running product: *"`/apps` shows a GREEN
	 * TICK beside `hello-world-app — PROD is 14 builds behind`."* It did, and
	 * the code above explains exactly why: the circle painted the row's true
	 * BAKE glyph, prod's last deploy succeeded, so `Succeeded` → green tick,
	 * 8px from a sentence saying production is two dozen builds stale.
	 *
	 * Both halves of that were locally right and the pair was a lie. A bake
	 * status answers *"did the last deploy work"*; the reader of a LIST row is
	 * asking *"is this app OK"*, and those diverge precisely on the rows that
	 * matter. The tick is the strongest all-clear the product owns and it was
	 * being spent on an app nobody had promoted in three weeks.
	 *
	 * THE FIX COSTS NO NEW VALUE AND NO NEW GLYPH. When nothing is failing,
	 * deploying or baking but the fleet is NOT fully on head, the circle falls
	 * to `None` — `PauseSolid` on the gray disc, which `BakeStatusIcon` and
	 * `getStatusCircleClass` already own. "Not moving" is exactly what an app
	 * whose production is 24 builds behind is doing, and gray is not an alarm:
	 * being behind is *"the normal state of a promotion pipeline"* and must not
	 * borrow red or amber. It just may not borrow the ALL-CLEAR either.
	 *
	 * `held` (someone pinned it) resolves to the same gray pause on purpose —
	 * a pin is the most literal reading of "paused" there is. Which of the two
	 * it is gets named by the banner and by the row's `sr-only` text.
	 */
	function circleBakeStatus(state: CellState, fullyOnHead: boolean): string | undefined {
		switch (state) {
			case 'fail':
				return 'Failed';
			case 'deploying':
				return 'Deploying';
			case 'baking':
				return 'InProgress';
			case 'pending':
				return 'None';
			default:
				// onNewest / behind1 / behind2 — the deploy itself succeeded, so
				// the question is no longer "did it work" but "did it arrive".
				return fullyOnHead ? 'Succeeded' : 'None';
		}
	}

	// NO `leadToneClass`. Colour belongs on MARKS, not on prose: a coloured
	// sentence is the loudest way a page can say anything, and every state it
	// would tint already carries a mark (the row glyph is red when an env
	// failed, the strip's mark is amber when one is stuck). The lede is neutral
	// ink in every state.

	/**
	 * THE ROW'S ONE STEP, chosen worst-first from the same facts the row's
	 * marks are drawn from. The ORDER is the whole content of this function:
	 *
	 *   1. a deploy FAILED          → look at it. Not a decision; a fault.
	 *   2. a version is PINNED      → the pin refuses every promotion and it is
	 *                                 the one thing a person put there. It
	 *                                 outranks every rule, because a rule holds
	 *                                 the NEXT version and a pin holds all of
	 *                                 them. This is the ordering a live UX
	 *                                 critique caught the product getting
	 *                                 backwards: *"that panel blamed HELD BY
	 *                                 hello-world-manual-approval; the actual
	 *                                 cause was the pin."*
	 *   3. a rule wants an APPROVAL → nothing moves until a person picks. The
	 *                                 only real DECISION on this page.
	 *   4. STUCK                    → look at it.
	 *   5. a newer version is ALLOWED and nobody has deployed it → deploy it.
	 *   6. a rule that clears itself → read what it is, then do nothing.
	 *
	 * ⛔ THE STEP IS A LINK, NOT A MUTATION, AND THAT IS DELIBERATE. An app may
	 * have several environments in the same state, and a list-level `Deploy`
	 * would have to silently pick one — a control whose target the reader
	 * cannot see is worse than no control. The label names the decision and the
	 * click lands one hop from it, on the page that owns the modal. What is NOT
	 * allowed here is the defect the human named: a stated problem offering
	 * `Investigate` where a DECISION is what is wanted. `approve` and `promote`
	 * are decisions and are labelled as such.
	 */
	function nextStep(cells: RowCell[]): { step: Step; env: string } | null {
		const fail = cells.find((c) => c.state === 'fail');
		if (fail) return { step: 'investigate', env: fail.envLabel.toUpperCase() };
		const held = cells.find((c) => c.held);
		if (held) return { step: 'unpin', env: held.envLabel.toUpperCase() };
		const approve = cells.find((c) => c.block.awaitingApprovalGates.length > 0 && c.behindBy > 0);
		if (approve) return { step: 'approve', env: approve.envLabel.toUpperCase() };
		const stuck = cells.find((c) => c.state === 'stuck');
		if (stuck) return { step: 'investigate', env: stuck.envLabel.toUpperCase() };
		const ready = cells.find((c) => c.block.deployableCount > 0 && c.behindBy > 0);
		if (ready) return { step: 'promote', env: ready.envLabel.toUpperCase() };
		const waiting = cells.find((c) => c.block.notPassingGates.length > 0 && c.behindBy > 0);
		if (waiting) return { step: 'unblock', env: waiting.envLabel.toUpperCase() };
		return null;
	}

	/**
	 * THE FLEET CELL'S TOOLTIP, IN THE SAME ENGLISH THE CELL PRINTS.
	 *
	 * `fleetCaption` in `view-models/fleet-strip.ts` is the shared string and
	 * it says `3 of 7 on head · 2 builds · 1 diverged` — three pieces of
	 * insider vocabulary in one line. It has its own tests and other callers,
	 * so it is left alone; the tooltip on THIS page is spelled here instead.
	 * A tooltip that has to be translated is not a tooltip.
	 */
	function plainFleetTitle(vm: FleetStripVM): string {
		if (vm.total === 0) return 'no environments';
		if (vm.deployed === 0) return 'never deployed anywhere';
		const parts = [`${vm.onHead} of ${vm.deployed} running the newest version`];
		if (vm.spread > 1) parts.push(`${vm.spread} different versions live`);
		if (vm.pending > 0) parts.push(`${vm.pending} never deployed`);
		if (vm.diverged > 0) parts.push(`${vm.diverged} running a version nobody released`);
		if (vm.unknown > 0) parts.push(`${vm.unknown} whose version could not be placed`);
		return parts.join(' · ');
	}

	/** `status.history` reduced to what `lead-time.ts` reads. */
	function leadDeploys(cell: AppCell) {
		const out: { version: string; ms: number }[] = [];
		for (const h of cell.rollout.status?.history ?? []) {
			const v = getDisplayVersion(h.version);
			if (!v || !h.timestamp) continue;
			const ms = new Date(h.timestamp).getTime();
			if (Number.isFinite(ms)) out.push({ version: v, ms });
		}
		return out;
	}

	function isProdTier(envName: string): boolean {
		return getEnvironmentRank(envName) >= 7;
	}

	/**
	 * ⭐ THE GATE JOIN TABLE, built once from the payload this page already has.
	 *
	 * `Environment.status.rolloutGateRef` names the gate the environment
	 * controller owns and `spec.relationship` says which environment has to
	 * deploy first; `RolloutDependency.status.gateName` does the same for a
	 * cross-service contract. Without it this page blamed
	 * `hello-world-manual-approval` for a prod rollout that was ALSO held by a
	 * failing schedule gate and by the environment controller — three gates,
	 * one named, and not the failing one.
	 */
	let scheduleObjects = $state<Record<string, ScheduleObject[]>>({});
	const gateContext = $derived.by<GateContext>(() => {
		let ctx = buildGateContext({
			environments: query.data?.environments ?? null,
			rolloutDependencies: query.data?.rolloutDependencies ?? null
		});
		for (const [ns, objs] of Object.entries(scheduleObjects)) ctx = withSchedules(ctx, ns, objs);
		return ctx;
	});

	/*
	 * WHEN DOES THE WINDOW OPEN? One GET per rollout that is actually held by a
	 * gate with no allow-list, cached by namespace and never re-requested — on
	 * the live fleet that is 3 requests, not 15. Same endpoint and the same
	 * arithmetic `/versions` and rollout detail already run.
	 */
	$effect(() => {
		for (const r of rollouts) {
			const ns = r.metadata?.namespace;
			const name = r.metadata?.name;
			if (!ns || !name) continue;
			if (scheduleObjects[ns]) continue;
			const b = promotionBlock(r);
			if (!b.blocked || b.notPassingGates.length === 0) continue;
			fetchScheduleObjects(ns, name, sourceClusterName(r) || undefined)
				.then((objs) => {
					scheduleObjects = { ...scheduleObjects, [ns]: objs };
				})
				.catch(() => {});
		}
	});

	const appRows = $derived.by<AppRow[]>(() => {
		const refNow = $now;
		const rows: AppRow[] = [];
		for (const mrow of matrix.rows) {
			const group = groups.get(mrow.appName);
			if (!group) continue;

			const cells: RowCell[] = [];
			for (const tier of matrix.envTiers) {
				const vm = mrow.cells[tier];
				if (!vm) continue;
				const { state, theme, held, wantedVersion, block, story, timestamp } = classifyCell(
					group,
					tier,
					vm,
					refNow,
					gateContext
				);
				cells.push({
					tier,
					envLabel: shortEnvLabel(vm.envName) || vm.envName,
					theme,
					version: vm.version,
					rank: vm.rank,
					behindBy: vm.behindBy,
					state,
					held,
					wantedVersion,
					block,
					story,
					timestamp
				});
			}
			if (cells.length === 0) continue;

			let worst: CellState = 'onNewest';
			for (const s of SEVERITY) {
				if (cells.some((c) => c.state === s)) {
					worst = s;
					break;
				}
			}
			const rank =
				worst === 'fail' || worst === 'stuck'
					? 0
					: worst === 'deploying' || worst === 'baking'
						? 1
						: 2;

			// ── THE FLEET STRIP ──────────────────────────────────────────
			// One mark per environment, grouped by the BUILD it runs — which
			// is why `version` is passed and is the grouping key: consistency
			// is "the same build", not "the same distance". `rank.kind` is the
			// SHARED verdict, so `unknown` and `diverged` never claim a
			// distance they cannot evidence; they get their own run.
			const fleetEnvs: FleetEnv[] = cells.map((c) => ({
				key: c.tier,
				label: c.envLabel.toUpperCase(),
				version: c.version || null,
				rank: c.rank.kind === 'newest' ? 0 : c.rank.kind === 'behind' ? c.rank.by : null,
				tone: FLEET_TONE[c.state],
				diverged: c.rank.kind === 'diverged'
			}));
			const fleet = buildFleetStrip(fleetEnvs);

			// ── LEAD TIME ────────────────────────────────────────────────
			const leadEnvs: LeadEnv[] = group.cells.map((c) => ({
				label: shortEnvLabel(c.envName) || c.envName,
				order: getEnvironmentRank(c.envName),
				prod: isProdTier(c.envName),
				deploys: leadDeploys(c)
			}));
			const lead = leadTime(leadEnvs);

			// ── DEPLOY VOLUME ────────────────────────────────────────────
			const sparkStart = refNow.getTime() - SPARK_DAYS * 24 * 60 * 60 * 1000;
			let deploys7d = 0;
			for (const c of group.cells) {
				for (const h of c.rollout.status?.history ?? []) {
					if (!h.timestamp) continue;
					const t = new Date(h.timestamp).getTime();
					if (t >= sparkStart && t <= refNow.getTime()) deploys7d++;
				}
			}

			let mostRecentTs: string | null = null;
			for (const c of cells) {
				if (c.timestamp && (!mostRecentTs || new Date(c.timestamp) > new Date(mostRecentTs))) {
					mostRecentTs = c.timestamp;
				}
			}

			const failing = cells.filter((c) => c.state === 'fail');
			const stuck = cells.filter((c) => c.state === 'stuck');
			const active = cells.filter((c) => c.state === 'deploying' || c.state === 'baking');
			const divergedCells = cells.filter((c) => c.rank.kind === 'diverged');

			// NAMED ONLY WHEN A NAME IS NEEDED. Failing, stuck and diverged
			// environments keep their own box — those are the rows a person has
			// to act on, and an action needs a target. Everything else is a
			// shape, and the strip draws the shape.
			const adverseAll = [...failing, ...stuck, ...divergedCells];
			const adverse = adverseAll.slice(0, 3);
			// THE CAP MAY NOT TRUNCATE SILENTLY. Three boxes is a row; six is a
			// paragraph. The overflow is COUNTED rather than dropped, in the
			// same t-micro gray as the lede — it is a denominator, not a
			// deviation, so it takes no colour and no box.
			const adverseMore = adverseAll.length - adverse.length;
			const adverseRest = adverseAll
				.slice(3)
				.map((c) => `${c.envLabel.toUpperCase()} — ${STATUS_WORD[c.state]}`)
				.join(' · ');

			// ── THE ROW STATES EACH ENVIRONMENT EXACTLY ONCE ─────────────────
			//
			// This used to say the same thing twice on every attention row: a
			// lede reading `PROD is stuck` beside a box reading `[●][PROD][STUCK]`.
			// The two halves were NOT redundant by accident, which is why
			// deleting either one was the wrong fix:
			//
			//   · the BOX carries the environment's fixed identity colour, the
			//     status hue on its dot, and (for `stuck`) the alarm's fill —
			//     the loudest mark in the product. A sentence cannot carry any
			//     of that, because colour on prose is banned.
			//   · the LEDE carried the VERB. `failing` has no chip; the box for
			//     a failed deploy was `[● red][STAGING]` and the word existed
			//     only in the sentence.
			//
			// So the fix is not to cut one, it is to make the BOX SELF-SUFFICIENT
			// and let the sentence say what no box says. Every adverse state now
			// prints its word in the box — `stuck` (alarm), `failing` (new role,
			// same red as `rank`/`diverged`, ZERO new colour values), `diverged` —
			// and the env chip inside it is `wide`, so `PROD-EU-CENTRAL` prints
			// whole instead of ellipsising to `PROD-EU…` while the sentence
			// beside it spelled the name out in full. A target you cannot name
			// is not a target.
			//
			// THE RULE THAT REPLACES THE OLD CASCADE: **an environment is named
			// once per row. If it has a box, it is not in the sentence.** The
			// lede reports the worst environment WITHOUT a box, in the same
			// severity order as before, and prints nothing when there is none.
			// A converged row was already quiet; an attention row is now quiet
			// too, except for the one object that needs a person.
			const boxed = new Set(adverseAll.map((c) => c.tier));
			const activeFree = active.filter((c) => !boxed.has(c.tier));
			let lede: string;
			if (activeFree.length > 0) {
				lede = `${activeFree[0].envLabel.toUpperCase()} rolling out`;
			} else {
				// The deepest lag that is not already boxed. `mrow.worstLag` is
				// the row's own worst, so it is only usable when the cell that
				// holds it has no box; otherwise re-derive from what is left.
				const freeLagging = cells.filter((c) => !boxed.has(c.tier) && c.behindBy > 0);
				const worstFree = freeLagging.reduce<RowCell | null>(
					(best, c) => (best === null || c.behindBy > best.behindBy ? c : best),
					null
				);
				// `is 3 builds behind` — behind WHAT? The sentence never said, and
				// on a page whose whole subject is distance from the newest build
				// that is the one word it could not afford to leave out.
				lede = worstFree
					? `${worstFree.envLabel.toUpperCase()} is ${worstFree.behindBy} version${worstFree.behindBy === 1 ? '' : 's'} behind the newest`
					: '';
			}

			const step = nextStep(cells);

			rows.push({
				step: step?.step ?? null,
				stepEnv: step?.env ?? '',
				appName: mrow.appName,
				desc: descriptionFor(mrow.appName, mrow.title),
				cells,
				adverse,
				adverseMore,
				adverseRest,
				worstLag: mrow.worstLag,
				worst,
				circle: circleState(cells),
				rank,
				fleet,
				fleetFull: plainFleetTitle(fleet),
				lead,
				deploys7d,
				rolloutsForSpark: group.cells.map((c) => c.rollout),
				mostRecentTs,
				lede,
				fullyOnHead: fleet.deployed > 0 && fleet.onHead === fleet.deployed,
				converged: fleet.deployed > 0 && fleet.spread === 1,
				heldCell: cells
					.filter((c) => c.held)
					.reduce<RowCell | null>(
						(best, c) => (best === null || c.behindBy > best.behindBy ? c : best),
						null
					)
			});
		}
		// WORST FIRST, and "worst" now has three tiers rather than two.
		// Rank 0 (failing/stuck) then rank 1 (in motion) then the rest, and
		// WITHIN a tier the fleet's own fragmentation leads: an app whose
		// environments sit on four different builds is a worse fleet than one
		// whose environments sit on two, even when both trail head by the same
		// distance. That is criterion 1 driving the sort, which is what "sort
		// worst-first and the fleet's problems float up" asks for.
		return rows.sort((a, b) => {
			if (a.rank !== b.rank) return a.rank - b.rank;
			if (a.fleet.spread !== b.fleet.spread) return b.fleet.spread - a.fleet.spread;
			if (a.worstLag !== b.worstLag) return b.worstLag - a.worstLag;
			return (b.lead?.medianMs ?? 0) - (a.lead?.medianMs ?? 0);
		});
	});

	/**
	 * WHY THE BUTTON SAYS WHAT IT SAYS — the row's `title`, and the sentence a
	 * reader gets before they commit to a click. The button carries the VERB;
	 * this carries the CONSEQUENCE, which is the pairing the novice test asks
	 * for everywhere on these pages.
	 */
	const STEP_WHY: Record<Step, string> = {
		investigate: 'its last deploy failed or it has stopped moving',
		unpin: 'someone pinned a version here, so nothing newer can deploy',
		approve: 'a newer version exists and a person has to pick it',
		promote: 'a newer version is allowed here and nobody has deployed it',
		unblock: 'newer versions are on hold until a check or time window passes',
		rollback: 'the version running here is worse than the one before it',
		open: 'open this app'
	};

	/**
	 * THE ONE FILLED BUTTON ON THE PAGE. It goes on the highest-ranked row
	 * where a person can actually ADVANCE something — never on `investigate`,
	 * which moves nothing, and never on `unblock`, which needs nobody. `null`
	 * when there is no such row, and then the page has no primary at all,
	 * which is the correct state for a fleet with nothing to decide.
	 */
	const primaryStepApp = $derived(
		appRows.find((a) => a.step === 'approve' || a.step === 'promote')?.appName ?? null
	);

	const attnCount = $derived(appRows.filter((a) => a.rank === 0).length);
	const motionCount = $derived(appRows.filter((a) => a.rank === 1).length);

	// ── ATTENTION IS A CARD, NOT A ROW BAND. (2026-08-30) ────────────────────
	//
	// > *"i don't like that you're highlighting a stuck row like this… it feels
	// > like a bug. is this what you implemented when i said there should be a
	// > better way to mark something as needing attention rather than just a
	// > badge? there are many examples on the rest of the page that are much
	// > better."*
	//
	// The thing being rejected is the full-bleed neutral GROUND the tombstone
	// two screens up argues for. The arithmetic in that tombstone is right and
	// the conclusion was wrong: it proved that no CHROMATIC row band is
	// affordable and then reached for the only remaining channel, lightness —
	// which is the channel a browser uses for `:disabled`, for a loading
	// skeleton and for a dimmed row. A gray band on a white list does not read
	// as "look here", it reads as "this one is broken", which is what the human
	// said in three words.
	//
	// THE EXAMPLE THEY MEAN IS THE ONE ON ROLLOUT DETAIL: a filled banner for
	// the blocking fact, and titled cards for the sets. So attention is carried
	// by MEMBERSHIP OF A TITLED CARD — `Needs attention`, its own icon, its own
	// right-aligned rollup — and by the banner above it. The rows themselves are
	// identical in every card: no band, no second hover treatment, nothing that
	// can be mistaken for a rendering fault.
	//
	// The predicate is unchanged (`rank === 0` — failing or stuck, never merely
	// behind or diverged), so the card's rollup and the header's count still
	// cannot disagree.
	const attentionRows = $derived(appRows.filter((a) => a.rank === 0));
	const steadyRows = $derived(appRows.filter((a) => a.rank !== 0));
	/** The one sentence the page can say about the whole fleet. */
	const convergedCount = $derived(
		appRows.filter((a) => a.fleet.deployed > 0 && a.fleet.spread === 1).length
	);
	/**
	 * ⛔ CONVERGED IS NOT UP TO DATE, AND GREEN MAY ONLY MEAN THE SECOND.
	 * (2026-08-31)
	 *
	 * From a live critique: the page printed `4 of 4 the same version
	 * everywhere` — in GREEN, as the card's rollup — in the same viewport as
	 * a row reading `0 of 3 up to date`. Both numbers were correct. The colour
	 * was not: `convergedCount === appRows.length` says every app AGREES WITH
	 * ITSELF, which is perfectly compatible with every app being twenty builds
	 * behind, and green is the product's word for "nothing to do here".
	 *
	 * `UpToDate` already draws exactly this line per row (`allCurrent`), so
	 * the page-level rollup uses the same predicate and no new vocabulary.
	 */
	const currentCount = $derived(
		appRows.filter((a) => a.fleet.deployed > 0 && a.fleet.onHead === a.fleet.deployed).length
	);

	// ── THE PAGE'S ONE BLOCKING FACT, WITH ITS CAUSE AND ITS CONSEQUENCE ─────
	//
	// `COMPOSITION-GRAMMAR.md` §4: the blocking fact gets a FILLED banner — a
	// 40px circular icon, a bold headline, a second line carrying the concrete
	// consequence, a control on the right. That object already exists in this
	// product (`AlertPanel`, which is what rollout detail renders its schedule
	// gate and its version pin in), so this spends no new component and no new
	// colour; it just stops `/apps` being the one page that had no way to say
	// "here is why nothing is moving".
	//
	// ⛔ THE CAUSE MUST BE THE REAL CAUSE. A live UX critique of this product
	// found the app page blaming `HELD BY hello-world-manual-approval` for a
	// production that was two dozen builds behind when *"the actual cause was
	// the PIN, which the page never mentions."* A pin outranks every gate: a
	// gate holds the NEXT promotion, a pin refuses ALL of them, so while
	// `spec.wantedVersion` is set no other explanation is even reachable. It is
	// therefore checked BEFORE stuck and before lag — the only thing above it
	// is a deploy that actually failed, which is a fact about the past that a
	// pin cannot explain away.
	//
	// ONE BANNER. Not one per app. A page with six banners has none, and the
	// SET of apps that need a person is what the `Needs attention` card is for
	// — the banner's job is the single worst fact and the action that answers
	// it. When there is no blocking fact at all it renders nothing: an
	// all-clear banner is the norm being marked.
	// ⭐ TWO SHAPES, ONE SLOT. The first four branches state a fact this page
	// derives itself (a failed deploy, a pin, a stuck state); the gate branch
	// hands back a `BlockingStory` and lets `BlockingStoryPanel` render it, so
	// the sentence about gates is spelled in exactly one place in the product.
	type Blocker =
		| {
				severity: 'error' | 'warning' | 'pinned' | 'info';
				icon: typeof ExclamationCircleSolid;
				title: string;
				message: string;
				footnote?: string;
				app: string;
				pulse: boolean;
		  }
		| { story: BlockingStory; app: string };

	const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

	const blocker = $derived.by<Blocker | null>(() => {
		// 1 — A DEPLOY THAT FAILED. The only fact a pin cannot explain.
		for (const app of appRows) {
			const cell = app.cells.find((c) => c.state === 'fail');
			if (!cell) continue;
			const envs = app.cells.filter((c) => c.state === 'fail').length;
			return {
				severity: 'error',
				icon: ExclamationCircleSolid,
				title: `${app.appName} — ${cell.envLabel.toUpperCase()}’s last deploy failed`,
				// `promotes` NAMES A MECHANISM THE READER HAS NOT BEEN TAUGHT.
				// What they need is the consequence: newer versions stop here.
				message:
					envs > 1
						? `${plural(envs, 'environment')} of this app are failing. No newer version gets past them until a deploy succeeds.`
						: `No newer version gets past ${cell.envLabel.toUpperCase()} until a deploy there succeeds.`,
				footnote: cell.timestamp
					? `Last attempt ${formatTimeAgoCompact(cell.timestamp, $now)} ago · ${formatDate(cell.timestamp)}`
					: undefined,
				app: app.appName,
				pulse: true
			};
		}

		// 2 — A PIN. Checked before `stuck`, because a pinned environment is
		//     ALSO usually stuck and the pin is the thing a person can undo.
		for (const app of appRows) {
			const cell = app.heldCell;
			if (!cell) continue;
			// THE PIN SENTENCE IS `BlockReason`'S, not a second spelling of it.
			const pin = blockReason({ pinnedTo: cell.wantedVersion || cell.version });
			return {
				severity: 'pinned',
				icon: PauseSolid,
				title: `${cell.envLabel.toUpperCase()} is pinned on ${app.appName}`,
				message: `${pin ? `${pin.line}. ` : ''}${plural(
					cell.behindBy,
					'newer version'
				)} available, and none will deploy until someone releases the hold.`,
				footnote: 'Automatic updates into this environment are off, not broken.',
				app: app.appName,
				pulse: false
			};
		}

		// 3 — STUCK. A state that has lasted, with nobody holding it on purpose.
		for (const app of appRows) {
			const cell = app.cells.find((c) => c.state === 'stuck');
			if (!cell) continue;
			return {
				severity: 'warning',
				icon: ExclamationCircleSolid,
				title: `${app.appName} — ${cell.envLabel.toUpperCase()} is stuck`,
				// `unchanged for 1h` → `no progress for 1h`, the same swap the
				// rest of the pass made: "unchanged" is a fact about a field,
				// "no progress" is a fact about the deploy.
				message: cell.timestamp
					? `No progress for ${formatTimeAgoCompact(cell.timestamp, $now)} and nothing is holding it on purpose.`
					: 'No progress for long enough that it will not clear on its own.',
				app: app.appName,
				pulse: true
			};
		}

		// 4 — A GATE REFUSING EVERY CANDIDATE — and it is ONE STORY NOW, not one
		//     gate out of three.
		//
		// ⛔ WHAT THIS BRANCH USED TO DO. It ranked on
		// `awaitingApprovalGates.length > 0`, took `blockReason`'s first match,
		// and printed *"Someone has to approve a newer version"* with ONE gate
		// name in the footnote. On the live cluster prod `hello-world-app` was
		// held by three gates — `ghd-xm669` (the environment controller's),
		// `hello-world-manual-approval` (a person's) and `schedule-gate-zvsqr`
		// (**failing**) — and this page blamed the second, `/apps/<name>` named
		// the first two, and rollout detail said "1 schedule". Three surfaces,
		// three different culprits, and the failing gate on none of them.
		//
		// `blockingStory` names EVERY gate holding it and says, for each,
		// whether it clears on a clock, on another deploy, or on a person. The
		// ranking below is over ENVIRONMENTS, never over gates within one.
		//
		//     THE WORST ONE, NOT THE FIRST ONE. `cells` is in promotion order,
		//     so `find` returns DEV — the environment nearest the front of the
		//     pipeline and therefore the least consequential place to be stuck.
		//     Measured on the live cluster: it banner-ed `DEV is waiting on a
		//     gate` while PRODUCTION sat 24 builds behind. Rank instead: a block
		//     that needs a PERSON outranks one that clears itself, and within
		//     each kind the deepest lag wins.
		{
			const candidates = appRows.flatMap((app) =>
				app.cells.filter((c) => c.story.blocked && c.behindBy > 0).map((c) => ({ app, c }))
			);
			candidates.sort((x, y) => {
				const ax = x.c.story.person.length > 0 ? 0 : x.c.story.selfClearing ? 2 : 1;
				const ay = y.c.story.person.length > 0 ? 0 : y.c.story.selfClearing ? 2 : 1;
				if (ax !== ay) return ax - ay;
				return y.c.behindBy - x.c.behindBy;
			});
			const worst = candidates[0];
			if (!worst) return null;
			return { story: worst.c.story, app: worst.app.appName };
		}

		return null;
	});
</script>

<svelte:head>
	<title>kuberik | Apps</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- Page header -->
	<div class="mb-6 min-w-0">
		<h1 class="t-display min-w-0 truncate text-gray-900 dark:text-white">Apps</h1>
		{#if !query.isLoading && !query.isError && appRows.length > 0}
			<p class="t-dense mt-1 text-gray-500 dark:text-gray-400">
				{appRows.length} app{appRows.length === 1 ? '' : 's'}
				{#if attnCount > 0}
					· <span class="font-medium text-gray-700 dark:text-gray-200"
						>{attnCount} need{attnCount === 1 ? 's' : ''} attention</span
					>
				{/if}
				{#if motionCount > 0}
					· {motionCount} deploying now
				{/if}
				<!-- THE FLEET-LEVEL ANSWER TO CRITERION 1, in one number, before
				     any row is read: how many of these apps have every
				     environment on one build. It comes LAST because the two
				     counts above it are severity and severity leads — the same
				     order `/` puts its sections in. Neutral ink: this is a
				     summary of marks that are all already on screen.

				     ⛔ AND IT NAMES THE OTHER HALF WHEN THE TWO DIFFER.
				     (2026-08-31) `4 of 4 the same version everywhere` read as
				     an all-clear beside a row saying `0 of 3 up to date`, and
				     a reader cannot be expected to know that "the same
				     version" says nothing about WHICH version. Consistency and
				     currency are two facts; when they disagree, printing only
				     the flattering one is the page choosing a side. -->
				· {convergedCount} of {appRows.length} the same version everywhere{convergedCount !==
				currentCount
					? `, ${currentCount} on the newest`
					: ''}
			</p>
		{/if}
	</div>

	<!--
		⭐ THE HUB FAILS SOFT. `/api/rollouts` answers 200 with the spokes that
		replied and names the ones that did not in `clusterErrors`, so this page
		can be PARTLY true — and until now only `/` and `/rollouts` said so.
		A rollout on an unreachable spoke is absent from every count here, and
		absent is not healthy. Renders nothing when every cluster answered.
	-->
	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this list"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<!-- Skeleton mirrors the row grid, not a generic list. -->
		<div
			class="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
		>
			<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each Array(6) as _, i (i)}
					<li class="flex items-center gap-4 px-4 py-3">
						<div class="h-9 w-9 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
						<div class="flex flex-1 flex-col gap-1">
							<div class="h-3.5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
							<div
								class="h-2.5 w-56 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"
							></div>
						</div>
						<div class="hidden h-4 w-24 animate-pulse bg-gray-200 sm:block dark:bg-gray-700"></div>
						<div
							class="hidden h-4 w-16 animate-pulse bg-gray-200/70 sm:block dark:bg-gray-700/60"
						></div>
						<div
							class="hidden h-4 w-36 animate-pulse rounded bg-gray-200/70 sm:block dark:bg-gray-700/60"
						></div>
					</li>
				{/each}
			</ul>
		</div>
	{:else if query.isError}
		<!--
			⛔ WAS `Failed to load: <status code>` IN A ONE-LINE RED BOX. With
			`/api/rollouts` at 503 that left the page as a title and a whisper —
			indistinguishable at a glance from this page's own empty state, which
			is the reading that gets an operator to go back to bed at 3am. A
			request that FAILED is a different fact from one that succeeded and
			returned nothing, and `ErrorState` is the object that says so.
		-->
		<ErrorState
			error={query.error}
			subject="the app list"
			backHref="/"
			backLabel="Go to Home"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-2"
		/>
	{:else if appRows.length === 0}
		<!-- NO SAMPLE ROW. This used to render a faded FAKE row — dummy app
		     name, dummy ruler, dummy head chip — to teach the encoding before
		     any real row existed. It was the same move as the footer legend the
		     human rejected (*"explaining it with the dummy graphic"*), it had
		     already drifted out of sync with the real component (it still drew
		     the pre-2026-08-26 baseline-and-stub geometry), and a reader with
		     zero apps has nothing to read it against anyway. The encoding is
		     taught by the first real row. -->
		<div class="mx-auto max-w-2xl py-12">
			<div class="text-center">
				<p class="t-body font-semibold text-gray-900 dark:text-white">No apps yet</p>
				<p class="t-dense mx-auto mt-2 max-w-md text-gray-500 dark:text-gray-400">
					An app appears here once you bind a
					<code class="t-code-sm rounded bg-gray-100 px-1 dark:bg-gray-800">Rollout</code>
					to an
					<code class="t-code-sm rounded bg-gray-100 px-1 dark:bg-gray-800">Environment</code>
					resource. Apps consolidate the same rollout across all environments.
				</p>
			</div>
		</div>
	{:else}
		<!-- ══ THE PAGE'S ONE BLOCKING FACT ═══════════════════════════════════
		     A FILLED banner: 40px circular icon, bold headline, a second line
		     with the concrete consequence, a control on the right. It is the
		     same `AlertPanel` rollout detail renders its schedule gate and its
		     version pin in — the object `COMPOSITION-GRAMMAR.md` §4 names as
		     what *"attention pulled by design, not text"* actually looks like,
		     and the example the human meant when they rejected the gray row
		     band as *"feels like a bug"*.

		     THE INK CEILING DOES NOT GOVERN IT. That measurement was derived
		     for MARKS COMPETING ON A ROW — it is what keeps the `stuck` alarm
		     the loudest chip — and a page-level banner is not on a row and
		     competes with nothing. `alarm` is still the only CHIP with a fill.

		     ONE, NEVER ONE PER APP. The SET of apps needing a person is the
		     `Needs attention` card below; the banner's job is the single worst
		     fact, its CAUSE and the way out. -->
		{#snippet openApp(app: string)}
			<a href="/apps/{app}" class="btn btn-secondary">
				Open {app}
				<ArrowRightOutline />
			</a>
		{/snippet}
		{#if blocker && 'story' in blocker}
			{@const b = blocker}
			<BlockingStoryPanel story={b.story} class="mb-5">
				{#snippet actions()}{@render openApp(b.app)}{/snippet}
			</BlockingStoryPanel>
		{:else if blocker}
			{@const b = blocker}
			<AlertPanel
				severity={b.severity}
				icon={b.icon}
				title={b.title}
				message={b.message}
				footnote={b.footnote}
				pulse={b.pulse}
				class="mb-5"
			>
				{#snippet actions()}{@render openApp(b.app)}{/snippet}
			</AlertPanel>
		{/if}

		<div class="flex flex-col gap-4">
			<!-- ══ NEEDS ATTENTION ════════════════════════════════════════════
			     MEMBERSHIP OF THIS CARD IS THE MARK. The row inside it is
			     byte-identical to a row in the card below — no band, no second
			     hover, nothing a reader can mistake for a rendering fault. What
			     marks it is a titled card with its own icon and its own
			     right-aligned rollup, which is the device every region of
			     rollout detail uses and the one the human calls beautiful.

			     It renders only when non-empty. An empty `0 apps` card would be
			     the norm being marked, and the page is silent when the fleet is
			     healthy — the same behaviour `/` has. -->
			{#if attentionRows.length > 0}
				<!-- THE CONTAINER-QUERY SCOPE IS A DIV THIS PAGE OWNS, not the
				     `Card`'s own root. Svelte's scoped CSS is compiled per
				     component: a class passed to a child component's `class`
				     prop lands on that child's element, which never carries this
				     component's scoping hash, so `.apps-panel { container-type }`
				     silently would not apply and every row would render in its
				     390px stacked form at 1440. Measured that exact failure
				     before wrapping. -->
				<div class="apps-panel">
					<Card
						icon={ExclamationCircleSolid}
						iconClass="text-amber-600 dark:text-amber-400"
						title="Needs you"
						verdict="{attentionRows.length} of {appRows.length} app{appRows.length === 1
							? ''
							: 's'}"
						verdictTone="adverse"
						verdictTitle="Apps with an environment that is failing or has stopped moving"
						padded={false}
					>
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each attentionRows as app (app.appName)}
								<li>{@render appRow(app)}</li>
							{/each}
						</ul>
					</Card>
				</div>
			{/if}

			<!-- ══ EVERY APP ══════════════════════════════════════════════════
			     THE ROLLUP IS CRITERION 1, ANSWERED BEFORE A ROW IS READ:
			     *"which apps' fleets are consistent?"* — `3 of 4 fleets on one
			     build`. It is the `3/3 healthy` / `10/10 ready` idiom from the
			     reference page, and it goes GREEN only when the answer is all
			     of them. -->
			<div class="apps-panel">
				<Card
					icon={RocketSolid}
					title={attentionRows.length > 0 ? 'Everything else' : 'All apps'}
					verdict="{convergedCount} of {appRows.length} the same version everywhere"
					verdictTone={convergedCount === appRows.length && currentCount === appRows.length
						? 'good'
						: 'neutral'}
					verdictTitle="Counts the apps whose environments are all running one and the same version. {currentCount} of {appRows.length} are also on the newest version available to them."
					padded={false}
				>
					<!-- THE COLUMN HEADER ROW. Same idiom as `/rollouts`, which pins
				     its rows to a fixed grid under a sticky header. Three of the
				     four columns are measurements, and a measurement with no name
				     is a decoration. Hidden below the container breakpoint, where
				     each cell prints its own inline label instead. -->
					<div
						class="apps-row apps-row--head border-b border-gray-200 px-4 py-2 dark:border-gray-700"
					>
						<span class="apps-id t-label text-gray-500 dark:text-gray-400">App</span>
						<span class="apps-fleet t-label whitespace-nowrap text-gray-500 dark:text-gray-400"
							>Up to date</span
						>
						<span class="apps-act t-label whitespace-nowrap text-gray-500 dark:text-gray-400"
							>Deploys · 7d</span
						>
						<span class="apps-lead t-label text-gray-500 dark:text-gray-400">To prod</span>
						<span class="apps-step"></span>
						<span class="apps-chev"></span>
					</div>

					<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each steadyRows as app (app.appName)}
							<li>{@render appRow(app)}</li>
						{/each}
					</ul>
				</Card>
			</div>
		</div>
	{/if}
</div>

<!-- ══ ONE APP ROW ═══════════════════════════════════════════════════════════
     A SNIPPET, AND THAT IS LOAD-BEARING. It is rendered by both the
     `Needs attention` card and the `Everything else` card, and it must be the
     SAME markup in both: the moment an attention row can be styled differently
     from a steady one, the gray band comes back under another name. The card
     is the mark; the row is a row. -->
{#snippet appRow(app: AppRow)}
	<!-- ── THE ROW IS A DIV WITH A STRETCHED LINK, not an `<a>`. ──────────
	     It had to change shape to hold a button: a `<button>` inside an
	     `<a>` is invalid HTML and browsers resolve it by discarding the
	     nesting, so the control would have been unreachable by keyboard.

	     The whole row is still one click target — the app name's link
	     carries `after:absolute after:inset-0`, the standard stretched-link
	     pattern — and the step button sits above it on `z-[1]`. Focus order
	     is name, then step, which is the order a reader wants them in. -->
	<div
		class="apps-row relative px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
	>
		<!-- ── APP ──────────────────────────────────────────────────────────
		     Status circle, name, and the one sentence that names the
		     environment the shape cannot. -->
		<span class="apps-id flex min-w-0 items-center gap-3">
			<!-- `not fully promoted` WAS MISSED BY THE NOVICE PASS: a mechanism
			     word, on the column the pass had just renamed `Up to date`. It
			     is what a screen reader heard while the eye read
			     `0 of 3 up to date`. -->
			<span
				class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
					circleBakeStatus(app.circle, app.fullyOnHead)
				)}"
			>
				<BakeStatusIcon bakeStatus={circleBakeStatus(app.circle, app.fullyOnHead)} size="medium" />
				<span class="sr-only"
					>{STATUS_WORD[app.worst]}{app.fullyOnHead ? '' : ' · not up to date everywhere'}</span
				>
			</span>
			<span class="flex min-w-0 flex-col gap-1">
				<span class="flex min-w-0 items-baseline gap-2">
					<a
						href="/apps/{app.appName}"
						class="t-code min-w-0 truncate font-semibold text-gray-900 after:absolute after:inset-0 after:content-[''] dark:text-white"
						>{app.appName}</a
					>
					{#if app.desc}
						<span class="apps-desc t-micro min-w-0 truncate text-gray-500 dark:text-gray-400"
							>{app.desc}</span
						>
					{/if}
				</span>
				<!-- THE MARK ROW. `gap-x-4 sm:gap-x-6` is the denominator of the
				     proximity ratio that keeps each unit bound to itself at 4px
				     while the units sit 16-24px apart. Measured ink-to-ink at
				     1440: 11px within against 31px between, 2.82x. -->
				<span class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 sm:gap-x-6">
					{#each app.adverse as cell (cell.tier)}
						<!-- ONE ENVIRONMENT, ONE BADGE, TWO SECTIONS: `[NAME][STATE]`.
						     `wide` on the env chip is load-bearing: `.chip`'s 12ch cap
						     renders `PROD-EU-CENTRAL` as `PROD-EU…`, and three regions
						     truncated to the same eight characters is the defect that
						     killed the convergence bar. -->
						<span
							class="chip-joined shrink-0"
							title="{cell.envLabel}{cell.version ? ` · ${cell.version}` : ''} · {STATUS_WORD[
								cell.state
							]}"
						>
							<Chip
								role="env"
								theme={cell.theme}
								label={cell.envLabel}
								wide
								title="{cell.envLabel}{cell.version ? ` · ${cell.version}` : ''} · {STATUS_WORD[
									cell.state
								]}"
							/>
							{#if cell.state === 'stuck'}
								<Chip role="alarm" label="stuck" title="{cell.envLabel.toUpperCase()} is stuck" />
							{:else if cell.rank.kind === 'diverged'}
								<!-- ⛔ THE WORD IS NOT `diverged`. That is git's word for two
								     branches, and this is not that: the environment is running a
								     build that was never released to anywhere. `unreleased` is
								     the fact, in a word a reader already owns. Same red role,
								     same chip, zero colour values changed. -->
								<Chip
									role="diverged"
									label="unreleased"
									title="Running a version that is on no environment’s release list"
									wide
								/>
							{:else if cell.state === 'fail'}
								<Chip
									role="failing"
									label="failing"
									title="{cell.envLabel.toUpperCase()}’s last deploy failed"
								/>
							{/if}
						</span>
					{/each}
					{#if app.adverseMore > 0}
						<!-- COUNTED, NOT DROPPED — and NAMED in the tooltip. -->
						<span class="t-micro shrink-0 text-gray-500 dark:text-gray-400" title={app.adverseRest}
							>+{app.adverseMore} more</span
						>
					{/if}
					<!-- THE SENTENCE SAYS WHAT NO BOX SAYS. Never an environment
					     that already has one. -->
					{#if app.lede}
						<span class="t-micro truncate text-gray-500 dark:text-gray-400">{app.lede}</span>
					{/if}
				</span>
			</span>
		</span>

		<!-- ── FLEET ────────────────────────────────────────────────────────
		     Criterion 1: *"which apps' fleets are consistent?"*

		     ⛔ THE `N BUILDS` CHIP IS GONE. (2026-08-30)
		     > *"i don't like that fleet by build got simpler - it provides almost
		     > no information now."*

		     It was right. The cell had been reduced to a `2 BUILDS` chip over an
		     11px caption, which is a QUANTITY with no verdict attached: two
		     builds across three environments is completely normal mid-promotion
		     and identical in ink to two builds where one of them is three weeks
		     stale. The reader had to do the comparison the column existed to do.

		     WHAT REPLACES IT USES TWO CHANNELS AND NO LEGEND.

		       · A GLYPH FOR CONSISTENCY. `CodeMergeSolid` when every deployed
		         environment is on one build, `CodeBranchSolid` when they are
		         split, `PauseSolid` when nothing has deployed. Merge and branch
		         are LITERAL — they are what the fact looks like — so unlike the
		         four rejected strip forms there is nothing to teach. This is the
		         charge that killed those: their encoding was PROXIMITY, which a
		         reader has to be told about, and the footer legend that told them
		         was deleted.
		       · A COUNT FOR DISTANCE, at 14px, in the reference page's own
		         `3/3 healthy` / `10/10 ready` idiom: `3/3 on head`. One x down
		         fifty rows, tabular, so the column scans as a column.

		     GREEN ONLY WHEN THE ANSWER IS YES — every deployed environment on
		     head. Otherwise neutral gray, because being behind is *"the normal
		     state of a promotion pipeline"* and may not borrow an adverse hue.
		     ZERO new colour values: the one product green and the muted gray.

		     The caption carries what the mark cannot — the spread, and the
		     states that have no distance (`pending`, `diverged`, `unknown`) —
		     and never restates the mark. -->
		<span class="apps-fleet flex min-w-0 flex-col gap-1">
			<span class="apps-inline-label t-label whitespace-nowrap text-gray-500 dark:text-gray-400"
				>Up to date</span
			>
			<!-- ⛔ `N/M ON HEAD` IS GONE, AND ONLY THE WORDS CHANGED. (2026-08-30)
			     `head` is git's name for a pointer, not a person's name for a
			     state, and `0/3 on head` gives a reader who has never seen this
			     tool no way to tell whether it is bad. `1 of 7 up to date` is
			     the same numerator, the same denominator, the same two glyphs
			     and the same two colour values.

			     It is `UpToDate` now rather than inline markup because
			     `/environments` and `/apps/[name]` ask the identical question
			     and were spelling it three different ways. A reader should
			     learn this object ONCE. -->
			<UpToDate
				onHead={app.fleet.onHead}
				deployed={app.fleet.deployed}
				total={app.fleet.total}
				spread={app.fleet.spread}
				pending={app.fleet.pending}
				diverged={app.fleet.diverged}
				unknown={app.fleet.unknown}
				title={app.fleetFull}
			/>
		</span>

		<!-- ── DEPLOYS · 7d ─────────────────────────────────────────────────
		     Criterion 2. Below `SPARK_MIN` the count stands alone: a sparkline
		     of empty buckets is a shrug drawn at the size of data. The
		     last-deploy time lives here because volume and recency are one
		     question — is this app churning or asleep. -->
		<span class="apps-act flex min-w-0 flex-col gap-1">
			<span class="apps-inline-label t-label whitespace-nowrap text-gray-500 dark:text-gray-400"
				>Deploys · 7d</span
			>
			<!-- THE CHART SITS IN THE SAME 20px MARK LINE the fleet verdict and
			     the lead figure do, and it HOLDS that height when there is no
			     chart, so a row with a sparkline and a row without share a
			     baseline at 390. -->
			<span class="apps-mark flex items-center gap-1.5">
				{#if app.deploys7d >= SPARK_MIN}
					<DeployVolumeSparkline rollouts={app.rolloutsForSpark} days={SPARK_DAYS} />
				{:else}
					<span class="t-body font-medium text-gray-900 tabular-nums dark:text-white"
						>{app.deploys7d}</span
					>
				{/if}
			</span>
			<span class="t-micro truncate text-gray-500 dark:text-gray-400"
				>{app.deploys7d} deploy{app.deploys7d === 1 ? '' : 's'}{#if app.mostRecentTs}{' · '}<span
						title={formatDate(app.mostRecentTs)}
						>{formatTimeAgoCompact(app.mostRecentTs, $now)} ago</span
					>{/if}</span
			>
		</span>

		<!-- ── LEAD ─────────────────────────────────────────────────────────
		     Criterion 3. Median MEASURED time from the first environment to the
		     first production region. An em-dash when no build has been observed
		     making the whole trip inside the retained history — never an
		     estimate.

		     THE CLOCK IS NOT DECORATION. This column and `Deploys · 7d` both
		     print a bare number in the same 20px band; the glyph is what tells
		     them apart at a glance once the inline labels drop away at desktop
		     width. -->
		<span class="apps-lead flex min-w-0 flex-col gap-1">
			<span class="apps-inline-label t-label text-gray-500 dark:text-gray-400">To prod</span>
			{#if app.lead}
				<span
					class="apps-mark flex items-center gap-1.5"
					title="Typical time a version takes to get from {app.lead.fromLabel} to {app.lead.toLabel}, measured over {app.lead.samples} version{app.lead.samples === 1
						? ''
						: 's'} that made the whole trip"
				>
					<ClockSolid class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
					<span class="t-body font-medium text-gray-900 tabular-nums dark:text-white"
						>{compactSpan(app.lead.medianMs)}</span
					>
				</span>
				<span class="t-micro truncate text-gray-500 dark:text-gray-400"
					>{app.lead.fromLabel} → {app.lead.toLabel}</span
				>
			{:else}
				<span
					class="apps-mark flex items-center gap-1.5"
					title="No version has gone all the way from the first environment to production inside the deploy history kept for this app"
				>
					<ClockSolid class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
					<span class="t-body text-gray-500 dark:text-gray-400">—</span>
				</span>
				<span class="t-micro truncate text-gray-500 dark:text-gray-400">no full trip yet</span>
			{/if}
		</span>

		<!-- THE ROW IS A LINK AND SAYS SO. Every list on rollout detail that
		     drills through carries this chevron (`Show 8 ready resources ›`,
		     the resource rows); `/apps` was the one list in the product whose
		     rows were navigable with nothing on them to say it. -->
		<!-- ── THE NEXT STEP ────────────────────────────────────────────────
		     `DESIGN-INTENT.md`: *"showing a problem without offering the action
		     is an unfinished design."* Every row that states a problem now
		     names the step, and every row that does not renders NOTHING — an
		     action on every row is a column of noise and would be marking the
		     norm.

		     THIS IS ALSO THE PAGE'S ENTRY POINT. Before it, four rows were
		     near-identical and the eye had nowhere to land but the banner; the
		     one filled button is now the obvious place to start and everything
		     else recedes, which is the whole of the "draw the reader in" ask.

		     ONE FILLED PRIMARY, on the row where a person can actually advance
		     something (`approve` / `promote`). `investigate` and `unblock` stay
		     secondary: neither moves anything. The banner's own control is
		     `.btn-secondary` on a filled ground, so the page still has exactly
		     one blue button. -->
		{#if app.step}
			<span class="apps-step relative z-[1] flex items-center justify-end">
				<NextStep
					step={app.step}
					href="/apps/{app.appName}"
					primary={app.appName === primaryStepApp}
					subject={app.appName}
					title="{app.stepEnv} — {STEP_WHY[app.step]}"
				/>
			</span>
		{/if}

		<span class="apps-chev flex items-center justify-end">
			<ChevronRightOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
		</span>
	</div>
{/snippet}

<style>
	/* THE PANEL IS ITS OWN CONTAINER. Every breakpoint below is a container
	   query against the panel's real width, never the viewport's: the sidebar
	   is 176px at `sm`+ and absent below it, so a 639px viewport gives this
	   panel 607px and a 640px viewport gives it 416px. A viewport media query
	   flips the layout the wrong way across that boundary. */
	.apps-panel {
		container-type: inline-size;
	}

	/* ── PHONE FORM. Designed at 390, not derived from the table. ─────────
	   Row 1 is IDENTITY AND NOTHING ELSE. It used to be `id head` — the name
	   sharing 326px with the `head <sha>` chip and its `3 envs · 2h ago` line —
	   and the arithmetic does not work: 326 − 36 (circle) − 12 (gap) − ~110
	   (the head cell) leaves ~168px for a name and a description, so EVERY app
	   rendered as `hello-worl… Hello Wor…`. The primary identifier, ellipsised,
	   on the page the human opens most. The chip moved into the fleet band
	   where it belongs (it names the strip's first run), the description is
	   dropped at this width entirely (`.apps-desc`), and the name now has the
	   full 278px — six characters more than the longest app name on either
	   fixture.

	   Row 2 is the fleet cell, full width. Row 3 pairs the two SCALAR
	   measurements, which are the two that fit side by side at 358px of
	   content box.

	   The column header is dropped here and each cell prints its own inline
	   `t-label` instead: a header row of four labels over a stacked layout
	   labels nothing. */
	.apps-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		grid-template-areas:
			'id    id'
			'fleet fleet'
			'lead  act'
			'step  step';
		align-items: start;
		column-gap: 12px;
		row-gap: 12px;
	}

	/* ── THE STEP IS FULL WIDTH ON A PHONE, AND IT IS THE LAST THING IN THE
	   CARD. A 44px-tall control stretched across the card is the one element
	   here that a thumb is actually meant to hit, and putting it under the
	   measurements rather than beside the name is the order the reader wants:
	   what is this, how is it doing, what do I do. `:empty` collapses the
	   row entirely on the rows that have no step, so a settled card is not
	   12px taller than it needs to be. */
	.apps-step {
		grid-area: step;
		/* A GRID ITEM'S FLOOR IS `min-content` UNLESS YOU SAY OTHERWISE, and
		   the button inside is `white-space: nowrap`, so min-content is the
		   whole label. Without this the CELL silently grows past its track
		   instead of the track being wrong in a way anyone can see. */
		min-width: 0;
	}
	.apps-step :global(.btn) {
		width: 100%;
	}

	/* THE CHEVRON IS DESKTOP-ONLY. At 390 the whole card is the tap target and
	   a 16px glyph in the corner of a three-row stack has nothing to point at;
	   the affordance it buys on a table row is bought by the card itself
	   here. */
	.apps-chev {
		display: none;
	}

	/* THE DESCRIPTION IS NOT A PHONE FACT. `status.title` is free text beside
	   a name that is already truncating; at 390 it rendered `Hello Wor…` on two
	   different apps and `Hello De…` on two more — four rows, two strings, zero
	   information, taking width from the one field that identifies the row.
	   It returns at the container breakpoint, where the App track is ~230px+
	   and both can be read whole. */
	.apps-desc {
		display: none;
	}

	.apps-row--head {
		display: none;
	}

	.apps-id {
		grid-area: id;
	}
	.apps-fleet {
		grid-area: fleet;
	}

	/* THE MARK LINE. Exactly 20px — a chip's own height — and it HOLDS THAT
	   HEIGHT WHEN IT IS EMPTY, which is the whole reason a converged fleet can
	   print no chip at all without the caption under it sliding up into the
	   band where every other row draws one. Same device, same number, as
	   `/environments`'s `.env-line`. */
	.apps-mark {
		min-height: 20px;
	}
	/* ── THE PHONE CARD IS LEFT-ALIGNED, ALL OF IT. ─────────────────────
	   > *"Environments list is a problem on mobile."* — the human, about the
	   sibling page; this card had the same defect one grade milder.

	   `Deploys · 7d` used to be `align-items:flex-end; text-align:right`, so
	   at 390 the card ran `LEAD` flush left and `DEPLOYS · 7D` flush right on
	   the same three lines. Both blocks carry their own `t-label`, so nothing
	   was orphaned the way `/environments`'s bare `−4` was — but two blocks
	   reading toward opposite edges is still a table's justification surviving
	   into a stack, and their value lines did not share a baseline (measured:
	   the sparkline row's caption at y170 against `not observed` at y171 on
	   one card and y150 against y171 on the next).

	   Both columns are flush left now, both are `minmax(0,1fr)` so the second
	   starts at one x on every card, and both put their value in the 20px
	   `.apps-mark` band so label / value / caption are three shared baselines.
	   The right edge returns at the container breakpoint, where `Lead` is the
	   last track of a real table and a ragged right edge there reads as an
	   accident. */
	.apps-act {
		grid-area: act;
		align-items: flex-start;
		text-align: left;
	}
	.apps-lead {
		grid-area: lead;
	}

	/* ── DESKTOP FORM: FOUR fixed tracks. ───────────────────────────────
	   The Fleet track is 164px, measured up from 148: the widest caption on
	   either fixture is `payments-core`'s `2 of 9 on head · 1 diverged` at
	   ~160px, and at 148 it ellipsised to `1 diverg…` — a truncation that eats
	   the one word in the caption that names an adverse state. It was 232px when it held a 96px
	   strip, an 8px gap and a 128px `head <sha>` chip; the 84px it gives back
	   goes to `App`, which is where the adverse boxes and the lede live.

	   720px is where `App` still clears enough content box after the three
	   measurement columns take their fixed widths — below that the app name and
	   its lede start competing for the same space and the sentence that names
	   the failing environment is the thing that ellipsises.

	   Every non-flexible track is a FIXED width. `auto` was tried and reverted
	   product-wide: each row is its own grid, so an intrinsic track sizes per
	   row and the columns stop lining up down the list. One flexible track,
	   everything else fixed. */
	/* ── THE STEP TRACK APPEARS AT 900px OF PANEL, NOT AT 720. ────────────
	   Measured, not chosen. The five existing tracks plus a 200px step and
	   five 16px gaps plus the panel's own `px-4` take 720px, and the app-name
	   track needs ~180px before the longest name in either fixture starts
	   ellipsising — the one string on the row a reader navigates by. 900 is
	   the first width where both fit with the chip row still able to wrap
	   beside them.

	   Between 720 and 899 the row keeps its five-track form and the step
	   goes back to being a full-width band under it, exactly as on a phone:
	   the control is never hidden, only moved. `grid-template-areas` on the
	   720 rule below therefore keeps a `step` row. */
	@container (min-width: 720px) and (max-width: 899px) {
		.apps-step :global(.btn) {
			width: auto;
		}
	}

	@container (min-width: 720px) {
		.apps-row {
			/* Five fixed tracks now: the 20px chevron is the fifth. Every
			   non-flexible track is a FIXED width — `auto` was tried and
			   reverted product-wide, because each row is its own grid and an
			   intrinsic track sizes per row, so the columns stop lining up
			   down the list. One flexible track, everything else fixed. */
			grid-template-columns: minmax(0, 1fr) 164px 128px 96px 20px;
			grid-template-areas:
				'id fleet act lead chev'
				'step step step step step';
			align-items: center;
			column-gap: 16px;
			row-gap: 12px;
		}

		.apps-chev {
			display: flex;
			grid-area: chev;
		}

		.apps-row--head {
			display: grid;
			align-items: center;
		}

		.apps-act {
			align-items: flex-start;
			text-align: left;
		}

		/* `Lead` is the last track now, so it takes the alignment `Head` used
		   to: a list panel whose right edge is ragged reads as an accident. */
		.apps-lead {
			align-items: flex-end;
			text-align: right;
		}

		.apps-row--head .apps-lead {
			text-align: right;
		}

		.apps-desc {
			display: block;
		}

		.apps-inline-label {
			display: none;
		}

		/* The header cells are labels, not stacks. */
		.apps-row--head > span {
			display: block;
		}
	}

	/* ── SIX TRACKS. The step gets its own column and stops being a band.
	   ⛔ THE TRACK IS 200px BECAUSE THE WIDEST BUTTON IS 197.3px. Do not
	   shrink it back.

	   THE DEFECT IT FIXES, measured on the live cluster at 1440 in light:
	   the track was 158px, `Choose a version` renders at 178.5px, and the
	   cell is `justify-end` — so the button hung 20px PAST ITS OWN TRACK to
	   the LEFT and painted itself over the `To prod` cell, whose content ran
	   to x=1189 while the button started at x=1185. On the one row that has
	   a button. It reads as a rendering fault, which is the exact class of
	   defect the gray row-band was rejected for twice.

	   A fixed track cannot be sized by its content (`auto` was tried and
	   reverted product-wide: each row is its own grid, so an intrinsic track
	   sizes per row and the columns stop lining up down the list). So the
	   track is sized to `NextStep`'s LONGEST LABEL instead, measured in the
	   browser at 14px/500 with the 16px icon, the 8px gap and 16px of padding
	   on each side:

	     See what's blocking  197.3   Go back a version  183.9
	     Choose a version     178.5   Release the hold   174.8
	     Deploy newest        161.8   Investigate        136.2   Open  95.4

	   ⚠️ IF A LABEL IS ADDED TO `NextStep`, RE-MEASURE. The `max-width` below
	   is the seatbelt, not the fix: it makes a too-long label WRAP inside its
	   own track rather than paint over the column beside it, because a button
	   covering a value is worse than a button that wraps. */
	@container (min-width: 900px) {
		.apps-row {
			grid-template-columns: minmax(0, 1fr) 164px 128px 96px 200px 20px;
			grid-template-areas: 'id fleet act lead step chev';
			row-gap: 0;
		}

		.apps-step :global(.btn) {
			width: auto;
			max-width: 100%;
			white-space: normal;
		}
	}
</style>
