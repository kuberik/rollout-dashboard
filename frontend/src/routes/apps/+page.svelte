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
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { groupRolloutsByApp, displayVersionForTag } from '$lib/version-utils';
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
		joinClauses,
		type GateContext,
		type BlockingStory,
		type ClassifiedGate
	} from '$lib/view-models/blocking-story';
	import { sourceClusterName } from '$lib/source-dashboard';
	import { fetchScheduleObjects, type ScheduleObject } from '$lib/api/schedules';
	import BlockingStoryPanel from '$lib/components/BlockingStoryPanel.svelte';
	import type { PromotionBlock } from '$lib/view-models/promotion';
	import type { FleetEnv, FleetStripVM, FleetTone } from '$lib/view-models/fleet-strip';
	import { leadTime, compactSpan, median } from '$lib/view-models/lead-time';
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
	import { cardStateMark } from '$lib/rollout-cards';
	import type { CardStateMark } from '$lib/rollout-cards';
	import Chip from '$lib/components/Chip.svelte';
	import Card from '$lib/components/Card.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList, { type Fact } from '$lib/components/FactList.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import UpToDate from '$lib/components/UpToDate.svelte';
	// `NextStep` the COMPONENT is no longer rendered here — the page has no
	// action to spend a button on — but its `Step` union is still the
	// vocabulary `nextStep()` classifies into, and `/environments`,
	// `/envs/[name]` and `/activity` still render it. The type stays; the
	// import of the component does not.
	import type { Step } from '$lib/components/NextStep.svelte';
	// THE BANNER BORROWS `BlockReason`'S SENTENCE, NOT ITS MARKUP. The
	// component paints `gray-500` prose for a white card; the banner is a
	// filled amber field and owns its own ink. Sharing the FUNCTION is what
	// stops the most-read line on the page from spelling the fact a second
	// way, which is exactly what it was doing.
	import { blockReason } from '$lib/components/BlockReason.svelte';
	// ⭐ P9 — ONE VERB FOR THE UNPIN ACTION, EVERYWHERE. (2026-09-03, operator
	// walk) `pin-copy.ts` is the nav lane's single spelling of the trigger
	// (`Clear pin`, sentence case) so this page's link, `ClearPinModal`'s
	// title and rollout detail's own button cannot drift back to four labels
	// for one action.
	import { CLEAR_PIN_LABEL } from '$lib/components/pin-copy';
	import ActivityRail from '$lib/components/ActivityRail.svelte';
	import HowItsGoing from '$lib/components/HowItsGoing.svelte';
	import {
		RocketSolid,
		ExclamationCircleSolid,
		ClockSolid,
		ClockOutline,
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
		rolloutsListQueryOptions({
			options: { staleTime: 15000, refetchInterval: pollWhenHealthy(15000) }
		})
	);

	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

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
		/**
		 * THE ENVIRONMENT'S OWN NAME, unshortened. `envLabel` is a display
		 * string (`PROD`, and a REGION in a fan-out), so it cannot be used to
		 * address the environment. `Release the hold` needs to name one, and a
		 * CTA that cannot say which environment it means is the CTA that landed
		 * on the wrong control.
		 */
		envName: string;
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
		 * THE SAME BUILD, UNDER THE NAME THE REST OF THE PRODUCT USES
		 * (`991829b`, not the sixty-character OCI tag). Resolved once, in
		 * `classifyCell`, through `version-utils.displayVersionForTag`.
		 */
		wantedDisplay: string | null;
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
		 *
		 * ⛔ SUBJECTED `<app> in <TIER>`, not `<TIER>`. Only the page-level
		 * banner renders it, and that banner is above every card. See
		 * `classifyCell`.
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
		 * ⭐ A GATE, NOT A PIN, IS REFUSING EVERY CANDIDATE SOMEWHERE IN THE
		 * FLEET. (2026-09-02, disc consistency pass) NOT the same fact as
		 * `heldCell` above — that is `pinned && behind`, a PERSON's choice.
		 * This is `story.blocked` (`view-models/blocking-story`, the same
		 * classification the row's own `lede` already reads for its
		 * `"… has N newer versions held"` sentence), true when a
		 * `RolloutDependency` or similar contract, not a person, is the
		 * reason nothing newer has arrived. It is what the row's DISC needs:
		 * `circleBakeStatus` used to fall back to gray `PauseSolid` for BOTH
		 * "merely behind" and "held by a gate", which is the same visual as
		 * `bakeStatus: 'None'` (never deployed) for a fact that is neither.
		 * `cardStateMark` — the ONE precedence `/` and `/rollouts` already
		 * use — gives it the shared green-disc pause glyph instead, so the
		 * SAME `hello-frontend-app` reads the same mark everywhere.
		 */
		gateHeld: boolean;
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
		/** The environment the step acts on, unshortened — for addressing it. */
		stepEnvName: string;
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
		wantedDisplay: string | null;
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
		// ⛔ AND THE TAG IS NOT A NAME A READER CAN USE. (2026-08-31) The banner
		// below printed `wantedVersion` verbatim, so a live critique found this
		// page saying *"Held on
		// main-1787999329-991829b6ab3bdb0100ac0a44d8867460732159f7 on purpose"* —
		// sixty characters naming a build that every OTHER surface in the
		// product, this page's own rows included, calls `991829b`. The tag is
		// kept beside it because it is the addressable form; the DISPLAY name is
		// resolved through `displayVersionForTag`, the one shared lookup.
		const wantedDisplay = wantedVersion
			? displayVersionForTag(rollout, wantedVersion) || wantedVersion
			: null;
		const block = promotionBlock(rollout);
		// ⛔ SUBJECTED WITH THE APP, BECAUSE THE ONLY THING THAT RENDERS THIS
		// STORY IS THE PAGE-LEVEL BANNER, AND THE BANNER SITS ABOVE ALL FOUR
		// APP CARDS. Without `subject` the headline read *"DEV is waiting on
		// another deploy"* on a page listing four apps across three
		// environments — a claim about the ENVIRONMENT, which is a different
		// and false statement. The body named the upstream app and the button
		// named the waiting one, and a reader takes the headline on its own:
		// on a phone the body wraps to five lines underneath it.
		//
		// `/environments` fixed exactly this in `e61afd7` with the same call
		// (`pageStory` there, because that page ALSO renders the unsubjected
		// story inside its per-environment cards). This page renders only the
		// banner, so there is one story and it carries the app.
		const story = blockingStory(rollout, ctx, {
			place: tier,
			subject: `${group.appName} in ${tier.toUpperCase()}`,
			now: refNow
		});

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
			return { state: 'fail', theme, held, wantedVersion, wantedDisplay, block, story, timestamp };
		if (stuckReason)
			return { state: 'stuck', theme, held, wantedVersion, wantedDisplay, block, story, timestamp };
		if (bakeStatus === 'Deploying')
			return {
				state: 'deploying',
				theme,
				held,
				wantedVersion,
				wantedDisplay,
				block,
				story,
				timestamp
			};
		if (bakeStatus === 'InProgress')
			return {
				state: 'baking',
				theme,
				held,
				wantedVersion,
				wantedDisplay,
				block,
				story,
				timestamp
			};
		if (vm.statusKey === 'pending')
			return {
				state: 'pending',
				theme,
				held: false,
				wantedVersion,
				wantedDisplay,
				block,
				story,
				timestamp
			};
		// ⛔ `behindBy === 0` IS NOT `onNewest`. (2026-08-30) `rankBehindBy`
		// returns 0 for THREE different verdicts — `newest`, `diverged` and
		// `unknown` — and `matrix.ts`'s own doc comment says so. Testing the
		// number therefore filed "we cannot resolve this comparison" under
		// the page's good-news state. The verdict decides; the number is for
		// counting only.
		if (vm.rank.kind === 'newest')
			return {
				state: 'onNewest',
				theme,
				held,
				wantedVersion,
				wantedDisplay,
				block,
				story,
				timestamp
			};
		const behindState: CellState = vm.behindBy >= 2 ? 'behind2' : 'behind1';
		return {
			state: behindState,
			theme,
			held,
			wantedVersion,
			wantedDisplay,
			block,
			story,
			timestamp
		};
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
	 *
	 * ⛔ SUPERSEDED IN PART, 2026-09-02. That gray pause was ALSO what a
	 * GATE-HELD fleet painted — `hello-frontend-app`, blocked in all three
	 * environments by a `RolloutDependency` contract, drew the exact same
	 * disc as an app nobody has bothered to promote in three weeks. Those are
	 * different facts (one clears when a person or an upstream release moves;
	 * the other clears whenever anyone runs `Promote`) and `/` and
	 * `/rollouts` already had a mark for the first one — `cardStateMark`'s
	 * `held`, a PAUSE glyph on the deploy's own GREEN disc, not a gray one.
	 * `gateHeld` (the row's own `story.blocked` union, computed once where
	 * the cells are built) routes here now, ahead of the plain "not fully on
	 * head" fallback, and returns the SAME `CardStateMark` object every other
	 * list surface reads — reusing the function via a synthetic single-field
	 * input, since this row is an aggregate over N rollouts and has no ONE
	 * `RolloutCard` to hand it. "Merely behind, nothing holding it" is
	 * untouched: still gray, still `PauseSolid`, still `None`.
	 */
	function circleBakeStatus(
		state: CellState,
		fullyOnHead: boolean,
		gateHeld: boolean
	): { bakeStatus: string | undefined; mark: CardStateMark | null } {
		switch (state) {
			case 'fail':
				return { bakeStatus: 'Failed', mark: null };
			case 'deploying':
				return { bakeStatus: 'Deploying', mark: null };
			case 'baking':
				return { bakeStatus: 'InProgress', mark: null };
			case 'pending':
				return { bakeStatus: 'None', mark: null };
			default:
				// onNewest / behind1 / behind2 — the deploy itself succeeded, so
				// the question is no longer "did it work" but "did it arrive".
				if (gateHeld) {
					return {
						bakeStatus: 'Succeeded',
						mark: cardStateMark({ rolledBack: null, pinnedVersion: null, held: true })
					};
				}
				return { bakeStatus: fullyOnHead ? 'Succeeded' : 'None', mark: null };
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
	function nextStep(cells: RowCell[]): { step: Step; env: string; envName: string } | null {
		const pick = (step: Step, c: RowCell) => ({
			step,
			env: c.envLabel.toUpperCase(),
			envName: c.envName
		});
		const fail = cells.find((c) => c.state === 'fail');
		if (fail) return pick('investigate', fail);
		const held = cells.find((c) => c.held);
		if (held) return pick('unpin', held);
		// ⛔ `awaitingApprovalGates` IS NOT "NEEDS A PERSON", AND THIS PAGE
		// CONTRADICTED ITS OWN BANNER OVER IT. (2026-09-02) It means only that
		// the gate published an allow-list, and the environment controller AND
		// the dependency controller both publish one — three of the four gate
		// writers land in this bucket. Measured on the live cluster,
		// `hello-frontend-app` is held by `dependency-hello-frontend-needs-api`
		// (its next build wants `api ^1.67.0`; `hello-api-app` ships `1.66.0`),
		// so this page drew a FILLED BLUE `Choose a version` 40px under its own
		// banner reading *"Nobody has to approve anything — this clears when
		// the deploy in front of it lands."* There is no version to choose:
		// picking one by hand would override a semver contract.
		//
		// `story.person` is the classified bucket — a join on the published
		// owner reference, never a name pattern — and `blockingStory` is
		// already computed for every cell on this page. Same fix, same
		// argument, as `/apps/<name>`'s own `stuckFor`.
		const approve = cells.find((c) => c.story.person.length > 0 && c.behindBy > 0);
		if (approve) return pick('approve', approve);
		const stuck = cells.find((c) => c.state === 'stuck');
		if (stuck) return pick('investigate', stuck);
		const ready = cells.find((c) => c.block.deployableCount > 0 && c.behindBy > 0);
		if (ready) return pick('promote', ready);
		const waiting = cells.find((c) => c.block.notPassingGates.length > 0 && c.behindBy > 0);
		if (waiting) return pick('unblock', waiting);
		return null;
	}

	/**
	 * ⭐ THE FOLD KEY FOR "SAME CAUSE, DIFFERENT ENVIRONMENT" — mirrors
	 * `/apps/[name]`'s own `causeKey` byte-for-byte (2026-09-02). `kind|clause
	 * |clearsAt`, never a gate `id`: a dependency contract writes one
	 * `RolloutDependency` gate PER NAMESPACE, so DEV, STAGING and PROD each
	 * carry a different generated name for the identical fact. Promotion
	 * gates are excluded when a real cause sits beside them — the pipeline
	 * ordering gate is the same on every stalled environment and would
	 * silently merge unrelated causes if it were counted.
	 */
	function causeKey(story: BlockingStory): string {
		const own = story.gates.filter((g: ClassifiedGate) => g.kind !== 'promotion');
		const gates = own.length > 0 ? own : story.gates;
		return gates
			.map((g: ClassifiedGate) => `${g.kind}|${g.clause}|${g.clearsAt ?? ''}`)
			.sort()
			.join('¦');
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

	/**
	 * `status.history` reduced to what `lead-time.ts` reads.
	 *
	 * ⛔ `inFlight` MARKS A DEPLOY THAT HAS NOT SETTLED YET, SO `leadTime` CAN
	 * LEAVE IT OUT OF BOTH ENDS OF THE HOP. (2026-09-03, operator-walk finding
	 * 18) `status.history[].timestamp` is written the instant a deploy
	 * STARTS, not once it succeeds — see `lead-time.ts`'s module doc for the
	 * live flip this caused (`Typical to prod` going `11m → — no full trip
	 * yet → 11m` across one deploy). Same shape `HomeRail.svelte` and
	 * `/apps/[name]`'s own `appLead` build for the identical reason.
	 */
	function leadDeploys(cell: AppCell) {
		const out: { version: string; ms: number; inFlight: boolean }[] = [];
		for (const h of cell.rollout.status?.history ?? []) {
			const v = getDisplayVersion(h.version);
			if (!v || !h.timestamp) continue;
			const ms = new Date(h.timestamp).getTime();
			if (Number.isFinite(ms))
				out.push({
					version: v,
					ms,
					inFlight: h.bakeStatus === 'InProgress' || h.bakeStatus === 'Deploying'
				});
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
				const { state, theme, held, wantedVersion, wantedDisplay, block, story, timestamp } =
					classifyCell(group, tier, vm, refNow, gateContext);
				cells.push({
					tier,
					envLabel: shortEnvLabel(vm.envName) || vm.envName,
					envName: vm.envName,
					theme,
					version: vm.version,
					rank: vm.rank,
					behindBy: vm.behindBy,
					state,
					held,
					wantedVersion,
					wantedDisplay,
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
				// on a page whose whole subject is distance is the one word it
				// could not afford to leave out.
				//
				// ⛔ AND THE SECOND END IS NOT "THE NEWEST". (2026-08-31) `behindBy`
				// is `rankBehindBy`, which since 8bfa829 counts THIS ROLLOUT'S OWN
				// `availableReleases` — so two environments running the identical
				// sha legitimately print different numbers, and `behind the newest`
				// is false for at least one of any such pair. That commit's whole
				// argument was *"fix the SUBJECT, not the denominator"*; this
				// sentence was still carrying the old subject, in the page's most
				// prominent one-line summary, while `rankTitle` beside it already
				// said the correct thing. Same words as `rankTitle` now, so the
				// lede and the chip's own tooltip cannot disagree.
				//
				// ⛔ `CAN STILL TAKE` IS A CLAIM ABOUT DEV BEING FREE, AND A HELD
				// ENVIRONMENT IS NOT. (2026-09-02) `worstFree` is free of a BOX
				// (failing/stuck/diverged), not free of a GATE — a dependency
				// contract refusing every candidate leaves the cell looking
				// identical to one nobody has promoted into yet. `story.blocked`
				// is the same classification the banner above reads, so the two
				// cannot disagree: a rollout with a newer build waiting behind a
				// gate is HELD, the same word the `blocked` role chip already
				// prints on rollout detail's own pin (`Chip role="blocked" label
				// ="held"`), not free to accept anything.
				//
				// ⛔ AND THE LEDE MAY NOT SCOPE A FLEET-WIDE FACT TO ONE
				// ENVIRONMENT. (Operator walk, finding 9) `hello-frontend-app` is
				// held in ALL THREE environments by the SAME contract, but the
				// row printed `DEV has 1 newer version held` — true of DEV alone
				// and silent about staging and prod, directly under a panel that
				// says all three are held. The row's lede has to agree with the
				// panel's subject.
				//
				// `peers` is every free (unboxed) environment sharing `worstFree`'s
				// own fact — same distance, and, when held, the SAME CAUSE
				// (`causeKey`, the fold key `/apps/[name]` and `/environments`
				// already use for "same cause, different environment"). A "can
				// still take" fact has no gate to key on, so two environments
				// tied on distance are already the same fact.
				const worstFreeStory = worstFree?.story ?? null;
				const peers = worstFree
					? freeLagging.filter(
							(c) =>
								c.behindBy === worstFree.behindBy &&
								c.story.blocked === worstFreeStory!.blocked &&
								(!worstFreeStory!.blocked || causeKey(c.story) === causeKey(worstFreeStory!))
						)
					: [];
				const subject =
					peers.length <= 1
						? worstFree?.envLabel.toUpperCase()
						: peers.length === cells.length
							? `all ${cells.length} environments`
							: joinClauses(peers.map((c) => c.envLabel.toLowerCase()));
				lede = worstFree
					? worstFree.story.blocked
						? `${subject} ${peers.length <= 1 ? 'has' : 'have'} ${worstFree.behindBy} newer version${worstFree.behindBy === 1 ? '' : 's'} held`
						: `${subject} can still take ${worstFree.behindBy} newer version${worstFree.behindBy === 1 ? '' : 's'}`
					: '';
			}

			const step = nextStep(cells);

			rows.push({
				step: step?.step ?? null,
				stepEnv: step?.env ?? '',
				stepEnvName: step?.envName ?? '',
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
					),
				gateHeld: cells.some((c) => c.story.blocked)
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

	/*
	 * ⛔ `primaryStepApp` IS GONE, AND SO IS THE PAGE'S LAST BUTTON.
	 * (2026-09-02) It chose which row got the FILLED control, and every
	 * candidate it could choose between was an `<a href="/apps/<name>">`. A
	 * filled primary is reserved for the action that changes what is running,
	 * and this page performs no actions — see the step's own block in the
	 * markup. `/apps` now renders ZERO `<button>`s and zero `.btn`s.
	 */

	const attnCount = $derived(appRows.filter((a) => a.rank === 0).length);
	const motionCount = $derived(appRows.filter((a) => a.rank === 1).length);
	/**
	 * ⭐ THE HEAD'S THIRD SEVERITY, AND THE CARD ROLLUP'S ONLY ONE. (Operator
	 * walk, finding 10) `gateHeld` is the row's own `story.blocked` union —
	 * a newer build exists and a contract, not a person, is refusing every
	 * candidate. Deliberately NOT folded into `attnCount`: per `CLAUDE.md`'s
	 * "a gate correctly refusing a candidate is not a stoppage" rule, a held
	 * promotion does not need a person the way `failing`/`stuck` do, so it
	 * keeps its own, quieter, count rather than inflating `Needs you`.
	 */
	const blockedCount = $derived(appRows.filter((a) => a.gateHeld).length);

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
	/**
	 * ⛔ `convergedCount` ("the same version everywhere") IS GONE. (Operator
	 * walk, finding 10) It was a fact that is trivially true whenever a fleet
	 * is uniformly stuck — every environment agreeing with itself says
	 * nothing about whether that one build is the right one — and both its
	 * call sites (the head band, the "All apps" card rollup) now lead with
	 * `blockedCount` instead, which can actually be false.
	 *
	 * ⛔ CONVERGED WAS NEVER UP TO DATE, AND GREEN MAY ONLY MEAN THE SECOND.
	 * (2026-08-31) `UpToDate` already draws that line per row (`allCurrent`);
	 * `currentCount` below is the same predicate at page scope.
	 */
	const currentCount = $derived(
		appRows.filter((a) => a.fleet.deployed > 0 && a.fleet.onHead === a.fleet.deployed).length
	);

	/* ══ THE RAIL'S THREE NUMBERS ═══════════════════════════════════════════
	   Every one of them is a fleet-scope reading of a quantity ALREADY on a
	   row, restated at the scope the rows cannot reach. Nothing here is a new
	   measurement and nothing here is derived from data the page did not
	   already fetch — see the note on the rail markup for why the rail exists
	   at all. The three are deliberately the same three `/envs/[name]`'s own
	   `How it's going` card prints, in the same order, so the two sibling
	   pages teach one object once. */

	/** Deploys across every app in the sparkline's own window. */
	const fleetDeploys7d = $derived(appRows.reduce((n, a) => n + a.deploys7d, 0));
	/** Every rollout on the page, for the rail's sparkline. */
	const allRollouts = $derived(appRows.flatMap((a) => a.rolloutsForSpark));

	/**
	 * ⚠️ A MEDIAN OF MEDIANS, AND IT SAYS SO. Each app's `lead.medianMs` is
	 * already a median over that app's own trips; the fleet figure is the
	 * middle app, not the middle trip, because a 15-deploy app would otherwise
	 * drown a 3-deploy one and the number would be about churn rather than
	 * about time to production. Apps with no observed full trip are EXCLUDED
	 * rather than counted as zero or as infinity — `DESIGN.md` forbids
	 * rendering an unresolvable comparison as a definite claim — and the
	 * denominator rides in the tooltip so the reader can see how thin it is.
	 */
	const leadSamples = $derived(
		appRows.map((a) => a.lead?.medianMs).filter((ms): ms is number => typeof ms === 'number')
	);
	const fleetLeadMs = $derived(median(leadSamples));

	/**
	 * THE APP FURTHEST FROM ITS OWN NEWEST BUILD — the one quantity
	 * `/environments` and `/envs/[name]` both rank on, restated here so the
	 * three pages agree on the number and on the app that owns it. `—` and not
	 * `0`: a fleet with nothing behind has no deepest lag, and a zero in a
	 * column of distances reads as a measurement rather than as an absence.
	 */
	const deepest = $derived.by<{ appName: string; by: number } | null>(() => {
		let best: { appName: string; by: number } | null = null;
		for (const a of appRows) {
			if (a.worstLag <= 0) continue;
			if (!best || a.worstLag > best.by) best = { appName: a.appName, by: a.worstLag };
		}
		return best;
	});

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
				/** A record, where the disclosed tier is FIELDS rather than prose. */
				facts?: Fact[];
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
				// ⭐ A MACHINE FACT WITH A NAME, SO IT GETS A LABEL. (2026-09-02)
				// It was the sentence-shaped `Last attempt 3h ago · 8/31/2026,
				// 1:00:00 PM` — two words of field name in front of a value. The
				// name goes in the `<dt>`; the relative and the absolute time stay
				// together in the `<dd>`, because they are one fact said twice on
				// purpose (one to judge by, one to correlate a log against).
				facts: cell.timestamp
					? ([
							{
								label: 'Last attempt',
								value: `${formatTimeAgoCompact(cell.timestamp, $now)} ago · ${formatDate(cell.timestamp)}`
							}
						] as Fact[])
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
			//
			// ⛔ IT IS HANDED THE DISPLAY NAME, NOT THE TAG. `wantedVersion` is
			// the raw OCI tag and this banner printed it verbatim — sixty
			// characters of `main-1787999329-991829b6ab3…` inside a sentence, for
			// a build the rows below call `991829b`. `cell.version` (the fallback,
			// for a pin on the running build) was already the display form, so the
			// banner said the same build two different ways depending on which
			// branch fired.
			const pin = blockReason({ pinnedTo: cell.wantedDisplay || cell.version });
			// ⛔ "NONE WILL DEPLOY UNTIL SOMEONE RELEASES THE HOLD" NAMED ONLY
			// ONE HOLD, AND THE CLEAR PIN DIALOG ON THE SAME ROW SAYS ANOTHER
			// ONE SURVIVES IT. (2026-09-03, operator-walk P10) `promotionBlock`
			// evaluates the controller's GATES independent of the pin — a
			// schedule window or an approval can be refusing every candidate
			// at the same time the pin is — so a cell can be BOTH pinned and
			// gated, and the banner's own "releases the hold" implied clearing
			// the pin was the whole story. `cell.block` already carries the
			// other gates' names (unaffected by the pin), so `blockReason`
			// (the same function this file already calls for the pin clause)
			// says what ELSE holds it, in the vocabulary `/environments` and
			// `/envs/<name>` already use for a non-pin gate.
			const otherHold = blockReason({
				awaiting: cell.block.awaitingApprovalGates,
				notPassing: cell.block.notPassingGates
			});
			return {
				severity: 'pinned',
				icon: PauseSolid,
				title: `${cell.envLabel.toUpperCase()} is pinned on ${app.appName}`,
				message: `${pin ? `${pin.line}. ` : ''}${plural(
					cell.behindBy,
					'newer version'
				)} available, and none will deploy until the pin is cleared${
					otherHold ? `. Clearing it alone will not be enough: ${otherHold.short.toLowerCase()}` : ''
				}.`,
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

			// ⛔ `worst.c.story`'S SUBJECT WAS BUILT PER-CELL IN `classifyCell`
			// (`${appName} in ${TIER}`), SO A DEPENDENCY HOLDING ALL THREE OF AN
			// APP'S ENVIRONMENTS IDENTICALLY STILL HEADLINED *"hello-frontend-app
			// in DEV is waiting on another deploy"* — true of DEV, silent about
			// STAGING and PROD carrying the exact same gate. (2026-09-02)
			//
			// Mirrors `/apps/[name]`'s own `bannerPeers` / `bannerStory`: find
			// every cell of the SAME APP held by the SAME CAUSE, then reuse the
			// worst cell's own ROLLOUT (its gates are a fact about that Rollout
			// object) with a subject that speaks for the whole set. Unlike
			// `/apps/[name]` the app name stays IN the subject — this page lists
			// several apps, so the app's own page's argument for dropping it
			// ("spent for nothing, the h1 already says it") does not apply here.
			//
			// ⛔ NOT `pluralSubject` — CORRECTED 2026-09-02, SAME DAY. The first
			// cut wove the environment set INTO `subject` and let `pluralSubject`
			// conjugate `is` -> `are`, which reads *"hello-frontend-app in all 3
			// environments ARE waiting on another deploy"* — agreement with the
			// wrong noun. The sentence's grammatical SUBJECT is the singular APP;
			// `pluralSubject` is for a subject that genuinely IS the set
			// (`/apps/[name]`'s own "All 3 environments are…", where the app is
			// already fixed by the page and drops out of the sentence entirely).
			// Here the app never drops out, so it stays the subject, `is` stays
			// correct, and the environment set is a trailing locative
			// (`in all 3 environments` / `in DEV and STAGING`) the template has
			// no slot for — appended to the finished headline, never folded into
			// `subject`.
			const peers = worst.app.cells.filter(
				(c) => c.story.blocked && c.behindBy > 0 && causeKey(c.story) === causeKey(worst.c.story)
			);
			if (peers.length < 2) return { story: worst.c.story, app: worst.app.appName };

			const rollout = groups
				.get(worst.app.appName)
				?.cells.find((c) => c.environment?.spec?.environment === worst.c.tier)?.rollout;
			if (!rollout) return { story: worst.c.story, app: worst.app.appName };

			const deployedCells = worst.app.cells.filter((c) => !!c.version).length;
			const names = peers.map((c) => c.envLabel.toUpperCase());
			const where =
				peers.length === deployedCells
					? `all ${names.length} environments`
					: names.length <= 3
						? joinClauses(names)
						: `${names.length} environments`;

			const base = blockingStory(rollout, gateContext, { subject: worst.app.appName, now: $now });
			const story = { ...base, headline: `${base.headline} in ${where}` };
			return { story, app: worst.app.appName };
		}

		return null;
	});
</script>

<svelte:head>
	<title>kuberik | Apps</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<!-- ══ PAGE HEADER — THE ROLLUP, NOT THE SECTION NAME ═══════════════════
	     ⛔ THE VISIBLE `Apps` TITLE IS GONE. (2026-09-01, from the human:
	     *"i think i don't like that we have a title on the page when it's
	     already in the navbar."*) The navbar already prints `Apps` at 17px
	     eight pixels above, so the `h1` was the same word twice in one
	     eyeline, and it was the LARGEST type on the page — 24px spent on the
	     thing a reader already knows.

	     IT IS STILL AN `h1`, JUST NOT A DRAWN ONE. `sr-only` keeps the heading
	     structure the skip link lands in and the a11y/message suites assert;
	     what changes is only that the sighted reader gets the page's ROLLUP in
	     the slot the duplicate word used to hold. That rollup is the one thing
	     here the chrome cannot say.

	     ⚠️ NOT EVERY PAGE. `/envs/<name>` keeps its drawn `h1` — the navbar
	     names the SECTION there and the page names the ENVIRONMENT, so the two
	     are not the same string. The test is duplication, not position. -->
	<!-- ⛔ THE ROLLUP HAD THE SLOT BUT NOT THE TYPE ROLE. (2026-09-01) Taking
	     the title out took the page's 24px role with it and left `/apps`
	     running **16 → 10** where the composition grammar asks for 24 → 10 —
	     the "quieter, flatter, smaller-typed" failure, arrived at by deletion.
	     The count now leads at `t-display`, which is the shape `/activity`
	     already used (`47` beside its sentence), and the rest of the sentence
	     sits on its baseline. Same words, same row, same `mb-5`. -->
	<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
		<h1 class="sr-only">Apps</h1>
		{#if !query.isLoading && !query.isError && appRows.length > 0}
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{appRows.length}</span>
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				app{appRows.length === 1 ? '' : 's'}
				{#if attnCount > 0}
					· <span class="font-medium text-gray-700 dark:text-gray-200"
						>{attnCount} need{attnCount === 1 ? 's' : ''} attention</span
					>
				{/if}
				{#if motionCount > 0}
					· {motionCount} deploying now
				{/if}
				<!-- ⛔ THE HEAD REASSURED OVER THE ALERT. (Operator walk, finding
				     10) `4 of 4 the same version everywhere, 3 on the newest`
				     sat ABOVE the amber panel naming the one blocked app, and
				     consistency-across-environments is trivially true when
				     every environment is stuck on the same build — the sentence
				     could never be false while something was actively wrong. It
				     is deleted; the exception leads instead, same order as the
				     two severities above it (`need attention`, `deploying now`,
				     now `blocked`), and the good news — how many are current —
				     comes last, unconditionally, since that is the one fact
				     this line can say that is not already on screen. -->
				{#if blockedCount > 0}
					· <span class="font-medium text-gray-700 dark:text-gray-200"
						>{blockedCount} blocked</span
					>
				{/if}
				· {currentCount} on the newest
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
						<div class="h-7 w-7 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
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
		<!-- ⛔ THE BANNER'S CONTROL IS A LINK NOW, NOT A BUTTON. (2026-09-02)
		     > *"i also don't like this investigate button / choose version that
		     > act as if they're doing something smart but are just navigating
		     > to a page. i think there's more like that."*

		     The rule, applied across the product: a control that only changes
		     WHAT YOU ARE LOOKING AT is navigation and must look like navigation;
		     a control that changes CLUSTER STATE is an action and earns a
		     button; a FILLED button is reserved for the action that changes what
		     is running. `/apps` has no cluster-mutating control anywhere on it
		     — `nextStep`'s own tombstone says so in as many words — so the page
		     now has ZERO buttons, which is the honest census for a list view.

		     IT KEEPS THE 14px AND THE ARROW. `.nav-link` in `app.css` is the
		     shared treatment — 14px/500 with `.btn`'s own vertical padding, so
		     the banner's action row does not change height when its control
		     changes class — and `AlertPanel` sets `--nav-link-ink: currentColor`
		     on that row, so the link speaks in the SEVERITY's ink. That matters
		     here: this banner renders at four severities (`error`, `warning`,
		     `pinned`, `info`) and a hard-coded hue would be wrong on three of
		     them. -->
		{#snippet openApp(app: string)}
			<a href="/apps/{app}" class="nav-link">
				Open {app}
				<ArrowRightOutline />
			</a>
		{/snippet}
		{#snippet blockerFacts()}
			<FactList
				tone="banner"
				facts={blocker && !('story' in blocker) ? (blocker.facts ?? []) : []}
			/>
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
				footnoteBody={b.facts?.length ? blockerFacts : undefined}
				pulse={b.pulse}
				class="mb-5"
			>
				{#snippet actions()}{@render openApp(b.app)}{/snippet}
			</AlertPanel>
		{/if}

		<!-- ══ TWO COLUMNS, AND A REAL RIGHT RAIL ═══════════════════════════════
		     ⛔ THIS PAGE WAS A SPREADSHEET AND THE LAYOUT IS HALF OF WHY.
		     (2026-09-01, from the human, about the app detail page: *"looks too
		     much like spreadsheet. check where else is this the case."* This is
		     one of the places.)

		     Measured beside `/rollouts/<cluster>/<ns>/<name>` at 1440 in both
		     themes — the only test that has correlated with the human's
		     judgement — `/apps` was ONE full-width table on an otherwise empty
		     page: a tracked uppercase column header over four fixed measurement
		     tracks, 700px of dead ground below it, and not one identity colour
		     anywhere. The reference page at the same width is two columns with a
		     rail of four self-contained cards. So is `/envs/<name>`, this page's
		     own sibling, which the human has not called a spreadsheet.

		     `COMPOSITION-GRAMMAR.md` §7: *"Main column plus a rail of INDEPENDENT
		     cards... The rail is not a sidebar of scraps; it is a stack of small
		     complete answers."* The rail below is the same two cards `/envs/<name>`
		     already carries, in the same order, built from components that already
		     exist (`Card`, `DeployVolumeSparkline`, `ActivityRail`) over data this
		     page already fetched. It introduces no new object for a reader to
		     learn and no new request.

		     ⛔ 1440px, AND IT IS THE ONE BESPOKE BREAKPOINT IN THE PRODUCT.
		     `xl` — the sibling's own breakpoint, copied — BREAKS THIS PAGE,
		     which the sibling's row layout does not care about and this one
		     does. The list column is the `.apps-panel` CONTAINER, and its first
		     query is at 720px, below which every row renders in its 390px
		     STACKED form. At exactly `xl` (1280) a 320px rail leaves the list
		     1280 − 176 (sidebar) − 48 (`px-6`) − 24 (gap) − 320 = **712px**.
		     Eight pixels short, on a 1280px desktop. Measured, not predicted.

		     1440 is the first round width that clears it with headroom: **872px**
		     of list, rising to 888 once the page's `max-w-7xl` caps the whole row
		     at 1232px from 1456 up. Below 1440 the rail goes UNDER the list at
		     full width — it loses nothing but its adjacency, exactly as the
		     sibling's does below `xl`.

		     THE RAIL IS 320px, THE SAME AS THE SIBLING'S, and that is worth
		     holding: 288 was tried, and at 288 the card header ran out of room
		     and rendered `How it's …` beside its own rollup. A rail card is a
		     titled card; a titled card that cannot print its title is not one.

		     ⚠️ IF THE PAGE'S MAX WIDTH OR THE 720px CONTAINER QUERY MOVES, THIS
		     PAIR IS WRONG. Re-derive it; do not nudge it. -->
		<div
			class="min-[1440px]:grid min-[1440px]:grid-cols-[minmax(0,1fr)_320px] min-[1440px]:items-start min-[1440px]:gap-6"
		>
			<div class="mb-4 flex min-w-0 flex-col gap-4 min-[1440px]:mb-0">
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
						verdict={blockedCount > 0
							? `${blockedCount} of ${appRows.length} blocked`
							: `${currentCount} of ${appRows.length} on the newest`}
						verdictTone={blockedCount === 0 && currentCount === appRows.length ? 'good' : 'neutral'}
						verdictTitle={blockedCount > 0
							? `${blockedCount} of ${appRows.length} apps have a newer version that no gate will let in yet`
							: `${currentCount} of ${appRows.length} apps have every deployed environment on the newest version available to it`}
						padded={false}
					>
						<!-- ⛔ THE COLUMN HEADER ROW IS GONE. (2026-09-01)
					     `APP · UP TO DATE · DEPLOYS · 7D · TO PROD` in 10px tracked
					     uppercase over four fixed tracks is the instrument that made
					     this page read as a spreadsheet. Nothing on the reference page
					     has one — its Resources rows, its pipeline stations and its
					     health checks are all lists whose cells name themselves.

					     THE PROMISE IT WAS KEEPING IS KEPT WITHOUT IT: *"a measurement
					     with no name is a decoration."* Every one of the three
					     measurements already prints its own name 16px below the mark,
					     so the header was restating what the cell says:

					       Up to date    the mark IS the sentence — `All up to date` /
					                     `0 of 3 up to date`, from `UpToDate`
					       Deploys · 7d  caption `9 deploys · 1d ago`, over a window the
					                     rail's own `Deploys · 7d` row names once per
					                     screen — and the row's own inline label names
					                     below the container breakpoint, where the rail
					                     is further away
					       To prod       caption `dev → prod` beside a clock, the same
					                     `1d · 16 seconds` idiom the reference uses

					     What is lost is the alignment CUE, not the alignment: the
					     tracks are unchanged and the columns still line up down fifty
					     rows. What is gained is that the eye reads apps instead of
					     reading cells. -->
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each steadyRows as app (app.appName)}
								<li>{@render appRow(app)}</li>
							{/each}
						</ul>
					</Card>
				</div>
			</div>

			<!-- ══ THE RAIL — A STACK OF SMALL COMPLETE ANSWERS ═══════════════
			     Each card is self-contained, carries its own icon and its own
			     right-aligned rollup, and answers something the list beside it
			     cannot: the list is per-app, and these are per-FLEET and
			     per-MOMENT. Neither restates a row.

			     ⚠️ NOT A SIDEBAR OF SCRAPS AND NOT A SET OF VANITY METRICS.
			     The three figures in the first card are the same three
			     `/envs/<name>` prints, at this page's scope, and each is a
			     quantity that already has a column on a row here. `Recent
			     activity` is the SHARED `ActivityRail` that `/apps/<name>`,
			     `/namespaces/<name>` and `/envs/<name>` already render — it is
			     not a new object, and it carries the one dimension a fleet list
			     structurally cannot: WHEN each app moved and what it moved FROM.
			     `showEnv` is true here because a row can be any environment,
			     which is the opposite of the sibling's call. -->
			<div class="min-w-0 space-y-4">
				<!-- ⛔ THE ROLLUP SAYS `APPS`, AND THE NOUN IS NOT COSMETIC.
				     `3 of 4 up to date` is the ROW-level sentence `UpToDate` prints
				     about ONE app's environments; printed as a card rollup it is the
				     same string over a different denominator, and `messages/axis.ts`
				     fails it as an unresolved `up-to-date headline` — a read-first
				     claim with no app named above it. Naming the set is what makes
				     it a rollup ABOUT apps rather than a claim about one. -->
				<HowItsGoing
					scope="apps"
					verdict="{currentCount} of {appRows.length} apps up to date"
					verdictTone={currentCount === appRows.length ? 'good' : 'neutral'}
					verdictTitle="Apps whose every deployed environment is on the newest version available to it"
					windowLabel="{SPARK_DAYS}d"
					population="{appRows.length} app{appRows.length === 1 ? '' : 's'}"
					deploys={fleetDeploys7d}
					deploysTitle="{fleetDeploys7d} deploy{fleetDeploys7d === 1
						? ''
						: 's'} across every app on this page in the last {SPARK_DAYS} days"
					sparklineRollouts={allRollouts}
					sparklineDays={SPARK_DAYS}
					typicalToProd={{
						ms: fleetLeadMs,
						title:
							fleetLeadMs === null
								? 'No app has had a version go all the way from its first environment to production inside the deploy history kept for it'
								: `The middle app's own median trip from its first environment to its first production region, measured across ${leadSamples.length} of ${appRows.length} apps — the rest have not had a version make the whole trip inside the history kept for them`
					}}
					furthestBehind={{
						entry: deepest,
						title: deepest
							? `${deepest.appName} has an environment ${deepest.by} version${deepest.by === 1 ? '' : 's'} behind the newest available to it`
							: 'No app has an environment behind the newest version available to it'
					}}
				/>

				<Card icon={ClockOutline} title="Recent activity" padded={false}>
					{#snippet rollup()}
						<!-- ⭐ `N deploys` NOW LEADS, LIKE `/apps/<name>`'s OWN CARD OF
						     THE SAME NAME. (2026-09-03) `/apps/[name]` answers "how
						     much history is there" (`deployEvents`, unbounded); this
						     card and `/envs/<name>`'s printed the bare link, so the
						     one page with an answer sat beside two that only offered
						     "go look". Same unbounded count — every `status.history`
						     entry with a timestamp across every rollout on this page,
						     not the 7-day `fleetDeploys7d` `How it's going` already
						     spends two rows up. Card's header now WRAPS the rollup to
						     its own line when the two do not both fit (2026-09-03,
						     the `flex-wrap` fix above `Card`'s title), so this cannot
						     reproduce the truncation the old `sm:flex-nowrap` behaviour
						     had.
						     `.nav-link`, ONE SPELLING WITH `HomeRail`'s AND
						     `ActivityRail`'s OWN DEFAULT HEADER, NOT A THIRD PRIVATE
						     ONE. (2026-09-02) -->
						{@const n = allRollouts.reduce(
							(acc, r) => acc + (r.status?.history?.filter((h) => h.timestamp).length ?? 0),
							0
						)}
						<span class="t-code-sm text-gray-500 dark:text-gray-400"
							>{n} deploy{n === 1 ? '' : 's'}</span
						>
						<a href="/activity" class="nav-link" aria-label="View all deploy activity">
							View all activity <ChevronRightOutline class="h-3.5 w-3.5" />
						</a>
					{/snippet}
					<ActivityRail
						rollouts={allRollouts}
						{environments}
						limit={8}
						showEnv={true}
						chrome={false}
						{localClusterName}
					/>
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
	{@const circle = circleBakeStatus(app.circle, app.fullyOnHead, app.gateHeld)}
	<!-- ── THE ROW IS A `.tap-zone`, not an `<a>` and no longer a hand-rolled
	     stretched link. ──────────────────────────────────────────────────
	     From the human: *"it's also not clickable in places where you'd expect
	     it to be. i think some other views have this problem too."* `/apps`
	     rows were on `src/lib/CLAUDE.md`'s own list of the surfaces still
	     unfixed.

	     It could not become an `<a>`: a `<button>` inside an anchor is invalid
	     HTML and browsers resolve it by discarding the nesting, so the step
	     control would be unreachable by keyboard. The row had a LOCAL version
	     of the fix — `relative` here plus `after:absolute after:inset-0` on
	     the name — which stretched the target but re-implemented the product's
	     pattern by hand, and got two things wrong that `.tap-zone` gets right:

	       · EVERY other control had to be raised BY HAND. `.apps-step` carried
	         its own `z-[1]`; anything added to the row later would have
	         silently landed UNDER the overlay. `.tap-zone` raises every
	         `a, button, input, select, summary, [role=button]` inside it.
	       · THE FOCUS RING WAS ON THE LINK'S OWN TEXT BOX, which is inside a
	         `truncate` cell. `.tap-zone` draws it on the `::after` instead, so
	         a keyboard user sees a ring around the region Enter will actually
	         activate.

	     Still ONE tab stop and still zero nested interactive elements — the
	     DOM is unchanged, only the anchor's paint box grows. -->
	<div
		class="apps-row tap-zone px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30"
	>
		<!-- ── APP ──────────────────────────────────────────────────────────
		     Status circle, name, and the one sentence that names the
		     environment the shape cannot. -->
		<span class="apps-id flex min-w-0 items-center gap-3">
			<!-- `not fully promoted` WAS MISSED BY THE NOVICE PASS: a mechanism
			     word, on the column the pass had just renamed `Up to date`. It
			     is what a screen reader heard while the eye read
			     `0 of 3 up to date`. -->
			<!-- DISC DIAMETER: `h-7 w-7`, the list-row token — see
			     `BakeStatusIcon.svelte`. `state`/`stateWord` reuse `cardStateMark`
			     (via `circleBakeStatus`'s `gateHeld` branch) so a fleet held by a
			     gate draws the SAME orange-disc pause glyph `/` and `/rollouts`
			     draw for the same rollouts, instead of the gray "not fully on
			     head" disc every other kind of drift still uses. -->
			<span
				class="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
					circle.bakeStatus,
					circle.mark?.kind ?? null
				)}"
				title={circle.mark ? circle.mark.title : undefined}
			>
				<BakeStatusIcon
					bakeStatus={circle.bakeStatus}
					size="medium"
					state={circle.mark?.kind ?? null}
					stateWord={circle.mark?.word ?? ''}
				/>
				<span class="sr-only"
					>{STATUS_WORD[app.worst]}{circle.mark
						? `, ${circle.mark.word}`
						: app.fullyOnHead
							? ''
							: ' · not up to date everywhere'}</span
				>
			</span>
			<span class="flex min-w-0 flex-col gap-1">
				<span class="flex min-w-0 items-baseline gap-2">
					<a
						href="/apps/{app.appName}"
						class="tap-link t-code min-w-0 truncate font-semibold text-gray-900 dark:text-white"
						>{app.appName}</a
					>
					{#if app.desc}
						<span class="apps-desc t-micro min-w-0 truncate text-gray-500 dark:text-gray-400"
							>{app.desc}</span
						>
					{/if}
					<!-- ⛔ "HELD" WAS SPELLED FIVE WAYS ACROSS THE PRODUCT'S LIST
					     SURFACES, AND THIS ROW WAS ONE OF THE TWO SAYING NOTHING
					     (0 of 4 list pages; `/`, `/rollouts` and `/environments` all
					     print it). (2026-09-03, activity/touch lane, F3) The row
					     already draws the orange held disc via `circleBakeStatus`'s
					     `gateHeld` branch and the lede sentence below can say
					     `… have N newer versions held`, but neither is a WORD next
					     to the object on a row a sighted reader scans by name, and
					     the disc is silent on touch. `app.gateHeld` is the same
					     `story.blocked` union the disc and the lede already read —
					     one more reader of an existing fact, not a new one — so this
					     cannot disagree with either. Same atom as `/`, `/rollouts`,
					     `/environments`, `/namespaces/<name>`: `Chip role="held"
					     label="held"`. It sits beside the NAME, not inside the
					     per-environment mark row below, because it is a fact about
					     the APP'S FLEET as a whole (it can be true with zero adverse
					     cells — `hello-frontend-app`'s live case, gated everywhere,
					     failing nowhere), not about one boxed environment. -->
					{#if app.gateHeld}
						<Chip
							role="held"
							label="held"
							title="{app.appName} — a newer build exists here, but no gate lets it through yet"
							class="shrink-0"
						/>
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
			<!-- ⛔ F14: THE `Fleet` LABEL IS GONE OUTRIGHT, NOT JUST RENAMED.
			     (2026-09-03, re-check) The 2026-09-02 fix above renamed `Up to
			     date` (a label contradicting the claim under it) to the neutral
			     noun `Fleet` — but a neutral noun over a cell that already names
			     itself is still a label with nothing left to say. Measured at
			     390: this row printed 12 tracked-uppercase labels
			     (`FLEET`/`DEPLOYS · 7D`/`TO PROD` × 4 apps) over cells that all
			     self-name (`0 of 3 up to date`, `5 deploys · 2d ago`). `UpToDate`
			     prints `All up to date` or `N of M up to date` — that sentence
			     IS the column; a caption reading `Fleet` above it teaches
			     nothing a blank space would not. -->
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
			<!-- ⭐ `deviationOnly`: a LIST marks the row that needs a look, never
			     the majority that does not. See `UpToDate`'s own doc comment for
			     the measurement (390 dark: a blocked app at zero chroma beside
			     three green "All up to date" siblings). -->
			<UpToDate
				onHead={app.fleet.onHead}
				deployed={app.fleet.deployed}
				total={app.fleet.total}
				spread={app.fleet.spread}
				pending={app.fleet.pending}
				diverged={app.fleet.diverged}
				unknown={app.fleet.unknown}
				title={app.fleetFull}
				deviationOnly
			/>
		</span>

		<!-- ── DEPLOYS · 7d ─────────────────────────────────────────────────
		     Criterion 2. Below `SPARK_MIN` the count stands alone: a sparkline
		     of empty buckets is a shrug drawn at the size of data. The
		     last-deploy time lives here because volume and recency are one
		     question — is this app churning or asleep. -->
		<span class="apps-act flex min-w-0 flex-col gap-1">
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
			<!-- ⛔ F14: THE WINDOW MOVES INTO THE CELL, AND THE 2026-08-30 NOTE
			     ABOVE THIS ONE IS SUPERSEDED, NOT REPEATED. That note rejected
			     `in 7d` per caption on the grounds that `/envs/<name>` measured
			     the identical string costing ~40px in a track THAT HAD NONE — a
			     fixed-width gap pill, not this cell. This caption sits alone on
			     its own full-width line at 390 with nothing beside it to
			     squeeze; the ~40px argument does not transfer. And the inline
			     label it relied on to name the window is itself gone now (see
			     `Fleet`, above, same defect: a label repeating what the cell
			     already says teaches nothing) — the window has to live
			     somewhere, and folding it into the sentence that already states
			     the count is one fact restated as one fact, not two. -->
			<span class="t-micro truncate text-gray-500 dark:text-gray-400"
				>{app.deploys7d} deploy{app.deploys7d === 1 ? '' : 's'} in 7d{#if app.mostRecentTs}{' · '}<span
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
					title="Typical time a version takes to get from {app.lead.fromLabel} to {app.lead
						.toLabel}, measured over {app.lead.samples} version{app.lead.samples === 1
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
		<!-- ── THE NEXT STEP, NARROWED TO THE ONE THAT GOES SOMEWHERE ELSE ──
		     ⛔ `Choose a version` WAS A FILLED BLUE BUTTON FOR A PAGE LOAD, AND
		     IT WAS THE LOUDEST CONTROL IN THE PRODUCT. (2026-09-02)

		     > *"i also don't like this investigate button / choose version that
		     > act as if they're doing something smart but are just navigating to
		     > a page. i think there's more like that."*

		     Every step this page can emit is an `<a>` — `nextStep`'s own
		     tombstone says so and gives the reason (a list-level mutation would
		     have to pick an environment silently). So `/apps` never had an
		     action to spend a button on, and it was spending the FILLED one.

		     ⭐ AND FIVE OF THE SIX WERE AIMED AT THE ROW'S OWN TARGET. Every
		     step but `unpin` resolved to `/apps/<name>` — character for
		     character the destination of the `.tap-zone` the whole row already
		     is, with a `›` chevron 40px to its right saying so. It is the same
		     defect `/apps/<name>` recorded when it deleted its namespace link:
		     *"a second control aimed at the first one's target."* And the row's
		     LEDE already names the state in words (`DEV can still take 1 newer
		     version`), so the verb was restating the sentence beside it as well
		     as duplicating the link under it.

		     ⭐ `unpin` SURVIVES BECAUSE IT IS THE ONE THAT GOES SOMEWHERE ELSE.
		     `?release=<env>` lands ON the clear-pin dialog rather than near it,
		     which was itself the fix for a reported defect — *"a CTA that lands
		     on the wrong control is worse than no CTA, because the operator now
		     believes they tried."* Deleting it would undo that. It is a LINK,
		     not a button, because the click still only changes what you are
		     looking at; the act is behind the dialog it opens.

		     WHAT REPLACES THE ENTRY POINT the filled button was carrying: the
		     banner, which is a page-level FILL — `COMPOSITION-GRAMMAR.md` §4's
		     *"attention pulled by design, not text"* — and is a louder, truer
		     mark for "start here" than a blue rectangle on the fourth column of
		     a row. -->
		{#if app.step === 'unpin' && app.stepEnvName}
			<!-- NO HAND-ROLLED `z-[1]` ANY MORE — `.tap-zone` raises every control
			     inside it, so this cell cannot fall under the overlay and neither
			     can anything added beside it later. -->
			<span class="apps-step flex items-center justify-end">
				<!-- ⛔ "RELEASE THE HOLD" NAMED AN ACT IN WORDS THE DIALOG IT
				     OPENS DOES NOT USE. (2026-09-03, operator-walk P9) The
				     link lands on `ClearPinModal`, whose title, button and
				     rollout detail's own trigger all say `Clear pin` — a
				     reader who clicked "release the hold" then read a dialog
				     that never repeats those words back. `CLEAR_PIN_LABEL`
				     (`pin-copy.ts`) is the nav lane's one spelling; importing
				     it instead of a local literal is what keeps this page from
				     drifting the moment that word changes again. -->
				<a
					href="/apps/{app.appName}?release={encodeURIComponent(app.stepEnvName)}"
					class="nav-link"
					title="{app.stepEnv} — {STEP_WHY.unpin}"
					aria-label="{CLEAR_PIN_LABEL} on {app.appName} in {app.stepEnv}"
					>{CLEAR_PIN_LABEL}<ChevronRightOutline /></a
				>
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
			'lead  act';
		align-items: start;
		column-gap: 12px;
		row-gap: 12px;
	}

	/* ── THE STEP IS A FULL-WIDTH BAND AT EVERY WIDTH, AND IT IS THE LAST
	   THING IN THE ROW. Putting it under the measurements rather than beside
	   the name is the order the reader wants: what is this, how is it doing,
	   what do I do. Right-aligned inside the band, so it lands under the
	   chevron's own x — measured at 1440, the link's right edge and the
	   chevron's are both 1055.

	   ⛔ AND IT IS NO LONGER A DECLARED ROW OF `grid-template-areas`, AND
	   THAT DELETION IS WORTH 12px ON EVERY ROW IN THE PRODUCT. (2026-09-02)
	   An area row named in the template is an EXPLICIT track: it is created
	   whether or not anything lands in it, and `row-gap` is drawn beside it
	   regardless. The step renders for one row shape in six (`unpin`), so
	   measured at 390 every card carried a 0px fourth track plus a 12px
	   gutter under its last line — 210px of card for 198px of content — and
	   the same 12px sat under every row between 720 and 999. The comment
	   that used to be here claimed `:empty` collapsed it; `:empty` never ran,
	   because the cell is inside an `{#if}` and is not in the DOM at all.

	   Placed on an IMPLICIT row instead (`grid-row` one past the explicit
	   grid), the track and its gutter come into existence WITH the step and
	   vanish with it. The row number is per breakpoint because the number of
	   explicit rows is. */
	.apps-step {
		grid-column: 1 / -1;
		grid-row: 4;
		/* A GRID ITEM'S FLOOR IS `min-content` UNLESS YOU SAY OTHERWISE, and
		   the link inside is `white-space: nowrap`, so min-content is the
		   whole label. Without this the CELL silently grows past its track
		   instead of the track being wrong in a way anyone can see. */
		min-width: 0;
	}
	/* ⛔ THE `:global(.btn)` RULES ARE GONE WITH THE BUTTON. (2026-09-02) The
	   step is a 14px TEXT LINK now — see the markup — so there is nothing to
	   stretch to the card's width. On a phone it sits at the end of the card
	   in its own band exactly as before; a link does not need a 44px target
	   because the whole card is already the tap target at that width, which
	   is the same argument the chevron below is hidden on. */
	.apps-step a {
		text-align: right;
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

	/* ⭐ AND IT DOES NOT RETURN AT 720 — IT RETURNS AT 800 OF PANEL.
	   (2026-09-02, found by the re-measure the deleted step track forced.)
	   The App track is `panel − 32 (px-4) − 408 (the four fixed tracks) − 64
	   (four gaps)`, so at the 720 breakpoint it is **214px** — and the
	   description was being placed beside the name inside it. Measured at
	   viewport 944 (panel exactly 720): `hello-frontend-app` is a 141px
	   string and rendered as `hello-fron…`, with `Hello Dep…` beside it. That
	   is the primary identifier ellipsised to make room for four characters
	   of free text, which is the same trade the phone form already refused
	   and the same defect the 900 → 1000 re-derivation was written about.

	   THE THRESHOLD IS 840, AND 800 WAS MEASURED AND REJECTED. The App track
	   is `panel − 504`, but the name does not get all of it: the 36px status
	   circle and its 12px gap come out first, so the name and its description
	   share `panel − 552`. At 800 that is 248px against `141 (the longest
	   name) + 8 (gap) + 105 (`Hello Dep frontend`) = 254` — six pixels short,
	   and the flex row pays for them out of the NAME, which rendered at 137
	   of 141. At 840 the pair get 288px: 149 for name-plus-gap and 139 left
	   for the description, about 22 characters at 11px. Verified with no
	   truncation on any row from 840 up, including the 872px panel the
	   `min-[1440px]` rail leaves at 1440 — 32px of headroom, so the rail can
	   move a little without taking the description with it.

	   Between 720 and 839 the row keeps all five tracks and simply drops the
	   description, exactly as at 390.

	   ⚠️ THE DISC SHRANK TO 28px 2026-09-02 (the list-row diameter token —
	   see `BakeStatusIcon.svelte`), FREEING 8px THIS MATH DOES NOT SPEND.
	   840 is still safe — the pair's share is now `panel − 544`, strictly
	   more room than the `− 552` this measurement assumed — it is just 8px
	   more conservative than it needs to be. Left alone rather than
	   re-derived to the pixel: the threshold only needed to be SAFE, and
	   moving it down risks re-opening a boundary that took two rejected
	   values to find. */
	@container (min-width: 840px) {
		.apps-desc {
			display: block;
		}
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
	/* ⛔ THE STEP HAS NO COLUMN AT ANY WIDTH ANY MORE. ────────────────────
	   (2026-09-02, from the human, looking at the live page at 1280:
	   *"there's a gap now here where button used to be"*.)

	   It had one at 1000px of panel, sized 140px to hold `Release the hold`.
	   Then five of the six steps were deleted — every one whose `href` was
	   the row's own destination — and `unpin` is the only shape left that
	   renders anything into it. Measured at 1280 with the live cluster: FOUR
	   rows out of four drew nothing there, so the row ran `no full trip yet`
	   to x=1047 and its chevron at x=1219, with **156px of nothing between
	   them** (140px track + one 16px gutter). A fixed empty track before the
	   last column does not read as breathing room; it reads as a control that
	   failed to render, which is exactly what it was.

	   The window it was visible in is narrow and extremely common: the six
	   track form needed 1000px of PANEL, which needs a viewport of 1224+, and
	   at 1440 the `min-[1440px]` rail takes 312px back and drops the panel to
	   872. So it showed between 1224 and 1439 — i.e. on a 1280 laptop and
	   nowhere else.

	   WHAT REPLACES IT is the form 720–999 already used and which this file
	   already called *"a designed state and not a fallback"*: the step is a
	   BAND under the row, on an implicit grid row that only exists when the
	   step does. Five tracks now describe every width above 720, so there is
	   one desktop geometry instead of two, and the 156px goes back to `App` —
	   the flexible track this file has twice recorded as the one that runs
	   out. Re-measured at 1280 after the change: `App` 550px against a
	   longest id content of 391px (`hello-frontend-app` + its description +
	   its lede), so the name has headroom rather than a hole beside it.

	   THE THREE MEASUREMENT TRACKS WERE RE-MEASURED AND ALL THREE HOLD.
	   Natural content widths on the live cluster, unclamped:
	     · Fleet 164px — `all 3 on one older version` is 140px and the
	       verdict line 139px (16px glyph + 6px gap + 117px). The 164 is held
	       for the fixture's `2 of 9 up to date · 1 diverged` at ~160.
	     · Deploys · 7d 128px — `15 deploys · 2d ago` is 109px.
	     · To prod 96px — `no full trip yet` is 78px, `dev → prod` 62px.
	   None of them is the column with the hole in it, so none of them moves;
	   a track resized to fit today's data is a track that ellipsises on
	   tomorrow's. */
	@container (min-width: 720px) {
		.apps-row {
			/* Five fixed tracks: the 20px chevron is the fifth. Every
			   non-flexible track is a FIXED width — `auto` was tried and
			   reverted product-wide, because each row is its own grid and an
			   intrinsic track sizes per row, so the columns stop lining up
			   down the list. One flexible track, everything else fixed. */
			grid-template-columns: minmax(0, 1fr) 164px 128px 96px 20px;
			grid-template-areas: 'id fleet act lead chev';
			align-items: center;
			column-gap: 16px;
			row-gap: 12px;
		}

		/* One explicit row up here, so the band is row 2 rather than row 4. */
		.apps-step {
			grid-row: 2;
		}

		.apps-chev {
			display: flex;
			grid-area: chev;
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

		/* `.apps-desc` is NOT revealed here — see its own rule above; at this
		   width the App track is 214px and the description takes it from the
		   name. It comes back at 800. */

		.apps-inline-label {
			display: none;
		}
	}

	/* ⛔ THE SIX-TRACK RULE THAT USED TO SIT HERE IS DELETED, AND SO IS THE
	   1000px CONTAINER QUERY THAT TURNED IT ON. Two tombstones' worth of
	   measurement went with it and both are preserved above, on the 720 rule
	   that is now the only desktop geometry:

	     · the track was 200px, then 158px (where the button painted itself
	       over the `To prod` column), then 140px once the step became a
	       14px text link with one surviving label;
	     · the query threshold moved 900 → 1000 when the `min-[1440px]` rail
	       arrived and cut the panel to 872px.

	   None of that arithmetic has a subject any more: five of the six steps
	   were deleted for pointing at the row's own destination, and a fixed
	   track that four rows in four leave empty is the void the human
	   reported. The step is a band at every width now. If a second step shape
	   is ever added back, it belongs in the band beside `unpin`, not in a
	   column that most rows cannot fill. */
</style>
