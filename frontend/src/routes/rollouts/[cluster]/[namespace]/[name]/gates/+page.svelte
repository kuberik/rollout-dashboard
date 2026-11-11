<svelte:options runes={true} />

<script lang="ts">
	import { providerScopeCounts } from '$lib/view-models/dependency-hold';
	import HeldGlyph from '$lib/components/HeldGlyph.svelte';
	import { outageEscalation } from '$lib/view-models/outage-escalation.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import NotFound from '$lib/components/NotFound.svelte';
	import { RetainedRows } from '$lib/view-models/stable-order';
	import { holdHeight } from '$lib/smooth-height';
	import { goto } from '$app/navigation';
	import { rolloutTabs } from '$lib/view-models/rollout-tabs';
	/**
	 * DEPENDENCIES — what this rollout is waiting on, on both of its axes.
	 *
	 * ⭐ REDESIGNED 2026-09-28, from the product owner's verdict: "dependencies
	 * page still looks way too complex … we could design it better so that it
	 * fits with other screens and shows nice uncluttered design." This tab is
	 * also what the promo demo shows at 390px, so it has to read at a glance.
	 *
	 * THE TWO AXES ARE STILL NEVER ONE LIST:
	 *   · a CONTRACT GATE (`RolloutDependency`) is a PERMISSION about ANOTHER
	 *     SERVICE — "am I allowed to go at all";
	 *   · the PROMOTION CHAIN is a DISTANCE on THIS service's own line —
	 *     "how far have I got".
	 * That part of the design holds. What changed is the DRAWING.
	 *
	 * ── REUSE, NAMED ─────────────────────────────────────────────────────
	 *
	 * Nothing below is a new component. Every row borrows its anatomy from a
	 * page the human already calls good:
	 *   · "Held builds" / "Waiting on" rows are the Overview tab's "Newer
	 *     builds" row — mono version, a status chip, a plain-words subline,
	 *     a right-aligned answer.
	 *   · "Runs in" / "Depends on this" rows are the rail's plain-row grammar
	 *     (`ResourcesCard`/`EventsCard`'s `divide-y` list) — one fact, one
	 *     line, no disclosure.
	 *   · Layout is the Overview tab's own main+rail split
	 *     (`lg:grid-cols-[3fr_minmax(22rem,2fr)]`).
	 *
	 * ── WHAT LEFT ────────────────────────────────────────────────────────
	 *
	 * The amber banner, the nested per-build disclosures, the "N more, held
	 * for a different reason" grouping, `BlockReason`'s rule prose and the
	 * local dependency graph are all gone from this tab. A hold is not an
	 * alert — its count now lives in a card header, the same way `Newer
	 * builds` states its own count without a banner. The full graph still
	 * lives at `/dependencies`; this tab links to it from the rail instead of
	 * drawing a second, narrower copy of it.
	 *
	 * ── NOTHING DRAWS `Satisfied=True` ──────────────────────────────────
	 *
	 * It is the norm and true on every gate on the live cluster. The "Waiting
	 * on" card states its rollup once in the header; a service that is fine
	 * gets one quiet row, never a green tick.
	 */
	import { page } from '$app/state';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		ServerOutline,
		ShareNodesOutline,
		CodeForkOutline,
		ClockOutline,
		ArrowUpRightFromSquareOutline
	} from 'flowbite-svelte-icons';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import RolloutTabHeader from '$lib/components/RolloutTabHeader.svelte';
	import { shortenVersion, formatTimeAgoCompact } from '$lib/utils';
	import UpToDate from '$lib/components/UpToDate.svelte';
	import {
		rolloutQueryOptions,
		rolloutsListQueryOptions,
		clusterInfoQueryOptions
	} from '$lib/api/rollouts';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import type { EnvironmentTheme } from '$lib/environment-theme';
	import { rolloutPath } from '$lib/source-dashboard';
	import { buildTopology, canonicalTier, deployNameOf } from '$lib/view-models/sites-waves';
	import { href } from '$lib/paths';
	import { groupRolloutsByApp } from '$lib/version-utils';
	import type { Rollout, Environment, RolloutDependency } from '../../../../../../types';
	import { pollWhenHealthy } from '$lib/api/errors';
	import { pageTitle } from '$lib/page-title';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import {
		dependencySourceCluster,
		releaseMetadataUnresolved,
		releaseRequires
	} from '../../../../../../types/rollout-dependency-types';
	import {
		buildOrder,
		chain,
		contractBlocks,
		currentEntry,
		displayOfTag,
		providedContracts,
		providerResolved as depProviderResolved,
		rankOfTag,
		type ChainEnv,
		type ConsumerState,
		type ContractBlock,
		type Dependent,
		chainWaveFact,
		type EnvHistoryEntry,
		type EnvInfo,
		type ProvidedContract,
		type Release
	} from '$lib/view-models/dependencies';
	import { rankVerdicts } from '$lib/view-models/env-rank';
	import {
		buildRolloutGraph,
		onCluster,
		contractHoldsForRollout
	} from '$lib/view-models/dependency-graph';
	import { skippedPredicate, stageBuilds } from '$lib/view-models/skipped-builds';
	import { buildLanes } from '$lib/view-models/promotion-lanes';
	import { buildRolloutCards } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import {
		heldVerdict,
		heldVerdictForBuild,
		heldBuilds,
		causeLabelForGates,
		waitsFor,
		composeHeldLeadSentence
	} from '$lib/view-models/held';
	import {
		rolloutNeighbourhood,
		reconcileNeighbourhoodHolds,
		gatesOnThisRollout
	} from '$lib/view-models/rollout-neighbourhood';
	import { rolloutGateBoxes } from '$lib/view-models/rollout-gates';
	import { deployWindowStart, healthQuietState, HEALTH_CHECKS_UNAVAILABLE } from '$lib/view-models/health-witness';
	import {
		buildGateContext,
		withSchedules,
		blockingStory,
		holdCausePhrase,
		promotionHoldBreakdown,
		joinClauses,
		type ClassifiedGate
	} from '$lib/view-models/blocking-story';
	import { gateFact } from '$lib/view-models/gate-fact';
	import { now } from '$lib/stores/time';
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	import { fetchRolloutSchedules, scheduleWindowQueryKey } from '$lib/api/schedules';
	import { apiPath } from '$lib/api/urls';
	import { healthChecksQueryOptions } from '$lib/api/health-checks';
	import { compareEnvironmentNames } from '$lib/env-order';
	import RolloutNeighbourhood from '$lib/components/RolloutNeighbourhood.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import type { HealthCheck, RolloutGate } from '../../../../../../types';

	const cluster = $derived(page.params.cluster as string);
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);

	// ⭐ PERF-2026-09-04 §C.7 SLICE 4 — STREAM-AWARE (see Navbar.svelte).
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			cluster,
			// ⭐ CLUSTER-AWARE — this rollout's own cluster, not the fleet-wide
			// "every cluster up" gate. See rollout detail's identical comment.
			options: { refetchInterval: pollWhenHealthy(5000, 60000, cluster) }
		})
	);
	// PALROW r8 (AD palette r7 item 3): a full outage escalates to ErrorState
	// after two failed answers instead of retrying on the skeleton forever
	// (`view-models/outage-escalation.svelte.ts`).
	const gatesOutage = outageEscalation(
		() => rolloutQuery,
		() => `${cluster}/${namespace}/${name}`
	);

	/**
	 * ⭐ 2026-10-08, THE GATES TAB'S OWN TWO SOURCES — `rollout-gates.ts`'s
	 * `rolloutGateBoxes` needs these to draw a deploy window / freeze / health
	 * box; nothing else on this page reads them.
	 *
	 * SCHEDULES — same query key and data shape `ScheduleStatus.svelte` caches
	 * under `scheduleWindowQueryKey`, so this is ONE request per rollout, not
	 * a second copy of it, and `events.ts`'s existing `RolloutSchedule` /
	 * `ClusterRolloutSchedule` stream invalidation already covers this key.
	 */
	// ⭐ ITEM 2 (AD palette round 8): `enabled: false` once the rollout query
	// has hard-failed — see Overview's identical note on `permissionsQuery`.
	// This is the other background query named for contributing to the
	// outage request storm.
	const schedulesQuery = createQuery(() => ({
		queryKey: scheduleWindowQueryKey(namespace, name, cluster),
		queryFn: () => fetchRolloutSchedules(namespace, name, cluster),
		staleTime: 30_000,
		refetchInterval: pollWhenHealthy(15000, 60000, cluster),
		enabled: !rolloutQuery.isError
	}));
	const schedules = $derived(schedulesQuery.isSuccess ? schedulesQuery.data : null);

	/**
	 * HEALTH CHECKS — the EXACT key, request and shape rollout detail's own
	 * `healthChecksQuery` uses, so the two pages share one cache entry.
	 */
	const healthChecksQuery = createQuery(() => ({
		...healthChecksQueryOptions(namespace, name, cluster),
		enabled: Boolean(rolloutQuery.data?.rollout?.spec?.healthCheckSelector),
		refetchInterval: pollWhenHealthy(5000, 60000, cluster)
	}));
	const healthChecks = $derived<HealthCheck[] | null>(
		healthChecksQuery.isSuccess
			? ((healthChecksQuery.data?.healthChecks ?? []) as HealthCheck[])
			: null
	);

	/**
	 * THE LIST, FOR THE THINGS A SINGLE-ROLLOUT FETCH CANNOT KNOW.
	 *
	 *   1. `rolloutDependencies` — a dependency lives in the CONSUMER
	 *      environment's namespace, so the gates on staging and prod are in
	 *      namespaces this page's own detail fetch never touches.
	 *   2. Every sibling environment's ROLLOUT — the authority for what is
	 *      deployed where.
	 *   3. Each sibling's NAMESPACE, SOURCE CLUSTER and OWN theme, so a node
	 *      links inside this dashboard and is painted its own colour rather
	 *      than this environment's.
	 *
	 * The key is shared with `/rollouts`, so this is a cache read on any
	 * navigation from a list page rather than a second request.
	 */
	// ⭐ STREAM-AWARE (see RolloutGrid.svelte).
	const listQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { refetchInterval: pollWhenHealthy(15000, 60000) } })
	);

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null | undefined);

	/**
	 * ⭐ U-32(a)'s empty-state sentence must not CLAIM health is passing when
	 * it isn't. A check can be genuinely `Failed`/`Unhealthy` with nothing
	 * held (`healthHold` in `rollout-gates.ts` only holds a build when a
	 * newer candidate exists for it to block — `checkout-worker` staging,
	 * mid-incident, already rolled back and has no newer candidate waiting).
	 * "Nothing holds this rollout" is still true there; "its health checks
	 * are passing" is not, so the two clauses are independently true.
	 *
	 * ⭐ ITEM 2, QA + design review 2026-10-08: THAT BINARY SWALLOWED PENDING
	 * INTO "PASSING". A check that has not reported yet is neither `Failed`/
	 * `Unhealthy` nor genuinely `Healthy` — `healthQuietState` (shared with
	 * `healthHold`'s own `visibleHealthChecks`/`classifyCheck`, so this
	 * sentence and the box column above it read the identical set of checks)
	 * answers all three states, and the template below now has a branch for
	 * each: failing, pending, passing — never collapsing pending into either
	 * neighbour.
	 */
	const healthQuiet = $derived(healthQuietState(healthChecks, deployWindowStart(rollout)));
	const environment = $derived(rolloutQuery.data?.environment as Environment | undefined);
	const environmentInfos = $derived(
		(environment?.status?.environmentInfos ?? []) as unknown as EnvInfo[]
	);

	const currentEnv = $derived(environment?.spec?.environment ?? '');
	const currentTheme = $derived(getRolloutEnvironmentTheme(rollout, environment));
	const appTitle = $derived(rollout?.status?.title || name);

	// ── THE APP'S OTHER ENVIRONMENTS ────────────────────────────────────
	const listRollouts = $derived((listQuery.data?.rollouts?.items ?? []) as Rollout[]);
	const listEnvironments = $derived((listQuery.data?.environments?.items ?? []) as Environment[]);

	type Sibling = {
		env: string;
		namespace: string;
		cluster: string;
		theme: EnvironmentTheme | null;
		rollout: Rollout;
		environment: Environment | null;
	};

	/**
	 * Every environment of this app, keyed by its tier name. Built with the
	 * SAME grouping `/apps` and `/apps/[name]` use, so this page cannot
	 * disagree with them about which rollouts are one app.
	 */
	const group = $derived(groupRolloutsByApp(listRollouts, listEnvironments).get(name));
	const boundToEnvironments = $derived(group?.hasEnvironmentBinding ?? false);

	const siblings = $derived.by<Map<string, Sibling>>(() => {
		const out = new Map<string, Sibling>();
		if (!boundToEnvironments) return out;
		for (const cell of group?.cells ?? []) {
			if (!cell.envName) continue;
			out.set(cell.envName, {
				env: cell.envName,
				namespace: cell.rollout.metadata?.namespace ?? '',
				cluster: cell.sourceCluster || cluster,
				theme: cell.theme,
				rollout: cell.rollout,
				environment: cell.environment ?? null
			});
		}
		return out;
	});

	/**
	 * The theme for one environment. The fallback passes NO ROLLOUT,
	 * deliberately — see `getRolloutEnvironmentTheme`'s own note on the
	 * per-rollout theme override.
	 */
	function themeFor(env: string): EnvironmentTheme | null {
		return siblings.get(env)?.theme ?? getRolloutEnvironmentTheme(null, env);
	}

	function hrefFor(env: string): string | undefined {
		// The environment this page IS gets no link. "You are here" is already
		// marked by the breadcrumb and the header chip.
		if (env === currentEnv) return undefined;
		const s = siblings.get(env);
		if (!s || !s.namespace) return undefined;
		return rolloutPath(s.cluster, s.namespace, name, 'gates');
	}

	/**
	 * THE KEY A CONTRACT GATE IS FILED UNDER, WHICH IS NOT ALWAYS AN
	 * ENVIRONMENT. A rollout bound to NO `Environment` has no tier, so the key
	 * falls back to the NAMESPACE, matching `groupRolloutsByApp`. It is a
	 * grouping key and never printed.
	 */
	const currentEnvKey = $derived(currentEnv || namespace);

	// ── AXIS 1 · THE PROMOTION CHAIN ────────────────────────────────────

	/**
	 * ⭐ THE CHAIN'S INPUT, UNIONED FROM THE TWO SOURCES, ROLLOUT FIRST.
	 *
	 * The rollout is the thing that deployed, so the rollout's own history is
	 * what "is it deployed" means; `environmentInfos` is a mirror that can be
	 * empty without that meaning anything at all.
	 */
	const chainInfos = $derived.by<EnvInfo[]>(() => {
		if (!boundToEnvironments && environmentInfos.length === 0) return [];
		const byInfo = new Map(environmentInfos.map((i) => [i.environment, i] as const));
		const names: string[] = [];
		for (const env of siblings.keys()) names.push(env);
		// `environmentInfos` carry one row per TIER; a tier whose sites already
		// stand as sibling places is not listed twice.
		const covered = new Set<string>();
		for (const [key, s] of siblings) {
			const t = canonicalTier(s.environment?.spec?.environment) ?? canonicalTier(key.split('-')[0]);
			if (t) covered.add(t);
		}
		for (const i of environmentInfos) {
			const t = canonicalTier(i.environment);
			if (!names.includes(i.environment) && !(t && covered.has(t))) names.push(i.environment);
		}

		return names.map((env) => {
			const s = siblings.get(env);
			const info = byInfo.get(env);
			const rolloutHistory = (s?.rollout.status?.history ?? []) as unknown as EnvHistoryEntry[];
			return {
				environment: env,
				history: rolloutHistory.length > 0 ? rolloutHistory : (info?.history ?? [])
			};
		});
	});

	/** This app's sites & waves topology, off every Environment the fleet list carries. */
	const topology = $derived(
		environment
			? buildTopology([...listEnvironments, environment]).get(deployNameOf(environment))
			: undefined
	);

	/**
	 * THIS APP'S BUILD LADDER — one derivation, newest first, DERIVED FROM
	 * `created` rather than trusted from the array (the live hub serves
	 * `availableReleases` OLDEST-first). Unioned across every sibling
	 * environment, each rollout's own retention window, and anything any
	 * environment has actually deployed — so a build an environment is
	 * currently running can never be missing from the ladder.
	 */
	const order = $derived.by(() => {
		const releases: Release[] = [];
		const push = (r: Rollout | null | undefined) => {
			for (const rel of r?.status?.availableReleases ?? []) releases.push(rel as Release);
			for (const h of r?.status?.history ?? []) if (h.version) releases.push(h.version as Release);
		};
		push(rollout);
		for (const s of siblings.values()) push(s.rollout);
		for (const i of environmentInfos) for (const h of i.history ?? []) releases.push(h.version);
		return buildOrder(releases);
	});

	/**
	 * ⛔ THE PRODUCT'S ONE `N behind` NUMBER — `env-rank.ts`, the same object
	 * `/`, `/rollouts`, `/apps` and rollout detail read. `null` for an
	 * environment with no rollout in this group — `chain` then falls back to
	 * the ladder rather than fabricating a zero.
	 */
	const ownRanks = $derived.by<Map<string, number>>(() => {
		const out = new Map<string, number>();
		if (!group) return out;
		const verdicts = rankVerdicts(group);
		for (const cell of group.cells) {
			const v = verdicts.get(cell);
			if (!v || !cell.envName) continue;
			if (v.kind === 'newest') out.set(cell.envName, 0);
			else if (v.kind === 'behind') out.set(cell.envName, v.by);
			else out.set(cell.envName, -1);
		}
		return out;
	});
	const chainRows = $derived(chain(chainInfos, order, (env) => ownRanks.get(env) ?? null, topology));
	const envOrder = $derived(chainRows.map((r) => r.env));

	/** The card's rolled-up answer — `UpToDate`'s wording, shared with `/apps`. */
	const chainRollup = $derived.by(() => {
		const deployed = chainRows.filter((r) => r.tag);
		return {
			onHead: deployed.filter((r) => r.rank === 0).length,
			deployed: deployed.length,
			total: chainRows.length,
			spread: new Set(deployed.map((r) => r.tag)).size || 1,
			pending: chainRows.length - deployed.length,
			unknown: deployed.filter((r) => r.rank < 0).length
		};
	});

	// ── AXIS 2 · THE CONTRACT GATES ─────────────────────────────────────

	/**
	 * Read the dependencies from WHEREVER the backend lands them. The list
	 * payload is where they ride today; reading the detail payload too costs
	 * one line and means this page keeps working if they ever arrive there.
	 */
	const allDeps = $derived.by<RolloutDependency[]>(() => {
		const fromList = listQuery.data?.rolloutDependencies?.items;
		const fromDetail = (
			rolloutQuery.data as { rolloutDependencies?: { items?: RolloutDependency[] } }
		)?.rolloutDependencies?.items;
		const all = [...(fromList ?? []), ...(fromDetail ?? [])];
		const seen = new Set<string>();
		const out: RolloutDependency[] = [];
		for (const d of all) {
			const k = `${d?.metadata?.namespace ?? ''}/${d?.metadata?.name ?? ''}`;
			if (!d?.spec || seen.has(k)) continue;
			seen.add(k);
			out.push(d);
		}
		return out;
	});

	/**
	 * ⭐ THE TWO ENDS OF THE EDGE, SELECTED SEPARATELY.
	 *
	 * A `RolloutDependency` names a CONSUMER (`spec.rolloutRef`, always in the
	 * dependency's own namespace) and a PROVIDER (`spec.providerRef`, which
	 * may be anywhere).
	 */
	const deps = $derived(allDeps.filter((d) => d.spec?.rolloutRef?.name === name));

	/** Namespace of every environment of this app, so a dependency can be placed. */
	const envByNamespace = $derived.by<Map<string, string>>(() => {
		const m = new Map<string, string>();
		for (const s of siblings.values()) if (s.namespace) m.set(s.namespace, s.env);
		m.set(namespace, currentEnvKey);
		return m;
	});

	const currentTagByEnv = $derived.by<Map<string, string | null>>(() => {
		const m = new Map(chainRows.map((r) => [r.env, r.tag] as const));
		if (!m.has(currentEnvKey)) {
			m.set(currentEnvKey, rollout?.status?.history?.[0]?.version?.tag ?? null);
		}
		return m;
	});

	const blocks = $derived(
		contractBlocks({
			deps,
			envOf: (ns) => envByNamespace.get(ns) ?? null,
			envOrder: envOrder.length > 0 ? envOrder : [currentEnvKey],
			order,
			currentTagOf: (env) => currentTagByEnv.get(env) ?? null,
			// THIS environment's own gate is the authority for what its provider
			// is on. Folding to the first entry is what printed
			// `in hello-dep-prod` on the DEV rollout's page.
			preferEnv: currentEnvKey
		})
	);

	function providerHref(b: ContractBlock): string {
		// A consumer, its provider and the dependency are always in ONE
		// namespace on ONE cluster, so the dependency's own source-cluster
		// annotation is the provider's cluster.
		const own = b.entries.find((e) => e.env === currentEnvKey) ?? b.entries[0];
		const c = dependencySourceCluster(own?.dep) || cluster;
		return rolloutPath(c, b.providerNamespace, b.providerName);
	}

	/** `dependencies.ts`'s own `providerResolved` — see its doc comment for
	 *  why this page cannot just build the link and hope. */
	function providerResolved(b: ContractBlock): boolean {
		return depProviderResolved(b, listRollouts);
	}

	/**
	 * ⭐ THE "NEEDS" FACT, READ OFF WHAT IS ACTUALLY RUNNING, NOT INVENTED.
	 *
	 * A release's `com.kuberik.rollout.requires.<contract>` annotation is the
	 * one honest source for "what does this contract have to satisfy" — the
	 * same field `consumerStateFor` reads for the "Depends on this" axis,
	 * applied here to THIS rollout's own current build instead of a sibling's.
	 * It renders whether or not anything is currently held, which is what
	 * lets an "up to date" row still say what it needs.
	 */
	function ownRequires(contract: string): string | null {
		return releaseRequires(rollout?.status?.history?.[0]?.version)?.[contract] ?? null;
	}

	/**
	 * ONE ROW PER HELD BUILD, flattened out of every contract block. A block
	 * with two builds held for two different reasons becomes two rows here —
	 * each states its own required version, never a folded or averaged one.
	 */
	type HeldRow = {
		key: string;
		display: string;
		providerName: string;
		requiredVersion: string | null;
		providedVersion: string | null;
		envs: string[];
	};
	const heldRows = $derived<HeldRow[]>(
		blocks.flatMap((b) =>
			b.blocked.map((w) => ({
				key: `${b.key}|${w.key}`,
				display: w.display,
				providerName: b.providerName,
				requiredVersion: w.requiredVersion,
				// A block whose providers disagree has no single served number —
				// see `ContractBlock.providedVaries` — so a held row from it
				// states no "has" clause rather than picking one at random.
				providedVersion: b.providedVaries ? null : b.providedVersion,
				envs: w.envs
			}))
		)
	);

	/**
	 * ⭐ A HOLD THAT CLEARS LIVE STAYS ON THE PAGE, MARKED RELEASED, until the
	 * reader navigates or reloads (`RetainedRows`). Dropping the row made the
	 * card — and the page under it — shrink each time the dependencies story
	 * moved, ~12% over its four beats. The header still counts CURRENT holds.
	 */
	const heldRetainer = new RetainedRows<HeldRow>();
	const heldShown = $derived(
		heldRetainer.apply(`${cluster}/${namespace}/${name}`, heldRows, (r) => r.key)
	);
	/**
	 * ⭐ SCOPE (squad-rollout Lane G, round 2, item 2): "Other environments"
	 * is every held row (the contract axis) NOT in this environment —
	 * `currentEnvKey`, the same key every other axis on this page already
	 * groups by. "Here" moved to `holdBreakdown.held` directly (round 3,
	 * item 4 — see that derived's own doc comment, below `holdBreakdown`),
	 * so only the "elsewhere" half of this split still reads the contract
	 * axis (`heldShown`) here.
	 */
	const heldOtherShown = $derived(heldShown.filter(({ row }) => !row.envs.includes(currentEnvKey)));
	/** RELEASED rows now only come from "Other environments" — "Here" reads
	 *  `holdBreakdown` live every render and has no retained/released state
	 *  of its own (see `hereHeldRow`'s own comment). */
	const releasedShownCount = $derived(heldOtherShown.filter((x) => x.resolved).length);

	const adverse = $derived(blocks.filter((b) => b.blocked.length > 0));
	const heldProviders = $derived([...new Set(adverse.map((b) => b.providerName))]);
	/**
	 * ⛔ THE HEADER COUNTS DISTINCT SERVICES, THE ROWS COUNT DISTINCT BUILDS.
	 * A service held on two builds at once is one entry in `heldProviders`
	 * and two rows in `heldRows` — the header states "how many services",
	 * the rows state "on what".
	 */
	const providerCount = $derived(new Set(blocks.map((x) => x.providerName)).size);

	/**
	 * ⭐ "ONE SERVICE, TWO COUNTS" — THE SCOPE SPLIT (squad-rollout Lane G
	 * round 5, item A, AD ruling). The canvas's own contract tile and this
	 * card's own row used to each print a DIFFERENT number for the same
	 * provider — the canvas named the one build it holds HERE, this row
	 * named the raw app-wide `b.blocked.length` with no scope word at all.
	 * Both now read `here`/`elsewhere` off this ONE split, computed once:
	 * a blocked build is "here" when its own `envs` names this environment
	 * (`currentEnvKey`, the same key every other axis on this page already
	 * groups by), "elsewhere" otherwise.
	 */
	/** Keyed for `RolloutNeighbourhood`'s own `elsewhereCountOverride` prop —
	 *  that component only ever needs the "elsewhere" half (its own edge
	 *  already answers "here"). */
	/**
	 * ⭐ DROP ZERO PARTS (squad-rollout Lane G round 6, item 4, AD ruling):
	 * "holding 1 elsewhere" never "0 here · 1 elsewhere" — a scope with
	 * nothing in it states the OTHER scope alone, not a zero nobody needs.
	 * Both can be zero only when `totalHeld` itself is (the row would not
	 * be adverse then, so this branch is a defensive fallback, never hit
	 * live).
	 */
	function scopeLabel(providerName: string, totalHeld: number): string {
		const scope = providerScope.get(providerName);
		if (!scope) return `holding ${totalHeld} ${totalHeld === 1 ? 'build' : 'builds'}`;
		// The unit is a BUILD, named once on the first count (the Held builds
		// rollup beside it counts builds too): "1 build here · 2 elsewhere".
		const builds = (n: number) => `${n} ${n === 1 ? 'build' : 'builds'}`;
		if (scope.here > 0 && scope.elsewhere > 0)
			return `holding ${builds(scope.here)} here · ${scope.elsewhere} elsewhere`;
		if (scope.here > 0) return `holding ${builds(scope.here)} here`;
		if (scope.elsewhere > 0) return `holding ${builds(scope.elsewhere)} elsewhere`;
		return 'not holding';
	}

	/**
	 * ⭐ THE "WAITS FOR …" CLAUSE, RE-INFLECTED (squad-rollout Lane G round
	 * 5 and 6). `classifyGate`'s own `clause` text is written to follow
	 * "until" elsewhere on this tab ("staging deploys it first", "someone
	 * approves it") — correct there, wrong grammar as this row's OWN verb
	 * ("Waits for staging deploys it first" has two finite verbs with no
	 * connective). Each KNOWN clause shape is re-inflected to the
	 * infinitive; "someone approves it" gets its own short form (round 6,
	 * item 1's exact wording: "Waits for an approval", not the grammatically
	 * fine but longer "Waits for someone to approve it"). Display-only —
	 * `classifyGate`'s own text is never touched.
	 */
	function waitsForText(clauses: string[]): string {
		const text = joinClauses(clauses);
		if (text === 'someone approves it') return 'an approval';
		if (text === 'the deploy window reopens') return 'the deploy window to reopen';
		if (text === 'a check starts passing') return 'a check to start passing';
		return text
			.replace(/\bdeploys\b/g, 'to deploy')
			.replace(/\bships\b/g, 'to ship')
			.replace(/\ballows\b/g, 'to allow');
	}

	/**
	 * ⭐ "WAITS FOR `<stage>`", THE ONE-HOP SENTENCE, SPELLED ONCE (qa11
	 * finding, squad-rollout gates-2 follow-up, 2026-10-11). An `if`/`else`,
	 * not a ternary nested inside a template literal — the message scanner
	 * (`lib/messages/drift.test.ts`) extracts a literal's text up to its
	 * first `${…}` boundary, so a ternary nested there ("Waits for
	 * `${x}${y ? ... : ...}`") scanned as a MANGLED half-sentence
	 * (`Waits for …${waitsForFact.heldCause ?`) instead of the two clean
	 * forms `waitsFor`'s own doc already promises. Same two shapes as
	 * `RolloutNeighbourhood.svelte`'s `chainWaitsForText`.
	 */
	function waitsForSentence(fact: { stage: string; heldCause?: string; wave?: string }): string {
		if (fact.wave) return fact.heldCause ? `${fact.wave} · ${fact.heldCause}` : fact.wave;
		if (fact.heldCause) return `Waits for ${fact.stage} · ${fact.heldCause}`;
		return `Waits for ${fact.stage}`;
	}

	// ── AXIS 3 · WHAT THIS ROLLOUT IS HOLDING ───────────────────────────

	/** Every rollout the list can see, for resolving a consumer. */
	const rolloutByKey = $derived.by<Map<string, Rollout>>(() => {
		const m = new Map<string, Rollout>();
		for (const r of listRollouts) {
			const ns = r.metadata?.namespace ?? '';
			const n = r.metadata?.name ?? '';
			if (ns && n) m.set(`${ns}/${n}`, r);
		}
		return m;
	});

	/**
	 * WHAT ONE CONSUMER IS RUNNING, AND WHAT THAT RELEASE ASKS OF US.
	 * `null`, not an empty state, when the rollout cannot be seen at all —
	 * see `Dependent.unobserved`.
	 */
	function consumerStateFor(ns: string, cname: string, contract: string): ConsumerState | null {
		const r = rolloutByKey.get(`${ns}/${cname}`);
		if (!r) return null;
		const releases: Release[] = [];
		for (const rel of r.status?.availableReleases ?? []) releases.push(rel as Release);
		for (const h of r.status?.history ?? []) if (h.version) releases.push(h.version as Release);
		const ord = buildOrder(releases);
		const history = (r.status?.history ?? []) as unknown as EnvHistoryEntry[];
		const cur = currentEntry({ environment: ns, history });
		const tag = cur?.version?.tag ?? null;
		const requires = releaseRequires(cur?.version)?.[contract] ?? null;
		return {
			order: ord,
			currentTag: tag,
			currentDisplay: tag ? displayOfTag(ord, tag) : null,
			requires,
			requiresUnresolved: !requires && releaseMetadataUnresolved(cur?.version),
			neverDeployed: history.length === 0
		};
	}

	/**
	 * Every namespace THIS APP runs in — `siblings`' own set, the same
	 * authority the chain reads, so this axis cannot include an environment
	 * the rest of the tab does not also consider part of this app.
	 */
	const providerNamespaces = $derived([
		namespace,
		...[...siblings.values()].map((s) => s.namespace).filter(Boolean)
	]);

	const provided: ProvidedContract[] = $derived(
		providedContracts({
			deps: allDeps,
			provider: name,
			providerNamespace: namespace,
			providerNamespaces,
			consumerState: consumerStateFor,
			clusterOf: (d) => dependencySourceCluster(d) ?? null
		})
	);

	/** The own-namespace place for a consumer, when this app has one there. */
	function ownPlace(d: Dependent) {
		return d.places.find((p) => p.namespace === namespace) ?? d.places[0];
	}

	function consumerHref(d: Dependent): string | undefined {
		const p = ownPlace(d);
		if (!p) return undefined;
		return rolloutPath(p.cluster || cluster, p.namespace, d.name, 'gates');
	}

	/**
	 * ONE ROW PER DOWNSTREAM SERVICE, deduplicated across contracts — a
	 * consumer gated on two contracts of this rollout is still one row.
	 */
	type DownstreamRow = {
		name: string;
		href: string | undefined;
		running: string | null;
		adverse: boolean;
	};
	const downstreamRows = $derived.by<DownstreamRow[]>(() => {
		const byName = new Map<string, DownstreamRow>();
		for (const c of provided) {
			for (const d of c.dependents) {
				const existing = byName.get(d.name);
				byName.set(d.name, {
					name: d.name,
					href: consumerHref(d),
					running: !d.runningVaries && d.running ? d.running : (existing?.running ?? null),
					adverse: d.adverse || (existing?.adverse ?? false)
				});
			}
		}
		return [...byName.values()];
	});

	// ── THE GRAPH · every kind of gate on this rollout, both directions ──

	/**
	 * ⭐ THE SAME GRAPH `/dependencies` DRAWS, built from the same payload, read
	 * from this one node: every edge into it is an upstream, every edge out of
	 * it a downstream. `rolloutNeighbourhood` adds which builds each held edge
	 * is holding.
	 *
	 * 2026-10-08 — THIS TAB NOW ALSO PASSES `gates` AND `focus`:
	 *   · `gates` (`GateContext`) is what classifies the focus node's leftover
	 *     holds — a deploy window, an approval, health — the same join table
	 *     `blockingStory`/every banner reads. Without it `node.holds` is
	 *     empty and `rolloutGateBoxes` below has nothing to draw.
	 *   · `focus` makes this rollout a NODE even when it has no edge at all
	 *     (see `buildRolloutGraph`'s own note) — a rollout held only by a
	 *     deploy window has no promotion or contract edge, and used to have
	 *     no graph at all.
	 */
	const clusterInfoQuery = createQuery(() => clusterInfoQueryOptions());
	const localClusterName = $derived(clusterInfoQuery.data?.name || undefined);

	/**
	 * ⭐ A ROLLOUT WITH NO GATES TAB NEVER STAYS ON IT (squad-rollout Lane G
	 * round 5, 2026-10-10, coordinator ruling). `+layout.svelte` already
	 * hides the "Gates" link from the tab strip once `rolloutTabs(...)` says
	 * `gates: false` — but a reader who followed an OLD link, a bookmark, or
	 * typed `/gates` directly still landed on this page's own dead-end empty
	 * state with no tab even highlighted to show them where they are. This
	 * reads the IDENTICAL predicate the layout's strip uses (same function,
	 * same inputs — the two cannot disagree about whether this tab exists)
	 * and sends them to the Overview the instant both queries this needs
	 * have answered. `replaceState: true` so the dead `/gates` URL never
	 * lands in back-button history — the rollout's own page is the one they
	 * meant to reach.
	 */
	const gatesTabKnown = $derived(rolloutQuery.data !== undefined && listQuery.data !== undefined);
	const hasGatesTab = $derived(
		rolloutTabs({
			rollout,
			rolloutGates: (rolloutQuery.data as { rolloutGates?: { items?: RolloutGate[] } } | undefined)
				?.rolloutGates,
			environment,
			cluster,
			localCluster: localClusterName,
			namespace,
			name,
			environments: listQuery.data?.environments?.items ?? [],
			rolloutDependencies: listQuery.data?.rolloutDependencies?.items ?? []
		}).gates
	);
	$effect(() => {
		if (gatesTabKnown && rollout && !hasGatesTab) {
			goto(href(`/rollouts/${cluster}/${namespace}/${name}`), { replaceState: true });
		}
	});

	/**
	 * ⭐ shared/cards-join (2026-10-11): built from the SAME four functions
	 * `$lib/view-models/card-context.ts`'s `cardContext` composes
	 * (`buildGateContext` → `withSchedules` → `buildRolloutGraph` →
	 * `contractHoldsForRollout`, below), so this tab classifies a gate
	 * identically to `ControlCenter`/`/apps`/`/rollouts`/the palette. Kept
	 * hand-assembled rather than routed through `cardContext` itself: this
	 * tab has evidence those list-only surfaces don't (`rolloutGates`
	 * ownership and this rollout's own per-namespace `/schedules` fetch —
	 * both of which `cardContext` accepts as optional inputs, so it COULD
	 * take over this exact construction if a later pass wants one fewer
	 * hand-rolled copy), and `appLane`/`holdBreakdown` below already hand
	 * `buildRolloutCards`/`promotionHoldBreakdown` both `gateContext` and
	 * `contractHoldsForRollout(network, …)` — the actual defect (a caller
	 * missing one of the two joins) does not apply here.
	 */
	const gateContext = $derived.by(() => {
		const base = buildGateContext({
			environments: listQuery.data?.environments ?? (environment ? { items: [environment] } : null),
			rolloutDependencies: { items: allDeps },
			rolloutGates:
				(rolloutQuery.data as { rolloutGates?: { items?: RolloutGate[] } } | undefined)
					?.rolloutGates ?? null
		});
		return schedules !== null ? withSchedules(base, namespace, schedules) : base;
	});

	/**
	 * ⭐ THE HELD TRUTH, REUSED VERBATIM — never a new sentence. (Spec §3,
	 * "fixed behaviour"; corrected 2026-10-09 by the coordinator after
	 * `checkout-api/prod-us-east-2` showed `blockStory.blocked` and the
	 * graph's own `hood.holding` disagreeing — see `promotionHoldBreakdown`
	 * below for the full account.) `blockStory` is the EXACT same call the
	 * Overview tab's own banner makes on this rollout
	 * (`blockingStory(rollout, gateContext, { place, now })`) and is kept
	 * here for its `kindPending` flag (the lead row withholds the same way
	 * `BlockingStoryPanel` does). Its `headline`/`consequence` are no longer
	 * read directly for the "some held" case — see `holdBreakdown`.
	 */
	const blockStory = $derived(
		blockingStory(rollout, gateContext, {
			place: environment?.spec?.environment ?? null,
			now: $now
		})
	);

	const networkEnvOrder = $derived(
		[...new Set(listEnvironments.map((e) => e.spec?.environment).filter(Boolean) as string[])].sort(
			compareEnvironmentNames
		)
	);
	const network = $derived(
		buildRolloutGraph({
			rollouts: listRollouts,
			environments: listEnvironments,
			dependencies: allDeps,
			envOrder: networkEnvOrder,
			gates: gateContext,
			focus: { cluster, namespace, name, localCluster: localClusterName }
		})
	);

	/** The focus node, matched exactly like `rolloutNeighbourhood`'s own. */
	const focusNode = $derived(
		network.nodes.find(
			(n) =>
				n.namespace === namespace &&
				n.name === name &&
				onCluster(n.cluster, cluster, localClusterName)
		) ?? null
	);

	/**
	 * ⭐ THIS ROLLOUT'S OWN CONTRACT HOLDS, FOR `promotionHoldBreakdown`
	 * (squad-rollout Lane G, round 3, 2026-10-09). Live-measured on
	 * `checkout-api/prod-us-east-2`: the Overview's own "Newer builds" rows
	 * showed `4.43.0-43` held by the `payments-svc` CONTRACT while the
	 * promotion-gate-only breakdown called it deployable. `contractHoldsForRollout`
	 * (`dependency-graph.ts`) is the shared helper the TL extracted from this
	 * file's own first draft — `blockingStory` now takes the identical map,
	 * so this and the Overview banner read off the SAME function rather than
	 * two hand-rolled copies of the same edge filter.
	 */
	const contractHolds = $derived(
		rollout ? contractHoldsForRollout(network, rollout, namespace, cluster) : new Map()
	);

	/**
	 * ⭐ PER-BUILD HELD — the fact the lead row and the header meta actually
	 * need. `blockStory.blocked` only answers "can NOTHING promote" (every
	 * candidate refused); it is correctly `false` on `checkout-api/
	 * prod-us-east-2` while `4.43.0-43` is held and `4.42.0-42` is not, and
	 * the Overview correctly shows no banner there — but this card's own
	 * header already said "1 of 2 gates holding", so printing "Nothing is
	 * holding this rollout" directly under it was the exact contradiction
	 * this pass exists to close. `promotionHoldBreakdown` (`blocking-story.ts`,
	 * a pure helper beside `blockingStory`, cleared with the design-rollout
	 * TL) names the SAME build ids and gate clauses the Overview's own
	 * "Newer builds" rows and the Change Version dialog already read off
	 * `blockingGateNames`/`classifyGate` — so this card, the Overview and
	 * the dialog cannot disagree about which builds are held. When EVERY
	 * candidate is held BY A GATE ALONE it returns `blockingStory`'s own
	 * words verbatim; `contractHolds` (above) now folds the CONTRACT axis
	 * in too, so a build `blockingStory` cannot see is never called
	 * deployable here either.
	 */
	const holdBreakdown = $derived(
		promotionHoldBreakdown(rollout, gateContext, {
			place: environment?.spec?.environment ?? null,
			now: $now,
			contractHolds
		})
	);

	/**
	 * ⭐ REFUSED HERE VS NOT REACHED YET, FOR THE LEAD ROW. (shared/held-
	 * predicate, 2026-10-11) `holdBreakdown.allHeld` — "every candidate held
	 * by something" — is true of plain chain sequencing too: a build the
	 * upstream environment has not deployed yet refuses every candidate just
	 * as completely as a real hold does. See `view-models/held.ts`'s own
	 * doc for the ruling; `appLane`'s cards are the SAME ones Home and the
	 * Overview banner read, built here off this app's own fleet rows with
	 * the SAME contract join (`contractHoldsForRollout`, off the identical
	 * `network` this route already built for `holdBreakdown` above).
	 */
	const appLane = $derived.by(() => {
		const me = rollout?.metadata?.name;
		if (!me) return null;
		const mine = listRollouts.filter((r) => r.metadata?.name === me);
		const cards = buildRolloutCards(mine, listEnvironments, $now, gateContext, (r) =>
			contractHoldsForRollout(network, r)
		);
		return buildLanes(cards)[0] ?? null;
	});
	const hereCard = $derived.by(() => {
		const all = [...(appLane?.stages ?? []), ...(appLane?.prod ?? [])];
		return all.find((n) => n.card.ns === namespace && n.card.name === name)?.card ?? null;
	});
	/**
	 * ⭐ THE PEER MAP, SHARED (squad-rollout gates-2 follow-up, 2026-10-11).
	 * Pulled out of `waitsForFact` so `hereHeldRow`'s own per-build read can
	 * compose the identical "`<stage>` held on `<cause>`" one-hop clause
	 * `waitsFor` already gives the lead row — one map, not a second copy
	 * built per row.
	 */
	const peersByEnv = $derived.by(() => {
		const m = new Map<string, RolloutCard>();
		for (const n of [...(appLane?.stages ?? []), ...(appLane?.prod ?? [])]) {
			if (n.card.envName) m.set(n.card.envName, n.card);
		}
		return m;
	});
	const waitsForFact = $derived.by(() => {
		if (!hereCard || hereCard.held) return null;
		return waitsFor(hereCard, { peersByEnv });
	});

	/**
	 * ⭐ THE CANVAS'S OWN PEER MAP (qa11 finding, squad-rollout gates-2
	 * follow-up, 2026-10-11). `RolloutNeighbourhood`'s chain links read
	 * this, keyed on the raw env name, to compose "staging held on
	 * payments-svc" on the staging TILE itself — the same one-hop fact
	 * `waitsForFact` already prints for the lead row, reaching the
	 * canvas without a second copy of the join.
	 */
	const peerHeldByEnv = $derived.by(() => {
		const m = new Map<string, { held: boolean; causeLabel: string | null }>();
		for (const [envName, card] of peersByEnv) {
			m.set(envName, { held: card.held, causeLabel: card.heldCauseLabel });
		}
		return m;
	});

	/**
	 * ⭐ THE LEAD ROW'S ONE SENTENCE, COMPOSED HERE NOW (squad-rollout Lane G
	 * round 2, item 1 follow-up; round 3, item 3, 2026-10-09 coordinator
	 * corrections). `promotionHoldBreakdown` is a `blocking-story.ts` export,
	 * and that file is a `registry.ts` `SENTENCE_MODULE`: every English
	 * sentence it returns must be reachable from a state `truth.test.ts`
	 * models. Neither the mixed-gate case nor a contract-involved hold is a
	 * modeled controller state (both are live-fixture reads), so this route
	 * (NOT a `SENTENCE_MODULE`) composes the sentence instead, from nothing
	 * `holdBreakdown` does not already carry: `held[].build`,
	 * `held[].clauses` (gate cause), `held[].contract` (contract cause,
	 * round 3) and `deployable`. `blockingStory`'s own words are read
	 * verbatim ONLY when `holdBreakdown.headline` is non-empty — the one
	 * case it already decided it CAN answer (gate-alone `allHeld`; see that
	 * function's own doc comment).
	 *
	 * ⭐ GROUPED BY CAUSE (round 3): a build can be held by a gate ("wait
	 * UNTIL staging deploys them") or by a contract ("waits ON payments-svc
	 * ~2.9.0 (has 2.4.1)") — two different prepositions for two different
	 * facts, so builds are grouped by their exact cause text and each group
	 * renders its own clause, joined "; ". Builds that are held by BOTH at
	 * once lead with the gate clause (the promotion order is what the
	 * controller itself enforces; the contract is additional and still
	 * named in that same group's text).
	 */
	const leadSentence = $derived.by<{
		headline: string;
		consequence: string;
		tone: 'held' | 'neutral';
	} | null>(() => {
		if (!holdBreakdown.anyHeld) return null;
		// ⭐ qa11b CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11):
		// the gate is `reallyHeldHere.length === 0`, NEVER `!hereCard.held`.
		// `hereCard.held` (rollout-wide `heldVerdict`) blends every held
		// candidate's gates into ONE list before checking chain dominance —
		// correct when one candidate is in play, wrong the instant two
		// DIFFERENT candidates have two different causes (measured live,
		// `checkout-api/prod-us-east-2`: the newest two are chain-refused by
		// staging, the oldest held candidate, `4.43.0-43`, already passed
		// staging and is refused HERE by `payments-svc` — chain dominance
		// swallowed that real hold). `reallyHeldHere` is `heldVerdictForBuild`
		// applied PER CANDIDATE, which is immune to that blending. ONLY when
		// NOTHING is really held here does this lead with `waitsFor`'s
		// sentence — in neutral ink (`tone`), never amber: a chain wait is
		// not a hold.
		if (reallyHeldHere.length === 0 && waitsForFact) {
			return {
				headline: waitsForFact.wave ?? `Waits for ${waitsForFact.stage}`,
				// `waitsForFact.heldCause` already reads "<stage> held on <cause>"
				// (`waitsFor`'s own doc) — never re-prefix the stage name a
				// second time ("staging is staging held on …").
				consequence: waitsForFact.heldCause
					? `${waitsForFact.heldCause}.`
					: waitsForFact.wave
						? `Nothing promotes itself here until ${waitsForFact.stage} clears this build.`
						: `Nothing promotes itself here until ${waitsForFact.stage} deploys this build.`,
				tone: 'neutral'
			};
		}
		// ⭐ qa11b: ONLY when EVERY held candidate is a REAL hold (none of
		// them chain-only) does `blockingStory`'s own blended prose apply —
		// it has no per-build view, so a mix of chain + real causes must
		// fall through to the per-build `groups` composition below instead,
		// which names the ACTUAL held build.
		if (holdBreakdown.allHeld && reallyHeldHere.length === holdBreakdown.held.length) {
			// Nothing can move: the banner's own words (the Overview prints the
			// same story, contract holds included), never a second sentence.
			const story = blockingStory(rollout, gateContext, {
				place: environment?.spec?.environment ?? null,
				now: $now,
				contractHolds
			});
			// The banner's own title (holdCausePhrase), so the Gates lead row and
			// the Overview banner print one sentence for one fact.
			if (story.headline)
				return {
					headline:
						holdCausePhrase(story, { place: environment?.spec?.environment ?? null }) ??
						story.headline,
					consequence: story.consequence,
					tone: 'held'
				};
		}
		// ⭐ qa11b: `reallyHeldHere`, NEVER the raw `holdBreakdown.held` — a
		// chain-only candidate is not held here and must not be named
		// alongside a real hold as if it were one. `composeHeldLeadSentence`
		// (`held.ts`) is this exact composition, extracted so it is pinned
		// against a real fixture without rendering this whole route.
		const { headline, consequence } = composeHeldLeadSentence(
			reallyHeldHere,
			holdBreakdown.deployable
		);
		return { headline, consequence, tone: 'held' };
	});

	/**
	 * ⭐ "Here" COUNT, FROM `holdBreakdown` DIRECTLY (squad-rollout Lane G
	 * round 3, item 4, 2026-10-09 coordinator correction). Three separate
	 * reads of "how many builds are held here" used to disagree — the header
	 * meta read the gate-only `holdBreakdown.held.length`, the "Held builds"
	 * card's own "Here" count read the CONTRACT-only `heldRows` filtered to
	 * this env, and the two could print different numbers for the identical
	 * rollout (measured live: header "2 wait here", card "1 waits here").
	 * `heldHereCount` now IS `holdBreakdown.held.length` — not a second
	 * computation that happens to equal it — so the header meta, this
	 * card's rollup, the "Here" group's own subheader count and the
	 * focus-node override (`RolloutNeighbourhood`'s `heldBuildsOverride`,
	 * below) all read the SAME array and cannot drift apart again.
	 *
	 * ⭐ qa11 CORRECTION (squad-rollout gates-2 follow-up, 2026-10-11):
	 * `holdBreakdown.held.length` is itself still the OVERSTATEMENT — it
	 * counts a candidate refused ONLY by plain chain sequencing (staging
	 * has not deployed it yet) exactly like a real hold, which is the
	 * same bug `held.ts`'s `heldVerdict` exists to kill at the per-build
	 * scale. `reallyHeldHere` is the SUBSET `heldVerdictForBuild` calls
	 * genuinely held at `currentEnv` — never reached-yet — and every
	 * count below reads THAT, not the raw array.
	 */
	const skippedFn = $derived(skippedPredicate(rollout, stageBuilds(rollout, listQuery.data?.rollouts?.items)));
	const heldSplit = $derived(heldBuilds(holdBreakdown, currentEnv, skippedFn));
	const reallyHeldHere = $derived(heldSplit.held);
	/** A8: candidates the stage in front already passed over; the group says so instead of "Waiting for staging". */
	const skippedHere = $derived(heldSplit.skipped.map((x) => x.entry));
	const skippedStage = $derived(heldSplit.skipped[0]?.stage ?? null);
	const heldHereCount = $derived(reallyHeldHere.length);
	/** Per provider: builds refused HERE vs held only elsewhere (`providerScopeCounts`). */
	const providerScope = $derived(providerScopeCounts(blocks, reallyHeldHere, currentEnvKey));
	/** The tile only needs the "elsewhere" half. */
	const elsewhereCounts = $derived(
		new Map([...providerScope.entries()].map(([name, s]) => [name, s.elsewhere]))
	);
	const heldOtherCount = $derived(heldRows.filter((r) => !r.envs.includes(currentEnvKey)).length);
	/**
	 * ⭐ THE "Held builds" CARD'S OWN TWO FACTS, NEVER ONE BLENDED LIST
	 * (qa11b, item 2, squad-rollout gates-2 follow-up, 2026-10-11). The
	 * card's "Here" group used to be `holdBreakdown.held` verbatim — real
	 * holds and chain-queued candidates in the SAME list under ONE count,
	 * which could never agree with the card's own rollup
	 * (`heldBuildsVerdict`, built from `heldHereCount` alone). `chainOnlyHere`
	 * is the complement of `reallyHeldHere` within the SAME array (object
	 * identity — `reallyHeldHere` is a `filter` of `holdBreakdown.held`, so
	 * `includes` is exact); every row in it waits on the SAME upstream stage
	 * `heldVerdictForBuild` already named, which is what the group's own
	 * label reads (falling back to a bare "Waiting" only if a rollout
	 * somehow queues behind more than one stage at once — never observed
	 * live, but never guessed into one name either).
	 */
	const chainOnlyHere = $derived(holdBreakdown.held.filter((h) => !reallyHeldHere.includes(h) && !skippedHere.includes(h)));
	const chainOnlyStages = $derived([
		...new Set(
			chainOnlyHere
				.map((h) => heldVerdictForBuild(h, currentEnv).waitsForEnv)
				.filter((s): s is string => !!s)
		)
	]);
	const waitingGroupLabel = $derived(
		chainOnlyStages.length === 1 ? `Waiting for ${chainOnlyStages[0]}` : 'Waiting'
	);
	/**
	 * ⭐ THE FOCUS BOX'S OWN "WAITS FOR" SENTENCE (qa11 finding, squad-rollout
	 * gates-2 follow-up, 2026-10-11). `null` unless `heldHereCount` is 0
	 * AND this card is itself chain-behind a stage — the exact case where
	 * "none held now"/"No build held here" would understate: nothing
	 * genuinely held here, but something IS still true to say — this
	 * rollout has not reached the build yet. See `view-models/held.ts`'s
	 * own ruling.
	 */
	const focusWaitsFor = $derived(
		heldHereCount === 0 && waitsForFact ? waitsForSentence(waitsForFact) : null
	);
	/** The card's own rollup — THIS rollout's count first, per the spec. */
	const heldBuildsVerdict = $derived.by(() => {
		const parts: string[] = [];
		// ⭐ qa11b, item 4: "held", never "wait" — a REALLY held build is
		// refused HERE, not merely queued. "wait"/"waits" stays for
		// `focusWaitsFor`'s own chain sentence (the `else if` below).
		if (heldHereCount > 0) parts.push(`${heldHereCount} held here`);
		else if (focusWaitsFor) parts.push(focusWaitsFor);
		if (heldOtherCount > 0) parts.push(`${heldOtherCount} held elsewhere`);
		if (parts.length === 0) parts.push('none held now');
		if (releasedShownCount > 0) parts.push(`${releasedShownCount} released`);
		return parts.join(' · ');
	});

	/** Gate names already drawn as EDGES into the focus — never boxed twice. */
	const edgeGates = $derived(
		new Set(focusNode ? network.edges.filter((e) => e.to === focusNode.id).map((e) => e.gate) : [])
	);

	/**
	 * EVERY GATE ON THIS ROLLOUT THAT IS NOT ANOTHER ROLLOUT — a deploy
	 * window, a freeze, an approval, health (only while it holds), a pin.
	 * `rollout-gates.ts` never re-decides whether one holds; it reads
	 * `focusNode.holds`, the same predicate every edge and banner reads.
	 */
	const gateBoxesRaw = $derived(
		rolloutGateBoxes({
			focus: focusNode,
			rollout,
			rolloutGates:
				(rolloutQuery.data as { rolloutGates?: { items?: RolloutGate[] } } | undefined)
					?.rolloutGates?.items ?? [],
			schedules,
			healthChecks,
			edgeGates
		})
	);

	// A5: a gate box names the builds it holds HERE (`heldBuilds`), not every candidate the gate refuses: the approval gate refuses all of
	// them, two of which have not reached this place yet.
	const gateBoxes = $derived.by(() => {
		const hereBuilds = new Set(reallyHeldHere.map((h) => h.build));
		return gateBoxesRaw.map((b) => (b.state === 'blocked' && b.kind !== 'pin' ? { ...b, held: b.held.filter((x) => hereBuilds.has(x)) } : b));
	});

	const hood = $derived(
		rolloutNeighbourhood({
			graph: network,
			at: { cluster, namespace, name },
			localCluster: localClusterName,
			gates: gateBoxes
		})
	);

	/**
	 * ⭐ THE CANVAS AGREES WITH THE BREAKDOWN (squad-rollout Lane G round 4,
	 * item 1, AD ruling). `hood.upstream`'s own per-edge state can disagree
	 * with `holdBreakdown`'s per-build read for the identical gate — the
	 * live defect: the staging-first promotion link drew "Nothing held"
	 * beside a lead row and header correctly naming two held builds for
	 * that exact gate. `reconcileNeighbourhoodHolds` takes `holdBreakdown`
	 * as the one true source and returns the canvas's own corrected links
	 * PLUS the holding count the header meta and the card's own rollup now
	 * read — so the canvas, the lead row and the rollup cannot name three
	 * different counts for the same rollout again.
	 */
	const reconciled = $derived(
		reconcileNeighbourhoodHolds(hood.upstream, holdBreakdown, {
			heldHere: (h) => reallyHeldHere.some((r) => r.build === h.build)
		})
	);
	/**
	 * The FULL "N of M holding" rollup: `reconciled.holding` (upstream only —
	 * see that field's own doc comment) plus `hood.downstream`/`hood.gates`'
	 * own blocked counts, unreconciled (this breakdown never describes what
	 * the focus holds on someone else, or its own deploy-window/approval
	 * gates). Replaces `hood.holding` everywhere this tab states that count.
	 */
	const gatesHere = $derived(
		gatesOnThisRollout({ upstream: reconciled.upstream, downstream: hood.downstream, gates: hood.gates })
	);
	const reconciledHolding = $derived(gatesHere.holding);

	/**
	 * ⭐ THE REAL GATE TOTAL (qa11b correction, squad-rollout gates-2
	 * follow-up, 2026-10-11). `hood.total` counts every upstream link,
	 * including a chain predecessor — which `reconciledHolding` already
	 * excludes from the numerator, but `hood.total` still inflated the
	 * DENOMINATOR ("1 of 2 gates holding" on `checkout-api/prod-us-east-2`,
	 * where the "2" counted the staging chain link alongside the one real
	 * gate, `payments-svc`). `realGateTotal` drops every chain predecessor
	 * from the denominator too, so "1 of 2" never again names a gate that
	 * was never going to hold anything here in the first place.
	 */
	const realGateTotal = $derived(gatesHere.total);

	/**
	 * The Gates header's one fact (rollout-tabs gates2, 2026-10-25; recovered
	 * sr-gates2 line). Worst-first, `realGateTotal` as denominator throughout;
	 * `null` when the rollout has no gates (the card already says "0 gates").
	 */
	const gateFactNow = $derived(
		gateFact(
			realGateTotal,
			reconciledHolding,
			// A failing check counts only when the health gate is actually one of
			// the boxes (no newer candidate / pinned / already refused: no box).
			healthQuiet === 'failing' && gateBoxes.some((g) => g.kind === 'health')
		)
	);

	const hasChain = $derived(chainRows.length > 0);
	const hasContracts = $derived(blocks.length > 0);
	const hasDependents = $derived(provided.length > 0);

	// ⛔ `twoColumns` (whether to split the grid) is RETIRED (squad-rollout
	// Lane G round 5, AD ruling): the main+rail split is unconditional now —
	// see the grid's own comment where it renders, below.
