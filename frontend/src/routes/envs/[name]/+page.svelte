<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE ENVIRONMENT — REBUILT ON THE CARD GRAMMAR (2026-08-30).
	 *
	 * Criteria (`PAGE-CRITERIA.md` §03):
	 *   1. What's running here right now?      — every app's live version
	 *   2. What here is unhealthy or behind?   — sorted to the top
	 *   3. What's mid-rollout here?            — canary / queued badges
	 *
	 * ─── THE FOUR DEFECTS A LIVE CRITIQUE FOUND, AND WHAT REPLACES THEM ──
	 *
	 * 1. **The promotion chain was identical decoration on every row.**
	 *    `DEV › STAGING › PROD`, four times, with no state on any node. A
	 *    column that renders the same glyph sequence on every row is a
	 *    column of wallpaper. **The chain now carries the GAP ON EACH HOP** —
	 *    how many builds are sitting in the upstream environment that have
	 *    not reached the downstream one — so a converged app draws bare
	 *    chevrons and a stalled hop draws its number. That is
	 *    `DESIGN-INTENT.md`'s own framing: *"Promotion is the subject, not
	 *    lag — what moved, what's stuck, what's next."*
	 * 2. **Two stray single-pixel green bars** beside `3 namespaces` and
	 *    `DEPLOYS · 24H`. `DeployVolumeSparkline` renders 12 buckets; with
	 *    every deploy inside one hour, eleven of them are a 20%-height gray
	 *    hairline and one is a green tick. That is a rendering glitch drawn
	 *    at the size of data. `SPARK_MIN` now counts NON-EMPTY BUCKETS, not
	 *    deploys — a chart needs a SHAPE, not a total — and the duplicate in
	 *    the header meta line is deleted outright.
	 * 3. **No card had a header.** Every region was a bordered box with a
	 *    `t-label` caption floating above it, which is the shape six rejected
	 *    pages share and the reference page has nowhere. Every region is now
	 *    a `Card`: 47px header bar, 16px icon, right-aligned rollup.
	 * 4. **No blocking fact was ever stated.** The page announced a `−24` and
	 *    said nothing about the gate holding it. `AlertPanel` — rollout
	 *    detail's own schedule-gate banner — now leads the page whenever a
	 *    fact here breaks, stalls or blocks, and is absent otherwise.
	 *
	 * ─── WHAT IS DELIBERATELY NOT HERE, AND MUST NOT COME BACK ───────────
	 *
	 * · **No verdict sentence.** From the human: *"Environment and app detail
	 *   I generally don't like this descriptive text … attention is pulled in
	 *   to where is necessary. Text doesn't cut it and just pollutes."* A
	 *   sentence describing the first row of a list 180px below it is a
	 *   caption for a mark that is louder than the caption. The BANNER is not
	 *   that sentence: it states a fact that is not otherwise on the page and
	 *   it carries the action for it.
	 * · **No `EnvHealthStrip`, no `DeployHistoryStrip`.** *"i also don't
	 *   understand what these gray bars mean there and on the detail page"*.
	 *   Both drew one tick per app or per deploy, both were ~92-96% norm, and
	 *   a mark whose common case means nothing cannot teach its own
	 *   exceptions. Deleted; do not rebuild either.
	 * · **No env-level promotion chain.** Each app declares its own
	 *   environments and they differ — `edge-mesh` runs dev plus thirteen
	 *   regions, `orders-api` runs dev, staging, prod. There is no such thing
	 *   as "the chain of prod". Chains are PER APP, inline, and nowhere else.
	 * · **No mint "you are here" pill.** The current environment's chip
	 *   renders in ITS OWN identity theme and every other node renders
	 *   neutral gray. One coloured chip per chain, the colour is the
	 *   environment's own, zero new colour values.
	 */
	// `medianBakeSpan` is the one home for this maths now (`lead-time.ts`) —
	// `/apps/<name>` carried a byte-identical copy of the same loop.
	import { medianBakeSpan } from '$lib/view-models/lead-time';
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, rolloutPath } from '$lib/source-dashboard';
	import { groupRolloutsByApp, versionPathForRollout } from '$lib/version-utils';
	import type { AppGroup, AppCell } from '$lib/version-utils';
	import { rankVerdicts, rankRole, rankBehindBy, rankIsAdverse } from '$lib/view-models/env-rank';
	import type { RankVerdict } from '$lib/view-models/env-rank';
	import {
		newestDeployableCandidate,
		promotionBlock,
		detectStuckPromotion
	} from '$lib/view-models/promotion';
	import { buildGateContext, blockingStory } from '$lib/view-models/blocking-story';
	import type { GateContext, BlockingStory, ClassifiedGate } from '$lib/view-models/blocking-story';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import type { PromotionBlock } from '$lib/view-models/promotion';
	import { buildRolloutCards, cardStateMark } from '$lib/rollout-cards';
	import type { StatusKey, CardStateMark } from '$lib/rollout-cards';
	import { getEnvironmentRank } from '$lib/env-order';
	import {
		formatTimeAgoCompact,
		formatDate,
		getDisplayVersion,
		plainMessage,
		formatDurationMs,
		detectStuck,
		detectStuckBehind
	} from '$lib/utils';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import { regionLabel } from '$lib/view-models/regions';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import Chip from '$lib/components/Chip.svelte';
	import Card from '$lib/components/Card.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList from '$lib/components/FactList.svelte';
	import { now } from '$lib/stores/time';
	import {
		ArrowLeftOutline,
		LayersSolid,
		ChevronRightOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		ClockOutline,
		CalendarWeekSolid
	} from 'flowbite-svelte-icons';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import { getStatusCircleClass, bakeWord } from '$lib/bake-status';
	import ActivityRail from '$lib/components/ActivityRail.svelte';
	import HowItsGoing from '$lib/components/HowItsGoing.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import NextStep from '$lib/components/NextStep.svelte';
	import BlockReason from '$lib/components/BlockReason.svelte';
	import PinBadge from '$lib/components/PinBadge.svelte';
	import type { Rollout, Environment } from '../../../types';

	/**
	 * THE STATUS CIRCLE — the repo's atom, not a dot. `getStatusCircleClass()`
	 * gives the per-status tinted ground and `BakeStatusIcon` the COLOURED
	 * glyph inside: Succeeded GREEN check, Failed RED exclamation, InProgress
	 * (checking) YELLOW pulse, Deploying BLUE spinner, none GRAY pause. Checking
	 * and Deploying are different states and may never share a hue, which is
	 * why this page draws the atom instead of reimplementing it.
	 */
	// DISC DIAMETER: `h-7 w-7` (28px), the list-row token — see
	// `BakeStatusIcon.svelte`. Was `h-6 w-6` (24px); both grid tracks below
	// that reserve a column for this disc moved with it.
	const STATUS_CIRCLE = 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full';

	/**
	 * THE ROW: `28px │ 1fr app │ 1fr chain │ 132px build │ 56px age │ 112px action`.
	 *
	 * Every fixed width is measured content, not a round number. 132px holds
	 * `head 9a1f4c2` whole at every width the grid applies at — flexible, it
	 * resolved to 92px at 1280 and truncated the answer to `9a1…` on the page
	 * whose FIRST criterion is "what's running here right now". 112px is the
	 * LONGEST button label (`Review gates`), not the shortest. 56px is a
	 * 12px clock glyph, a 4px gap and `23h` — the age cell takes the same
	 * `[clock] 22h` pair the reference page prints on all nineteen of its
	 * upgrade rows.
	 */
	/**
	 * ⛔ THE VERSION TRACK IS 176px, NOT 132, AND THE ACTION TRACK IS 152.
	 * (2026-08-30) Both were sized against words that no longer exist. `−19`
	 * became `19 behind` and `head` became `newest`, so the joined box grew
	 * from ~118px to ~162px and clipped itself to `19 BEHI… d09e6…` — a rank
	 * and a build id BOTH ellipsised, which is the whole cell. `Promote`
	 * became `Deploy newest`, which is ~148px with its 16px icon and 32px of
	 * padding against a 112px track.
	 *
	 * ⛔ AND THE CHAIN TRACK IS `1.4fr` AGAINST THE APP'S `1fr`. Taking the
	 * width evenly out of two `1fr` tracks was measured and reverted inside one
	 * pass: the list column is 840px at 1440 with the 320px rail, so each `1fr`
	 * fell to 185px and the three-link `DEV › 2 › STAGING › 17 › PROD` (~195px)
	 * wrapped `PROD` onto a second line on every row. The two tracks were never
	 * carrying comparable content — a chain is 3–4 chips plus its gap numbers,
	 * an app name is one string — and splitting the cost equally between them
	 * charged the wrong one. Measured after: app 163px against `checkout-edge`
	 * + its `stuck` alarm at ~156px, chain 229px. The four-link `payments-core`
	 * chain still wraps, as it did before.
	 */
	// 168px, not 156: the widest joined badge the column draws is `1 BEHIND 2.66.0-66`,
	// and at 156 its version half measured 60px against 62px of text — the identifier
	// that answers "which build" ellipsised on the one row that is stuck.
	const ROW_GRID = 'lg:grid-cols-[28px_minmax(0,1fr)_minmax(0,1.4fr)_168px_56px_152px]';

	const envName = $derived(page.params.name as string);

	const query = createQuery(() =>
		rolloutsListQueryOptions({
			options: { staleTime: 10000, refetchInterval: pollWhenHealthy(10000) }
		})
	);
	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	/**
	 * ⭐ THE GATE JOIN TABLE, so `detectStuckPromotion` can tell "needs a
	 * person" apart from "waiting on another deploy". Built from the SAME
	 * `/api/rollouts` payload this page already has — `Environment` and
	 * `RolloutDependency` are both top-level keys on it, same as
	 * `/apps/<name>`'s `gateContext`. See the note on `stuckFor` below for
	 * the defect this exists to close.
	 */
	const gateContext = $derived.by<GateContext>(() =>
		buildGateContext({
			environments: query.data?.environments ?? null,
			rolloutDependencies: query.data?.rolloutDependencies ?? null
		})
	);

	// Distinct from `slots.length === 0`, which also means "tier exists but
	// nothing has deployed here yet".
	const envExists = $derived(environments.some((e) => e.spec?.environment === envName));

	const groups = $derived.by<Map<string, AppGroup>>(() =>
		groupRolloutsByApp(rollouts, environments)
	);

	type EnvSlot = {
		appName: string;
		group: AppGroup;
		cell: AppCell;
		rank: RankVerdict;
		/** Every cell of this app, ranked — the chain needs its siblings. */
		ranks: Map<AppCell, RankVerdict>;
	};

	const slots = $derived.by<EnvSlot[]>(() => {
		const out: EnvSlot[] = [];
		for (const group of groups.values()) {
			// ONE ladder per app, not one per row.
			const ranks = rankVerdicts(group);
			for (const cell of group.cells)
				if (cell.environment?.spec?.environment === envName)
					out.push({
						appName: group.appName,
						group,
						cell,
						rank: ranks.get(cell) ?? { kind: 'unknown' },
						ranks
					});
		}
		return out;
	});

	// The same succeeded|failed|active|pending classification `/` and
	// `/rollouts` use, so "healthy" here means what it means everywhere.
	const statusByRollout = $derived.by<Map<Rollout, StatusKey>>(() => {
		const map = new Map<Rollout, StatusKey>();
		for (const c of buildRolloutCards(rollouts, environments, $now))
			map.set(c.rollout, c.statusKey);
		return map;
	});

	/**
	 * ⭐ THE DISC'S `rolled back` / `pinned` / `held` MARK — `cardStateMark`,
	 * the SAME precedence `/`, `/rollouts` and `CommandPalette` read, off the
	 * SAME `RolloutCard` shape `statusByRollout` above already builds. This
	 * page's disc used to draw only the plain bake glyph (green check for
	 * every settled row, held or not) — the fourth spelling of the same
	 * fact `/apps`' aggregate disc also had wrong, measured on the live
	 * `hello-frontend-app` contract hold. Built once per rollout list, not
	 * per row, so the map lookup below stays O(1).
	 */
	const markByRollout = $derived.by<Map<Rollout, CardStateMark | null>>(() => {
		const map = new Map<Rollout, CardStateMark | null>();
		for (const c of buildRolloutCards(rollouts, environments, $now))
			map.set(c.rollout, cardStateMark(c));
		return map;
	});

	const slotTheme = $derived.by<EnvironmentTheme | null>(() => {
		for (const s of slots) if (s.cell.theme) return s.cell.theme;
		for (const env of environments) {
			if (env.spec?.environment !== envName) continue;
			const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
			const t = getRolloutEnvironmentTheme(r ?? null, env);
			if (t) return t;
		}
		return getRolloutEnvironmentTheme(null, envName);
	});

	/**
	 * A production REGION prints its distinguishing segment — `AF-SOUTH-1`,
	 * not `PROD-AF-SOUTH-1`. `PRODUCTION` measured 82.2px at 231.6 presence
	 * against the `stuck` alarm's 199.8: an identity mark LOUDER than the
	 * alarm, which is the one ceiling that may never be crossed.
	 */
	const envShort = $derived(
		getEnvironmentRank(envName) === 8
			? regionLabel(envName)
			: shortEnvLabel(slotTheme ?? envName) || envName
	);
	/**
	 * ⭐ THE CHIP PRINTS ONLY WHEN IT SAYS SOMETHING THE `h1` DOES NOT.
	 * (2026-09-02, from a live measurement on `/envs/dev`: the `h1` drew `dev`
	 * at 24px mono/700 and the chip drew `DEV` eight pixels later — the same
	 * four characters twice, one of them just upper-cased by `.chip`'s own
	 * CSS.) For a REGION `envShort` genuinely differs (`AF-SOUTH-1` against
	 * the `h1`'s `prod-af-south-1`) and the chip is the only place that
	 * segment is drawn, so it stays. For a plain tier the two strings are the
	 * SAME identifier in two cases, and `Keep one: the display-size name is
	 * the h1; the chip goes` — the `h1` is the object's own addressable name
	 * and the chip would be adding no fact, only the identity colour, which
	 * this page spends nowhere else and is not load-bearing here the way it
	 * is on a row comparing several environments at once.
	 */
	const envChipRedundant = $derived(envShort.toLowerCase() === envName.trim().toLowerCase());
	/**
	 * EXACT name match only. `getRolloutEnvironmentTheme` matches presets by
	 * PATTERN, so every `prod-*` region also resolves to "Production" — and
	 * `prod-eu-west  Production` puts two different environments on one line.
	 */
	const PRESET_TITLES: Record<string, string> = {
		dev: 'Development',
		development: 'Development',
		prod: 'Production',
		production: 'Production',
		stage: 'Staging',
		staging: 'Staging',
		test: 'Test',
		testing: 'Test'
	};
	const envTitle = $derived.by<string>(() => {
		const exact = PRESET_TITLES[envName.trim().toLowerCase()];
		if (exact) return exact;
		const label = slotTheme?.label ?? '';
		if (!label || label.toLowerCase() === envName.trim().toLowerCase()) return '';
		return PRESET_TITLES[label.toLowerCase()] ? '' : label;
	});

	/**
	 * `sub` is the rollout tab to land on — `dependencies`, when the banner's
	 * `Review gates` control is naming a cross-service contract, so the
	 * reader lands where the requirement is actually drawn rather than on the
	 * Overview tab, where they would have to find the Dependencies tab
	 * themselves. Omitted for every other gate kind, unchanged.
	 */
	function rolloutHref(cell: AppCell, sub?: string): string {
		return rolloutPath(
			cell.sourceCluster || localClusterName,
			cell.rollout.metadata?.namespace || '',
			cell.rollout.metadata?.name || '',
			sub
		);
	}
	function cellVersion(cell: AppCell): string | null {
		const v = cell.rollout.status?.history?.[0]?.version;
		return v ? getDisplayVersion(v) || null : null;
	}
	function isRunning(s: string) {
		return s === 'InProgress' || s === 'Deploying';
	}

	/**
	 * ⭐ THE FIX IS AT THE SOURCE — `detectStuckPromotion` now takes the
	 * `gateContext` join and excludes a block held entirely by `upstream`
	 * (environment/dependency) gates from `stuck`, matching
	 * `/apps/<name>`'s `refusedNotStalled`. (2026-09-02) Without it, a
	 * correctly-gated rollout — every gate `passing: true`, on the newest
	 * build its own contract admits — read `STUCK` in amber here while
	 * `/apps/<name>` and rollout detail both said "waiting on another
	 * deploy". Live proof: `hello-frontend-app` in `hello-dep-prod`, held
	 * by `ghd-5b2wn` (the environment controller's promotion gate) and
	 * `dependency-hello-frontend-needs-api` (the contract gate; `rel-67`
	 * needs `api ^1.67.0`, `hello-api-app` serves `1.66.0`). See
	 * `promotion.ts`'s own note on `detectStuckPromotion` for the mechanism.
	 */
	function stuckFor(slot: EnvSlot) {
		const own = detectStuck(slot.cell.rollout, { now: $now });
		if (own) return own;
		const promo = detectStuckPromotion(slot.cell.rollout, { now: $now, gateContext });
		if (promo) return promo;
		for (const peer of slot.group.cells) {
			if (peer === slot.cell) continue;
			const r = detectStuckBehind(slot.cell.rollout, peer.rollout, peer.envName, { now: $now });
			if (r) return r;
		}
		return null;
	}
	type StuckReason = NonNullable<ReturnType<typeof stuckFor>>;

	/**
	 * NEVER NAMES A CAUSE IT CANNOT EVIDENCE.
	 *
	 * ⛔ AND IT NO LONGER NAMES THE BAKE (2026-08-30). This was the product's
	 * densest patch of its own vocabulary — `Bake succeeded` / `Bake failed` /
	 * `Baking` / `Bake cancelled`, four strings naming a CRD field on the page
	 * whose `Median bake` tile the novice pass had already renamed to
	 * `Typical deploy`. One table now, in `bake-status.ts`.
	 */
	function stateLabel(status: string): string {
		return bakeWord(status);
	}

	type Row = {
		slot: EnvSlot;
		key: string;
		appName: string;
		title: string | null;
		status: string;
		statusKey: StatusKey;
		version: string | null;
		versionHref: string | null;
		rank: RankVerdict;
		timestamp: string | null;
		message: string;
		stuck: StuckReason | null;
		block: PromotionBlock;
		/**
		 * ⭐ THE CLASSIFIED GATES HOLDING THIS ROLLOUT — the shared
		 * `view-models/blocking-story` derivation, so the banner naming this
		 * app can say WHO (the dependency's provider) and WHAT (its required
		 * range), not just how many gates. See the banner's own `blocked`
		 * branch. `place` is this page's own environment, unused for anything
		 * printed here — the banner composes its own sentence from `gates`.
		 */
		story: BlockingStory;
		/** `rolled back` / `pinned` / `held`, for the disc — see `markByRollout`. */
		mark: CardStateMark | null;
		/** Tag a `Promote` here would deploy, or null when none may be offered. */
		promoteTag: string | null;
		adverse: boolean;
		/** Exactly one row on the whole page may carry this. */
		primary: boolean;
		severity: number;
	};

	const rows = $derived.by<Row[]>(() => {
		const out: Row[] = [];
		for (const slot of slots) {
			const latest = slot.cell.rollout.status?.history?.[0];
			const status = latest?.bakeStatus || 'None';
			const statusKey = statusByRollout.get(slot.cell.rollout) ?? 'pending';
			const version = cellVersion(slot.cell);
			const stuck = stuckFor(slot);
			const candidate = newestDeployableCandidate(slot.cell.rollout);
			// NEEDS A PERSON vs MERELY BEHIND. Being behind is the normal state
			// of a promotion pipeline; it earns a rank chip, not a control. A
			// row gets buttons when someone has to decide something, or when
			// there is a promotion that would actually succeed —
			// `newestDeployableCandidate` is non-null only when every gate has
			// already allowed that exact tag. An offer that would be refused is
			// worse than no offer.
			const needsPerson = statusKey === 'failed' || !!stuck || slot.rank.kind === 'diverged';
			const adverse = needsPerson || !!candidate;
			out.push({
				slot,
				key:
					slot.appName +
					(slot.cell.sourceCluster ?? '') +
					(slot.cell.rollout.metadata?.namespace ?? ''),
				appName: slot.appName,
				title:
					slot.cell.rollout.status?.title && slot.cell.rollout.status.title !== slot.appName
						? slot.cell.rollout.status.title
						: null,
				status,
				statusKey,
				version,
				versionHref: version
					? versionPathForRollout(slot.cell.rollout, slot.appName, version)
					: null,
				rank: slot.rank,
				timestamp: latest?.timestamp ?? null,
				// A message is worth a line only when a PERSON wrote it. Every
				// controller-driven promotion carries the same boilerplate.
				message:
					latest?.triggeredBy?.kind && latest.triggeredBy.kind !== 'System'
						? plainMessage(latest?.message)
						: '',
				stuck,
				block: promotionBlock(slot.cell.rollout),
				story: blockingStory(slot.cell.rollout, gateContext, { place: envName, now: $now }),
				mark: markByRollout.get(slot.cell.rollout) ?? null,
				promoteTag: candidate ? (candidate.tag ?? candidate.version ?? null) : null,
				adverse,
				primary: false,
				/**
				 * WORST FIRST, AND "WORST" IS CRITERION 2'S OWN WORDING —
				 * *"what here is unhealthy or behind, SORTED TO THE TOP"*.
				 * A deploy in progress is not unhealthy, it is the pipeline
				 * working, so it sorts below the rows that are not; criterion
				 * 3 carries it in the status circle instead. `diverged` gets
				 * its own band above `behind` because it is not a distance:
				 * promoting N times never arrives at it.
				 */
				severity:
					status === 'Failed'
						? 5
						: stuck
							? 4
							: slot.rank.kind === 'diverged'
								? 3
								: rankIsAdverse(slot.rank)
									? 2
									: isRunning(status)
										? 1
										: 0
			});
		}
		out.sort((a, b) => {
			if (a.severity !== b.severity) return b.severity - a.severity;
			const lag = rankBehindBy(b.rank) - rankBehindBy(a.rank);
			if (lag !== 0) return lag;
			return a.appName.localeCompare(b.appName);
		});
		// ONE primary per page, on the topmost row that needs a decision.
		const first = out.find((r) => r.adverse);
		if (first) first.primary = true;
		return out;
	});

	/**
	 * ⛔ NO GROUP-SCOPE RANK RECOLOURING. This page and `/environments` used to
	 * switch the `−N` chip between `rank` and `count` when every app in the
	 * list was behind, so that a uniformly-behind list did not print a red
	 * mark on every row. **`Chip`'s `rank` role is now `NEUTRAL`
	 * product-wide** — the colour audit landed `DESIGN-INTENT.md`'s own rule
	 * (*"rank chips are mint for `newest` and NEUTRAL GRAY for `−N from
	 * newest`"*) — so `rank` and `count` render the same three values and the
	 * switch was a no-op reading as a live rule. Deleted rather than left as a
	 * dead lever. If `rank` ever goes back to red, the group-scope switch is
	 * the fix, and this note is where to find it.
	 */

	// ──────────────────────────── The rollup ───────────────────────────────
	const failingCount = $derived(rows.filter((r) => r.statusKey === 'failed').length);
	const stuckCount = $derived(rows.filter((r) => !!r.stuck).length);
	const healthyCount = $derived(
		rows.filter((r) => r.statusKey !== 'failed' && !r.stuck && r.status !== 'None').length
	);

	// ──────────────────────────── The banner ───────────────────────────────
	/**
	 * ONE blocking fact, filled, at the top — the object the human named when
	 * they said *"there are many examples on the rest of the page that are
	 * much better"* than a gray row band. `AlertPanel` IS rollout detail's
	 * schedule-gate banner.
	 *
	 * `behind` alone NEVER earns it. Being behind is the normal state of a
	 * promotion pipeline, and a banner that fires on it fires always.
	 */
	type Banner = {
		severity: 'error' | 'warning';
		icon: typeof ExclamationCircleSolid;
		title: string;
		message: string;
		/**
		 * ⭐ THE DISCLOSED TIER — `AlertPanel`'s own third tier, and the reason
		 * it exists here. (2026-08-31)
		 *
		 * The blocked banner used to PRINT the gate object names: *"1 newer
		 * build of hello-frontend-app is waiting on 2 gates:
		 * dependency-hello-frontend-needs-api, ghd-5b2wn."* `ghd-5b2wn` is a
		 * generated Kubernetes name. It is a lookup key for `kubectl`, not a
		 * sentence, and printing it in the most-read line on the page put a
		 * string no reader can act on inside the fact they read first.
		 *
		 * IT WAS ALSO A REPEAT. Measured at 1440 on `/envs/prod`, both handles
		 * appeared TWICE in one viewport — here, and again on the app row 250px
		 * below, which is the object that actually owns them. The row keeps
		 * them printed (it is the grain they belong to and it prints them once);
		 * the banner discloses them, because its list is a UNION over every
		 * blocked app and belongs to no single row.
		 *
		 * ⛔ NOT DELETED. `AlertPanel` renders the disclosure in a native
		 * `<details>`, so the names stay in the DOM, keyboard-reachable and
		 * selectable — which a `title` tooltip would not be on a phone.
		 *
		 * ⭐ IT IS A SET, SO IT IS A RECORD AND THE TRIGGER COUNTS. (2026-09-02)
		 * It was the string `rule: a, b` behind a control labelled `Which rule`
		 * / `Which rules` — an INTERROGATIVE, which `AlertPanel`'s own
		 * `footnoteLabel` note had already banned in as many words a day
		 * earlier (*"i'm not sure i particularly like that format 'what clears
		 * this'"*). This is the call site that pass did not own, so the ban
		 * never reached it. The names are a SET of one kind, which is exactly
		 * the shape `lib/disclosure.ts` gives the count form to, and `FactList`
		 * dresses each one as the handle it is instead of comma-joining them
		 * into a sentence that is not a sentence.
		 */
		gates?: string[];
		href: string;
		action: string;
	};

	const banner = $derived.by<Banner | null>(() => {
		const failed = rows.filter((r) => r.statusKey === 'failed');
		if (failed.length > 0)
			return {
				severity: 'error',
				icon: ExclamationCircleSolid,
				title:
					failed.length === 1
						? `${failed[0].appName} failed to deploy here`
						: `${failed.length} deploys have failed here`,
				message:
					failed.length === 1
						? 'The last deploy did not complete. Nothing newer will promote past it.'
						: failed.map((r) => r.appName).join(' · '),
				href: rolloutHref(failed[0].slot.cell),
				action: 'Open rollout'
			};

		const stuck = rows.filter((r) => !!r.stuck);
		if (stuck.length > 0)
			return {
				severity: 'warning',
				icon: ClockSolid,
				title:
					stuck.length === 1
						? `${stuck[0].appName} is stuck here`
						: `${stuck.length} rollouts are stuck here`,
				message:
					stuck.length === 1
						? 'It has not advanced for longer than this app takes to deploy.'
						: stuck.map((r) => r.appName).join(' · '),
				href: rolloutHref(stuck[0].slot.cell),
				action: 'Open rollout'
			};

		// BLOCKED — attributed to the app holding the most builds, which is
		// where clearing the gate moves the most.
		const blocked = rows
			.filter((r) => r.block.blocked && r.block.candidateCount > 0)
			.sort((a, b) => b.block.candidateCount - a.block.candidateCount);
		if (blocked.length > 0) {
			const gates = new Set<string>();
			for (const r of blocked) for (const g of r.block.blockingGates) gates.add(g);
			const n = blocked[0].block.candidateCount;
			const g = gates.size;
			// ⛔ `WAITING ON N GATES` NAMED NEITHER THE PROVIDER NOR THE
			// REQUIREMENT. (2026-09-02, measured on `/envs/prod`: this banner
			// read *"1 newer build of hello-frontend-app is waiting on 2
			// gates"* while `/apps`, `/apps/[name]`, `/environments` and the
			// Dependencies tab all name `hello-api-app` and `^1.67.0` for the
			// SAME block.) `blockingStory`'s own classified gates carry both —
			// `subject` is the provider, `need` is the requirement verbatim —
			// so this composes the same facts instead of re-deriving a vaguer
			// sentence from `block.blockingGates`' bare names. Worst-first,
			// same order the story itself sorts in; a dependency gate is
			// preferred over a same-rank promotion gate because it is the one
			// this page cannot draw anywhere else (the per-row `BlockReason`
			// below prints `awaiting`/`notPassing`, not the classified story).
			const story = blocked[0].story;
			const namedGate: ClassifiedGate | undefined =
				story.gates.find(
					(gt): boolean => gt.kind === 'dependency' && !!gt.contract && !!gt.have && !!gt.need
				) ?? story.gates[0];
			const drawsVersions =
				namedGate?.kind === 'dependency' && !!namedGate.contract && !!namedGate.have && !!namedGate.need;
			const clause = drawsVersions
				? `waiting for ${namedGate!.subject} to ship ${namedGate!.contract} ${namedGate!.need} — it is on ${namedGate!.have}`
				: `waiting on ${g} gate${g === 1 ? '' : 's'}`;
			return {
				severity: 'warning',
				icon: CalendarWeekSolid,
				title: `Promotion into ${envName} is blocked`,
				message: `${n} newer build${n === 1 ? '' : 's'} of ${blocked[0].appName} ${n === 1 ? 'is' : 'are'} ${clause}.`,
				gates: [...gates],
				// ⭐ THE CONTROL DEEP-LINKS TO WHERE THE FIX IS DRAWN. A contract's
				// requirement lives on the Dependencies tab, not Overview — every
				// other gate kind keeps landing on Overview, unchanged.
				href: rolloutHref(blocked[0].slot.cell, drawsVersions ? 'dependencies' : undefined),
				action: 'Review gates'
			};
		}

		return null;
	});

	// ───────────────────────── Metrics (the rail) ──────────────────────────
	const SPARK_BUCKETS = 12;
	const SPARK_HOURS = 24;

	/**
	 * A CHART NEEDS A SHAPE, NOT A TOTAL.
	 *
	 * This threshold used to count DEPLOYS (`deploys24h >= 3`), and on a
	 * cluster where nine deploys land inside one hour that passed — so
	 * `DeployVolumeSparkline` drew eleven 20%-height gray hairlines and one
	 * green tick. Rendered at 16x4px beside a number, the result is the
	 * **"stray single-pixel green bar"** a live critique reported next to
	 * `3 namespaces` and `DEPLOYS · 24H`: an object that reads as a rendering
	 * glitch rather than as data.
	 *
	 * It now counts NON-EMPTY BUCKETS, which is the thing a sparkline is a
	 * picture of. Below three there is no trend to draw and the number beside
	 * it already says everything true.
	 */
	const SPARK_MIN_BUCKETS = 3;

	const sparkBuckets = $derived.by<number>(() => {
		const nowMs = $now.getTime();
		const totalMs = SPARK_HOURS * 60 * 60 * 1000;
		const start = nowMs - totalMs;
		const width = totalMs / SPARK_BUCKETS;
		const filled = new Set<number>();
		for (const s of slots)
			for (const h of s.cell.rollout.status?.history ?? []) {
				if (!h.timestamp) continue;
				const ts = new Date(h.timestamp).getTime();
				if (ts < start || ts > nowMs) continue;
				filled.add(Math.min(SPARK_BUCKETS - 1, Math.floor((ts - start) / width)));
			}
		return filled.size;
	});
	const showSpark = $derived(sparkBuckets >= SPARK_MIN_BUCKETS);

	const deploys24h = $derived.by(() => {
		const cutoff = $now.getTime() - 24 * 60 * 60 * 1000;
		let n = 0;
		for (const s of slots)
			for (const h of s.cell.rollout.status?.history ?? []) {
				if (!h.timestamp) continue;
				if (new Date(h.timestamp).getTime() >= cutoff) n++;
			}
		return n;
	});

	/**
	 * MEDIAN BAKE — the median of every bake window this environment has a
	 * measured span for. A bake still running has no `bakeEndTime` and is
	 * excluded rather than clamped to "now": an in-flight window is not a
	 * duration yet. With nothing to measure the tile prints an em dash; it
	 * never prints `0`.
	 */
	const medianBakeMs = $derived(medianBakeSpan(slots.map((s) => s.cell.rollout)));

	/**
	 * PROMOTION RATE — the share of apps here running their app's NEWEST
	 * build. Rows whose rank is `unknown` are excluded from BOTH halves
	 * rather than counted as failures: `unknown` means the ladder could not
	 * answer, and DESIGN.md forbids rendering an unresolvable comparison as a
	 * claim. When nothing is rankable the tile prints an em dash.
	 */
	const promotionRate = $derived.by<number | null>(() => {
		const rankable = rows.filter((r) => r.rank.kind !== 'unknown');
		if (rankable.length === 0) return null;
		return Math.round(
			(rankable.filter((r) => r.rank.kind === 'newest').length / rankable.length) * 100
		);
	});

	/**
	 * THE SAME SHARE, SAID AS A COUNT RATHER THAN A PERCENTAGE.
	 *
	 * `25% on newest` failed the novice test twice over: `on newest` is this
	 * product's own shorthand, and a percentage of four items hides its own
	 * denominator — `25%` of four apps and `25%` of two hundred are not the
	 * same statement, and only one of them is worth reading. `1 of 4 up to
	 * date` is the reference page's own `3/3 healthy` rollup idiom and it is
	 * the phrase `/apps` and `/apps/[name]` now print for the same fact.
	 *
	 * The DENOMINATOR IS THE RANKABLE ROWS, exactly as `promotionRate`'s is:
	 * an `unknown` rank means the ladder could not answer, and `DESIGN.md`
	 * forbids rendering an unresolvable comparison as a claim.
	 */
	const rankableCount = $derived(rows.filter((r) => r.rank.kind !== 'unknown').length);
	const onNewestCount = $derived(rows.filter((r) => r.rank.kind === 'newest').length);

	/** THE ONE QUANTITY `/environments` ranks on, restated at this scope. */
	const deepest = $derived.by<{ by: number; appName: string } | null>(() => {
		let out: { by: number; appName: string } | null = null;
		for (const r of rows) {
			const by = rankBehindBy(r.rank);
			if (by > 0 && (!out || by > out.by)) out = { by, appName: r.appName };
		}
		return out;
	});

	const lastDeployTs = $derived.by<string | null>(() => {
		let best: string | null = null;
		for (const r of rows) {
			if (!r.timestamp) continue;
			if (!best || new Date(r.timestamp) > new Date(best)) best = r.timestamp;
		}
		return best;
	});

	/**
	 * The namespace, mono, in the header — but ONLY when there is one. An
	 * environment tier is a set of (app, namespace) bindings, so `prod`
	 * routinely spans `orders-api-prod`, `payments-core-prod` and so on;
	 * printing one of them would name a place most of the rows are not in.
	 */
	const namespaces = $derived.by<string[]>(() => {
		const set = new Set<string>();
		for (const s of slots) {
			const ns = s.cell.rollout.metadata?.namespace;
			if (ns) set.add(ns);
		}
		return [...set].sort();
	});

	// ────────────────── THE PER-APP PROMOTION CHAIN ────────────────────────
	/**
	 * THE CHAIN CARRIES THE GAP ON EACH HOP — this is the fix for the defect
	 * a live critique named: *"the promotion chain is identical decoration on
	 * every row (`DEV › STAGING › PROD`, no state on any node)"*.
	 *
	 * A hop's gap is the difference in LADDER RANK between two adjacent
	 * environments of the same app: if staging runs rank 19 and prod runs
	 * rank 24, five builds are sitting in staging that have not reached prod.
	 * That number is a property of the PAIR, and it is exactly what
	 * `DESIGN-INTENT.md` asks the page to show — *"the stage chain with the
	 * gap on each hop"*, *"promotion is the subject, not lag"*.
	 *
	 * · A converged app draws bare chevrons and no numbers. That is the norm
	 *   and it is unmarked.
	 * · A stalled hop draws its count. That is the deviation and it is the
	 *   only thing in the column that varies between rows.
	 * · The gap is computed only when BOTH ends have a real rank. `unknown`
	 *   and `diverged` are not positions on the ladder, so no arithmetic is
	 *   printed across them — silence beats a confident wrong number.
	 *
	 * ⛔ NOT A DUPLICATE OF THE `−N` CHIP. The chip is this row's distance
	 * from the app's NEWEST build; a hop is the distance between two
	 * environments. On `/envs/prod` the chip reads `−24` and the staging→prod
	 * hop reads `5`: the first says how far this environment is from head,
	 * the second says how much of that is stuck at the last door.
	 */
	type ChainLink = {
		/** Empty on the folded region count — it addresses no single env. */
		tier: string;
		label: string;
		theme: EnvironmentTheme | null;
		current: boolean;
		/** Builds sitting in the PREVIOUS link that have not reached this one. */
		gap: number | null;
		/** The environments a folded count stands for, for the tooltip. */
		countTitle?: string;
	};

	function chainFor(slot: EnvSlot): ChainLink[] {
		const seen = new Set<string>();
		const stages: { link: ChainLink; rank: RankVerdict }[] = [];
		const regions: { link: ChainLink; rank: RankVerdict }[] = [];
		// `groupRolloutsByApp` already sorts `cells` by `compareEnvironmentNames`.
		for (const cell of slot.group.cells) {
			const tier = cell.environment?.spec?.environment || cell.envName;
			if (!tier || seen.has(tier)) continue;
			seen.add(tier);
			const entry = {
				link: {
					tier,
					// A production region prints its DISTINGUISHING segment.
					// Twelve chips reading `PROD-AP-SOUTH…` spend every
					// character on the token they have in common.
					label:
						getEnvironmentRank(tier) === 8
							? regionLabel(tier)
							: shortEnvLabel(cell.theme ?? tier) || tier,
					theme: cell.theme,
					current: tier === envName,
					gap: null as number | null
				},
				rank: slot.ranks.get(cell) ?? ({ kind: 'unknown' } as RankVerdict)
			};
			(getEnvironmentRank(tier) === 8 ? regions : stages).push(entry);
		}

		/**
		 * THE FAN-OUT COLLAPSES TO ONE COUNT CHIP — the LINE-vs-SET rule, and
		 * the reason this row survives `edge-mesh`, which is bound to dev plus
		 * THIRTEEN production regions. Drawn as fourteen chips the chain
		 * wrapped to fourteen lines at 1280 and the row grew to ~350px, which
		 * is the standing *"4+ prod regions must not break the layout"* rule
		 * failing in the most literal way available.
		 *
		 * Regions are a SET: N copies of ONE promotion step, not N steps. The
		 * region the reader is STANDING IN is never folded away, so the one
		 * painted chip is always this page's own environment.
		 */
		let ordered: { link: ChainLink; rank: RankVerdict }[];
		if (regions.length === 0) ordered = stages;
		else if (regions.length === 1) ordered = [...stages, regions[0]];
		else {
			const here = regions.find((r) => r.link.current);
			const folded = regions.filter((r) => r !== here);
			ordered = [
				...stages,
				...(here ? [here] : []),
				{
					link: {
						tier: '',
						label: here ? `+${folded.length} regions` : `${folded.length} regions`,
						theme: null,
						current: false,
						gap: null,
						countTitle: folded.map((r) => r.link.tier).join(', ')
					},
					rank: { kind: 'unknown' }
				}
			];
		}

		// THE GAP. Only across two links that both hold a real ladder position.
		for (let i = 1; i < ordered.length; i++) {
			const prev = ordered[i - 1].rank;
			const cur = ordered[i].rank;
			const prevBy = prev.kind === 'newest' ? 0 : prev.kind === 'behind' ? prev.by : null;
			const curBy = cur.kind === 'newest' ? 0 : cur.kind === 'behind' ? cur.by : null;
			if (prevBy === null || curBy === null) continue;
			const gap = curBy - prevBy;
			ordered[i].link.gap = gap > 0 ? gap : 0;
		}

		return ordered.map((o) => o.link);
	}

	// ───────────────────────────── The modal ───────────────────────────────
	let modalOpen = $state(false);
	let modalRollout = $state<Rollout | null>(null);
	let modalVersion = $state<string | null>(null);
	let modalCluster = $state<string | undefined>(undefined);

	function openPromote(cell: AppCell, tag: string) {
		modalRollout = cell.rollout;
		modalVersion = tag;
		modalCluster = cell.sourceCluster || localClusterName || undefined;
		modalOpen = true;
	}
