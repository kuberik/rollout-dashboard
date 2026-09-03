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
		joinClauses,
		type GateContext,
		type BlockingStory,
		type ClassifiedGate
	} from '$lib/view-models/blocking-story';
	import { withPinScheduleClause } from '$lib/view-models/pin-schedule-clause';
	import { fetchScheduleObjects, type ScheduleObject } from '$lib/api/schedules';
	import BlockingStoryPanel from '$lib/components/BlockingStoryPanel.svelte';
	import { regionLabel } from '$lib/view-models/regions';
	import { getEnvironmentRank, sortEnvironmentNames } from '$lib/env-order';
	import { buildRolloutCards, cardStateMark, detectRollback } from '$lib/rollout-cards';
	import type { StatusKey, CardStateMark } from '$lib/rollout-cards';
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
	import { now } from '$lib/stores/time';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		CalendarWeekSolid,
		UserCircleSolid,
		HourglassSolid,
		PauseSolid,
		ChevronRightOutline,
		ChevronDownOutline,
		CodeBranchOutline,
		GlobeSolid,
		ClockOutline
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
	/**
	 * ⭐ THE ROLLOUTS THIS PAGE CANNOT SHOW, NAMED — same disclosure
	 * `/dependencies` prints for `unlinkedRollouts`, and `/apps` now prints
	 * for the same reason. (2026-09-03, operator-walk P9) A rollout with no
	 * `Environment` CR has no TIER, and this page is organised entirely by
	 * tier, so `groupRolloutsByApp`'s fallback group for it never lands in
	 * any card here. `hello-world-manifests` (3 rollouts) was silently
	 * absent; the count is rollouts, not apps, because one app name can be
	 * unbound in several namespaces at once.
	 */
	const unboundRolloutCount = $derived(
		[...groups.values()].filter((g) => !g.hasEnvironmentBinding).reduce((n, g) => n + g.cells.length, 0)
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
		/**
		 * ⭐ THE RAW ROLLOUT, CARRIED SO THE BANNER CAN RE-SUBJECT ACROSS
		 * ENVIRONMENTS. (2026-09-02) `pageStory`'s subject is fixed at push
		 * time to ONE tier (`${appName} in ${TIER}`); when the SAME cause holds
		 * this app in several environments the banner has to speak for the set,
		 * which means calling `blockingStory` again with a plural subject. Same
		 * rollout, same `gateContext` — see the banner's own note.
		 */
		rollout: Rollout;
		/**
		 * `rolled back` / `pinned` / `held`, for the disc — `cardStateMark`,
		 * the SAME precedence `/`, `/rollouts`, `/apps` and `/envs/<name>`
		 * read. This row's disc used to draw only the plain bake glyph
		 * (green check for every settled app, held or not) — see the disc
		 * consistency pass note beside `getStatusCircleClass` on the row
		 * below.
		 */
		mark: CardStateMark | null;
		/**
		 * ⛔ INDEPENDENT OF `mark`'S TIERING — deliberately. (2026-09-03, F4
		 * third re-check, finding 2) `cardStateMark` only reports `held` when
		 * `rolledBack`/`pinnedVersion` are both null, so a rolled-back-and-held
		 * app's `mark.kind` reads `rolled-back` and the disc's THIRD tier never
		 * shows. The row's `HELD` chip is a fact about a GATE, not about the
		 * disc's one free slot, so it reads the same `promotionBlock` boolean
		 * every other list surface's `c.held` does, not `mark?.kind`.
		 */
		held: boolean;
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
		lastDeployTs: string | null;
		severity: number;
	};

	function cellVersion(cell: AppCell): string | null {
		const v = cell.rollout.status?.history?.[0]?.version;
		return v ? getDisplayVersion(v) || null : null;
	}

	/**
	 * ⭐ THE FOLD KEY FOR "SAME CAUSE, DIFFERENT ENVIRONMENT" — mirrors
	 * `/apps/[name]`'s own `causeKey` byte-for-byte (2026-09-02). `kind|clause
	 * |clearsAt`, never a gate `id`: a dependency contract writes one
	 * `RolloutDependency` gate PER NAMESPACE, so DEV, STAGING and PROD each
	 * carry a different generated name for the identical fact.
	 */
	function causeKey(story: BlockingStory): string {
		const own = story.gates.filter((g: ClassifiedGate) => g.kind !== 'promotion');
		const gates = own.length > 0 ? own : story.gates;
		return gates
			.map((g: ClassifiedGate) => `${g.kind}|${g.clause}|${g.clearsAt ?? ''}`)
			.sort()
			.join('¦');
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
						story: withPinScheduleClause(
							blockingStory(cell.rollout, gateContext, { place: tier, now: $now }),
							cell.rollout,
							gateContext
						),
						// THE SAME STORY, SUBJECTED FOR THE PAGE BANNER. Inside a card
						// the environment is fixed and `DEV is waiting on an approval` is
						// exact; the page-level banner sits above THREE environment cards
						// and two apps, so there it has to name both. Same pure function,
						// same facts — only the subject differs.
						pageStory: withPinScheduleClause(
							blockingStory(cell.rollout, gateContext, {
								place: tier,
								subject: `${group.appName} in ${tier.toUpperCase()}`,
								now: $now
							}),
							cell.rollout,
							gateContext
						),
						rollout: cell.rollout,
						mark: cardStateMark({
							rolledBack: detectRollback(cell.rollout),
							pinnedVersion: cell.rollout.spec?.wantedVersion ?? null,
							held: block.blocked
						}),
						held: block.blocked,
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

	/* ⛔ `STEP_WHY` AND `primaryStepTier` WENT WITH THE FOOTER BUTTON.
	   (2026-09-02) They existed to choose a verb and to elect ONE card to wear
	   `.btn-primary`. Both were answering "which navigation should shout
	   loudest", and the answer under the navigation rule is none of them: this
	   page changes no cluster state, so it has no primary action to elect.
	   See the footer's own note, and `app.css`'s `.nav-link` block. */

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
						? 'The last deploy did not complete, and nothing newer can deploy until one does.'
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
			// ⭐ AND WHEN THE SAME CAUSE HOLDS THE APP IN SEVERAL ENVIRONMENTS,
			// THE BANNER NAMES THE SET. (2026-09-02) `pageStory`'s subject was
			// fixed at `${appName} in ${TIER}` for the one card it was built
			// inside, so a dependency contract holding `hello-frontend-app` in
			// DEV, STAGING and PROD identically still headlined *"…in DEV is
			// waiting on another deploy"* — true of DEV, silent about the other
			// two. Same fix as `/apps`' own banner: find every card whose
			// `EnvApp` is the SAME APP held by the SAME CAUSE, then re-run
			// `blockingStory` on the worst one's own rollout with a subject that
			// speaks for the peers. `pageStory` stays the fallback for the
			// (overwhelmingly common) singular case — byte-identical there.
			const appName = worstBlocked.app.appName;
			const key = causeKey(worstBlocked.app.story);
			const peers: { c: EnvCard; app: EnvApp }[] = [];
			let deployedForApp = 0;
			for (const c of all)
				for (const a of c.apps) {
					if (a.appName !== appName) continue;
					if (a.version) deployedForApp++;
					if (a.story.blocked && causeKey(a.story) === key) peers.push({ c, app: a });
				}

			// ⛔ NOT `pluralSubject` — CORRECTED 2026-09-02, SAME DAY. The first
			// cut wove the environment set into `subject` and let it conjugate
			// `is` -> `are`, which read *"hello-frontend-app in all 3
			// environments ARE waiting on another deploy"* — agreement with the
			// wrong noun. The grammatical subject is the singular APP, which
			// never drops out of this sentence the way it does on
			// `/apps/[name]` (where the page itself fixes the app and
			// `pluralSubject` correctly conjugates "All 3 environments ARE…").
			// So the app stays `subject`, `is` stays correct, and the
			// environment set is a trailing locative appended to the finished
			// headline instead.
			let story = worstBlocked.app.pageStory;
			// ⭐ FINDING 3 (coordinator sweep, 2026-09-03): THE LINK PREFERS THE
			// MOST DOWNSTREAM ENVIRONMENT THE SENTENCE NAMES, AND SAYS WHICH.
			// `worstBlocked` above is picked by `person`/`blockedCandidates`
			// only, with no environment preference — so a block spanning every
			// environment identically (the same cause holding DEV, STAGING and
			// PROD) landed on whichever tier's card happened to iterate first,
			// which is DEV, since `all` walks `cardsByTier` in `envTiers`'
			// promotion order. The banner already builds `peers` (every card
			// holding this app on the same cause) to name the SET in the
			// headline; the CTA target is the same set's most downstream member
			// — `envTiers` is promotion-ordered, so the highest index is the
			// environment furthest along the pipeline, PROD in the ordinary
			// three-tier case. The action names it, so a reader knows what they
			// are about to open before they click.
			let target = worstBlocked;
			if (peers.length > 1) {
				const names = peers.map((p) => p.c.tier.toUpperCase());
				const where =
					peers.length === deployedForApp
						? `all ${names.length} environments`
						: names.length <= 3
							? joinClauses(names)
							: `${names.length} environments`;
				const base = withPinScheduleClause(
					blockingStory(worstBlocked.app.rollout, gateContext, {
						subject: appName,
						now: $now
					}),
					worstBlocked.app.rollout,
					gateContext
				);
				story = { ...base, headline: `${base.headline} in ${where}` };
				target = peers.reduce((worst, p) =>
					envTiers.indexOf(p.c.tier) > envTiers.indexOf(worst.c.tier) ? p : worst
				, peers[0]);
			}

			return {
				// ⛔ `story` NAMES ONLY THE ENVIRONMENT, AND THIS BANNER IS ABOVE
				// EVERY ENVIRONMENT. (2026-08-31) It read *"DEV is waiting on an
				// approval"* on a page with two apps in DEV; the app appeared
				// nowhere in the banner, not even in the CTA, which said
				// `Open dev`. The failed and stuck branches above have always
				// named both (`alpha-app failed to deploy in dev`) — only the
				// blocked branch lost the app, because it reused a sentence
				// written for a surface where the app is already fixed.
				story,
				href: target.app.rolloutHref,
				action: `Open ${target.app.appName} in ${target.c.tier.toUpperCase()}`
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
	 *
	 * ⛔ THE CODE DID NOT MATCH THAT PARAGRAPH, AND FIXING IT IS WHAT CLOSED
	 * THE 42%-EMPTY DEFECT. (2026-09-02, design re-check) `folded` OR'd in
	 * `deviations.length > 0` — so a card with exactly ONE deviation folded
	 * its settled tail no matter how short, three apps included. On the live
	 * fleet that hid the ONE thing that would have made `dev`/`staging`/`prod`
	 * stop reading as the same card three times: their app lists, which are
	 * where the environments actually differ (*"dev deploys it first"*).
	 * Three cards at ~85% identical ink and 42% empty at 1440×900 is what a
	 * fold that always fires produces. The threshold is `SETTLED_FOLD_MIN`
	 * alone now, exactly as documented above — a tail folds because it is
	 * LONG, never because the card also happens to have a deviation.
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
{#snippet appRow(a: EnvApp, tier: string, withStory = false)}
	<!-- ⭐ THE WHOLE ROW IS THE DOOR. From the human: *"it's also not clickable
	     in places where you'd expect it to be."* A status disc, a name and a
	     build badge on one 41px band is a row, and a row that navigates only
	     from six characters of its middle is a broken affordance. The `.tap-zone`
	     pattern (see `app.css`) stretches the app-name anchor's `::after` over
	     the band: ONE tab stop, no nested `<a>`, and the chip's own version link
	     stays independently clickable because the zone raises it. -->
	<li class="tap-zone px-4 py-2.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30">
	<!-- ⛔ F7: `hello-frontend-app` TRUNCATED TO `hello-fronte…` (clientW 103 /
	     scrollW 141) WHILE `hello-world-app`'S ROW RENDERED IN FULL AT THE SAME
	     x — the held row's `1 BEHIND <build>` badge is wider than a plain
	     `newest` chip and, on one line, ate 12px this page's own name never
	     gets to spend. Same defect and same fix `/namespaces/[name]` already
	     shipped: `flex-wrap` and the build badge forced onto its own line
	     below `sm`, indented under the name (`38px` = disc `28px` + `gap-x-2.5`
	     `10px`), so the identifier gets the row's full width at the one size
	     that cannot afford both. -->
	<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
		<!-- DISC DIAMETER: `h-7 w-7`, the list-row token — see
		     `BakeStatusIcon.svelte`. `state`/`stateWord` are `a.mark`
		     (`cardStateMark`, the SAME precedence every list surface reads),
		     so a held/pinned/rolled-back app draws the same disc here as on
		     `/`, `/rollouts`, `/apps` and `/envs/<name>` — this row used to
		     draw only the plain bake glyph regardless of any of the three. -->
		<span
			class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full {getStatusCircleClass(
				a.bakeStatus,
				a.mark?.kind ?? null
			)}"
			title={a.mark ? a.mark.title : bakeTitle(a.bakeStatus)}
		>
			<BakeStatusIcon
				bakeStatus={a.bakeStatus}
				size="small"
				state={a.mark?.kind ?? null}
				stateWord={a.mark?.word ?? ''}
			/>
		</span>
		<!-- The visible text is the app name and nothing else, which is right:
		     the card's own `h2` says the environment. A links list has no cards
		     in it — dumping this page's accessibility tree produced FOUR links
		     called `hello-world-app`, one per environment, indistinguishable. -->
		<!-- ⛔ F6 (2026-09-03, design pass 9 re-check): `flex-1` IS `flex: 1 1
		     0%` — a ZERO hypothetical basis, so on a `flex-wrap` row the name
		     never counted toward "does this line still fit" and NEVER
		     wrapped; every chip after it was placed first and the name was
		     squeezed into whatever the chips left over. Measured on the STUCK
		     and HELD rows in the narrow 1440 three-column grid: `117px` left
		     for a `hello-frontend-app`-shaped name. `flex-auto` (`flex: 1 1
		     auto`) restores a CONTENT-sized hypothetical size, so the wrap
		     algorithm now sees the name's real width when deciding what fits
		     — the trailing chip cluster wraps to its own line under the name
		     instead, and `truncate` is left as the genuine last resort (the
		     name alone still wider than the row). -->
		<a
			href={a.rolloutHref}
			aria-label={`${a.appName} in ${tier} — ${APP_STATE_WORD[a.state]}`}
			class="tap-link min-w-0 flex-auto truncate font-mono text-[13px] font-medium text-gray-900 hover:underline dark:text-white"
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
				class="ml-[38px] basis-full sm:ml-0 sm:basis-auto"
			/>
		{:else if a.behindBy > 0}
			<Chip
				role="rank"
				label={`${a.behindBy} behind`}
				title="{a.appName} here can still take {a.behindBy} newer build{a.behindBy === 1
					? ''
					: 's'}"
				value={a.version}
				valueHref={a.versionHref}
				wide
				class="ml-[38px] basis-full sm:ml-0 sm:basis-auto"
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
				class="ml-[38px] basis-full sm:ml-0 sm:basis-auto"
			/>
		{:else if a.version}
			<Chip
				role="head"
				label="newest"
				title="{a.version} — the newest version this app has"
				value={a.version}
				valueHref={a.versionHref}
				class="ml-[38px] basis-full sm:ml-0 sm:basis-auto"
			/>
		{:else}
			<Chip
				role="unranked"
				label="never deployed"
				title="This app has never deployed here"
				wide
				class="ml-[38px] basis-full sm:ml-0 sm:basis-auto"
			/>
		{/if}
		<!-- ⛔ "HELD" WAS SPELLED FIVE WAYS ACROSS THE PRODUCT'S LIST SURFACES.
		     (2026-09-03, F4 third re-check, finding 2) This row was the nested-
		     rule-block surface: a gate holding this app rendered as
		     `BlockingStoryLines` prose two lines below (see the note under
		     this snippet), with no mark on the row itself naming the fact in
		     one word. Same atom as `/`, `/rollouts` and `/namespaces/<name>`:
		     `Chip role="held" label="held"`. The nested rule block stays —
		     it is progressive disclosure BEHIND this chip (the clause and its
		     `N rules` control), not a substitute for it. -->
		{#if a.held}
			<Chip
				role="held"
				label="held"
				title={a.mark?.kind === 'held' ? a.mark.title : 'Held: a newer build exists, but no rule lets it through yet.'}
				class="shrink-0"
			/>
		{/if}
	</div>
	<!-- ⭐ THE REASON LIVES ON THE ROW IT EXPLAINS. (2026-09-01)

	     It used to live in a block ABOVE the list, which meant a card with one
	     app behind printed that app's name at 13px, then its gates, then the
	     SAME NAME again 30px lower on its own row — one object, two subjects,
	     and the reader has to notice they are the same. On the live cluster
	     that was every card on the page.

	     Attached here the row is the subject: disc, name, how far behind, and
	     underneath it, indented past the disc, why nothing newer is coming.
	     Same object and same words as `/apps`, `/apps/<name>` and rollout
	     detail; `/envs/<name>`'s rows already carry their block reason exactly
	     this way, so the two environment surfaces now agree.

	     ⛔ ONLY WHEN THE CARD SPEAKS FOR ONE APP (`withStory`). With several
	     behind, the card summarises — the aggregate figure above the list, and
	     the deepest app's story once — because `BlockingStoryLines`' own note
	     records the defect of one fact printed N times in one viewport. -->
	{#if withStory && a.story.blocked}
		<BlockingStoryLines story={a.story} class="ml-[34px]" />
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
     `3/3 healthy` in green on every settled card it has.

     ⛔ AND A GREEN CHECK NEXT TO A HELD COUNT IS THE NORM MARKED OVER THE
     DEVIATION, NOT AN EXCEPTION TO THE RULE ABOVE. (Operator walk, finding
     15) `dev` read `4/4 running` in green beside `1 held` in amber — the
     all-clear glyph and the all-clear ink sitting directly beside the one
     fact on the card that says something is NOT clear. `held` now takes the
     THIRD rung, between `stuck` and settled, with its own glyph: a pause,
     not a check — the same `PauseSolid` / orange pair `BakeStatusIcon` and
     `Chip`'s `rank` role already spend on this exact fact (a gate refusing a
     candidate, not a person's problem — see `CLAUDE.md`'s "a gate correctly
     refusing a candidate is not a stoppage"), so the disc and the rollup ink
     follow the WORSE state, per that same disc token, rather than pairing an
     all-clear mark with a fact that contradicts it. -->
{#snippet envCard(c: EnvCard)}
	{@const isOpen = expanded.has(c.tier)}
	<Card
		icon={c.failing > 0
			? ExclamationCircleSolid
			: c.stuck > 0
				? ClockSolid
				: c.heldCount > 0
					? PauseSolid
					: CheckCircleSolid}
		iconClass={c.failing > 0
			? 'text-red-600 dark:text-red-400'
			: c.stuck > 0
				? 'text-amber-600 dark:text-amber-400'
				: c.heldCount > 0
					? 'text-orange-950 dark:text-orange-300'
					: 'text-green-700 dark:text-green-400'}
		title={c.tier}
		titleHref={c.href}
		padded={false}
		class="h-full"
		bodyClass="flex flex-col"
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

			     ⛔ NOT a colour change on the first chip's WORD. Recolouring
			     `running` amber would delete the good news, and "every app here
			     is serving" is true and worth saying while three of them wait
			     on a gate — that is the whole distinction this pass exists to
			     draw. But it also may not read as the all-clear GREEN while a
			     held count sits right beside it (finding 15): the norm's ink
			     goes neutral the moment a deviation is on the same line, same
			     as `UpToDate`'s own `deviationOnly` rule ("the deviation
			     carries colour, never the norm"), and `held` — the deviation —
			     takes the disc's own orange rather than the alarm's amber,
			     because amber is `stuck` and nothing else for state. -->
			<!-- ⛔ F16 (2026-09-03, design pass 9 re-check): THREE ROLLUP
			     GRAMMARS ON SIBLING CARDS. A `stuck` card printed `DEV · 1
			     stuck` — no running count at all — while a `held` card
			     printed `STAGING · 4/4 running · 1 held`, so the same header
			     shape read two different sentence structures depending on
			     which deviation fired. `N/M running` now leads EVERY card,
			     unconditionally — it is true and worth saying whatever else
			     is going on, the same argument the note above already makes
			     for `held` — and the deviation (at most one clause: failing,
			     else stuck, else held) is a second, separately-inked span
			     appended to it, never a replacement for it. -->
			<span
				class="text-xs font-medium whitespace-nowrap {c.failing > 0 || c.stuck > 0
					? 'text-gray-500 dark:text-gray-400'
					: 'text-green-700 dark:text-green-400'}"
				title="{c.healthy} of {c.apps.length} apps here are deployed and serving"
			>
				{c.healthy}/{c.apps.length} running
			</span>
			{#if c.failing > 0}
				<span
					class="text-xs font-medium whitespace-nowrap text-red-700 dark:text-red-400"
					title="{c.failing} of {c.apps.length} apps here failed their last deploy"
				>
					{c.failing} failing
				</span>
			{:else if c.stuck > 0}
				<span
					class="text-xs font-medium whitespace-nowrap text-amber-700 dark:text-amber-400"
					title="{c.stuck} of {c.apps.length} apps here are stuck"
				>
					{c.stuck} stuck
				</span>
			{:else if c.heldCount > 0}
				<span
					class="text-xs font-medium whitespace-nowrap text-orange-950 dark:text-orange-300"
					title="{c.heldCount} of {c.apps.length} apps here have newer builds that no rule will let in yet"
				>
					{c.heldCount} held
				</span>
			{/if}
		{/snippet}

		<!-- ── CRITERION 3, THE ONE QUANTITY, MOVED TO THE ROW IT NAMES ──
		     (2026-09-03, F4 third re-check, finding 4: "the dev card shows the
		     gate as a separate top block ... staging/prod nest the gate inside
		     the app row ... app lists start at y=460/361/361".) This block used
		     to draw a SECOND figure for the fleet's deepest lag whenever a card
		     had two or more apps behind — a 20px `N newer versions waiting
		     <appName>` sentence, above the very row that already prints
		     `<appName> [N BEHIND][build]`. On the live cluster `dev` (two apps
		     behind) drew this block and `staging`/`prod` (one app behind each)
		     did not, so the three cards — one environment tier apiece, same
		     card component — started their app lists at three different y
		     offsets for no reason a reader could see.

		     ⚠️ THE OLD JUSTIFICATION WAS AN ANTI-REPETITION RULE THAT NO LONGER
		     APPLIES. It held the deepest app's REASON off the row (once here,
		     rather than repeated per row) — but the NUMBER it led with was
		     never the reason, it was `rankBehindBy`, which every deviation row
		     already prints in its own `N behind` chip. Restating the deepest
		     row's own number in a bigger font one card-width above it is the
		     exact defect ("a summary of one item is not a summary; it is the
		     item, said twice, in a bigger font") this file already named for
		     the ONE-app case — it was only ever true of SOME app counts and
		     false of others, which produced this y-offset defect.

		     THE FIX IS THE SAME ONE THE ONE-APP CASE ALREADY SHIPPED, MADE
		     UNCONDITIONAL: every deviation row may show its OWN
		     `BlockingStoryLines` when IT is blocked (see `appRow` below,
		     `withStory` no longer gated on `c.deviations.length === 1`) — so a
		     card with two blocked apps tells two REASONS, correctly, rather
		     than aggregating into one borrowed number. One env-card body
		     template now: the gate always attaches to the row it blocks, and
		     no card draws a numeral no other card draws. -->
		{#if c.apps.length === 0 || c.behindCount === 0}
		<div class="shrink-0 border-b border-gray-100 px-4 py-3 dark:border-gray-700/60">
			{#if c.apps.length === 0}
				<p class="text-xs text-gray-500 dark:text-gray-400">No app has ever deployed here.</p>
			{:else if c.behindCount === 0}
				<!-- ⭐ `t-dense`, NOT `text-[13px]`. (2026-09-03, design pass 7,
				     finding #3) A hand-spelled 13px/400/sans one-off the census had
				     no name for, sitting beside `text-xs` (12px, the empty-state
				     sibling three lines up) and this same card's own `t-dense`
				     rollup in the head band — three declared-or-not sizes for one
				     kind of card-body sentence. `t-dense` (12.5px/400/1.45) is the
				     nearest declared role and the one every other card-body
				     sentence on this page already uses. -->
				<p class="flex items-center gap-2">
					<CheckCircleSolid class="h-4 w-4 shrink-0 text-green-700 dark:text-green-400" />
					<span class="t-dense text-gray-900 dark:text-white"
						>All {c.apps.length} app{c.apps.length === 1 ? '' : 's'} here are up to date</span
					>
				</p>
				{#if c.blockedApp}
					<!-- Up to date AND held: the gate is holding a build nobody here
					     is behind on yet. Named, because it is about to matter. -->
					<p
						class="mt-1.5 min-w-0 truncate font-mono text-[13px] font-medium text-gray-900 dark:text-white"
					>
						{c.blockedApp.appName}
					</p>
					<BlockingStoryLines story={c.blockedApp.story} />
				{/if}
			{/if}
		</div>
		{/if}


		<!-- ── THE DEVIATIONS, then the fold ─────────────────────────────

		     ⭐ `grow` ON THE ROWS, NOT `mt-auto` ON THE FOOTER. In the
		     equal-height grid the slack has to go SOMEWHERE, and the first
		     build of this put it between the fold line and the footer — two
		     horizontal rules with a band of nothing between them, which reads
		     as a rendering fault rather than as a card with less to say. Given
		     to the row list instead, the fold line and the footer sit on the
		     row's shared baselines and the slack falls where a list would grow
		     anyway.

		     ⛔ EVERY DEVIATION ROW CARRIES ITS OWN BLOCKING STORY NOW, NOT
		     ONLY WHEN THE CARD SPEAKS FOR EXACTLY ONE APP. (2026-09-03, F4
		     third re-check, finding 4) This was `c.deviations.length === 1`
		     — true for `staging`/`prod` (one behind) and false for `dev`
		     (two behind), which is why `dev`'s two blocked rows drew no
		     reason while the CARD's own top block spoke for one of them
		     instead (deleted above). `appRow`'s own guard is
		     `withStory && a.story.blocked`, so passing `true` here does not
		     print a reason on a row that has none — it only stops SUPPRESSING
		     one that does. Two apps blocked by two different causes now get
		     two different reasons, each on the row it explains. -->
		{@const folded = c.settled.length >= SETTLED_FOLD_MIN}
		<div class="grow">
			{#if c.deviations.length > 0}
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each c.deviations as a (a.key)}
						{@render appRow(a, c.tier, true)}
					{/each}
				</ul>
			{/if}
			{#if c.settled.length > 0 && (!folded || isOpen)}
				<ul
					class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700/60 dark:border-gray-700/60"
				>
					{#each c.settled as a (a.key)}
						{@render appRow(a, c.tier)}
					{/each}
				</ul>
			{/if}
		</div>

		<!-- PROGRESSIVE DISCLOSURE — `Show 8 ready resources ›` is the
		     reference page's own control and this is the same object. The
		     card states its rollup, lists what matters, and hides the tail
		     behind ONE control. It does not print all N rows and it does
		     not omit them.

		     ⛔ IT SITS OUTSIDE THE `grow` BOX, WITH THE FOOTER. Both are the
		     card's chrome, so in the equal-height grid they land on the row's
		     shared baselines and only the LIST varies in length. -->
		{#if folded}
			<button
				type="button"
				class="flex w-full shrink-0 items-center gap-1.5 border-t border-gray-100 px-4 py-2.5 text-left text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:border-gray-700/60 dark:text-gray-400 dark:hover:bg-gray-700/30 dark:hover:text-white"
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

		<!-- ── THE FOOTER — one FACT, not a control bar. Since the button below
		     was deleted this band carries only `last deploy …`, which is the
		     card's one time-fact and the only thing on it the header's rollup
		     does not already say. -->
		<!-- IT NEEDS NO `mt-auto`. The `grow` box around the row list already
		     takes the equal-height grid's slack, so this lands on the row's
		     shared bottom baseline and the timestamp lines up across every card
		     in the row. -->
		<div
			class="flex shrink-0 items-center gap-3 border-t border-gray-100 px-4 py-3 dark:border-gray-700/60"
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
			<!-- ⛔ THE FOOTER BUTTON IS GONE, AND IT WAS REDUNDANT BEFORE IT WAS
			     MIS-STYLED. (2026-09-02, from the human: *"i also don't like this
			     investigate button / choose version that act as if they're doing
			     something smart but are just navigating to a page."*)

			     It was a `NextStep` with `href={c.href}` — and `c.href` is the
			     card header's own `titleHref`, i.e. THE SAME DESTINATION the
			     `.tap-zone` header already carries. So every card shipped two
			     tab stops to one URL, and on the worst card the second one wore
			     `.btn-primary`: the loudest mark in the product, spent on
			     `/envs/<tier>`.

			     `app.css`'s `.nav-link` block states the rule. The header is the
			     door; it hover-fills, it is keyboard-reachable, and it names the
			     environment. A second door beside it is furniture.

			     THE VERB WAS NOT INFORMATION THIS CARD WAS MISSING. `Investigate`
			     restated the red header icon; `Choose a version` restated the
			     `HELD` rows above it. What went was chrome. -->
		</div>
	</Card>
{/snippet}

<div class="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
	<!-- ══ THE HEAD BAND ════════════════════════════════════════════════════
	     ⛔ THE DRAWN `Environments` TITLE IS GONE. (2026-09-01, from the human:
	     *"environments and rollouts still have a heading"*.) `Navbar.svelte`
	     prints `Environments` twenty-five pixels above; the `h1` printed the
	     same word again at 24px/700. **A page title that repeats the navbar is
	     a duplicate, not a heading.**

	     IT IS STILL AN `h1`, JUST NOT A DRAWN ONE — `sr-only` is a 1px clip, so
	     the skip link and `a11y.svelte.test.ts` are untouched.

	     THE ROLLUP TAKES THE SLOT AND THE TYPE ROLE WITH IT. `3 environments ·
	     4 apps` was a 14px afterthought on the title's baseline; the count now
	     leads at 24px — the `/activity` shape — so the page still runs 24 → 10
	     rather than losing its top role the way `/apps` did.

	     ⚠️ GEOMETRY IS UNCHANGED: the old row was 32px + `mb-4`, the new one is
	     28px + `mb-5`, so the banner below still starts at y=72. -->
	<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
		<h1 class="sr-only">Environments</h1>
		{#if envTiers.length > 0}
			<span class="t-display text-gray-900 tabular-nums dark:text-white">{envTiers.length}</span>
			<p class="t-dense min-w-0 flex-1 text-gray-500 dark:text-gray-400">
				{envTiers.length === 1 ? 'environment' : 'environments'} · {appCount}
				{appCount === 1 ? 'app' : 'apps'}
				{#if unboundRolloutCount > 0}
					·
					<a href="/rollouts" class="nav-link"
						>{unboundRolloutCount} rollout{unboundRolloutCount === 1 ? '' : 's'} without an
						Environment record <ChevronRightOutline class="h-3.5 w-3.5" aria-hidden="true" /></a
					>
				{/if}
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
		subject="these environments"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<!-- THE SKELETON IS THE SAME GRID. It was a separate `md:/xl:` grid, so
		     the placeholders sat in different columns from the cards that
		     replaced them and the page jumped on load. -->
		<div class="env-stack">
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
		<!-- THE BANNER'S WAY OUT IS A DOOR, NOT A DEED. It goes to the rollout
		     the banner is about; it deploys nothing. `.nav-link` inherits the
		     severity's own ink from `AlertPanel`, which is how the `Details`
		     disclosure one line above it is already drawn. -->
		{#snippet bannerAction(href: string, action: string)}
			<a {href} class="nav-link">
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
						class="t-label mb-3 flex items-center gap-2 text-gray-500 dark:text-gray-400"
					>
						<CodeBranchOutline class="h-3.5 w-3.5" aria-hidden="true" />
						{regionCards.length > 0 ? 'Pipeline stages' : 'Environments'}
						<!-- ⛔ F15, DROPPED AT EVERY WIDTH (2026-09-03, design pass 9
						     re-check). `4 in promotion order` became "a version starts
						     on the left and ends on the right", hidden below `sm` after
						     F12 caught it describing a layout that collapses to one
						     column there — but the sentence never earned its keep even
						     where the grid IS wide: each card's own `dev › staging ›
						     prod` chain already draws the promotion order the eyebrow
						     only described in words, 60px below it. A caption that
						     restates what the row beneath it already shows is
						     furniture, not information — dropped entirely rather than
						     re-gated to a width where it would merely be redundant
						     instead of false. -->
					</h2>
					<!-- ⭐ A REAL GRID, READ LEFT TO RIGHT. The masonry that was
					     here read TOP-TO-BOTTOM THEN ACROSS, which drew a
					     promotion LINE down a column under a heading that says
					     *"a version starts on the left and ends on the right"*.
					     A grid's reading order is the one that sentence names.
					     Column count, equal height and the 360px floor are all
					     argued in the style block at the foot of this file.

					     ⚠️ DO NOT WRITE THE LITERAL STYLE TAG IN A MARKUP COMMENT.
					     `messages/scan.ts` strips style blocks with a non-greedy
					     regex BEFORE it strips comments, so a mention of the opening
					     tag here pairs with the real closing tag at the foot of the
					     file and deletes every text node between them. The census
					     silently lost `Production regions` and its gloss that way. -->
					<div class="env-stack">
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
						class="t-label mb-3 flex items-center gap-2 text-gray-500 dark:text-gray-400"
					>
						<GlobeSolid class="h-3.5 w-3.5" aria-hidden="true" />
						Production regions
						<span class="t-micro"
							>· {regionCards.length}, the ones furthest behind first</span
						>
					</h2>
					<!-- THE SAME GRID. What differs between the brackets is the
					     ORDER RULE, never the layout — a SET ranks itself
					     worst-first, so criterion 3's answer is the first CELL,
					     which in a row-major grid is the top-left card. -->
					<div class="env-stack">
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
	/* ═══════════════════════════════════════════════════════════════════
	   A REAL GRID OF EQUAL-HEIGHT CARDS. (2026-09-01)
	   ═══════════════════════════════════════════════════════════════════

	   ⛔ THIS WAS A MULTICOL MASONRY AND MULTICOL CANNOT BE MADE TO WORK
	   HERE. From the human, on the live dark page: *"environments list is
	   not on a grid properly in this view."*

	   The cause is `column-fill: balance`, which is multicol's DEFAULT and
	   the only value that works without a fixed height. Balancing does not
	   fill columns in order; it distributes items to EQUALISE COLUMN
	   HEIGHT. With three environments in two columns and one card taller
	   than the others, the balancer put `dev` and `staging` in column 1 and
	   `prod` alone in column 2 — the exact layout the human screenshotted,
	   with a full card's worth of empty page under `prod`. At three columns
	   the same algorithm can leave the THIRD column empty, so the page
	   silently renders as two columns of a three-column grid.

	   None of that is fixable from CSS. `column-fill: auto` needs a height
	   the content does not have, and the assignment of items to columns is
	   a heuristic with no author control.

	   ⛔ AND IT WAS WRONG FOR THE STAGE BRACKET ON MEANING, NOT ONLY ON
	   LOOKS. That section's own subtitle is *"a version starts on the left
	   and ends on the right"*. Multicol reads TOP-TO-BOTTOM THEN ACROSS, so
	   a promotion LINE was being drawn down a column. A grid reads
	   left-to-right, which is the axis the sentence names.

	   ── WHY EQUAL HEIGHT, AND NOT `items-start` ────────────────────────

	   `items-start` sizes each card to its content and is what was here
	   before (inside the multicol, where it did nothing). It leaves the
	   BOTTOMS ragged, which is the same complaint one notch quieter — the
	   human's first-named option was *"equal-height cards on a row"* and
	   the fault they reported is a VOID, so the answer is the layout with
	   no voids between cards.

	   Stretch is only safe because the card knows what to do with the
	   slack: `Card` is a flex column and its body has `grow`, and the
	   footer here takes `mt-auto`. So a row's cards share one top edge, one
	   bottom edge, and one footer baseline — `last deploy … / Open ›`
	   lines up across the row, which is the thing that reads as designed.

	   ── AND THE HEIGHT SPREAD IS BOUNDED, WHICH IS WHAT MAKES IT HOLD ──

	   Equal height is only good when the tallest card is not much taller
	   than the shortest. Two rules in the markup keep that true at any
	   count: a card with deviations folds ALL of its settled apps behind
	   one control, and the aggregate figure draws only when it genuinely
	   aggregates. A card is therefore header + reason + its deviations +
	   one fold line + footer, and cards on one row differ by their
	   deviation count rather than by their app count.

	   ── AT 1, 2, 3, 4 AND 22 ───────────────────────────────────────────

	   `auto-fit` rather than a fixed `repeat(3, …)`: with ONE environment
	   the card takes the whole row instead of sitting in a third of it
	   beside two ghost tracks, and with two it takes half. It also cannot
	   overflow into a FOURTH column, because the page wrapper is
	   `max-w-7xl` — 1280px, ~1232px of content — and at a 360px floor with
	   a 16px gutter that is exactly three tracks at the widest the page can
	   ever be. Three at 1440, two around 1100, one below ~760.

	   THE 360px FLOOR IS THE MEASUREMENT, NOT A ROUND NUMBER. The note the
	   old markup carried: at ~263px a card holding a `stuck` alarm beside a
	   joined `[19 behind][d09e6f4]` truncates `checkout-edge` to `checko…`,
	   and at ~390px every name renders whole. The cut lands on the APP
	   NAME, the one string on the row a reader navigates by. 360 is the
	   floor; the tracks that result are 400px at full width.

	   AND IT IS DERIVED FROM THE SPACE, NOT THE VIEWPORT. The old
	   `md:`/`xl:` steps were viewport media queries on a page that sits
	   beside a collapsible sidebar, so collapsing the sidebar changed the
	   card width without changing the column count. `auto-fit` measures the
	   track. */
	.env-stack {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(360px, 100%), 1fr));
		gap: 16px;
	}

	/* The card fills its stretched cell. `min-width: 0` so a long
	   environment name truncates inside the track instead of widening it. */
	.env-stack-item {
		display: flex;
		min-width: 0;
	}

	.env-stack-item > :global(*) {
		width: 100%;
	}
</style>
