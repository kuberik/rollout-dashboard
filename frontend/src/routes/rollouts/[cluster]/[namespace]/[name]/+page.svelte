<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { get } from 'svelte/store';
	import type {
		Rollout,
		Kustomization,
		OCIRepository,
		ManagedResourceStatus,
		HealthCheck,
		KruiseRollout,
		Environment,
		RolloutDependency,
		RolloutTest
	} from '../../../../../types';
	import type {
		EnvironmentStatusEntry,
		EnvironmentInfo
	} from '../../../../../types/environment-types';
	import {
		Card,
		Badge,
		Alert,
		Button,
		Modal,
		Toast,
		Tooltip,
		Popover,
		Listgroup,
		ListgroupItem,
		Progressradial,
		Sidebar,
		SidebarGroup,
		SidebarItem,
		Timeline,
		TimelineItem
	} from 'flowbite-svelte';
	import {
		CodePullRequestSolid,
		ReplyOutline,
		UndoOutline,
		EditOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		InfoCircleSolid,
		CloseOutline,
		CircleMinusSolid,
		CodeOutline,
		DatabaseSolid,
		ClockSolid,
		ClockArrowOutline,
		PauseSolid,
		PlaySolid,
		RefreshOutline,
		MessageDotsOutline,
		CalendarWeekSolid,
		QuestionCircleOutline,
		HeartSolid,
		CubesStackedSolid,
		UserSolid,
		CogSolid,
		ArrowUpRightFromSquareOutline,
		ArrowUpOutline,
		GithubSolid,
		ChevronRightOutline,
		ShareNodesSolid
	} from 'flowbite-svelte-icons';
	import {
		formatTimeAgo,
		formatTimeAgoCompact,
		formatDuration,
		formatDate,
		getRolloutStatus,
		isFieldManagedByManager,
		isFieldManagedByOtherManager,
		hasBypassGatesAnnotation,
		getBypassGatesVersion,
		getForceDeployVersion,
		hasForceDeployAnnotation,
		isVersionForceDeploying,
		isVersionBypassingGates,
		hasFailedBakeStatus,
		hasUnblockFailedAnnotation,
		getDisplayVersion,
		extractURLFromGatewayOrIngress,
		parseLinkAnnotations,
		extractDatadogInfoFromContainers,
		buildDatadogTestRunsUrl,
		buildDatadogLogsUrl,
		detectStuck
	} from '$lib/utils';
	import { pollWhenHealthy } from '$lib/api/errors';
	import { versionPathForRollout, displayVersionForTag } from '$lib/version-utils';
	import { autoDeployState, rollbackWent, rollbackNext } from '$lib/view-models/auto-deploy';
	import { detectRollback } from '$lib/rollout-cards';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { announce } from '$lib/stores/announce.svelte';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import FailurePanel from '$lib/components/FailurePanel.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList from '$lib/components/FactList.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import RecoveryModeWarningModal from '$lib/components/RecoveryModeWarningModal.svelte';
	import DeploymentPipelineCard from '$lib/components/DeploymentPipelineCard.svelte';
	import StatusSpinner from '$lib/components/StatusSpinner.svelte';
	import ResourceCard from '$lib/components/ResourceCard.svelte';
	import HealthCheckBadge from '$lib/components/HealthCheckBadge.svelte';
	import JoinedBadge from '$lib/components/JoinedBadge.svelte';
	import ScheduleStatus from '$lib/components/ScheduleStatus.svelte';
	import BlockingStoryPanel from '$lib/components/BlockingStoryPanel.svelte';
	import {
		buildGateContext,
		withSchedules,
		blockingStory,
		classifyGate,
		joinClauses,
		upstreamVerdict,
		isPluralSubject,
		type ClassifiedGate
	} from '$lib/view-models/blocking-story';
	import {
		buildRolloutGraph,
		nodeId,
		heldSubjects,
		type GraphNode
	} from '$lib/view-models/dependency-graph';
	import { compareEnvironmentNames } from '$lib/env-order';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import ClearPinModal from '$lib/components/ClearPinModal.svelte';
	import { getBakeStatusColor, bakeWord, bakeTitle } from '$lib/bake-status';
	import { rollbackTarget } from '$lib/view-models/deploy-risk';
	import DatadogLogo from '$lib/components/DatadogLogo.svelte';
	import HealthChecksCard from '$lib/components/HealthChecksCard.svelte';
	import ResourcesCard from '$lib/components/ResourcesCard.svelte';
	import EventsCard from '$lib/components/EventsCard.svelte';
	import { fly, blur } from 'svelte/transition';
	import { getEnvironmentThemeStyle, getRolloutEnvironmentTheme } from '$lib/environment-theme';

	import { rolloutPath } from '$lib/source-dashboard';
	import { DEPLOY_PARAM, deployKey } from '$lib/history-deeplink';
	import { formatTimeUntil } from '$lib/api/schedules';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		rolloutQueryOptions,
		rolloutsListQueryOptions,
		type RolloutResponse,
		rolloutPermissionsQueryOptions
	} from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey, githubAbsenceSentence } from '$lib/api/github';

	// Params (runes)
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	// The cluster name is embedded in the route path. The hub's spoke-proxy
	// middleware resolves it and forwards every API call (including mutations) to
	// that cluster, so the UI behaves identically regardless of source.
	const cluster = $derived(page.params.cluster as string);

	// Append ?cluster=<name> to an API path so the hub's proxy forwards it to the
	// right cluster (a no-op for the local cluster, resolved server-side).
	function apiUrl(path: string): string {
		if (!cluster) return path;
		const sep = path.includes('?') ? '&' : '?';
		return `${path}${sep}cluster=${encodeURIComponent(cluster)}`;
	}

	// Query for rollout - fetches all rollout data including kustomizations, ociRepositories, rolloutGates
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			cluster
		})
	);

	/**
	 * ⭐ THE LIST PAYLOAD, FOR ITS `rolloutDependencies` AND NOTHING ELSE.
	 *
	 * ⛔ THIS QUERY IS THE FIX FOR A WRONG INSTRUCTION, NOT AN OPTIMISATION.
	 * The gate join table below was built with `rolloutDependencies: null`
	 * hard-coded, because the single-rollout endpoint does not carry them. So
	 * `dependency-hello-frontend-needs-api` — a gate owned by a controller,
	 * which **no human anywhere can approve** — matched no join, fell through
	 * to the allow-list branch and was rendered on this page behind a PERSON
	 * icon as *"DEV is waiting on an approval … this will not clear on its
	 * own"*, while `/apps`, `/apps/<name>`, `/environments` and this page's own
	 * Dependencies tab all said, correctly, *"nobody has to approve anything"*.
	 *
	 * The layout already runs this exact query for the Dependencies tab and it
	 * shares `rolloutsListQueryKey` with `/rollouts`, so on any navigation from
	 * a list page this is a cache read and costs one render, not one request.
	 */
	const listQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { refetchInterval: pollWhenHealthy(15000) } })
	);

	// Query for permissions - checks if user can update/patch rollouts
	const permissionsQuery = createQuery(() =>
		rolloutPermissionsQueryOptions({
			namespace,
			name,
			cluster
		})
	);

	// Derived permissions state
	const canUpdate = $derived(permissionsQuery.data?.permissions?.update ?? false);
	const canPatch = $derived(permissionsQuery.data?.permissions?.patch ?? false);
	// Most actions require update permission, but some (like force-deploy, bypass-gates) use patch
	const canModify = $derived(canUpdate || canPatch);

	// Maintain existing local vars used throughout
	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);

	/**
	 * ⭐ A DEPLOY FINISHING IS THE ONE THING THIS PAGE EXISTS TO TELL SOMEONE,
	 *    AND UNTIL NOW IT ONLY EVER SAID IT IN PIXELS.
	 *
	 * The page repolls every 5s and repaints in place. Nothing navigates, so a
	 * screen reader is given no reason to re-read anything: an operator who is
	 * not looking at the screen learned that their deploy had gone green, or
	 * red, never. The first observation after mount is swallowed on purpose —
	 * announcing the state the page LOADED in would be noise, not news.
	 */
	let lastAnnouncedDeploy: string | null = null;
	$effect(() => {
		const entry = rollout?.status?.history?.[0];
		if (!entry) return;
		const key = `${entry.version?.tag ?? ''}|${entry.bakeStatus ?? ''}`;
		if (lastAnnouncedDeploy === null) {
			lastAnnouncedDeploy = key;
			return;
		}
		if (lastAnnouncedDeploy === key) return;
		lastAnnouncedDeploy = key;

		const subject = rollout?.metadata?.name ?? 'This rollout';
		const version = entry.version ? getDisplayVersion(entry.version) : 'a new version';
		// ONE VOCABULARY, INCLUDING IN THE LIVE REGION. These four cases spelled
		// the state `baking` while `/` and `/activity` said `checking` and the
		// version card printed the raw enum. `bake-status.ts` is the table.
		switch (entry.bakeStatus) {
			case 'Failed':
				announce(`${subject}: ${version} — ${bakeWord('Failed')}.`, 'assertive');
				break;
			default:
				announce(`${subject}: ${version} — ${bakeTitle(entry.bakeStatus)}.`);
		}
	});
	const environment = $derived(rolloutQuery.data?.environment);
	const rolloutTheme = $derived(rollout ? getRolloutEnvironmentTheme(rollout, environment) : null);
	const rolloutThemeStyle = $derived(
		rolloutTheme ? getEnvironmentThemeStyle(rolloutTheme) : undefined
	);
	const stuckReason = $derived(detectStuck(rollout, { now: $now }));
	/**
	 * ⛔ `isLoading` IS NOT "THE REQUEST HAS NOT COME BACK YET".
	 *
	 * TanStack's `isLoading` is `isPending && isFetching`, and with the old
	 * unbounded retry policy a query that could never succeed never left
	 * `pending` — so `{#if loading}` stayed true for the life of the tab.
	 * Measured on `/rollouts/prod/hello-world-prod/does-not-exist`: **fifteen
	 * 500s in 35 seconds**, five skeleton blocks on screen, no message, no way
	 * back, and the server's own sentence (`... "does-not-exist" not found`)
	 * discarded by a `throw new Error('Failed to load rollout')`.
	 *
	 * `loading` is now guarded on NOT being in the error state, and `error` is
	 * the query's own error rather than a `$state` variable that nothing ever
	 * assigned. See `$lib/api/errors` for the retry policy that lets the query
	 * reach `error` at all.
	 */
	const loading = $derived(rolloutQuery.isLoading && !rolloutQuery.isError);
	const error = $derived(rolloutQuery.isError ? rolloutQuery.error : null);

	// Derive directly from the query so that when route params change the
	// lists go back to empty while the new query is in flight, rather than
	// lingering with the previously-selected rollout's data.
	const kustomizations = $derived<Kustomization[]>(rolloutQuery.data?.kustomizations?.items ?? []);
	const ociRepositories = $derived<OCIRepository[]>(
		rolloutQuery.data?.ociRepositories?.items ?? []
	);
	const rolloutGates = $derived<any[]>(rolloutQuery.data?.rolloutGates?.items ?? []);
	const anyRolloutStalled = $derived.by(() => {
		return Object.values(managedResources)
			.flat()
			.some((resource) => {
				if (resource.groupVersionKind === 'rollouts.kruise.io/v1beta1/Rollout') {
					const kruiseRollout = resource.object as KruiseRollout;
					return kruiseRollout?.status?.conditions?.some(
						(c) => c.type === 'Stalled' && c.status === 'True'
					);
				}
				return false;
			});
	});

	const deploymentBlockedCondition = $derived(
		rollout?.status?.conditions?.find((c) => c.type === 'DeploymentBlocked' && c.status === 'True')
	);

	/**
	 * WHAT IS ACTUALLY HELD, DERIVED ONCE FOR THE WHOLE PAGE.
	 *
	 * Four surfaces used to guess at this separately and two of them guessed
	 * wrong: the schedule banner said manual deploys were blocked (they are
	 * not) and the clear-pin dialog said the rollout would advance (it does
	 * not). `view-models/auto-deploy` reads the controller's own structural
	 * split, and everything below reads it from there.
	 */
	const autoDeploy = $derived(autoDeployState(rollout, rolloutGates));

	/**
	 * ⛔ THE PAGE AN OPERATOR LANDS ON FROM EVERY LIST WAS THE ONE THAT DID
	 * NOT SAY THE ROLLOUT HAD GONE BACKWARDS. (2026-08-31)
	 *
	 * `/` and `/rollouts` mark it (`rollout-cards.ts::detectRollback` feeds
	 * the status disc) and the history tab marks it
	 * (`history-marks.ts::deployActs`). Rollout detail computed NEITHER and
	 * rendered a green tick beside `deploy succeeded` — true, and radically
	 * incomplete: the deploy did succeed, at going backwards. Photographed by
	 * the human on a phone, on `hello-dep-dev/hello-frontend-app`.
	 *
	 * ⛔ THIS IS `detectRollback` AND NOT A THIRD DERIVATION. That function is
	 * the definition of record for *"is this rollout, right now, running
	 * something older than what it replaced?"*, keyed to `history[0]` vs
	 * `history[1]`, which is exactly the question this page's status card
	 * asks. `history-marks.ts` asks the same question of every adjacent pair
	 * because a history page has to; `history-marks.test.ts` already asserts
	 * the two agree on every fixture, so the product cannot grow a third
	 * story about one deploy.
	 */
	const rolledBack = $derived(detectRollback(rollout));

	/**
	 * ⭐ THE ONE BLOCKING STORY, and it is the SAME function `/apps`,
	 * `/apps/<name>` and `/environments` call.
	 *
	 * This page and `/apps/<name>` used to answer the 3am question differently
	 * for the SAME rollout at the SAME second — this one said *"Automatic
	 * deploys are paused … until 13h 34m"* (go back to bed) while `/apps` said
	 * *"waiting on an approval … this will not clear on its own"* (escalate).
	 * Both were reading one gate out of two. `blockingStory` reads EVERY gate
	 * holding the rollout and says, for each, whether it clears on a clock,
	 * needs another deploy, or needs a person.
	 *
	 * ⛔ THE JOIN TABLE IS BUILT FROM ALL FOUR SOURCES, AND `rolloutDependencies`
	 * WAS THE ONE THAT WAS HARD-CODED TO `null`. That single word is why this
	 * page told an operator to go and find an approver for a machine gate. The
	 * sources now are:
	 *
	 *   · `rolloutGates` — THIS endpoint already serves the gate OBJECTS, and
	 *     their `ownerReferences[controller=true]` is POSITIVE evidence of who
	 *     wrote each one. It is the belt to the joins' braces: even if a join
	 *     were missing again, an owned gate can no longer be called an approval.
	 *   · `environments` — the list's, plus this rollout's own, so a rollout
	 *     whose Environment has not landed in the list yet still joins.
	 *   · `rolloutDependencies` — from the list payload (see `listQuery`).
	 *   · the schedules `ScheduleStatus` is already fetching, handed back rather
	 *     than requested a second time.
	 */
	let scheduleObjects = $state<any[]>([]);
	const gateContext = $derived.by(() => {
		const listData = listQuery.data;
		const envItems = [...(listData?.environments?.items ?? [])];
		if (environment) envItems.push(environment);
		const base = buildGateContext({
			// `null` when we genuinely have nothing — `buildGateContext` records
			// that as "source not consulted", which downgrades an unattributable
			// gate to `unknown` instead of promoting it to an approval.
			environments: listData?.environments || environment ? { items: envItems } : null,
			rolloutDependencies: listData?.rolloutDependencies ?? null,
			rolloutGates: rolloutQuery.data?.rolloutGates ?? null
		});
		return withSchedules(base, rollout?.metadata?.namespace, scheduleObjects);
	});
	const blockStory = $derived(
		blockingStory(rollout, gateContext, {
			place: environment?.spec?.environment ?? null,
			now: $now
		})
	);

	/**
	 * ⭐ TWO TRUE FACTS ABOUT ONE ROLLOUT COLLAPSE INTO ONE PANEL. (P9, second
	 * re-check, finding 10) `/rollouts/dev/hello-dep-dev/hello-frontend-app`
	 * is BOTH held by a dependency gate AND has gone backwards — measured
	 * live, two full-width `AlertPanel`s, 122px each, 264px total above a
	 * 90px status card, neither carrying a right-slot action. Both facts are
	 * real; stacking a second full-width band for the quieter one is the
	 * defect. When this is true the gate banner below takes
	 * `secondaryFact={rollbackWent(...)}` and the standalone `Rolled back`
	 * panel further down does not render at all — one banner, headline is
	 * the blocking fact (the one to act on), the rollback rides as a line
	 * inside it.
	 *
	 * ⛔ NOT WHEN PINNED. A pinned rollout already collapses the two (a
	 * rollback always pins, and the `Rolled back` panel states the pin's
	 * consequence in its own tested sentence — see that branch's own
	 * comment); this flag only covers the OTHER gate-blocked case, which
	 * had no such collapse.
	 *
	 * ⛔ AND ONLY WHEN A `dependency` GATE IS PART OF THE STORY, NOT ANY
	 * NON-CLOCK BLOCK. A first pass folded on `clock.length === 0` alone
	 * and broke `subject-detail.svelte.test.ts`'s own rolled-back-and-held
	 * fixture (a `check`/schedule-fallback gate, no dependency in sight):
	 * that scenario's TWO panels are the tested, correct shape — the gate
	 * banner states the check, the `Rolled back` panel states the rollback
	 * AND its disclosed `rollbackNext` verdict ("It will not move today…").
	 * Folding there deleted the `Rolled back` panel's own DISCLOSED tier
	 * with nothing to replace it, which is a bigger loss than the two-band
	 * stacking this fold exists to fix. Narrowed to the ONE shape the
	 * finding actually measured — a contract gate, whose banner has real
	 * spare room in its own disclosure for the second fact.
	 */
	/**
	 * ⭐ A ROLLBACK STOPS BEING NEWS AFTER A DAY. (P4, operator-walk finding)
	 * The `Rolled back` panel is a full-width `info` band, the same weight
	 * the page spends on an active gate — right for an event from THIS
	 * visit, wrong for one three days old that a reader has to re-read past
	 * every time they open this rollout. `rollbackIsStale` is that
	 * threshold; the panel demotes to a one-line fact (see the template)
	 * once it fires, and — see `rollbackFoldedIntoGateBanner` below — a
	 * stale rollback is no longer folded into the gate banner either, so an
	 * old event does not keep resurfacing in a second surface once its own
	 * panel has already stepped back.
	 *
	 * 24h, not a round "1 day": `formatTimeAgoCompact` already speaks in
	 * hours below that and days above it, so the demotion threshold is the
	 * same boundary the displayed unit itself changes at.
	 */
	const rollbackAgeMs = $derived.by(() => {
		const ts = rollout?.status?.history?.[0]?.timestamp;
		if (!ts) return 0;
		return $now.getTime() - new Date(ts).getTime();
	});
	const rollbackIsStale = $derived(rollbackAgeMs > 24 * 60 * 60 * 1000);

	const rollbackFoldedIntoGateBanner = $derived(
		!!rolledBack &&
			!blockStory.pinnedTo &&
			blockStory.blocked &&
			blockStory.clock.length === 0 &&
			blockStory.gates.some((g) => g.kind === 'dependency') &&
			!rollbackIsStale
	);

	/**
	 * ⭐ THE PROVIDER FACT, ON THE PROVIDER'S OWN OVERVIEW. (2026-09-02)
	 *
	 * From the critic: `/rollouts/prod/hello-dep-prod/hello-api-app` Overview
	 * showed `Up to date — no upgrades available` and said NOTHING about the
	 * three rollouts of `hello-frontend-app` held on it, while its own
	 * Dependencies tab correctly said `Services waiting on this · 1 of 1
	 * held`. `Up to date` is true and answers a different question — "does
	 * THIS rollout have somewhere to go" — and a reader can leave believing
	 * nothing is wrong anywhere near it.
	 *
	 * The same graph the Dependencies tab builds (`buildRolloutGraph`), scoped
	 * to the edges that start AT this rollout (`edge.from === this node` — see
	 * `GraphEdge.from`, "the rollout that must move first") and are `blocked`.
	 * `heldSubjects` is `dependency-graph.ts`'s own sentence builder for a set
	 * of held (service, environment) nodes, so the same app held in three
	 * environments reads as ONE subject rather than three repeated names —
	 * reused rather than re-derived, per that function's own comment.
	 *
	 * ⛔ NOT A SECOND GRAPH COMPUTATION. `gateContext` is the SAME join table
	 * `blockStory` above reads, so a rollout this graph calls held and a
	 * rollout `blockStory` calls held cannot disagree.
	 */
	const providerEnvOrder = $derived(
		[
			...new Set(
				(listQuery.data?.environments?.items ?? [])
					.map((e: Environment) => e.spec?.environment)
					.filter(Boolean) as string[]
			)
		].sort(compareEnvironmentNames)
	);
	const providerNetwork = $derived(
		buildRolloutGraph({
			rollouts: (listQuery.data?.rollouts?.items ?? []) as Rollout[],
			environments: (listQuery.data?.environments?.items ?? []) as Environment[],
			dependencies: (listQuery.data?.rolloutDependencies?.items ?? []) as RolloutDependency[],
			envOrder: providerEnvOrder,
			gates: gateContext
		})
	);
	const providerFocusId = $derived(nodeId(cluster, namespace, name));
	const heldByThis = $derived.by(():
		| { count: number; subjects: string; need: string; plural: boolean }
		| null => {
		const edges = providerNetwork.edges.filter(
			(e) => e.from === providerFocusId && e.writer === 'contract' && e.state === 'blocked'
		);
		if (edges.length === 0) return null;
		const byId = new Map(providerNetwork.nodes.map((n) => [n.id, n] as const));
		const held = new Map<string, GraphNode>();
		for (const e of edges) {
			const n = byId.get(e.to);
			if (n) held.set(n.id, n);
		}
		if (held.size === 0) return null;
		const nodes = [...held.values()];
		// The CONTRACT this rollout provides and what the held candidates ask
		// of it — the tail of the sentence `heldSubjects` does not carry.
		// Grouped: a live fleet can hold three environments on the same
		// (contract, requiredVersion) pair, and the sentence must not repeat it.
		const needs = [
			...new Set(
				edges.map(
					(e) => `${e.contract ?? 'a newer version'}${e.requiredVersion ? ` ${e.requiredVersion}` : ''}`
				)
			)
		];
		return {
			count: nodes.length,
			subjects: heldSubjects(nodes),
			need: joinClauses(needs),
			// ⛔ NUMBER AGREEMENT. `heldSubjects()` folds "one app held in three
			// environments" into ONE phrase on purpose — the app named once,
			// not per environment — so the SENTENCE's subject stays singular
			// too: `hello-frontend-app in prod NEEDS api ^1.67.0`, not
			// `need`. It only turns plural when the set names more than one
			// DISTINCT app. `isPluralSubject` counts that off the same node
			// list `heldSubjects` was built from, rather than re-parsing its
			// prose to recover the count.
			plural: isPluralSubject(nodes.map((n) => n.name))
		};
	});
	const bakeFailureDisabledCondition = $derived(
		rollout?.status?.conditions?.find(
			(c) => c.type === 'BakeFailureDisabled' && c.status === 'True'
		)
	);

	// Get the first stalled kruise rollout for retry functionality
	const stalledKruiseRollout = $derived.by(() => {
		for (const resources of Object.values(managedResources)) {
			for (const resource of resources) {
				if (resource.groupVersionKind === 'rollouts.kruise.io/v1beta1/Rollout') {
					const kruiseRollout = resource.object as KruiseRollout;
					if (
						kruiseRollout?.status?.conditions?.some(
							(c) => c.type === 'Stalled' && c.status === 'True'
						)
					) {
						return kruiseRollout;
					}
				}
			}
		}
		return null;
	});

	// Query for managed resources — one combined fetch across all kustomizations
	const managedResourcesQuery = createQuery(() => ({
		queryKey: ['managed-resources', namespace, name, kustomizations.map((k) => k.metadata?.name)],
		queryFn: async () => {
			const result: Record<string, ManagedResourceStatus[]> = {};
			await Promise.all(
				kustomizations
					.filter((k) => Boolean(k.metadata?.name))
					.map(async (k) => {
						const kName = k.metadata!.name as string;
						const kNamespace = k.metadata?.namespace || namespace;
						const res = await fetch(
							apiUrl(`/api/kustomizations/${kNamespace}/${kName}/managed-resources`)
						);
						if (res.ok) {
							const data = await res.json();
							result[kName] = data.managedResources || [];
						}
					})
			);
			return result;
		},
		enabled: kustomizations.length > 0,
		refetchInterval: pollWhenHealthy(5000)
	}));
	const managedResources = $derived<Record<string, ManagedResourceStatus[]>>(
		managedResourcesQuery.data ?? {}
	);

	// Query for health checks
	const healthChecksQuery = createQuery(() => ({
		queryKey: ['health-checks', namespace, name],
		queryFn: async () => {
			const res = await fetch(apiUrl(`/api/rollouts/${namespace}/${name}/health-checks`));
			if (!res.ok) return { healthChecks: [] };
			return res.json();
		},
		enabled: Boolean(rollout?.spec?.healthCheckSelector),
		refetchInterval: pollWhenHealthy(5000)
	}));
	const healthChecks = $derived<HealthCheck[]>(healthChecksQuery.data?.healthChecks ?? []);

	const errorCutoff = $derived<Date | null>(
		rollout?.status?.history?.[0]?.timestamp
			? new Date(
					Math.max(
						new Date(rollout.status.history[0].timestamp).getTime(),
						rollout.status.history[0].lastRetryTimestamp
							? new Date(rollout.status.history[0].lastRetryTimestamp).getTime()
							: 0
					)
				)
			: null
	);

	// Health checks that are failing but whose lastErrorTime predates the current
	// deployment/retry cutoff are not blocking the rollout — hide them entirely.
	const visibleHealthChecks = $derived<HealthCheck[]>(
		errorCutoff !== null
			? healthChecks.filter((hc) => {
					if (hc.status?.status !== 'Failed' && hc.status?.status !== 'Unhealthy') return true;
					const lastErrorTime = hc.status?.lastErrorTime;
					if (!lastErrorTime) return false;
					return new Date(lastErrorTime) >= errorCutoff!;
				})
			: healthChecks
	);

	// Query for events
	const eventsQuery = createQuery(() => ({
		queryKey: ['events', namespace, name],
		queryFn: async () => {
			const res = await fetch(apiUrl(`/api/rollouts/${namespace}/${name}/events`));
			if (!res.ok) return { events: [] };
			return res.json();
		},
		refetchInterval: pollWhenHealthy(5000)
	}));
	const events = $derived(eventsQuery.data?.events ?? []);

	/**
	 * ⭐ THE ROLLUP DOES NOT GO SILENT WHEN GITHUB DOES. (P11, operator-walk
	 * finding) `CommitSummary`'s own `query.isError` branch renders NOTHING,
	 * deliberately — its own comment says why: a page that renders MANY of
	 * these should say it once, panel-level, rather than N times. This page
	 * renders exactly one, in the version card's rollup slot, and had never
	 * built that panel-level fallback — so a 401 on `/commits` left the
	 * whole row blank where `/versions` already says `Commit message and
	 * author need GitHub. …`. `githubStatus` is the same query that page
	 * runs (`fetchGithubStatus`/`githubStatusQueryKey`, `staleTime: 300_000`
	 * — the connection state does not change mid-visit) so the two surfaces
	 * cannot disagree about whether GitHub is reachable.
	 */
	const githubStatus = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000
	}));
	const githubConnected = $derived(githubStatus.data?.connected ?? false);

	/**
	 * ⭐ THE SCHEDULE'S "NOTHING WAITING" FACT, HANDED UP AS TEXT — NOT A
	 * BANNER. (F2, second re-check, 2026-09-03) A closed deploy window with
	 * no candidate behind it is not a blocking fact, so it does not spend
	 * the page's one banner slot; `ScheduleStatus` hands the sentence up
	 * through `onMeta` and this page prints it beside the version, in the
	 * same row `isCurrentVersionCustom` and the upgrade count already share.
	 * See `ScheduleStatus.svelte`'s own `metaText` comment for the hue
	 * defect this replaces.
	 */
	let scheduleMetaText = $state<string | null>(null);

	// removed Clear Pin functionality
	let selectedVersion = $state<string | null>(null);

	let showToast = $state(false);
	let toastMessage = $state('');
	let toastType = $state<'success' | 'error' | 'info'>('success');
	let toastLoading = $state(false);

	let showRollbackModal = $state(false);
	let rollbackVersion = $state<string | null>(null);

	let showMarkSuccessfulModal = $state(false);
	let markSuccessfulMessage = $state('');

	let showClearPinModal = $state(false);

	/**
	 * ⭐ "AND IT IS NOT PINNED THERE" DOES NOT SAY WHETHER CLEARING JUST
	 * WORKED. (P4, operator-walk finding) The `Rolled back` panel's message
	 * is `rollbackWent`, computed fresh from CURRENT server state — before a
	 * clear it says "…and pinned there.", after it says "…and it is not
	 * pinned there." Both are TRUE, but a reader who just pressed `Clear
	 * pin` and watches the SAME banner mutate one clause is left asking
	 * "did that work, or did the rollback itself never pin?" — the sentence
	 * reads as a description of the past, not a confirmation of the action
	 * just taken. `justClearedPin` is a short-lived flag, set the instant
	 * `ClearPinModal` reports success, that swaps the panel to an explicit
	 * confirmation sentence for a few seconds before handing back to the
	 * steady-state wording — the same idea `pendingAction` uses for a
	 * deploy, at a smaller scale because clearing a pin needs no poll-gap
	 * bridge (it's a direct field write, reflected on the next refetch).
	 */
	let justClearedPin = $state(false);

	// Change version / deploy modal (picker + live changelist + deploy confirm)
	let showChangeVersionModal = $state(false);
	let deployExplanation = $state('');

	/**
	 * ⭐ THE POLL GAP IS WHERE A SECOND TAP WALKS THE ENVIRONMENT A SECOND
	 * BUILD BACK. (B3, operator-walk finding) Measured live: confirming
	 * Deploy/Rollback produced no visible change on this page for 5-8s (a
	 * real round trip to the Go backend, then to the k8s API, then this
	 * page's own poll) while the button stayed fully armed — no spinner,
	 * no toast, no pending state. A second press in that window is a
	 * second, real mutation.
	 *
	 * ⭐ DRIVEN BY `onDeployStart`, NOT `onSuccess`. (coordinator relay,
	 * 2026-09-03) The dialog lane's `ChangeVersionModal` now fires
	 * `onDeployStart()` the instant a person confirms — BEFORE its own
	 * `await`, alongside its own `deploying` state that drives the
	 * button's spinner — so this page's own "Deploy requested — starting"
	 * appears within the same frame as the click, not after the network
	 * round trip `onSuccess` waits for. `beginPendingAction` is the
	 * receiving end: it disables every control on this page that starts
	 * another deploy (Change Version, Rollback, Clear pin, each release
	 * candidate's own Deploy) and shows that sentence beside the version.
	 * It clears itself the moment `rollout.status.history[0]` actually
	 * changes — the same signature `lastAnnouncedDeploy` above already
	 * tracks — with a 20s safety timeout so a detection miss cannot wedge
	 * every action control open forever.
	 *
	 * ⛔ NOT THE MODAL'S OWN PENDING STATE. `deploying` (the confirm
	 * button's own spinner/label while ITS fetch is in flight) is that
	 * dialog's concern and stays there; this is the gap AFTER the modal
	 * has already told the operator "sent."
	 */
	let pendingAction = $state<{ sinceKey: string } | null>(null);

	function historySignature(): string {
		const h = rollout?.status?.history?.[0];
		return `${h?.version?.tag ?? ''}|${h?.bakeStatus ?? ''}|${h?.timestamp ?? ''}`;
	}

	function beginPendingAction() {
		pendingAction = { sinceKey: historySignature() };
		const startedWith = pendingAction;
		setTimeout(() => {
			if (pendingAction === startedWith) pendingAction = null;
		}, 20000);
	}

	$effect(() => {
		if (!pendingAction) return;
		if (historySignature() !== pendingAction.sinceKey) {
			pendingAction = null;
		}
	});

	// Recovery-mode pre-confirmation modal state
	let showRecoveryWarningModal = $state(false);
	let recoveryWarningReason = $state<'previous-failed' | 'unhealthy-health-checks'>(
		'previous-failed'
	);

	function recoveryModeReason(): 'previous-failed' | 'unhealthy-health-checks' | null {
		const currentBakeStatus = rollout?.status?.history?.[0]?.bakeStatus;
		if (currentBakeStatus && currentBakeStatus !== 'Succeeded') {
			return 'previous-failed';
		}
		if (visibleHealthChecks?.some((hc) => hc.status?.status === 'Unhealthy')) {
			return 'unhealthy-health-checks';
		}
		return null;
	}

	// Intercept transitions to the change-version modal: if the action would put the
	// rollout into recovery mode, show the warning modal first. The warning modal's
	// onContinue then opens the actual ChangeVersionModal.
	function requestChangeVersionModal() {
		const reason = recoveryModeReason();
		if (reason) {
			recoveryWarningReason = reason;
			showRecoveryWarningModal = true;
		} else {
			showChangeVersionModal = true;
		}
	}

	// New variables for pin version mode
	let isPinVersionMode = $state(false);

	let isReconciling = $state(false);

	// Reset state when rollout changes — without this, version-specific caches
	// and UI state leak across rollouts when the user navigates between them.
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		namespace;
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		name;
		selectedVersion = null;
		isPinVersionMode = false;
		isReconciling = false;
	});

	// Reset state when modals close
	$effect(() => {
		if (!showChangeVersionModal && !showRecoveryWarningModal) {
			selectedVersion = null;
			isPinVersionMode = false;
		}
	});

	// Selected version display label (for modal confirmation)
	function selectedVersionDisplay(): string | null {
		if (!selectedVersion) return null;
		const availableRelease = rollout?.status?.availableReleases?.find(
			(ar) => ar.tag === selectedVersion
		);
		if (availableRelease) {
			return getDisplayVersion(availableRelease);
		}
		return selectedVersion;
	}

	// Helper function to map failed health checks to full health checks
	function findFullHealthCheck(
		failedHC: { name: string; namespace?: string },
		allHealthChecks: HealthCheck[]
	): HealthCheck | undefined {
		return allHealthChecks.find(
			(hc) =>
				hc.metadata?.name === failedHC.name &&
				(!failedHC.namespace || hc.metadata?.namespace === failedHC.namespace)
		);
	}

	// Function to get gate description from gate annotations
	function getGateDescription(gate: any): string | null {
		// Look for gate description in the gate's own annotations
		return gate.metadata?.annotations?.['gate.kuberik.com/description'] || null;
	}

	// Function to get gate pretty name from gate annotations
	function getGatePrettyName(gate: any): string | null {
		// Look for gate pretty name in the gate's own annotations
		return gate.metadata?.annotations?.['gate.kuberik.com/pretty-name'] || null;
	}

	// Function to get gates blocking a specific version
	function getBlockingGates(version: string): any[] {
		if (!rollout?.status?.gates || rollout.status.gates.length === 0) return [];

		// Filter gates that are blocking this specific version
		const blockingGates = rollout.status.gates.filter((gate) => {
			// If gate has allowedVersions, check if this version is in the allowed list
			// A gate can be passing but still blocking if the version is not in allowedVersions
			if (Array.isArray(gate.allowedVersions)) {
				// Version is blocked if it's NOT in the allowedVersions list (regardless of passing status)
				return !gate.allowedVersions.includes(version);
			}

			// If gate doesn't have allowedVersions, check the passing status
			// If gate is not passing, it's blocking
			return gate.passing === false;
		});

		// Map to full gate objects from rolloutGates for display (name, description, etc.)
		return blockingGates
			.map((gateStatus) => {
				// Find the corresponding full gate object
				const fullGate = rolloutGates.find((g) => g.metadata?.name === gateStatus.name);
				return fullGate || null;
			})
			.filter((gate): gate is any => gate !== null);
	}

	/**
	 * ⛔ THE BADGE ON A RELEASE-CANDIDATE ROW SAID `Manual only`, AND THAT WAS
	 * NOT A VAGUER `Blocked` — IT WAS A FALSE ONE. (2026-08-31)
	 *
	 * Reported verbatim: *"gates might be unlocked in the future so why do you
	 * say manual only?"* Exactly right. `Blocked` named a CURRENT STATE that
	 * clears; `Manual only` named a PERMANENT PROPERTY of the version. A
	 * schedule gate reopens at 09:00 and that version then promotes itself,
	 * so the badge was false about every clock-gated candidate on the page —
	 * which is most of them on the live cluster.
	 *
	 * It cost two more things:
	 *   · `Blocked` carried WHAT was holding it (gates). `Manual only` named
	 *     nothing, so the badge stopped pointing at the gate cards below it.
	 *   · The popover title stayed `Blocked by Gates` for one commit and then
	 *     became `Won't deploy on its own`, i.e. the hover asserted the same
	 *     permanence the chip did. A badge and its own tooltip must not agree
	 *     on something untrue any more than they may disagree.
	 *
	 * ⭐ THE FIX IS THE MODEL, NOT THE OLD WORD. `view-models/blocking-story`
	 * already classifies every gate into `clock`/`check`/`upstream`/`person`/
	 * `unknown` by JOIN — never by name — and knows which of those clear
	 * themselves. The chip states the fact (`Held by a gate`) and the hover
	 * states what clears it, from the same classification the page banner and
	 * `/apps`, `/environments` and `/versions` all read. Two surfaces on this
	 * row can no longer say different things.
	 *
	 * ⛔ WHAT MUST SURVIVE EVERY REWORDING HERE: a gate holds AUTOMATIC
	 * promotion only (`rollout_controller.go`, the gate early-return is inside
	 * `if !r.hasManualDeployment(...)`), and the `Deploy` button twelve pixels
	 * away is enabled and works. A critic force-deployed through three closed
	 * gates to confirm it. So the chip may never say "cannot deploy", and the
	 * manual-deploy clause stays in the accessible name and in the popover.
	 */
	function classifyBlockingGates(version: string): ClassifiedGate[] {
		const namespace = rollout?.metadata?.namespace;
		const holding = new Set(getBlockingGates(version).map((g) => g?.metadata?.name));
		return (rollout?.status?.gates ?? [])
			.filter((g) => g?.name && holding.has(g.name))
			.map((g) => classifyGate(g, namespace, gateContext));
	}

	/**
	 * ⭐ THE CHIP IS PIN-AWARE NOW. (2026-09-03, operator-walk finding)
	 *
	 * It used to read `Held by a gate` / `Held by N gates` regardless of
	 * whether a PIN was the actual reason nothing deploys automatically —
	 * `getBlockingGates`/`classifyBlockingGates` only ever consult
	 * `rollout.status.gates`, which is the CONTROLLER's own evaluation and
	 * says nothing about `spec.wantedVersion`. Measured on the live cluster,
	 * pinning `hello-world-app/dev` (with a schedule gate also closed) left
	 * this chip reading `HELD by a gate` three lines under a banner already
	 * saying `Automatic deploys paused — this rollout is pinned` — two
	 * reasons, and neither one named the gate the Clear Pin modal on the
	 * SAME page already names (`Business Hours Only`).
	 *
	 * `blocking-story.ts`'s own rule is that a pin outranks every gate, so
	 * when pinned the pin clause leads. A clock-classified gate among the
	 * ones actually holding THIS candidate still carries real information —
	 * when it reopens — so its `subject`/`predicate`/`clearsAt` (the SAME
	 * drawn-relation fields `blockingStory()`'s own consequence composes
	 * from, not a second sentence invented here) ride along:
	 * `pinned to 0afab6f, and Business Hours Only reopens in 11h 19m`.
	 */
	function heldWord(gates: ClassifiedGate[]): string {
		if (blockStory.pinnedTo) {
			const pinClause = `pinned to ${blockStory.pinnedToDisplay}`;
			const reopeners = gates
				.filter((g) => g.clears === 'clock' && g.subject && g.predicate && g.clearsAt)
				.map((g) => {
					const until = formatTimeUntil(g.clearsAt!, $now);
					return until ? `${g.subject} ${g.predicate} ${until}` : null;
				})
				.filter((s): s is string => s !== null);
			return reopeners.length > 0 ? joinClauses([pinClause, ...reopeners]) : pinClause;
		}
		return gates.length === 1 ? 'by a gate' : `by ${gates.length} gates`;
	}

	/**
	 * WHAT CLEARS IT, WHERE WE KNOW. Same order of severity `blockingStory`
	 * uses, and the same refusal to invent: an `unknown` gate says we cannot
	 * tell rather than naming a remedy, and a `clock` gate carries its real
	 * time or no time at all.
	 *
	 * ⛔ A PIN OUTRANKS EVERY GATE HERE TOO. Without this, a pinned candidate
	 * whose only listed gate is a clock one said `This clears on its own` —
	 * true of the GATE, false of the CANDIDATE, which will not deploy
	 * automatically no matter what the clock does until the pin is cleared.
	 */
	function heldClears(gates: ClassifiedGate[]): string {
		if (gates.length === 0) return '';
		if (blockStory.pinnedTo)
			return 'Clearing the pin is what lets this deploy automatically — the gates below may also still apply.';
		if (gates.some((g) => g.clears === 'unknown'))
			return 'This dashboard cannot tell what clears this — it may or may not need a person.';
		if (gates.some((g) => g.clears === 'person')) return 'This will not clear on its own.';
		// ⛔ WAS A HARD-CODED LITERAL, TRUE ONLY OF A `promotion` GATE. Routed
		// through `upstreamVerdict` so a contract gate names its provider and
		// required version instead — see that function's own comment.
		if (gates.some((g) => g.clears === 'upstream')) return upstreamVerdict(gates);
		if (gates.some((g) => g.clears === 'clock' && g.clearsAt)) return 'This clears on its own.';
		return 'This clears on its own once the check passes.';
	}

	/** The popover title: the fact the chip states, spelled out. */
	function heldTitle(gates: ClassifiedGate[]): string {
		if (blockStory.pinnedTo) return `Pinned to ${blockStory.pinnedToDisplay}`;
		const kinds: string[] = [];
		if (gates.some((g) => g.clears === 'person')) kinds.push('an approval');
		if (gates.some((g) => g.clears === 'unknown')) kinds.push('a rule we cannot attribute');
		if (gates.some((g) => g.clears === 'upstream')) kinds.push('another deploy');
		if (gates.some((g) => g.clears === 'clock')) kinds.push('a deploy window');
		if (gates.some((g) => g.clears === 'check')) kinds.push('a check');
		return kinds.length > 0 ? `Waiting on ${joinClauses(kinds)}` : 'Held by gates';
	}

	// Computed property to determine if dashboard is managing the wantedVersion field
	const isDashboardManagingWantedVersion = $derived.by(() => {
		if (!rollout) return false;

		// If no wantedVersion is set, dashboard can manage it
		if (rollout.spec?.wantedVersion === undefined) return true;

		// Check if dashboard is managing the wantedVersion field through managedFields
		if (rollout.metadata?.managedFields) {
			if (
				isFieldManagedByManager(
					rollout.metadata.managedFields,
					'rollout-dashboard',
					'spec.wantedVersion'
				)
			) {
				return true;
			}
		}

		// Check if any other manager is managing the wantedVersion field
		if (rollout.metadata?.managedFields) {
			if (
				isFieldManagedByOtherManager(
					rollout.metadata.managedFields,
					'rollout-dashboard',
					'spec.wantedVersion'
				)
			) {
				return false; // Another manager is managing this field
			}
		}

		// Default to allowing management if no conflicts detected
		return true;
	});

	/**
	 * THE ROLLBACK TARGET, PROVED BACKWARDS. See `view-models/deploy-risk.ts`
	 * for why `history[1]` was the wrong answer and what replaces it.
	 */
	const rollbackNow = $derived(rollbackTarget(rollout));
	const rollbackDisplay = $derived(
		rollbackNow ? getDisplayVersion({ tag: rollbackNow.tag, version: rollbackNow.version }) : ''
	);

	/**
	 * ⭐ WHY THE BUTTON SKIPPED THE ENTRY RIGHT BELOW THE CURRENT ONE.
	 * (2026-09-02, cosmetic finding: `Rollback to 991829b` silently walked
	 * past `064b655` — CORRECTLY, `rollbackTarget` proves it is newer than
	 * what is running now (this environment itself rolled back through it)
	 * — but said nothing, so the title read as if `064b655` did not exist.
	 *
	 * ⛔ NOT A SECOND "IS THIS OLDER" DERIVATION. `rollbackTarget` (owned by
	 * `deploy-risk.ts`) already walked `history` and PICKED the first entry
	 * that passed its own check; this retraces the SAME walk — same `seen`
	 * dedup, starting from the same current tag, stopping at the same picked
	 * tag — and names only the entries it passed on the way. It does not
	 * re-decide age; whatever `rollbackTarget` walked past and did not
	 * return must have failed its check, which is the only fact asserted
	 * here.
	 *
	 * ⛔ THE FIRST DRAFT SKIPPED THIS RETRACE AND JUST SLICED THE ARRAY —
	 * `history.slice(1, idx)` — which is NOT the same set: `history` can
	 * repeat a tag (a rollback re-visits a build already seen), and a bare
	 * slice named the CURRENT tag itself as "newer than what is running now"
	 * when it recurred further back in the log. Verified on the live
	 * `hello-world-app/dev`: a bare slice named `064b655, 0afab6f and
	 * 064b655` — `0afab6f` IS the current build, printed as if it were a
	 * newer one skipped past it, and `064b655` twice for one gate. The
	 * retrace, matching `rollbackTarget`'s own `seen` set, names it once:
	 * `064b655`.
	 */
	const rollbackSkipped = $derived.by(() => {
		if (!rollbackNow || rollbackNow.basis !== 'ran-here') return [];
		const history = rollout?.status?.history ?? [];
		const currentTag = history[0]?.version?.tag;
		if (!currentTag) return [];
		const seen = new Set<string>([currentTag]);
		const skipped: string[] = [];
		for (let i = 1; i < history.length; i++) {
			const v = history[i]?.version;
			if (!v?.tag || seen.has(v.tag)) continue;
			seen.add(v.tag);
			if (v.tag === rollbackNow.tag) break; // reached the picked target itself
			const display = getDisplayVersion(v);
			if (display) skipped.push(display);
		}
		return skipped;
	});

	// Computed property to determine if current version is custom (not in available releases)
	const isCurrentVersionCustom = $derived.by(() => {
		if (!rollout?.status?.history?.[0] || !rollout?.status?.availableReleases) return false;
		const currentVersionTag = rollout.status.history[0].version.tag;
		return !rollout.status.availableReleases.some((ar) => ar.tag === currentVersionTag);
	});

	// Computed property to determine if pinned version (wantedVersion) is custom
	const isPinnedVersionCustom = $derived.by(() => {
		if (!rollout?.spec?.wantedVersion || !rollout?.status?.availableReleases) return false;
		const pinnedVersionTag = toTag(rollout.spec.wantedVersion);
		return isSelectedVersionCustom(pinnedVersionTag);
	});

	function isOlderThanCurrent(selectedTag: string): boolean {
		const currentTag = rollout?.status?.history?.[0]?.version?.tag;
		const releases = rollout?.status?.availableReleases;
		if (!currentTag || !releases) return false;
		const currentIdx = releases.findIndex((r) => r.tag === currentTag);
		const selectedIdx = releases.findIndex((r) => r.tag === selectedTag);
		if (currentIdx === -1 || selectedIdx === -1) return false;
		// In availableReleases, higher index is newer; lower is older
		return selectedIdx < currentIdx;
	}

	function isSelectedVersionCustom(selectedTag: string): boolean {
		if (!rollout?.status?.availableReleases) return false;
		return !rollout.status.availableReleases.some((ar) => ar.tag === selectedTag);
	}

	function toTag(version: string | { tag: string } | undefined): string {
		return typeof version === 'string' ? version : (version?.tag ?? '');
	}

	// Build GitHub tree URL for a given version
	function getGitHubUrl(version: string): string {
		let url = rollout?.status?.source ?? '';
		if (!url) return '';
		if (url.includes('github.com')) {
			url = url.endsWith('/') ? url + 'tree/' + version : url + '/tree/' + version;
		} else if (url.includes('git@github.com:')) {
			url = url.replace('git@github.com:', 'https://github.com/') + '/tree/' + version;
		} else if (url.includes('.git')) {
			url = url.replace('.git', '') + '/tree/' + version;
		} else {
			url = url.endsWith('/') ? url + 'tree/' + version : url + '/tree/' + version;
		}
		return url;
	}

	// Helper function to get dependency env + status for a version
	function getDependencyStatus(versionTag: string): { env: string; bakeStatus: string } | null {
		const environment = rolloutQuery.data?.environment;
		if (!environment?.status?.environmentInfos) {
			return null;
		}

		// Get current environment from the Environment resource's spec
		const currentEnv = environment?.spec?.environment;
		if (!currentEnv) {
			return null;
		}

		// Find current environment info
		const currentEnvInfo = environment.status.environmentInfos.find(
			(e: EnvironmentInfo) => e.environment === currentEnv
		);
		const depEnv =
			currentEnvInfo?.relationship?.type === 'After'
				? currentEnvInfo.relationship.environment
				: null;
		if (!depEnv) {
			return null;
		}

		// Find the dependency environment info
		const depEnvInfo = environment.status.environmentInfos.find(
			(e: EnvironmentInfo) => e.environment === depEnv
		);
		if (!depEnvInfo?.history) {
			return null;
		}

		// Find the release candidate, history entry, or available release to get all version identifiers
		if (!rollout) return null;
		const historyEntry = rollout.status?.history?.find(
			(entry) => entry.version?.tag === versionTag
		);
		const availableRelease = rollout.status?.availableReleases?.find((ar) => ar.tag === versionTag);

		// Collect all possible version identifiers to match against
		const versionIdentifiers = new Set<string>([versionTag]);
		if (historyEntry?.version) {
			if (historyEntry.version.digest) versionIdentifiers.add(historyEntry.version.digest);
			if (historyEntry.version.revision) versionIdentifiers.add(historyEntry.version.revision);
		}
		if (availableRelease) {
			if (availableRelease.digest) versionIdentifiers.add(availableRelease.digest);
			if (availableRelease.revision) versionIdentifiers.add(availableRelease.revision);
		}

		// Find matching deployment history entry in the dependency environment
		const matchingEntry = depEnvInfo.history.find(
			(entry: EnvironmentStatusEntry) =>
				versionIdentifiers.has(entry.version.tag) ||
				(entry.version.digest && versionIdentifiers.has(entry.version.digest)) ||
				(entry.version.revision && versionIdentifiers.has(entry.version.revision))
		);

		if (!matchingEntry || !matchingEntry.bakeStatus) {
			return null;
		}

		return { env: depEnv, bakeStatus: matchingEntry.bakeStatus };
	}

	function getStatusIcon(status: string | null) {
		if (!status) return { icon: ExclamationCircleSolid, color: 'text-gray-500 dark:text-gray-400' };
		switch (status.toLowerCase()) {
			case 'success':
				return { icon: CheckCircleSolid, color: 'text-green-700 dark:text-green-400' };
			case 'failure':
				return { icon: ExclamationCircleSolid, color: 'text-red-600 dark:text-red-400' };
			case 'in_progress':
			case 'pending':
				return { icon: ClockSolid, color: 'text-yellow-700 dark:text-yellow-400' };
			default:
				return { icon: ExclamationCircleSolid, color: 'text-gray-500 dark:text-gray-400' };
		}
	}

	function getStatusColor(status: string | null): 'green' | 'red' | 'yellow' | 'gray' {
		if (!status) return 'gray';
		switch (status.toLowerCase()) {
			case 'success':
				return 'green';
			case 'failure':
				return 'red';
			case 'in_progress':
			case 'pending':
				return 'yellow';
			case 'inactive':
				return 'gray';
			default:
				return 'gray';
		}
	}

	// Computed property to filter managed resources - now always shows all resources
	const filteredManagedResources = $derived(managedResources);

	// Extract URLs from gateway/ingress resources for display in title card
	// Prefer HTTPRoute hostnames over Gateway hostnames (like the Go code does)
	const gatewayIngressURLs = $derived.by(() => {
		const allResources = Object.values(filteredManagedResources).flat();
		const httpRouteURLs: string[] = [];
		const gatewayURLs: string[] = [];
		const ingressURLs: string[] = [];

		// First pass: collect HTTPRoute URLs (preferred)
		for (const resource of allResources) {
			const gvk = resource.groupVersionKind || '';
			if (gvk.includes('gateway.networking.k8s.io')) {
				const kind = gvk.split('/').pop() || '';
				if (kind === 'HTTPRoute') {
					const url = extractURLFromGatewayOrIngress(resource, gvk);
					if (url) {
						httpRouteURLs.push(url);
					}
				} else if (kind === 'Gateway') {
					const url = extractURLFromGatewayOrIngress(resource, gvk);
					if (url) {
						gatewayURLs.push(url);
					}
				}
			} else if (
				gvk.includes('networking.k8s.io') &&
				(gvk.includes('Ingress') || gvk.split('/').pop() === 'Ingress')
			) {
				const url = extractURLFromGatewayOrIngress(resource, gvk);
				if (url) {
					ingressURLs.push(url);
				}
			}
		}

		// Prefer HTTPRoute URLs, then Gateway URLs (only if no HTTPRoute URLs), then Ingress URLs
		if (httpRouteURLs.length > 0) {
			return [...new Set(httpRouteURLs)];
		} else if (gatewayURLs.length > 0) {
			return [...new Set(gatewayURLs)];
		} else {
			return [...new Set(ingressURLs)];
		}
	});

	// Extract Datadog service info from managed resources (deployments with DD_SERVICE and DD_ENV)
	const datadogServiceInfo = $derived.by(() => {
		const allResources = Object.values(filteredManagedResources).flat();

		for (const resource of allResources) {
			const gvk = resource.groupVersionKind || '';
			// Check if it's a Deployment
			if (gvk.includes('apps/v1') && gvk.includes('Deployment') && resource.object) {
				const deployment = resource.object;
				const containers = deployment.spec?.template?.spec?.containers || [];

				// Check all containers for DD_SERVICE and DD_ENV
				for (const container of containers) {
					const env = container.env || [];
					let ddService: string | null = null;
					let ddEnv: string | null = null;

					for (const envVar of env) {
						if (envVar.name === 'DD_SERVICE' && envVar.value) {
							ddService = envVar.value;
						}
						if (envVar.name === 'DD_ENV' && envVar.value) {
							ddEnv = envVar.value;
						}
					}

					// If we found both, return the service info
					if (ddService && ddEnv) {
						// Build Datadog APM service URL
						// Format: https://app.datadoghq.com/apm/service/{service_name}?env={env_name}
						const datadogUrl = `https://app.datadoghq.com/apm/entity/service:${encodeURIComponent(ddService)}?env=${encodeURIComponent(ddEnv)}`;
						return {
							service: ddService,
							env: ddEnv,
							url: datadogUrl
						};
					}
				}
			}
		}

		return null;
	});

	// Note: Data fetching is handled by rolloutQuery with automatic refetch via layout's refetchInterval
	// Dependent data (managedResources, healthChecks) is fetched via $effect when parent data changes

	// Helper function to get revision information from version object or annotations
	function getRevisionInfo(versionInfo: { revision?: string; tag: string }): string | undefined {
		return versionInfo.revision;
	}

	async function markDeploymentSuccessful(message: string) {
		if (!rollout) return;

		try {
			const response = await fetch(
				apiUrl(
					`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/mark-successful`
				),
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ message })
				}
			);

			if (!response.ok) {
				throw new Error('Failed to mark deployment as successful');
			}

			await rolloutQuery.refetch();
			showToast = true;
			toastMessage = 'Deployment marked as successful';
			toastType = 'success';
			showMarkSuccessfulModal = false;

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} catch (e) {
			console.error('Failed to mark deployment as successful:', e);
			showToast = true;
			toastMessage = e instanceof Error ? e.message : 'Failed to mark deployment as successful';
			toastType = 'error';

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		}
	}

	async function reconcileFluxResources() {
		if (!rollout || isReconciling) return;

		isReconciling = true;

		// Capture current state to detect changes
		const previousReleaseTags = new Set(rollout.status?.availableReleases?.map((r) => r.tag) ?? []);

		// Show persistent toast with spinner while checking
		showToast = true;
		toastLoading = true;
		toastMessage = 'Checking for new versions...';
		toastType = 'success';

		try {
			const response = await fetch(
				apiUrl(`/api/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/reconcile`),
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					}
				}
			);

			if (!response.ok) {
				throw new Error('Failed to check for new versions');
			}

			const reconcileData = await response.json();
			const previousScanTime = reconcileData.previousScanTime;

			// Poll until scan completes (scanTime changes) or we find new versions
			const maxAttempts = 15;
			const pollInterval = 1000; // 1 second
			let newVersionCount = 0;
			let scanCompleted = false;

			for (let attempt = 0; attempt < maxAttempts; attempt++) {
				await new Promise((resolve) => setTimeout(resolve, pollInterval));
				await rolloutQuery.refetch();

				// Check if scan completed by comparing scanTime
				const currentScanTime = rolloutQuery.data?.imageRepoScanTime;
				if (previousScanTime && currentScanTime && currentScanTime !== previousScanTime) {
					scanCompleted = true;
				}

				const currentReleases = rolloutQuery.data?.rollout?.status?.availableReleases ?? [];
				const currentTags = new Set(currentReleases.map((r: { tag: string }) => r.tag));

				// Check if we have new versions
				const newTags = [...currentTags].filter((tag) => !previousReleaseTags.has(tag));
				if (newTags.length > 0) {
					newVersionCount = newTags.length;
					break;
				}

				// If scan completed and no new versions, we can stop
				if (scanCompleted) {
					break;
				}
			}

			// Show result
			toastLoading = false;
			showToast = true;
			if (newVersionCount > 0) {
				toastMessage =
					newVersionCount === 1 ? '1 new version found!' : `${newVersionCount} new versions found!`;
				toastType = 'success';
			} else {
				toastMessage = 'No new versions available';
				toastType = 'info';
			}

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} catch (e) {
			console.error('Failed to check for new versions:', e);
			toastLoading = false;
			showToast = true;
			toastMessage = e instanceof Error ? e.message : 'Failed to check for new versions';
			toastType = 'error';

			// Auto-dismiss toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		} finally {
			isReconciling = false;
		}
	}

	function formatRevision(revision: string) {
		let result = '';
		if (revision.includes('@sha1:')) {
			result = revision.split('@sha1:')[1];
		} else {
			result = revision;
		}
		return result.substring(0, 7);
	}

	function parseDuration(duration: string): number {
		// Parse Kubernetes duration format (e.g., "5m", "30s", "1h")
		const match = duration.match(/^(\d+)([smhd])$/);
		if (!match) return 0;

		const value = parseInt(match[1]);
		const unit = match[2];

		switch (unit) {
			case 's':
				return value * 1000;
			case 'm':
				return value * 60 * 1000;
			case 'h':
				return value * 60 * 60 * 1000;
			case 'd':
				return value * 24 * 60 * 60 * 1000;
			default:
				return 0;
		}
	}

	function formatDurationFromMs(milliseconds: number): string {
		if (milliseconds <= 0) return '0s';

		const seconds = Math.floor(milliseconds / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) {
			return `${days}d ${hours % 24}h`;
		} else if (hours > 0) {
			return `${hours}h ${minutes % 60}m`;
		} else if (minutes > 0) {
			return `${minutes}m ${seconds % 60}s`;
		} else {
			return `${seconds}s`;
		}
	}

	async function continueRollout(
		kruiseRolloutName: string,
		kruiseRolloutNamespace: string,
		kuberikRolloutName?: string
	) {
		try {
			const response = await fetch(
				apiUrl(`/api/rollouts/${kruiseRolloutNamespace}/${kruiseRolloutName}/continue`),
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						currentStepState: 'StepReady',
						kuberikRolloutName: kuberikRolloutName || name
					})
				}
			);

			if (!response.ok) {
				throw new Error('Failed to continue rollout');
			}

			showToast = true;
			toastMessage = `Successfully continued rollout ${kruiseRolloutName}`;
			toastType = 'success';

			// Auto-hide toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);

			// Refresh the rollout data
			await rolloutQuery.refetch();
		} catch (error) {
			console.error('Continue rollout error:', error);
			showToast = true;
			toastMessage = `Failed to continue rollout: ${error instanceof Error ? error.message : 'Unknown error'}`;
			toastType = 'error';

			// Auto-hide toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		}
	}

	async function retryDeployment(kruiseRolloutName?: string, testAction = '') {
		try {
			const response = await fetch(apiUrl(`/api/rollouts/${namespace}/${name}/retry`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kruiseRolloutName: kruiseRolloutName || '', testAction })
			});

			if (!response.ok) {
				throw new Error('Failed to retry deployment');
			}

			showToast = true;
			toastMessage = 'Deployment retry initiated';
			toastType = 'success';
			setTimeout(() => {
				showToast = false;
			}, 3000);
			await rolloutQuery.refetch();
		} catch (error) {
			console.error('Retry deployment error:', error);
			showToast = true;
			toastMessage = `Failed to retry: ${error instanceof Error ? error.message : 'Unknown error'}`;
			toastType = 'error';
			setTimeout(() => {
				showToast = false;
			}, 3000);
		}
	}