</script>

<svelte:head>
	<title>kuberik | {envName}</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<!--
		⭐ THE HUB FAILS SOFT. `/api/rollouts` answers 200 with the spokes that
		replied and names the ones that did not in `clusterErrors`, so this page
		can be PARTLY true — and until now only `/` and `/rollouts` said so.
		A rollout on an unreachable spoke is absent from every count here, and
		absent is not healthy. Renders nothing when every cluster answered.
	-->
	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this environment"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<div class="space-y-6">
			<div class="h-8 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-64 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-56 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
		</div>
	{:else if query.isError}
		<!-- WAS A BARE `AlertPanel` CARRYING THE RAW `Error.message`. See
		     `/environments` for the argument; `ErrorState` is the same panel with
		     a headline in the operator's words, the server's own sentence, a
		     retry and a way out. -->
		<ErrorState
			error={query.error}
			subject="this environment"
			backHref="/environments"
			backLabel="Back to all environments"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-0"
		/>
	{:else if !envExists}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<LayersSolid class="mb-3 h-10 w-10 text-gray-500 dark:text-gray-400" />
			<p class="text-sm font-semibold text-gray-900 dark:text-white">Environment not found</p>
			<p class="mt-1 max-w-sm text-[13px] text-gray-500 dark:text-gray-400">
				No <code class="rounded bg-gray-100 px-1 font-mono text-[11.5px] dark:bg-gray-800"
					>Environment</code
				>
				resources reference
				<code class="rounded bg-gray-100 px-1 font-mono text-[11.5px] dark:bg-gray-800"
					>{envName}</code
				>.
			</p>
			<a href="/environments" class="nav-link mt-2">
				<ArrowLeftOutline aria-hidden="true" /> Back to environments
			</a>
		</div>
	{:else}
		<!-- ── HEADER. 24px/700, which is the reference page's `h1` measured
		     rather than chosen. Mono, because an environment name is an
		     IDENTIFIER — the string you would type at kubectl — and the chip
		     beside it carries the short distinguishing segment and the identity
		     colour. -->
		<!-- ⚠️ THE `h1` STAYS DRAWN. The navbar names the SECTION
		     (`Environments`) and this page names the ENVIRONMENT, so the two are
		     not the same string; the duplicate-title rule is about DUPLICATION,
		     not position.

		     ⭐ ONE HEAD ROW, `mb-5` — the product's head band. The name row was
		     `text-2xl` (32px line box) with the meta on a SECOND line, `mb-4`
		     below, so the first content landed at y=92; every other page starts
		     its at y=72. `leading-[1.15]` makes the 24px name a 28px row — the
		     same box `t-display` draws — and the meta joins it on the baseline
		     instead of forming a second band of chrome. -->
		<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
			<h1 class="flex min-w-0 flex-wrap items-baseline gap-x-3">
				<span
					class="t-display-id min-w-0 truncate text-gray-900 dark:text-white"
					>{envName}</span
				>
				{#if !envChipRedundant}
					<Chip
						role="env"
						theme={slotTheme}
						label={envShort}
						title={envTitle ? `${envName} — ${envTitle}` : envName}
						wide
						class="self-center"
					/>
				{/if}
			</h1>
			<!-- THE META LINE. No sparkline: it was a 16x4px object with one
			     green tick in twelve gray hairlines, and the same chart is in
			     the rail with a real threshold on it. The separator belongs to
			     the clause that FOLLOWS it, never the one before — a trailing
			     `·` strands when its clause is deleted. -->
			<p
				class="t-dense flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400"
			>
				{#if namespaces.length === 1}
					<span class="font-mono text-[11.5px]">{namespaces[0]}</span>
				{:else if namespaces.length > 1}
					<span>{namespaces.length} namespaces</span>
				{/if}
				{#if lastDeployTs}
					{#if namespaces.length > 0}<span aria-hidden="true">·</span>{/if}
					<span title={formatDate(lastDeployTs)}
						>last deploy {formatTimeAgoCompact(lastDeployTs, $now)} ago</span
					>
				{/if}
			</p>
		</div>

		<!-- ⭐ THE HANDLES AS A RECORD, ONE ROW EACH. `rule: a, b` was a comma
		     list wearing a colon — the shape of a sentence with none of a
		     sentence's grammar. Each name is a `kubectl` handle and `FactList`
		     dresses it as one: mono, `break-all`, under the word that says what
		     it is. The UNION is this banner's own; the app row 250px below owns
		     the per-rollout list and still prints it. -->
		{#snippet gateHandles()}
			<FactList
				tone="banner"
				facts={(banner?.gates ?? []).map((id) => ({ label: 'Rule', value: id, handle: true }))}
			/>
		{/snippet}

		{#if banner}
			<AlertPanel
				severity={banner.severity}
				title={banner.title}
				message={banner.message}
				footnoteBody={banner.gates?.length ? gateHandles : undefined}
				footnoteCount={banner.gates?.length ? banner.gates.length : undefined}
				icon={banner.icon}
				pulse={banner.severity === 'error'}
			>
				<!-- A DOOR, NOT A DEED. This goes to the rollout the banner names;
				     it deploys nothing, so it is a link. `.nav-link` inherits the
				     severity's ink from `AlertPanel`, the same way the `Details`
				     disclosure above it does. -->
				{#snippet actions()}
					<a href={banner.href} class="nav-link">
						{banner.action}
						<ChevronRightOutline aria-hidden="true" />
					</a>
				{/snippet}
			</AlertPanel>
		{/if}

		<!-- TWO COLUMNS FROM `xl`, NOT `lg`. Measured at 1280 with the 176px
		     sidebar: a 320px rail left the app list 712px, and seven tracks
		     inside that pushed a three-stage chain onto two lines and squeezed
		     the build badge into an ellipsis. Between `lg` and `xl` the rail
		     moves BELOW the list at full width instead — it loses nothing but
		     its adjacency. -->
		<div class="xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start xl:gap-6">
			<div class="mb-6 min-w-0 xl:mb-0">
				<!-- ── CRITERION 1 · WHAT IS RUNNING HERE RIGHT NOW ──────────
				     A titled card with a 47px header bar and a HARD RIGHT-ALIGNED
				     ROLLUP, which is the single most transferable thing on the
				     page the human calls beautiful: it lets a reader take the
				     card's answer without reading a row of it.

				     ⛔ `HEALTHY` IS BACK TO `RUNNING`, AND THIS IS A REGRESSION FIX,
				     NOT A NEW WORD. (2026-09-02) The 2026-08-31 pass changed this
				     exact word on `/environments` for exactly this reason — a held
				     rollout is RUNNING, not vouched HEALTHY, and this card's own
				     title (`Running now`) already promises the first word. `prod`
				     read `Running now — 4/4 healthy` directly above `No newer
				     version is allowed yet`: a green verdict on the same object the
				     line under it says is held. `/environments`'s sibling card
				     already says `4/4 running`; this one had not been carried along. -->
				<Card
					icon={failingCount > 0
						? ExclamationCircleSolid
						: stuckCount > 0
							? ClockSolid
							: CheckCircleSolid}
					iconClass={failingCount > 0
						? 'text-red-600 dark:text-red-400'
						: stuckCount > 0
							? 'text-amber-600 dark:text-amber-400'
							: 'text-green-700 dark:text-green-400'}
					title="Running now"
					verdict={rows.length === 0
						? 'nothing deployed'
						: failingCount > 0
							? `${failingCount} failing · ${healthyCount}/${rows.length} running`
							: stuckCount > 0
								? `${stuckCount} stuck · ${healthyCount}/${rows.length} running`
								: `${healthyCount}/${rows.length} running`}
					verdictTone={failingCount > 0 ? 'adverse' : stuckCount > 0 ? 'neutral' : 'good'}
					padded={false}
				>
					{#if rows.length === 0}
						<!-- ⛔ NOT A 10-UNIT CENTRED VOID (2026-08-30). `py-10
						     text-center` builds a 96px empty box around one sentence
						     and then the whole right rail is suppressed below it, so
						     an environment with nothing in it rendered as a page-wide
						     hole where a list would be. The card's own rollup already
						     says `nothing deployed`; the body only owes the reader the
						     ONE thing the rollup cannot say, which is where to go
						     next. Same padding as a row, left-aligned like a row. -->
						<p class="px-4 py-3 text-[13px] text-gray-500 dark:text-gray-400">
							Nothing is deployed to {envName} yet. Apps appear here the first time one promotes into
							it.
						</p>
					{:else}
						<!-- ⛔ THE TRACKED UPPERCASE HEADER ROW IS GONE (2026-09-02). It was
						     the spreadsheet shape the human rejected on the app page — every
						     rejected page in the product shares it, and the reference page has
						     it nowhere — and `/apps` already deleted its own equivalent. It
						     survived here only to give the path pill's `N` a unit
						     (`· a number is versions waiting to move on`), and that caption
						     had gone stale: NO gap pill currently renders a number on the live
						     cluster, so the header explained a thing that was not on screen.

						     Every other column already names itself 16px below where the
						     header used to be: the app's own name, the joined rank/build badge
						     (`newest 1.66.0-66`, `1 behind 2.66.0-66`), and the clock glyph
						     beside `4d`. Only the gap pill needed a unit, and it already has
						     one that exists exactly when the number does — the pill's own
						     `title`, `"N versions have reached X and have not yet reached Y"` —
						     which is the resolution this file's own task note named: *"the
						     unit gets a home that exists when the number does"*. Deleting the
						     header and building nothing new is a reduction; this pairs with
						     the fix — the caption's only fact now lives on the object it was
						     describing. -->
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each rows as row (row.key)}
								{@const chain = chainFor(row.slot)}
								<!-- MOBILE IS A LAYOUT, NOT A FALLBACK. Below `lg` the row
								     is `28px │ 1fr │ auto` and every cell is placed
								     EXPLICITLY: line 1 app + age, line 2 the chain, line 3
								     the build badge, line 4 the action. Nothing is left to
								     auto-flow, because that is how the build badge
								     previously fell into the glyph gutter and clipped its
								     own rank word to `NE…`. -->
								<!-- ⭐ THE WHOLE ROW IS THE DOOR. From the human, about
								     `/environments` and *"some other views"*: *"it's also
								     not clickable in places where you'd expect it to be."*
								     This row already had a hover fill — it LOOKED live —
								     and only the app's name navigated. `.tap-zone` (see
								     `app.css`) stretches that same anchor's `::after` over
								     the row: ONE tab stop, no nested `<a>`, and the chain's
								     environment links, the build badge's version link and
								     the row's action button all stay independently
								     clickable because the zone raises them. -->
								<li
									class="tap-zone grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-4 py-3 transition-colors lg:items-center {ROW_GRID} hover:bg-gray-50 dark:hover:bg-gray-700/30"
								>
									<span
										class="col-start-1 row-start-1 {STATUS_CIRCLE} {getStatusCircleClass(
											row.status,
											row.mark?.kind ?? null
										)}"
										title={row.mark ? row.mark.title : stateLabel(row.status)}
									>
										<BakeStatusIcon
											bakeStatus={row.status}
											size="small"
											state={row.mark?.kind ?? null}
											stateWord={row.mark?.word ?? ''}
										/>
									</span>

									<div class="col-start-2 row-start-1 flex min-w-0 flex-col gap-1">
										<div class="flex min-w-0 flex-wrap items-center gap-2">
											<a
												href={rolloutHref(row.slot.cell)}
												class="tap-link min-w-0 truncate font-mono text-[13px] font-medium text-gray-900 hover:underline dark:text-white"
												>{row.appName}</a
											>
											{#if row.slot.cell.rollout.spec?.wantedVersion}
												<PinBadge version={row.slot.cell.rollout.spec.wantedVersion} size="xs" />
											{/if}
											{#if row.stuck}
												<Chip role="alarm" label="stuck" title="{row.appName} is stuck here" />
											{/if}
										</div>
										<!-- CRITERION 3 — *"what's mid-rollout in this env?"* —
										     is answered by the status circle 12px to the left,
										     in the BLUE and YELLOW the whole product uses for
										     it, and by the row's POSITION. It is not answered
										     again in words. What is left here is the app's own
										     OCI title, and only when it differs from its name. -->
										{#if row.title}
											<span class="truncate text-[11px] text-gray-500 dark:text-gray-400"
												>{row.title}</span
											>
										{/if}
										<!-- ── WHY NOTHING NEWER HAS COME, ON THE ROW THAT IS
										     WAITING. The row already offered `See what's
										     blocking`, which tells a reader a blocker exists and
										     nothing about it; the answer fits on one line and
										     the whole point of that line is that it says whether
										     a PERSON is needed. Same object, same wording, as
										     `/environments` and `/apps/[name]`. It renders only
										     on a row that is actually blocked. -->
										{#if row.block.blocked}
											<!-- ⭐ ONE LINE, AND THE COMPONENT DECIDES IT
											     (2026-08-30). The short form is what every gate
											     block renders now, on every page — the `compact`
											     prop this call site used to pass is gone, because
											     two of five callers passed it and the other three
											     printed the same fact as a two-clause sentence.
											     What it buys here is three rendered lines saved
											     inside a `1fr` cell that also carries the app name,
											     its OCI title, the chain and the build badge. -->
											<BlockReason
												awaiting={row.block.awaitingApprovalGates}
												notPassing={row.block.notPassingGates}
												pinnedTo={row.slot.cell.rollout.spec?.wantedVersion ?? null}
											/>
										{/if}
									</div>

									<div
										class="col-start-3 row-start-1 justify-self-end lg:col-start-5 lg:justify-self-start"
									>
										<span
											class="inline-flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400"
											title={row.timestamp ? formatDate(row.timestamp) : undefined}
										>
											<ClockOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
											{row.timestamp ? formatTimeAgoCompact(row.timestamp, $now) : '—'}
										</span>
									</div>

									<!-- THE CHAIN, WITH THE GAP ON EACH HOP. See `chainFor`. -->
									<div
										class="col-start-2 col-end-4 row-start-2 min-w-0 lg:col-start-3 lg:col-end-4 lg:row-start-1"
									>
										{#if chain.length > 0}
											<div class="flex min-w-0 flex-wrap items-center gap-1">
												{#each chain as link, i (link.tier || `set-${i}`)}
													{#if i > 0}
														<!-- THE HOP. The chevron is STRUCTURE and renders on
														     every hop, so the chain has one rhythm on every
														     row and a reader can count its links. The NUMBER
														     is the deviation and renders only where builds
														     are actually waiting at that door — which is the
														     one thing that differs between rows, and the
														     answer to *"the chain is identical decoration on
														     every row"*.

														     NEUTRAL INK, not red: the row's own rank chip
														     140px to the right already carries the adverse
														     tone, and two red marks on one row about the same
														     app is the same fact spent twice. -->
														<ChevronRightOutline
															class="h-3 w-3 shrink-0 text-gray-500 dark:text-gray-400"
															aria-hidden="true"
														/>
														{#if link.gap && link.gap > 0}
															<!-- ⛔ THE NOUN IS IN THE COLUMN HEADER, NOT IN THE PILL,
															     AND THAT WAS MEASURED. A bare `17` between two
															     environment chips is a quantity of an unnamed thing,
															     and the only place the thing WAS named was a `title`
															     a phone cannot open — so the word had to appear
															     somewhere on the screen.

															     `17 waiting` in the pill was built and photographed
															     first. It costs ~48px per gap, which pushed the
															     THREE-link chain — the product's most common shape,
															     3 of the 4 rows on this fixture — onto two lines, and
															     the break landed between a chevron and its own
															     number: `DEV › 2 waiting › STAGING ›` / `17 waiting
															     PROD`. Doubling the height of every row to name a
															     thing once per row is the wrong trade; naming it ONCE
															     per TABLE, in the header, is what a column header is
															     for. The header is prose, not a graphic with a key —
															     the object the human has twice deleted is a legend
															     built from a DUMMY GRAPHIC, and this is neither. -->
															<!-- THE NOUN APPEARS EXACTLY ONCE PER SCREEN, AT EVERY
															     WIDTH. Below `lg` the column header is hidden — that
															     is the row's own deliberate mobile layout, not an
															     oversight — so the gloss carrying the word on desktop
															     is not on the screen at all and the pill fell back to
															     a bare number with no unit. The phone has the width
															     the desktop table did not: the chain gets a full row
															     of its own there, so the word rides in the pill.
															     `&nbsp;` and not a plain space — Svelte collapses
															     whitespace adjacent to a tag boundary and it rendered
															     `2waiting`. -->
															<span
																class="-ml-0.5 shrink-0 rounded bg-gray-100 px-1 font-mono text-[10px] leading-4 font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
																title="{link.gap} version{link.gap === 1
																	? ''
																	: 's'} have reached {chain[i - 1]
																	.tier} and have not yet reached {link.tier}"
															>
																{link.gap}<span class="lg:hidden">&nbsp;waiting</span>
															</span>
														{/if}
													{/if}
													{#if link.current}
														<Chip
															role="env"
															theme={link.theme}
															label={link.label}
															title="{link.tier} — this page"
															wide
															class="shrink-0"
														/>
													{:else if link.tier}
														<a href="/envs/{encodeURIComponent(link.tier)}" class="shrink-0">
															<Chip role="count" label={link.label} title={link.tier} wide />
														</a>
													{:else}
														<!-- THE FOLDED FAN-OUT, deliberately NOT a link: it
														     stands for a SET and there is no `/envs/` route
														     for a set. The tooltip names every environment
														     it folds, so nothing is hidden — only
														     un-listed. -->
														<Chip
															role="count"
															label={link.label}
															title={link.countTitle ?? link.label}
															wide
															class="shrink-0"
														/>
													{/if}
												{/each}
											</div>
										{/if}
									</div>

									<!-- BUILD. The WORD inside the box varies, and so does the
									     number of HALVES: a row that has a build renders a
									     JOINED box with two halves, a row that has none renders
									     a LONE chip with one. The column's own SHAPE is the
									     signal — the alternative was a 60%-alpha em dash beside
									     the word `pending`, which is one fact in two encodings
									     and one of them spelled as an absence of ink. -->
									<div
										class="col-start-2 col-end-4 row-start-3 flex min-w-0 items-center lg:col-start-4 lg:col-end-5 lg:row-start-1"
									>
										<!-- ⛔ THE WORDS, NOT THE ROLES. (2026-08-30) `−N` → `N
										     behind`, `head` → `newest`, `diverged` → `unreleased`,
										     `pending` → `never deployed`. Same four `Chip` roles,
										     same four colour values, same joined-box geometry.
										     `rankLabel` IS THE SHARED FORMATTER AND IT NOW RETURNS
										     THESE WORDS (updated 2026-08-30) — `N behind`,
										     `unreleased`, `unknown`, `newest`. `/` and
										     `/rollouts` render the same strings from the same
										     function, so the split this note recorded is closed.
										     These call sites keep their explicit branches only
										     because each carries a page-specific `title`.
										
										     ⛔ AND `head` IS NO LONGER A SECOND TONE.
										     (2026-09-01) This branch used to be justified by
										     *"the `head` role rather than the mint one — the
										     per-row-repetition argument in DESIGN.md"*, and
										     that argument is what produced the defect:
										     `NEWEST` here sat 4.1° of hue from `1 BEHIND` one
										     column to its right, so the two members of the
										     rank vocabulary were the SAME COLOUR, while
										     `/rollouts` drew the identical pair 81° apart.
										     `TONE.head` resolves to the same quiet mint
										     `newest` does now — see the note on it in
										     `Chip.svelte` for the measurement. The role STRING
										     is left alone deliberately: one tone reached one
										     way cannot drift; two constants kept equal by hand
										     can, and have, four times on this branch. -->
										{#if !row.version}
											<Chip
												role="unranked"
												label="never deployed"
												title="This app has never deployed here"
												wide
												class="min-w-0"
											/>
										{:else if row.rank.kind === 'diverged'}
											<Chip
												role="diverged"
												label="unreleased"
												title="Running a version that is on no environment’s release list"
												value={row.version}
												valueHref={row.versionHref}
												wide
												class="min-w-0"
											/>
										{:else if rankIsAdverse(row.rank)}
											<Chip
												role={rankRole(row.rank) ?? 'rank'}
												label="{rankBehindBy(row.rank)} behind"
												title="{row.appName} here can still take {rankBehindBy(
													row.rank
												)} newer version{rankBehindBy(row.rank) === 1 ? '' : 's'}"
												value={row.version}
												valueHref={row.versionHref}
												wide
												class="min-w-0"
											/>
										{:else if row.rank.kind === 'unknown'}
											<!-- ⛔ AN UNRESOLVABLE COMPARISON IS NOT `newest`.
											     (2026-08-30) The `{:else}` below was reached by
											     `unknown` as well as by `newest`, so a build the
											     ladder could not place printed the page's
											     good-news word. `unranked` + `unknown` — the same
											     role the never-deployed branch above uses, and
											     the word `rankLabel` now returns. -->
											<Chip
												role="unranked"
												label="unknown"
												title="{row.appName} here is running {row.version}, which cannot be placed on this app’s build ladder"
												value={row.version}
												valueHref={row.versionHref}
												wide
												class="min-w-0"
											/>
										{:else}
											<Chip
												role="head"
												label="newest"
												title="{row.version} — the newest version this app has"
												value={row.version}
												valueHref={row.versionHref}
												class="min-w-0"
											/>
										{/if}
									</div>

									<!-- ACTION — ONE button, and now ONLY when there is an
									     action. Adverse rows only, at every width. No
									     hover-reveal anywhere on this page: a control designed
									     to appear on hover is permanently on wherever hover
									     does not exist.

									     `promoteTag` is `newestDeployableCandidate`: the newest
									     build EVERY gate has already allowed. Deploying it
									     changes what is running, so it is the one thing on this
									     page that earns a filled `.btn-primary`.

									     ⛔ THE `{:else}` BRANCH IS GONE, AND IT WAS THE WORST
									     CASE OF THE DEFECT IN THE PRODUCT. (2026-09-02, from the
									     human: *"i also don't like this investigate button /
									     choose version that act as if they're doing something
									     smart but are just navigating to a page."*) A blocked
									     row got `NextStep step="open"` pointed at
									     `rolloutHref(row.slot.cell)` — WHICH IS THIS ROW'S OWN
									     `.tap-link`, thirty pixels to the left. So the row that
									     matters most on the page carried two tab stops to one
									     URL, and because `row.primary` was true on it, the
									     second one was drawn as FILLED BLUE: the mark this
									     product reserves for `Deploy`, spent on scrolling.

									     The `<li>` is a `.tap-zone` (see `lib/CLAUDE.md`), so
									     the whole row still opens the rollout on click and the
									     app name is still the keyboard path. Nothing was lost
									     but a duplicate. -->
									{#if row.adverse && row.promoteTag}
										<div
											class="col-start-2 col-end-4 row-start-4 flex-wrap items-center gap-2 lg:col-start-6 lg:col-end-7 lg:row-start-1 lg:flex lg:justify-end {row.primary
												? 'flex'
												: 'hidden lg:flex'}"
										>
											<!-- ⛔ `Promote` AND `Review gates` BOTH WENT. `Promote`
											     names a concept this product has not taught the
											     reader yet, and it is the least undoable control on
											     the page; `Review gates` names a Kubernetes object
											     kind. `NextStep` owns the verbs now, so the same
											     state offers the same words here, on `/apps`,
											     on `/apps/[name]` and on `/environments`. -->
											<NextStep
												step="promote"
												primary={row.primary}
												subject={row.slot.cell.rollout.metadata?.name}
												onclick={() => openPromote(row.slot.cell, row.promoteTag!)}
												title="Deploys {row.promoteTag}, the newest version every rule already allows"
											/>
										</div>
									{:else}
										<div class="hidden lg:col-start-6 lg:row-start-1 lg:block"></div>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</Card>
			</div>

			<!-- ── THE RAIL — a stack of small COMPLETE answers, each with its
			     own header and rollup. Not a sidebar of scraps: that is the
			     shape the reference page uses for External Links, Health
			     Checks, Resources and Recent Events, and it is why the page
			     reads as one product. -->
			<div class="min-w-0 space-y-4">
				{#if rows.length > 0}
					<HowItsGoing
						scope="env"
						verdict={promotionRate === null
							? '—'
							: `${onNewestCount} of ${rankableCount} up to date`}
						verdictTone={promotionRate === 100 ? 'good' : 'neutral'}
						verdictTitle="Apps here running the newest version they have"
						windowLabel="{SPARK_HOURS}h"
						deploys={deploys24h}
						sparklineRollouts={slots.map((s) => s.cell.rollout)}
						sparklineHours={SPARK_HOURS}
						sparklineBuckets={SPARK_BUCKETS}
						showSparkline={showSpark}
						typicalDeployMs={medianBakeMs}
						typicalDeployTitle="How long a deploy here usually takes to finish and be watched, measured across this environment's history"
						furthestBehind={{
							entry: deepest,
							title: deepest
								? `${deepest.appName} here is ${deepest.by} version${deepest.by === 1 ? '' : 's'} behind the newest available to it`
								: 'No app here is behind the newest version available to it'
						}}
					/>

					<!-- The same `ActivityRail` `/apps/[name]` and `/namespaces/[name]`
					     use, so it is not a new object — and it carries the one
					     dimension the list beside it cannot: WHEN each app moved, and
					     what it moved FROM. `showEnv` is false because every row here
					     is this environment; a chip identical on every row is a mark
					     that marks nothing.

					     `chrome={false}` HANDS THE FRAME TO `Card`. Left to itself the
					     rail draws a `t-label` caption floating above its own
					     `rounded-xl` box — the exact shape `COMPOSITION-GRAMMAR.md`
					     names as what every rejected page is built from, and it was
					     the LAST region on this page that was not a titled card. It
					     was also the page's only 12px radius, sitting 16px under an
					     8px one. -->
					<Card icon={ClockOutline} title="Recent activity" padded={false}>
						{#snippet rollup()}
							<!-- `.nav-link`, ONE SPELLING WITH `HomeRail`'s AND
							     `ActivityRail`'s OWN DEFAULT HEADER, NOT A THIRD PRIVATE
							     ONE. (2026-09-02) -->
							<a
								href={`/activity?env=${encodeURIComponent(envName)}`}
								class="nav-link"
								aria-label={`View all activity in ${envName}`}
							>
								View all activity <ChevronRightOutline class="h-3.5 w-3.5" />
							</a>
						{/snippet}
						<ActivityRail
							rollouts={slots.map((s) => s.cell.rollout)}
							{environments}
							limit={8}
							showEnv={false}
							chrome={false}
							activityHref={`/activity?env=${encodeURIComponent(envName)}`}
							{localClusterName}
						/>
					</Card>
				{/if}
			</div>
		</div>

		<ChangeVersionModal
			bind:open={modalOpen}
			rollout={modalRollout}
			isPinVersionMode={false}
			initialSelectedVersion={modalVersion}
			cluster={modalCluster}
		/>
	{/if}
</div>
