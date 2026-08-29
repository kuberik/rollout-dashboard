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
	import { buildFleetStrip, fleetCaption } from '$lib/view-models/fleet-strip';
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
	import { getStatusCircleClass } from '$lib/bake-status';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import type { Rollout, Environment } from '../../types';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: 15000 } })
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
		/** The caption WITHOUT `N builds` — that is the column's own chip. */
		fleetLine: string;
		/** The whole statement, for the cell's `title`. */
		fleetFull: string;
		lead: LeadTimeVM | null;
		deploys7d: number;
		rolloutsForSpark: Rollout[];
		mostRecentTs: string | null;
		lede: string;
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
	const STATUS_WORD: Record<CellState, string> = {
		fail: 'deploy failed',
		stuck: 'stuck',
		pending: 'never deployed',
		deploying: 'deploying',
		baking: 'baking',
		onNewest: 'deploy succeeded',
		behind1: 'deploy succeeded',
		behind2: 'deploy succeeded'
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
		refNow: Date
	): { state: CellState; theme: EnvironmentTheme | null; held: boolean; timestamp: string | null } {
		const cell = group.cells.find((c) => c.environment?.spec?.environment === tier);
		const rollout = cell?.rollout ?? null;
		const bakeStatus = rollout?.status?.history?.[0]?.bakeStatus || 'None';
		const timestamp = rollout?.status?.history?.[0]?.timestamp ?? null;
		const pinned = !!rollout?.spec?.wantedVersion;

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
		const held = pinned && vm.behindBy > 0;

		if (vm.statusKey === 'failed') return { state: 'fail', theme, held, timestamp };
		if (stuckReason) return { state: 'stuck', theme, held, timestamp };
		if (bakeStatus === 'Deploying') return { state: 'deploying', theme, held, timestamp };
		if (bakeStatus === 'InProgress') return { state: 'baking', theme, held, timestamp };
		if (vm.statusKey === 'pending') return { state: 'pending', theme, held: false, timestamp };
		if (vm.behindBy === 0) return { state: 'onNewest', theme, held, timestamp };
		const behindState: CellState = vm.behindBy >= 2 ? 'behind2' : 'behind1';
		return { state: behindState, theme, held, timestamp };
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

	function circleBakeStatus(state: CellState): string | undefined {
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
				return 'Succeeded'; // onNewest, behind1, behind2 — the deploy itself succeeded
		}
	}

	// NO `leadToneClass`. Colour belongs on MARKS, not on prose: a coloured
	// sentence is the loudest way a page can say anything, and every state it
	// would tint already carries a mark (the row glyph is red when an env
	// failed, the strip's mark is amber when one is stuck). The lede is neutral
	// ink in every state.

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
				const { state, theme, held, timestamp } = classifyCell(group, tier, vm, refNow);
				cells.push({
					tier,
					envLabel: shortEnvLabel(vm.envName) || vm.envName,
					theme,
					version: vm.version,
					rank: vm.rank,
					behindBy: vm.behindBy,
					state,
					held,
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
				lede = worstFree
					? `${worstFree.envLabel.toUpperCase()} is ${worstFree.behindBy} build${worstFree.behindBy === 1 ? '' : 's'} behind`
					: '';
			}

			rows.push({
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
				fleetLine: fleetCaption(fleet, { omitSpread: true }),
				fleetFull: fleetCaption(fleet),
				lead,
				deploys7d,
				rolloutsForSpark: group.cells.map((c) => c.rollout),
				mostRecentTs,
				lede
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

	const attnCount = $derived(appRows.filter((a) => a.rank === 0).length);
	const motionCount = $derived(appRows.filter((a) => a.rank === 1).length);
	/** The one sentence the page can say about the whole fleet. */
	const convergedCount = $derived(
		appRows.filter((a) => a.fleet.deployed > 0 && a.fleet.spread === 1).length
	);
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
					· {motionCount} in motion
				{/if}
				<!-- THE FLEET-LEVEL ANSWER TO CRITERION 1, in one number, before
				     any row is read: how many of these apps have every
				     environment on one build. It comes LAST because the two
				     counts above it are severity and severity leads — the same
				     order `/` puts its sections in. Neutral ink: this is a
				     summary of marks that are all already on screen. -->
				· {convergedCount} of {appRows.length} converged
			</p>
		{/if}
	</div>

	{#if query.isLoading}
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
		<div
			class="rounded-xl border border-gray-200 p-4 text-sm text-red-700 dark:border-gray-700 dark:text-red-400"
		>
			Failed to load: {(query.error as Error).message}
		</div>
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
		<div
			class="apps-panel overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
		>
			<!-- THE COLUMN HEADER ROW. Same idiom as `/rollouts`, which pins its
			     rows to a fixed grid under a sticky `Rollout · Pipeline · 24h ·
			     Version·age` header. It exists here for the same reason: three
			     of the four columns are measurements, and a measurement with no
			     name is a decoration. Hidden below the container breakpoint,
			     where each cell prints its own inline label instead.

			     `Fleet` again, not `Fleet by build`: the column no longer draws
			     a build axis, so a header that names one would be labelling a
			     graphic that is not there. -->
			<div class="apps-row apps-row--head border-b border-gray-200 px-4 py-2 dark:border-gray-700">
				<span class="apps-id t-label text-gray-500 dark:text-gray-400">App</span>
				<span class="apps-fleet t-label whitespace-nowrap text-gray-500 dark:text-gray-400"
					>Fleet</span
				>
				<span class="apps-act t-label whitespace-nowrap text-gray-500 dark:text-gray-400"
					>Deploys · 7d</span
				>
				<span class="apps-lead t-label text-gray-500 dark:text-gray-400">Lead</span>
			</div>

			<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each appRows as app (app.appName)}
					<li>
						<a
							href="/apps/{app.appName}"
							class="apps-row px-4 py-3 transition-colors {app.rank === 0
								? 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700/60 dark:hover:bg-gray-700'
								: 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}"
						>
							<!-- ── APP ─────────────────────────────────────────
							     Status circle, name, and the one sentence that
							     names the environment the shape cannot. -->
							<span class="apps-id flex min-w-0 items-center gap-3">
								<span
									class="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
										circleBakeStatus(app.circle)
									)}"
								>
									<BakeStatusIcon bakeStatus={circleBakeStatus(app.circle)} size="medium" />
									<span class="sr-only">{STATUS_WORD[app.worst]}</span>
								</span>
								<span class="flex min-w-0 flex-col gap-1">
									<span class="flex min-w-0 items-baseline gap-2">
										<span
											class="t-code min-w-0 truncate font-semibold text-gray-900 dark:text-white"
											>{app.appName}</span
										>
										{#if app.desc}
											<span
												class="apps-desc t-micro min-w-0 truncate text-gray-500 dark:text-gray-400"
												>{app.desc}</span
											>
										{/if}
									</span>
									<!-- THE MARK ROW. `gap-x-4 sm:gap-x-6` — 16px, 24px from
									     `sm` — is not a spacing whim, it is the denominator of
									     the proximity ratio that makes a LOOSE status dot
									     legible on a row carrying 3 to 13 environments. Each
									     unit binds its dot to its badge at 4px; the units are
									     16-24px apart. Measured ink-to-ink at 1440: 11px within
									     against 31px between, 2.82x. The joined `[●][ENV][WORD]`
									     box this replaces measured 13px against 22px at the old
									     `gap-x-2` — 1.69x, below the 2-3x Gestalt proximity
									     needs, i.e. the box was carrying the whole group on its
									     own. 16px rather than 24px below `sm` because 24px
									     pushes `checkout-edge` — the row that is actually stuck
									     — from one line to two at 390. -->
									<span class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 sm:gap-x-6">
										<!-- ONLY THE ENVIRONMENTS THAT NEED A PERSON get a
										     named box. Twelve regions one build behind are a
										     shape and the strip draws it; a stuck region is a
										     target and a target needs a name.

										     THE BOX IS THE WHOLE STATEMENT, and it comes FIRST
										     now. It carries the environment's identity colour,
										     its status hue, and — since 2026-08-26 — the WORD:
										     `stuck`, `failing` or `diverged`. Before that the
										     word for a failed deploy lived only in the lede, so
										     the row said `STAGING is failing` beside
										     `[● STAGING]` and every stuck row said `PROD is
										     stuck` beside `[● PROD][STUCK]` — the same fact,
										     twice, on the one line that matters.

										     `wide` on the env chip is load-bearing and is the
										     reason the sentence is safe to drop: `.chip`'s 12ch
										     cap rendered `PROD-EU-CENTRAL` as `PROD-EU…`, so
										     the lede was the only place the row spelled the
										     target out. `class="max-w-none"` cannot do this job
										     — see `Chip`'s `wide` prop. -->
										{#each app.adverse as cell (cell.tier)}
											<!-- ONE ENVIRONMENT, ONE BADGE, TWO SECTIONS:
											     `[NAME][STATE]`. Nothing else, and nothing beside it.

											     THERE IS NO STATUS DOT ON THIS ROW ANY MORE. It was a
											     third HALF of this box until 2026-08-27 (`[●][PROD][STUCK]`),
											     then briefly a loose mark 4px to its left, and the human
											     rejected both: *"I don't like that status dot is in a separate
											     subbadge"*, then *"I also don't like dots outside of badge"*.
											     Two placements rejected is not a request for a third — it is
											     a request for the mark to go, and it goes.

											     IT COSTS LESS THAN IT LOOKS, because the WORD was already
											     doing most of the dot's job. Every box in this list is an
											     adverse environment and every one prints `stuck`, `failing` or
											     `diverged` — so on a `[STAGING][FAILING]` unit the red dot was
											     saying, in colour, the word printed 1px to its right. WHAT IS
											     GENUINELY LOST is the in-flight case: a stuck environment that
											     is ALSO mid-deploy used to show an amber box with a blue dot.
											     That now reads at row scope (the status circle) and at
											     environment scope one click away on `/apps/<name>`; it is
											     stated in the unit's tooltip here, which still carries the
											     deploy-status word.

											     `wide` on the env chip is load-bearing and is the reason the
											     lede sentence is safe to drop: `.chip`'s 12ch cap rendered
											     `PROD-EU-CENTRAL` as `PROD-EU…`, so the sentence was the only
											     place the row spelled the target out. -->
											<span
												class="chip-joined shrink-0"
												title="{cell.envLabel}{cell.version
													? ` · ${cell.version}`
													: ''} · {STATUS_WORD[cell.state]}"
											>
												<Chip
													role="env"
													theme={cell.theme}
													label={cell.envLabel}
													wide
													title="{cell.envLabel}{cell.version
														? ` · ${cell.version}`
														: ''} · {STATUS_WORD[cell.state]}"
												/>
												{#if cell.state === 'stuck'}
													<Chip
														role="alarm"
														label="stuck"
														title="{cell.envLabel.toUpperCase()} is stuck"
													/>
												{:else if cell.rank.kind === 'diverged'}
													<Chip
														role="diverged"
														label="diverged"
														title="Running a build that is on no environment\u2019s release list"
													/>
												{:else if cell.state === 'fail'}
													<!-- THE WORD THE DELETED RED DOT USED TO SAY IN COLOUR.
													     Text-only, the same red as `rank` and `diverged`, so
													     `alarm` keeps the only fill on the page. -->
													<Chip
														role="failing"
														label="failing"
														title="{cell.envLabel.toUpperCase()}\u2019s last deploy failed"
													/>
												{/if}
											</span>
										{/each}
										{#if app.adverseMore > 0}
											<!-- COUNTED, NOT DROPPED — and NAMED in the tooltip, so
											     the cap costs a hover rather than the fact. -->
											<span
												class="t-micro shrink-0 text-gray-500 dark:text-gray-400"
												title={app.adverseRest}>+{app.adverseMore} more</span
											>
										{/if}
										<!-- THE SENTENCE SAYS WHAT NO BOX SAYS. Never an
										     environment that already has one. -->
										{#if app.lede}
											<span class="t-micro truncate text-gray-500 dark:text-gray-400"
												>{app.lede}</span
											>
										{/if}
									</span>
								</span>
							</span>

							<!-- ── FLEET ────────────────────────────────────────
							     Criterion 1: *"which apps' fleets are consistent?"*

							     ⛔ `FleetStrip` IS GONE FROM THIS COLUMN. (2026-08-27)
							     > *"fleet by build is both not stylistically concise with
							     > the rest of dashboard and is still not clear what it
							     > shows"* — the human, on the THIRD form of this object.

							     Two charges, and both are fair.

							     STYLE. Load `/` and `/rollouts` — the human's own three
							     best pages — and the vocabulary for multi-environment
							     state is CHIPS, prose and a dot-and-connector pipeline
							     glyph. A bespoke mark-and-gap run graphic existed nowhere
							     else in the product; it was a fourth idiom on a page whose
							     other three columns are a chip cluster, a sparkline and a
							     number.

							     CLARITY. Its encoding was PROXIMITY — *marks that touch
							     run the same build* — and proximity is a relation the
							     reader has to be TAUGHT, because nothing on the mark says
							     what its neighbour means. The teaching device was the
							     footer legend, and the human deleted that on 2026-08-26.
							     Three forms failed in a row (12-slot ruler, ruler with a
							     head anchor, mark-and-gap runs); the constant across all
							     three was not the drawing, it was that the reader has no
							     motive to decode it. *"Drift is the normal state of a
							     promotion pipeline. The only adverse state is stuck."* A
							     column that is never adverse was being given the most
							     graphic weight on the row.

							     WHAT ANSWERS THE CRITERION NOW: the count of builds, as a
							     WORD in the product's own `count` chip — the same chip
							     `/apps/[name]` already prints its fleet verdict in
							     (*"`role` ... is always `count` now"*). One chip = the
							     fleet is split N ways. NO chip = converged, because the
							     norm is not marked. It is unambiguous with no legend, it
							     is a chip like everything else on the row, and it sits at
							     ONE x down 50 rows, so the column can be scanned for
							     presence.

							     The `head <sha>` chip goes with the strip: it existed to
							     NAME the strip's leftmost run, and *"relative version
							     beats absolute — the sha is usually noise"*
							     (`DESIGN-INTENT.md`). The 84px it and the strip give back
							     goes to `App`, where the adverse boxes live. -->
							<span class="apps-fleet flex min-w-0 flex-col gap-1">
								<span
									class="apps-inline-label t-label whitespace-nowrap text-gray-500 dark:text-gray-400"
									>Fleet</span
								>
								<span class="apps-mark flex min-w-0 items-center">
									{#if app.fleet.spread > 1}
										<Chip
											role="count"
											label={`${app.fleet.spread} builds`}
											title="This app's {app.fleet
												.deployed} deployed environments are split across {app.fleet
												.spread} different builds"
											wide
											class="shrink-0"
										/>
									{/if}
								</span>
								<span
									class="t-micro truncate text-gray-500 dark:text-gray-400"
									title={app.fleetFull}>{app.fleetLine}</span
								>
							</span>

							<!-- ── DEPLOYS · 7d ─────────────────────────────────
							     Criterion 2. Below `SPARK_MIN` the count stands
							     alone: a sparkline of empty buckets is a shrug drawn
							     at the size of data.
							
							     THE LAST-DEPLOY TIME MOVED HERE from the deleted
							     `Head` column. Volume and recency are one question —
							     is this app churning or asleep — and on the rows where
							     the sparkline says nothing (`0 deploys`, no chart
							     drawn) `28d ago` is the only thing that answers it. -->
							<span class="apps-act flex min-w-0 flex-col gap-1">
								<span
									class="apps-inline-label t-label whitespace-nowrap text-gray-500 dark:text-gray-400"
									>Deploys · 7d</span
								>
								<!-- THE CHART SITS IN THE SAME 20px MARK LINE THE FLEET CHIP
								     AND THE LEAD FIGURE DO, and it holds that height when
								     there is no chart. At 390 `Lead` and `Deploys` are two
								     columns of one card: without the reserved band a row
								     with a sparkline put its caption at y170 and the row
								     beside it put its caption at y149, so the pair had no
								     baseline at all — the phone form of the exact defect
								     `.env-line` fixed on the desktop row. -->
								<span class="apps-mark flex items-center">
									{#if app.deploys7d >= SPARK_MIN}
										<DeployVolumeSparkline rollouts={app.rolloutsForSpark} days={SPARK_DAYS} />
									{/if}
								</span>
								<span class="t-micro truncate text-gray-500 dark:text-gray-400"
									>{app.deploys7d} deploy{app.deploys7d === 1
										? ''
										: 's'}{#if app.mostRecentTs}{' · '}<span title={formatDate(app.mostRecentTs)}
											>{formatTimeAgoCompact(app.mostRecentTs, $now)} ago</span
										>{/if}</span
								>
							</span>

							<!-- ── LEAD ─────────────────────────────────────────
							     Criterion 3. Median MEASURED time from the first
							     environment to the first production region. An
							     em-dash when no build has been observed making the
							     whole trip inside the retained history — never an
							     estimate. -->
							<span class="apps-lead flex min-w-0 flex-col gap-1">
								<span class="apps-inline-label t-label text-gray-500 dark:text-gray-400">Lead</span>
								{#if app.lead}
									<span
										class="apps-mark t-dense flex items-center text-gray-900 tabular-nums dark:text-white"
										title="Median of {app.lead.samples} build{app.lead.samples === 1
											? ''
											: 's'} observed travelling {app.lead.fromLabel} → {app.lead.toLabel}"
										>{compactSpan(app.lead.medianMs)}</span
									>
									<span class="t-micro truncate text-gray-500 dark:text-gray-400"
										>{app.lead.fromLabel} → {app.lead.toLabel}</span
									>
								{:else}
									<span
										class="apps-mark t-dense flex items-center text-gray-500 dark:text-gray-400"
										title="No build has been observed travelling the whole chain inside this app’s retained deploy history"
										>—</span
									>
									<span class="t-micro truncate text-gray-500 dark:text-gray-400">not observed</span
									>
								{/if}
							</span>
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

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
	@container (min-width: 720px) {
		.apps-row {
			grid-template-columns: minmax(0, 1fr) 164px 128px 76px;
			grid-template-areas: 'id fleet act lead';
			align-items: center;
			column-gap: 16px;
			row-gap: 0;
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
</style>
