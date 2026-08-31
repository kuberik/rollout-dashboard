<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ENVIRONMENTS — the COMPARISON page, REBUILT AS CARDS (2026-08-30).
	 *
	 * ─── WHY IT WAS REBUILT ──────────────────────────────────────────────
	 *
	 * The table that was here was measured against the two pages the human
	 * calls beautiful and lost on every countable axis
	 * (`.agents-context/design/COMPOSITION-GRAMMAR.md`):
	 *
	 *   | page           | SVG icons in <main> | card radii | verdict    |
	 *   | rollout detail | 115                 | 8px + 12px | "beautiful"|
	 *   | /environments  | 3                   | 12px only  | rejected   |
	 *
	 * Every rule that produced the table was a REDUCTION rule — closed colour
	 * budget, two radii, mark-the-deviation, the ink ceiling, cut anything
	 * that mostly draws the norm. Run without a countervailing COMPOSITION
	 * rule they converge on one thing: small gray text in undifferentiated
	 * rows. **Compose first, then apply the budget to what you built.**
	 *
	 * Four defects a live UX critique found on the shipped table, all of
	 * which are structural and none of which survives this rebuild:
	 *
	 * 1. **The `STATE` column was empty on every row.** A column whose whole
	 *    encoding is "usually nothing" is a column of whitespace with a
	 *    header. State is now the CARD HEADER — an icon plus a right-aligned
	 *    rollup (`4/4 healthy`), the reference page's own idiom, which is
	 *    never empty because "healthy" is an answer.
	 * 2. **`BEHIND` mixed two incompatible numbers** — `−19` (the deepest
	 *    single-app lag) beside `1 of 4 behind` (a count of apps) in one
	 *    column, as though they were one quantity. See `THE ONE QUANTITY`
	 *    below.
	 * 3. **The headline was permanently true.** *"3 of 3 environments are
	 *    behind, the deepest by 24"* is true on every cluster where CI
	 *    outpaces promotion, which is every cluster. A sentence that cannot
	 *    be false carries no information. It is deleted; what leads the page
	 *    now is a FILLED BANNER, and only when there is a fact that blocks
	 *    or breaks — so the page is silent exactly when nothing is wrong.
	 * 4. **The adverse row was a neutral gray ground band.** From the human:
	 *    *"i don't like that you're highlighting a stuck row like this … it
	 *    feels like a bug. … there are many examples on the rest of the page
	 *    that are much better."* The example they mean is rollout detail's
	 *    filled amber gate banner. `ADVERSE_ROW` is deleted; `AlertPanel`
	 *    carries it.
	 *
	 * ─── THE ONE QUANTITY ────────────────────────────────────────────────
	 *
	 * Criterion 3 — *"which env is furthest behind"* — is the comparison this
	 * page exists to make, so it must resolve to ONE number with ONE unit and
	 * ONE owner. It is **the deepest lag in the environment, in builds, with
	 * the app that owns it named under it**:
	 *
	 *     BEHIND NEWEST
	 *     24 builds
	 *     hello-world-app
	 *
	 * · It is a scalar, so environments order by it.
	 * · It is a fact about a REAL app you can click, not a mean. The
	 *   proposal's mock printed `avg drift 2.6`; a mean is a fact about no
	 *   app, and 2.6 is one app 8 behind or four apps 2-3 behind, which are
	 *   different mornings.
	 * · It sits at the SAME offset inside every card, so the comparison is
	 *   still read down one track even though the layout is a grid.
	 *
	 * **The breadth count is not printed as a second number beside it.** It
	 * is SHOWN: every behind app gets its own row in the card, and the apps
	 * that are fine fold behind one disclosure control. Two behind rows and
	 * `2 apps on their newest build` is `2 of 4 behind` said in a form you
	 * can click.
	 *
	 * ─── CARDS, NOT ROWS, AND WHY THE OLD ARGUMENT LOST ──────────────────
	 *
	 * The table's own header argued that a comparison needs its quantity at
	 * ONE x and that cards alternate it between columns. That was a real
	 * observation and it is answered rather than ignored: the quantity is at
	 * a fixed offset inside a card of fixed width, the cards are sorted, and
	 * ORDER — row position — is the most accurate perceptual channel there
	 * is, which is the same argument `DESIGN.md` uses to spend zero colour on
	 * version identity.
	 *
	 * What the table could not do, and this can:
	 * · a header bar that answers the card without reading a row of it;
	 * · PROGRESSIVE DISCLOSURE, which is the whole reason this beats reading
	 *   22 env pages. A settled environment collapses to one green line. The
	 *   previous full-page build printed every app of every environment and
	 *   was correctly diagnosed as *"reading each env page in isolation, 22
	 *   times, concatenated"*. Printing only the DEVIATIONS, with the norm
	 *   folded behind a control, is the opposite operation.
	 *
	 * ─── THE LINE AND THE SET ────────────────────────────────────────────
	 *
	 * `DESIGN-INTENT.md`: *"Stages are a LINE — they run in order. Production
	 * regions are a SET — they do not run in order. Never force one shape
	 * onto both."* Both brackets are the same card in the same grid; what
	 * differs is the ORDER RULE. Stages keep `compareEnvironmentNames`,
	 * because reading order IS promotion order and sorting dev under prod
	 * would state a promotion order that does not exist. The fleet is free
	 * to rank itself worst-first, and it is the bracket where criterion 3
	 * actually bites because it is the one with eighteen members.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions } from '$lib/api/rollouts';
	import { rolloutMatchesEnvironment, rolloutPath, sourceClusterName } from '$lib/source-dashboard';
	import { groupRolloutsByApp, versionPathForRollout } from '$lib/version-utils';
	import type { AppGroup, AppCell } from '$lib/version-utils';
	import { rankVerdicts, rankBehindBy, rankIsAdverse } from '$lib/view-models/env-rank';
	import type { RankVerdict } from '$lib/view-models/env-rank';
	import { promotionBlock } from '$lib/view-models/promotion';
	import {
		buildGateContext,
		withSchedules,
		blockingStory,
		type GateContext,
		type BlockingStory
	} from '$lib/view-models/blocking-story';
	import { fetchScheduleObjects, type ScheduleObject } from '$lib/api/schedules';
	import BlockingStoryPanel from '$lib/components/BlockingStoryPanel.svelte';
	import { regionLabel } from '$lib/view-models/regions';
	import { getEnvironmentRank, sortEnvironmentNames } from '$lib/env-order';
	import { buildRolloutCards } from '$lib/rollout-cards';
	import type { StatusKey } from '$lib/rollout-cards';
	import {
		formatTimeAgoCompact,
		formatDate,
		getDisplayVersion,
		detectStuck,
		detectStuckBehind
	} from '$lib/utils';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import { getStatusCircleClass, bakeTitle, BAKE_WORD } from '$lib/bake-status';
	import Chip from '$lib/components/Chip.svelte';
	import Card from '$lib/components/Card.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import BlockingStoryLines from '$lib/components/BlockingStoryLines.svelte';
	import NextStep from '$lib/components/NextStep.svelte';
	import type { Step } from '$lib/components/NextStep.svelte';
	import { now } from '$lib/stores/time';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		CalendarWeekSolid,
		UserCircleSolid,
		HourglassSolid,
		ChevronRightOutline,
		ChevronDownOutline,
		CodeBranchOutline,
		GlobeSolid,
		ClockOutline,
		ArrowUpOutline
	} from 'flowbite-svelte-icons';
	import type { Rollout, Environment } from '../../types';
	import { pollWhenHealthy } from '$lib/api/errors';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 15000, refetchInterval: pollWhenHealthy(15000) } })
	);
	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived<string>(clusterQuery.data?.name || '');

	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	/**
	 * ⭐ THE GATE JOIN TABLE — the same one `/apps`, `/apps/<name>` and rollout
	 * detail build, from the payload this page already has. It is what turns
	 * `ghd-p2fld` from *"needs a person to approve"* (a wrong instruction: no
	 * human can approve an environment-controller gate) into *"dev has to
	 * deploy it first"*.
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

	/* One GET per held rollout, cached by namespace — see `/apps`. */
	$effect(() => {
		for (const r of rollouts) {
			const ns = r.metadata?.namespace;
			const name = r.metadata?.name;
			if (!ns || !name || scheduleObjects[ns]) continue;
			const b = promotionBlock(r);
			if (!b.blocked || b.notPassingGates.length === 0) continue;
			fetchScheduleObjects(ns, name, sourceClusterName(r) || undefined)
				.then((objs) => {
					scheduleObjects = { ...scheduleObjects, [ns]: objs };
				})
				.catch(() => {});
		}
	});

	const groups = $derived.by<Map<string, AppGroup>>(() =>
		groupRolloutsByApp(rollouts, environments)
	);

	// The same succeeded|failed|active|pending classification `/` and
	// `/rollouts` use, so "healthy" here means what it means everywhere.
	const statusByRollout = $derived.by<Map<Rollout, StatusKey>>(() => {
		const map = new Map<Rollout, StatusKey>();
		for (const c of buildRolloutCards(rollouts, environments, $now)) map.set(c.rollout, c.statusKey);
		return map;
	});

	// ONE ladder per app, not one per (app, environment) pair.
	const ranksByApp = $derived.by<Map<string, Map<AppCell, RankVerdict>>>(() => {
		const map = new Map<string, Map<AppCell, RankVerdict>>();
		for (const [name, group] of groups) map.set(name, rankVerdicts(group));
		return map;
	});

	/** Every tier any app is bound to, in promotion order. */
	const envTiers = $derived.by<string[]>(() => {
		const set = new Set<string>();
		for (const group of groups.values())
			for (const cell of group.cells) {
				const tier = cell.environment?.spec?.environment;
				if (tier) set.add(tier);
			}
		return sortEnvironmentNames([...set]);
	});

	// One representative theme per tier. An env chip's colour is a function of
	// the environment's NAME and nothing else, so which app resolves it cannot
	// matter.
	const themeByTier = $derived.by<Map<string, EnvironmentTheme | null>>(() => {
		const map = new Map<string, EnvironmentTheme | null>();
		for (const tier of envTiers) {
			let theme: EnvironmentTheme | null = null;
			for (const env of environments) {
				if (env.spec?.environment !== tier) continue;
				const r = rollouts.find((x) => rolloutMatchesEnvironment(x, env));
				theme = getRolloutEnvironmentTheme(r ?? null, env);
				break;
			}
			map.set(tier, theme ?? getRolloutEnvironmentTheme(null, tier));
		}
		return map;
	});

	/** rank 8 = a production REGION; rank 7 = the tier IS production. */
	function isRegion(tier: string): boolean {
		return getEnvironmentRank(tier) === 8;
	}
	/** The badge. Regions print the DISTINGUISHING segment, never `PROD-US-EAS…`. */
	function tierBadge(tier: string): string {
		if (isRegion(tier)) return regionLabel(tier);
		return shortEnvLabel(themeByTier.get(tier) ?? tier) || tier;
	}

	// ───────────────────────────── The model ───────────────────────────────

	/** The worst true thing about one app in one environment. */
	type AppState = 'failing' | 'stuck' | 'deploying' | 'baking' | 'behind' | 'healthy' | 'pending';

	/**
	 * ⛔ `AppState` IS AN INTERNAL DISCRIMINANT AND IT WAS BEING PRINTED.
	 * (2026-08-31)
	 *
	 * The row's status disc carried `title={a.state}` and its link carried
	 * `aria-label={`${appName} in ${tier} — ${a.state}`}`, so a reader hovering
	 * a green tick was told `behind`, and a screen-reader user on a rollout
	 * mid-check heard **`baking`** — the CRD's own field name, on a page that
	 * spells that state `checking` everywhere else. Two defects in one
	 * attribute: a word the product has retired, and a tooltip that names a
	 * different fact from the glyph it is attached to.
	 *
	 * These are the product's own words. `bake-status.ts` owns the four that
	 * describe a deploy; the three that do not (`stuck`, `behind`, `pending`)
	 * are spelled the way `/`, `/rollouts` and `env-rank.ts` already spell them.
	 */
	const APP_STATE_WORD: Record<AppState, string> = {
		failing: BAKE_WORD.Failed,
		stuck: 'not moving',
		deploying: BAKE_WORD.Deploying,
		baking: BAKE_WORD.InProgress,
		behind: 'behind',
		healthy: 'running',
		pending: 'never deployed'
	};

	type EnvApp = {
		key: string;
		appName: string;
		state: AppState;
		bakeStatus: string;
		rank: RankVerdict;
		behindBy: number;
		version: string | null;
		versionHref: string | null;
		rolloutHref: string;
		/** Builds this rollout could take that every gate already allows. */
		deployable: number;
		/** Newer builds that exist but which no gate currently allows. */
		blockedCandidates: number;
		blockingGates: string[];
		/**
		 * `blockingGates` SPLIT BY WHAT WOULD CLEAR THEM. The split is
		 * `promotionBlock`'s own and it is STRUCTURAL, never a pattern match on
		 * the generated name — `awaitingApproval` needs a PERSON, `notPassing`
		 * clears itself. Carried up here because the card's reason line has to
		 * say which, and a card that renders both the same way is telling a
		 * reader to act on something that needs no action.
		 */
		awaitingGates: string[];
		notPassingGates: string[];
		/**
		 * ⭐ EVERY gate holding THIS app in THIS environment, each with how it
		 * clears — the shared `view-models/blocking-story` derivation.
		 *
		 * ⛔ IT IS PER-APP AND THAT IS THE BUG IT FIXES. The card used to print
		 * `Furthest behind the newest — 20 versions, hello-world-app` and then a
		 * reason line built from the UNION of every app's gates in the tier, so
		 * gates belonging to *hello-multi* were rendered under a heading naming
		 * *hello-world-app*. A join across the wrong grain reads as a fact.
		 */
		story: BlockingStory;
		/** The same story, subjected for the page-level banner (app + env). */
		pageStory: BlockingStory;
		timestamp: string | null;
		/** Sort key inside a card. Failing first, then stuck, then depth. */
		severity: number;
	};

	type EnvCard = {
		tier: string;
		badge: string;
		theme: EnvironmentTheme | null;
		href: string;
		apps: EnvApp[];
		/** Apps that deviate — the rows the card prints. Worst first. */
		deviations: EnvApp[];
		/** Apps that are on their newest build and healthy. Folded. */
		settled: EnvApp[];
		healthy: number;
		failing: number;
		stuck: number;
		/** THE ONE QUANTITY. `null` when nothing here is behind. */
		deepest: { by: number; appName: string; app: EnvApp } | null;
		/** How many apps here are behind. 0, 1 and 2+ are three different cards. */
		behindCount: number;
		/** Gate names refusing every newer build of at least one app here. */
		gates: Set<string>;
		/** Those names, split by whether a PERSON has to move. See `EnvApp`. */
		awaitingGates: string[];
		notPassingGates: string[];
		/** The single app whose block the card speaks for. Never a union. */
		blockedApp: EnvApp | null;
		/** How many apps here are held by a gate. The header's second rollup. */
		heldCount: number;
		/** The one thing to do here, worst-first. `open` when nothing is wrong. */
		step: Step;
		lastDeployTs: string | null;
		severity: number;
	};

	function cellVersion(cell: AppCell): string | null {
		const v = cell.rollout.status?.history?.[0]?.version;
		return v ? getDisplayVersion(v) || null : null;
	}
	function rolloutHref(cell: AppCell): string {
		return rolloutPath(
			cell.sourceCluster || localClusterName,
			cell.rollout.metadata?.namespace || '',
			cell.rollout.metadata?.name || ''
		);
	}

	const cardsByTier = $derived.by<Map<string, EnvCard>>(() => {
		const out = new Map<string, EnvCard>();
		for (const tier of envTiers) {
			const apps: EnvApp[] = [];
			let lastDeployTs: string | null = null;

			for (const group of groups.values()) {
				const ranks = ranksByApp.get(group.appName);
				for (const cell of group.cells) {
					if (cell.environment?.spec?.environment !== tier) continue;
					const latest = cell.rollout.status?.history?.[0];
					const bakeStatus = latest?.bakeStatus || 'None';
					const statusKey = statusByRollout.get(cell.rollout) ?? 'pending';
					const rank = ranks?.get(cell) ?? ({ kind: 'unknown' } as RankVerdict);

					let stuck = !!detectStuck(cell.rollout, { now: $now });
					if (!stuck)
						for (const peer of group.cells) {
							if (peer === cell) continue;
							if (detectStuckBehind(cell.rollout, peer.rollout, peer.envName, { now: $now })) {
								stuck = true;
								break;
							}
						}

					// MUTUALLY EXCLUSIVE, in severity order — the bucket an app
					// lands in is the worst true thing about it, so the buckets
					// always add up to the app count printed beside them.
					let state: AppState;
					if (bakeStatus === 'Failed') state = 'failing';
					else if (stuck) state = 'stuck';
					else if (bakeStatus === 'Deploying') state = 'deploying';
					else if (bakeStatus === 'InProgress') state = 'baking';
					else if (rankIsAdverse(rank)) state = 'behind';
					else if (statusKey === 'succeeded') state = 'healthy';
					else state = 'pending';

					const block = promotionBlock(cell.rollout);
					const version = cellVersion(cell);
					apps.push({
						key: `${group.appName}/${cell.rollout.metadata?.namespace ?? ''}/${cell.sourceCluster ?? ''}`,
						appName: group.appName,
						state,
						bakeStatus,
						rank,
						behindBy: rankBehindBy(rank),
						version,
						versionHref: version
							? versionPathForRollout(cell.rollout, group.appName, version)
							: null,
						rolloutHref: rolloutHref(cell),
						deployable: block.deployableCount,
						blockedCandidates: block.blocked ? block.candidateCount : 0,
						blockingGates: block.blockingGates,
						awaitingGates: block.awaitingApprovalGates,
						notPassingGates: block.notPassingGates,
						story: blockingStory(cell.rollout, gateContext, { place: tier, now: $now }),
						// THE SAME STORY, SUBJECTED FOR THE PAGE BANNER. Inside a card
						// the environment is fixed and `DEV is waiting on an approval` is
						// exact; the page-level banner sits above THREE environment cards
						// and two apps, so there it has to name both. Same pure function,
						// same facts — only the subject differs.
						pageStory: blockingStory(cell.rollout, gateContext, {
							place: tier,
							subject: `${group.appName} in ${tier.toUpperCase()}`,
							now: $now
						}),
						timestamp: latest?.timestamp ?? null,
						severity:
							state === 'failing'
								? 5
								: state === 'stuck'
									? 4
									: rank.kind === 'diverged'
										? 3
										: state === 'behind'
											? 2
											: state === 'deploying' || state === 'baking'
												? 1
												: 0
					});

					const ts = latest?.timestamp ?? null;
					if (ts && (!lastDeployTs || new Date(ts) > new Date(lastDeployTs))) lastDeployTs = ts;
				}
			}

			apps.sort(
				(a, b) => b.severity - a.severity || b.behindBy - a.behindBy || a.appName.localeCompare(b.appName)
			);

			// A DEVIATION IS ANYTHING THAT IS NOT SETTLED-AND-CURRENT. Everything
			// else folds. `deploying` and `baking` are deviations because
			// criterion 3 of the detail page — "what's mid-rollout" — is the one
			// thing a reader would otherwise have to open the page to learn.
			const deviations = apps.filter((a) => a.severity > 0);
			const settled = apps.filter((a) => a.severity === 0);

			// ⛔ `deepest` CARRIES THE APP, NOT JUST ITS NAME. The summary block
			// below prints `20 versions · hello-world-app` and then a reason
			// line; while the reason came from the card's UNION of gates, that
			// line could name gates belonging to *hello-multi* under a heading
			// about *hello-world-app*. Carrying the app makes the two halves of
			// one sentence come from one rollout, which is the only way the
			// join can be right.
			let deepest: { by: number; appName: string; app: EnvApp } | null = null;
			for (const a of apps)
				if (a.behindBy > 0 && (!deepest || a.behindBy > deepest.by))
					deepest = { by: a.behindBy, appName: a.appName, app: a };

			const failing = apps.filter((a) => a.state === 'failing').length;
			const stuck = apps.filter((a) => a.state === 'stuck').length;

			// ⭐ THE CARD'S BLOCK IS ONE APP'S BLOCK, RANKED — never a union.
			// A union answers a question nobody asked ("which gate names appear
			// anywhere in prod") and reads as an answer to the one they did
			// ("why is hello-world-app stuck"). Needs-a-person first, then the
			// deepest lag, so the card speaks for the app most worth opening.
			const blockedApps = apps.filter((a) => a.story.blocked);
			blockedApps.sort(
				(a, b) =>
					(b.story.person.length > 0 ? 1 : 0) - (a.story.person.length > 0 ? 1 : 0) ||
					(a.story.selfClearing ? 1 : 0) - (b.story.selfClearing ? 1 : 0) ||
					b.behindBy - a.behindBy
			);
			const blockedApp = blockedApps[0] ?? null;

			const gates = new Set<string>();
			const awaitingGates = new Set<string>();
			const notPassingGates = new Set<string>();
			for (const a of apps) {
				if (a.blockedCandidates === 0) continue;
				for (const g of a.blockingGates) gates.add(g);
				for (const g of a.awaitingGates) awaitingGates.add(g);
				for (const g of a.notPassingGates) notPassingGates.add(g);
			}

			out.set(tier, {
				tier,
				badge: tierBadge(tier),
				theme: themeByTier.get(tier) ?? null,
				href: `/envs/${encodeURIComponent(tier)}`,
				apps,
				deviations,
				settled,
				/**
				 * ⛔ `healthy` IS NOT `on newest`. Criterion 1 asks whether the
				 * environment is HEALTHY; criterion 3 asks how far behind it is.
				 * Counting a settled, successfully-deployed app as unhealthy
				 * because a newer build exists conflates the two, and it made
				 * every card on a perfectly working cluster read `3/4 healthy`.
				 * Behind is the normal state of a promotion pipeline.
				 */
				healthy: apps.filter(
					(a) => a.state !== 'failing' && a.state !== 'stuck' && a.state !== 'pending'
				).length,
				failing,
				stuck,
				deepest,
				behindCount: apps.filter((a) => a.behindBy > 0).length,
				gates,
				awaitingGates: [...awaitingGates],
				notPassingGates: [...notPassingGates],
				blockedApp,
				/**
				 * ⭐ WHAT `healthy` IS ACTUALLY CLAIMING, and it was claiming it
				 * with the wrong word. (finding 14)
				 *
				 * The rollup counted apps that are not failing, not stuck and not
				 * never-deployed — a true and useful number — and printed it as
				 * `4/4 healthy` in green **above a body reading `20 BEHIND` and
				 * naming a gate holding it**. A green rollup over a red body is
				 * the same lie as two pages disagreeing, at card scale.
				 *
				 * Two changes, no information lost. The word narrows to what it
				 * measures — `4/4 running`, i.e. every app here deployed and is
				 * serving — and the card gains a SECOND rollup for the fact the
				 * body is about: how many are held. The header now agrees with
				 * what is underneath it, and it still answers criterion 1 at a
				 * glance.
				 */
				heldCount: apps.filter((a) => a.story.blocked).length,
				/**
				 * THE CARD'S STEP, worst-first, from the same facts its marks
				 * are drawn from — a deploy that failed and a place waiting on
				 * a person are not the same errand and may not offer the same
				 * verb. `open` is the FLOOR, not a default: it means there is
				 * nothing to do here, which is a true and useful thing for a
				 * card to say.
				 */
				// ⛔ `promote` IS DELIBERATELY NOT ONE OF THESE, AND IT WAS TRIED.
				// Offering `Deploy newest` on every trailing environment put
				// FOURTEEN identical buttons on the 22-environment fixture and
				// destroyed the page's entry point — the one blue button it was
				// supposed to lead the eye to was drowned by thirteen gray twins
				// of itself. It was also wrong on the merits: being behind is
				// *"the normal state of a promotion pipeline"* and promoting is
				// the controller's job, so a button on all of them is asking a
				// person to hand-crank the norm. A verb is offered here only
				// when something will NOT resolve without one.
				// ⛔ AND `unblock` IS NOT ONE EITHER. `See what's blocking` sat in
				// the footer of a card that had just printed, 200px above it, the
				// exact sentence that button promised to go and fetch. A control
				// offering to reveal something already on screen is furniture.
				// A rule that clears itself gets `Open`, which is the truth.
				// ⛔ `approve` USED TO FIRE ON ANY ALLOW-LIST GATE, which put an
				// `Approve` verb on cards held only by the environment controller
				// — a gate nobody can approve. It now fires on the classified
				// `person` bucket and nothing else.
				step:
					failing > 0 || stuck > 0
						? 'investigate'
						: apps.some((a) => a.story.person.length > 0)
							? 'approve'
							: 'open',
				lastDeployTs,
				severity: failing > 0 ? 4 : stuck > 0 ? 3 : (deepest?.by ?? 0) > 0 ? 1 : 0
			});
		}
		return out;
	});

	/**
	 * THE TWO BRACKETS. `regions.ts` states the vocabulary rule this obeys:
	 * *"'region' is only a legitimate word for that shape when there is more
	 * than one of them."* With one production-tier environment there is no
	 * fleet, and the card folds back into the stages bracket.
	 */
	const FLEET_MIN = 2;

	const regionCards = $derived.by<EnvCard[]>(() => {
		const regions = envTiers.filter(isRegion).map((t) => cardsByTier.get(t)!);
		if (regions.length < FLEET_MIN) return [];
		// A SET has no promotion order, so it is free to rank itself. Criterion
		// 3's answer is the first card in this grid.
		return regions.sort(
			(a, b) =>
				b.severity - a.severity ||
				(b.deepest?.by ?? 0) - (a.deepest?.by ?? 0) ||
				a.tier.localeCompare(b.tier)
		);
	});

	const stageCards = $derived.by<EnvCard[]>(() => {
		const inFleet = new Set(regionCards.map((r) => r.tier));
		// `envTiers` is already `compareEnvironmentNames` order, and reading
		// order IS promotion order for a LINE. Do not sort this.
		return envTiers.filter((t) => !inFleet.has(t)).map((t) => cardsByTier.get(t)!);
	});

	/**
	 * WHY EACH VERB IS OFFERED — the footer control's `title`, and the sentence
	 * a reader gets before committing to a click.
	 */
	const STEP_WHY: Record<Step, string> = {
		investigate: 'something here has failed or has stopped moving',
		approve: 'a newer version exists and a person has to pick it',
		promote: 'a newer version is allowed here and nobody has deployed it',
		unblock: 'newer versions are on hold until a check or time window passes',
		unpin: 'someone pinned a version here, so nothing newer can deploy',
		rollback: 'the version running here is worse than the one before it',
		open: 'nothing needs you here — open it to see what is running'
	};

	/**
	 * THE ONE FILLED BUTTON ON A PAGE OF UP TO 22 CARDS. It goes on the worst
	 * place where a person can actually ADVANCE something. `investigate` never
	 * gets it (it moves nothing) and `open` never gets it (there is nothing to
	 * move). With no such card the page has no primary, which is correct for a
	 * fleet with nothing to decide.
	 */
	const primaryStepTier = $derived(
		[...stageCards, ...regionCards]
			.slice()
			.sort((a, b) => b.severity - a.severity || (b.deepest?.by ?? 0) - (a.deepest?.by ?? 0))
			.find((c) => c.step === 'approve' || c.step === 'promote')?.tier ?? null
	);

	/**
	 * DISTINCT APPS THAT ARE ACTUALLY BOUND TO AN ENVIRONMENT — not
	 * `groups.size`, which counts every app the API returns including ones
	 * with no `Environment` resource at all. A subhead reading `5 apps` over
	 * three cards that each say `4` is the page disagreeing with itself.
	 */
	const appCount = $derived.by<number>(() => {
		const set = new Set<string>();
		for (const c of cardsByTier.values()) for (const a of c.apps) set.add(a.appName);
		return set.size;
	});

	/**
	 * ── THE BANNER ───────────────────────────────────────────────────────
	 *
	 * ONE blocking fact, filled, at the top of the page — the object the
	 * human named when they said *"there are many examples on the rest of
	 * the page that are much better"*. It is rollout detail's schedule-gate
	 * banner, the same component, and it replaces both the gray adverse row
	 * band and the permanently-true headline sentence.
	 *
	 * THREE THINGS CAN EARN IT, in severity order, and **nothing else can**:
	 *
	 *   failed   a deploy failed. Someone has to look.
	 *   stuck    a deploy has been running, or has been held behind a peer,
	 *            past the threshold. Someone has to look.
	 *   blocked  every newer build an environment could take is refused by a
	 *            gate. Nobody has to look YET, but nothing will move until
	 *            the gate clears, and that is the single most useful thing
	 *            the page can say about a fleet that is merely behind.
	 *
	 * **`behind` alone NEVER earns it.** Being behind is the normal state of
	 * a promotion pipeline; a banner that fires on it fires always, which is
	 * exactly the defect of the headline this replaces.
	 */
	// TWO SHAPES, ONE SLOT — see `/apps`. The failed/stuck branches state a
	// fact this page derives; the blocked branch hands back a `BlockingStory`
	// and lets `BlockingStoryPanel` render it, so the sentence about gates is
	// spelled in exactly one place in the product.
	type Banner =
		| {
				severity: 'error' | 'warning';
				icon: typeof ExclamationCircleSolid;
				title: string;
				message: string;
				href: string;
				action: string;
		  }
		| { story: BlockingStory; href: string; action: string };

	const banner = $derived.by<Banner | null>(() => {
		const all = [...cardsByTier.values()];

		const failing = all.flatMap((c) => c.deviations.filter((a) => a.state === 'failing').map((a) => ({ c, a })));
		if (failing.length > 0) {
			const { c, a } = failing[0];
			return {
				severity: 'error',
				icon: ExclamationCircleSolid,
				title:
					failing.length === 1
						? `${a.appName} failed to deploy in ${c.tier}`
						: `${failing.length} deploys have failed`,
				message:
					failing.length === 1
						? 'The last deploy did not complete, and nothing newer can go out until one does.'
						: failing.map((f) => `${f.a.appName} · ${f.c.tier}`).join(' · '),
				href: failing.length === 1 ? a.rolloutHref : c.href,
				action: failing.length === 1 ? 'Open rollout' : `Open ${c.tier}`
			};
		}

		const stuck = all.flatMap((c) => c.deviations.filter((a) => a.state === 'stuck').map((a) => ({ c, a })));
		if (stuck.length > 0) {
			const { c, a } = stuck[0];
			return {
				severity: 'warning',
				icon: ClockSolid,
				title:
					stuck.length === 1
						? `${a.appName} is stuck in ${c.tier}`
						: `${stuck.length} rollouts are stuck`,
				message:
					stuck.length === 1
						? 'It has been running longer than a deploy of this app normally takes.'
						: stuck.map((s) => `${s.a.appName} · ${s.c.tier}`).join(' · '),
				href: stuck.length === 1 ? a.rolloutHref : c.href,
				action: stuck.length === 1 ? 'Open rollout' : `Open ${c.tier}`
			};
		}

		// ⛔ BLOCKED — AND IT USED TO ASK THE WRONG QUESTION ABOUT THE WRONG
		// GRAIN. It took the environment holding the most builds, then read
		// `awaitingGates` — the UNION over every app in that tier — to decide
		// whether a PERSON was needed. Both halves were wrong: an allow-list
		// gate is written by the environment controller three times out of
		// four, so *"until someone approves it"* named a human who does not
		// exist, and a union means the app it names and the gate it blames can
		// be two different rollouts.
		//
		// The banner now speaks for ONE rollout — `blockedApp`, the card's own
		// ranked pick — and its words are `blockingStory`'s, so the sentence
		// here, the lines in the card body, and rollout detail's banner are all
		// the same sentence about the same object.
		let worstBlocked: { c: EnvCard; app: EnvApp } | null = null;
		for (const c of all) {
			if (!c.blockedApp) continue;
			const better =
				!worstBlocked ||
				(c.blockedApp.story.person.length > 0 && worstBlocked.app.story.person.length === 0) ||
				(c.blockedApp.story.person.length > 0 === worstBlocked.app.story.person.length > 0 &&
					c.blockedApp.blockedCandidates > worstBlocked.app.blockedCandidates);
			if (better) worstBlocked = { c, app: c.blockedApp };
		}
		if (worstBlocked) {
			return {
				// ⛔ `story` NAMES ONLY THE ENVIRONMENT, AND THIS BANNER IS ABOVE
				// EVERY ENVIRONMENT. (2026-08-31) It read *"DEV is waiting on an
				// approval"* on a page with two apps in DEV; the app appeared
				// nowhere in the banner, not even in the CTA, which said
				// `Open dev`. The failed and stuck branches above have always
				// named both (`alpha-app failed to deploy in dev`) — only the
				// blocked branch lost the app, because it reused a sentence
				// written for a surface where the app is already fixed.
				story: worstBlocked.app.pageStory,
				href: worstBlocked.app.rolloutHref,
				action: `Open ${worstBlocked.app.appName}`
			};
		}

		return null;
	});

	// ───────────────────────── Progressive disclosure ──────────────────────
	/**
	 * THE FOLD IS ABOUT THE TAIL, NOT THE TOTAL.
	 *
	 * The card always prints its DEVIATIONS. What folds is the settled tail,
	 * and only when there is enough of it to be a tail: three extra rows cost
	 * three lines and save a click, which is a bad trade, while eighteen cost
	 * a screen. Below this threshold the tail is printed inline and the
	 * control does not render at all.
	 *
	 * This is what keeps the page from being *"each env page in isolation, N
	 * times, concatenated"* at scale while still showing a small cluster its
	 * whole matrix on one screen — 4 apps x 3 environments IS the comparison,
	 * and hiding three quarters of it behind three clicks would be reduction
	 * wearing a disclosure control.
	 */
	const SETTLED_FOLD_MIN = 4;

	let expanded = $state<Set<string>>(new Set());
	function toggle(tier: string) {
		const next = new Set(expanded);
		if (next.has(tier)) next.delete(tier);
		else next.add(tier);
		expanded = next;
	}