</script>

<svelte:head>
	<title
		>kuberik | {rollout?.metadata
			? `${rollout.status?.title || rollout.metadata.name} (${rollout.metadata.namespace})`
			: 'Rollout'}</title
	>
</svelte:head>

<div class="min-h-full dark:bg-gray-900">
	{#if loading}
		<div class="mx-auto w-full max-w-7xl space-y-4 px-4 pt-6 pb-10 sm:px-6">
			<StillTryingNotice failureCount={rolloutQuery.failureCount} />
			<div class="h-10 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-28 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="h-64 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-700"></div>
			<div class="grid grid-cols-2 gap-4">
				<div class="h-44 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-44 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-700"></div>
			</div>
		</div>
	{:else if error}
		<ErrorState
			{error}
			subject="this rollout"
			backHref="/rollouts"
			backLabel="Back to all rollouts"
			onRetry={() => rolloutQuery.refetch()}
			isRetrying={rolloutQuery.isFetching}
		/>
	{:else if !rollout}
		<!--
			⛔ THIS WAS A FLOWBITE `Alert color="yellow"` AND IT WAS THE LEAST
			READABLE TEXT IN THE PRODUCT. `bg-yellow-100 text-yellow-500` measured
			**1.78:1 in light and 2.53:1 in dark at 14px** — the error state was
			harder to read than every ordinary row around it, which is exactly
			backwards. A Flowbite `Alert` is also not this product's vocabulary:
			`AlertPanel` is the object every other blocking fact here uses.

			It now says the three things `ErrorState` (twelve lines above, same
			branch chain) guarantees: a headline a novice understands, what
			happens next, and a way out. The wording is deliberately IDENTICAL to
			`errorConsequence`'s missing-object sentence so the two states read as
			one fact and not as two dialects.

			⚠️ The footnote is NOT a server sentence — there isn't one. The
			request SUCCEEDED and came back without a release, which is a
			different fact from a failed request, so the footnote states the
			address that was asked for. Never invent a quote from the server.
		-->
		<div class="mx-auto w-full max-w-7xl px-4 pt-6 pb-10 sm:px-6">
			<!-- ⭐ THE ADDRESS AND THE ANSWER, AS FIELDS. (2026-09-02) It was
			     *"The server answered for hello-dep-dev/does-not-exist on dev and
			     returned no release."* — a namespace/name pair, a cluster and an
			     outcome, narrated. The pair is the thing an engineer pastes after
			     `kubectl get rollout -n`, and in the sentence it had a preposition
			     glued to each end of it.

			     ⚠️ `Server answered: no release` KEEPS THE DISTINCTION THE SENTENCE
			     EXISTED FOR. The request SUCCEEDED — this is not a failed request
			     and there is no server sentence to quote. Never invent one; see
			     `errorFacts`, which is the other half of this state.

			     `Details`, not a count: one request is not a set
			     (`lib/disclosure.ts`). -->
			{#snippet missing()}
				<FactList
					tone="banner"
					facts={[
						{ label: 'Rollout', value: `${namespace}/${name}`, handle: true },
						...(cluster ? [{ label: 'Cluster', value: cluster, handle: true }] : []),
						{ label: 'Server answered', value: 'no release' }
					]}
				/>
			{/snippet}
			<AlertPanel
				severity="warning"
				class=""
				title="This rollout does not exist"
				message="It may have been deleted, or the address may be wrong."
				footnoteBody={missing}
			>
				{#snippet actions()}
					<button type="button" class="btn btn-secondary" onclick={() => rolloutQuery.refetch()}>
						<RefreshOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
						Try again
					</button>
					<!-- A LINK, NOT A BUTTON. (2026-09-02) `Try again` re-issues the
					     request; this only goes somewhere. Same contract as
					     `ErrorState`, which is the other half of this state. -->
					<a href="/rollouts" class="nav-link">
						Back to all rollouts
						<ChevronRightOutline aria-hidden="true" />
					</a>
				{/snippet}
			</AlertPanel>
		</div>
	{:else}
		<!-- ⭐ THE PRODUCT'S ONE CONTENT CONTAINER, `mx-auto max-w-7xl px-4 sm:px-6`.
		     ⛔ THIS PAGE HAD NO WRAPPER AND `sm:px-5`. Measured at 1440 its content
		     column ran the full 1264px of `<main>` and its left edge sat at 196
		     against every other page's 200 — a 4px sidestep on entry and an
		     uncapped column that grows without limit on a wide monitor while every
		     page you arrive from stops at 1216. THE TAB BAR ABOVE IS IN THIS SAME
		     CONTAINER NOW — it used to be full-bleed as "the one documented
		     exception", and that exception was the 180px step at 1800 (560 at
		     2560) between the strip and this block that the human read as
		     rollout detail having a larger margin. See the layout file. -->
		<div class="mx-auto w-full max-w-7xl px-4 pt-6 pb-10 sm:px-6">
			{#if rollout.status?.history?.[0]}
				{@const latestEntry = rollout.status.history[0]}
				<!--
					⭐ "UP TO DATE" WAITS FOR THE VERSION TO BE SERVING, NOT FOR THE
					REQUEST TO HAVE BEEN MADE. (P10, operator-walk finding)
					`releaseCandidates` are newer than `history[0].version` — and
					`history[0]` becomes the NEW build the instant a deploy STARTS
					(a `Deploying`/`InProgress` entry is pushed immediately), long
					before any pod actually runs it. Measured live: fifteen seconds
					after pressing Deploy, `Available Version Upgrades` already read
					`up to date` while zero pods had run the new build. `releaseCandidates.length
					=== 0` says "nothing newer is ALLOWED"; it does not say "this is
					SERVING". `stillCatchingUp` is the second half of that fact —
					true exactly while the current history entry hasn't settled —
					and every `up to date` verdict on this card checks it too.
				-->
				{@const stillCatchingUp =
					latestEntry.bakeStatus === 'Deploying' || latestEntry.bakeStatus === 'InProgress'}
				{@const currentEnv = environment?.spec?.environment}
				{@const pipelineKruiseRollouts = Object.values(managedResources)
					.flat()
					.filter((resource) => resource.groupVersionKind === 'rollouts.kruise.io/v1beta1/Rollout')}
				{@const pipelineValidRollouts = pipelineKruiseRollouts
					.map((rolloutResource) => {
						const kruiseRollout = rolloutResource.object as KruiseRollout;
						const rolloutData = kruiseRollout?.status?.canaryStatus;
						const canarySteps = kruiseRollout?.spec?.strategy?.canary?.steps;
						if (rolloutData && canarySteps && canarySteps.length > 0) {
							return {
								rolloutResource,
								kruiseRollout,
								rolloutData,
								canarySteps,
								isCompleted: kruiseRollout.status?.currentStepState === 'Completed'
							};
						}
						return null;
					})
					.filter((r): r is NonNullable<typeof r> => r !== null)}
				{@const pipelineAllTests = Object.values(managedResources)
					.flat()
					.filter(
						(resource) => resource.groupVersionKind === 'rollout.kuberik.com/v1alpha1/RolloutTest'
					)}
				{@const pipelineValidTests = pipelineAllTests
					.map((resource) => resource.object as RolloutTest)
					.filter((test) => test.spec?.rolloutName)}
				{@const failedStepTests = pipelineValidRollouts.flatMap((kr) => {
					const stepIdx = kr.rolloutData?.currentStepIndex;
					const krName = kr.kruiseRollout?.metadata?.name || '';
					return pipelineValidTests
						.filter(
							(t) =>
								t.spec?.rolloutName === krName &&
								t.spec?.stepIndex === stepIdx &&
								t.status?.phase === 'Failed'
						)
						.map((t) => ({ test: t, kruiseRolloutName: krName }));
				})}
				{@const isFailed = hasFailedBakeStatus(rollout) && !hasUnblockFailedAnnotation(rollout)}
				{@const failedHCList = latestEntry?.failedHealthChecks || []}
				{@const statusStripClass =
					latestEntry.bakeStatus === 'Succeeded'
						? 'bg-green-700 dark:bg-green-400'
						: latestEntry.bakeStatus === 'Failed'
							? 'bg-red-500'
							: latestEntry.bakeStatus === 'InProgress'
								? 'bg-yellow-400'
								: 'bg-blue-500'}
				{@const statusBadgeColor =
					latestEntry.bakeStatus === 'Succeeded'
						? 'green'
						: latestEntry.bakeStatus === 'Failed'
							? 'red'
							: latestEntry.bakeStatus === 'InProgress'
								? 'yellow'
								: latestEntry.bakeStatus === 'Deploying'
									? 'blue'
									: 'gray'}

				<!-- ══ PAGE HEADER ══ -->
				<div class="mb-4">
					<div class="flex flex-wrap items-baseline gap-3">
						<!-- The identifier leads, in the product's one display pair: the
						     mono name the breadcrumb, the sidebar, the URL and every list row
						     already print, then the human title in the light face — exactly
						     what /apps/[name] and /envs/[name] do. This page was the only one
						     leading with the title in bold sans, and the name it shares with
						     every other surface appeared nowhere in its own header. -->
						<h1 class="flex min-w-0 flex-wrap items-baseline gap-2">
							<span class="t-display-id min-w-0 truncate text-gray-900 dark:text-white">
								{rollout.metadata?.name}
							</span>
							{#if rollout.status?.title && rollout.status.title !== rollout.metadata?.name}
								<!-- ⛔ WAS `t-display` — THE SAME 24px AS `hello-frontend-app`
								     BESIDE IT. (F15, 2026-09-03) Measured 24/500 (mono id) next
								     to 24/300 (sans title): at 390, where this row wraps, two
								     equal-size headings stack instead of a name and its
								     one-line gloss. `t-dense` (12.5px) is the declared caption
								     role — same fix as `/apps/<name>`'s identical head. -->
								<span class="t-dense min-w-0 truncate text-gray-500 dark:text-gray-400">
									{rollout.status.title}
								</span>
							{/if}
						</h1>
						{#if currentEnv}
							<a
								href={`/envs/${encodeURIComponent(currentEnv)}`}
								class="environment-theme-scope inline-flex shrink-0 self-center rounded transition-opacity hover:opacity-80"
								style={rolloutThemeStyle}
								title="View all apps in {currentEnv}"
								><Chip
									role="env"
									theme={rolloutTheme}
									label={currentEnv}
									title="View all apps in {currentEnv}"
									wide
								/></a
							>
						{/if}
						<a
							href={`/apps/${rollout.metadata?.name}`}
							class="inline-flex items-center gap-1 self-center text-[11px] text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
							title="See this app across all environments"
						>
							<span aria-hidden="true">↗</span>
							across envs
						</a>
					</div>
					{#if rollout.status?.description && rollout.status.description !== (rollout.status?.title || rollout.metadata?.name)}
						<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
							{rollout.status.description}
						</p>
					{/if}
				</div>

				<!-- ══ SCHEDULE STATUS (blocking / closing-soon) ══ -->
				<!-- ⭐ ONE BLOCKING STORY. `ScheduleStatus` owns the schedule popover and
				     the "next window" line; when a gate is actually holding the
				     rollout it renders `blockStory`'s words rather than its own, so
				     a schedule that is one of three reasons is no longer printed as
				     if it were the only one. The panel below covers the case
				     `ScheduleStatus` cannot see at all — held by an approval or by
				     an upstream deploy, with no schedule involved — which is
				     precisely where this page used to render nothing.

				     ⛔ THIS WAS THREE PANELS FOR ONE FACT, AND `ScheduleStatus`
				     WAS THE HIDDEN SECOND SOURCE. (2026-09-03, operator-walk
				     finding) Pinning `hello-world-app/dev` (through the UI, with a
				     rollback in its history) rendered: `ScheduleStatus`'s own
				     AlertPanel (blue, `story.headline`/`story.consequence` — it
				     defers its WORDS to `story` once blocked, per the note above,
				     but its RENDER CONDITION is still its own `isBlocked`, derived
				     from the raw schedule fetch, not from `story`), then this
				     page's own `<BlockingStoryPanel>` rendering the BYTE-IDENTICAL
				     headline and consequence in `pinned` orange, then a THIRD
				     panel below for the rollback (`rollbackWent`/`rollbackNext`,
				     which already states the pin's consequence in its own words —
				     `truth.test.ts` pins the exact sentence: *"Went back N
				     release(s), X → Y, and pinned there. Nothing moves off Y
				     until the pin is cleared."*). `blockingStory()`'s pin branch
				     spreads `...NOT_BLOCKED` and never populates `clock`, so
				     `blockStory.clock.length === 0` is true whenever pinned —
				     which is exactly the signal this page used to decide
				     `ScheduleStatus` wasn't already covering it, and exactly why
				     it was wrong the one time a pin was also present.

				     THE FIX IS TWO PARTS. `ScheduleStatus` no longer renders its
				     own banner when `story?.pinnedTo` is set (see its own note) —
				     a pin outranks every gate, including a schedule, so that
				     leaves at most ONE of {this page's `BlockingStoryPanel`, the
				     `Rolled back` panel below}. And this panel does not render AT
				     ALL when `rolledBack` — not because its words are wrong, but
				     because the `Rolled back` panel already states the SAME pin
				     consequence in its own tested sentence, so drawing this one
				     too would be the identical duplicate one level down. -->
				<ScheduleStatus
					{rollout}
					{cluster}
					story={blockStory}
					onSchedules={(s) => (scheduleObjects = s)}
					onMeta={(t) => (scheduleMetaText = t)}
				/>
				{#if blockStory.pinnedTo}
					<!--
						⛔ THIS WAS `{#if pinnedTo && !rolledBack} … {:else if
						blocked && clock.length === 0} …` — TWO BRANCHES THAT
						CAN BOTH BE TRUE AT ONCE. (2026-09-03, operator-walk
						finding, caught live while verifying the fix) A pinned
						AND rolled-back rollout has `blocked: true` (a newer
						build exists) and `clock: []` (the pin branch never
						populates it), so when the first branch's `!rolledBack`
						made it fall through, the `{:else if}` fired anyway and
						rendered the SAME `BlockingStoryPanel` a second time —
						the exact duplicate this pass exists to remove, just
						moved one branch over. Verified on the live cluster:
						pinning `hello-world-app/dev` with a rollback in its
						history rendered `DEV is pinned to 0afab6f` (this
						panel) directly above `Rolled back / Went back 1
						release, 064b655 → 0afab6f, and pinned there.` (the
						panel below) — both true, both about the pin. Nesting
						the `rolledBack` check INSIDE the `pinnedTo` branch,
						rather than beside it, is what makes "pinned" and "not
						pinned" mutually exclusive with "rolled back" or not.
					-->
					{#if !rolledBack}
						<!-- `Clear pin` rides on the banner now, not only the
						     compact one further down the page — it is the one
						     control that actually resolves the fact this
						     banner states. -->
						{#snippet clearPinAction()}
							{#if canModify}
								<button
									type="button"
									class="btn btn-secondary"
									disabled={!isDashboardManagingWantedVersion || !!pendingAction}
									onclick={() => {
										showClearPinModal = true;
									}}
								>
									Clear pin
								</button>
							{/if}
						{/snippet}
						<BlockingStoryPanel story={blockStory} actions={clearPinAction} />
					{/if}
				{:else if blockStory.blocked && blockStory.clock.length === 0}
					<!--
						⭐ THE RIGHT SLOT IS PART OF THIS BANNER, NOT AN EMPTY ONE.
						(P9, second re-check, finding 10) `/apps` and `/environments`
						fill `BlockingStoryPanel`'s `actions` slot with a nav-link to
						the object the banner is about; this page IS that object, so
						there is nowhere to navigate TO. What survives is the more
						useful half of that same idea: a `dependency` gate has a real
						second destination on THIS rollout (its Dependencies tab,
						where the contract's provider and required range are drawn),
						so that wins when one is present; otherwise the slot carries
						the same rule count the disclosure below already states, so
						the banner is never rendered with a bare unused column.
					-->
					{#snippet blockedActions()}
						{#if blockStory.gates.some((g) => g.kind === 'dependency')}
							<a href={rolloutPath(cluster, namespace, name, 'dependencies')} class="nav-link">
								Dependencies
								<ChevronRightOutline class="h-3.5 w-3.5" />
							</a>
						{:else}
							<span class="t-micro font-medium">
								{blockStory.gates.length}
								{blockStory.gates.length === 1 ? 'rule' : 'rules'}
							</span>
						{/if}
					{/snippet}
					<BlockingStoryPanel
						story={blockStory}
						actions={blockedActions}
						secondaryFact={rollbackFoldedIntoGateBanner && rolledBack
							? rollbackWent(rolledBack, autoDeploy)
							: undefined}
					/>
				{/if}

				<!-- ══ FAILURE PANEL ══ -->
				{#if isFailed}
					<FailurePanel
						{rollout}
						{failedHCList}
						healthChecks={visibleHealthChecks}
						{failedStepTests}
						{stalledKruiseRollout}
						{canUpdate}
						{canModify}
						{isDashboardManagingWantedVersion}
						{cluster}
						environmentName={environment?.spec?.environment ?? null}
						onRetry={retryDeployment}
						onSuccess={(m) => {
							toastType = 'success';
							toastMessage = m;
							showToast = true;
							setTimeout(() => (showToast = false), 3000);
						}}
						onError={(m) => {
							toastType = 'error';
							toastMessage = m;
							showToast = true;
							setTimeout(() => (showToast = false), 3000);
						}}
					/>
				{/if}

				<!-- ══ DEPLOYMENT BLOCKED ══ -->
				{#if deploymentBlockedCondition && !isFailed && latestEntry.bakeStatus !== 'Deploying' && latestEntry.bakeStatus !== 'InProgress'}
					<!--
						Same correction as the schedule banner. `DeploymentBlocked` is
						the controller's condition for "health checks are unhealthy",
						and it is consulted inside `if !r.hasManualDeployment(...)` —
						so it stops the controller, not a person. The footnote is the
						same sentence the schedule banner uses, deliberately: one fact,
						one wording, learned once.

						⭐ AND IT IS DISCLOSED, NOT PRINTED. (2026-08-31) This exact
						sentence already has a home WHERE THE DECISION IS MADE:
						`manualDeployNote` puts it inside `ChangeVersionModal`, which is
						the last screen before production changes. Printed here as well it
						is the third line of a banner a reader meets BEFORE they have
						decided the banner is about them, and it is on every gated rollout
						in the product, forever. Behind the control it is one click away,
						and it is still handed to them unprompted at the moment they act.
					-->
					<AlertPanel
						severity="warning"
						title="Automatic deploys are paused"
						message={deploymentBlockedCondition.message || 'Health checks are unhealthy.'}
						footnote="A deploy you start by hand still applies immediately."
						pulse
					/>
				{/if}

				<!-- ══ BAKE FAILURE DISABLED (RECOVERY MODE) ══ -->
				<!--
					The condition is set when a deploy starts and persists until the next
					deploy starts; only show the banner while the active deploy is still
					running (Deploying or InProgress).
				-->
				{#if bakeFailureDisabledCondition && (latestEntry.bakeStatus === 'Deploying' || latestEntry.bakeStatus === 'InProgress')}
					<AlertPanel
						severity="info"
						title="Recovery mode"
						message={bakeFailureDisabledCondition.message ||
							'Health check failures will not fail this deployment.'}
					/>
				{/if}

				<!-- ══ PINNED VERSION ══ -->
				<!--
					⛔ THIS BANNER USED TO ECHO THE DEPLOY MESSAGE AS AN ITALIC PULL
					QUOTE, AND IT NEVER SAID WHICH VERSION. (2026-08-31)

					TWO DEFECTS, ONE CAUSE. The quote was `AlertPanel`'s `quoted`
					branch: a `border-l-2` coloured edge inside a `rounded-xl` field —
					*"no rounded box with a single coloured edge stripe"*, banned twice,
					and side accent bars are legal only on SQUARE elements. It has been
					deleted from the shared component, not just from this call, so it
					cannot come back on the next banner someone adds.

					AND THE STRING IT QUOTED WAS NOT ABOUT THE PIN. `latestEntry.message`
					is the last DEPLOY's audit line. When the pin triggers a deploy it
					reads `Pinned version`, which is the heading again in lower case; when
					someone pins the build that is already running, it is whatever that
					deploy said (`*Automatic deployment*`) — attributed, under a heading
					reading `Version pinned`, to an action it has nothing to do with.

					WHAT REPLACES IT IS THE FACT THE BANNER WAS MISSING: the build the
					pin is holding, under the name the rest of the product uses
					(`991829b`, via the shared `displayVersionForTag` — `wantedVersion`
					itself is the sixty-character OCI tag), and the consequence.
				-->
				<!-- ══ ROLLED BACK ══ -->
				<!--
					⛔ ONE BANNER, NOT TWO BADGES THAT HAPPEN TO CO-OCCUR.
					(2026-08-31)

					A rollback started in this product ALWAYS pins — verified in
					the running modal, not inferred: opening `Rollback to
					991829b` on `hello-world-prod/hello-world-app` gives one
					checkbox reading `Pin Version / Going back pins the
					version`, `checked: true`, `disabled: true`, because
					`ChangeVersionModal`'s `mustPin` is true whenever
					`direction === 'rollback'`. So the pin is not a second fact
					sitting next to the rollback; it is WHAT THE ROLLBACK DID.
					Rendering `Rolled back` and `Version pinned` as two panels
					would make the reader assemble one act out of two marks.

					THEREFORE THIS REPLACES THE PINNED BANNER rather than
					stacking above it. `AlertPanel`'s own rule is that a page
					with three banners has no banner, and this page already
					spends one on the gate — measured on the live rollout,
					which renders `DEV is waiting on another deploy` in amber
					directly above. A second amber field would read as one wall.
					`pinned` is the palette the product already spends on "this
					rollout is being steered by hand", which covers both halves.

					⛔ AND THE CONSEQUENCE IS `rollbackWent`/`rollbackNext`'S, NOT THIS
					FILE'S. Whether the rollback is HELD is a question about
					automatic promotion, and `auto-deploy.ts` is the one place
					that knows — the same object the clear-pin dialog and the
					deploy confirmation read, so the three cannot drift into
					three answers about one rollout.

					⛔ AND NOT WHEN `rollbackFoldedIntoGateBanner` IS TRUE. (P9,
					second re-check, finding 10) A NON-pinned gate block and a
					rollback are two independent facts, and this panel used to
					render unconditionally beside the gate banner above —
					measured live, two full-width bands for one rollout. The
					gate banner is the one to act on, so it takes this panel's
					sentence (`rollbackWent`) as its own `secondaryFact` and this
					panel steps aside rather than repeating it one level down.
					See `rollbackFoldedIntoGateBanner`'s own comment.
				-->
				{#if rolledBack}
					{@const trig = latestEntry?.triggeredBy}
					{@const author = trig?.kind === 'User' && trig?.name ? trig.name : null}
					{@const rollbackAge = formatTimeAgoCompact(latestEntry.timestamp, $now)}
					<!--
						⛔ NOT `warning`, AND NOT `pinned`. MEASURED ON THE PAGE,
						NOT CHOSEN FROM THE ENUM.

						`pinned` was the first attempt and it rendered ORANGE
						directly beneath the gate banner's AMBER — two adjacent
						full-width fields a shade apart, which is the "a page
						with three banners has no banner" failure arriving as
						colour instead of as count. `warning` would be worse:
						amber on amber, and it would claim an alarm this is not.

						The history tab already ruled on the hue for this exact
						fact and wrote down why — *"neutral-strong rather than a
						status hue: going backwards is a FACT about the deploy,
						not an alarm about its health"*. Neutral is unavailable
						here for a reason the grammar is equally explicit about:
						a gray band is what the human said *"feels like a bug"*
						on `/apps` and `/environments`. So `info`, which this
						page already spends on `Recovery mode`, separates from
						the amber at a glance and carries no alarm.

						AND THE GLYPH IS THE UNDO ARROW, not `info`'s default
						circle — the same mark `/`, `/rollouts` and the history
						tab draw for this state, so one act has one symbol
						everywhere.
					-->
					{#if rollbackIsStale}
						<!--
							⭐ DEMOTED: AN OLD ROLLBACK IS A HISTORY FACT, NOT A
							STANDING PANEL. (P4, operator-walk finding) The full
							`AlertPanel` below is right for an event from THIS
							visit; three days on, a reader who opens this rollout
							for an unrelated reason has to read past a full-width
							blue band restating something they already know, every
							single time. See `rollbackIsStale`'s own comment (24h,
							the same boundary `formatTimeAgoCompact` itself switches
							units at). Same facts — both versions implicitly (the
							link goes to where they're drawn), who, when — at the
							density a list row already uses for this exact state.
						-->
						<p
							class="mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-gray-500 dark:text-gray-400"
						>
							<UndoOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
							Rolled back {rollbackAge} ago{author ? ` · by ${author}` : ''}.
							<a href={rolloutPath(cluster, namespace, name, 'history')} class="nav-link"
								>History</a
							>
						</p>
					{:else if !rollbackFoldedIntoGateBanner}
						<!--
							⭐ TWO TIERS, NOT ONE PARAGRAPH. (2026-08-31) Measured at 390 on
							this very rollout, this banner was 198px and 237 characters
							under a 226px gate banner — 456px of an 844px viewport before
							the status card. And the two fields SAID THE SAME THING: amber
							*"Nothing promotes itself until hello-api-app ships a newer api
							than 1.66.0"*, blue *"It will not move today — a rule is holding
							it"*. The duplicated half is the MECHANISM, which is exactly the
							tier `AlertPanel` now discloses everywhere.

							So `rollbackWent` is printed — it names both versions and whether
							the rollback pinned, which is the whole fact — and `rollbackNext`
							plus the actor are behind the control. `rollbackStory` still
							exists and still returns the assembled sentence; nothing was
							shortened, it was split.

							⛔ THE ACTOR RIDES WITH IT DELIBERATELY. *"Rolled back by
							admin@example.com"* answers a question an AUDITOR asks later, not
							one the operator asks at a glance, and it is the reason the label
							is `What happens next` rather than `Who did this`: the label must
							name the thing a reader would go looking for, and nobody opens a
							banner to find an email address.
						-->
						<!-- ⭐ THE SENTENCE AND THE ACTOR ARE TWO DIFFERENT KINDS OF
						     THING, AND THE FOOTNOTE HAD WELDED THEM. (2026-09-02)
						     `rollbackNext` is a verdict — prose, correctly. *"Rolled back
						     by admin@example.com."* is a FIELD with a value, and an email
						     address inside a full stop is a value a reader cannot select
						     cleanly. The verdict keeps the sentence tier, the actor gets a
						     label, and the note above still holds: the label on the
						     control stays `Details`, because nobody opens a banner to
						     find an email address and ONE record is not a set. -->
						{#snippet rollbackDetail()}
							<p class="break-words">{rollbackNext(rolledBack, autoDeploy)}</p>
							{#if author}
								<FactList
									class="mt-2"
									tone="banner"
									facts={[{ label: 'Rolled back by', value: author, handle: true }]}
								/>
							{/if}
						{/snippet}
						<!--
							⭐ THE PRINTED SENTENCE CONFIRMS AN ACTION JUST TAKEN, WHEN
							ONE WAS. (P4, operator-walk finding) `rollbackWent` reads
							CURRENT server state fresh on every render — before a clear
							it says "…and pinned there.", after it says "…and it is not
							pinned there." Both true, but a reader who just pressed
							`Clear pin` and watches this exact sentence mutate one
							clause cannot tell "that worked" from "the rollback never
							pinned in the first place." `justClearedPin` swaps in an
							explicit confirmation for a few seconds — see its own
							comment for why a poll-gap bridge isn't needed here.

							⭐ AND THE MANUAL-DEPLOY ESCAPE RIDES HERE NOW, NOT ONLY
							BEHIND AN 18px `?` ELSEWHERE. (P4) The release-candidate
							row's `Held by a gate` popover already states "Pressing
							Deploy applies it immediately — gates only hold back
							automatic promotion" — the single most actionable fact on
							a page where automatic promotion is stuck — but only to a
							reader who hovers a tiny icon on a specific candidate row
							they may never scroll to. This panel is the one an operator
							actually reads when a rollback is the live question, so the
							SAME fact (this product's one canonical phrasing for it,
							`blocking-story.ts`'s own) prints here too, as a quiet
							second line, whenever automatic promotion is genuinely
							paused (`autoDeploy.paused`) — never a duplicate claim when
							clearing the pin just reopened it.
						-->
						{#snippet rollbackMessage()}
							<p>
								{justClearedPin
									? 'The pin has been cleared; automatic promotion is back on.'
									: rollbackWent(rolledBack, autoDeploy)}
							</p>
							{#if autoDeploy.paused && !justClearedPin}
								<p class="mt-1 opacity-80">
									A deploy you start by hand still applies immediately.
								</p>
							{/if}
						{/snippet}
						<AlertPanel
							severity="info"
							icon={UndoOutline}
							title="Rolled back"
							messageBody={rollbackMessage}
							footnoteBody={rollbackDetail}
						>
							{#snippet extra()}
								<!-- ⭐ THE PANEL CARRIES ITS OWN AGE. (P4, operator-walk
								     finding) The event this panel is ABOUT was invisible
								     as a fact — three days old with nothing on screen
								     saying so, next to a `Rolled back` headline that reads
								     identically whether it happened a minute or a week
								     ago. Same slot `AlertPanel`'s `extra` already reserves
								     beside the headline for exactly this kind of chip. -->
								<span
									class="t-micro font-normal text-blue-700/80 dark:text-blue-300/70"
									>{rollbackAge} ago</span
								>
							{/snippet}
						</AlertPanel>
					{/if}
				{/if}
				<!-- ⛔ THE `Version pinned` BANNER THAT USED TO SIT IN THE
				     `{:else if rollout.spec?.wantedVersion && !isPinnedVersionCustom}`
				     BRANCH HERE IS GONE. (2026-09-03, operator-walk finding) It read
				     `rollout.spec.wantedVersion` directly — the SAME source
				     `blockStory.pinnedTo` reads — so it was a second, independently-
				     worded rendering of the exact fact the pin-aware branch above
				     (`{#if blockStory.pinnedTo}`, by the `ScheduleStatus` call)
				     already covers for every pin state, blocked or not
				     (`BlockingStoryPanel`'s own guard is `story.pinnedTo ||
				     story.blocked`). It also claimed "no newer build will deploy"
				     unconditionally, which was false whenever a candidate WAS
				     available — `blockStory.consequence` already branches on
				     `candidateCount`. -->

				<!--
					⭐ F4: THE RAIL FLIPS ON A CONTAINER QUERY NOW, NOT `lg`.
					(2026-09-03, breakpoints pass) `lg` is a VIEWPORT breakpoint
					(1024px) and the sidebar is 175px from `sm` on, so a 1024px
					viewport does not mean 1024px of content — measured on the live
					page: main 417px / rail 352px, the pipeline card's explanation
					pane down to 127px wide (a sentence over 14 lines), resource
					names truncated to 44px beside 200px of `Deployment 2/2 pods
					CURRENT`, 57% of the rail empty. `.ov-split-cq`
					(`container-type: inline-size`, on this same wrapper) makes the
					query subject the box this grid actually has. THE THRESHOLD IS
					DERIVED, NOT GUESSED: the rail floors at `22rem` (352px) and the
					gap is 16px, so the main column clears 700px only once the
					container clears `700 + 352 + 16 = 1068px` — rounded up to
					1080px for a small margin. Plain `lg` (1024) undershoots this by
					44px even ignoring the sidebar; `xl` (1280) was tried and
					rejected on `/envs/[name]` for the identical reason (main lands
					at 697, one pixel under its own floor) — see that page's own
					note.
				-->
				<!--
					⚠️ TWO NESTED DIVS, NOT ONE. A container-query SUBJECT cannot be
					the same element as its own query CONTAINER — `@container`
					rules targeting `.ov-split`'s own `display`/`grid-template-columns`
					never matched when `.ov-split-cq` (the `container-type` owner)
					sat on that identical element; verified via
					`getComputedStyle(...).containerType` reading `normal` instead of
					`inline-size` in that shape. `.ov-split-cq` wraps; `.ov-split` is
					its one child and the actual grid.
				-->
				<div class="ov-split-cq">
					<div class="ov-split flex flex-col gap-4">
					<div class="flex flex-col gap-4">
						<!--
							⭐ THE HERO STAYS A HERO, AND THAT MEANS NO BORDER. (2026-09-02,
							design re-check) `border border-gray-200` on a `rounded-xl` box
							with no header bar is exactly the shape `Card.svelte`'s own doc
							comment calls "a bordered box with no header" — the rejected
							pattern. This object is deliberately not a `Card`: it carries the
							page's own display id (`t-display-id`, the 22px mono build) and
							the deploy's state disc, which is the page's lead object, not one
							card among a stack. `COMPOSITION-GRAMMAR.md` names the border as
							the thing that makes a rounded box read as "a card without a
							header"; dropping it (keeping `shadow-sm` for separation from the
							page ground) removes that misread without forcing a 47px header
							bar onto the one object that should not look like the others.
						-->
						<!-- ══ STATUS CARD ══ -->
						<div
							class="environment-theme-scope overflow-hidden rounded-xl bg-white shadow-sm dark:bg-gray-800"
							style={rolloutThemeStyle}
						>
							<div class="min-w-0 px-5 py-5">
								<!-- Top row: icon + version + status label | meta -->
								<div class="flex items-start justify-between gap-4">
									<div class="flex min-w-0 items-center gap-3">
										<!-- ⭐ THE DISC CARRIES THE STATE HERE TOO, so the status card
										     answers on its own and matches the two list surfaces the
										     reader arrived from. `BakeStatusIcon` already takes
										     `state` (added for `/` and `/rollouts`); the glyph and
										     the `sr-only` word cost no layout, and the hue stays the
										     deploy's because the deploy really did succeed.

										     ⚠️ ONLY `rolled-back`, DELIBERATELY. On a list the disc
										     also carries `pinned`, because a row has nowhere else to
										     put it. Here the pin has a full banner, and marking one
										     fact twice on one page is the defect in the mirror. -->
										<BakeStatusIcon
											bakeStatus={latestEntry.bakeStatus}
											size="medium"
											class="shrink-0"
											state={rolledBack ? 'rolled-back' : null}
											stateWord="rolled back"
										/>
										<div class="min-w-0">
											<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
												<a
													href={versionPathForRollout(
														rollout,
														name,
														getDisplayVersion(latestEntry.version)
													)}
													class="t-display-id text-gray-900 hover:underline dark:text-white"
												>
													{getDisplayVersion(latestEntry.version)}
												</a>
												<!-- ⛔ THIS PRINTED THE RAW CRD ENUM. `InProgress` reached
												     the screen beside a pipeline chip saying `Baking` and a
												     home page saying `checking`, for the same rollout at the
												     same second. `bakeWord` is the product's one word and
												     `bakeTitle` carries the sentence a single word cannot. -->
												<span
													class="text-sm {latestEntry.bakeStatus === 'Succeeded'
														? 'text-green-700 dark:text-green-400'
														: latestEntry.bakeStatus === 'Failed'
															? 'text-red-600 dark:text-red-400'
															: latestEntry.bakeStatus === 'InProgress'
																? 'text-yellow-700 dark:text-yellow-400'
																: latestEntry.bakeStatus === 'Deploying'
																	? 'text-blue-600 dark:text-blue-400'
																	: 'text-gray-500 dark:text-gray-400'}"
													title={bakeTitle(latestEntry.bakeStatus)}
												>
													{bakeWord(latestEntry.bakeStatus)}
												</span>
												{#if stuckReason}
													<StuckBadge reason={stuckReason} />
												{/if}
												{#if pendingAction}
													<!-- ⭐ THE POLL-GAP BRIDGE. See `pendingAction`'s own
													     comment (B3, operator-walk finding): a mutation the
													     modal already confirmed can still take 5-8s to reach
													     this page's own data, and an unchanged screen in that
													     window reads as "did that even work" — or invites a
													     second press. -->
													<span
														class="flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400"
													>
														<StatusSpinner size="3" color="blue" />
														Deploy requested — starting
													</span>
												{/if}
											</div>
											<!-- Metadata line: upgrades, custom, hash, schedule meta (pinned shown as alert above) -->
											{#if isCurrentVersionCustom || (rollout.status?.releaseCandidates?.length ?? 0) > 0 || (getRevisionInfo(latestEntry.version) && formatRevision(getRevisionInfo(latestEntry.version)!) !== getDisplayVersion(latestEntry.version)) || scheduleMetaText}
												<div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
													{#if rollout.status?.releaseCandidates && rollout.status.releaseCandidates.length > 0}
														<!--
															⭐ `available` MEANS `allowed`, AND A PIN ALLOWS
															NOTHING. (P10, operator-walk finding) This line said
															`↑ 1 upgrade available` while the panel one row down
															said the rollout is PINNED — `available` is a claim
															this dashboard would actually DEPLOY the candidate on
															its own, which is false the moment `wantedVersion` is
															set (see `blocking-story.ts`: a pin outranks every
															gate and refuses ALL builds). The count is still true
															and still worth a glance; the verb changes to name
															what is actually true.
														-->
														<span
															class="flex items-center gap-1 text-orange-700 dark:text-orange-400"
														>
															<ArrowUpOutline class="h-3 w-3" />
															{#if blockStory.pinnedTo}
																{rollout.status.releaseCandidates.length} newer · held by the pin
															{:else}
																{rollout.status.releaseCandidates.length}
																{rollout.status.releaseCandidates.length === 1
																	? 'upgrade'
																	: 'upgrades'} available
															{/if}
														</span>
													{/if}
													{#if isCurrentVersionCustom}
														<span class="font-medium text-yellow-700 dark:text-yellow-400"
															>Custom version</span
														>
													{/if}
													{#if getRevisionInfo(latestEntry.version) && formatRevision(getRevisionInfo(latestEntry.version)!) !== getDisplayVersion(latestEntry.version)}
														<span class="font-mono text-gray-500 dark:text-gray-400">
															{formatRevision(getRevisionInfo(latestEntry.version)!)}
														</span>
													{/if}
													<!--
														⭐ THE SCHEDULE'S "NOTHING WAITING" FACT LANDS HERE,
														NOT IN A BANNER. (F2, second re-check, 2026-09-03)
														See `scheduleMetaText`'s own comment: a closed deploy
														window with no candidate behind it is informational,
														so it takes the same quiet, one-line treatment as
														the upgrade count and the custom-version flag beside
														it, instead of the page's one banner slot.
													-->
													{#if scheduleMetaText}
														<span class="flex items-center gap-1 text-gray-500 dark:text-gray-400">
															<CalendarWeekSolid class="h-3 w-3" />
															{scheduleMetaText}
														</span>
													{/if}
												</div>
											{/if}
											<!-- ⭐ A ROLLUP, NOT A LOG. (2026-09-02, from the human:
											     *"on the rollout detail page, i would simplify the
											     'Commits deployed' — it can show how many changes
											     deployed, and the list of users maybe, but history really
											     needs to be on history page."*)

											     It used to be `expandable`: pressing it unfolded a list of
											     shas, subjects and author names INSIDE the status card — a
											     second history page, drawn twenty pixels under the tab
											     called History whose entire job that is, and which already
											     renders this same component with `showMessages` for every
											     deploy in the list.

											     What survives is what a rollup owes: HOW MANY changed
											     (`3 commits deployed`, `+42 −17 · 5 files`) and WHO made
											     them (the faces). The tail is given away, which is this
											     product's idiom for a tail everywhere else — `Show 8 ready
											     resources ›` is in the card to the right of this one.

											     No sentence was added to explain the move. Descriptive prose
											     on a detail page has been rejected here repeatedly; the
											     chevron and the fact that the whole row is one tap target
											     say it without words.

											     ⛔ AND IT MUST NAME THE DEPLOY, NOT THE PAGE. (2026-09-02,
											     from the human: *"this link on rollout page doesn't expand
											     the latest history entry. it should also navigate to it.
											     it's not obvious now when we click the button what changes
											     are for the latest deployment."*)

											     `…/history` alone landed the reader on a list with
											     everything collapsed — the changes they had just read the
											     summary of were now somewhere below, shut. The href carries
											     `?deploy=<revision>` now and the History tab opens exactly
											     that entry, rings it and puts focus on it. The key is
											     `deployKey`, shared with the resolver so there is one
											     spelling; see `history-deeplink.ts` for why it is a query
											     param and why it is the revision rather than the index.

											     THE RANGE IS THE SAME OBJECT ON BOTH SIDES. This summary is
											     `history[1] → history[0]`; the row it opens is index 0,
											     whose own `CommitSummary` is `history[0 + 1] → history[0]`.
											     Same component, same props, so the rollup and the row cannot
											     disagree about the count or the diffstat. -->
											{#if rollout?.status?.source && rollout.status.history && rollout.status.history.length > 1}
												{@const historyHref = rolloutPath(cluster, namespace, name, 'history')}
												{@const latestKey = deployKey(latestEntry)}
												<div class="mt-1.5">
													<!--
														⭐ P11: THE ROLLUP NAMES WHY IT HAS NOTHING TO SAY,
														RATHER THAN SAYING NOTHING. See `githubStatus`'s own
														comment. `CommitSummary`'s `query.isError` branch is
														deliberately silent for a LIST of these; this is the
														page's only one, so the fallback is drawn HERE rather
														than inside that shared component.
													-->
													{#if githubConnected}
														<CommitSummary
															{namespace}
															{name}
															{cluster}
															base={rollout.status.history[1]?.version?.revision}
															head={latestEntry.version?.revision}
															href={latestKey
																? `${historyHref}?${DEPLOY_PARAM}=${encodeURIComponent(latestKey)}`
																: historyHref}
															hrefLabel="Open this deploy in the history"
															showAvatars
															hideWhenEmpty
															class="-mx-1.5 rounded px-1.5 py-0.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
														/>
													{:else}
														<p class="text-xs text-gray-500 dark:text-gray-400">
															Commit message and author need GitHub. {githubAbsenceSentence(
																githubStatus.data
															)}
														</p>
													{/if}
												</div>
											{/if}
										</div>
									</div>
									<!-- Right: time -->
									<div class="shrink-0 text-right text-xs text-gray-500 dark:text-gray-400">
										<div
											class="flex items-center justify-end gap-1"
											title={formatDate(latestEntry.timestamp)}
										>
											<ClockSolid class="h-3 w-3" />
											<span>{formatTimeAgoCompact(latestEntry.timestamp, $now)}</span>
										</div>
									</div>
								</div>
							</div>
							<!-- Actions footer -->
							{#if canModify || rollout?.status?.source || rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
								<div
									class="flex flex-col gap-2 border-t border-gray-100 px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center dark:border-gray-700"
								>
									{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
										<SourceViewer
											namespace={rollout.metadata?.namespace || ''}
											name={rollout.metadata?.name || ''}
											version={latestEntry.version.tag}
											{cluster}
										/>
									{/if}
									{#if rollout?.status?.source}
										<Button
											size="sm"
											color="light"
											class="w-full justify-center sm:w-auto"
											href={getGitHubUrl(getDisplayVersion(latestEntry.version))}
											target="_blank"
											rel="noopener noreferrer"
										>
											<GithubSolid class="me-2 h-4 w-4" />
											View on GitHub
										</Button>
									{/if}
									{#if canModify}
										{#if rollout.spec?.wantedVersion && !isPinnedVersionCustom}
											<Button
												size="sm"
												color="light"
												class="w-full justify-center sm:w-auto"
												disabled={!isDashboardManagingWantedVersion || !!pendingAction}
												onclick={() => {
													showClearPinModal = true;
												}}
											>
												Clear pin
											</Button>
										{/if}
										<Button
											id="status-change-version-btn"
											size="sm"
											color="light"
											class="w-full justify-center sm:w-auto"
											disabled={!isDashboardManagingWantedVersion || !!pendingAction}
											onclick={() => {
												if (isDashboardManagingWantedVersion) {
													isPinVersionMode = false;
													selectedVersion = null;
													deployExplanation = '';
													requestChangeVersionModal();
												}
											}}
										>
											<EditOutline class="me-2 h-4 w-4" />
											Change Version
										</Button>
										<!-- ⛔ `Rollback` PRE-SELECTED `history[1]`, WHICH IS NOT
										     NECESSARILY OLDER. A live critic pressed it on a rollout
										     that had itself been rolled back and got a modal headed
										     *"Deploy 51b976a → aa17645"* — a roll-FORWARD — under a
										     caption reading "Required for rollback". The direction
										     logic downstream was right; the pre-selection was not, so
										     the button and its own modal disagreed on one screen.

										     `rollbackTarget` proves the target is older (release-list
										     position, else build creation time) and returns null when
										     nothing older exists. A `Rollback` with nothing to roll
										     back to is the label lying again, so the button is not
										     rendered at all in that case. -->
										{#if rollbackNow}
											<Button
												id="status-rollback-btn"
												size="sm"
												color="light"
												class="w-full justify-center sm:w-auto"
												disabled={!isDashboardManagingWantedVersion || !!pendingAction}
												title={rollbackNow.basis === 'ran-here'
													? `Go back to ${rollbackDisplay}, the last older version this environment ran${
															rollbackSkipped.length > 0
																? ` (skipping ${joinClauses(rollbackSkipped)} — newer than what is running now)`
																: ''
														}`
													: `Go back to ${rollbackDisplay}, the release directly below the one running (never deployed here)`}
												onclick={() => {
													const running = rollout?.status?.history?.[0]?.version;
													if (isDashboardManagingWantedVersion && rollbackNow && running) {
														isPinVersionMode = true;
														selectedVersion = rollbackNow.tag;
														const currentVersionName = getDisplayVersion(running);
														deployExplanation = `Rollback from ${currentVersionName} to ${rollbackDisplay} due to issues with the current deployment.`;
														requestChangeVersionModal();
													}
												}}
											>
												<ReplyOutline class="me-2 h-4 w-4" />
												Rollback to {rollbackDisplay}
											</Button>
										{/if}
										{#if !isDashboardManagingWantedVersion}
											<Tooltip
												triggeredBy="#status-change-version-btn"
												placement="bottom"
												transition={blur}
												transitionParams={{ duration: 300 }}
											>
												Version management disabled: This rollout's wantedVersion field is managed
												by another controller or external system. The dashboard cannot pin it to
												prevent conflicts.
											</Tooltip>
										{/if}
									{/if}
								</div>
							{/if}
						</div>

						<!-- PIPELINE CARD -->
						<DeploymentPipelineCard
							{rollout}
							{latestEntry}
							{pipelineValidRollouts}
							{pipelineValidTests}
							healthChecks={visibleHealthChecks}
							{canUpdate}
							{namespace}
							{name}
							{cluster}
							onContinue={continueRollout}
						/>

						<!-- Available Upgrades card (full width) -->
						<!-- ⭐ 8px, NOT 12px. (F10, 2026-09-03 re-check) This was the
						     only `rounded-xl` card on a page whose every other card
						     (`Card.svelte`, `DeploymentPipelineCard`, the resources
						     list) is `rounded-lg` (8px) — `COMPOSITION-GRAMMAR.md` §2
						     reserves 12px for the OUTERMOST panel (the hero status
						     card above, which deliberately has no header bar and is
						     not one of this stack's cards) and 8px for everything in
						     the stack. This card has a header bar and sits in the
						     stack, so it takes the stack's radius. -->
						<div
							class="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
						>
							<!-- Header -->
							<!--
								⭐ THE HEADER SLOT TAKES THE ROLLUP, NEVER A BUTTON BESIDE IT.
								(2026-09-03, F12) This was 57px — the chip/text answer PLUS a
								32px icon button — against every other card header on this page
								at the standard 47px. `COMPOSITION-GRAMMAR.md`'s slot is a
								rolled-up ANSWER (`3/3 healthy`, a chip, a `.nav-link` at rollup
								scale); a mutating control is not a rollup and does not belong
								beside one. The refresh action moves to its own thin row in the
								body, where `Chip`'s `Held`/pin banners already sit — a control
								row, not a header.
							-->
							<div
								class="flex min-h-[47px] items-center gap-2.5 border-b border-gray-100 px-5 py-3 dark:border-gray-700"
							>
								<CodeOutline class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" />
								<span class="text-sm font-semibold text-gray-900 dark:text-white"
									>Available Version Upgrades</span
								>
								<!--
									⭐ THE ROLLUP IS NOT CONDITIONAL ON HAVING SOMETHING TO SAY.
									(2026-09-02, `COMPOSITION-GRAMMAR.md` §1) It used to render the
									`Chip` only when candidates existed, so the common case — a rollout
									that IS current — reached a header with no right-aligned answer at
									all: title, icon, then straight to the refresh button. That is the
									headerless-box defect one level down, not fixed by having a title.
									`up to date` is the rollup's other value, in the same state-green
									the rest of the product answers this question with (`3/3 up to
									date`, `All up to date`).
								-->
								<div class="ml-auto flex items-center gap-2">
									{#if rollout.status?.releaseCandidates && rollout.status.releaseCandidates.length > 0}
										<!-- A count is a `count` chip, the same one every list header uses.
										     It was an orange-100 pill with an arrow — the only fill on the
										     card, and orange is not a role the budget owns. -->
										<Chip
											role="count"
											label="{rollout.status.releaseCandidates.length} newer"
										/>
									{:else if stillCatchingUp}
										<!-- ⭐ P10: NOT `up to date` YET. `releaseCandidates` is
										     already empty (nothing newer is ALLOWED) but the current
										     history entry hasn't settled — see `stillCatchingUp`'s own
										     comment. Same neutral ink `BakeStatusIcon`'s in-flight
										     states use elsewhere on this page; green is reserved for
										     the verdict actually being true. -->
										<span class="text-xs font-medium text-gray-500 dark:text-gray-400"
											>{bakeWord(latestEntry.bakeStatus)}…</span
										>
									{:else}
										<span class="text-xs font-medium text-green-700 dark:text-green-400"
											>up to date</span
										>
									{/if}
								</div>
							</div>

							<!-- ⭐ THE REFRESH CONTROL, NOW A BODY ROW. It is a MUTATING
							     control (re-runs the Flux reconcile), so it earns button
							     chrome — just not in the slot COMPOSITION-GRAMMAR reserves
							     for the card's own rolled-up answer. Always present: staleness
							     is possible whatever the candidate count reads. -->
							<div
								class="flex items-center justify-end border-b border-gray-100 px-5 py-1.5 dark:border-gray-700"
							>
								<button
									id="refresh-versions-btn"
									onclick={reconcileFluxResources}
									disabled={isReconciling}
									aria-label="Refresh available versions"
									class="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
								>
									{#if isReconciling}
										<StatusSpinner size="4" color="gray" />
									{:else}
										<RefreshOutline class="h-3.5 w-3.5" />
									{/if}
									Refresh
								</button>
								<Tooltip triggeredBy="#refresh-versions-btn" placement="bottom">
									Refresh available versions
								</Tooltip>
							</div>

							<!--
								⭐ THE PROVIDER FACT. This rollout's own upgrade state ("up to
								date", "N candidates") answers a different question than
								"is anyone waiting on ME" — a reader could see a green tick
								here and never learn that three other rollouts are held on
								this one's contract. Renders only when something IS held;
								silent otherwise, so a rollout that provides nothing to
								anyone gains no new furniture.
							-->
							{#if heldByThis}
								<div
									class="flex items-start gap-3 border-b border-orange-100 bg-orange-50 px-5 py-2.5 dark:border-orange-900/30 dark:bg-orange-900/10"
								>
									<ShareNodesSolid
										class="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-600 dark:text-orange-400"
									/>
									<p class="min-w-0 flex-1 text-xs text-orange-800 dark:text-orange-300">
										Holding {heldByThis.count} rollout{heldByThis.count === 1 ? '' : 's'} — {heldByThis.subjects}
										{heldByThis.plural ? 'need' : 'needs'} {heldByThis.need}.
										<a href={rolloutPath(cluster, namespace, name, 'dependencies')} class="nav-link"
											>See Dependencies</a
										>
									</p>
								</div>
							{/if}

							<!-- Pin warning (compact banner) -->
							{#if rollout.spec?.wantedVersion && !isPinnedVersionCustom}
								<div
									class="flex items-center gap-3 border-b border-amber-100 bg-amber-50 px-5 py-2.5 dark:border-amber-900/30 dark:bg-amber-900/20"
								>
									<PauseSolid class="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
									<p class="min-w-0 flex-1 text-xs text-amber-700 dark:text-amber-300">
										Automatic deploys paused — this rollout is pinned to a version.
									</p>
									{#if canModify}
										<Button
											size="xs"
											color="light"
											class="shrink-0"
											disabled={!isDashboardManagingWantedVersion || !!pendingAction}
											onclick={() => {
												showClearPinModal = true;
											}}
										>
											Clear pin
										</Button>
									{/if}
								</div>
							{/if}

							<!-- Release candidates -->
							{#if rollout.status?.releaseCandidates && rollout.status.releaseCandidates.length > 0}
								<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
									{#each rollout.status.releaseCandidates as releaseCandidate}
										{@const version = releaseCandidate.tag}
										{@const blockingGates = getBlockingGates(version)}
										{@const isBlocked = blockingGates.length > 0}
										{@const depInfo = getDependencyStatus(version)}
										<li class="flex items-center gap-3 px-5 py-3.5">
											<!-- Version info -->
											<div class="min-w-0 flex-1">
												<div class="flex flex-wrap items-center gap-1.5">
													<span
														class="font-mono text-sm font-semibold text-gray-900 dark:text-white"
													>
														{getDisplayVersion(releaseCandidate)}
													</span>
													{#if isBlocked}
														{@const held = classifyBlockingGates(version)}
														<!--
															⛔ THE WORD HERE HAS BEEN WRONG TWICE. See
															`classifyBlockingGates` above for the full account.

															`Blocked` sat twelve pixels from an enabled `Deploy`
															button that ignores the gate, so a UX critic read it
															as "this cannot ship" and pressed the button to prove
															it wrong. The correction over-shot: `Manual only`
															asserts a PERMANENT property of the build, and gates
															get unlocked — a schedule window reopens and that
															same version promotes itself.

															`Held by a gate` is what the old word got right (a
															current state, and it names GATES so the chip points
															at the gate cards below) without what it got wrong
															(it does not say the `Deploy` button will refuse).
															What clears it is in the hover, which has room, and
															comes from the same classification the page banner
															reads — so the chip and its own tooltip cannot drift
															apart again.

															Same span, same yellow, same 12px.
														-->
														<!-- A `button`, not a `span`: flowbite's `Popover` makes its
														     trigger focusable, so this was already a tab stop on every
														     release-candidate row with no role at all. Flex item either
														     way, preflight strips the button chrome — same 12px, same
														     yellow, same pill. -->
														<button
															type="button"
															aria-label={`${getDisplayVersion(releaseCandidate)} — ${heldTitle(held).toLowerCase()}. ${heldClears(held)} A deploy you start by hand still applies immediately.`}
															class="inline-flex cursor-help items-center gap-1 rounded text-xs"
														>
															<!-- `held` is a gate correctly refusing a candidate, not an
															     adverse outcome — `role="blocked"` (red) was the wrong
															     word wearing the wrong ink; a held rollout is not failing
															     or diverged. `role="held"` aliases the same deep orange
															     every status disc in the product already resolves `held`
															     to (`getStatusCircleClass`), and the orange pin banner
															     30px above says the identical thing. The Dependencies tab
															     draws its own `Chip role="blocked" label="held"` from a
															     separate template (not shared markup) and still needs
															     the same fix — flagged to the graph lane. -->
															<Chip role="held" label="held" />
															<span class="text-gray-500 dark:text-gray-400">{heldWord(held)}</span>
															<QuestionCircleOutline class="h-3 w-3 text-gray-500 dark:text-gray-400" aria-hidden="true" />
														</button>
														<Popover class="max-w-sm text-sm" title={heldTitle(held)}>
															<div class="space-y-2 p-1">
																<p class="text-xs text-gray-600 dark:text-gray-300">
																	{heldClears(held)} Nothing promotes this version automatically while
																	it is held. Pressing
																	<span class="font-medium text-gray-900 dark:text-white"
																		>Deploy</span
																	> applies it immediately — gates only hold back automatic promotion.
																</p>
																{#each blockingGates as gate}
																	<!-- WHAT CLEARS THIS ONE, from the same join
																	     `BlockingStoryLines` renders in the banner above.
																	     `Status: <enum>` further down is the controller's own
																	     word and is a handle, not an explanation. -->
																	{@const clears = held.find((h) => h.id === gate.metadata?.name)}
																	<div class="flex items-start gap-2">
																		<ExclamationCircleSolid
																			class="mt-0.5 h-4 w-4 shrink-0 text-yellow-700 dark:text-yellow-400"
																		/>
																		<div class="min-w-0">
																			<p class="font-medium text-gray-900 dark:text-white">
																				{getGatePrettyName(gate) ||
																					gate.metadata?.name ||
																					'Unknown Gate'}
																			</p>
																			{#if getGateDescription(gate)}
																				<p class="text-xs text-gray-500 dark:text-gray-400">
																					{getGateDescription(gate)}
																				</p>
																			{/if}
																			{#if clears}
																				<p class="text-xs text-gray-500 dark:text-gray-400">
																					{clears.short}
																				</p>
																			{/if}
																			{#if gate.status?.status}
																				<p class="text-xs text-yellow-700 dark:text-yellow-400">
																					Status: {gate.status.status}
																				</p>
																			{/if}
																		</div>
																	</div>
																{/each}
															</div>
														</Popover>
													{:else}
														<span
															class="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
														>
															Ready
														</span>
													{/if}
												</div>
												<div
													class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
												>
													{#if releaseCandidate.created}
														<span
															class="flex items-center gap-1"
															title={formatDate(releaseCandidate.created)}
														>
															<ClockSolid class="h-3 w-3" />
															{formatTimeAgoCompact(releaseCandidate.created, $now)}
														</span>
													{/if}
													{#if depInfo}
														{@const valueColor = getBakeStatusColor(depInfo.bakeStatus)}
														<JoinedBadge
															label="{depInfo.env} env"
															value={bakeWord(depInfo.bakeStatus)}
															{valueColor}
															title={bakeTitle(depInfo.bakeStatus)}
														>
															{#snippet icon()}
																<BakeStatusIcon bakeStatus={depInfo.bakeStatus} size="small" />
															{/snippet}
														</JoinedBadge>
													{/if}
												</div>
											</div>

											<!-- Actions -->
											<div class="flex shrink-0 items-center gap-1.5">
												{#if rollout?.status?.source}
													<Button
														size="xs"
														color="light"
														class="!p-1.5"
														title={`View ${getDisplayVersion(releaseCandidate)} on GitHub`}
														aria-label={`View ${getDisplayVersion(releaseCandidate)} on GitHub`}
														onclick={() => {
															let url = rollout?.status?.source ?? '';
															const ver = getDisplayVersion(releaseCandidate);
															if (url.includes('github.com')) {
																url = url.endsWith('/')
																	? url + 'tree/' + ver
																	: url + '/tree/' + ver;
															} else if (url.includes('git@github.com:')) {
																url =
																	url.replace('git@github.com:', 'https://github.com/') +
																	'/tree/' +
																	ver;
															} else if (url.includes('.git')) {
																url = url.replace('.git', '') + '/tree/' + ver;
															} else {
																url = url.endsWith('/')
																	? url + 'tree/' + ver
																	: url + '/tree/' + ver;
															}
															window.open(url, '_blank');
														}}
													>
														<GithubSolid class="h-3.5 w-3.5" />
													</Button>
												{/if}
												<!-- Was `Clipboard` with an icon-only snippet: a button
												     with NO accessible name, nineteen of them on this
												     page, that reported a blocked clipboard only to
												     devtools. See `CopyButton.svelte`. -->
												<CopyButton
													value={releaseCandidate.tag}
													label={`version ${getDisplayVersion(releaseCandidate)}`}
													class="!p-1.5"
												/>
												{#if canModify}
													<!--
														⭐ F4: `size="sm"`, NOT `size="xs"`. (2026-09-03,
														breakpoints pass) This is the one `.btn-primary`-weight
														action in the release-candidate list — deploying a
														build — and it was rendering SMALLER than every
														secondary control on the page: measured 66×32px/12px
														here against 38px/14px on `View on GitHub`, `Change
														Version` and `Rollback` above (all `size="sm"`). A
														primary action may not be the smallest control on its
														own page. The row's icon-only siblings (`View on
														GitHub`, copy) stay `xs` — they are utilities, not the
														row's verb.
													-->
													<Button
														size="sm"
														color="blue"
														aria-label={`Deploy version ${getDisplayVersion(releaseCandidate)}`}
														disabled={(!isDashboardManagingWantedVersion &&
														!hasForceDeployAnnotation(rollout)) ||
														!!pendingAction}
														onclick={() => {
															selectedVersion = version;
															const isCustom = isSelectedVersionCustom(version);
															isPinVersionMode = isOlderThanCurrent(version) || isCustom;
															deployExplanation = '';
															requestChangeVersionModal();
														}}
													>
														Deploy
													</Button>
												{/if}
											</div>
										</li>
									{/each}
								</ul>
							{:else if isCurrentVersionCustom}
								<div class="p-5">
									<!--
										INK ONLY, AND IT IS THE SECOND HALF OF THE SAME DEFECT. Flowbite's
										`yellow` Alert paints `bg-yellow-100 text-yellow-500` in light and
										`dark:bg-yellow-200 dark:text-yellow-600` in dark — the same 1.78:1 /
										2.53:1 pair the missing-release banner was rebuilt out of. Leaving one
										of the two behind is precisely the "minority spelling survives the
										sweep" failure this pass exists to end.

										The fill is light in BOTH themes here (Flowbite paints `dark:bg-yellow-200`),
										so one ink serves both — but `yellow-700` on `yellow-200` is only
										4.24:1, so the fill is pinned to `yellow-100` in dark as well and
										`text-yellow-700` on `bg-yellow-100` is already the product's own
										spelling for yellow ink on a yellow fill (`HealthChecksCard:111`,
										`ResourcesCard` x4, the held-by-a-gate chip). Zero new colour values,
										and the composition of this card is untouched.
									-->
									<Alert
										color="yellow"
										class="bg-yellow-100 text-yellow-700 dark:bg-yellow-100 dark:text-yellow-700"
									>
										<div class="flex items-center gap-3">
											<InfoCircleSolid class="h-5 w-5" />
											<span class="text-lg font-medium">Current version is custom</span>
										</div>
										<p class="mt-2 mb-4 text-sm">
											The currently deployed version is not in the available releases list. This
											means it's a custom version that was manually deployed. To change to a
											different version, you need to manually deploy another version.
										</p>
										<div class="flex gap-2">
											<Button
												size="xs"
												color="light"
												onclick={() => {
													isPinVersionMode = true;
													selectedVersion = null;
													deployExplanation = '';
													requestChangeVersionModal();
												}}
											>
												<EditOutline class="me-2 h-4 w-4" />
												Change Version
											</Button>
										</div>
									</Alert>
								</div>
							{/if}
							<!--
								⛔ THE `up to date` EMPTY STATE — A CENTRED 32px CHECK PLUS
								`Up to date — no upgrades available` IN A 40px-PADDED
								BODY — USED TO RENDER HERE UNCONDITIONALLY IN THE FINAL
								BRANCH, AND IT WAS THE CARD'S ROLLUP RESTATED. (P9, second
								re-check, finding 14) The header 32px above already answers
								the question this body existed to answer — the `up to date`
								pill IS the green tick — so an up-to-date rollout spent
								710×230 (measured) drawing one fact twice. When there ARE no
								candidates and the current version is not custom, the card
								now collapses to its header and the refresh row: the ONLY
								action left to take ("check again") stays reachable, the
								restatement does not. `heldByThis` and the pin banner above
								are untouched — those are facts the header does not carry.
							-->
						</div>
					</div>
					<div class="flex flex-col gap-4">
						{#if datadogServiceInfo}
							<div
								class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
							>
								<!-- ⭐ `min-h-[47px]`, LIKE EVERY OTHER CARD HEADER. (NIT,
								     2026-09-03 re-check) This was a hand-rolled header with
								     no height floor — 45px, against the 47px `Card.svelte`
								     enforces everywhere else, because a header with no
								     rollup measures a line box 2px shorter than one with a
								     chip on it. Same fix `Card.svelte`'s own doc comment
								     already made the rule for. -->
								<div
									class="flex min-h-[47px] items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
								>
									<ArrowUpRightFromSquareOutline class="h-4 w-4 text-gray-500 dark:text-gray-400" />
									<h2 class="text-sm font-semibold text-gray-900 dark:text-white">
										External Links
									</h2>
								</div>
								<div class="divide-y divide-gray-100 dark:divide-gray-700">
									{#if datadogServiceInfo}
										<a
											href={datadogServiceInfo.url}
											target="_blank"
											rel="noopener noreferrer"
											class="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/30"
										>
											<DatadogLogo class="h-4 w-4 flex-shrink-0 text-[#632CA6]" />
											<div class="min-w-0 flex-1">
												<span class="text-sm text-gray-700 dark:text-gray-300"
													>{datadogServiceInfo.service}</span
												>
												<span class="ml-1.5 text-xs text-gray-500 dark:text-gray-400"
													>APM service</span
												>
											</div>
											<ArrowUpRightFromSquareOutline
												class="h-3 w-3 flex-shrink-0 text-gray-500 dark:text-gray-400"
											/>
										</a>
									{/if}
								</div>
							</div>
						{/if}
						<!--
							⭐ `windowStart` IS `errorCutoff`, THE SAME OBJECT THAT ALREADY
							DECIDES WHICH FAILURES THIS PANEL SHOWS — and the same
							`max(deployedAt, lastRetryAt)` the rollout controller calls
							`errorCutoff` in its own bake loop. A check that PASSES with a
							`lastErrorTime` inside it now reads *"passing, last errored 2m
							ago"* instead of vanishing into `4/4 healthy`. One cutoff, so the
							panel cannot hide a failure on one rule and forget a recovery on
							another.
						-->
						<HealthChecksCard healthChecks={visibleHealthChecks} windowStart={errorCutoff} />
						<ResourcesCard
							{kustomizations}
							{ociRepositories}
							{filteredManagedResources}
							{cluster}
						/>
						<EventsCard {events} deployedAt={errorCutoff} />
					</div>
				</div>
				</div>
			{:else}
				<!-- No deploy yet — minimal but informative empty state -->
				<div class="mx-auto max-w-2xl py-6">
					<div
						class="flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800"
					>
						<div
							class="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700"
						>
							<ClockSolid class="h-5 w-5 text-gray-500 dark:text-gray-400" />
						</div>
						<h2 class="text-base font-semibold text-gray-900 dark:text-white">No deploys yet</h2>
						<p class="mt-1 max-w-md text-sm text-gray-500 dark:text-gray-400">
							{rollout.status?.title ?? rollout.metadata?.name} hasn't received its first deploy. Once
							a version is selected and the controller deploys it, this page will fill in with the deployment
							pipeline, health checks, and history.
						</p>
						{#if (rollout.status?.releaseCandidates?.length ?? 0) > 0}
							<div class="mt-5 w-full">
								<div
									class="t-label text-left text-gray-500 dark:text-gray-400"
								>
									{rollout.status?.releaseCandidates?.length} release candidate{rollout.status
										?.releaseCandidates?.length === 1
										? ''
										: 's'} available
								</div>
								<ul
									class="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-700/60 dark:border-gray-700"
								>
									{#each rollout.status?.releaseCandidates?.slice(0, 5) ?? [] as rc}
										<li class="flex items-center justify-between px-3 py-2 text-left">
											<span class="font-mono text-sm text-gray-800 dark:text-gray-200"
												>{getDisplayVersion(rc)}</span
											>
											{#if rc.created}
												<span class="font-mono text-[10px] text-gray-500 dark:text-gray-400"
													>{formatTimeAgoCompact(rc.created, $now)}</span
												>
											{/if}
										</li>
									{/each}
								</ul>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<Modal bind:open={showMarkSuccessfulModal} title="Mark Deployment as Successful">
	<div class="space-y-4">
		<Alert color="green" class="mb-4">
			<div class="flex items-center">
				<CheckCircleSolid class="mr-2 h-4 w-4" />
				<p>
					<span class="font-medium">Mark as Successful:</span> This will mark the failed deployment as
					successful and update the deployment history.
				</p>
			</div>
		</Alert>
		<p class="text-sm text-gray-600 dark:text-gray-400">
			Are you sure you want to mark the deployment for <b>{rollout?.metadata?.name}</b> as successful?
		</p>
		<p class="text-xs text-gray-500 dark:text-gray-400">
			This will update the deployment history to show the deployment as succeeded and end the check
			window now.
		</p>
		<Alert color="blue" class="mt-3">
			<div class="flex items-center">
				<InfoCircleSolid class="mr-2 h-4 w-4" />
				<p class="text-sm">
					<span class="font-medium">Alternative:</span> You can also deploy a different version to fix
					the deployment issue instead of marking this one as successful.
				</p>
			</div>
		</Alert>

		<!-- Message field -->
		<div>
			<label
				for="mark-successful-message"
				class="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
			>
				Message (Optional)
			</label>
			<textarea
				id="mark-successful-message"
				bind:value={markSuccessfulMessage}
				placeholder="Provide additional details about why you're marking this deployment as successful..."
				class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
				rows="3"
			></textarea>
		</div>

		<div class="flex justify-end gap-2">
			<Button
				color="light"
				onclick={() => {
					showMarkSuccessfulModal = false;
					markSuccessfulMessage = '';
				}}
			>
				Cancel
			</Button>
			<Button color="green" onclick={() => markDeploymentSuccessful(markSuccessfulMessage)}>
				<CheckCircleSolid class="mr-1 h-3 w-3" />
				Mark Successful
			</Button>
		</div>
	</div>
</Modal>

<!--
	⛔ THIS PROMISED SOMETHING IT COULD NOT KEEP. It said "Automated upgrades
	will resume and the rollout will advance to the latest release candidate" —
	unconditionally. A live UX critique cleared the pin on a rollout whose
	schedule gate was closed and it advanced ZERO. `clearPinOutcome` reads the
	rollout's OTHER holds and says which sentence is true right now.

	⭐ AND IT NOW LIVES IN A COMPONENT. The critique's next finding was that
	`Release the hold` on `/apps` and `/apps/<name>` could not reach this
	dialog at all — it opened a version picker with no way to clear a pin, two
	pages from the real control. The dialog moved into `ClearPinModal` so the
	button that names the act can perform it, with ONE copy of the wording the
	critic called the best in the product.
-->
<ClearPinModal
	bind:open={showClearPinModal}
	{rollout}
	{cluster}
	{autoDeploy}
	toast={false}
	onSuccess={(m) => {
		toastType = 'success';
		toastMessage = m;
		showToast = true;
		setTimeout(() => (showToast = false), 3000);
		rolloutQuery.refetch();
		justClearedPin = true;
		setTimeout(() => (justClearedPin = false), 8000);
	}}
	onError={(m) => {
		toastType = 'error';
		toastMessage = m;
		showToast = true;
		setTimeout(() => (showToast = false), 3000);
	}}
/>

<ChangeVersionModal
	bind:open={showChangeVersionModal}
	{rollout}
	{autoDeploy}
	{isPinVersionMode}
	initialSelectedVersion={selectedVersion}
	initialExplanation={deployExplanation}
	{cluster}
	environmentName={environment?.spec?.environment ?? null}
	onDeployStart={beginPendingAction}
	onSuccess={(m) => {
		toastType = 'success';
		toastMessage = m;
		showToast = true;
		setTimeout(() => (showToast = false), 3000);
		// The mutation is DONE now (unlike `onDeployStart`, which fires
		// before it) — an explicit refetch here is what actually shrinks
		// the poll gap `pendingAction` is bridging, rather than waiting for
		// the next scheduled interval.
		void rolloutQuery.refetch();
	}}
	onError={(m) => {
		toastType = 'error';
		toastMessage = m;
		showToast = true;
		setTimeout(() => (showToast = false), 3000);
	}}
/>

<RecoveryModeWarningModal
	bind:open={showRecoveryWarningModal}
	reason={recoveryWarningReason}
	versionDisplay={selectedVersionDisplay()}
	onContinue={() => {
		showChangeVersionModal = true;
	}}
/>

<Toast
	transition={fly}
	position="top-right"
	params={{ x: 200 }}
	class="fixed top-24 right-4 z-50 rounded-lg"
	align={false}
	bind:toastStatus={showToast}
	color={toastLoading
		? 'blue'
		: toastType === 'success'
			? 'green'
			: toastType === 'info'
				? 'gray'
				: 'red'}
	classes={{ icon: toastLoading ? '!bg-transparent' : '' }}
>
	{#snippet icon()}
		{#if toastLoading}
			<StatusSpinner size="5" color="blue" />
		{:else if toastType === 'success'}
			<CheckCircleSolid class="h-5 w-5" />
		{:else if toastType === 'info'}
			<CheckCircleSolid class="h-5 w-5" />
		{:else}
			<ExclamationCircleSolid class="h-5 w-5" />
		{/if}
	{/snippet}
	{toastMessage}
</Toast>

<style>
	/*
	 * ⭐ F4: THE MAIN/RAIL SPLIT IS A CONTAINER QUERY. See the doc comment on
	 * `.ov-split` in the markup for the measurement and the derivation of
	 * the 1080px threshold. `.ov-split-cq` is the query subject (this
	 * component's own content column, already capped at `max-w-7xl` two
	 * levels up); `.ov-split` is the grid that used to be `lg:grid
	 * lg:grid-cols-[3fr_minmax(22rem,2fr)] lg:items-start`, byte-identical
	 * below the threshold and above it.
	 */
	.ov-split-cq {
		container-type: inline-size;
	}

	@container (min-width: 1080px) {
		.ov-split {
			display: grid;
			grid-template-columns: 3fr minmax(22rem, 2fr);
			align-items: start;
		}
	}
</style>
