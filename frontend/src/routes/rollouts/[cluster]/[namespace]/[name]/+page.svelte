<svelte:options runes={true} />

<script lang="ts">
	import { availableReleases, releaseCandidates } from '$lib/releases/registry.svelte';
	import { kruiseStatusIsPreviousDeploy, freshestKruise } from '$lib/pipeline';
	import { sourceDashboardURL } from '$lib/source-dashboard';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import ReleaseSourceNotice from '$lib/components/ReleaseSourceNotice.svelte';
	import { releaseSourceRequiredMessage } from '$lib/releases/catalogue';
	import { releasesOf } from '$lib/releases/registry.svelte';
	import { chainWaitLabel, skippedPredicate, stageBuilds } from '$lib/view-models/skipped-builds';
	import { clusterErrorsFor } from '$lib/view-models/cluster-errors';
	import { sourceTreeUrl } from '$lib/source-url';
	import HeldGlyph from '$lib/components/HeldGlyph.svelte';
	import { canHover } from '$lib/can-hover.svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { gitRef } from '$lib/git-ref';
	import { page } from '$app/state';
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
	import { Tooltip, Popover } from 'flowbite-svelte';
	import Toast from '$lib/components/Toast.svelte';
	import {
		CodePullRequestSolid,
		UndoOutline,
		EditOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		InfoCircleSolid,
		CodeOutline,
		ClockSolid,
		ClockOutline,
		ClockArrowOutline,
		PlaySolid,
		RefreshOutline,
		CalendarWeekSolid,
		ChevronDownOutline,
		ChevronUpOutline,
		ArrowUpRightFromSquareOutline,
		ArrowUpOutline,
		GithubSolid,
		ChevronRightOutline,
		ShareNodesSolid
	} from 'flowbite-svelte-icons';
	import {
		formatTimeAgoCompact,
		formatDate,
		isFieldManagedByManager,
		isFieldManagedByOtherManager,
		hasForceDeployAnnotation,
		hasFailedBakeStatus,
		hasUnblockFailedAnnotation,
		getDisplayVersion,
		extractURLFromGatewayOrIngress,
		detectStuck
	} from '$lib/utils';
	import { pollWhenHealthy, staleTimeWhenHealthy, apiFetch } from '$lib/api/errors';
	import { repoKeyFor, repoSlug } from '$lib/version-utils';
	import { href } from '$lib/paths';
	import { autoDeployState, rollbackWent, rollbackNext } from '$lib/view-models/auto-deploy';
	import { prettyNameOf } from '$lib/view-models/gate-name';
	import { detectRollback } from '$lib/rollout-cards';
	import StuckBadge from '$lib/components/StuckBadge.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StarToggle from '$lib/components/StarToggle.svelte';
	import PromotionLane from '$lib/components/PromotionLane.svelte';
	import { buildLanes } from '$lib/view-models/promotion-lanes';
	import { buildRolloutCards } from '$lib/rollout-cards';
	import type { RolloutCard } from '$lib/rollout-cards';
	import { waitsFor, verdictForGates, causeLabelForGates } from '$lib/view-models/held';
	import Chip from '$lib/components/Chip.svelte';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import ChangeVersionFlow from '$lib/components/ChangeVersionFlow.svelte';
	import { outageEscalation } from '$lib/view-models/outage-escalation.svelte';
	import CopyButton from '$lib/components/CopyButton.svelte';
	import { announce } from '$lib/stores/announce.svelte';
	import { afterNavigate, replaceState } from '$app/navigation';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import { ledgerSpine } from '$lib/ledger-spine';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import FailurePanel from '$lib/components/FailurePanel.svelte';
	import { smoothHeight } from '$lib/smooth-height';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import FactList from '$lib/components/FactList.svelte';
	import NotFound from '$lib/components/NotFound.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import DeploymentPipelineCard from '$lib/components/DeploymentPipelineCard.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import StatusSpinner from '$lib/components/StatusSpinner.svelte';
	import ScheduleStatus from '$lib/components/ScheduleStatus.svelte';
	import { dependencyOnlyHold } from '$lib/view-models/dependency-hold';
	import BlockingStoryPanel from '$lib/components/BlockingStoryPanel.svelte';
	import {
		buildGateContext,
		withSchedules,
		blockingStory,
		classifyGate,
		joinClauses,
		upstreamVerdict,
		isPluralSubject,
		holdCausePhrase,
		contractHoldClause,
		contractHoldSlots,
		type ClassifiedGate,
		type ContractHold,
		type ContractHolds
	} from '$lib/view-models/blocking-story';
	import {
		buildRolloutGraph,
		nodeId,
		heldSubjects,
		contractHeldVersionsFor,
		contractHoldsForRollout,
		type GraphNode
	} from '$lib/view-models/dependency-graph';
	import { compareEnvironmentNames } from '$lib/env-order';
	import {
		healthGateCounts,
		healthGateHolding,
		healthGateCountsLabel
	} from '$lib/view-models/health-witness';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import GateLines from '$lib/components/GateLines.svelte';
	import ClearPinModal from '$lib/components/ClearPinModal.svelte';
	import { bakeWord, bakeTitle } from '$lib/bake-status';
	import {
		rollbackTarget,
		rolloutEnvironmentName,
		failedHereVerdict,
		rowShowsFailed
	} from '$lib/view-models/deploy-risk';
	import { blockingGateNames, promotionCandidates } from '$lib/view-models/promotion';
	import { behindWhenSettled, fleetSettled } from '$lib/view-models/behind';
	import DatadogLogo from '$lib/components/DatadogLogo.svelte';
	import HealthChecksCard from '$lib/components/HealthChecksCard.svelte';
	import ResourcesCard from '$lib/components/ResourcesCard.svelte';
	import EventsCard from '$lib/components/EventsCard.svelte';
	import { fly, blur } from 'svelte/transition';
	import {
		getEnvironmentThemeStyle,
		getRolloutEnvironmentTheme,
		shortEnvLabel
	} from '$lib/environment-theme';

	import {
		buildTopology,
		lockstepMismatch,
		canonicalTier,
		deployNameOf,
		siteNodeOf,
		upstreamOf
	} from '$lib/view-models/sites-waves';
	import { rolloutPath, rolloutMatchesEnvironment, SOURCE_CLUSTER_ANNOTATION } from '$lib/source-dashboard';
	import { DEPLOY_PARAM, deployKey } from '$lib/history-deeplink';
	import { formatTimeUntil } from '$lib/api/schedules';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		rolloutQueryOptions,
		rolloutsListQueryOptions,
		rolloutPermissionsQueryOptions
	} from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey, githubAbsenceSentence } from '$lib/api/github';
	import { createLoadFailedLatch } from '$lib/view-models/load-failed-latch.svelte';
	import { apiPath } from '$lib/api/urls';
	import { healthChecksQueryOptions } from '$lib/api/health-checks';
	import { flowHealthChecksFor } from '$lib/view-models/change-version-entry';
	import { pageTitle } from '$lib/page-title';

	// Params (runes)
	const namespace = $derived(page.params.namespace as string);
	const name = $derived(page.params.name as string);
	// The cluster name is embedded in the route path. The hub's spoke-proxy
	// middleware resolves it and forwards every API call (including mutations) to
	// that cluster, so the UI behaves identically regardless of source.
	const cluster = $derived(page.params.cluster as string);

	// Query for rollout - fetches all rollout data including kustomizations, ociRepositories, rolloutGates
	// ⭐ CLUSTER-AWARE — this page's OWN rollout, so it passes `cluster`
	// (the `[cluster]` route segment) rather than inheriting the app-wide
	// default's fleet-wide "every cluster must be up" gate. A sibling spoke
	// being down must not slow this page down when ITS cluster is healthy.
	// ⭐ PERF-2026-09-04 — lifted from the old 60s/30s healthy ceilings to the
	// app-wide 300s/120s defaults (see root `+layout.svelte`'s `QueryClient`);
	// `cluster` still rides both so this stays scoped to THIS rollout's own
	// spoke rather than the fleet-wide "every cluster up" gate.
	// QA #3: the fleet list names the spokes the hub could not read; if this rollout's cluster is one, the page says its data is stale.
	// No cadence of its own: the app-wide defaults apply (300s while the stream is healthy), and a cluster dropping on the SSE `clusters`
	// event invalidates ['rollouts','all'] (events.ts), so the notice still appears within seconds.
	const fleetListQuery = createQuery(() => rolloutsListQueryOptions());
	const myClusterErrors = $derived(clusterErrorsFor(fleetListQuery.data?.clusterErrors, cluster));
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name,
			cluster,
			options: {
				refetchInterval: pollWhenHealthy(5000, 300_000, cluster),
				staleTime: staleTimeWhenHealthy(1000, 120_000, cluster)
			}
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
	// ⭐ PERF-2026-09-04 §C.7 SLICE 4 — STREAM-AWARE (see RolloutGrid.svelte).
	// Lifted to the app-wide 300s healthy ceiling.
	const listQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { refetchInterval: pollWhenHealthy(15000, 300_000) } })
	);

	// Query for permissions - checks if user can update/patch rollouts
	// ⭐ ITEM 2 (AD palette round 8): `enabled: false` once the rollout query
	// has hard-failed — there is nothing to grant permissions ON while the
	// tab itself can't load, and this is one of the two background queries
	// named for contributing to the outage request storm (the other is
	// Gates' `schedulesQuery`, see that page's identical note).
	const permissionsQuery = createQuery(() => ({
		...rolloutPermissionsQueryOptions({
			namespace,
			name,
			cluster
		}),
		enabled: !rolloutQuery.isError
	}));

	// Derived permissions state
	const canUpdate = $derived(permissionsQuery.data?.permissions?.update ?? false);
	const canPatch = $derived(permissionsQuery.data?.permissions?.patch ?? false);
	// Most actions require update permission, but some (like force-deploy, bypass-gates) use patch
	const canModify = $derived(canUpdate || canPatch);
	/** the one PR the header's head commit maps to (set by the header CommitSummary) */
	let hdrPullNumber = $state<number | null>(null);
	/**
	 * ⭐ "NOT YET KNOWN" IS A THIRD STATE, DISTINCT FROM `canModify`'S
	 * DEFAULT-FALSE. (2026-09-04, load-state audit finding 1: "action row
	 * gains `Change Version` + `Rollback` when permissions arrive.")
	 * `canModify`'s `?? false` default made "waiting on `/permissions`" and
	 * "confirmed: no permission" render identically — zero action buttons —
	 * so the row went from `View on GitHub` alone to `View on GitHub, Change
	 * Version, Rollback to X` the instant permissions resolved true, for the
	 * (common) case of an operator who DOES have permission. The action row
	 * below reads this to render Change Version/Rollback/Clear pin as
	 * DISABLED placeholders while `true`, so `View on GitHub` never stands
	 * alone only to grow siblings a moment later.
	 */
	const permissionsKnown = $derived(!permissionsQuery.isPending);

	// Maintain existing local vars used throughout
	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	/** the controller's `ReleaseSourceRequired` message: this Rollout has no release source, so it has no releases to compare */
	const noSource = $derived(releaseSourceRequiredMessage(rollout));
	/** a rollout with a ReleaseSource whose catalogue has not arrived yet: say so, never "on the newest" */
	const releasesLoading = $derived(releasesOf(rollout).state === 'loading');
	// Failure panel collapse (2026-09-26, film critic 25): the panel used to
	// vanish in one frame when the failure cleared, the page reflowing upward by
	// its height. Svelte's own `transition:slide` runs on the Web Animations
	// API, which the film's capture harness (CDP virtual time + BeginFrame)
	// does not advance — measured: still one frame — while CSS transitions do.
	// So the panel stays mounted (up to 1 s) after the failure clears while it
	// collapses — `AlertPanel`'s own `open` (a CSS grid-row transition, 300 ms,
	// symmetric ease, props frozen at their last open values so nothing inside
	// it changes height first). Generalised there 2026-10-08 so every banner
	// leaves the same way.
	const isFailedNow = $derived(
		!!rollout && hasFailedBakeStatus(rollout) && !hasUnblockFailedAnnotation(rollout)
	);
	let failedLinger = $state(false);
	let wasFailed = false;
	// $effect.pre: the linger flag must be set BEFORE the DOM updates for the
	// failure clearing, or the `{#if}` below unmounts the panel in that same
	// flush and re-mounts it already collapsed (measured: still one frame).
	$effect.pre(() => {
		if (isFailedNow) {
			wasFailed = true;
			failedLinger = false;
			return;
		}
		if (!wasFailed) return;
		wasFailed = false;
		failedLinger = true;
		const t = setTimeout(() => (failedLinger = false), 1000); // outlives AlertPanel's own collapse, which ends on transitionend
		return () => clearTimeout(t);
	});

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
	// THE IDENTITY FALLBACK (design language, 2026-10-08): when the detail
	// response carries no Environment, take the one the fleet list matches —
	// the same `rolloutMatchesEnvironment` Home and /rollouts use — so every
	// state of this page names its environment. THEME ONLY: `environment`
	// above, and everything it drives, is unchanged.
	const listEnvironment = $derived(
		rollout && !environment?.spec?.environment
			? (listQuery.data?.environments?.items ?? []).find((e) =>
					rolloutMatchesEnvironment(rollout, e)
				)
			: undefined
	);
	// ⭐ THIS APP'S LANE (design language): the same view-model Home draws,
	// built from the fleet list for this rollout's name only.
	const appLane = $derived.by(() => {
		const data = listQuery.data;
		const me = rollout?.metadata?.name;
		if (!data || !me) return null;
		const mine = ((data.rollouts?.items ?? []) as Rollout[]).filter((r) => r.metadata?.name === me);
		// The gate context goes in (QA 5): every stuck caller passes it, so the
		// shared `detectRolloutStuck` excuses a correctly-held stage here the
		// same way it does on Home. (`gateContext` is declared below; this
		// closure only runs after component setup.)
		// ⭐ THE HOLD-ONE-RULE, FOR THIS LANE TOO. (shared/held-predicate,
		// 2026-10-11) Without `contractHoldsFor` a card held ONLY by a
		// `RolloutDependency` contract (never published on `rollout.status.
		// gates`) reads `held: false` here — the exact gap `held.ts`'s own
		// doc warns about — which would make `waitsForFact` below think the
		// upstream stage it is waiting on is clear when it is actually held
		// on a contract. Same `providerNetwork` this page already builds for
		// `contractHoldsIn`, read a second way, no new fetch.
		const cards = buildRolloutCards(
			mine,
			(data.environments?.items ?? []) as Environment[],
			$now,
			gateContext,
			(r) => contractHoldsForRollout(providerNetwork, r)
		);
		return buildLanes(cards)[0] ?? null;
	});
	/**
	 * ⭐ THE "NOT REACHED YET" FACT FOR THIS BANNER. (shared/held-predicate,
	 * 2026-10-11) `heldVerdict`/`waitsFor` — see `view-models/held.ts`'s own
	 * doc for the ruling. `appLane`'s own cards already carry the corrected
	 * `held`/`waitsForEnv`/`heldCauseLabel` facts (same `RolloutCard`s Home
	 * reads), so this page never re-derives the ruling, only looks THIS
	 * rollout's own card up in the lane it already built and asks the one
	 * shared helper for the sentence.
	 */
	const hereCard = $derived.by(() => {
		// `appLane`'s cards come off `listQuery` (the fleet list), never off
		// `rolloutQuery` (this page's own detail fetch) — two different
		// requests, so matching by object identity would miss every time.
		// `ns`/`name` is the same identity `buildAppIndex` itself keys on.
		const all = [...(appLane?.stages ?? []), ...(appLane?.prod ?? [])];
		return all.find((n) => n.card.ns === namespace && n.card.name === name)?.card ?? null;
	});
	/**
	 * ⭐ THE PEER MAP, SHARED (squad-rollout gates-2 follow-up, 2026-10-11).
	 * Pulled out of `waitsForFact` so the "Newer builds" row's own per-build
	 * read (below) can compose the identical one-hop "`<stage>` held on
	 * `<cause>`" clause without a second copy of the lane walk.
	 */
	const peersByEnv = $derived.by(() => {
		const m = new Map<string, RolloutCard>();
		for (const n of [...(appLane?.stages ?? []), ...(appLane?.prod ?? [])]) {
			if (n.card.envName) m.set(n.card.envName, n.card);
		}
		return m;
	});
	const waitsForFact = $derived.by(() => {
		if (!hereCard) return null;
		return waitsFor(hereCard, { peersByEnv });
	});
	const rolloutTheme = $derived(
		rollout ? getRolloutEnvironmentTheme(rollout, listEnvironment ?? environment) : null
	);
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
	// PALROW r8 (AD palette r7 item 3): a full outage escalates to ErrorState
	// after two failed answers instead of retrying on the skeleton forever
	// (`view-models/outage-escalation.svelte.ts`).
	const outage = outageEscalation(
		() => rolloutQuery,
		() => `${cluster}/${namespace}/${name}`
	);
	const loading = $derived(outage.loading);
	const error = $derived(outage.error);

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
	 *
	 * ⭐ `null` UNTIL `/schedules` HAS ACTUALLY ANSWERED — NOT `[]`.
	 * (2026-09-04, load-state audit finding 4: "Wrong gate kind until
	 * `/schedules` arrives.") This used to start at `[]` and `withSchedules`
	 * was called with it on every render, including the very first one —
	 * so a rollout held by a genuine schedule gate rendered `A check is not
	 * passing` for the ~100-300ms until `ScheduleStatus`'s own query
	 * resolved, then silently swapped to the true `Outside the Business
	 * Hours Only deploy window — reopens 1:00 PM`. `null` means "not asked
	 * yet"; `ScheduleStatus`'s `onSchedules` now only fires once its own
	 * query has settled (success OR error — see that component's own
	 * comment), always with a real array, so `null` here can only ever mean
	 * "still waiting". `gateContext` below reads that distinction directly:
	 * `withSchedules` is not called at all while `null`, which is what keeps
	 * `GateContext.schedulesLoaded` `false` and `classifyGate`'s `check`
	 * fallback `pending` — see `BlockingStoryPanel`'s own handling of
	 * `story.kindPending` for the render-side half of this fix.
	 *
	 * ⭐ shared/cards-join (2026-10-11): this page's own `gateContext` carries
	 * MORE evidence than `$lib/view-models/card-context.ts`'s `cardContext`
	 * helper builds by default — `rolloutGates` ownership and this rollout's
	 * own per-namespace `/schedules` fetch (via `withSchedules`), neither of
	 * which the list-only pages (`ControlCenter`, `/apps`, `/rollouts`, the
	 * palette) have. `cardContext` accepts both as optional inputs
	 * (`rolloutGates`, `schedulesForNamespace`) precisely so this page COULD
	 * route through it with no loss of evidence — kept hand-assembled here
	 * instead because this block's `$state`/`$effect.pre` ordering is
	 * already load-bearing (see the comment above on the dead-zone crash
	 * this exact shape was written to fix) and is not worth re-threading
	 * through one more layer of indirection. `buildGateContext` →
	 * `withSchedules` → `buildRolloutGraph` → `contractHoldsForRollout` below
	 * are the SAME four functions `cardContext` composes, called the same
	 * way, so this and every other surface still classify one gate
	 * identically — see `appLane`, below, which already hands
	 * `buildRolloutCards` both `gateContext` and `contractHoldsForRollout`.
	 */
	let scheduleObjects = $state<any[] | null>(null);
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
		return scheduleObjects !== null
			? withSchedules(base, rollout?.metadata?.namespace, scheduleObjects)
			: base;
	});
	/**
	 * ⭐ THE SAME GRAPH THE DEPENDENCIES TAB BUILDS (`buildRolloutGraph`),
	 * MOVED UP HERE SO `blockStory` CAN READ IT. (2026-10-09, coordinator
	 * ruling: "held" = refused by a gate OR held by a contract.) This block
	 * used to sit below, beside `heldByThis`/`holdEdgesIn` — it is relocated,
	 * not duplicated: `$effect.pre` below reads `blockStory` EAGERLY, as
	 * part of registering its own dependencies, which runs synchronously
	 * while this `<script>` block is still executing top to bottom. A
	 * `const` declared textually AFTER that point is in its own temporal
	 * dead zone at that moment — "forward reference is safe, `$derived` is
	 * lazy" is true of an ordinary read but NOT of the first run of an
	 * `$effect`/`$effect.pre`, which is exactly the live crash this fixes
	 * (`ReferenceError: Cannot access 'contractHoldsIn' before
	 * initialization`, `subject-detail.svelte.test.ts`). `providerEnvOrder`/
	 * `providerNetwork`/`providerFocusId` keep their own doc comments where
	 * `heldByThis` still reads them, below.
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
	/**
	 * ⭐ THE HOLD-ONE-RULE'S CONTRACT HALF, FOR `blockStory` ITSELF. Built off
	 * the SAME `providerNetwork` this page already builds for
	 * `heldByThis`/`holdEdgesIn`/`contractHeldVersions` below — nothing new
	 * fetched or computed, same graph read a third way. `undefined` while the
	 * graph has not resolved this rollout's own node yet, so a loading page
	 * never reads "no contract holds" as a confident answer and flashes a
	 * banner that then disappears. Inlined rather than reading `holdGraphKnown`
	 * (declared further down, for the same eager-effect reason above).
	 */
	const contractHoldsIn = $derived.by((): ContractHolds | undefined => {
		if (!listQuery.data || !rollout) return undefined;
		if (!providerNetwork.nodes.some((n) => n.id === providerFocusId)) return undefined;
		return contractHoldsForRollout(providerNetwork, rollout, namespace, cluster);
	});
	/** The one skipped-build rule: the banner, and the Newer builds rows, read this. */
	const skippedFn = $derived(skippedPredicate(rollout, stageBuilds(rollout, listQuery.data?.rollouts?.items)));
	const blockStory = $derived(
		blockingStory(rollout, gateContext, {
			place: environment?.spec?.environment ?? null,
			now: $now,
			fleet: { environments: listQuery.data?.environments?.items, rollouts: listQuery.data?.rollouts?.items }, /* the printed newer-builds count: the ONE behind rule */
			settled: fleetSettled(listQuery), /* no count until the fleet has answered, as the header */
			// A8: builds an earlier stage already passed over read "skipped", never "waiting for staging".
			skipped: skippedFn,
			// ⭐ THE HOLD-ONE-RULE. See `contractHoldsIn`'s own comment, above.
			contractHolds: contractHoldsIn
		})
	);
	// The gates the held banner names, frozen while it collapses out: its
	// action slot is a snippet of THIS page, so without this it would read
	// `0 rules` for the length of the fade. (See `AlertPanel`'s `open`.)
	let heldGates = $state.raw<ClassifiedGate[]>([]);
	$effect.pre(() => {
		const st = blockStory;
		if (st.blocked && st.clock.length === 0) heldGates = st.gates;
	});

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
	const heldByThis = $derived.by(
		(): { count: number; subjects: string; need: string; plural: boolean } | null => {
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
						(e) =>
							`${e.contract ?? 'a newer version'}${e.requiredVersion ? ` ${e.requiredVersion}` : ''}`
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
		}
	);
	/**
	 * ⭐ ONE SOURCE OF TRUTH FOR "IS THIS CANDIDATE HELD", SHARED WITH THE
	 * GATES TAB. (2026-10-08, U-5, ledger.)
	 *
	 * Measured live on `checkout-api-prod-us-east-2`: this card's "Newer
	 * builds" list rendered b-45/b-44/b-43 green `Ready` with a primary
	 * `Deploy`, while the Gates tab on the SAME rollout at the SAME moment
	 * said all three are HELD — `Needs payments-svc ^3.0.0 · has 2.4.1`.
	 *
	 * The split cause: `isBlocked` (below, in the `{#each releaseCandidates}`
	 * loop) only ever reads `rollout.status.gates` via `getBlockingGates`. A
	 * `RolloutDependency` contract gate is not always published there — this
	 * fixture's own `ckGates()` deliberately omits it (see its comment in
	 * `mock-data.ts`) precisely because publishing it flips `blockingStory`'s
	 * banner too. But the Gates tab was never reading `rollout.status.gates`
	 * for a contract hold either: `dependency-graph.ts`'s `buildRolloutGraph`
	 * resolves a contract edge straight off the `RolloutDependency` object's
	 * own `status.blockedReleases`/`Satisfied` condition (see its own
	 * comment, "FOR A CONTRACT EDGE THE SAME CONTROLLER HAS ALREADY
	 * ANSWERED") — which is the SAME graph this page already builds into
	 * `providerNetwork` for `heldByThis` above, just read the other
	 * direction: `heldByThis` asks what THIS rollout holds (`e.from ===
	 * providerFocusId`), this asks what holds THIS rollout (`e.to ===
	 * providerFocusId`). Nothing new is fetched or computed — `holdEdgesIn`
	 * is the inbound half of a graph already in hand, read, never rebuilt;
	 * `dependency-graph.ts` itself stays untouched (gates-team file).
	 */
	const holdEdgesIn = $derived(
		providerNetwork.edges.filter(
			(e) => e.to === providerFocusId && e.writer === 'contract' && e.state === 'blocked'
		)
	);
	/**
	 * The one inbound contract edge holding THIS candidate, or null.
	 * `e.held` is already in DISPLAY-VERSION form (`GraphEdge`'s own
	 * contract), matching `getDisplayVersion(releaseCandidate)` — never the
	 * tag, which is what `rollout.status.gates`-based `isBlocked` keys on.
	 */
	function contractHoldFor(
		releaseCandidate: { tag: string; version?: string; revision?: string }
	): ContractHold | null {
		// fix8 F3: the per-build hold (`contractHoldsIn`, the source the Gates tab, /apps and
		// `blockStory` read), never the edge's `requiredVersion`: the edge drops the range when
		// the held builds disagree (checkout-api prod ap-southeast-2: b-43 ~2.9.0, b-44 3.0.0).
		return contractHoldsIn?.get(getDisplayVersion(releaseCandidate))?.[0] ?? null;
	}
	/** The provider's own short name, for the held sentence. */
	function contractHoldProviderName(edge: (typeof holdEdgesIn)[number]): string {
		return providerNetwork.nodes.find((n) => n.id === edge.from)?.name ?? 'another service';
	}
	/**
	 * ⭐ (2026-10-09, integration round 3, item 3; round 4, item follow-up)
	 * THE SAME `holdEdgesIn` GRAPH, FLATTENED FOR THE CHANGE VERSION DIALOG.
	 * `contractHoldFor` above answers "is THIS candidate object held" for the
	 * ledger loop, which already has a `releaseCandidate`; `ChangeVersionModal`
	 * builds its own picker rows from `availableReleases`/repo tags, so it
	 * gets the resolved display-version SET instead of the graph itself.
	 *
	 * `contractHeldVersionsFor` (`dependency-graph.ts`) is the SAME one-line
	 * filter this used to inline here, extracted so `ChangeVersionModal`
	 * itself can call it too — the dialog now derives this set on its own,
	 * from the SAME `/api/rollouts` payload, on every call site that does
	 * not pass this prop. This page still computes and passes it as an
	 * OVERRIDE: it already builds `providerNetwork` for `heldByThis` and
	 * `holdEdgesIn` above, so recomputing it here costs nothing extra and
	 * saves the dialog a redundant graph build on the one page that already
	 * has the answer.
	 */
	/**
	 * ⭐ ITEM 1 (coordinator, 2026-10-09). THE HELD ANSWER IS "UNKNOWN" UNTIL
	 * BOTH OF THESE ARE TRUE: the list query has data, AND this rollout's own
	 * node actually exists in the graph it built (`nodeId(cluster, …)` uses
	 * the page's cluster name; the graph keys off each rollout's raw
	 * `source-cluster` annotation — see `contractHeldVersions`' own history).
	 * Exposed as a boolean (rather than inlined per use) because TWO
	 * consumers read it: the dialog override below, and every release-
	 * candidate row's own "Ready" branch, which must not assert "not held"
	 * while this is `false` (measured live, `checkout-api/prod-us-east-2`:
	 * the row read green `Ready` with a primary `Deploy` for the first paint,
	 * the IDENTICAL defect item (b)/`heldStatePending` already fixed one
	 * layer down in `ChangeVersionModal`).
	 *
	 * ⛔ GATE-ONLY HOLDS ARE UNAFFECTED. `blockingGates` (above) reads
	 * `rollout.status.gates`, which arrives with `rolloutQuery` itself — nod
	 * to `listQuery` required — so a gate-held row already knows its state
	 * synchronously and renders immediately regardless of this flag.
	 */
	const holdGraphKnown = $derived(
		!!listQuery.data &&
			(providerNetwork.nodes.some((n) => n.id === providerFocusId) ||
				// r34 newer-builds (2026-11-01): the graph only makes nodes for rollouts that sit on an
				// edge. A rollout the list DOES carry, under this page's own id, with no node has no
				// edges — so no contract hold can point at it. Without this, a rollout outside every
				// promotion/dependency link (invoice-api prod-eu-west under MOCK_API) showed the
				// "checking" mark on every older row forever. A cluster-name mismatch still reads unknown.
				(listQuery.data?.rollouts?.items ?? []).some(
					(r) =>
						nodeId(
							r.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? '',
							r.metadata?.namespace ?? '',
							r.metadata?.name ?? ''
						) === providerFocusId
				))
	);
	/**
	 * ⭐ ITEM 2 (coordinator, 2026-10-09). "UNKNOWN" MUST NOT MEAN "FOREVER".
	 * Same distinction `ChangeVersionModal`'s `selfHeldGraphErrored` makes
	 * (see that const's own comment): `holdGraphKnown` alone cannot tell
	 * "still loading" from "the request failed" — both read `false` — and a
	 * failed `/api/rollouts` must say so plainly instead of leaving every
	 * row on the "checking…" placeholder forever.
	 */
	const holdGraphErrored = $derived(listQuery.isError);
	$effect(() => {
		if (holdGraphKnown || !import.meta.env.DEV) return;
		// Same split as the dialog's own dev warning: a list failure and a
		// node-missing lookup miss are different bugs and must not be
		// reported as the same one.
		if (holdGraphErrored) {
			console.warn(
				`rollout detail: /api/rollouts failed — contract-hold state for ${namespace}/${name} ` +
					'could not be checked — a list failure, not a lookup miss. Rows render the error ' +
					'placeholder, never "Ready".'
			);
		} else if (listQuery.data) {
			const clusterLabel = cluster ?? 'hub';
			console.warn(
				`rollout detail: ${namespace}/${name}, cluster ${clusterLabel}, was not found in ` +
					'its own dependency graph — a node missing, not a list failure. Treating ' +
					'contract-hold state as unknown, never Ready.'
			);
		}
	});
	// Only an override once the answer is known (`holdGraphKnown`): pass
	// `undefined` while loading, errored, or when this rollout's node can't
	// be found, so the dialog self-derives with its own pending/unknown/error
	// state instead of receiving an empty set that reads as "not held".
	const contractHeldVersions = $derived.by((): ReadonlySet<string> | undefined => {
		if (!holdGraphKnown) return undefined;
		return contractHeldVersionsFor(providerNetwork, providerFocusId);
	});

	/**
	 * ⭐ A BUILD THAT JUST FAILED ITS CHECKS HERE IS NEVER OFFERED AS `Ready`
	 * AGAIN. (U-4, ledger, 2026-10-08 — TL ruling, coordinator decision.)
	 * Measured on the incident fixture: a rollback to `3f1ed09` left
	 * `a02f1c4` — the build whose OWN deploy just failed its health checks
	 * on THIS rollout — still a candidate (it is still newer by
	 * release-list position), and the "Newer builds" row read plain green
	 * `Ready` with a loud primary `Deploy`, as if nothing had just
	 * happened.
	 *
	 * `failedHereVerdict` (`deploy-risk.ts`, pure, unit-tested) is the
	 * derivation — this is no longer a mock-only flag or a local re-read of
	 * `rollout.status.history`: the SAME function also feeds
	 * `deployIntent`'s `knownFailedHere`, which is what makes
	 * `ChangeVersionModal`'s own confirm ceremony agree with this row about
	 * which build is the one that already failed.
	 */

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
	// ⭐ CLUSTER IN THE KEY — `cluster` sits before the kustomization-name list
	// so a Kustomization event's `applyChangeEvents` predicate can match on
	// (namespace, cluster, name) instead of namespace alone, and so this page
	// never serves another cluster's cached managed-resources for a
	// same-named rollout.
	const managedResourcesQuery = createQuery(() => ({
		queryKey: [
			'managed-resources',
			namespace,
			name,
			cluster,
			kustomizations.map((k) => k.metadata?.name)
		],
		queryFn: async () => {
			const result: Record<string, ManagedResourceStatus[]> = {};
			await Promise.all(
				kustomizations
					.filter((k) => Boolean(k.metadata?.name))
					.map(async (k) => {
						const kName = k.metadata!.name as string;
						const kNamespace = k.metadata?.namespace || namespace;
						const res = await fetch(
							apiPath(cluster, `/kustomizations/${kNamespace}/${kName}/managed-resources`)
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
		// ⭐ STREAM-AWARE, CLUSTER-AWARE — `managed-resources` is in
		// `ROLLOUT_SCOPED_KEY_TAGS`; `cluster` scopes the cadence to this
		// rollout's own cluster (see the rolloutQuery comment above).
		// ⭐ PERF-2026-09-04 — lifted to the app-wide 300s healthy ceiling.
		refetchInterval: pollWhenHealthy(5000, 300_000, cluster)
	}));
	const managedResources = $derived<Record<string, ManagedResourceStatus[]>>(
		managedResourcesQuery.data ?? {}
	);

	/**
	 * ⭐ HAS MANAGED-RESOURCES SETTLED — SUCCESS, ERROR, OR GENUINELY NEVER
	 * GOING TO RUN? (2026-09-04, load-state audit findings 1 & 12) Three
	 * things on this page wait on this ONE fact: the Pipeline card's stage
	 * rows and rollup (its `nodes` are built from `pipelineValidRollouts`,
	 * which reads `managedResources`), the Resources rail card, and whether
	 * `datadogServiceInfo` — and therefore the External Links card — exists
	 * at all. `kustomizations.length === 0` is its own resolved state: the
	 * query is `enabled: false` in that case and would sit at `isPending`
	 * forever, which is NOT the same as "still waiting" — there is nothing
	 * to fetch, so the answer (no managed resources) is already final.
	 */
	const managedResourcesKnown = $derived(
		kustomizations.length === 0 || managedResourcesQuery.isSuccess || managedResourcesQuery.isError
	);

	// Query for health checks
	const healthChecksQuery = createQuery(() => ({
		...healthChecksQueryOptions(namespace, name, cluster),
		enabled: Boolean(rollout?.spec?.healthCheckSelector),
		// ⭐ STREAM-AWARE, CLUSTER-AWARE — `health-checks` is in
		// `ROLLOUT_SCOPED_KEY_TAGS`; `cluster` rides the key (see
		// `managed-resources` above) and scopes the poll cadence.
		// ⛔ DELIBERATELY STILL 60s, NOT LIFTED TO 300s WITH ITS SIBLINGS.
		// (PERF-2026-09-04) `events.ts`'s `patchHealthCheckCaches` can only
		// patch/remove a HealthCheck this cache ALREADY CONTAINS — the backend
		// filters the list server-side by the rollout's own
		// `healthCheckSelector`, information this module doesn't have, so an
		// incoming HealthCheck not yet in the list might be "not selected" or
		// might be "newly relevant" and there is no way to tell from the
		// object alone. This 60s poll is the safety net for exactly that one
		// case (see that function's own doc comment) — it is not the same
		// override as the others and lifting it to 300s would widen the gap a
		// newly-relevant HealthCheck can hide in.
		refetchInterval: pollWhenHealthy(5000, 60000, cluster)
	}));
	const healthChecks = $derived<HealthCheck[]>(healthChecksQuery.data?.healthChecks ?? []);
	/**
	 * The load failed, remembered through "Try again"'s refetch (see
	 * `healthLoadFailed`). The latch is KEYED to the health-checks query key, so
	 * a client navigation to another rollout (same component instance) never
	 * inherits it, and it is never applied to a rollout with no selector (whose
	 * query is disabled and whose card says "none select this rollout").
	 */
	const healthChecksKey = $derived(JSON.stringify(healthChecksQueryOptions(namespace, name, cluster).queryKey));
	const healthChecksLatch = createLoadFailedLatch(
		() => healthChecksKey,
		() => healthChecksQuery
	);
	const healthChecksFailed = $derived(
		Boolean(rollout?.spec?.healthCheckSelector) && healthChecksLatch.failed
	);
	/** Same shape as `managedResourcesKnown` — see that field's own comment. */
	const healthChecksKnown = $derived(
		!rollout?.spec?.healthCheckSelector || healthChecksQuery.isSuccess || healthChecksFailed
	);

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

	/** What the failure banner and the change-version flow are told: `null` when
	 *  the load failed (unknown, not "no checks"), `undefined` while it loads. */
	const flowHealthChecks = $derived(
		flowHealthChecksFor(
			{
				hasSelector: Boolean(rollout?.spec?.healthCheckSelector),
				isSuccess: healthChecksQuery.isSuccess,
				isError: healthChecksFailed
			},
			visibleHealthChecks
		)
	);

	/**
	 * ⭐ "PROMOTE ONLY WHEN IT'S HEALTHY", DRAWN. (2026-09-20, promo film
	 * finding: the hero take showed `e2c9b47 · Ready` with a loud primary
	 * `Deploy` while a health check was still `Pending` — the opposite of
	 * what the beat claims.) See `health-witness.ts`'s own doc comment on
	 * `healthGateCounts` for why this is not a `status.gates` block: the
	 * controller's promotion loop short-circuits on unhealthy checks BEFORE
	 * the gate loop runs, so nothing in `promotion.ts`/`blocking-story.ts`
	 * models it.
	 *
	 * Scoped to the NEWEST candidate only — an older one a person might
	 * Change Version to is a different question, already answered by that
	 * row's own gate classification. And only when a real gate is not ALSO
	 * holding it: that state already renders (`isBlocked`, below), and this
	 * is additive evidence, not a replacement for it.
	 */
	// ⭐ THE ONE LIST THIS PAGE COUNTS "NEWER BUILDS" FROM. (coordinator,
	// 2026-10-09) Every read on this page used to go straight to
	// `rollout.status.releaseCandidates` — a field `checkout-api`'s fixture
	// (and some live rollouts) never publishes, because the controller only
	// fills it in once it has computed an upgrade path. That field being
	// absent does NOT mean "no newer build" — it can mean "ask
	// `availableReleases` instead", which is exactly what `promotionCandidates`
	// (`promotion.ts`) does, and it is the same function `/apps` and the
	// Change Version dialog's rank labels already agree with. Measured on
	// `checkout-api`/`prod-us-east-1` (calm): this page used to print "No
	// newer build" here while `/apps/checkout-api` said "3 behind" — same
	// rollout, two answers, because only one side ran the fallback. Both
	// sides now call `promotionCandidates`, so they cannot disagree again.
	// `promotionCandidates` is typed as `ReleaseRef[]` (`tag?: string`) so it
	// can serve callers built from `availableReleases` too, but every element
	// here actually comes off `status.releaseCandidates`/`status.availableReleases`,
	// both of which the API contract (`rollout-types.ts`) declares with a
	// REQUIRED `tag`. Same cast `apps/[name]/+page.svelte`'s `waitingBuildsFor`
	// already uses for the identical reason.
	const newerBuilds = $derived(
		promotionCandidates(rollout) as {
			version?: string;
			revision?: string;
			tag: string;
			created?: string;
		}[]
	);
	const newestCandidate = $derived(newerBuilds[0] ?? null);
	/* the header's "N newer builds": the ONE behind rule (behind.ts), the same subtraction History's current-row chip makes (batch4 #3d): a build that failed here or upstream in the wave chain is not counted. The deploy-anyway "Newer builds" card below lists what a person CAN deploy and keeps its own list. */
	const headerNewer = $derived(behindWhenSettled(rollout, { environments: listQuery.data?.environments?.items, rollouts: listQuery.data?.rollouts?.items }, fleetSettled(listQuery)) ?? 0); /* 0 = no chip until the fleet has answered: the number never changes after load */
	// Newer builds ledger fold (r34 AD r3 TB6): the newest + the first NB_FOLD older builds are drawn;
	// the rest sit behind a footer that expands in place. `nbOpen` = narrow-card rows opened by a tap.
	// TB14/TB22/TB24 (r5): the fold is a phone/tablet thing. At >=1024 NO fold: every older row shows (the
	// rail beside is shorter than the card, a fold band there saves nothing). Below 640 the card folds to
	// the newest + EVERY held or failed row + Running here — only at-rest older rows hide, never the
	// build the Gates tab leads with. 640-1023 keeps the first 4 older rows.
	const nbPhone = new MediaQuery('(max-width: 639px)', false);
	const nbDesktop = new MediaQuery('(min-width: 1024px)', false);
	let nbShowAll = $state(false);
	let nbOpen = $state<Record<string, boolean>>({});
	/** A build the operator must see even on a folded card: held (gate / contract) or failed here.
	 *  Chain waits ("Waits for staging") are at rest and may fold. */
	function nbRowAdverse(rc: { tag: string; version?: string; revision?: string }): boolean {
		const tag = rc.tag;
		if (rowShowsFailed(failedHereVerdict(rollout, tag))) return true;
		const gates = getBlockingGates(tag);
		const dep =
			gates.length > 0 &&
			dependencyOnlyHold(
				classifyBlockingGates(tag),
				holdEdgesIn
					.filter((e) => e.held.includes(getDisplayVersion(rc)))
					.map((e) => ({ provider: contractHoldProviderName(e), gate: e.gate }))
			);
		// Mirrors the row's `markState`: a gate that is not the dependency's own decides first
		// (a chain wait reads 'behind'), then a contract hold.
		if (gates.length > 0 && !dep) {
			if (blockStory.pinnedTo) return true;
			const v = verdictForGates(classifyBlockingGates(tag), environment?.spec?.environment ?? null, {
				hasContract: !!contractHoldFor(rc)
			});
			return !(!v.held && !!v.waitsForEnv);
		}
		return !!contractHoldFor(rc);
	}
	/** A build that only WAITS for an earlier environment ("Waits for staging"), with the cause that
	 *  environment is itself held on — the shared cause is printed once (TB28), on the first such row. */
	function nbChain(rc: { tag: string; version?: string; revision?: string }) {
		const tag = rc.tag;
		if (rowShowsFailed(failedHereVerdict(rollout, tag)) || blockStory.pinnedTo) return null;
		if (getBlockingGates(tag).length === 0) return null;
		const v = verdictForGates(classifyBlockingGates(tag), environment?.spec?.environment ?? null, {
			hasContract: !!contractHoldFor(rc)
		});
		if (v.held || !v.waitsForEnv) return null;
		const raw = waitsFor({ waitsForEnv: v.waitsForEnv }, { peersByEnv })?.heldCause ?? null;
		const peer = raw ? raw.replace(new RegExp(`^${v.waitsForEnv}\\s+`), '') : null;
		const skipped = chainWaitLabel(skippedFn, { tag }, v.waitsForEnv).skipped;
		return { env: v.waitsForEnv, peer: skipped ? null : peer };
	}
	const nbFirstPeer = $derived.by(() => {
		for (let i = 0; i < newerBuilds.length; i++) {
			const c = nbChain(newerBuilds[i]);
			if (c?.peer) return { i, peer: c.peer };
		}
		return null;
	});
	const nbRows = $derived(newerBuilds.map((rc, i) => ({ rc, i })));
	const nbCollapsed = $derived.by(() => {
		const keep = nbRows.map(
			(r) => r.i === 0 || (nbDesktop.current ? true : nbPhone.current ? nbRowAdverse(r.rc) : r.i <= 4)
		);
		// r7 TB33: never fold a single row — a fold button is taller than the one row it hides.
		let run = 0;
		for (let k = 0; k <= keep.length; k++) {
			if (k < keep.length && !keep[k]) {
				run++;
				continue;
			}
			if (run === 1) keep[k - 1] = true;
			run = 0;
		}
		return nbRows.filter((_, k) => keep[k]);
	});
	const nbVisible = $derived(nbShowAll ? nbRows : nbCollapsed);
	const nbFoldedCount = $derived(nbRows.length - nbCollapsed.length);
	/** Index (into nbVisible) of the first older row — where the "Older" band sits. */
	const nbOlderAt = $derived(nbVisible.findIndex((r) => r.i > 0));
	/** TB23: the build track is as wide as the widest id on the card (14px mono 500 = 0.6em/char), min 64. */
	const nbBuildW = $derived(
		Math.max(
			64,
			Math.ceil(
				Math.max(
					...newerBuilds.map((r) => getDisplayVersion(r).length),
					rollout?.status?.history?.[0]?.version ? getDisplayVersion(rollout.status.history[0].version).length : 0
				) *
					8.4
			) + 2
		)
	);
	// ⭐ REFUSED HERE VS NOT REACHED YET (shared/held-predicate, 2026-10-11).
	// `getBlockingGates` names every gate whose allow-list excludes this
	// tag — gate NAME only, no tier classification, so it cannot tell a
	// real hold from plain chain sequencing (`promotion-prod` refusing a
	// build its own upstream has not deployed yet reads identically here).
	// `hereCard.held` is the one place that distinction is already made
	// (`view-models/held.ts`) — `?? true` keeps this byte-identical to
	// before on a card this page's own lane has not resolved yet (loading),
	// never suppressing a real hold for lack of data.
	const newestCandidateBlockedByGate = $derived(
		newestCandidate && (hereCard?.held ?? true)
			? getBlockingGates(newestCandidate.tag).length > 0
			: false
	);
	const newestHealthGateCounts = $derived(healthGateCounts(visibleHealthChecks, errorCutoff));
	const newestHeldByHealth = $derived(
		!!newestCandidate && !newestCandidateBlockedByGate && healthGateHolding(newestHealthGateCounts)
	);
	const newestHealthHoldClause = $derived(
		newestHeldByHealth
			? `waiting for health checks · ${healthGateCountsLabel(newestHealthGateCounts)}`
			: null
	);

	/**
	 * ⭐ THE SAME WAIT, WHEN A RULE HOLDS IT RATHER THAN A HEALTH CHECK.
	 * (2026-09-21) The health-held clause two lines up rides on the whole
	 * page (version card AND the Newer builds row); a GATE-held newest
	 * candidate only ever got that treatment on the Newer builds row — the
	 * version card's own meta line fell all the way to the bare `N newer
	 * build(s)` `{:else}` branch with no reason at all, on a rollout whose
	 * WHOLE story that visit is "why hasn't this moved". `classifyBlockingGates`
	 * is the exact function that row already calls; reused here rather than a
	 * second gate-reading path. `label` is `classifyGate`'s own word for a
	 * promotion gate (`after dev`) — never invented here — and the gate's own
	 * `gate.kuberik.com/description` annotation (the same field
	 * `getGateDescription` already surfaces in the row's popover) rides along
	 * when the environment controller published one, e.g. naming why the
	 * upstream environment itself hasn't deployed yet.
	 */
	const newestGateHoldGates = $derived(
		newestCandidate && newestCandidateBlockedByGate
			? classifyBlockingGates(newestCandidate.tag)
			: []
	);
	const newestGateHoldDescription = $derived.by(() => {
		if (!newestCandidate || !newestCandidateBlockedByGate) return null;
		for (const g of getBlockingGates(newestCandidate.tag)) {
			const d = getGateDescription(g);
			if (d) return d;
		}
		return null;
	});
	const newestGateHoldClause = $derived(
		newestGateHoldGates.length === 0
			? null
			: (newestGateHoldGates.length === 1
					? newestGateHoldGates[0].label
					: `${newestGateHoldGates.length} rules`) +
					(newestGateHoldDescription ? ` · ${newestGateHoldDescription}` : '')
	);

	/**
	 * ⭐ ITEM 8 FIX (integration round 3, Gates design review). A held-reason
	 * clause (`Needs payments-svc ~2.9.0 · has 2.4.1`, `waiting for health
	 * checks · 1 pending`) used to render as one plain text node inside a
	 * non-wrapping `items-center` flex row — the browser could still break
	 * the LINE at any space, including inside a version number, leaving a
	 * mid-version wrap.
	 *
	 * The first fix gave each run its own TRAILING separator inside a
	 * `whitespace-nowrap` span (the Gates tab's own `clauseRuns`,
	 * `RolloutNeighbourhood.svelte`, had made the same move for the same
	 * reason) — which stopped the mid-version break, but re-check at 390
	 * found the glyph itself still lands at a line's END whenever the wrap
	 * falls right after the run that carries it. There is no third position
	 * for a literal `·` between two independently-wrappable runs that
	 * dodges every edge; `splits` on `' · '` so the break still can only
	 * land BETWEEN clauses, but nothing renders the glyph any more — the
	 * container's own wider `gap-x-2` (vs. a clause's internal `gap-x-1`,
	 * where used) is what reads as "new clause" instead.
	 */
	function clauseRuns(text: string): { text: string; sep: boolean }[] {
		const parts = text.split(' · ').filter((p) => p.length > 0);
		return parts.map((p, i) => ({ text: p, sep: i < parts.length - 1 }));
	}

	/**
	 * ⭐ THE GATE OPENING IS A MOMENT, NOT A LEVEL. The instant every health
	 * check reports healthy, the controller's own next reconcile promotes
	 * automatically — a real, if usually brief, gap between "proven healthy"
	 * and "actually promoted" that this flag names `promoting` rather than
	 * letting the row jump straight back to a bare `Ready`, which would read
	 * as if the wait had never happened.
	 *
	 * A TRANSITION, not a field on the rollout, so it has to be tracked
	 * across renders. Self-clears after 8s — same idiom as `justClearedPin`
	 * above — so a check that flaps back to held, or a promotion that
	 * genuinely stalls, does not leave this on forever.
	 */
	let prevNewestCandidateKey = $state<string | null>(null);
	let prevNewestHeldByHealth = $state(false);
	let justOpenedHealthGate = $state(false);
	let healthGateOpenedTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const key = newestCandidate?.tag ?? null;
		const held = newestHeldByHealth;
		if (key !== prevNewestCandidateKey) {
			// A different candidate (promoted away, or a new build appeared) —
			// whatever this flag was tracking no longer applies.
			justOpenedHealthGate = false;
			clearTimeout(healthGateOpenedTimer);
		} else if (prevNewestHeldByHealth && !held) {
			justOpenedHealthGate = true;
			clearTimeout(healthGateOpenedTimer);
			healthGateOpenedTimer = setTimeout(() => {
				justOpenedHealthGate = false;
			}, 8000);
		} else if (held) {
			justOpenedHealthGate = false;
		}
		prevNewestCandidateKey = key;
		prevNewestHeldByHealth = held;
	});

	// Query for events
	// ⭐ SQUAD-ROLLOUT COORDINATOR, 2026-10-12 — cadence follow-up (traced
	// with CDP `Network.requestWillBeSent` initiator stacks): this was the
	// ONE query still firing every 5s, unthrottled, for the entire length of
	// an outage — 12 of 15 rollout-scoped requests in a 60s mid-outage
	// sample, all from this `queryFn`. `if (!res.ok) return { events: [] }`
	// swallowed a 503 into a SUCCESSFUL empty answer, so `pollWhenHealthy`'s
	// callback never saw `status: 'error'` and never backed off to
	// `RECOVERY_POLL_MS` — it kept reading "healthy" forever. `apiFetch`
	// throws instead, exactly like every other API call in this file; the
	// rendered result is unchanged (`events` below still defaults to `[]`,
	// and `eventsKnown`'s `isSuccess || isError` already treats a thrown
	// failure as "known, show the empty state" — see that const's own
	// comment), only the retry/backoff bookkeeping is fixed.
	const eventsQuery = createQuery(() => ({
		queryKey: ['events', namespace, name, cluster],
		queryFn: async () => {
			const res = await apiFetch(apiPath(cluster, `/rollouts/${namespace}/${name}/events`));
			return res.json();
		},
		// ⭐ STREAM-AWARE, CLUSTER-AWARE — `events` is in
		// `ROLLOUT_SCOPED_KEY_TAGS`; `cluster` rides the key (see
		// `managed-resources` above) and scopes the poll cadence.
		// ⭐ PERF-2026-09-04 — lifted to the app-wide 300s healthy ceiling.
		refetchInterval: pollWhenHealthy(5000, 300_000, cluster)
	}));
	const events = $derived(eventsQuery.data?.events ?? []);
	/**
	 * Same shape as `managedResourcesKnown` — no `enabled` gate on this one,
	 * so it is simply "has the request returned at all". `Recent events`
	 * measured the audit's single biggest jump (+492 / +716px) rendering
	 * empty-then-populated inside an already-visible `Card`; skeletoning it
	 * until this is true is what stops that jump.
	 */
	const eventsKnown = $derived(eventsQuery.isSuccess || eventsQuery.isError);

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
	// ⚠️ NOT COVERED BY THE CHANGE STREAM (GitHub connection state isn't an
	// informer-cached kind). Explicit `refetchInterval: false` so this stops
	// silently inheriting the app-wide default's 5s-while-unhealthy poll —
	// see `revisions/[...slug]/+page.svelte`'s identical fix, matching this
	// same query's other 3 call sites.
	const githubStatus = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000,
		refetchInterval: false as const
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
	/**
	 * ⭐ LANE P, §5 (2026-10-09): `Toast.svelte`'s new, additive `description`
	 * prop — a second line for the fact the title has no room for ("Deploy
	 * requested" / "9a1f4c2 is deploying to prod."). Reset to `''` at every
	 * call site that does not set one, so a later one-line toast never
	 * inherits an earlier toast's second line.
	 */
	let toastDescription = $state('');
	let toastType = $state<'success' | 'error' | 'info'>('success');
	let toastLoading = $state(false);
	/**
	 * ⭐ ROUND 3, ITEM 13 (AD, 2026-10-09): "Add an action `.nav-link` 'View
	 * logs'." Only `retryDeployment`'s own toast sets this — a reader who
	 * just retried a deploy is exactly the reader who wants the logs next;
	 * every other toast on this page resets it, same reset discipline
	 * `toastDescription` already follows.
	 */
	let toastShowLogsAction = $state(false);

	/**
	 * ⭐ THE TOAST'S CLEARANCE, AS RESERVED SPACE — NOT A MEASURED DOCK.
	 * (2026-10-09, integration round 3, item 3) See the doc comment on the
	 * `<Toast>` markup for the full history. The previous fix measured
	 * `.ov-split`'s two columns live with a `ResizeObserver` and slid the
	 * toast sideways to whichever column had clearance — correct for the
	 * two-column case it was built for, but it never touched the
	 * single-column layout below the `.ov-split-cq` 1080px threshold (1024
	 * reported pre-existing overlap with `Health checks`): at that width
	 * `mainColEl` and `railColEl` are the same flex column, stacked, so
	 * "whichever has clearance" is never true once the stack itself runs to
	 * the fold.
	 *
	 * THE SIMPLER FIX: `<main>` is the one real scroller at `sm`+ (the
	 * layout's own "`<main>` IS A PLAIN BLOCK … THE DOCUMENT IS THE
	 * SCROLLER" — here that block is simply the one thing `<main>` ever
	 * renders, so padding at the END of this page's own markup is
	 * padding at the end of `<main>`'s scrollable content). A toast
	 * showing adds `TOAST_DOCK_CLEARANCE` of empty space after the page's
	 * last element — single column AND two column alike, since in the
	 * two-column case the grid's own height is the TALLER column's, and
	 * this reserve sits after that. Scrolled to the bottom, the toast's
	 * fixed dock now always lands over that reserved strip, never over
	 * `Health checks` or anything else. No `ResizeObserver`, no column
	 * refs, no horizontal override — CSS padding plus the state the toast
	 * already carries.
	 */
	const TOAST_DOCK_CLEARANCE = 96; // toast height (~64) + its own bottom-4 margin + a little air

	let showRollbackModal = $state(false);
	let rollbackVersion = $state<string | null>(null);

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

	/**
	 * ⭐ PALROW r8 (AD palette round 7, item 2): THE RECOVERY GATE MOVED.
	 * `recoveryModeReason` (it predicts the controller: every bake status but
	 * `Succeeded` is a trigger, worded failed / cancelled / unfinished per
	 * status) lives in `view-models/change-version-entry.ts`, and
	 * `ChangeVersionFlow` mounts the warning and the picker together, so
	 * History walks the SAME step this page always did. This page only
	 * requests the flow; the flow decides warning-first or picker.
	 */
	function requestChangeVersionModal() {
		showChangeVersionModal = true;
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
		if (!showChangeVersionModal) {
			selectedVersion = null;
			isPinVersionMode = false;
		}
	});

	// ⭐ SQUAD-ROLLOUT ROUND 3, ITEM 1 (coordinator-approved, 2026-10-09) —
	// ROUND 4, ITEM A FIX (AD "REAL BUG", 2026-10-10): the palette's "Change
	// version…" command has nothing to call directly (a separate component
	// tree), so it navigates here with `?action=change-version`. The old
	// version read the param straight off `page.url` inside a plain
	// `$effect` — which opened the modal on the FIRST request (param +
	// loaded `rollout` both true at once) but not a SECOND, because a
	// same-route, query-only `goto()` does not reliably re-trigger a
	// `$effect` whose only dependency is a reactive READ of `page.url` (the
	// AD's own diagnosis: "handled only on first mount or data load, not on
	// client-side navigation"). `afterNavigate` is the primitive that
	// actually RUNS — an imperative callback, not a reactive read — once
	// per COMPLETED navigation, same-route query-only ones included, so it
	// cannot miss the SAME reactivity gap. The initial value below covers
	// the one case `afterNavigate` itself never fires for: a cold first
	// load that already has the param in its URL (SvelteKit does not
	// deliver `afterNavigate` for the navigation that mounted the page).
	// Either way this only sets a PENDING flag — `rollout` may not be
	// loaded yet — and the `$effect` below opens the modal once `rollout`
	// is ready and clears the flag, so "the param reappeared" and "the
	// param appeared for the first time" are the same event.
	// `?action=rollback` (the Logs tab's "Roll back to …", squad-rollout
	// SPEC §7) rides the same pending flag: it opens the SAME dialog the
	// status row's own Roll back button opens, pre-selected on `rollbackNow`.
	let changeVersionPending = $state(page.url.searchParams.get('action') === 'change-version');
	let rollbackPending = $state(page.url.searchParams.get('action') === 'rollback');
	afterNavigate(() => {
		const action = page.url.searchParams.get('action');
		if (action === 'change-version') changeVersionPending = true;
		if (action === 'rollback') rollbackPending = true;
	});
	$effect(() => {
		if (rollbackPending && rollout) {
			rollbackPending = false;
			if (isDashboardManagingWantedVersion && rollbackNow) {
				isPinVersionMode = true;
				selectedVersion = rollbackNow.tag;
				deployExplanation = '';
				requestChangeVersionModal();
			}
			const url = new URL(page.url);
			url.searchParams.delete('action');
			replaceState(url, {});
		}
	});
	$effect(() => {
		if (changeVersionPending && rollout) {
			changeVersionPending = false;
			requestChangeVersionModal();
			const url = new URL(page.url);
			url.searchParams.delete('action');
			replaceState(url, {});
		}
	});

	/**
	 * ⭐ THE SUBTITLE NAMES WHAT IS ACTUALLY RUNNING, WHEN IT DIFFERS FROM
	 * WHAT THE DESCRIPTION IS ABOUT. (2026-09-03, operator-walk finding 6)
	 * `rollout.status.description` is server-authored FROM THE NEWEST
	 * AVAILABLE RELEASE (`rollout-controller`'s `updateAvailableReleases`
	 * reads it off the `ImagePolicy`'s own `LatestRef`, not off what is
	 * deployed) — measured live, `hello-dep frontend service, release
	 * rel-67` printed unconditionally two lines above the version card's own
	 * `2.66.0-66` runs, true of two different builds read as one because
	 * nothing on the subtitle line said which build IT was about.
	 * `releaseCandidates.length > 0` is the SAME evidence `Available Version
	 * Upgrades` already uses to say a newer build exists — when it is
	 * nonzero, the description is necessarily about a build ahead of
	 * `history[0]`, so this states the one fact the subtitle is otherwise
	 * silent on. `null` whenever nothing is running yet or the fleet has
	 * already caught up, so the ordinary (converged) case prints nothing new.
	 */
	function subtitleRunningLabel(): string | null {
		const running = rollout?.status?.history?.[0]?.version;
		if (!running) return null;
		if (newerBuilds.length === 0) return null;
		return getDisplayVersion(running);
	}

	// `selectedVersionDisplay` moved to `view-models/change-version-entry.ts`
	// with the recovery gate (PALROW r8) — `ChangeVersionFlow` calls it directly.

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
		return prettyNameOf(gate?.metadata);
	}

	/**
	 * ⭐ U-5, 2026-10-08: THE DETERMINATION IS `blockingGateNames` (promotion.ts),
	 * NEVER "does a RolloutGate object exist for this name". This used to
	 * filter `rollout.status.gates` itself and then DROP any blocking entry
	 * it could not match to an object in `rolloutGates` — so a gate whose CRD
	 * this page's fetch didn't return (a promotion-order gate, on the live
	 * cluster) silently stopped counting as held everywhere this function
	 * fed: the "Newer builds" row, the version card's held clause, and the
	 * Change Version dialog's `isDeployable`/picker chip all agreed with the
	 * absence instead of with the controller's own published status, while
	 * the Gates tab — which never required the object — read it correctly.
	 * See `blockingGateNames`'s own doc comment for the measured repro.
	 *
	 * A CRD object, when one IS in `rolloutGates`, still rides along here —
	 * every existing caller (`getGateDescription`, `classifyBlockingGates`'s
	 * `.metadata?.name` lookup) reads it for DISPLAY only. A name with no
	 * matching object gets a minimal stand-in so none of those callers see a
	 * hole; `getGateDescription` returns `null` for it exactly as it already
	 * does for an object with no description annotation.
	 */
	function getBlockingGates(version: string): any[] {
		return blockingGateNames(rollout, version).map(
			(name) => rolloutGates.find((g) => g.metadata?.name === name) ?? { metadata: { name } }
		);
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
		return gates.length === 1 ? 'by a rule' : `by ${gates.length} rules`;
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
	/**
	 * ⭐ HOW MANY RULES, FOR THE CHIP'S OWN VALUE HALF. (2026-09-18, from the
	 * human: "held needs to display how many gates are blocking it".)
	 *
	 * Separate from `heldWord` on purpose. `heldWord` answers "what should the
	 * line beside the chip say", and for a pin or a clock gate with a real
	 * countdown that is a CLAUSE, not a count. The chip needs the count
	 * unconditionally, so it gets its own function rather than parsing one out
	 * of the other.
	 */
	function heldCountLabel(gates: ClassifiedGate[]): string {
		return gates.length === 1 ? '1 rule' : `${gates.length} rules`;
	}

	/**
	 * The plain-count spelling of `heldWord`, used only to decide whether
	 * `heldWord` is saying anything the chip has not already said. Kept beside
	 * `heldWord`'s own fallback so the two cannot drift into disagreeing about
	 * the singular.
	 */
	function heldCountPhrase(gates: ClassifiedGate[]): string {
		return gates.length === 1 ? 'by a rule' : `by ${gates.length} rules`;
	}

	/**
	 * The record's last word. `heldClears` says HOW this clears (or that it
	 * will not); the second sentence is the standing fact about held builds
	 * that used to open the popover's paragraph.
	 *
	 * ⛔ THE REST OF THAT PARAGRAPH IS GONE, NOT RELOCATED. It narrated each
	 * gate in prose and every gate then repeated the same fact in its own row.
	 * `GateRecord` gives each gate a `Now` and a `Clears` fact, so the prose
	 * was a second copy of the list below it.
	 */
	function heldFoot(gates: ClassifiedGate[]): string {
		const clears = heldClears(gates);
		const standing =
			'Nothing promotes this build automatically while it is held. A deploy you start by hand still applies immediately.';
		return clears ? `${clears} ${standing}` : standing;
	}

	function heldClears(gates: ClassifiedGate[]): string {
		if (gates.length === 0) return '';
		if (blockStory.pinnedTo)
			return 'Clearing the pin is what lets this deploy automatically — the rules below may also still apply.';
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
		return kinds.length > 0 ? `Waiting on ${joinClauses(kinds)}` : 'Held by rules';
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
		const releases = availableReleases(rollout);
		if (!rollout?.status?.history?.[0] || !releases) return false;
		const currentVersionTag = rollout.status.history[0].version.tag;
		return !releases.some((ar) => ar.tag === currentVersionTag);
	});

	// Computed property to determine if pinned version (wantedVersion) is custom
	const isPinnedVersionCustom = $derived.by(() => {
		if (!rollout?.spec?.wantedVersion || !availableReleases(rollout)) return false;
		const pinnedVersionTag = toTag(rollout.spec.wantedVersion);
		return isSelectedVersionCustom(pinnedVersionTag);
	});

	function isOlderThanCurrent(selectedTag: string): boolean {
		const currentTag = rollout?.status?.history?.[0]?.version?.tag;
		const releases = availableReleases(rollout);
		if (!currentTag || !releases) return false;
		const currentIdx = releases.findIndex((r) => r.tag === currentTag);
		const selectedIdx = releases.findIndex((r) => r.tag === selectedTag);
		if (currentIdx === -1 || selectedIdx === -1) return false;
		// In availableReleases, higher index is newer; lower is older
		return selectedIdx < currentIdx;
	}

	function isSelectedVersionCustom(selectedTag: string): boolean {
		const releases = availableReleases(rollout);
		if (!releases) return false;
		return !releases.some((ar) => ar.tag === selectedTag);
	}

	function toTag(version: string | { tag: string } | undefined): string {
		return typeof version === 'string' ? version : (version?.tag ?? '');
	}

	// Build GitHub tree URL for a given version (always absolute: `sourceTreeUrl`).
	function getGitHubUrl(version: string, revision?: string | null): string {
		return sourceTreeUrl(rollout?.status?.source, gitRef(revision, version)); // sha over tag (2026-09-10, human)
	}

	const lockstepFault = $derived(environment ? lockstepMismatch(environment) : null);
	const joinList = (xs: string[]) => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

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

		// The place this environment takes its version from, off the sites &
		// waves topology (a follower follows its leader, a wave-N leader follows
		// wave N-1, the first place of a tier follows the tier before it).
		// `environmentInfos` hold one history per TIER, so an upstream inside the
		// same tier has no history of its own to read.
		const deployName = deployNameOf(environment);
		const topo = buildTopology([
			...((listQuery.data?.environments?.items ?? []) as Environment[]),
			environment
		]).get(deployName);
		const me = siteNodeOf(topo, environment);
		const up = topo && me ? upstreamOf(topo, me)[0] : undefined;
		const depEnv = up && up.tier !== me?.tier ? up.tier : null;
		if (!depEnv) {
			return null;
		}

		// Find the dependency environment info
		const depEnvInfo = environment.status.environmentInfos.find(
			(e: EnvironmentInfo) => canonicalTier(e.environment) === depEnv
		);
		if (!depEnvInfo?.history) {
			return null;
		}

		// Find the release candidate, history entry, or available release to get all version identifiers
		if (!rollout) return null;
		const historyEntry = rollout.status?.history?.find(
			(entry) => entry.version?.tag === versionTag
		);
		const availableRelease = availableReleases(rollout)?.find((ar) => ar.tag === versionTag);

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
		if (!status) return { icon: ExclamationCircleSolid, color: 'text-fg-subtle' };
		switch (status.toLowerCase()) {
			case 'success':
				return { icon: CheckCircleSolid, color: 'text-success' };
			case 'failure':
				return { icon: ExclamationCircleSolid, color: 'text-danger' };
			case 'in_progress':
			case 'pending':
				return { icon: ClockSolid, color: 'text-progress' };
			default:
				return { icon: ExclamationCircleSolid, color: 'text-fg-subtle' };
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

	async function reconcileFluxResources() {
		if (!rollout || isReconciling) return;

		isReconciling = true;

		// Capture current state to detect changes
		const previousReleaseTags = new Set(availableReleases(rollout)?.map((r) => r.tag) ?? []);

		// Show persistent toast with spinner while checking
		showToast = true;
		toastLoading = true;
		toastMessage = 'Checking for new versions...';
		toastDescription = '';
		toastShowLogsAction = false;
		toastType = 'success';

		try {
			const response = await fetch(
				apiPath(
					cluster,
					`/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/reconcile`
				),
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

				const currentReleases = availableReleases(rolloutQuery.data?.rollout) ?? [];
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
				toastDescription = 'Check the Newer builds card to deploy one.';
				toastShowLogsAction = false;
				toastType = 'success';
			} else {
				toastMessage = 'No new versions available';
				toastDescription = '';
				toastShowLogsAction = false;
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
			toastDescription = '';
			toastShowLogsAction = false;
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
				apiPath(cluster, `/rollouts/${kruiseRolloutNamespace}/${kruiseRolloutName}/continue`),
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
			// ⭐ ROUND 2, ITEM 9: same rule as `retryDeployment` — the description
			// names the build and place, not the rollout's own name again (the
			// title already says what happened to "this rollout"; the reader is
			// standing on its page).
			toastMessage = 'Rollout continued';
			{
				const latest = rollout?.status?.history?.[0]?.version;
				const build = latest ? getDisplayVersion(latest) : kruiseRolloutName;
				const place = environment?.spec?.environment || namespace;
				toastDescription = `${build} continues deploying in ${place}.`;
				toastShowLogsAction = false;
			}
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
			toastDescription = '';
			toastShowLogsAction = false;
			toastType = 'error';

			// Auto-hide toast after 3 seconds
			setTimeout(() => {
				showToast = false;
			}, 3000);
		}
	}

	async function retryDeployment(kruiseRolloutName?: string, testAction = '') {
		try {
			const response = await fetch(apiPath(cluster, `/rollouts/${namespace}/${name}/retry`), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kruiseRolloutName: kruiseRolloutName || '', testAction })
			});

			if (!response.ok) {
				throw new Error('Failed to retry deployment');
			}

			showToast = true;
			// ⭐ ROUND 2, ITEM 9 + ROUND 3, ITEM 13 (squad-rollout coordinator,
			// 2026-10-09): THE DESCRIPTION ADDS A FACT, IT DOES NOT RESTATE THE
			// TITLE. "Deployment retry initiated / Retrying checkout-worker in
			// checkout-worker-staging" said the same thing twice; then "Retry
			// started / {build} is deploying again in {place}" wrapped the
			// identifier at a hyphen on both 1440 and 390 and still read as a
			// restatement. Title is the ACT; description is the build id and
			// what changed, `build · fact` (Toast's own one-line `truncate`
			// now makes the id un-wrappable, not a word choice here), and the
			// toast gets a `View logs` action — the next thing a reader who
			// just retried a deploy wants.
			toastMessage = 'Retry started';
			{
				const latest = rollout?.status?.history?.[0]?.version;
				const build = latest ? getDisplayVersion(latest) : name;
				toastDescription = `${build} · Check restarted`;
			}
			toastShowLogsAction = true;
			toastType = 'success';
			setTimeout(() => {
				showToast = false;
			}, 3000);
			await rolloutQuery.refetch();
		} catch (error) {
			console.error('Retry deployment error:', error);
			showToast = true;
			toastMessage = `Failed to retry: ${error instanceof Error ? error.message : 'Unknown error'}`;
			toastDescription = '';
			toastShowLogsAction = false;
			toastType = 'error';
			setTimeout(() => {
				showToast = false;
			}, 3000);
		}
	}