</script>

<svelte:head>
	<title>kuberik | Environments</title>
</svelte:head>

<!-- ── ONE APP IN ONE ENVIRONMENT ──────────────────────────────────────
     The product's status-circle atom, the app's name, and the rank joined
     to the build it describes — the `/rollouts` unit, one box, two halves.

     ⛔ NO GROUP-SCOPE RANK RECOLOURING. This page used to switch the `−N`
     chip between `rank` and `count` when every app in a card was behind, so
     that a uniformly-behind card did not print a red mark on every row.
     `Chip`'s `rank` role is now `NEUTRAL` PRODUCT-WIDE — the colour audit
     landed `DESIGN-INTENT.md`'s own rule (*"rank chips are mint for `newest`
     and NEUTRAL GRAY for `−N from newest`"*) — so `rank` and `count` render
     the same three values and the switch was a no-op reading as a live rule.
     Deleted rather than left as a dead lever. If `rank` ever goes back to
     red, the group-scope switch is the fix and this is where to find it. -->
{#snippet appRow(a: EnvApp, tier: string)}
	<li class="flex items-center gap-2.5 px-4 py-2.5">
		<span
			class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
				a.bakeStatus
			)}"
			title={bakeTitle(a.bakeStatus)}
		>
			<BakeStatusIcon bakeStatus={a.bakeStatus} size="small" />
		</span>
		<!-- The visible text is the app name and nothing else, which is right:
		     the card's own `h2` says the environment. A links list has no cards
		     in it — dumping this page's accessibility tree produced FOUR links
		     called `hello-world-app`, one per environment, indistinguishable. -->
		<a
			href={a.rolloutHref}
			aria-label={`${a.appName} in ${tier} — ${APP_STATE_WORD[a.state]}`}
			class="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-gray-900 hover:underline dark:text-white"
			>{a.appName}</a
		>
		{#if a.state === 'stuck'}
			<Chip role="alarm" label="stuck" title="{a.appName} has not advanced past its deploy threshold" />
		{/if}
		<!-- ⛔ THE THREE WORDS IN THESE CHIPS ALL FAILED THE NOVICE TEST, AND
		     ONLY THE WORDS CHANGED. (2026-08-30) Same three roles, same three
		     colour values, same joined-box geometry, same `wide`.

		       `−19`     → `19 behind`. A bare signed integer next to a build id
		                   reads as a diff, and nothing on the row said what it
		                   was behind. The eyebrow above it glossed it on THIS
		                   page and on no other, which is exactly how a term
		                   becomes insider vocabulary.
		       `head`    → `newest`. `head` is git's name for a pointer. Every
		                   other string on this page already says "newest", so
		                   the chip was the one place a reader had to translate.
		       `diverged`→ `unreleased`. Git's word for two branches; the fact
		                   is that the version running here was never released
		                   to anywhere.
		       `pending` → `never deployed`. The fact, not the state machine. -->
		{#if a.rank.kind === 'diverged'}
			<Chip
				role="diverged"
				label="unreleased"
				title="Running a version that is on no environment’s release list"
				value={a.version}
				valueHref={a.versionHref}
				wide
			/>
		{:else if a.behindBy > 0}
			<Chip
				role="rank"
				label={`${a.behindBy} behind`}
				title="{a.appName} here can still take {a.behindBy} newer version{a.behindBy === 1
					? ''
					: 's'}"
				value={a.version}
				valueHref={a.versionHref}
				wide
			/>
		{:else if a.rank.kind === 'unknown' && a.version}
			<!-- ⛔ AN UNRESOLVABLE COMPARISON IS NOT `newest`. (2026-08-30) This
			     chain used to fall from `behindBy > 0` straight to `head/newest`,
			     so every verdict the ladder could not place — a build aged out of
			     every release list, an app with no release metadata at all —
			     printed the page's good-news word. Same `unranked` role the
			     never-deployed branch below already uses; the word is `unknown`,
			     which is what `rankLabel` now returns and the only honest thing
			     to say. -->
			<Chip
				role="unranked"
				label="unknown"
				title="{a.appName} here is running {a.version}, which cannot be placed on this app’s build ladder"
				value={a.version}
				valueHref={a.versionHref}
				wide
			/>
		{:else if a.version}
			<Chip
				role="head"
				label="newest"
				title="{a.version} — the newest version this app has"
				value={a.version}
				valueHref={a.versionHref}
			/>
		{:else}
			<Chip
				role="unranked"
				label="never deployed"
				title="This app has never deployed here"
				wide
			/>
		{/if}
	</li>
{/snippet}

<!-- ── ONE ENVIRONMENT ─────────────────────────────────────────────────
     A titled card: 47px header bar with a 16px icon, the environment's own
     name, its identity chip, and a HARD RIGHT-ALIGNED ROLLUP. The rollup is
     the single most transferable thing on the page the human calls
     beautiful — it lets a reader take the card's answer without reading a
     row of it, and it is why criterion 1 no longer needs a column that is
     empty on every row.

     THE HEADER ICON CARRIES STATE, exactly as `HealthChecksCard` does on
     rollout detail: red exclamation when something failed, amber clock when
     something is stuck, green check when the environment is whole. A green
     check on a healthy card is NOT "marking the norm" — that rule is about
     not raising alarms on healthy rows, and the reference page prints
     `3/3 healthy` in green on every settled card it has. -->
{#snippet envCard(c: EnvCard)}
	{@const isOpen = expanded.has(c.tier)}
	<Card
		icon={c.failing > 0 ? ExclamationCircleSolid : c.stuck > 0 ? ClockSolid : CheckCircleSolid}
		iconClass={c.failing > 0
			? 'text-red-600 dark:text-red-400'
			: c.stuck > 0
				? 'text-amber-600 dark:text-amber-400'
				: 'text-green-700 dark:text-green-400'}
		title={c.tier}
		padded={false}
	>
		{#snippet rollup()}
			<!-- ⛔ NOT `wide` — AND THAT IS NOT THE 12ch DEFECT COMING BACK.
			     (2026-08-30) The rule that killed the truncated chip is *"three
			     regions rendered as `PROD-US…` is one indistinguishable mark"*,
			     and it bites when the chip is the ONLY identifier on the object.
			     Here the object's FULL addressable name is the `h2` immediately
			     to its left, at 14px/600 — the chip is carrying the environment's
			     identity COLOUR, not its identity.

			     Measured at 1440 with the three-column stack: a ~390px card
			     header holding a 16px icon, `prod-ap-southeast-2` at ~140px, a
			     `wide` `AP-SOUTHEAST-2` at ~105px and `2/2 healthy` at ~68px
			     overflows, and the element that gave way was the `h2` — the page
			     printed `prod-ap-southe…` while the chip beside it spelled the
			     same segment out in full. Two of the eighteen region cards did
			     this. The 12ch cap gives the name back its 35px. -->
			<Chip role="env" theme={c.theme} label={c.badge} title={c.tier} />
			<!-- ⭐ `4/4 healthy` SAT IN GREEN OVER A BODY READING `20 BEHIND` AND
			     NAMING A GATE HOLDING IT. (finding 14)

			     The number was never wrong — it counts apps that are not
			     failing, not stuck and not never-deployed — but `healthy` is a
			     verdict on the WHOLE card and the card's own body was
			     contradicting it. Two changes, and no fact is lost:

			       · the word narrows to what it measures. `4/4 running` claims
			         only that every app here deployed and is serving, which is
			         exactly the predicate behind the number.
			       · a SECOND rollup carries the fact the body is about. `3 held`
			         in amber, beside it, so the header answers criterion 1 and
			         still agrees with what is underneath it.

			     ⛔ NOT a colour change on the first chip. Recolouring `running`
			     amber would delete the good news, and "every app here is
			     serving" is true and worth saying while three of them wait on a
			     gate — that is the whole distinction this pass exists to draw. -->
			<span
				class="text-xs font-medium whitespace-nowrap {c.failing > 0
					? 'text-red-700 dark:text-red-400'
					: c.stuck > 0
						? 'text-gray-500 dark:text-gray-400'
						: 'text-green-700 dark:text-green-400'}"
				title="{c.healthy} of {c.apps.length} apps here are deployed and serving"
			>
				{#if c.failing > 0}
					{c.failing} failing
				{:else if c.stuck > 0}
					{c.stuck} stuck
				{:else}
					{c.healthy}/{c.apps.length} running
				{/if}
			</span>
			{#if c.heldCount > 0 && c.failing === 0 && c.stuck === 0}
				<span
					class="text-xs font-medium whitespace-nowrap text-amber-700 dark:text-amber-400"
					title="{c.heldCount} of {c.apps.length} apps here have newer versions that no gate will let in yet"
				>
					{c.heldCount} held
				</span>
			{/if}
		{/snippet}

		<!-- ── CRITERION 3, THE ONE QUANTITY ────────────────────────────
		     Deepest lag, in builds, with the app that owns it named under it.
		     At a FIXED offset inside every card, so the comparison is read
		     down one track even though the layout is a grid.

		     An environment with nothing behind prints the answer as a
		     SENTENCE with a green check rather than a `0`: `0 builds` reads
		     as a measurement of nothing, and this page has one job that a
		     zero cannot do — say that a place is current. -->
		<!-- ⛔ THE ROLL-UP IS SUPPRESSED WHEN THERE IS NOTHING TO ROLL UP.
		     (2026-08-30) A card with exactly ONE app behind printed a 20px `1`,
		     an eyebrow and the app's name — and then printed the same fact
		     again 30px below as `[1 behind][a92c6f4]` on the app's own row. On
		     the 22-environment fixture that was TWELVE cards whose entire body
		     above the rows restated the single row under it. A summary of one
		     item is not a summary; it is the item, said twice, in a bigger
		     font. It draws when it genuinely aggregates — two or more apps
		     behind — and the reason line draws whenever there is a reason. -->
		<!-- ⭐ A HELD LAG EARNS THE SUMMARY EVEN WHEN IT IS THE ONLY ONE.
		     (finding 14) The rule above — *"a summary of one item is the item,
		     said twice, in a bigger font"* — is right about a SETTLED row, and
		     it is what left the DEV card with neither the number nor the reason
		     while STAGING and PROD had both, on the very card this page's own
		     banner points at. A blocked row is not the same case: the row can
		     print `20 behind`, and it cannot print WHY nothing newer is coming.
		     The number and the reason belong to one object, so they are drawn
		     together, and the eyebrow says which of the two shapes it is. -->
		{#if c.apps.length === 0 || c.behindCount > 1 || c.behindCount === 0 || (c.blockedApp?.behindBy ?? 0) > 0 || c.awaitingGates.length > 0 || c.notPassingGates.length > 0}
		<div class="border-b border-gray-100 px-4 py-3 dark:border-gray-700/60">
			{#if c.apps.length === 0}
				<p class="text-xs text-gray-500 dark:text-gray-400">No app has ever deployed here.</p>
			{:else if c.deepest && (c.behindCount > 1 || (c.blockedApp?.behindBy ?? 0) > 0)}
				<!-- ⛔ `BEHIND NEWEST · 19 builds` DID NOT SAY BEHIND WHAT. The
				     eyebrow names the comparison in full now — the number is a
				     distance and a distance with no second end is not readable
				     by anyone who has not been told what the second end is.

				     ⛔ AND `THE NEWEST` WAS THE WRONG SECOND END. (2026-08-31)
				     `deepest.by` is `rankBehindBy`, which since 8bfa829 counts
				     the rollout's OWN `availableReleases` — the list `Change
				     Version` shows and the one `N behind` is spelled from. Two
				     environments on the identical sha legitimately hold different
				     numbers, so a claim about "the newest" was false for at least
				     one of any such pair, and it contradicted `rankTitle`'s
				     *"can still take N newer versions"* two elements away. The
				     number counts versions this environment could take; the
				     eyebrow says exactly that and nothing more. -->
				<p
					class="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-gray-500 uppercase dark:text-gray-400"
				>
					<ArrowUpOutline class="h-3 w-3 shrink-0" aria-hidden="true" />
					{c.behindCount > 1 ? 'Most newer versions waiting' : 'Newer versions waiting'}
				</p>
				<p class="mt-1 flex items-baseline gap-2">
					<span class="text-xl font-bold text-gray-900 tabular-nums dark:text-white"
						>{c.deepest.by}</span
					>
					<span class="text-xs text-gray-500 dark:text-gray-400"
						>version{c.deepest.by === 1 ? '' : 's'}</span
					>
					<span class="min-w-0 truncate font-mono text-[11.5px] text-gray-500 dark:text-gray-400"
						>{c.deepest.appName}</span
					>
				</p>
				<!-- WHY THE NUMBER IS NOT SHRINKING. A distance states a fact;
				     this states the CAUSE, and it is the difference between a
				     complaint and something a reader can act on. It renders only
				     while a gate refuses EVERY newer build the environment could
				     take (`promotionBlock().blocked`) — a transient, checkable
				     condition — never on an environment that is merely trailing.

				     IT CARRIES A WORD, NOT A BARE GLYPH. The human has twice
				     deleted an unexplained graphic from these pages (*"i also
				     don't understand what these gray bars mean"*); a mark that
				     needs a legend has no place here, so the mark IS its own
				     legend. -->
				<!-- ⛔ THIS LINE USED TO BE A UNION, AND THAT IS AN ATTRIBUTION
				     BUG, NOT A ROUNDING ERROR. (finding 7)
				
				     The heading two lines up names ONE app — `20 versions ·
				     hello-world-app` — and the reason under it was built from
				     `c.awaitingGates` / `c.notPassingGates`, the union of every
				     app's gates in this tier. On the live cluster that printed
				     gates belonging to *hello-multi* under a heading about
				     *hello-world-app*. A join across the wrong grain reads as a
				     fact, and this one sent readers to the wrong object.
				
				     `blockedApp` is the ONE app the card speaks for, ranked
				     needs-a-person first, and `deepest.app` is the one the
				     heading names. They are the same rollout whenever the
				     deepest lag is held, which is the case this branch draws.
				
				     ⛔ AND IT LISTS EVERY GATE. `BlockReason` printed the first
				     matching branch, so an environment held by an approval AND a
				     closed window rendered one line about the approval. -->
				<BlockingStoryLines story={(c.deepest.app.story.blocked
					? c.deepest.app
					: (c.blockedApp ?? c.deepest.app)).story} />
			{:else if c.behindCount === 0}
				<p class="flex items-center gap-2">
					<CheckCircleSolid class="h-4 w-4 shrink-0 text-green-700 dark:text-green-400" />
					<span class="text-[13px] text-gray-900 dark:text-white"
						>All {c.apps.length} app{c.apps.length === 1 ? '' : 's'} here are up to date</span
					>
				</p>
				{#if c.blockedApp}
					<!-- Up to date AND held: the gate is holding a build nobody here
					     is behind on yet. Named, because it is about to matter. -->
					<p class="t-micro mt-1.5 min-w-0 truncate text-gray-500 dark:text-gray-400">
						{c.blockedApp.appName}
					</p>
					<BlockingStoryLines story={c.blockedApp.story} />
				{/if}
			{:else if c.blockedApp}
				<!-- Exactly one app behind and it is held: its own row says how
				     far, so the only thing left worth printing is WHY nothing
				     newer has come — every gate, and for each, what clears it. -->
				<p class="t-micro min-w-0 truncate text-gray-500 dark:text-gray-400">
					{c.blockedApp.appName}
				</p>
				<BlockingStoryLines story={c.blockedApp.story} />
			{/if}
		</div>
		{/if}

		<!-- ── THE DEVIATIONS, then the fold ───────────────────────────── -->
		{#if c.deviations.length > 0}
			<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
				{#each c.deviations as a (a.key)}
					{@render appRow(a, c.tier)}
				{/each}
			</ul>
		{/if}

		{#if c.settled.length > 0 && c.settled.length < SETTLED_FOLD_MIN}
			<ul
				class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700/60 dark:border-gray-700/60"
			>
				{#each c.settled as a (a.key)}
					{@render appRow(a, c.tier)}
				{/each}
			</ul>
		{:else if c.settled.length > 0}
			{#if isOpen}
				<ul class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700/60 dark:border-gray-700/60">
					{#each c.settled as a (a.key)}
						{@render appRow(a, c.tier)}
					{/each}
				</ul>
			{/if}
			<!-- PROGRESSIVE DISCLOSURE — `Show 8 ready resources ›` is the
			     reference page's own control and this is the same object. The
			     card states its rollup, lists what matters, and hides the tail
			     behind ONE control. It does not print all N rows and it does
			     not omit them. -->
			<button
				type="button"
				class="flex w-full items-center gap-1.5 border-t border-gray-100 px-4 py-2.5 text-left text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700/60 dark:text-gray-400 dark:hover:bg-gray-700/30 dark:hover:text-white"
				onclick={() => toggle(c.tier)}
				aria-expanded={isOpen}
			>
				{#if isOpen}
					<ChevronDownOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					Hide {c.settled.length} up-to-date app{c.settled.length === 1 ? '' : 's'}
				{:else}
					<ChevronRightOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					Show {c.settled.length} up-to-date app{c.settled.length === 1 ? '' : 's'}
				{/if}
			</button>
		{/if}

		<!-- ── THE FOOTER. Buttons look pressable: 14px, 8px 16px, radius 8.
		     `.btn` is the product's own button, the one the reference page
		     presses. -->
		<div
			class="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 dark:border-gray-700/60"
		>
			<span
				class="flex min-w-0 items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
				title={c.lastDeployTs ? formatDate(c.lastDeployTs) : undefined}
			>
				<ClockOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
				{#if c.lastDeployTs}
					<span class="truncate">last deploy {formatTimeAgoCompact(c.lastDeployTs, $now)} ago</span>
				{:else}
					<span class="truncate">no deploys yet</span>
				{/if}
			</span>
			<!-- ⛔ `Open` IS NOT AN ACTION, IT IS A DOOR. On a card that has just
			     said something is failing, stuck or waiting on a person, the one
			     control offering only `Open` is the defect the human named on
			     `/apps/[name]`: *"every card gives only `Investigate` and `View
			     on GitHub` — neither is a decision."* The verb now comes from
			     the card's own worst fact, through the same `NextStep` table the
			     other three pages use, and it falls back to `Open` only when
			     there is genuinely nothing to do here. -->
			<NextStep
				step={c.step}
				href={c.href}
				primary={c.tier === primaryStepTier}
				subject={c.tier}
				title={STEP_WHY[c.step]}
				class="shrink-0"
			/>
		</div>
	</Card>
{/snippet}

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- ── THE HEADER. 24px/700, which is the reference page's `h1` measured,
	     not chosen. The rejected build used `t-display` — 24px at weight 300 —
	     and a page whose largest type is LIGHTER than the reference's body
	     text is the "quieter, flatter, smaller-typed" failure by definition.
	     Type range on this page is now 24 → 10. -->
	<div class="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h1 class="text-2xl font-bold text-gray-900 dark:text-white">Environments</h1>
		{#if envTiers.length > 0}
			<span class="text-sm text-gray-500 dark:text-gray-400">
				{envTiers.length}
				{envTiers.length === 1 ? 'environment' : 'environments'} · {appCount}
				{appCount === 1 ? 'app' : 'apps'}
			</span>
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
		subject="these environments"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			<div class="h-64 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-64 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-64 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
		</div>
	{:else if query.isError}
		<!--
			⛔ WAS A BARE `AlertPanel` WHOSE MESSAGE WAS THE RAW `Error.message`
			(`Request failed (503)`). Right shape, wrong contents: a status code is
			not what happened, there was no retry and no way out, and nothing said
			the page was empty because of a failure rather than because there are
			no environments. `ErrorState` IS an `AlertPanel` — same object, with
			all four parts guaranteed.
		-->
		<ErrorState
			error={query.error}
			subject="the environments"
			backHref="/"
			backLabel="Go to Home"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-0"
		/>
	{:else if envTiers.length === 0}
		<div class="mx-auto max-w-2xl py-12 text-center">
			<p class="text-sm font-semibold text-gray-900 dark:text-white">No environments configured</p>
			<p class="mx-auto mt-2 max-w-md text-[13px] text-gray-500 dark:text-gray-400">
				Create <code class="rounded bg-gray-100 px-1 font-mono text-[11.5px] dark:bg-gray-800"
					>Environment</code
				>
				resources to see what is running in each one.
			</p>
		</div>
	{:else}
		{#snippet bannerAction(href: string, action: string)}
			<a {href} class="btn btn-secondary">
				{action}
				<ChevronRightOutline aria-hidden="true" />
			</a>
		{/snippet}
		{#if banner && 'story' in banner}
			{@const b = banner}
			<!-- ⭐ THE SAME OBJECT AND THE SAME WORDS AS `/apps`, `/apps/<name>`
			     and rollout detail. Whatever you click through to now agrees
			     with what you clicked. -->
			<BlockingStoryPanel story={b.story}>
				{#snippet actions()}{@render bannerAction(b.href, b.action)}{/snippet}
			</BlockingStoryPanel>
		{:else if banner}
			{@const b = banner}
			<AlertPanel
				severity={b.severity}
				title={b.title}
				message={b.message}
				icon={b.icon}
				pulse={b.severity === 'error'}
			>
				{#snippet actions()}{@render bannerAction(b.href, b.action)}{/snippet}
			</AlertPanel>
		{/if}

		<div class="space-y-6">
			<!-- ── BRACKET 1 · THE LINE ─────────────────────────────────── -->
			{#if stageCards.length > 0}
				<section>
					<h2
						class="mb-3 flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-gray-500 uppercase dark:text-gray-400"
					>
						<CodeBranchOutline class="h-3.5 w-3.5" aria-hidden="true" />
						{regionCards.length > 0 ? 'Pipeline stages' : 'Environments'}
						<!-- `4 in promotion order` assumed the reader knew what a
						     promotion order is. This says which way it runs. -->
						<span class="font-normal tracking-normal normal-case"
							>· a version starts on the left and ends on the right</span
						>
					</h2>
					<!-- `items-start` — a grid stretches its items to the tallest in the row
					     by default, and a card whose body is one green line beside a card
					     with eight rows becomes 200px of hollow white with a footer pinned
					     to the bottom. Sized to content, each card ends where its content
					     does.

					     THREE COLUMNS, NOT FOUR, EVEN WITH FOUR STAGES. Four columns fits a
					     four-stage pipeline on one line and reads beautifully — until a
					     card holds a `stuck` alarm beside a joined `−19 d09e6f4`, at which
					     point ~263px of content truncates `checkout-edge` to `checko…`.
					     Measured at 1440 on the 22-environment fixture: at three columns
					     the same card is ~390px and every name renders whole. The cut
					     would land on the APP NAME, which is the only string on the row a
					     reader navigates by, and a row of empty grid beside a short card
					     costs nothing that a reader needs. -->
					<!-- ⛔ THE STAGE BRACKET IS A MASONRY COLUMN FLOW, NOT A GRID.
					     (2026-08-30)

					     A CSS grid equalises ROW HEIGHT. With four stages in
					     three columns, `dev`, `test` and `staging` take row 1 and
					     `prod` starts row 2 — and row 1 is as tall as `staging`,
					     which on the 22-environment fixture carries six app rows.
					     Measured at 1440: ~350px of blank white under `dev` and
					     `test`, the largest empty area anywhere in the product,
					     directly under the page's own banner. `items-start`
					     (already here, and kept) stops the CARDS stretching; it
					     cannot stop the ROW being tall.

					     `columns` packs by column instead, so a short card is
					     followed immediately by the next one and the hole cannot
					     form. READING ORDER SURVIVES because it is still
					     top-to-bottom then left-to-right within each column, and
					     because the section is `· a version starts on the left
					     and ends on the right` — a LINE read left to right, which
					     is exactly the axis `columns` preserves. `break-inside`
					     keeps a card whole.

					     THE SET BRACKET BELOW TAKES THE SAME FLOW, and the first
					     version of this change did not — the note here claimed
					     worst-first ranking put the tall cards top-left where a
					     grid would waste nothing. Measured on the 22-environment
					     fixture that was simply false: four holes of 90–150px
					     under `prod-ap-south`, `prod-us-east`, `prod-sa-east` and
					     `prod-eu-west`. A reader scanning eighteen cards for a red
					     header is hurt by every one of them, and a SET read down
					     the first column instead of across the first row is still
					     worst-first. -->
					<div class="env-stack items-start gap-4">
						{#each stageCards as c (c.tier)}
							<div class="env-stack-item">{@render envCard(c)}</div>
						{/each}
					</div>
				</section>
			{/if}

			<!-- ── BRACKET 2 · THE SET ──────────────────────────────────────
			     "Prod regions bracketed as a fleet" (`PAGE-CRITERIA.md`). Same
			     card, same grid; what differs is the ORDER RULE — a SET has no
			     promotion order, so it ranks itself worst-first and criterion
			     3's answer is the first card. -->
			{#if regionCards.length > 0}
				<section>
					<h2
						class="mb-3 flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-gray-500 uppercase dark:text-gray-400"
					>
						<GlobeSolid class="h-3.5 w-3.5" aria-hidden="true" />
						Production regions
						<span class="font-normal tracking-normal normal-case"
							>· {regionCards.length}, the ones furthest behind first</span
						>
					</h2>
					<!-- `items-start` — a grid stretches its items to the tallest in the row by
					     default, and a card whose body is one green line beside a card with
					     eight rows becomes 200px of hollow white with a footer pinned to the
					     bottom. Sized to content, each card ends where its content does. -->
					<div class="env-stack items-start gap-4">
						{#each regionCards as c (c.tier)}
							<div class="env-stack-item">{@render envCard(c)}</div>
						{/each}
					</div>
				</section>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* MASONRY BY COLUMN FLOW. One column below `md`, two to `xl`, three above
	   — the same three steps the region grid uses, so the two brackets line up
	   on one another's column edges. `column-gap` doubles as the horizontal
	   gutter; `margin-bottom` is the vertical one, because `gap` does not
	   apply to a multicol container's items. */
	.env-stack {
		column-count: 1;
		column-gap: 16px;
	}

	.env-stack-item {
		break-inside: avoid;
		margin-bottom: 16px;
	}

	@media (min-width: 768px) {
		.env-stack {
			column-count: 2;
		}
	}

	@media (min-width: 1280px) {
		.env-stack {
			column-count: 3;
		}
	}
</style>