</script>

<!-- ⭐ THE "Here" GROUP'S OWN ROW (squad-rollout Lane G round 3, item 4,
     2026-10-09): reads `holdBreakdown.held` directly — the SAME array the
     header meta and the focus-node override read — so this group's own
     count cannot disagree with either. A `held[]` entry is a PROMOTION
     candidate, not a `HeldRow` (the contract-axis type `heldRow` below
     renders): its cause can be a gate clause, a contract, or both at once
     (see `leadSentence`'s own grouping note), so this row states whichever
     applies rather than assuming one shape. No "released" tracking here
     (unlike `heldRow`'s `RetainedRows`) — this list is read live off
     `holdBreakdown` every render, so a build that clears simply leaves it. -->
{#snippet hereHeldRow(h: {
	build: string;
	clauses: string[];
	contract?: { provider: string; required?: string; has?: string };
	classifiedGates: ClassifiedGate[];
})}
	<!-- ⭐ CHAIN VS REALLY HELD, PER BUILD (squad-rollout gates-2 follow-up,
	     2026-10-11, shared/held-predicate). This row used to draw EVERY
	     `holdBreakdown.held` entry as `StatusMark state="held"` plus a
	     "Waits for …" clause built straight off `h.clauses`' prose — which
	     cannot tell a same-tier order gate or a contract (genuinely refused
	     HERE) apart from an earlier-tier promotion gate (this build has not
	     reached this environment yet — plain chain sequencing, not a hold).
	     `heldVerdictForBuild` (`held.ts`) is the one predicate; a
	     chain-refused build drops the `Held` mark and the held ink
	     entirely and reads "Waits for `<stage>`" in neutral `fg-muted`,
	     composing the one-hop `<stage> held on <cause>` clause from the
	     SAME `peersByEnv` the lead row's own `waitsForFact` reads — never a
	     second "held" for the identical cause. A build this environment
	     really does refuse renders exactly as before: `h.clauses`/
	     `h.contract` are unchanged. -->
	{@const verdict = heldVerdictForBuild(h, currentEnv)}
	{@const chainOnly = !verdict.held && !!verdict.waitsForEnv}
	{@const peerClause = chainOnly
		? (waitsFor({ waitsForEnv: verdict.waitsForEnv }, { peersByEnv })?.heldCause ?? null)
		: null}
	<li class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 py-3.5">
		<div class="flex min-w-0 items-start gap-2.5">
			<span class="mt-0.5">
				{#if chainOnly}
					<!-- Not a hold — a neutral dot, the same mark `heldRow`'s own
					     "released" branch uses for "nothing is holding this". -->
					<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
						<span class="bg-fg-subtle h-1.5 w-1.5 rounded-full"></span>
					</span>
				{:else}
					<StatusMark state="held" label="Held" />
				{/if}
			</span>
			<div class="min-w-0">
				<span class="t-code text-fg">{h.build}</span>
				<p class="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
					{#if chainOnly}
						<span class="t-meta text-fg-muted"
							
							>{verdict.waveWait ?? `Waits for ${verdict.waitsForEnv}`}{peerClause ? ` · ${peerClause}` : ''}</span
						>
					{:else}
						{#if h.clauses.length > 0}
							<!-- ⭐ "Waits for X to deploy it first" / "Waits for an
							     approval" (squad-rollout Lane G round 5 + round 6, AD
							     ruling) — see `waitsForText`'s own comment for the full
							     per-clause-shape account. -->
							<span class="t-meta text-fg-muted">Waits for {waitsForText(h.clauses)}</span>
						{/if}
						{#if h.contract}
							<span class="t-meta text-fg-muted">
								Needs {h.contract.provider}
								{#if h.contract.required}<span class="t-code-sm">{h.contract.required}</span>{/if}
							</span>
							{#if h.contract.has}
								<span class="t-meta text-fg-subtle">
									has <span class="t-code-sm">{h.contract.has}</span>
								</span>
							{/if}
						{/if}
					{/if}
				</p>
			</div>
		</div>
		<Chip
			role="env"
			theme={currentTheme}
			label={shortEnvLabel(currentTheme) || currentEnv}
			title={currentEnv}
			wide
			class="shrink-0"
		/>
	</li>
{/snippet}

<!-- ⭐ ONE ROW TEMPLATE FOR BOTH "Held builds" GROUPS (squad-rollout Lane G
     round 2, item 2 and item 6) — "Here" and "Other environments" render the
     identical row, so the grouping above is presentation only, never a
     second copy of the row's own markup. Item 6: a leading held mark
     (`StatusMark state="held"`, the same 16px family every other leading
     status column on this tab now uses) — a RELEASED row carries no mark
     (nothing holds it any more; the "released" chip already says so). -->
{#snippet heldRow(row: HeldRow, resolved: boolean)}
	<!-- ⚠️ NO `flex-1` ON THE TEXT SIDE — see `Card.svelte`'s own
	     header comment. A `flex-1` item's basis resolves to 0, so
	     the row's wrap decision never fires and a `shrink-0` sibling
	     (here, up to four env chips) is squeezed onto the same visual
	     line as wrapping text instead of dropping below it. `min-w-0`
	     with no grow, plus `justify-between`, is the exact mechanism
	     `Card`'s title/rollup pair already uses: hard right when both
	     fit on one line, flush left on its own line when they don't. -->
	<!-- `holdHeight`: a row that resolves to shorter text keeps
	     its height while the page is open (see `RetainedRows`). -->
	<li class="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-4 py-3.5" use:holdHeight>
		<div class="flex min-w-0 items-start gap-2.5">
			<span class="mt-0.5">
				{#if resolved}
					<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
						<span class="bg-success-solid h-1.5 w-1.5 rounded-full"></span>
					</span>
				{:else}
					<StatusMark state="held" label="Held" />
				{/if}
			</span>
			<div class="min-w-0">
				<!-- ⭐ TL REVIEW (checkout-api staging, 1440 dark): ONE FACT,
				     ONCE. The card's own title ("Held builds") + rollup
				     ("N held · all environments") already say every row
				     here is held — a HELD chip on every single row restated
				     it N times. The row's own facts (the build, the "Needs
				     X · has Y" clause, the env chips) carry it now; no chip
				     at full emphasis. `released` stays: it is a DIFFERENT
				     event (this build stopped being held while the page was
				     open), not a restatement of the card's own fact. -->
				<div class="flex flex-wrap items-center gap-1.5">
					<span class="t-code {resolved ? 'text-fg-muted' : 'text-fg'}">{row.display}</span>
					{#if resolved}
						<!-- Released while this page was open: no contract
						     holds it any more. Neutral, not a success claim —
						     whether it has deployed is the chain's to say. -->
						<Chip role="count" label="released" />
					{/if}
				</div>
				<!-- ⭐ ITEM (d), INTEGRATOR HAND-OFF: NO DANGLING "· has".
				     A literal "· has 1.1" clause after "Needs ^1.2" could
				     start a wrapped line with a bare dot, the same risk the
				     graph's own clause runs were fixed for. Two gap-separated
				     spans instead, carrying the hierarchy on INK alone: the
				     requirement in `fg-muted` (what this row is about),
				     "has X" one step quieter in `fg-subtle` (the provider's
				     own current state, read second). -->
				<p class="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
					{#if resolved}
						<span class="t-meta text-fg-subtle">{row.providerName} no longer holds it</span>
					{:else}
						<span class="t-meta text-fg-muted">
							Needs {row.providerName}
							{#if row.requiredVersion}<span class="t-code-sm">{row.requiredVersion}</span>{/if}
						</span>
						{#if row.providedVersion}
							<span class="t-meta text-fg-subtle">
								has <span class="t-code-sm" title={row.providedVersion}
									>{shortenVersion(row.providedVersion)}</span
								>
							</span>
						{/if}
					{/if}
				</p>
			</div>
		</div>
		<!-- ⛔ ITEM 3 (integrator re-check, round 3): `shrink-0`
		     here meant "never smaller than every chip on one
		     line" in the OUTER `<li>`'s flex row — at 360 three
		     wide env chips (PROD-EU-CENTRAL etc.) measured past
		     the card's own right edge because the div was never
		     allowed to be narrower than its max-content width,
		     even though its OWN `flex-wrap` could have dropped
		     chips to a second line once it had the room to be
		     narrower. `min-w-0` (no `shrink-0`) lets the outer
		     `<li>` push this group onto its own line AND lets it
		     shrink there, so its internal wrap finally gets to
		     run. -->
		<div
			class="flex max-w-full min-w-0 flex-wrap items-center justify-end gap-1.5"
			title={resolved ? 'No longer held — these are the environments it was held in' : undefined}
		>
			{#each row.envs.slice(0, 3) as env (env)}
				<!-- ⛔ A RELEASED ROW'S CHIPS NO LONGER MEAN "HELD IN". (U-31,
				     2026-10-08.) They are muted, not dropped — the set of
				     environments it WAS held in is still useful context for
				     a row the reader is still looking at. -->
				<Chip
					role="env"
					theme={themeFor(env)}
					label={shortEnvLabel(themeFor(env)) || env}
					title={env}
					wide
					class="shrink-0 {resolved ? 'opacity-50' : ''}"
				/>
			{/each}
			{#if row.envs.length > 3}
				<span class="t-meta text-fg-subtle">+{row.envs.length - 3}</span>
			{/if}
		</div>
	</li>
{/snippet}

<!-- batch4 #2: this tab's story is the build the gates are holding, so while one
     is genuinely held HERE the title names the newest held build (`reallyHeldHere[0]`,
     the same array the lead row and the card read), never the running one, and the DEPLOYED chip (the running build's state) is dropped so
     it cannot sit beside a build that is not deployed. Nothing
     held: no override, the shared header keeps the deployed build. Same slot and
     nowrap group as the diff page's `diffTitle`. -->
{#snippet heldTitle()}
	<span class="inline-flex items-baseline gap-x-3 whitespace-nowrap" data-held-title>
		<span class="t-title text-fg-disabled" aria-hidden="true">/</span>
		<span class="t-code-lg text-fg-muted">{reallyHeldHere[0].build}</span>
	</span>
{/snippet}

<svelte:head>
	<!-- ⭐ (2026-10-09, integration round 3, item 4) `pageTitle()` — ONE
	     DOCUMENT-TITLE FORMAT, PRODUCT-WIDE (`page-title.ts`'s own doc
	     comment). This tab and `/dependencies` were the two files left
	     alone when `pageTitle()` landed everywhere else ("owned by other
	     lanes at the time"); this is that follow-up. Same shape History's
	     own tab already uses (`${name} (${namespace}) History`), with
	     `Gates` in place of `History`. -->
	<title
		>{pageTitle(
			rollout?.metadata ? `${rollout.metadata.name} (${rollout.metadata.namespace}) Gates` : 'Gates'
		)}</title
	>
</svelte:head>

<div class="mx-auto w-full">
	{#if gatesOutage.loading}
		<div class="px-4 py-6 sm:px-6">
			<StillTryingNotice failureCount={rolloutQuery.failureCount} />
			<!-- ⭐ A LOADING PLACEHOLDER IN THE PAGE'S OWN SHAPE (final polish
			     round, AD ruling: "a slow cold load must never render blank —
			     caught 2 blank captures"). This used to be two generic,
			     equal-width `CardSkeleton`s with no header at all above them —
			     correct geometry for the CARDS, but the title/build/pill line
			     `RolloutTabHeader` renders once data lands was simply ABSENT
			     during the load, so a slow connection showed a bare pair of
			     boxes under empty space where the name belongs. The header
			     skeleton below matches `RolloutTabHeader`'s own three pieces
			     (name `t-title`, build `t-code-lg`, the state `Chip` — a
			     rounded-full pill) at their real sizes, then the meta line's
			     own width; the Gates card is a canvas-HEIGHT block (not a row
			     list — the real body is a graph, not a list, same rule
			     `CardSkeleton`'s own `bodyHeight` prop exists for); the rail
			     keeps its two cards (`Runs in` / `Depends on this`) in the
			     SAME unconditional 3fr/2fr split the loaded page always uses
			     (see that grid's own comment below) — main stays empty here,
			     exactly as it validly does on a rollout with no contracts. -->
			<div class="mb-6 flex flex-wrap items-baseline gap-x-2 gap-y-1.5">
				<span class="skel-block h-6 w-40" aria-hidden="true"></span>
				<span class="skel-block h-5 w-24" aria-hidden="true"></span>
				<span class="skel-block h-6 w-20 rounded-full" aria-hidden="true"></span>
			</div>
			<div class="-mt-4 mb-4">
				<span class="skel-block block h-3.5 w-32" aria-hidden="true"></span>
			</div>
			<div class="grid gap-4">
				<CardSkeleton titleWidth="w-16" rollupWidth="w-28" bodyHeight={240} />
				<div class="grid gap-4 lg:grid-cols-[3fr_minmax(22rem,2fr)] lg:items-start">
					<div></div>
					<div class="grid min-w-0 content-start gap-4">
						<CardSkeleton
							titleWidth="w-20"
							rollupWidth="w-24"
							rows={4}
							rowHeight={40}
							padded={false}
						/>
						<CardSkeleton
							titleWidth="w-28"
							rollupWidth="w-16"
							rows={2}
							rowHeight={40}
							padded={false}
						/>
					</div>
				</div>
			</div>
		</div>
	{:else if gatesOutage.error}
		<!--
			⛔ WAS THE RAW `Error.message` AND NOTHING ELSE — on a 503 that is the
			string `Request failed (503)`, alone, in a box. This tab's whole subject
			is "what is blocking me / who is blocked on me", so a silent blank here
			says "nothing depends on you", which is the one answer it must never
			invent out of a failure.
		-->
		<!-- ⭐ ITEM 3: THE SAME RAIL AS EVERY OTHER TAB. "Back to this rollout"
		     pointed at the one page that is ALSO unreachable right now — a way
		     out that leads nowhere. Every tab's rail is now Search / Back to
		     all rollouts / Home. No wrapper: `ErrorState` supplies its own
		     rollout-page inset. -->
		<ErrorState
			error={gatesOutage.error}
			subject="the gates of this rollout"
			backHref={href('/rollouts')}
			backLabel="Back to all rollouts"
			onRetry={() => gatesOutage.retry()}
			isRetrying={gatesOutage.isRetrying}
		/>
	{:else if !rollout}
		<!-- ⭐ NOTFOUND (squad-rollout Lane G round 2, coordinator follow-up,
		     2026-10-09): a rollout that does not exist used to fall through to
		     the tab's OWN empty state ("Nothing gates this rollout") under a
		     bare name header — reading as a genuine rollout with nothing
		     holding it, not as a 404. History's own branch (`history/+page.svelte`)
		     is the product's one calm not-found composition; same object, same
		     words, same way out, copied verbatim for this tab.

		     ⭐ ROUND 4, ITEM 10/11 (sr-palette finding, 2026-10-10): `NotFound`
		     renders its OWN `mx-auto w-full px-4 pt-6 pb-10 sm:px-6` wrapper
		     internally — this branch used to sit INSIDE the page's shared
		     `px-4 py-6 sm:px-6` wrapper too, so the padding applied TWICE (and
		     not even identically: `pt-6 pb-10` vs `py-6`), inset 24px off the
		     other branches and off the tab strip above it. The shared wrapper
		     above is now bare (`mx-auto w-full`, no padding of its own); each
		     branch that actually needs the page's padding carries it itself,
		     and this one — needing none, since `NotFound` supplies its own —
		     carries none. -->
		<NotFound
			eyebrow="Rollout"
			title={name}
			headline="This rollout does not exist"
			nextStep="It may have been deleted, or the address may be wrong."
			facts={[
				{ label: 'Rollout', value: `${namespace}/${name}`, handle: true },
				...(cluster ? [{ label: 'Cluster', value: cluster, handle: true }] : []),
				{ label: 'Server answered', value: 'not found' }
			]}
			backHref={href('/rollouts')}
			backLabel="Back to all rollouts"
		/>
	{:else}
		<div class="px-4 py-6 sm:px-6">
			<!--
				REFERENCE REGION: `PageHeader` object form, the exact component and
				slot shape the Overview/History tabs already open with
				(`title`/`titleAfter`) — this tab is the same object, so it gets
				the same head rather than a second dialect.

				⛔ THE ENV CHIP IS GONE FROM THIS SLOT. (Design language §3.2.)
				"Every rollout tab (Overview, History, Logs) opens with the same
				header — the name, no env chip (the breadcrumb names the
				environment) — so a tab switch never moves the title." This tab
				drew its own chip here; History/Logs never did.

				⛔ NO `summary` EITHER. (TL review, checkout-api staging 1440
				dark.) Overview/History/Logs open with the name alone — a
				summary sentence here made this the one tab whose title line
				grew on switch. The bespoke per-shape `lede` sentence that
				used to sit here (2026-10-09, squad-rollout spec §3) moved to
				the Gates card's own lead row, as the SHARED held-truth
				sentence `blockingStory()` already produces for the
				Overview's banner — see that row's own comment below.

				⭐ A `meta` SNIPPET (squad-rollout spec §3, revised in the
				final polish round, AD ruling — "drop the duplicate '2 of 2
				gates holding': keep it in the card rollup and remove it
				from the page meta"): this used to ALSO restate "N of M
				gates holding" / "M gates · all passing" here, one line
				above the identical fact in the Gates card's own rollup —
				the two sat close enough together to read as a typo, not an
				intentional repeat. The header meta now states only "N wait
				here" (`holdBreakdown.held.length`, this rollout's own
				scope — unchanged from before), the ONE fact that is not
				ALSO the card rollup's own headline number. A calm rollout
				(nothing held) spends no hue AND no space here — same as
				every other tab's meta row when it has nothing adverse to
				say.

				⭐ "GATE", NOT "RULE" (coordinator correction, 2026-10-09):
				the tab is named "Gates" by owner decision (2026-10-08), and
				`vocabulary.test.ts`'s "gate / gates (obstacle)" rule
				allowlists this tab's own copy for exactly that reason — see
				the allowlist entries added alongside this text. `rule` stays
				the word everywhere else the scanner enforces it (the Held
				banner's own disclosure trigger, etc.); this tab is the one
				named exception.
			-->
			<RolloutTabHeader
				{name}
				{rollout}
				quietRollback
				subtitleOnPhone={false}
				titleAfter={reallyHeldHere.length > 0 ? heldTitle : undefined}
				chip={reallyHeldHere.length > 0 ? null : undefined}
			>
				{#snippet meta()}
					<!-- ⭐ ONE GATE FACT, ONE COUNT SOURCE (rollout-tabs gates2,
					     2026-10-25; the sr-gates2 line the coordinator ruled on
					     2026-10-11, recovered). Worst-first: "N of M gates failing"
					     / "N of M gates holding" / "N gates"; `realGateTotal` is the
					     denominator (a chain predecessor is never a gate), so this
					     line, the phone line and the Neighbourhood card's rollup
					     print the same number. ONE line per width: the same span
					     serves phone and lg+ (History's pattern: fact in ink, age
					     in fg-subtle). No gates: no fact (the card says "0 gates"). -->
					{#if gateFactNow}
						<span
							class="tabular-nums {gateFactNow.tone === 'danger'
								? 'text-danger'
								: gateFactNow.tone === 'held'
									? 'text-held'
									: 'text-fg'}"
							data-gate-fact>{gateFactNow.text}</span
						>
					{:else if focusWaitsFor}
						<span class="t-ui-sm text-fg-subtle lg:hidden">{focusWaitsFor}</span>
					{/if}
					<!-- The age: always at lg+; on the phone only when it is the line's
					     only fact (r11, item 5). -->
					{#if rollout?.status?.history?.[0]?.timestamp}
						<span
							class="text-fg-muted tabular-nums {gateFactNow || focusWaitsFor
								? 'max-lg:hidden'
								: ''}">{formatTimeAgoCompact(rollout.status.history[0].timestamp, $now)} ago</span
						>
					{/if}
				{/snippet}
			</RolloutTabHeader>

			{#if !hasChain && !hasContracts && !hasDependents && hood.total === 0}
				<!-- ⛔ THE EMPTY STATE IS DELIBERATE AND IT IS ONE SENTENCE. Most
				     rollouts hold nobody and are held by nothing. It is a GENUINE
				     empty state now, not an unreachable one — U-32(a) widened the
				     tab's `show:` predicate (`hasEnvironment || hasDependencies ||
				     hasOwnGates`, the layout's own) to include a rollout whose only
				     gate is its own health check selector, so a rollout with health
				     checks that are all currently passing lands exactly here.

				     REFERENCE REGION: §3.15 empty anatomy, INSIDE the `Card` that
				     would hold the content (the graph card below, when there is
				     something to draw) — 20px outline icon in `fg-disabled`, a
				     `t-ui` one-line headline, `t-meta` next-step line. Replaces the
				     bare `rounded-xl` box with no icon and no card header. -->
				<Card icon={ShareNodesOutline} title="Gates" padded={false} class="min-w-0">
					<!-- ⭐ "NO GATES", LEFT-ALIGNED, §3.15 (squad-rollout Lane G round
					     2, item 4): this tab's own vocabulary is "gate" (the
					     allowlisted exception above) — the generic-anatomy word this
					     empty state used to borrow ("Nothing gates this rollout")
					     still works as a sentence but read like the tab had changed
					     its mind about its own noun from one card to the next. Same
					     left-aligned §3.15 shape as the calm/no-gates card below, a
					     next-step sentence that defines the word for a first-time
					     reader, and a docs link out. -->
					<div class="flex flex-col items-start gap-2 px-4 py-8 text-left">
						<ShareNodesOutline class="text-fg-disabled h-5 w-5" aria-hidden="true" />
						<p class="t-ui text-fg">No gates on this rollout</p>
						<p class="t-meta text-fg-subtle max-w-md">
							{#if rollout?.spec?.healthCheckSelector && healthQuiet === 'failing'}
								A health check is failing, but there is no newer build for it to hold back.
							{:else if rollout?.spec?.healthCheckSelector && healthQuiet === 'pending'}
								A health check is still pending, but there is no newer build for it to hold back.
							{:else if rollout?.spec?.healthCheckSelector && healthQuiet === 'unknown'}
								{#if healthChecksQuery.isError}{HEALTH_CHECKS_UNAVAILABLE.sentence}{/if}
							{:else if rollout?.spec?.healthCheckSelector}
								Its health checks are passing.
							{:else}
								A gate — an approval, a deploy window, a dependency or a health check — holds a
								build until its rule passes.
							{/if}
						</p>
						<a
							href="https://docs.kuberik.com/concepts/gates"
							target="_blank"
							rel="noreferrer"
							class="nav-link t-ui-sm">Learn about gates ›</a
						>
					</div>
				</Card>
			{:else}
				<div class="grid gap-4">
					<!-- ══ THE GRAPH — the tab's centrepiece, full width above the
				     cards. Same Card shell and title as `/dependencies`' own graph
				     card (47px header, share-nodes), so the two read as one object
				     at two scales. 2026-10-08: this card now draws EVERY kind of
				     gate on this rollout, not only its rollout-to-rollout edges — a
				     deploy window or an approval with no rollout on the far end
				     renders as a box in the same column (`rollout-gates.ts`,
				     `RolloutNeighbourhood.svelte`'s own "new by design" note). The
				     cards below are APP-wide (every environment of this app); the
				     graph is THIS rollout's own gates, which is why both earn their
				     place. ══ -->
					{#if listQuery.isLoading}
						<CardSkeleton titleWidth="w-36" rollupWidth="w-28" bodyHeight={176} />
					{:else if hood.focus && hood.total > 0}
						<Card
							icon={ShareNodesOutline}
							title="Gates"
							dataTour="dependency-graph"
							class="min-w-0"
						>
							{#snippet rollup()}
								<!-- Card headers stay 47px at every width (§3.4). Below Card's
							     own 560px CARD-width threshold (`.card-cq`, the same one
							     `verdictCompact` toggles on at — see Card.svelte) the full
							     clause + the "All dependencies" link no longer share a
							     line with the title — a COMPACT count takes over and the
							     link drops. A CARD-width container query, not a viewport
							     breakpoint: this card can be narrower than the viewport
							     (a rail, a grid cell) just as easily as it can be the
							     viewport itself, and `verdictCompact` next door already
							     answers to the card, not the window. Hand-rolled (not
							     Card's own `.card-header-verdict--full/--compact`,
							     Svelte-scoped to Card.svelte and unreachable from here)
							     at the same 559.98px threshold, in this file's own
							     `<style>` below. -->
								<!-- ⭐ "GATE" HERE, PER THE COORDINATOR (2026-10-09): the tab is
							     named Gates by owner decision and the vocabulary rule
							     allowlists this tab's copy. Fixed back from "rule" — an
							     earlier pass here mistook the generic product-wide noun
							     for a blanket rule instead of checking the allowlist. -->
								<!-- ⭐ qa11b: "N of M" ONLY WHEN THEY DIFFER. `realGateTotal`
							     already excludes a chain predecessor from the count — if
							     every real gate IS holding, naming the same number twice
							     ("1 of 1 holding") is noise `heldBuildsVerdict`'s own
							     "drop zero parts" rule would never allow either; it
							     collapses to the plain count. -->
								<span
									class="t-ui-sm whitespace-nowrap {reconciledHolding > 0
										? 'text-held'
										: 'text-fg-subtle'}"
									title={reconciledHolding > 0
										? 'Gates on this rollout, or into/out of it, that are holding a build right now'
										: 'No gate on this rollout is holding a build'}
								>
									<span class="gates-rollup-compact"
										>{reconciledHolding > 0
											? reconciledHolding === realGateTotal
												? `${reconciledHolding} holding`
												: `${reconciledHolding} of ${realGateTotal} holding`
											: `${realGateTotal} gates`}</span
									>
									<span class="gates-rollup-full"
										>{reconciledHolding > 0
											? reconciledHolding === realGateTotal
												? `${reconciledHolding} gate${reconciledHolding === 1 ? '' : 's'} holding`
												: `${reconciledHolding} of ${realGateTotal} gate${realGateTotal === 1 ? '' : 's'} holding`
											: `${realGateTotal} gate${realGateTotal === 1 ? '' : 's'}, none holding`}</span
									>
								</span>
								<a
									href={href('/dependencies')}
									class="nav-link t-ui-sm gates-rollup-full shrink-0 !py-0 whitespace-nowrap"
									>All dependencies ›</a
								>
							{/snippet}
							<!-- ══ LEAD ROW — the held truth, PER BUILD, never a new fact.
						     (squad-rollout spec §3, "fixed behaviour"; corrected
						     2026-10-09 — see `holdBreakdown`'s own doc comment in the
						     script for the full account of why this reads
						     `holdBreakdown`, not `blockStory.blocked`, directly.)
						     `promotionHoldBreakdown` names the SAME build ids and gate
						     clauses the Overview's "Newer builds" rows and the Change
						     Version dialog already read off `blockingGateNames` — so
						     this sentence cannot disagree with either. When EVERY
						     candidate is held it is `blockingStory`'s own
						     headline/consequence, verbatim (the one case a banner and
						     this row make the identical claim); when only SOME are,
						     it names those builds and the ones that can still deploy,
						     composed from nothing this breakdown does not itself list.
						     `kindPending` withholds the same way `BlockingStoryPanel`
						     does (a skeleton line, not a possibly-wrong claim). Calm
						     case: this card's own sentence, "gate(s)" per the
						     coordinator (the tab's own allowlisted exception — see the
						     header meta's identical note above). ══ -->
							<!-- ⭐ THE BANNER'S OWN TWO LEVELS (squad-rollout Lane G round 4,
						     item 5, AD ruling): the headline line `t-card-title` (14/600,
						     held ink) and the consequence `t-body` (14/400, `fg-muted`) —
						     the SAME two registers `BlockingStoryPanel`'s own banner uses
						     for this exact sentence, not a single undifferentiated
						     paragraph. The words themselves are unchanged (still
						     `blockingStory`'s own, or composed from `holdBreakdown` — see
						     the comment above). -->
							<!-- ⭐ TIGHTENED AT 390 (squad-rollout Lane G round 6 nit, AD
						     ruling: "the focus tile's held line sits above the fold").
						     `py-2.5`/`mb-2` at narrow (desktop keeps its own `py-3`/
						     `mb-3` — unchanged, this is a phone-only saving) frees
						     ~12px so the focus tile's own held line lands inside the
						     first screen more often. -->
							<div class="border-line-subtle -mx-4 -mt-4 mb-2 border-b px-4 py-2.5 sm:mb-3 sm:py-3">
								{#if holdBreakdown.anyHeld && leadSentence}
									{#if blockStory.kindPending}
										<SkeletonBar width="w-72" height="h-3.5" />
									{:else}
										<!-- ⭐ ONE PUNCTUATION RULE (squad-rollout Lane G, final polish,
									     AD ruling, D3): match the Overview's own banner
									     (`AlertPanel`'s `title`, `BlockingStoryPanel`'s own
									     doc comment) — the headline/title NEVER carries a
									     trailing period (`blockingStory`'s own `headline`
									     strings are built without one); only `consequence`
									     carries its own sentence punctuation, as written. This
									     used to append "." here, so the IDENTICAL sentence read
									     with a period on the Gates tab and without one on the
									     Overview, one tab apart. -->
										<!-- ⭐ qa11b: NEUTRAL INK FOR A CHAIN WAIT, NEVER AMBER
									     (squad-rollout gates-2 follow-up, 2026-10-11) —
									     `leadSentence.tone` names which. A chain-only lead
									     ("Waits for staging") is not a hold. -->
										<p
											class="t-card-title {leadSentence.tone === 'held'
												? 'text-held'
												: 'text-fg-subtle'}"
										>
											{leadSentence.headline}
										</p>
										<p class="t-body text-fg-muted mt-0.5">{leadSentence.consequence}</p>
									{/if}
								{:else if (reconciledHolding > 0 || gateFactNow?.tone === 'danger') && gateFactNow}
									<!-- A health or downstream hold `holdBreakdown` does not see:
									     state the header's own fact, never "Nothing is holding". -->
									<p class="t-body text-fg-muted">{gateFactNow.text}.</p>
								{:else}
									<p class="t-body text-fg-muted">
										Nothing is holding this rollout. {realGateTotal}
										{realGateTotal === 1 ? 'gate' : 'gates'} pass.
									</p>
								{/if}
							</div>
							<RolloutNeighbourhood
								{hood}
								themeOf={themeFor}
								hrefOf={(n) => rolloutPath(n.cluster || cluster, n.namespace, n.name, 'gates')}
								heldBuildsOverride={reallyHeldHere.map((h) => h.build)}
								reconciledUpstream={reconciled.upstream}
								elsewhereCountOverride={elsewhereCounts}
								{peerHeldByEnv}
								{focusWaitsFor}
								chainWait={waitsForFact?.wave ? { stage: waitsForFact.stage, text: waitsForFact.wave } : null}
							/>
						</Card>
					{:else if hood.focus}
						<!-- ⭐ U-32(a), 2026-10-08 (polish pass): THIS ROLLOUT QUALIFIES
					     FOR THE TAB BUT HAS NOTHING TO DRAW RIGHT NOW — the widened
					     tab predicate (health selector / `DeploymentBlocked`) means
					     a rollout can land here with zero edges and zero gate boxes
					     (health is passing, nothing else gates it). The graph card
					     itself still shows nothing was skipped — reusing `Card`'s
					     own shell rather than rendering no card at all, which on a
					     page with a "Runs in"/"Depends on this" rail beside it would
					     read as the tab having silently dropped the one thing it is
					     named for. -->
						<!-- Same §3.15 empty anatomy as the tab's own top-level empty state
					     — this is that state's CARD-scale twin (something else on
					     this rollout earns the rail beside it, so the graph still
					     needs its own card rather than disappearing). -->
						<!-- ⭐ "NO GATES", LEFT-ALIGNED, §3.15 (squad-rollout Lane G round
					     2, item 4) — this is the exact card the reviewer screenshotted
					     live on `payments-core-prod-us-east`: a big box with one
					     centred line and no next step. Same anatomy as the tab's own
					     top-level empty state above: icon, `t-ui` headline, a `t-meta`
					     next-step sentence that defines the word "gate" even when
					     nothing else on the page needs to (THIS branch is reached
					     with no health selector at all, so it used to fall through to
					     an empty `<p>` and show nothing but the headline — exactly
					     the "big empty box" complaint). -->
						<Card icon={ShareNodesOutline} title="Gates" padded={false} class="min-w-0">
							<div class="flex flex-col items-start gap-2 px-4 py-6 text-left">
								<ShareNodesOutline class="text-fg-disabled h-5 w-5" aria-hidden="true" />
								<p class="t-ui text-fg">No gates on this rollout</p>
								<p class="t-meta text-fg-subtle max-w-md">
									{#if rollout?.spec?.healthCheckSelector && healthQuiet === 'failing'}
										A health check is failing, but there is no newer build for it to hold back.
									{:else if rollout?.spec?.healthCheckSelector && healthQuiet === 'pending'}
										A health check is still pending, but there is no newer build for it to hold
										back.
									{:else if rollout?.spec?.healthCheckSelector && healthQuiet === 'unknown'}
										{#if healthChecksQuery.isError}{HEALTH_CHECKS_UNAVAILABLE.sentence}{/if}
									{:else if rollout?.spec?.healthCheckSelector}
										Its health checks are passing.
									{:else}
										A gate — an approval, a deploy window, a dependency or a health check — holds a
										build until its rule passes.
									{/if}
								</p>
								<a
									href="https://docs.kuberik.com/concepts/gates"
									target="_blank"
									rel="noreferrer"
									class="nav-link t-ui-sm">Learn about gates ›</a
								>
							</div>
						</Card>
					{/if}
					<!-- ══ MAIN HOLDS WHAT HAS TO MOVE; THE RAIL HOLDS WHERE THINGS
				     ARE — the Overview tab's own split, same tracks, ALWAYS
				     (squad-rollout Lane G round 5, AD ruling: "one grid with or
				     without gates"). This used to drop the `lg:grid-cols-[…]`
				     class entirely when the main column was empty, so the rail
				     fell back to a full-width row and its own inner grid split
				     it 2-up (564+451 → 564+563) — a SECOND geometry for the
				     identical rail cards, one scroll position apart from the
				     Overview's own rail at its one true width. The split is now
				     unconditional; the main column is sometimes empty inside it,
				     never a different grid. ══ -->
					<div class="grid gap-4 lg:grid-cols-[3fr_minmax(22rem,2fr)] lg:items-start">
						<!-- ⭐ ROUND 6, ITEM 1 (AD ruling): "the rail ALWAYS holds Runs in
					     + Depends on, and main ALWAYS holds Held builds [when
					     anything is held]." Main used to be gated on `hasContracts`
					     alone — a rollout held purely by an APPROVAL or deploy-window
					     gate (no `RolloutDependency` at all, e.g. telemetry-indexer)
					     had NO main column whatsoever, so the SAME "Held builds" card
					     every other held rollout gets was simply missing, and the
					     main+rail grid (unconditional since round 5) held a card on
					     one side and nothing on the other — never the same width twice
					     for the identical rail. `hasMainContent` is `hasContracts`
					     (for "Waiting on") OR `holdBreakdown.held.length > 0` (for
					     "Held builds", gate-only holds included) — the two cards below
					     each still gate themselves independently; this only decides
					     whether the MAIN COLUMN renders at all. -->
						{#if hasContracts || holdBreakdown.held.length > 0}
							<div class="grid min-w-0 content-start gap-4">
								{#if holdBreakdown.held.length > 0 || heldOtherShown.length > 0}
									<!-- CARD 1 — "Held builds". A hold is not an alert; the
								     count lives here, in the same muted style the
								     reference page's "N events" already uses. -->
									<Card
										icon={HeldGlyph}
										title="Held builds"
										verdict={heldBuildsVerdict}
										verdictTone={heldHereCount > 0 || heldOtherCount > 0 ? 'held' : 'neutral'}
										verdictTitle="Builds of this app that are currently held — THIS rollout's own count first, then the rest of the app"
										padded={false}
										dataTour="builds-held"
										class="min-w-0"
									>
										<!-- ⭐ "HELD HERE", "WAITING FOR `<stage>`", THEN "OTHER
									     ENVIRONMENTS" (squad-rollout Lane G round 2, item 2;
									     round 3, item 4; corrected qa11b item 2, 2026-10-11).
									     THREE groups, never a blended "Here" list again: a
									     chain-queued candidate is not held here, so it cannot
									     share a count with one that genuinely is. `reallyHeldHere`/
									     `chainOnlyHere` is the exact same split the header meta,
									     the rollup (`heldBuildsVerdict`) and the focus-node
									     override all read — the three cannot disagree about which
									     builds belong to which group again. Same 28px
									     `t-label`/`bg-subtle` subheader the deploy ledger's own
									     day groups use (`history/+page.svelte`). A group with no
									     rows is skipped outright; when only ONE of the three has
									     rows there is nothing to disambiguate, so no subheader is
									     drawn at all (the lone group's own `Card` title already
									     says what the list is). -->
										{@const groupCount =
											(reallyHeldHere.length > 0 ? 1 : 0) +
											(chainOnlyHere.length > 0 ? 1 : 0) +
											(heldOtherShown.length > 0 ? 1 : 0)}
										{#if groupCount > 1}
											{#if reallyHeldHere.length > 0}
												<div class="bg-subtle flex items-center justify-between px-4 py-1.5">
													<span class="t-label text-fg-subtle">Held here</span>
													<span class="t-meta text-fg-subtle tabular-nums"
														>{reallyHeldHere.length}</span
													>
												</div>
												<ul class="divide-line-subtle divide-y">
													{#each reallyHeldHere as h (h.tag || h.build)}
														{@render hereHeldRow(h)}
													{/each}
												</ul>
											{/if}
											{#if chainOnlyHere.length > 0}
												<div class="bg-subtle flex items-center justify-between px-4 py-1.5">
													<span class="t-label text-fg-subtle">{waitingGroupLabel}</span>
													<span class="t-meta text-fg-subtle tabular-nums"
														>{chainOnlyHere.length}</span
													>
												</div>
												<ul class="divide-line-subtle divide-y">
													{#each chainOnlyHere as h (h.tag || h.build)}
														{@render hereHeldRow(h)}
													{/each}
												</ul>
											{/if}
											{#if skippedHere.length > 0}
												<div class="bg-subtle flex items-center justify-between px-4 py-1.5">
													<span class="t-label text-fg-subtle">Skipped by {skippedStage}</span>
													<span class="t-meta text-fg-subtle tabular-nums">{skippedHere.length}</span>
												</div>
												<ul class="divide-line-subtle divide-y">
													{#each skippedHere as h (h.tag || h.build)}
														{@render hereHeldRow(h)}
													{/each}
												</ul>
											{/if}
											{#if heldOtherShown.length > 0}
												<div class="bg-subtle flex items-center justify-between px-4 py-1.5">
													<span class="t-label text-fg-subtle">Other environments</span>
													<span class="t-meta text-fg-subtle tabular-nums"
														>{heldOtherShown.length}</span
													>
												</div>
												<ul class="divide-line-subtle divide-y">
													{#each heldOtherShown as { row, resolved } (row.key)}
														{@render heldRow(row, resolved)}
													{/each}
												</ul>
											{/if}
										{:else if reallyHeldHere.length > 0}
											<ul class="divide-line-subtle divide-y">
												{#each reallyHeldHere as h (h.tag || h.build)}
													{@render hereHeldRow(h)}
												{/each}
											</ul>
										{:else if chainOnlyHere.length > 0}
											<ul class="divide-line-subtle divide-y">
												{#each chainOnlyHere as h (h.tag || h.build)}
													{@render hereHeldRow(h)}
												{/each}
											</ul>
										{:else}
											<ul class="divide-line-subtle divide-y">
												{#each heldOtherShown as { row, resolved } (row.key)}
													{@render heldRow(row, resolved)}
												{/each}
											</ul>
										{/if}
									</Card>
								{/if}

								<!-- CARD 2 — "Waiting on". One row per upstream service,
							     regardless of whether it is currently holding anything —
							     the "up to date" row is what proves the page looked.
							     ⭐ ROUND 4, ITEM 8 (AD ruling): its own icon (`ClockOutline`
							     — "waiting" is this card's own idea, not the graph's
							     `ShareNodesOutline` the "Gates" card already owns) and a
							     leading status column (item 8's "status column on
							     Waiting on, not Runs in" — this card HAS real per-row
							     states; `Runs in` below does not, see that card's own
							     note). -->
								{#if hasContracts}
									<Card
										icon={ClockOutline}
										title="Waiting on"
										verdict={heldProviders.length > 0
											? `${heldProviders.length} of ${providerCount} holding`
											: `${providerCount} service${providerCount === 1 ? '' : 's'}`}
										verdictTone={heldProviders.length > 0 ? 'held' : 'neutral'}
										verdictTitle={heldProviders.length > 0
											? `${heldProviders.join(', ')} will not let a newer build of this app deploy`
											: 'No service this app waits on is holding a build'}
										padded={false}
										dataTour="waiting-on"
										class="min-w-0"
									>
										<ul class="divide-line-subtle divide-y">
											{#each blocks as b (b.key)}
												{@const needs = ownRequires(b.contract)}
												<!-- ⭐ A NEUTRAL GLYPH WHEN NOTHING IS HELD *HERE* (round 6,
										     item 4; final polish round, D1, AD ruling). `b.adverse`
										     is true the moment this provider holds ANY build of this
										     app, anywhere — a row for a provider holding only in
										     OTHER environments used to draw the full `held` ring, the
										     same loud mark as a provider holding THIS environment's
										     own build; round 6 quieted that to `newest` (a filled
										     green dot) but D1 caught that green still reads as "all
										     good" for a row that IS adverse elsewhere — `none`
										     (`EmptyGlyph`, a hollow dashed ring, no hue at all) is the
										     actually-neutral mark, for a "not holding" row too. -->
												{@const scope = providerScope.get(b.providerName)}
												<!-- Same `justify-between`, no-`flex-1` mechanism as the "Held
										     builds" rows above — see that row's own comment.
										     ⭐ FLEX-COL AT NARROW (final polish round, D1): the
										     trailing scope span used to be a sibling of the
										     glyph+text block, so when it wrapped onto its own line
										     (a long "holding N here · M elsewhere" at 390) it started
										     at the ROW's own left edge, under the GLYPH — not under
										     the text it belongs with. `flex-col` stacks it as a true
										     third line at narrow with the SAME left inset the text
										     column has (`pl-[26px]`, the glyph's 16px + the `gap-2.5`
										     10px beside it); `sm:flex-row` restores the original
										     trailing, right-aligned, un-indented layout at the width
										     this row actually has room for it. -->
												<li
													class="flex flex-col gap-1 px-4 py-3.5 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-x-3 sm:gap-y-1"
													use:holdHeight
												>
													<div class="flex min-w-0 items-start gap-2.5">
														<span class="mt-0.5"
															><StatusMark
																state={scope && scope.here > 0 ? 'held' : 'none'}
															/></span
														>
														<div class="min-w-0">
															{#if providerResolved(b)}
																<a
																	href={providerHref(b)}
																	class="tap-link text-fg inline-flex min-w-0 items-center gap-1.5"
																	title="Open the {b.providerName} rollout"
																>
																	<span class="t-card-title min-w-0 truncate">{b.providerName}</span
																	>
																	<ArrowUpRightFromSquareOutline
																		class="text-fg-subtle h-3 w-3 shrink-0"
																		aria-hidden="true"
																	/>
																</a>
															{:else}
																<!-- No Rollout this dashboard knows about answers to
												     {b.providerNamespace}/{b.providerName} — text, never a
												     dead link (qa11, 2026-10-11). -->
																<span
																	class="text-fg inline-flex min-w-0 items-center gap-1.5"
																	title="{b.providerName} is not on this dashboard"
																>
																	<span class="t-card-title min-w-0 truncate">{b.providerName}</span
																	>
																</span>
															{/if}
															<!-- ⭐ ITEM (e), INTEGRATOR HAND-OFF: ONE CLAUSE GRAMMAR FOR
												     EVERY GATE-CLAUSE LIST ON THIS TAB — see the graph's own
												     `clauseRuns`/`gateBoxRuns` note. Gap-separated spans, no
												     literal "·": the version/namespace clause in `fg-muted`
												     (what this row states), "needs X" one step quieter in
												     `fg-subtle` (the ask), never weight. -->
															<p
																class="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5"
															>
																{#if b.providedVaries}
																	<span class="t-meta text-fg-subtle"
																		>Each environment waits on its own copy of {b.providerName}.</span
																	>
																{:else}
																	<span class="t-meta text-fg-muted">
																		{#if b.providedVersion}<span title={b.providedVersion}
																				>{shortenVersion(b.providedVersion)}</span
																			>{:else}no version reported yet{/if} in
																		{b.providerNamespace}
																	</span>
																	{#if needs}
																		<span class="t-meta text-fg-subtle">
																			needs <span class="t-code-sm">{needs}</span>
																		</span>
																	{/if}
																{/if}
															</p>
														</div>
													</div>
													<!-- Adverse (held) is the only state that spends hue — a
											     service that is not holding anything is the norm and
											     reads as quiet text, not a repeated green chip.
											     ⭐ SCOPED (round 5, item A): "holding N here · M
											     elsewhere", the SAME split the canvas's own tile for
											     this provider now states — see `scopeLabel`'s own
											     comment. -->
													<span
														class="t-meta shrink-0 pl-[26px] sm:pl-0 {b.adverse
															? 'text-held'
															: 'text-fg-subtle'}"
													>
														{#if b.adverse}
															{scopeLabel(b.providerName, b.blocked.length)}
														{:else}
															not holding
														{/if}
													</span>
												</li>
											{/each}
										</ul>
									</Card>
								{/if}
							</div>
						{/if}

						<!-- RAIL — the column that holds LOCATORS: where things are,
					     not what to do. Same role the reference page's rail plays
					     for External Links / Health Checks / Resources. Always
					     single-column now (round 5): the OUTER grid confines it to
					     the `minmax(22rem,2fr)` track unconditionally (see that
					     grid's own comment above), so a 2-up inner split would
					     cram two cards into one already-narrow rail. -->
						<div class="grid min-w-0 content-start gap-4">
							{#if hasChain}
								<!-- CARD 3 — "Runs in". The vertical chain of nodes the old
							     network graph drew is this: one row per environment, a
							     chip and the version it runs. -->
								<Card icon={ServerOutline} title="Runs in" padded={false} class="min-w-0">
									{#snippet rollup()}
										<UpToDate
											rollup
											onHead={chainRollup.onHead}
											deployed={chainRollup.deployed}
											total={chainRollup.total}
											spread={chainRollup.spread}
											pending={chainRollup.pending}
											unknown={chainRollup.unknown}
											caption=""
											title="Environments of this app that are on its newest version"
										/>
									{/snippet}
									<ul class="divide-line-subtle divide-y">
										{#each chainRows as r (r.env)}
											{@const theme = themeFor(r.env)}
											{@const rowHref = hrefFor(r.env)}
											{@const waveFact = chainWaveFact(r, topology)}
											<!-- ⭐ THE LEADING 16px STATUS COLUMN (squad-rollout Lane G
										     round 2, item 5; round 4, item 8, AD ruling). Round 2 put
										     a `StatusMark` here on every row, which read as 7 identical
										     green dots with no row standing out as THIS one. Round 4:
										     "Runs in marks the current env (2px fg square marker, the
										     selected-row grammar), with a rest dot only for 'on the
										     newest'." Round 6 nit: that marker is now the PRODUCT'S
										     established selected-row grammar verbatim
										     (`LogsViewer.svelte`'s own "All pods" marker, coordinator
										     review 2026-10-09 — "the 2px square marker at the row's
										     left edge, flush, not an inset bar"): a `border-l-2`,
										     transparent at rest so every row's text starts at the
										     same x, `border-l-fg` on the one row that IS this
										     environment. `rowHref` is `undefined` for exactly that row
										     (`hrefFor`'s own rule — "the environment this page IS gets
										     no link"), so the two branches below already split on the
										     same fact this marker needs. -->
											<li>
												{#if rowHref}
													<a
														href={rowHref}
														class="hover:bg-hover flex items-center gap-3 border-l-2 border-l-transparent py-2.5 pr-4 pl-3.5 max-sm:flex-wrap max-sm:gap-y-0.5"
													>
														<span
															class="inline-flex h-4 w-4 shrink-0 items-center justify-center"
															aria-hidden="true"
														>
															{#if r.rank === 0}<span
																	class="bg-success-solid h-1.5 w-1.5 rounded-full"
																></span>{/if}
														</span>
														<Chip
															role="env"
															{theme}
															label={shortEnvLabel(theme) || r.env}
															title={r.env}
															wide
															class="shrink-0"
														/>
														{#if waveFact}<span class="t-meta text-fg-subtle min-w-0 truncate max-sm:order-last max-sm:basis-full max-sm:pl-7" data-place-wave><span class="max-sm:hidden">· </span>{waveFact}</span>{/if}
														<span class="ml-auto flex min-w-0 shrink-0 items-baseline gap-2">
															<span class="t-code-sm text-fg-muted min-w-0 truncate"
																>{r.display ?? '—'}</span
															>
															{#if r.tag && r.rank >= 0}
																<span class="t-meta text-fg-subtle whitespace-nowrap"
																	>{r.rank === 0 ? 'on the newest' : `${r.rank} behind`}</span
																>
															{/if}
														</span>
													</a>
												{:else}
													<!-- ⭐ THE "this rollout" MARKER, LABELLED (squad-rollout
												     Lane G round 5, AD ruling, round 6 nit fix): a `border-
												     l-2 border-l-fg` flush with the row's OWN left edge —
												     the product's established selected-row grammar (see
												     this block's own comment above) — not a centred 6px
												     dot in a 16px slot. `sr-only` text carries the
												     accessible name the border alone cannot; the visible
												     `t-meta` "this rollout" on the row's own right side, in
												     place of the rank/version note (rank is meaningless for
												     the row that IS the subject — it cannot be "N behind"
												     itself). -->
													<div
														class="border-l-fg flex items-center gap-3 border-l-2 py-2.5 pr-4 pl-3.5 max-sm:flex-wrap max-sm:gap-y-0.5"
													>
														<span class="sr-only">this rollout</span>
														<Chip
															role="env"
															{theme}
															label={shortEnvLabel(theme) || r.env}
															title={r.env}
															wide
															class="shrink-0"
														/>
														{#if waveFact}<span class="t-meta text-fg-subtle min-w-0 truncate max-sm:order-last max-sm:basis-full max-sm:pl-7" data-place-wave><span class="max-sm:hidden">· </span>{waveFact}</span>{/if}
														<span class="ml-auto flex min-w-0 shrink-0 items-baseline gap-2">
															<span class="t-code-sm text-fg-muted min-w-0 truncate"
																>{r.display ?? '—'}</span
															>
															<span class="t-meta text-fg-subtle whitespace-nowrap"
																>this rollout</span
															>
														</span>
													</div>
												{/if}
											</li>
										{/each}
									</ul>
								</Card>
							{/if}

							<!-- CARD 4 — "Depends on this". Always present — its own
						     quiet line is what says the page looked and found
						     nothing, the same idiom `EventsCard`'s "No recent
						     events" already uses. The full graph moved entirely to
						     `/dependencies`; this is the one-line pointer to it. -->
							<Card
								icon={CodeForkOutline}
								title="Depends on this"
								verdict={downstreamRows.length > 0
									? `${downstreamRows.length} service${downstreamRows.length === 1 ? '' : 's'}`
									: null}
								verdictTitle="Services, in any environment of this app, that wait on a contract it provides"
								padded={false}
								class="min-w-0"
							>
								{#if downstreamRows.length === 0}
									<p class="t-meta text-fg-subtle px-4 py-3">No other service waits on this app.</p>
								{:else}
									<ul class="divide-line-subtle divide-y">
										{#each downstreamRows as d (d.name)}
											<!-- Same leading status column as "Runs in" above — item 5's
										     anatomy applies to both rail cards; `held` ink only on the
										     mark itself when this row is adverse, since colour is the
										     one thing that may vary with state here. -->
											<li class="flex items-center gap-3 px-4 py-2.5">
												<StatusMark state={d.adverse ? 'held' : 'newest'} />
												{#if d.href}
													<a
														href={d.href}
														class="tap-link text-fg inline-flex min-w-0 items-center gap-1.5"
														title="Open {d.name} and see this same relation from its side"
													>
														<span class="t-card-title min-w-0 truncate">{d.name}</span>
													</a>
												{:else}
													<span class="t-card-title text-fg min-w-0 truncate">{d.name}</span>
												{/if}
												{#if d.running}
													<span class="t-code-sm text-fg-subtle shrink-0">{d.running}</span>
												{/if}
												<!-- Adverse (waiting) is the only state that spends hue —
											     see the "Waiting on" card's identical note above. -->
												<span
													class="t-meta ml-auto shrink-0 {d.adverse
														? 'text-held'
														: 'text-fg-subtle'}"
												>
													{d.adverse ? 'waiting' : 'ok'}
												</span>
											</li>
										{/each}
									</ul>
								{/if}
							</Card>
						</div>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* The Gates card's rollup, full/compact — same 559.98px CARD-width
	   threshold as `Card`'s own `verdictCompact` toggle (Card.svelte),
	   evaluated against the same `.card-cq` container-type ancestor this
	   rollup renders inside. See the snippet's own comment above. */
	.gates-rollup-full {
		min-width: 0;
	}
	.gates-rollup-compact {
		display: none;
	}
	@container (max-width: 559.98px) {
		.gates-rollup-full {
			display: none;
		}
		.gates-rollup-compact {
			display: inline;
		}
	}
</style>