</script>

<svelte:head>
	<title
		>{pageTitle(
			rollout?.metadata
				? `${rollout.status?.title || rollout.metadata.name} (${rollout.metadata.namespace})`
				: 'Rollout'
		)}</title
	>
</svelte:head>

<div class="bg-ground min-h-full">
	{#if loading}
		<!--
			⭐ THE SAME COMPOSITION THE LOADED PAGE USES, NOT A GUESSED STACK OF
			BOXES. (2026-09-04, load-state audit finding 1) The old skeleton was
			five `animate-pulse` divs of hand-picked heights (10/48, 28/full,
			64/full, two 44s side by side) with no relationship to the two-column
			`.ov-split` layout, the pipeline card, or the rail's four cards below
			it — the flip from this to the loaded page moved almost every
			landmark on the page. This one reuses `.ov-split`/`.ov-split-cq`
			(this component's own `<style>` block, unchanged) and `CardSkeleton`
			for every card that IS one, so the two states share their grid and
			their card geometry; only the hero status card and the page header
			(neither is a `Card`) are hand-drawn, matching their own real markup
			below (the hero card's shell, the header's `t-title` name).
		-->
		<div class="mx-auto w-full px-4 pt-6 pb-10 sm:px-6">
			<StillTryingNotice failureCount={rolloutQuery.failureCount} />
			<div class="mb-4 flex flex-wrap items-baseline gap-3" aria-hidden="true">
				<span class="skel-block h-6 w-48"></span>
				<span class="skel-block h-5 w-16"></span>
			</div>
			<div class="ov-split-cq">
				<div class="ov-split flex flex-col gap-4">
					<div class="flex flex-col gap-4">
						<!-- The hero status card — same shell as the real markup a
						     few hundred lines below (`rounded-md`/`border-line`/
						     `bg-surface`, the language's one card treatment). -->
						<div
							class="border-line bg-surface flex flex-col gap-3 overflow-hidden rounded-md border p-5"
							aria-hidden="true"
						>
							<span class="skel-block h-5 w-72"></span>
							<span class="skel-block h-3.5 w-48"></span>
							<div class="flex flex-wrap gap-2 pt-1">
								<span class="skel-block h-9 w-32 rounded"></span>
								<span class="skel-block h-9 w-32 rounded"></span>
								<span class="skel-block h-9 w-40 rounded"></span>
							</div>
						</div>
						<!-- Pipeline card — see `managedResourcesKnown`'s own note
						     below on why the real card never draws a rollup before
						     its stage count is known. -->
						<CardSkeleton titleWidth="w-40" rollupWidth="w-16" rows={4} rowHeight={32} />
						<!-- "Newer builds" — hand-rolled in the real page too, same
						     47px header floor `CardSkeleton` reserves. -->
						<CardSkeleton titleWidth="w-28" rollupWidth="w-20" rows={1} rowHeight={20} />
					</div>
					<!-- The right rail — four cards, final order, see the identical
					     block in the loaded branch below for the per-card sizing
					     rationale. -->
					<div class="flex flex-col gap-4">
						<CardSkeleton titleWidth="w-28" rows={1} rowHeight={36} />
						<CardSkeleton titleWidth="w-24" rows={2} rowHeight={28} />
						<CardSkeleton titleWidth="w-20" rows={3} rowHeight={28} />
						<CardSkeleton titleWidth="w-24" rows={1} rowHeight={36} />
					</div>
				</div>
			</div>
		</div>
	{:else if error}
		<ErrorState
			{error}
			subject="this rollout"
			backHref={href('/rollouts')}
			backLabel="Back to all rollouts"
			onRetry={() => outage.retry()}
			isRetrying={outage.isRetrying}
		/>
	{:else if !rollout}
		<!-- ⭐ ROUND 2 (2026-10-08, design review 4): A MISSING ROLLOUT IS A
		     `NotFound`, NOT A BANNER. This used to be an `AlertPanel` at
		     `severity="warning"` — the STUCK-only amber token spent on an
		     ordinary wrong address, the same defect found product-wide this
		     round. `NotFound.svelte` is the shared calm composition (own doc
		     comment has the full reasoning); this call site supplies what it
		     alone knows — the rollout's own identity as the eyebrow/title pair,
		     and the record of what was actually asked for.

		     ⚠️ `Server answered: no release` KEEPS THE DISTINCTION THE OLD
		     FOOTNOTE EXISTED FOR. The request SUCCEEDED — this is not a failed
		     request and there is no server sentence to quote. Never invent
		     one; see `errorFacts`, which is the other half of this state. -->
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
		<div class="mx-auto w-full px-4 pt-6 pb-10 sm:px-6">
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
					`on the newest` while zero pods had run the new build. `releaseCandidates.length
					=== 0` says "nothing newer is ALLOWED"; it does not say "this is
					SERVING". `stillCatchingUp` is the second half of that fact —
					true exactly while the current history entry hasn't settled —
					and every `on the newest` verdict on this card checks it too.
				-->
				{@const stillCatchingUp =
					latestEntry.bakeStatus === 'Deploying' || latestEntry.bakeStatus === 'InProgress'}
				<!-- ⭐ U-10, ledger (2026-10-08): `environment?.spec?.environment`
					alone left this header chip BLANK on `checkout-worker-staging`
					— its `Environment` object has `spec.label: "staging"` but no
					`spec.environment` field, so every other rollout page prints an
					env chip and this one printed nothing next to the title. The
					rollout's own `metadata.labels.environment` (`"staging"`) was
					sitting right there the whole time — it's the SAME fallback chain
					`deploy-risk.ts`'s `rolloutEnvironmentName` already walks for the
					banner/modal's own "production or not" question, reused here
					rather than inventing a second one. -->
				{@const currentEnv =
					rolloutEnvironmentName(rollout, environment?.spec?.environment) || null}
				{@const pipelineKruiseRollouts = Object.values(managedResources)
					.flat()
					.filter((resource) => resource.groupVersionKind === 'rollouts.kruise.io/v1beta1/Rollout')}
				{@const pipelineValidRollouts = pipelineKruiseRollouts
					.map((rolloutResource) => {
						// A1: the fleet list's copy is stream-patched; take the newer of the two copies (see `freshestKruise`).
						const managedKr = rolloutResource.object as KruiseRollout;
						const listKr = (listQuery.data?.kruiseRollouts?.items ?? []).find(
							(k) =>
								k.metadata?.name === managedKr?.metadata?.name &&
								k.metadata?.namespace === managedKr?.metadata?.namespace &&
								sourceDashboardURL(k) === sourceDashboardURL(managedKr)
						);
						const kruiseRollout = freshestKruise(managedKr, listKr);
						const canarySteps = kruiseRollout?.spec?.strategy?.canary?.steps;
						// QA #5: a KruiseRollout still carrying the PREVIOUS deploy's
						// status (see `kruiseStatusIsPreviousDeploy`) has finished none
						// of this deploy's steps.
						const previousDeploy = kruiseStatusIsPreviousDeploy(kruiseRollout, rollout);
						const rolloutData = previousDeploy
							? { ...kruiseRollout?.status?.canaryStatus, currentStepIndex: 0, currentStepState: undefined }
							: kruiseRollout?.status?.canaryStatus;
						if (rolloutData && canarySteps && canarySteps.length > 0) {
							return {
								rolloutResource,
								kruiseRollout,
								rolloutData,
								canarySteps,
								// ⛔ `canaryStatus.currentStepState`, NOT `status.currentStepState`
								// — the latter is a field kruise's v1beta1 Rollout does not
								// have, so this read was ALWAYS undefined and no canary ever
								// finished on this page. The cost: every completed pipeline
								// kept its last stage drawn `ACTIVE · IN PROGRESS` with the
								// stages after it `PENDING`, the rollup said `2/5 done ·
								// active`, and `allStagesDone` (which gates the bake cell)
								// stayed false — so a rollout whose hero read `deploy
								// succeeded` sat beside a pipeline that said it was still
								// running. `pipeline.ts`, which draws the same thing for the
								// list glyph, reads the right path and always has; the two
								// surfaces are meant to agree (see that file's header).
								// The legacy path stays in the `||` so a hand-written
								// fixture that used it does not regress.
								isCompleted:
									!previousDeploy &&
									(rolloutData?.currentStepState === 'Completed' ||
									// eslint-disable-next-line @typescript-eslint/no-explicit-any
									(kruiseRollout.status as any)?.currentStepState === 'Completed')
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
						? 'bg-success-solid'
						: latestEntry.bakeStatus === 'Failed'
							? 'bg-danger-solid'
							: latestEntry.bakeStatus === 'InProgress'
								? 'bg-progress-solid'
								: 'bg-active-solid'}
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
				<!-- ⭐ MIGRATED TO `PageHeader`. (2026-10-08, design language) The
				     name is the title (sans, `t-title` — `PageHeader`'s default,
				     since names are set in the UI face now, not mono), the
				     environment chip is the `identity` slot, and the secondary
				     title/"↗ across envs" link are `meta` — the exact
				     `eyebrow`/`title`/`identity`/`meta` shape the component's own
				     doc comment names for an object page
				     (`"ROLLOUT / checkout-worker [STAGING] ↗ across envs"`). -->

				<!-- ⭐ THE BUILD CARD IS GONE (AD round 1): its facts are the page
				     header's — the build on the title line, the state as a pill,
				     the age / newer-builds / revision / schedule facts and the
				     commit in the meta row. Each block below is the card's own,
				     moved, not rewritten. -->
				{#snippet heroTitleAfter()}
					<!-- r34 tabs-nb r3 (#7): the build links to the CHANGE it maps to (the one PR the head commit
					     belongs to, `/changes/<repo>/pull/<n>` -- the header line's own #n), else to this deploy's
					     row in History; never to a sha page that may not exist. -->
					{@const hdrLatestKey = rollout.status?.history?.[0] ? deployKey(rollout.status.history[0]) : null}
					{@const hdrHistoryHref = hdrLatestKey
						? `${rolloutPath(cluster, namespace, name, 'history')}?${DEPLOY_PARAM}=${encodeURIComponent(hdrLatestKey)}`
						: rolloutPath(cluster, namespace, name, 'history')}
					<StarToggle app={rollout.metadata?.name ?? name} class="self-center" />
					<!-- The separator travels with the build: one nowrap group, so a
					     wrap at 390 moves "/ 2.66.0-66" together and no line ends on
					     a bare slash. -->
					<span class="inline-flex items-baseline gap-x-3 whitespace-nowrap">
						<span class="t-title text-fg-disabled" aria-hidden="true">/</span>
						<a
							href={hdrPullNumber
								? href(`/changes/${repoSlug(repoKeyFor(rollout, name))}/pull/${hdrPullNumber}`)
								: hdrHistoryHref}
							class="t-code-lg text-fg-muted hover:text-fg hover:underline"
						>
							{getDisplayVersion(latestEntry.version)}
						</a>
					</span>
				{/snippet}
				{#snippet heroIdentity()}
					<Chip
						role={latestEntry.bakeStatus === 'Succeeded'
							? 'ready'
							: latestEntry.bakeStatus === 'Failed'
								? 'failing'
								: latestEntry.bakeStatus === 'InProgress'
									? 'checking'
									: latestEntry.bakeStatus === 'Deploying'
										? 'deploying'
										: 'unranked'}
						label={latestEntry.bakeStatus === 'Succeeded'
							? 'deployed'
							: latestEntry.bakeStatus === 'Failed'
								? 'failed'
								: bakeWord(latestEntry.bakeStatus)}
						title={bakeTitle(latestEntry.bakeStatus)}
					/>
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
						<span class="t-ui-sm text-active flex items-center gap-1">
							<StatusSpinner size="3" color="blue" />
							Deploy requested — starting
						</span>
					{/if}
				{/snippet}
				{#snippet heroMeta()}
					<!-- D8 (LOGOPEN r10): the age is a plain fact on the "·" line, no
					     clock icon, the same as every other rollout tab. -->
					<!-- r11, item 5: no age on the phone meta line (it has other facts). -->
					<span
						class="t-meta text-fg-subtle tabular-nums max-lg:hidden"
						title={formatDate(latestEntry.timestamp)}
						>{formatTimeAgoCompact(latestEntry.timestamp, $now)} ago</span
					>
					<span class="t-meta contents"
						>{#if isCurrentVersionCustom || headerNewer > 0 || (getRevisionInfo(latestEntry.version) && formatRevision(getRevisionInfo(latestEntry.version)!) !== getDisplayVersion(latestEntry.version)) || scheduleMetaText}
							{#if headerNewer > 0}
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
								<!--
															⭐ THE SAME WAIT, SAID ON THE WHOLE PAGE, NOT ONLY
															INSIDE THE NEWER BUILDS CARD. (2026-09-20, coordinator
															relay) A viewer watching the version card never
															scrolls to that card's own row, so the identical
															`newestHeldByHealth`/`justOpenedHealthGate` facts ride
															here too — same clause text
															(`newestHealthHoldClause`), never a second sentence
															for the same count. `promoting` reuses the `Deploying`
															blue this page already spends on "the system is
															moving this on its own" (`pendingAction`'s "Deploy
															requested — starting", six lines up); `held` keeps
															this line's existing orange, matching the `held` Chip
															below and the pinned branch already here.
														-->
								<span
									class="hdr-newer flex min-w-0 items-center gap-1 max-sm:max-w-[calc(100%-7rem)] {justOpenedHealthGate && !blockStory.pinnedTo
										? 'text-active'
										: 'text-fg-muted'}"
								>
									<ArrowUpOutline class="h-3 w-3" />
									<!-- r34 tabs-nb r3 (#6): below 640 the fact is ONE line (ellipsis when the hold clause is long): the
									     clause arrives after the health checks, and a wrap there pushed the whole header down 20px. -->
									<span class="min-w-0 max-sm:truncate">
										{#if blockStory.pinnedTo}
										{headerNewer} newer · held by the pin
									{:else if blockStory.blocked}
										<!-- One fact, once: the held banner below names every
																     cause (gate and contract); the meta only counts. -->
										{headerNewer}
										{headerNewer === 1 ? 'newer build' : 'newer builds'}
									{:else if newestCandidateBlockedByGate}
										{headerNewer}
										{headerNewer === 1 ? 'newer build' : 'newer builds'}
										· held: {newestGateHoldClause}
									{:else if newestHeldByHealth}
										{headerNewer}
										{headerNewer === 1 ? 'newer build' : 'newer builds'}
										· held: {newestHealthHoldClause}
									{:else if justOpenedHealthGate}
										{headerNewer}
										{headerNewer === 1 ? 'newer build' : 'newer builds'}
										· promoting
									{:else}
										{headerNewer}
										{headerNewer === 1 ? 'newer build' : 'newer builds'}
									{/if}</span>
								</span>
							{/if}
							{#if isCurrentVersionCustom}
								<span class="text-fg-muted">Custom build</span>
							{/if}
							{#if getRevisionInfo(latestEntry.version) && formatRevision(getRevisionInfo(latestEntry.version)!) !== getDisplayVersion(latestEntry.version)}
								<span class="t-code-sm text-fg-subtle">
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
								<span class="text-fg-subtle flex items-center gap-1">
									<CalendarWeekSolid class="h-3 w-3" />
									{scheduleMetaText}
								</span>
							{/if}
						{/if}</span
					>
					{#if rollout?.status?.source && rollout.status.history && rollout.status.history.length > 1}
						{@const historyHref = rolloutPath(cluster, namespace, name, 'history')}
						{@const latestKey = deployKey(latestEntry)}
						<!-- r34 tabs-nb r2 (#9): the slot's height is RESERVED before the commit data arrives — two
						     lines below 640 (title, then stats), one from there up — so the content under it never moves. -->
						<div class="min-w-0 basis-full {githubConnected ? 'min-h-[2.5rem] sm:min-h-[1.25rem]' : ''}">
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
									headline
									bind:headPullNumber={hdrPullNumber}
									hideWhenEmpty
									class="hover:bg-hover -mx-1.5 rounded px-1.5 py-0.5 transition-colors"
								/>
							{:else}
								<p class="t-meta text-fg-subtle">
									Commit message and author need GitHub. {githubAbsenceSentence(githubStatus.data)}
								</p>
							{/if}
						</div>
					{/if}
				{/snippet}
				{#snippet heroActions()}
					{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
						<SourceViewer
							namespace={rollout.metadata?.namespace || ''}
							name={rollout.metadata?.name || ''}
							version={latestEntry.version.tag}
							{cluster}
						/>
					{/if}
					{#if rollout?.status?.source}
						<a
							class="btn btn-secondary max-lg:h-11"
							href={getGitHubUrl(
								getDisplayVersion(latestEntry.version),
								latestEntry.version.revision
							)}
							target="_blank"
							rel="noopener noreferrer"
						>
							<GithubSolid class="h-4 w-4" aria-hidden="true" />
							View on GitHub
						</a>
					{/if}
					{#if canModify || !permissionsKnown}
						{#if rollout.spec?.wantedVersion && !isPinnedVersionCustom}
							<button
								type="button"
								class="btn btn-secondary max-lg:h-11"
								disabled={!permissionsKnown || !isDashboardManagingWantedVersion || !!pendingAction}
								onclick={() => {
									showClearPinModal = true;
								}}
							>
								Clear pin
							</button>
						{/if}
						<button
							type="button"
							id="status-change-version-btn"
							data-tour="change-version"
							class="btn btn-secondary max-lg:h-11"
							disabled={!permissionsKnown || !isDashboardManagingWantedVersion || !!pendingAction || !!noSource}
							title={noSource ? 'No release source, so there are no versions to choose from' : undefined}
							onclick={() => {
								if (isDashboardManagingWantedVersion) {
									isPinVersionMode = false;
									selectedVersion = null;
									deployExplanation = '';
									requestChangeVersionModal();
								}
							}}
						>
							<EditOutline class="h-4 w-4" aria-hidden="true" />
							Change version
						</button>
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
										     rendered at all in that case.

										     ⭐ ONE ROLLBACK ACTION ON SCREEN, ROUND 2 (2026-10-08,
										     coordinator review). While `FailurePanel`'s banner is
										     showing, ITS `Rollback` already does exactly what this
										     button does (same `ChangeVersionModal`, same target) and
										     carries the page's one `.btn-primary` — a second
										     `Roll back to X` twelve pixels below it was two controls
										     for one fact. `!isFailed` hides this one only while that
										     banner offers the action; it returns the moment the
										     banner itself leaves (a retry, a recovered check). -->
						{#if rollbackNow && !isFailed}
							<button
								type="button"
								id="status-rollback-btn"
								class="btn btn-secondary max-lg:h-11"
								data-phone-end
								disabled={!permissionsKnown || !isDashboardManagingWantedVersion || !!pendingAction}
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
										// ⛔ NO PRE-WRITTEN REASON. (2026-09-03, operator walk) A cause nobody
										// asserted was landing in the deploy history. The note is required;
										// the operator writes it.
										deployExplanation = '';
										requestChangeVersionModal();
									}
								}}
							>
								<!-- One header Roll back (r10, D2): 16px icon, as every tab. -->
								<UndoOutline class="h-4 w-4" aria-hidden="true" />
								Roll back to {rollbackDisplay}
							</button>
						{/if}
						{#if !isDashboardManagingWantedVersion}
							{#if canHover.current}
								<Tooltip
									triggeredBy="#status-change-version-btn"
									placement="bottom"
									transition={blur}
									transitionParams={{ duration: 300 }}
								>
									Another controller owns this rollout's wanted version, so the dashboard cannot pin
									it.
								</Tooltip>
							{:else}
								<!-- ON TOUCH THE REASON IS PRINTED, NOT HIDDEN BEHIND A HOVER.
												     (2026-10-09.) The tooltip only renders where there is a
												     hover, so on a phone the disabled Change Version / Rollback
												     buttons said nothing about why. One quiet line under the
												     row, the same sentence the tooltip carries. -->
								<p class="t-meta text-fg-subtle w-full">
									Another controller owns this rollout's wanted version, so the dashboard cannot pin
									it.
								</p>
							{/if}
						{/if}
					{/if}
				{/snippet}
				<PageHeader
					title={rollout.metadata?.name ?? ''}
					titleAfter={heroTitleAfter}
					metaSeparated
					class="mb-6"
				>
					{#snippet actions()}
						{#if canModify || !permissionsKnown || rollout?.status?.source || rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}{@render heroActions()}{/if}
					{/snippet}
					{#snippet identity()}
						<!-- Below sm the state moves onto the age line (meta, below),
						     the same phone meta line RolloutTabHeader draws on every
						     other tab (LOGOPEN r8). `sm:contents`: sm+ is untouched. -->
						<span class="max-lg:hidden lg:contents">{@render heroIdentity()}</span>
						{#if appLane}
							<!-- the lane below names the environment -->
						{:else if !currentEnv && rolloutTheme}
							<!-- No Environment record, but the rollout carries an
							     identity (theme annotation / name inference): still name
							     it, unlinked, so every state of this page has its chip. -->
							<Chip
								role="env"
								theme={rolloutTheme}
								label={shortEnvLabel(rolloutTheme) || rolloutTheme.label}
								title={rolloutTheme.label}
								wide
							/>
						{:else if currentEnv}
							<a
								href={href(`/envs/${encodeURIComponent(currentEnv)}`)}
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
					{/snippet}
					{#snippet meta()}
						<!-- Phone only (LOGOPEN r8): "FAILED · 16m ago". No header Roll
						     back here: the failure panel already carries it on the first
						     screen. -->
						<span class="inline-flex items-center gap-2 lg:hidden" data-phone-only
							>{@render heroIdentity()}</span
						>
						<!-- ⭐ ROUND 2 (2026-10-08, coordinator review): beside the
						     namespace line, not floating alone below the title —
						     a quiet `.nav-link` at `t-ui-sm`, the same row as the
						     rollout's own secondary title when one exists, instead
						     of being the only content in `PageHeader`'s `meta` row
						     (which read as a stray orphan line on its own). -->
						{#if rollout.status?.title && rollout.status.title !== rollout.metadata?.name}
							<span class="t-meta text-fg-subtle min-w-0 truncate">{rollout.status.title}</span>
						{/if}
						<!-- The namespace is the row's anchor: the object's own address,
						     sans (it is a name), so the cross-env link reads as a fact
						     about it rather than a stray line. -->
						{@render heroMeta()}
						{#if rollout.metadata?.namespace}
							<!-- Phone: the namespace is the top bar's context already; the
							     meta line stays one row (r11). -->
							<span class="t-meta text-fg-subtle min-w-0 truncate max-lg:hidden"
								>{rollout.metadata.namespace}</span
							>
						{/if}
					{/snippet}
					{#snippet below()}
						{#if appLane}
							<!-- ⭐ THE HERO (AD round 1): this app's promotion lane —
							     the same component as Home — with this rollout outlined.
							     Identity and position in the chain read as one fact. -->
							<!-- Inline in the header block (AD round 2): the lane is a fact about
							     this object, like its build — no card, no eyebrow. -->
							<!-- Below sm the lane takes the full row and "All environments"
							     drops to its own line: sharing 390px with the link left the
							     lane's (scrollbar-less) strip clipping "staging 1 beh…" with
							     nothing to say it scrolls. -->
							<div class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 pb-1">
								<div class="min-w-0 basis-full sm:flex-1 sm:basis-0">
									<PromotionLane
										lane={appLane}
										hrefFor={(n) =>
											rolloutPath(n.card.sourceCluster || cluster, n.card.ns, n.card.name)}
										current={{ ns: namespace, name }}
										youAreHere
										showApp={false}
									/>
								</div>
								<a href={href(`/apps/${rollout.metadata?.name}`)} class="nav-link t-ui-sm !py-0"
									>All environments<ChevronRightOutline class="h-3 w-3" /></a
								>
							</div>
						{/if}
					{/snippet}
					{#snippet summary()}
						{#if rollout.status?.description && rollout.status.description !== (rollout.status?.title || rollout.metadata?.name)}
							{@const runningLabel = subtitleRunningLabel()}
							<p>
								{rollout.status.description}{#if runningLabel}
									<span class="text-fg-subtle">&nbsp;· running {runningLabel}</span>
								{/if}
							</p>
						{/if}
					{/snippet}
				</PageHeader>

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
				<!-- QA #3: a block-level sibling directly above the banner slot, rendered whatever the candidate count -->
				<ReleaseSourceNotice {rollout} class="mt-6 mb-4" />
				{#if myClusterErrors.length}
					<PartialDataNotice class="mb-4" errors={myClusterErrors} subject="this rollout" onRetry={() => fleetListQuery.refetch()} isRetrying={fleetListQuery.isFetching} />
				{/if}
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
				{:else}
					<!--
						⭐ MOUNTED WHENEVER NOT PINNED, OPEN ONLY WHILE HELD. The
						condition is the panel's `open`, not an `{#if}`, so when a
						gate promotes the banner collapses out (`AlertPanel`'s
						`open`) instead of vanishing and dropping the page ~140px
						in one frame. (2026-10-08, film critic, promote scene.)

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
						<!-- ONE FACT, ONCE (design review 2026-10-08): the rule count is
						     the disclosure's label below; this slot now always offers
						     the place the rules live, the Gates tab. -->
						<a href={rolloutPath(cluster, namespace, name, 'gates')} class="nav-link">
							Gates
							<ChevronRightOutline class="h-3 w-3" />
						</a>
					{/snippet}
					<BlockingStoryPanel
						story={blockStory}
						title={holdCausePhrase(blockStory, {
							place: environment?.spec?.environment ?? null
						})}
						open={(hereCard?.held ?? blockStory.blocked) && blockStory.clock.length === 0}
						actions={blockedActions}
						secondaryFact={rollbackFoldedIntoGateBanner && rolledBack
							? rollbackWent(rolledBack, autoDeploy)
							: undefined}
					/>
					<!--
						⭐ REFUSED HERE VS NOT REACHED YET (shared/held-predicate,
						2026-10-11). `blockStory.blocked` used to mean "held", full
						stop — which is also true of plain chain sequencing (this
						environment's own promotion gate just has not been asked to
						admit a build its upstream has not deployed yet). That is
						never a hold: see `view-models/held.ts`'s own doc for the
						ruling. `hereCard.held` is `false` in exactly that case and
						`waitsForFact` names the stage this environment is behind —
						and, one hop only, why THAT stage is not moving, when it is
						itself held (`"staging held on payments-svc"`).
					-->
					{#if hereCard && !hereCard.held && waitsForFact}
						<!-- mb-4: the card gap, so the line does not sit flush on the
						     pipeline card below it (qa11 nit 4). -->
						<p class="text-fg-subtle mb-4 text-sm">
							{`${waitsForFact.wave ?? `Waits for ${waitsForFact.stage}`}${waitsForFact.heldCause ? ` · ${waitsForFact.heldCause}` : ''}`}
						</p>
					{/if}
				{/if}

				<!-- ══ FAILURE PANEL ══ -->
				{#if isFailed || failedLinger}
					<!-- `open`, not the `{#if}`, is the banner's condition: while
					     it collapses (`AlertPanel`'s `open`) it keeps the failure it
					     was describing; only its height moves. `failedLinger` keeps
					     this mounted for that collapse. -->
					<FailurePanel
						open={isFailed}
						{rollout}
						{failedHCList}
						healthChecks={flowHealthChecks}
						{failedStepTests}
						{stalledKruiseRollout}
						canUpdate={canUpdate || !permissionsKnown}
						canModify={canModify || !permissionsKnown}
						actionsPending={!permissionsKnown}
						{isDashboardManagingWantedVersion}
						{cluster}
						environmentName={environment?.spec?.environment ?? null}
						onRetry={retryDeployment}
						onSuccess={(m) => {
							toastType = 'success';
							toastMessage = m;
							toastDescription = '';
							toastShowLogsAction = false;
							showToast = true;
							setTimeout(() => (showToast = false), 3000);
						}}
						onError={(m) => {
							toastType = 'error';
							toastMessage = m;
							toastDescription = '';
							toastShowLogsAction = false;
							showToast = true;
							setTimeout(() => (showToast = false), 3000);
						}}
					/>
				{/if}

				<!-- ══ DEPLOYMENT BLOCKED ══ -->
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
				<!-- `open`, not `{#if}`: health checks passing (a gate step) clears
					     this, and it collapses out instead of jumping the page. -->
				<AlertPanel
					open={!!(
						deploymentBlockedCondition &&
						!isFailed &&
						latestEntry.bakeStatus !== 'Deploying' &&
						latestEntry.bakeStatus !== 'InProgress'
					)}
					severity="warning"
					title="Held"
					message={deploymentBlockedCondition?.message || 'Health checks are unhealthy.'}
					footnote="A deploy you start by hand still applies immediately."
					pulse
				/>

				<!-- ══ LOCKSTEP MISMATCH (sites & waves) ══ -->
				<!-- The wave-1 leader's `lockstep` flag and a site's disagree, so the wave cannot hold in step. A warning: the
				     controller keeps working, the operator fixes one manifest. Names the disagreeing sites. -->
				<AlertPanel
					open={!!lockstepFault}
					severity="warning"
					title="Lockstep is set on {lockstepFault?.leader ? lockstepFault.leader : 'the wave-1 leader'} only"
					message={lockstepFault?.sites.length
						? `${joinList(lockstepFault.sites.map((x) => x.site))} ${lockstepFault.sites.length === 1 ? 'does' : 'do'} not agree. Set lockstep the same on every site of ${lockstepFault.tier || 'the tier'}.`
						: lockstepFault?.raw}
				/>

				<!-- ══ BAKE FAILURE DISABLED (RECOVERY MODE) ══ -->
				<!--
					The condition is set when a deploy starts and persists until the next
					deploy starts; only show the banner while the active deploy is still
					running (Deploying or InProgress).
				-->
				<!-- `open`: leaves with the deploy it describes, without a jump. -->
				<AlertPanel
					open={!!(
						bakeFailureDisabledCondition &&
						(latestEntry.bakeStatus === 'Deploying' || latestEntry.bakeStatus === 'InProgress')
					)}
					severity="info"
					title="Recovery mode"
					message={bakeFailureDisabledCondition?.message ||
						'Health check failures will not fail this deployment.'}
				/>

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
						<p class="t-meta text-fg-subtle mb-4 flex flex-wrap items-center gap-x-1.5 gap-y-1">
							<UndoOutline class="h-4 w-4 shrink-0" aria-hidden="true" />
							Rolled back {rollbackAge} ago{author ? ` · by ${author}` : ''}.
							<a href={rolloutPath(cluster, namespace, name, 'history')} class="nav-link">History</a
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
								<p class="mt-1 opacity-80">A deploy you start by hand still applies immediately.</p>
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
								<span class="t-meta text-fg-subtle tabular-nums">{rollbackAge} ago</span>
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
							⭐ THE HERO STAYS A HERO, AND THAT MEANS NO HEADER BAR.
							(2026-09-02, design re-check; migrated 2026-10-08 to the shared
							design language.) This object is deliberately not a `Card` in
							COMPOSITION, even though it now USES the Card shell (`bg-surface`,
							`border-line`, `rounded-md`, no shadow — the language's one card
							treatment): it carries the page's own object id (`t-code-lg`, the
							20px mono build) and the deploy's state disc, which is the page's
							lead object, not one card among a stack, so it has no 47px header
							bar and no right-aligned rollup. The language's shell replaces the
							old no-border/shadow-only separation (`rounded-xl` + `shadow-sm`,
							no border) — shadows no longer carry separation anywhere in flow;
							the 1px line does.
						-->
							<!-- ══ STATUS CARD ══ -->
							<!-- Glides to a new height when the deploy changes under it (a promote
						     swapping the build and its meta rows) instead of reflowing the page
						     in one frame — `$lib/smooth-height`. -->
							{#if !managedResourcesKnown}
								<CardSkeleton titleWidth="w-40" rollupWidth="w-16" rows={4} rowHeight={32} />
							{:else}
								<DeploymentPipelineCard
									{rollout}
									{latestEntry}
									{pipelineValidRollouts}
									{pipelineValidTests}
									healthChecks={visibleHealthChecks}
									healthChecksUnavailable={healthChecksFailed}
									healthChecksPending={!healthChecksKnown}
									{canUpdate}
									{namespace}
									{name}
									{cluster}
									onContinue={continueRollout}
								/>
							{/if}

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
							<!-- Glides when a candidate row leaves (a promote) — `$lib/smooth-height`. -->
							<div
								class="border-line bg-surface overflow-hidden rounded-md border {noSource ? 'hidden' : ''}"
								use:smoothHeight
								data-newer-builds-card
							>
								<div>
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
									<!-- ⛔ ITEM 2 (integrator re-check, round 3): `min-h-[47px]` +
							     `py-3` (every other card header's own combo, `Card.svelte`'s
							     included) assumes its tallest child is ~20-24px of text/chip —
							     true everywhere else, but THIS header also holds the Refresh
							     button, which item 10 now puts at a fixed 36px. `py-3`
							     (12+12=24px) on top of a 36px child is 60px of natural content
							     height, so `min-height` stopped being the binding constraint and
							     the row grew to 61px regardless of viewport width (measured at
							     360 through 1440 — this was never a wrap, just a floor that
							     could not hold its own tallest child). A fixed `h-[47px]` with no
							     vertical padding makes 47px the ACTUAL height, not a floor, so
							     the 36px button (and everything shorter) centres inside it via
							     `items-center` with room to spare. -->
									<div
										class="border-line-subtle flex min-h-[47px] items-center gap-3 border-b px-4 py-3"
									>
										<CodeOutline class="text-fg-subtle h-4 w-4 shrink-0" />
										<span class="t-card-title text-fg whitespace-nowrap">Newer builds</span>
										<!--
									⭐ THE ROLLUP IS NOT CONDITIONAL ON HAVING SOMETHING TO SAY.
									(2026-09-02, `COMPOSITION-GRAMMAR.md` §1) It used to render the
									`Chip` only when candidates existed, so the common case — a rollout
									that IS current — reached a header with no right-aligned answer at
									all: title, icon, then straight to the refresh button. That is the
									headerless-box defect one level down, not fixed by having a title.
									`on the newest` is the rollup's other value, in the same state-green
									the rest of the product answers this question with (`3/3 on the
									newest`, `All on the newest`).
								-->
										<div class="ml-auto flex items-center gap-2">
											{#if releasesLoading}
												<span class="t-ui-sm text-fg-subtle" data-releases-loading>Loading releases…</span>
											{:else if newerBuilds.length > 0}
												<!-- r34 tabs-nb r2 (#5): the baseline's rollup, back. Same count as the page
												     header's "↑ N newer" (both read `newerBuilds.length`). -->
												<span class="t-ui-sm text-fg-subtle tabular-nums"
													>{newerBuilds.length} newer</span
												>
											{:else if stillCatchingUp}
												<!-- ⭐ P10: NOT `on the newest` YET. `releaseCandidates` is
										     already empty (nothing newer is ALLOWED) but the current
										     history entry hasn't settled — see `stillCatchingUp`'s own
										     comment. Same neutral ink `BakeStatusIcon`'s in-flight
										     states use elsewhere on this page; green is reserved for
										     the verdict actually being true. -->
												<span class="t-ui-sm text-fg-subtle"
													>{bakeWord(latestEntry.bakeStatus)}…</span
												>
											{:else}
												<span class="t-ui-sm text-success">on the newest</span>
											{/if}
											<!-- TB12: the History link lives in the header's right slot (it was a subheader's
											     right slot, a bare word with no affordance). -->
											<!-- r34 tabs-nb r2 (#5): `.btn-ghost .btn-xs -my-1`, the very box the baseline's
											     Refresh control was (28px inside the 47px header) — never a 32px tap box. -->
											<a
												href={rolloutPath(cluster, namespace, name, 'history')}
												class="btn btn-ghost btn-xs -my-1 gap-0.5"
												>History<ChevronRightOutline class="h-3 w-3" aria-hidden="true" /></a
											>
											<!-- TB18 (r4): no Refresh — the build list streams; one rollup + the link. -->
										</div>
									</div>

									<!-- ⭐ THE REFRESH CONTROL, NOW A BODY ROW. It is a MUTATING
							     control (re-runs the Flux reconcile), so it earns button
							     chrome — just not in the slot COMPOSITION-GRAMMAR reserves
							     for the card's own rolled-up answer. Always present: staleness
							     is possible whatever the candidate count reads. -->

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
											class="border-held-line bg-held-tint flex items-start gap-3 border-b px-4 py-3"
										>
											<ShareNodesSolid class="text-held mt-0.5 h-4 w-4 shrink-0" />
											<p class="t-meta text-held min-w-0 flex-1">
												Holding {heldByThis.count} rollout{heldByThis.count === 1 ? '' : 's'} — {heldByThis.subjects}
												{heldByThis.plural ? 'need' : 'needs'}
												{heldByThis.need}.
												<a href={rolloutPath(cluster, namespace, name, 'gates')} class="nav-link"
													>See gates</a
												>
											</p>
										</div>
									{/if}

									<!-- Pin warning (compact banner) -->
									{#if rollout.spec?.wantedVersion && !isPinnedVersionCustom}
										<div
											class="border-held-line bg-held-tint flex items-center gap-3 border-b px-4 py-3"
										>
											<HeldGlyph class="text-held h-4 w-4 shrink-0" />
											<p class="t-meta text-held min-w-0 flex-1">
												Pinned to {blockStory.pinnedToDisplay ?? rollout.spec.wantedVersion} — automatic
												deploys are paused until the pin is cleared.
											</p>
											{#if canModify}
												<button
													type="button"
													class="btn btn-secondary btn-xs shrink-0"
													disabled={!isDashboardManagingWantedVersion || !!pendingAction}
													onclick={() => {
														showClearPinModal = true;
													}}
												>
													Clear pin
												</button>
											{/if}
										</div>
									{/if}

									<!-- Release candidates: `newerBuilds` (promotionCandidates), the ONE
							     list the banner, the count and this card read. `status.releaseCandidates`
							     can be absent while `availableReleases` still holds a newer, gate-held
							     build: the card then said "0 newer" under "1 newer build is waiting"
							     (squad-rollout, telemetry-indexer prod, incident). -->
									{#if newerBuilds.length > 0}
										<!-- ⭐ r34 NEWER BUILDS = THE HISTORY LEDGER'S FIRST HALF (pick A, typo/newer-builds/PICK.md).
										     The builds not deployed yet, newest first, on ONE spine (History's
										     `use:ledgerSpine`, TABS-DESIGN-GUIDE §3.8/§4.7) that ends at the build
										     running here — the spine's length is "how far behind", drawn. Three
										     32px subheaders (History's `deploy-day-header` anatomy): Newest · Older ·
										     Running here. Only the newest build's Deploy is at rest; an older one's
										     shows on row hover / keyboard focus at ≥1024 (`.row-reveal`), always on
										     touch. -->
										{#snippet nbFoldRow(n: number)}
											<!-- P6 fold row (TB24): the ONE control, in the gap it hides — no second count. -->
											<li class="bg-subtle relative flex items-center py-2 pr-4 pl-11">
												<button
													type="button"
													class="btn btn-secondary btn-sm"
													aria-expanded={nbShowAll}
													onclick={() => (nbShowAll = !nbShowAll)}
												>
													{nbShowAll ? 'Show fewer' : `Show ${n} older build${n === 1 ? '' : 's'}`}
												</button>
											</li>
										{/snippet}
										<ul
											class="nb-ledger divide-line-subtle divide-y @container"
											style="--nb-build-w: {nbBuildW}px"
											data-anyway={rowShowsFailed(failedHereVerdict(rollout, newerBuilds[0].tag)) ? '' : undefined}
											use:ledgerSpine
										>
											{#each nbVisible as nbRow, nbK}
												{@const releaseCandidate = nbRow.rc}
												{@const candidateIndex = nbRow.i}
												<!-- r34 tabs-nb r2 (#10): no "Older" subheader at any width — the one anchor is the
												     running build's "Running here" row (the spine ends there). -->
												{#if !nbShowAll && nbK > 0 && candidateIndex - nbVisible[nbK - 1].i > 1}
													{@render nbFoldRow(candidateIndex - nbVisible[nbK - 1].i - 1)}
												{/if}
												{@const version = releaseCandidate.tag}
												{@const blockingGates = getBlockingGates(version)}
												{@const contractHold = contractHoldFor(releaseCandidate)}
												<!-- ⭐ U-5, ledger (2026-10-08): a contract hold from
											 `holdEdgesIn` counts too — see that const's own
											 doc comment above. A candidate held by a
											 `RolloutDependency` that `rollout.status.gates`
											 never published is NOT `Ready`. -->
												{@const isBlocked = blockingGates.length > 0 || !!contractHold}
												<!-- A dependency's RolloutGate and its contract hold are ONE
											     cause: when every gate refusing this build is that
											     dependency's own, the row reads the contract sentence
											     ("Needs payments-svc ~2.9.0 · has 2.4.1"), never a
											     generic "held · 1 rule". -->
												{@const dependencyOnly =
													blockingGates.length > 0 &&
													dependencyOnlyHold(
														classifyBlockingGates(version),
														holdEdgesIn
															.filter((e) => e.held.includes(getDisplayVersion(releaseCandidate)))
															.map((e) => ({
																provider: contractHoldProviderName(e),
																gate: e.gate
															}))
													)}
												<!-- ⭐ U-9, 2026-10-08 (QA, fixing the comment-vs-code gap
											 U-4/ledger left): see `failedHereVerdict`'s own doc
											 comment (`deploy-risk.ts`). Checked INDEPENDENTLY of
											 `isBlocked` — a build can be both gate-held AND the
											 thing that just failed, and the FAILED fact takes the
											 row (it is the more urgent one: a gate reopening does
											 not make a build that already failed here trustworthy
											 again). The OLD code read `!isBlocked &&
											 failedHere.kind === 'failed'`, which said the exact
											 opposite of what this comment always claimed — a held
											 build that had also just failed here rendered plain
											 `Held by a gate`, never `failed here`, because
											 `isBlocked` silently suppressed `justFailed` before the
											 render chain below even got to choose. The render chain
											 (below) now checks `justFailed` FIRST, for the same
											 reason. -->
												{@const failedHere = failedHereVerdict(rollout, version)}
												{@const justFailed = rowShowsFailed(failedHere)}
												<!-- ⭐ ITEM 1 (coordinator, 2026-10-09): a row that passes every
										     known gate and has not just failed is NOT thereby `Ready` —
										     it is `Ready` only once `holdGraphKnown` says so. Scoped to
										     `!isBlocked && !justFailed`, same as `heldByHealth` below:
										     a gate-held or just-failed row already has its own marker and
										     has nothing to wait on. `contractHoldErrored` (item 2) splits
										     out the "never going to resolve" half — see `holdGraphErrored`'s
										     own comment — so the row says so plainly instead of
										     "checking…" forever. -->
												{@const contractHoldUnknown = !isBlocked && !justFailed && !holdGraphKnown}
												{@const contractHoldErrored = contractHoldUnknown && holdGraphErrored}
												<!--
											⭐ "PROMOTE ONLY WHEN IT'S HEALTHY", ON THE ROW ITSELF.
											See the script's own doc comment on `newestHeldByHealth` /
											`justOpenedHealthGate` — a health check pending or failing
											holds automatic promotion back exactly as a gate does, and
											nothing above computed that. Scoped to `candidateIndex === 0`
											(the newest — `newestCandidate` is `releaseCandidates[0]`)
											and to `!isBlocked`: a gate already holding this candidate
											already renders its own `held` chip above, and this is
											additive evidence, not a second opinion on the same row.
										-->
												{@const heldByHealth =
													candidateIndex === 0 && !isBlocked && !justFailed && newestHeldByHealth}
												{@const promotingByHealth =
													candidateIndex === 0 && !isBlocked && !justFailed && justOpenedHealthGate}
												{@const depInfo = getDependencyStatus(version)}
												{@const commitBase =
													newerBuilds[candidateIndex + 1]?.revision ??
													latestEntry?.version?.revision}
												<!-- ⛔ ITEM 1 (integrator re-check, round 3): below `sm` this
									     row was `flex items-center` (never wrapping), which left the
									     facts column only ~130px once the actions (GitHub/copy/Deploy,
									     ~167px) took their `shrink-0` share of a 390px card — measured
									     live, `Needs payments-svc ~2.9.0` (one still-unsplit run)
									     overflowed that column by 40px, under the action buttons. At
									     `<sm` the row now stacks: facts get the FULL card width on
									     their own line, actions a second line below — the facts' own
									     clause-wrap (`clauseRuns`) then has real room and the actions
									     never sit on top of text. `sm:` restores the single-row layout
									     once there is room for both. -->
												<!-- ⭐ NEWER-BUILD ROW, ON A GRID (owner §7, 2026-11-02: "text is laid out,
												     not dropped together"). Role: a candidate in the Overview's list, which the
												     Slipway pane rows and the History deploy row also play. Reference: the
												     History deploy row's discipline (mark column, mono build in its own
												     track, title in ink, age right) and the Dev card's slots on /environments.
												     >=512px of card: mark 16 | build 64 | title (+ state under it) | author 104
												     | age 40 | action, one x per slot down the list. Below: mark | build + state
												     + age | action over the title (author is one tap away, owner §5). -->
												{@const rowGateHeld =
													!justFailed && blockingGates.length > 0 && !dependencyOnly
														? classifyBlockingGates(version)
														: null}
												{@const rowVerdict = rowGateHeld
													? blockStory.pinnedTo
														? { held: true, cause: null, waitsForEnv: null }
														: verdictForGates(rowGateHeld, environment?.spec?.environment ?? null, {
																hasContract: !!contractHold
															})
													: null}
												{@const rowChain = !!rowVerdict && !rowVerdict.held && !!rowVerdict.waitsForEnv}
												{@const markState = justFailed
													? 'failed'
													: rowGateHeld
														? rowChain
															? 'behind'
															: 'held'
														: contractHold || heldByHealth
															? 'held'
															: promotingByHealth
																? 'deploying'
																: contractHoldErrored
																	? 'none'
																	: contractHoldUnknown
																		? 'checking'
																		: candidateIndex === 0
																			? 'newest'
																			: 'behind'}

												{@const isOlderRow = candidateIndex > 0}
												{#snippet deployBtn()}
													{#if canModify}
														<!-- ⭐ DEPLOY: ONLY THE NEWEST CARRIES IT AT REST (AD r3 #5). An older build's
														     Deploy is hover/focus at >=512px of card (in the actions cluster that
														     replaces the age, History §4.13), and on a narrow card appears after one
														     tap on the row, in place. Demotion rules unchanged: primary only when
														     nothing else on the page claims it (`isFailed`), secondary while held /
														     failed / promoting. -->
														<button
															type="button"
															class="btn btn-xs nb-deploy-btn {isOlderRow ||
															isBlocked ||
															justFailed ||
															heldByHealth ||
															promotingByHealth ||
															isFailed
																? 'btn-secondary'
																: 'btn-primary'}"
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
															<!-- U-4: the label matches the modal it opens (`deployButtonLabel`). -->
															{justFailed ? 'Deploy anyway' : 'Deploy'}
														</button>
													{/if}
												{/snippet}
												<!-- ⭐ NEWER-BUILD ROW = THE HISTORY DEPLOY ROW'S ANATOMY (r34 AD r3, tabs-typo-3).
												     Role: a build not deployed yet; the History tab's Deploys ledger is the
												     reference (spine mark | build mono 500 | title takes the free width | time in
												     one column at the card edge | hover/focus actions REPLACE the time, §4.13).
												     Wide (card >= 512px): mark | build | title | author (fixed column) | age; line 2 =
												     the cause SLOT (muted words + the failing-check glyph), Deploy (newest only)
												     under the age. Narrow: line 1 = mark | build | age | Deploy (newest), line 2 =
												     the cause in full, line 3 = the title (newest; an older row's title and Deploy
												     are one tap away). The tracks live in the style block (`.nb-row`). -->
												<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
												<li
													class="nb-row row-hover hover:bg-hover {isOlderRow ? 'nb-row-older' : 'nb-row-newest'}"
													data-open={nbOpen[version] ? 'true' : undefined}
													onclick={(e) => {
														const hit = (e.target as HTMLElement).closest('button,a');
														if (hit && !hit.hasAttribute('data-nb-toggle')) return;
														nbOpen[version] = !nbOpen[version];
													}}
												>
													<span class="nb-c-mark flex items-center justify-center">
														<span class="nb-mark" data-spine-mark><StatusMark state={markState} /></span>
													</span>
													<span class="nb-c-build nb-build t-code text-fg">
														{getDisplayVersion(releaseCandidate)}
													</span>
													{#if githubConnected && commitBase && releaseCandidate.revision}
														<CommitSummary
															{namespace}
															{name}
															{cluster}
															base={commitBase}
															head={releaseCandidate.revision}
															singleLine="slots"
															titleTone={candidateIndex === 0 ? 'fg' : 'muted'}
															hideWhenEmpty
															class="nb-c-title"
															authorClass="nb-c-author"
														/>
													{/if}
													{#if !isOlderRow || nbOpen[version]}
														<!-- r34 tabs-nb r3 (#4): ONE slot at every width, on line 1, left of the age: the
														     newest's Deploy at rest, an older row's once it is opened (touch) -- on a
														     hover-capable wide card the older row's hover cluster starts in this same track. -->
														<div class="nb-c-deploy">{@render deployBtn()}</div>
													{/if}
													{#if releaseCandidate.created}
														<span
															class="nb-c-age nb-rest t-meta text-fg-subtle tabular-nums"
															title={formatDate(releaseCandidate.created)}
														>
															{formatTimeAgoCompact(releaseCandidate.created, $now)}
														</span>
													{/if}
													<!-- History's disclosure (§4.8): the chevron button at the row's right edge, one x
													     down both lists; its ::after is not used (the row's own click toggles). -->
													<button
														type="button"
														data-nb-toggle
														aria-expanded={!!nbOpen[version]}
														class="nb-c-chev text-fg-subtle shrink-0 rounded-sm p-1"
													>
														{#if nbOpen[version]}
															<ChevronUpOutline class="h-4 w-4" aria-hidden="true" />
														{:else}
															<ChevronDownOutline class="h-4 w-4" aria-hidden="true" />
														{/if}
														<span class="sr-only">{nbOpen[version] ? 'Hide' : 'Show'} actions for {getDisplayVersion(releaseCandidate)}</span>
													</button>
													<div class="nb-c-cause flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
															{#if justFailed}
																<!-- ⭐ U-9, 2026-10-08: FAILED CHECKED FIRST, SO IT
															 TAKES THE ROW EVEN WHEN A GATE ALSO HOLDS THIS
															 BUILD. Content unchanged from the branch this
															 replaces below (moved, not rewritten) — see
															 `justFailed`'s own doc comment, three lines up,
															 for why the precedence flipped. -->
																<span
																	class="inline-flex min-w-0 items-center gap-1"
																	title="The last deploy of this build on this rollout failed its checks. Nothing has re-checked it since; deploying again tries it fresh."
																>
																	<span class="t-meta text-danger shrink-0">failed here</span>
																	{#if failedHere.kind === 'failed' && failedHere.rolledBackAt}
																		<span class="t-meta text-fg-subtle tabular-nums"
																			>rolled back {formatTimeAgoCompact(
																				failedHere.rolledBackAt,
																				$now
																			)}</span
																		>
																	{/if}
																</span>
															{:else if blockingGates.length > 0 && !dependencyOnly}
																{@const held = rowGateHeld!}
																<!-- ⭐ CHAIN VS REALLY HELD (squad-rollout gates-2 follow-up,
														     2026-10-11, shared/held-predicate). A candidate this
														     environment has simply not reached yet (an
														     earlier-tier promotion gate) is NOT "held" — see
														     `verdictForGates` (`held.ts`). A PIN outranks every
														     gate (`blockStory.pinnedTo`'s own rule, above), so the
														     chain check is skipped entirely while pinned: nothing
														     promotes automatically either way, and `heldWord`
														     already carries the pin's own clause. -->
																{@const buildVerdict = rowVerdict!}
																{@const chainOnly = rowChain}
																{@const chainLabel = chainOnly
																	? chainWaitLabel(skippedFn, { tag: version }, buildVerdict.waitsForEnv!)
																	: null}
																{@const peerClause = chainOnly && !chainLabel?.skipped
																	? (waitsFor(
																			{ waitsForEnv: buildVerdict.waitsForEnv },
																			{ peersByEnv }
																		)?.heldCause ?? null)
																	: null}
																{#if chainOnly}
																	<!-- TB28: two SLOTS on `.dot-list` (the dot is drawn, never typed): "Waits for
																	     staging" | "held on payments-svc". The shared cause is printed once, on the
																	     first row that has it. -->
																	{@const peerSlot =
																		peerClause && nbFirstPeer
																			? candidateIndex === nbFirstPeer.i || nbFirstPeer.peer !== buildVerdict.waitsForEnv
																				? peerClause.replace(new RegExp(`^${buildVerdict.waitsForEnv}\\s+`), '')
																				: null
																			: null}
																	<div class="dot-list">
																		<div class="dot-list-row flex flex-wrap">
																			<span
																				class="t-meta text-fg-muted"
																				title="Nothing promotes this build automatically until it reaches this environment."
																				>{chainLabel?.text}</span
																			>
																			{#if peerSlot && (candidateIndex === nbFirstPeer?.i || nbFirstPeer?.peer !== peerSlot)}
																				<span class="t-meta text-fg-muted">{peerSlot}</span>
																			{/if}
																		</div>
																	</div>
															{:else}
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
																		class="hit-32 inline-flex cursor-pointer items-center gap-1 rounded-xs"
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
																		<!--
																⭐ THE COUNT IS ON THE CHIP. (2026-09-18, from the human:
																"held needs to display how many gates are blocking it".)
																It was a bare `held` with the count as loose text beside
																it; `Chip`'s joined form is exactly this shape, so the
																chip now answers "how many" on its own.

																⚠️ `heldWord` IS STILL PRINTED WHEN IT SAYS MORE THAN THE
																COUNT. It usually returns `by N rules` — redundant once
																the chip carries N — but for a pin, or for a clock gate
																with a real countdown, it returns the CLAUSE instead
																(`reopens in 3h`). Dropping it wholesale would have
																deleted that. So it is printed only when it differs from
																the plain count form.
															-->
																		<span class="t-meta text-fg-muted">Held {heldCountPhrase(held)}</span>
																		{#if heldWord(held) !== heldCountPhrase(held)}
																			<span class="t-meta min-w-0 truncate text-fg-subtle">{heldWord(held)}</span>
																		{/if}
																		<!-- ⛔ A CHEVRON, NOT A QUESTION MARK. `?` with `cursor-help`
															     is a HOVER affordance and says nothing on a phone, which
															     is where this control most needs to read as openable. A
															     chevron is the product's own "there is more behind this"
															     mark. `hit-32` supplies the touch floor — its `::before`
															     is scoped to `@media (pointer: coarse), (max-width: 639px)`,
															     so it costs desktop nothing. -->
																		<ChevronDownOutline
																			class="text-fg-subtle h-3 w-3"
																			aria-hidden="true"
																		/>
																	</button>
																	<!--
													⛔ THE LINES, NOT THE RECORD. (2026-09-18, third attempt, and the
													second one is why this comment exists.)

													This started as a paragraph. I replaced it with `GateRecord` —
													the right OBJECT, wrong PLACE — and the human's verdict was:
													"you have to show it visually, what you did here is just created
													a table-like interface for each one with different values. in
													the end, they look the same again."

													Exactly so. A record is an aligned block of labelled facts, so
													five gates render as five identical tables and a 14px icon is
													the only thing telling them apart. `BlockingStoryLines` had
													already solved this for the other surface, against the SAME
													complaint ("i feel like you could better visualize this rather
													than just putting ascii icons in there"), by COMPOSING the line
													instead of narrating it — the provider at full ink, the contract
													as `[db|1.262.0] → [1.263]`, the window with its own countdown.

													Those lines are `GateLines` now, so this draws them instead of
													inventing a third shape. Kinds differ here because some kinds
													HAVE a second object to draw and some do not — `check`,
													`approval` and `unknown` keep their sentence, deliberately.

													⚠️ `GateRecord` IS NOT GONE FROM THE PRODUCT — it is what sits
													behind `BlockingStoryLines`' own `RulePopover`. It was never the
													wrong object, only the wrong one to put in the foreground. This
													host is itself a popover, so it cannot nest that control; the
													lines plus the verdict are what it shows.
												-->
																	<Popover class="t-body max-w-sm" title={heldTitle(held)}>
																		<div class="p-1">
																			<GateLines gates={held} />
																			<p
																				class="border-line-subtle t-meta text-fg-subtle mt-2 border-t pt-2"
																			>
																				{heldFoot(held)}
																			</p>
																		</div>
																	</Popover>
																{/if}
															{:else if contractHold}
																<!--
													⭐ HELD BY A CONTRACT, NOT A PUBLISHED GATE. (U-5,
													ledger, 2026-10-08.) `rollout.status.gates` never
													carries this hold on this fixture (see
													`holdEdgesIn`'s own comment) — the truth is
													`providerNetwork`'s inbound contract edge, which has
													no `RolloutGate` object to join into a
													`ClassifiedGate` for `GateLines`/`RulePopover`. Same
													chip and word as the gate-held branch above (never a
													second spelling of `held`); the sentence is composed
													straight from the edge's own fields instead of a
													popover, the same shape `heldByHealth` already uses
													below for the identical reason (no gate record to
													disclose).

													⭐ SAME WORDING AS THE GATES TAB'S OWN "Held builds"
													ROW — `routes/.../gates/+page.svelte`: `Needs
													{providerName} {requiredVersion} · has
													{providedVersion}`. Read there, not reinvented, so a
													reader who opens both tabs sees one sentence, not
													two about the same fact.
												-->
<div class="dot-list" title="{contractHold.provider} has not shipped a version this build needs. A deploy you start by hand still applies immediately.">
																	<div class="dot-list-row flex flex-wrap">
																		{#each contractHoldSlots(contractHold) as slot}
																			<span class="t-meta min-w-0 text-fg-muted">{slot}</span>
																		{/each}
																	</div>
																</div>
															{:else if promotingByHealth}
																<!--
															⭐ THE GATE OPENED, AND NOBODY CLICKED. The same blue
															`pendingAction` already uses for "the system is moving
															this on its own" (`Deploy requested — starting`,
															`ChangeVersionModal.svelte`'s own onDeployStart wiring)
															— reused here rather than invented, because this is the
															same fact one level earlier: healthy, and about to be
															promoted automatically.
														-->
																<span class="t-ui-sm text-active inline-flex items-center gap-1">
																	<StatusSpinner size="3" color="blue" />
																	promoting
																</span>
															{:else if heldByHealth}
																<!--
															⭐ HELD, BUT NOT BY A GATE. Same `Chip role="held"` and
															same word as the gate-held branch above (never a second
															spelling of "held") — the difference is only what
															clears it, said in the reason line instead of a
															popover, since there is no gate record to disclose.
														-->
																<span
																	class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
																	title="Automatic promotion waits until every health check passes. A deploy you start by hand still applies immediately."
																>
																	<span class="t-meta text-fg-muted">Waiting for health checks</span>
																	{#if newestHealthGateCounts.failing > 0}
																		<span class="t-meta text-danger inline-flex items-center gap-1">
																			<ExclamationCircleSolid class="h-3 w-3 shrink-0" aria-hidden="true" />
																			{newestHealthGateCounts.failing} failing
																		</span>
																	{/if}
																	{#if newestHealthGateCounts.pending > 0}
																		<span class="t-meta text-fg-subtle">{newestHealthGateCounts.pending} pending</span>
																	{/if}
																</span>
															{:else if contractHoldErrored}
																<!-- ⭐ ITEM 2 (coordinator, 2026-10-09): plain words, not
														     a "checking…" placeholder that will never resolve —
														     see `holdGraphErrored`'s own comment, and the SAME copy
														     `ChangeVersionModal`'s own picker row uses for the
														     identical state. Never a permanent disable: the row's
														     own `Deploy` below stays clickable, demoted (see the
														     button's `color`, below) — the typed-confirmation path
														     inside `ChangeVersionModal` is what actually carries
														     the risk once this button is pressed. -->
																<span class="t-meta text-fg-subtle">
																	Couldn't check dependency holds
																</span>
															{:else if contractHoldUnknown}
																<!-- ⭐ ITEM 1 (coordinator, 2026-10-09): THE SAME
														     "checking" PLACEHOLDER THE DIALOG ALREADY USES
														     (`ChangeVersionModal.svelte`'s `rowHeldPending` branch,
														     9d46961) — same `SkeletonBar` shape (`w-10`/`h-5`, the
														     `held` chip's own box) and the same `sr-only` copy, so a
														     reader who opens both surfaces sees one idiom for "this
														     answer isn't in yet", not two. -->
																<!-- Nothing drawn while the hold graph is unknown (TB2): the
																     16px `checking` mark carries "pending"; a reserved bar that
																     never fills read as a broken slot. -->
																<span class="sr-only">Checking whether this build is held</span>
															{:else if candidateIndex === 0}
																<span class="t-meta text-fg">Ready to deploy</span>
															{/if}

													</div>
													<!-- Actions: wide = they REPLACE the age (and the Deploy slot) on hover/focus
													     (§4.13); one tap on the chevron / row opens them in place on any width. -->
													{#if nbOpen[version] && githubConnected && commitBase && releaseCandidate.revision}
														<!-- r34 tabs-nb r2 (#7): an opened row lists the CHANGE rows History's open deploy
														     lists — the SAME CommitSummary `showMessages` list (sha mono · title · author),
														     with the author face; fold beyond 3. -->
														<div class="nb-c-changes t-meta">
															<CommitSummary
																{namespace}
																{name}
																{cluster}
																base={commitBase}
																head={releaseCandidate.revision}
																verb="to deploy"
																showMessages
																messagesMin={2}
																rowAvatars
																messageLimit={3}
															/>
														</div>
													{/if}
													<div class="nb-actions">
														<span class="nb-act-icons">
															{#if rollout?.status?.source}
																<button
																	type="button"
																	class="btn btn-ghost btn-sm {nbOpen[version] ? '' : 'btn-icon'}"
																	title={`View ${getDisplayVersion(releaseCandidate)} on GitHub`}
																	aria-label={`View ${getDisplayVersion(releaseCandidate)} on GitHub`}
																	onclick={() => {
																		const url = getGitHubUrl(
																			getDisplayVersion(releaseCandidate),
																			releaseCandidate.revision
																		);
																		window.open(url, '_blank');
																	}}
																>
																	<GithubSolid />{#if nbOpen[version]}GitHub{/if}
																</button>
															{/if}
															<CopyButton
																value={releaseCandidate.tag}
																label={`version ${getDisplayVersion(releaseCandidate)}`}
																color="ghost"
																size="sm"
																text={nbOpen[version] ? 'Copy version' : undefined}
															/>
														</span>
														{#if isOlderRow && !nbOpen[version]}
															<span class="nb-c-deploy-act">{@render deployBtn()}</span>
														{/if}
													</div>
												</li>
											{/each}
											{#if !nbShowAll && nbVisible.length > 0 && nbVisible[nbVisible.length - 1].i < nbRows.length - 1}
												{@render nbFoldRow(nbRows.length - 1 - nbVisible[nbVisible.length - 1].i)}
											{:else if nbShowAll && nbRows.length > nbCollapsed.length}
												{@render nbFoldRow(0)}
											{/if}
											{#if latestEntry?.version}
												{@const runningBase = rollout.status?.history?.[1]?.version?.revision}
												<!-- The spine's terminal row: the build this rollout runs. No band — a neutral 8px
												     stop (not a state: the banner and the header say how that deploy went, once)
												     and a quiet "Running here" in the cause slot. Same tracks as the rows above. -->
												<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
												<li
													class="nb-row row-hover hover:bg-hover nb-row-older nb-row-run"
													data-open={nbOpen['__run'] ? 'true' : undefined}
													onclick={(e) => {
														const hit = (e.target as HTMLElement).closest('button,a');
														if (hit && !hit.hasAttribute('data-nb-toggle')) return;
														nbOpen['__run'] = !nbOpen['__run'];
													}}
												>
													<span class="nb-c-mark flex items-center justify-center">
														<span
															class="nb-mark inline-flex h-4 w-4 items-center justify-center"
															data-spine-mark
															title="Running here"
														>
															<span class="bg-fg-subtle h-2 w-2 rounded-full"></span>
														</span>
													</span>
													<span class="nb-c-build nb-build t-code text-fg">
														{getDisplayVersion(latestEntry.version)}
													</span>
													{#if githubConnected && runningBase && latestEntry.version.revision}
														<CommitSummary
															{namespace}
															{name}
															{cluster}
															base={runningBase}
															head={latestEntry.version.revision}
															singleLine="slots"
															titleTone="muted"
															hideWhenEmpty
															class="nb-c-title"
															authorClass="nb-c-author"
														/>
													{/if}
													<!-- TB25: the age column means ONE thing down the spine — how old the BUILD is
													     (the running build's own `created`); the deploy time is the History
													     tab's and the header's. Falls back to the deploy time only for a build
													     with no creation stamp, said in the tooltip. -->
													{#if latestEntry.version.created || latestEntry.timestamp}
														{@const runAge = latestEntry.version.created ?? latestEntry.timestamp}
														<span
															class="nb-c-age nb-rest t-meta text-fg-subtle tabular-nums"
															title={latestEntry.version.created
																? `Built ${formatDate(runAge)}`
																: `Deployed ${formatDate(runAge)}`}
														>
															{formatTimeAgoCompact(runAge, $now)}
														</span>
													{/if}
													<button
														type="button"
														data-nb-toggle
														aria-expanded={!!nbOpen['__run']}
														class="nb-c-chev text-fg-subtle shrink-0 rounded-sm p-1"
													>
														{#if nbOpen['__run']}
															<ChevronUpOutline class="h-4 w-4" aria-hidden="true" />
														{:else}
															<ChevronDownOutline class="h-4 w-4" aria-hidden="true" />
														{/if}
														<span class="sr-only">{nbOpen['__run'] ? 'Hide' : 'Show'} actions for the running build</span>
													</button>
													<div class="nb-c-cause flex min-w-0 items-center">
														<!-- r34 tabs-nb r3 (#7): the age column is the BUILD's (monotonic down the card); the
														     header's "1h ago" is the DEPLOY's. When they differ the row says so, in its own
														     slot, so one build never reads as two times. -->
														{#if latestEntry.timestamp && latestEntry.version.created && formatTimeAgoCompact(latestEntry.timestamp, $now) !== formatTimeAgoCompact(latestEntry.version.created, $now)}
															<div class="dot-list">
																<div class="dot-list-row flex flex-wrap">
																	<span class="t-meta text-fg-subtle">Running here</span>
																	<span class="t-meta text-fg-subtle" title={`Deployed ${formatDate(latestEntry.timestamp)}`}
																		>deployed {formatTimeAgoCompact(latestEntry.timestamp, $now)} ago</span
																	>
																</div>
															</div>
														{:else}
															<span class="t-meta text-fg-subtle">Running here</span>
														{/if}
													</div>
													{#if nbOpen['__run'] && githubConnected && runningBase && latestEntry.version.revision}
														<div class="nb-c-changes t-meta">
															<CommitSummary
																{namespace}
																{name}
																{cluster}
																base={runningBase}
																head={latestEntry.version.revision}
																showMessages
																messagesMin={2}
																rowAvatars
																messageLimit={3}
															/>
														</div>
													{/if}
													<div class="nb-actions">
														<span class="nb-act-icons">
															{#if rollout?.status?.source}
																<button
																	type="button"
																	class="btn btn-ghost btn-sm {nbOpen['__run'] ? '' : 'btn-icon'}"
																	title={`View ${getDisplayVersion(latestEntry.version)} on GitHub`}
																	aria-label={`View ${getDisplayVersion(latestEntry.version)} on GitHub`}
																	onclick={() => {
																		window.open(
																			getGitHubUrl(
																				getDisplayVersion(latestEntry.version),
																				latestEntry.version.revision
																			),
																			'_blank'
																		);
																	}}
																>
																	<GithubSolid />{#if nbOpen['__run']}GitHub{/if}
																</button>
															{/if}
															<CopyButton
																value={latestEntry.version.tag}
																label={`version ${getDisplayVersion(latestEntry.version)}`}
																color="ghost"
																size="sm"
																text={nbOpen['__run'] ? 'Copy version' : undefined}
															/>
														</span>
													</div>
												</li>
											{/if}
										</ul>
									{:else if releasesLoading}
										<p class="t-meta text-fg-subtle px-4 py-3">Loading releases…</p>
									{:else if newerBuilds.length === 0}
										<!-- (2026-09-03, from the human: "when there's no available version,
								     we don't display anything.") The header's rollup is the verdict;
								     the body still has to say it in a sentence, or the card reads
								     as a title with nothing under it. -->
										<p class="t-meta text-fg-subtle px-4 py-3">
											No newer build to deploy right now. New builds appear here as the registry
											publishes them.
										</p>
									{:else if isCurrentVersionCustom}
										<!-- ⭐ MIGRATED TO THE DESIGN LANGUAGE'S `held` HUE, NOT
								     `warning`. (2026-10-08) `warning`/amber is reserved for a
								     STUCK rollout; this is "no rule here vouches for the
								     running build", the same "not covered / waiting on a rule"
								     family the pin banner above and the hero's `held` upgrade
								     line already spend — one hue for the whole family instead
								     of a second, unrelated yellow. -->
										<div class="border-held-line bg-held-tint m-4 rounded-md border p-4">
											<div class="flex items-center gap-3">
												<InfoCircleSolid class="text-held h-5 w-5 shrink-0" />
												<span class="t-heading text-held">Custom build</span>
											</div>
											<p class="t-body text-held mt-2 mb-4">
												The running build is not in this rollout's release list, so no rule here
												vouches for it.
											</p>
											<div class="flex gap-2">
												<button
													type="button"
													data-tour="change-version"
													class="btn btn-secondary btn-xs"
													onclick={() => {
														isPinVersionMode = true;
														selectedVersion = null;
														deployExplanation = '';
														requestChangeVersionModal();
													}}
												>
													<EditOutline />
													Change version
												</button>
											</div>
										</div>
									{/if}
									<!--
								⛔ THE `on the newest` EMPTY STATE — A CENTRED 32px CHECK PLUS
								`Up to date — no upgrades available` IN A 40px-PADDED
								BODY — USED TO RENDER HERE UNCONDITIONALLY IN THE FINAL
								BRANCH, AND IT WAS THE CARD'S ROLLUP RESTATED. (P9, second
								re-check, finding 14) The header 32px above already answers
								the question this body existed to answer — the `on the newest`
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
						</div>
						<!--
						⭐ THE RAIL'S FOUR CARDS RENDER IN THEIR FINAL ORDER FROM FIRST
						PAINT, EACH ITS OWN `CardSkeleton` UNTIL ITS OWN SOURCE HAS
						SETTLED. (2026-09-04, load-state audit finding 1: "The right
						rail assembles top-down... Recent events starts at y=186 (1440)
						/ 947 (390) and ends at 678 / 1663 (+492 / +716 px).") Every
						card here used to render EMPTY (an unconditional `Card` around
						a `[]`/`{}` prop, or — for External Links — not at all) the
						moment `rollout` first loaded, then grow or pop in once its own
						LATER query resolved. `managedResourcesKnown` / `healthChecksKnown`
						/ `eventsKnown` (declared beside their queries above) are each
						"has this card's own source settled, success or error" — a
						`CardSkeleton` stands in exactly where the real `Card` will sit,
						header included, until that flips.

						⚠️ EXTERNAL LINKS IS THE ONE CARD WHOSE EXISTENCE ITSELF — not
						just its content — is unknown until `managedResourcesKnown`:
						`datadogServiceInfo` is DERIVED from managed resources, not
						carried on the rollout payload, so unlike the other three there
						is no "arity-stable, always renders" version of this one to
						reach for. It reserves its slot while unknown and, once known,
						either becomes the real card or renders nothing at all — the
						SAME shape `hasEnvironment || hasDependencies` resolves to on
						the tab strip one layer up, and for the identical reason: it can
						only be answered once, not narrowed while waiting.
					-->
						<div class="flex flex-col gap-4">
							{#if !managedResourcesKnown}
								<CardSkeleton titleWidth="w-28" rows={1} rowHeight={36} />
							{:else if datadogServiceInfo}
								<div class="border-line bg-surface overflow-hidden rounded-md border">
									<!-- ⭐ `min-h-[47px]`, LIKE EVERY OTHER CARD HEADER. (NIT,
								     2026-09-03 re-check) This was a hand-rolled header with
								     no height floor — 45px, against the 47px `Card.svelte`
								     enforces everywhere else, because a header with no
								     rollup measures a line box 2px shorter than one with a
								     chip on it. Same fix `Card.svelte`'s own doc comment
								     already made the rule for. -->
									<div class="border-line flex min-h-[47px] items-center gap-2 border-b px-4 py-3">
										<ArrowUpRightFromSquareOutline class="text-fg-subtle h-4 w-4" />
										<h2 class="t-card-title text-fg">External links</h2>
									</div>
									<div class="divide-line-subtle divide-y">
										{#if datadogServiceInfo}
											<a
												href={datadogServiceInfo.url}
												target="_blank"
												rel="noopener noreferrer"
												class="hover:bg-hover flex items-center gap-3 px-4 py-3"
											>
												<!-- No ink class: the asset's fill is literal, not `currentColor` — the
											     theme picks the official asset now (see `DatadogLogo`). -->
												<DatadogLogo class="h-4 w-4 flex-shrink-0" />
												<div class="min-w-0 flex-1">
													<span class="t-body text-fg">{datadogServiceInfo.service}</span>
													<span class="t-meta text-fg-subtle ml-2">APM service</span>
												</div>
												<ArrowUpRightFromSquareOutline
													class="text-fg-subtle h-3 w-3 flex-shrink-0"
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
							{#if !healthChecksKnown}
								<CardSkeleton titleWidth="w-24" rows={2} rowHeight={28} />
							{:else}
								<HealthChecksCard
									healthChecks={visibleHealthChecks}
									windowStart={errorCutoff}
									emptyState
									loadError={healthChecksFailed}
									onRetry={() => healthChecksQuery.refetch()}
									isRetrying={healthChecksQuery.isFetching}
								/>
							{/if}
							{#if !managedResourcesKnown}
								<CardSkeleton titleWidth="w-20" rows={3} rowHeight={28} />
							{:else}
								<ResourcesCard
									{kustomizations}
									{ociRepositories}
									{filteredManagedResources}
									{cluster}
								/>
							{/if}
							{#if !eventsKnown}
								<CardSkeleton titleWidth="w-24" rows={1} rowHeight={36} />
							{:else}
								<EventsCard {events} deployedAt={errorCutoff} />
							{/if}
						</div>
					</div>
				</div>
			{:else}
				<!-- ⭐ NO DEPLOY YET — §3.15 EMPTY STATE, INSIDE THE CARD THAT WOULD HOLD
				     THE CONTENT. (design rollout, 2026-10-08) Was a centred 2xl-radius
				     shadowed island at max-w-2xl: a single-column page at 1440 with
				     its own card grammar. Now the loaded page's own main + rail split
				     (`.ov-split-cq`): the Deployment pipeline card, empty, says what
				     will fill it; the rail lists the builds waiting to be picked in
				     the Overview's "Newer builds" row grammar (mono build, time right). -->
				<!-- The same page header the loaded page draws (name, env chip,
				     Change version on the title line), so the first deploy is one
				     press away and the page keeps its shape when it lands. -->
				<PageHeader title={rollout.metadata?.name ?? ''} class="mb-6">
					{#snippet titleAfter()}<StarToggle app={rollout.metadata?.name ?? name} class="self-center" />{/snippet}
					{#snippet identity()}
						{#if rolloutTheme}
							<Chip
								role="env"
								theme={rolloutTheme}
								label={shortEnvLabel(rolloutTheme) || rolloutTheme.label}
								title={rolloutTheme.label}
								wide
							/>
						{/if}
					{/snippet}
					{#snippet meta()}
						<span class="text-fg-subtle">{namespace}</span>
					{/snippet}
					{#snippet actions()}
						{#if canModify}
							<button
								type="button"
								data-tour="change-version"
								class="btn btn-primary"
								disabled={!permissionsKnown || !isDashboardManagingWantedVersion || !!pendingAction || !!noSource}
							title={noSource ? 'No release source, so there are no versions to choose from' : undefined}
								onclick={() => {
									if (isDashboardManagingWantedVersion) {
										isPinVersionMode = false;
										selectedVersion = null;
										deployExplanation = '';
										requestChangeVersionModal();
									}
								}}
							>
								<EditOutline />
								Change version
							</button>
						{/if}
					{/snippet}
				</PageHeader>
				<div class="ov-split-cq">
					<div class="ov-split flex flex-col gap-4">
						<section class="border-line bg-surface overflow-hidden rounded-md border">
							<div class="border-line flex min-h-[47px] items-center gap-2 border-b px-4 py-3">
								<ClockOutline class="text-fg-subtle h-4 w-4" aria-hidden="true" />
								<h2 class="t-card-title text-fg">Deployment pipeline</h2>
							</div>
							<div class="flex flex-col items-start gap-1 px-4 py-6">
								<ClockOutline class="text-fg-disabled mb-1 h-5 w-5" aria-hidden="true" />
								<p class="t-ui text-fg">No deploys yet</p>
								<p class="t-meta text-fg-subtle max-w-[320px]">
									{rollout.status?.title ?? rollout.metadata?.name} hasn't received its first deploy.
									Once a version is selected and the controller deploys it, this page will fill in with
									the deployment pipeline, health checks, and history.
								</p>
							</div>
						</section>
						<section class="border-line bg-surface overflow-hidden rounded-md border">
							<div class="border-line flex min-h-[47px] items-center gap-2 border-b px-4 py-3">
								<CodeOutline class="text-fg-subtle h-4 w-4" aria-hidden="true" />
								<h2 class="t-card-title text-fg">Newer builds</h2>
								{#if (releaseCandidates(rollout)?.length ?? 0) > 0}<span
										class="t-ui-sm text-fg-subtle ml-auto tabular-nums"
										>{releaseCandidates(rollout)?.length} build{releaseCandidates(rollout)?.length === 1
											? ''
											: 's'}</span
									>{/if}
							</div>
							{#if (releaseCandidates(rollout)?.length ?? 0) > 0}
								<ul class="divide-line-subtle divide-y">
									{#each releaseCandidates(rollout)?.slice(0, 5) ?? [] as rc}
										<li class="flex items-center justify-between gap-3 px-4 py-3">
											<span class="t-code text-fg">{getDisplayVersion(rc)}</span>
											{#if rc.created}
												<span class="t-meta text-fg-subtle tabular-nums"
													>{formatTimeAgoCompact(rc.created, $now)}</span
												>
											{/if}
										</li>
									{/each}
								</ul>
							{:else}
								<div class="flex flex-col items-start gap-1 px-4 py-6">
									<CodeOutline class="text-fg-disabled mb-1 h-5 w-5" aria-hidden="true" />
									<p class="t-ui text-fg">No builds yet</p>
									<p class="t-meta text-fg-subtle max-w-[320px]">
										Builds appear here as the registry publishes them.
									</p>
								</div>
							{/if}
						</section>
					</div>
				</div>
			{/if}
			<!-- ⭐ THE TOAST'S RESERVED CLEARANCE. See the doc comment beside
			     `TOAST_DOCK_CLEARANCE` above and the one on `<Toast>` below —
			     this is the whole fix now: `TOAST_DOCK_CLEARANCE` of empty
			     space at the END of this page's own markup, which is the end
			     of `<main>`'s scrollable content (the layout's own `<main>`
			     renders nothing else). Scrolled to the bottom while a toast
			     shows, the fixed dock lands on this reserved strip, never on
			     `Health checks`, `Recent events`, or any other card — single
			     column and two column alike, since the `.ov-split` grid's
			     own height already follows its taller column. `aria-hidden`:
			     it reserves layout space, nothing a reader needs announced.
			     `transition-[height]` makes it collapse smoothly with the
			     toast's own fade instead of yanking the scroll position. -->
			<div
				aria-hidden="true"
				class="transition-[height] duration-200"
				style="height: {showToast ? TOAST_DOCK_CLEARANCE : 0}px"
			></div>
		</div>
	{/if}
</div>

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
		toastDescription = '';
		toastShowLogsAction = false;
		showToast = true;
		setTimeout(() => (showToast = false), 3000);
		rolloutQuery.refetch();
		justClearedPin = true;
		setTimeout(() => (justClearedPin = false), 8000);
	}}
	onError={(m) => {
		toastType = 'error';
		toastMessage = m;
		toastDescription = '';
		toastShowLogsAction = false;
		showToast = true;
		setTimeout(() => (showToast = false), 3000);
	}}
/>

<!-- PALROW r8: the warning (when recovery applies) and the picker, mounted
     together by the shared flow History mounts too. -->
<ChangeVersionFlow
	bind:open={showChangeVersionModal}
	{rollout}
	{cluster}
	healthChecks={flowHealthChecks}
	{autoDeploy}
	{isPinVersionMode}
	initialSelectedVersion={selectedVersion}
	initialExplanation={deployExplanation}
	environmentName={environment?.spec?.environment ?? null}
	{contractHeldVersions}
	onDeployStart={beginPendingAction}
	onSuccess={(m) => {
		toastType = 'success';
		toastMessage = m;
		toastDescription = '';
		toastShowLogsAction = false;
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
		toastDescription = '';
		toastShowLogsAction = false;
		showToast = true;
		setTimeout(() => (showToast = false), 3000);
	}}
/>

<!-- The toast's position is the shared Toast component's own house position
     (bottom-right from `sm`, top under the header on a phone — see
     `Toast.svelte`'s doc comment). This page's one addition is the
     end-of-page `TOAST_DOCK_CLEARANCE` spacer above, so the rail's last rows
     can scroll out from under a bottom-right toast at sm+. -->
<!-- ⭐ ROUND 3, ITEM 13: the retry toast's one action, "View logs" — only
     `retryDeployment` sets `toastShowLogsAction`, every other toast on this
     page resets it, so this snippet renders only on the toast it was asked
     for. -->
{#snippet toastViewLogsAction()}
	<a href={href(`/rollouts/${cluster}/${namespace}/${name}/logs`)} class="nav-link shrink-0"
		>View logs</a
	>
{/snippet}
<Toast
	bind:open={showToast}
	tone={toastLoading
		? 'loading'
		: toastType === 'success'
			? 'success'
			: toastType === 'info'
				? 'info'
				: 'danger'}
	message={toastMessage}
	description={toastDescription}
	action={toastShowLogsAction ? toastViewLogsAction : undefined}
/>

<style>
	/* r34 tabs-nb r3 (#5): below 1024 the status badge (phone-only identity) leads the meta line, so the
	   "N newer builds" fact right after it takes no separator dot (the `.contents` rule in language.css
	   dots every fact; the badge is not a fact in a list, it is the line's lead). The 20px padding stays,
	   so the glyph is never clipped when the fact wraps to a line start. */
	@media (max-width: 1023px) {
		.hdr-newer.hdr-newer.hdr-newer {
			background-image: none;
		}
	}
	/* r34 Newer builds ledger: History's spine (`lib/ledger-spine.ts` sets the vars). */
	.nb-ledger {
		position: relative;
		isolation: isolate;
	}
	.nb-ledger::before {
		content: '';
		position: absolute;
		left: var(--spine-x, 24px);
		top: var(--spine-top, 0);
		height: var(--spine-h, 0);
		width: 1px;
		background-color: var(--k-line-strong);
		z-index: 1;
		pointer-events: none;
	}
	/* TB10: the mark's 3px ring is the ROW's current background, not a hard-coded surface: a
	   disc of padding painted with the surface plus the row's hover wash on top (the hover
	   token is translucent, so a flat var() would cut the spine). */
	.nb-mark {
		position: relative;
		z-index: 2;
		display: inline-flex;
		border-radius: 9999px;
		padding: 3px;
		margin: -3px;
		background: linear-gradient(var(--nb-wash, transparent), var(--nb-wash, transparent)),
			var(--k-surface);
	}
	/* TB15 (r4): the ROW paints the very same two-layer gradient as the ring (one composite,
	   no transition), so the ring and the row are the same colour by construction. */
	@media (hover: hover) {
		.nb-ledger > li.nb-row:hover {
			--nb-wash: var(--k-hover);
			background: linear-gradient(var(--nb-wash), var(--nb-wash)), var(--k-surface);
			transition: none;
		}
	}

	/* ⭐ THE NEWER-BUILD ROW'S TRACKS (r34 tabs-nb round 3). ONE rule at every width:
	   - the author's 16px face LEADS THE TITLE (it overlays the left 22px of the title cell; the login is
	     the title attribute, never drawn: a row always has a title, not always a cause, so the face cannot
	     lead the cause line without being absent from every cause-less row; text then starts at one x);
	   - the cause sits under the title, on the title's x, and WRAPS (never truncates);
	   - Deploy: ONE slot at every width, line 1 left of the age (44px hit box drawn by ::after): the
	     newest's at rest; an older row's on hover/focus (wide: the cluster's first item starts in the same
	     track) or once opened (touch), so the cause line never shares its width with a button.
	   NARROW (< 32rem of card): line 1 = mark build [Deploy] age chevron; line 2 = title (<= 2 lines,
	   build column to the chevron, 296px at 390); line 3 = the cause, full width, wrapping if it must.
	   Padding 12/16, gaps 4/4.
	   WIDE: line 1 = mark build title(1fr) deploy-slot age chevron; line 2 = the cause. */
	.nb-row {
		display: grid;
		grid-template-columns: 16px var(--nb-build-w, 64px) minmax(0, 1fr) 36px 26px;
		column-gap: 12px;
		row-gap: 4px;
		align-items: center;
		padding: 12px 16px;
		position: relative;
		cursor: pointer;
	}
	.nb-c-mark {
		grid-column: 1;
		grid-row: 1;
	}
	.nb-build {
		white-space: nowrap;
		font-weight: 500;
		text-align: left;
		justify-self: start;
	}
	.nb-c-build {
		grid-column: 2;
		grid-row: 1;
	}
	.nb-c-age {
		grid-column: 4;
		grid-row: 1;
		justify-self: end;
		text-align: right;
	}
	/* History's chevron box: 26x26, a transparent border that resolves on hover; a 44x44 hit box is drawn
	   by ::after (the visual box does not change, the row height does not change). */
	.nb-c-chev {
		grid-column: 5;
		grid-row: 1;
		position: relative;
		margin-block: -4px;
		border: 1px solid transparent;
		cursor: pointer;
		transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
	}
	.nb-c-chev::after {
		content: '';
		position: absolute;
		inset: -10px;
	}
	@media (hover: hover) {
		.nb-row:hover .nb-c-chev {
			color: var(--k-fg);
			background: var(--k-surface);
			border-color: var(--k-line);
		}
	}
	.nb-c-chev:focus-visible {
		color: var(--k-fg);
		outline: 2px solid var(--k-accent, currentColor);
		outline-offset: 0;
	}
	/* the cause (a flex run) under the title: wraps, never truncates */
	.nb-c-cause {
		grid-column: 2 / -1;
		grid-row: 3;
		margin: 0;
	}
	.nb-row:has(:global(.nb-c-author)) .nb-c-cause {
		padding-left: 22px;
	}
	/* the cause's dot-list adds no vertical slack */
	.nb-c-cause :global(.dot-list) {
		margin: 0;
		padding: 0 4px 0 0;
	}
	.nb-c-cause:not(:has(> :not(.sr-only))) {
		display: none;
	}
	/* line 2 = the title, the build column to the chevron's, at most TWO lines (owner 2026-11-02: a
	   Newer builds row keeps its PR/commit title at 390). Overrides the `truncate` the shared
	   CommitSummary sets; the wide layout puts it back to one truncated line. */
	.nb-ledger :global(.nb-c-title) {
		grid-column: 2 / -1;
		grid-row: 2;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		white-space: normal;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.nb-row:has(:global(.nb-c-author)) :global(.nb-c-title) {
		padding-left: 22px;
	}
	/* the author's 16px face, in the title cell's left 22px (centred on the title's first line, 20px) */
	.nb-ledger :global(.nb-c-author) {
		display: flex;
		grid-column: 2;
		grid-row: 2;
		justify-self: start;
		align-self: start;
		margin-top: 2px;
		z-index: 1;
	}
	.nb-c-deploy {
		grid-column: 3;
		grid-row: 1;
		justify-self: end;
		align-self: center;
		margin-block: -6px;
		z-index: 1;
	}
	/* the Deploy's tap target: a 44px-tall hit area drawn around the 28px button (it overlaps the
	   gaps and padding, never changes the row's height) */
	.nb-row :global(.nb-deploy-btn) {
		position: relative;
	}
	.nb-row :global(.nb-deploy-btn)::after {
		content: '';
		position: absolute;
		inset: -9px -6px;
	}
	/* the opened row: the change rows, then the actions */
	.nb-c-changes {
		grid-column: 2 / -1;
		grid-row: 4;
		margin-top: 4px;
		min-width: 0;
	}
	.nb-actions {
		display: none;
		grid-column: 2 / -1;
		grid-row: 5;
		margin-top: 4px;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.nb-row[data-open] .nb-actions {
		display: flex;
	}
	.nb-act-icons {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.nb-row:not([data-open]) .nb-act-icons :global(.btn) {
		width: 28px;
		height: 28px;
		min-height: 28px;
		padding: 0;
	}
	@container (min-width: 32rem) {
		.nb-row {
			grid-template-columns:
				16px var(--nb-build-w, 64px) minmax(0, 1fr) var(--nb-dep-w, 62px) 60px
				26px;
		}
		.nb-ledger[data-anyway] .nb-row {
			--nb-dep-w: 116px;
		}
		.nb-ledger :global(.nb-c-author) {
			grid-column: 3;
			grid-row: 1;
			align-self: center;
			margin-top: 0;
		}
		.nb-ledger :global(.nb-c-title) {
			grid-column: 3;
			grid-row: 1;
			display: block;
			white-space: nowrap;
			text-overflow: ellipsis;
		}
		.nb-c-age {
			grid-column: 5;
		}
		.nb-c-chev {
			grid-column: 6;
		}
		.nb-c-cause {
			grid-column: 3 / -1;
			grid-row: 2;
		}
		/* wide: the Deploy slot is its own track, left of the age */
		.nb-c-deploy {
			grid-column: 4;
			grid-row: 1;
			justify-self: start;
		}
		.nb-c-changes {
			grid-column: 3 / -1;
			grid-row: 3;
		}
		/* Hover/focus actions REPLACE the age (TABS §4.13), in the same grid: an older row's cluster
		   starts in the Deploy track (its Deploy is the first item, so it lands where the newest's rests)
		   and runs over the age; the newest's cluster is just the icons over the age. Never at rest;
		   hover-capable pointers only. */
		.nb-actions {
			display: flex;
			grid-row: 1;
			grid-column: 4 / 6;
			justify-self: start;
			align-self: center;
			margin: -6px 0;
			gap: 4px;
			opacity: 0;
			pointer-events: none;
			z-index: 3;
			transition: opacity 120ms ease;
		}
		.nb-row-newest .nb-actions {
			grid-column: 5;
			justify-self: end;
		}
		.nb-act-icons {
			gap: 4px;
			flex-wrap: nowrap;
		}
		.nb-actions :global(.nb-c-deploy-act) {
			order: -1;
			margin-right: 4px;
		}
		.nb-row[data-open] .nb-actions {
			grid-column: 3 / -1;
			grid-row: 4;
			justify-self: stretch;
			margin-top: 4px;
			opacity: 1;
			pointer-events: auto;
		}
	}
	@media (hover: hover) {
		@container (min-width: 32rem) {
			.nb-row:not([data-open]):hover .nb-actions,
			.nb-row:not([data-open]):focus-within .nb-actions {
				opacity: 1;
				pointer-events: auto;
			}
			.nb-row:not([data-open]):hover :global(.nb-rest),
			.nb-row:not([data-open]):focus-within :global(.nb-rest) {
				opacity: 0;
			}
			.nb-row :global(.nb-rest) {
				transition: opacity 120ms ease;
			}
		}
	}
	@media (hover: none) {
		@container (min-width: 32rem) {
			.nb-row:not([data-open]) .nb-actions {
				display: none;
			}
		}
	}

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
