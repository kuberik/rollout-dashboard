<svelte:options runes={true} />

<script lang="ts">
	import Leaving from './Leaving.svelte';
	import StepDisc from './StepDisc.svelte';
	import { formatShortDuration } from '$lib/view-models/stage-advance';
	import StatusSpinner from './StatusSpinner.svelte';
	import { TONE } from '$lib/view-models/state-tone';
	import { smoothHeight } from '$lib/smooth-height';
	import { steadyHeight } from '$lib/steady-height';
	import { deployKey, isDeployInFlight, pipelineSlots } from '$lib/view-models/pipeline-card';
	import { canHover } from '$lib/can-hover.svelte';
	import { formatTimestamp } from '$lib/display-time';
	import { Modal, Spinner, Tooltip } from 'flowbite-svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		ClockArrowOutline,
		CodePullRequestSolid,
		PlaySolid,
		QuestionCircleOutline,
		UserSolid,
		CogSolid,
		ArrowUpRightFromSquareOutline,
		CircleMinusSolid,
		ArrowsRepeatOutline,
		RefreshOutline,
		TerminalOutline,
		ClipboardCheckOutline,
		ChartMixedOutline,
		LinkOutline
	} from 'flowbite-svelte-icons';
	import {
		formatTimeAgo,
		formatTimeAgoCompact,
		getDisplayVersion,
		mergeTestLinks,
		extractDatadogInfoFromContainers,
		formatDate } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { HEALTH_CHECKS_UNAVAILABLE } from '$lib/view-models/health-witness';
	import { stageAdvance, type StageAdvance } from '$lib/view-models/stage-advance';
	import { stageWeight, stageSplitText, type StageWeight } from '$lib/view-models/stage-weight';
	import { href } from '$lib/paths';
	import type { Rollout, RolloutTest, HealthCheck, KruiseRollout } from '../../types';

	/**
	 * ⭐ THE TEST ROW'S ONE ICON LANGUAGE. (2026-09-13, site review.)
	 *
	 * The row used to print two: plain blue text for a team's own
	 * `link.*` annotations and a violet link carrying the Datadog brand mark
	 * for every derived one — the mark being a COLOUR asset (`#632CA6`, or
	 * white on dark) which `DatadogLogo`'s own trademark note forbids
	 * recolouring, so it can never join a monochrome row. It is gone from
	 * this row; the destination is named in the link's accessible name and
	 * tooltip instead, which is what a reader actually needs to know.
	 *
	 * The marks are the product's own: `TerminalOutline` is the mark the
	 * rollout's OWN Logs tab uses (`+layout.svelte`), so `Logs` here and
	 * `Logs` in the tab strip are one word with one glyph. `kind` comes from
	 * `mergeTestLinks`, i.e. from the label, so a hand-written `Logs` and a
	 * derived one are marked identically.
	 */
	const TEST_LINK_MARK = {
		logs: TerminalOutline,
		ci: ClipboardCheckOutline,
		trace: ChartMixedOutline,
		other: LinkOutline
	} as const;

	type ValidKruiseRollout = {
		rolloutResource: any;
		kruiseRollout: KruiseRollout;
		rolloutData: any;
		canarySteps: any[];
		isCompleted: boolean;
	};

	interface Props {
		rollout: Rollout;
		latestEntry: any;
		pipelineValidRollouts: ValidKruiseRollout[];
		pipelineValidTests: RolloutTest[];
		healthChecks: HealthCheck[];
		/** The health-checks load failed: the checks are unknown, never Healthy. */
		healthChecksUnavailable?: boolean;
		/** The health-checks list has not arrived yet: `[]` here is "not known", not "none". */
		healthChecksPending?: boolean;
		canUpdate: boolean;
		namespace: string;
		name: string;
		cluster?: string;
		onContinue: (kruiseRolloutName: string, kruiseRolloutNamespace: string) => void;
	}

	let {
		rollout,
		latestEntry,
		pipelineValidRollouts,
		pipelineValidTests,
		healthChecks,
		healthChecksUnavailable = false,
		healthChecksPending = false,
		canUpdate,
		namespace,
		name,
		cluster,
		onContinue
	}: Props = $props();

	function parseDuration(duration: string): number {
		const match = duration.match(/^(\d+)([smhd])$/);
		if (!match) return 0;
		const value = parseInt(match[1]);
		const unit = match[2];
		switch (unit) {
			case 's': return value * 1000;
			case 'm': return value * 60 * 1000;
			case 'h': return value * 60 * 60 * 1000;
			case 'd': return value * 24 * 60 * 60 * 1000;
			default: return 0;
		}
	}

	type NodeStatus = 'done' | 'running' | 'paused' | 'failed' | 'pending';

	type StageNode = {
		id: string;
		kind: 'started' | 'stage' | 'bake';
		shortLabel: string;
		longLabel: string;
		/** Canary traffic share of a stage (`stageWeight`); undefined for non-canary steps and replica-only steps. */
		weight?: StageWeight;
		status: NodeStatus;
		statusLabel: string;
		krName?: string;
		krIndex?: number;
		stepIndex?: number;
		isActive: boolean;
		firstInGroup: boolean;
		lastInGroup: boolean;
		// If set, render a KR group header before this node. `index` / `total`
		// indicate this group's position among all parallel tracks.
		groupHeader?: { name: string; index: number; total: number };
		stageData?: {
			kr: ValidKruiseRollout;
			stepNum: number;
			isCurrentStep: boolean;
			isPastStep: boolean;
			isStepPaused: boolean;
			isStepReady: boolean;
			rolloutDone: boolean;
			rolloutRunning: boolean;
			rolloutFailed: boolean;
			bakeDone: boolean;
			bakingNow: boolean;
			stepTests: RolloutTest[];
			hasTests: boolean;
			allTestsSucceeded: boolean;
			stageTestsFailed: boolean;
			bakeFailed: boolean;
			waitingForBake: boolean;
			isLastStep: boolean;
			stageAllDone: boolean;
		};
	};

	let allStagesDone = $derived(
		pipelineValidRollouts.length === 0 || pipelineValidRollouts.every((kr) => kr.isCompleted)
	);
	let bakeIsDeploying = $derived(allStagesDone && latestEntry.bakeStatus === 'Deploying');
	// The tone of whatever is in flight: steps still rolling or a deploy going
	// out is `active` (blue); a finished rollout being checked is `progress`.
	// The same notion `steadyHeight` holds the card for: rows below only keep their slots while it is true.
	let deployInFlight = $derived(!allStagesDone || isDeployInFlight([latestEntry]));
	let inflightIsDeploy = $derived(!allStagesDone || latestEntry.bakeStatus === 'Deploying');
	let bakeIsInProgress = $derived(allStagesDone && latestEntry.bakeStatus === 'InProgress');
	let bakeIsSucceeded = $derived(allStagesDone && latestEntry.bakeStatus === 'Succeeded');
	let bakeIsFailed = $derived(allStagesDone && latestEntry.bakeStatus === 'Failed');
	let recordedFailedCheckNames = $derived<string[]>(
		((latestEntry?.failedHealthChecks ?? []) as Array<{ name?: string }>)
			.map((c) => c?.name ?? '')
			.filter(Boolean)
	);
	let hasHCSelector = $derived(Boolean(rollout.spec?.healthCheckSelector));
	let allHCHealthy = $derived(
		healthChecks.length === 0 || healthChecks.every((hc) => hc.status?.status === 'Healthy')
	);
	// The timer reads Failed ("the bake timed out") only when the checks are KNOWN
	// healthy. On an unreadable list: the history's own snapshot of failing
	// checks stands in (so it reads as when the list is known), else unknown. A list still
	// LOADING is unknown in the same way.
	let hcUnknown = $derived(healthChecksUnavailable || healthChecksPending);
	let timerHCHealthy = $derived<boolean | null>(
		hcUnknown ? (recordedFailedCheckNames.length > 0 ? false : null) : allHCHealthy
	);
	let hasMultipleKRs = $derived(pipelineValidRollouts.length > 1);

	let nodes = $derived<StageNode[]>(
		(() => {
			const result: StageNode[] = [];

			result.push({
				id: 'started',
				kind: 'started',
				shortLabel: 'Started',
				longLabel: 'Deployment started',
				status: 'done',
				statusLabel: 'Triggered',
				isActive: false,
				firstInGroup: true,
				lastInGroup: true
			});

			for (const [krIdx, kr] of pipelineValidRollouts.entries()) {
				const krName = kr.kruiseRollout?.metadata?.name;
				for (const [stepIdx] of kr.canarySteps.entries()) {
					const stepNum = stepIdx + 1;
					const currentStepIndex = kr.rolloutData.currentStepIndex;
					const isKrCompleted = kr.isCompleted;
					const isKrStalled =
						kr.kruiseRollout?.status?.conditions?.some(
							(c) => c.type === 'Stalled' && c.status === 'True'
						) ?? false;
					// KuberikBakeHealthy=False is set by the stepgate when the kuberik Rollout's
					// bake period has failed. Unlike Stalled, it does not trigger kstatus retry
					// machinery — it is observability-only, so we check it explicitly here.
					const isKrBakeFailed =
						kr.kruiseRollout?.status?.conditions?.some(
							(c) => c.type === 'KuberikBakeHealthy' && c.status === 'False'
						) ?? false;
					const isCurrentStep = currentStepIndex === stepNum;
					const isPastStep =
						isKrCompleted || (currentStepIndex !== undefined && stepNum < currentStepIndex);
					const isStepPaused =
						isCurrentStep && kr.rolloutData.currentStepState === 'StepPaused';
					const isStepReady =
						isCurrentStep && kr.rolloutData.currentStepState === 'StepReady';
					const isStepRunning =
						isCurrentStep &&
						!isStepPaused &&
						!isStepReady &&
						kr.rolloutData.currentStepState !== 'Completed' &&
						!isKrStalled;
					const rolloutDone = isPastStep || (isCurrentStep && (isStepPaused || isStepReady));
					const rolloutRunning = isStepRunning;
					const rolloutFailed = isKrStalled && isCurrentStep && !isStepPaused;
					const bakeDone = isPastStep;
					const stepTests = pipelineValidTests.filter(
						(t) =>
							krName && t.spec?.rolloutName === krName && t.spec?.stepIndex === stepNum
					);
					const hasTests = stepTests.length > 0;
					const allTestsSucceeded =
						!hasTests ||
						stepTests.every((t) => ['Succeeded', 'Skipped'].includes(t.status?.phase ?? ''));
					const bakingNow =
						isCurrentStep && isStepPaused && allTestsSucceeded && !isKrStalled && !isKrBakeFailed;
					const stageTestsFailed =
						isCurrentStep && stepTests.some((t) => t.status?.phase === 'Failed');
					const bakeFailed =
						(isKrStalled || isKrBakeFailed) && isCurrentStep && isStepPaused && !stageTestsFailed;
					const waitingForBake = isCurrentStep && isStepReady;
					const isLastStep = stepIdx === kr.canarySteps.length - 1;
					const stageAllDone =
						rolloutDone && allTestsSucceeded && !bakingNow && !waitingForBake && !bakeFailed;

					let status: NodeStatus;
					let statusLabel: string;
					if (rolloutFailed || stageTestsFailed || bakeFailed) {
						status = 'failed';
						statusLabel = 'Failed';
					} else if (isPastStep) {
						status = 'done';
						statusLabel = 'Done';
					} else if (isCurrentStep && bakingNow) {
						status = 'paused';
						statusLabel = 'Checking';
					} else if (isCurrentStep && waitingForBake) {
						status = 'paused';
						statusLabel = 'Waiting';
					} else if (isCurrentStep && stageAllDone) {
						status = 'done';
						statusLabel = 'Done';
					} else if (isCurrentStep) {
						status = 'running';
						statusLabel = 'In Progress';
					} else {
						status = 'pending';
						statusLabel = 'Pending';
					}

					const weight = stageWeight(kr.canarySteps[stepIdx]);
					const isFirstInKr = stepIdx === 0;
					const isLastInKr = stepIdx === kr.canarySteps.length - 1;

					result.push({
						id: `stage-${krIdx}-${stepIdx}`,
						kind: 'stage',
						shortLabel: `Stage ${stepNum}`,
						longLabel: `Stage ${stepNum}`,
						weight: weight ?? undefined,
						status,
						statusLabel,
						krName,
						krIndex: krIdx,
						stepIndex: stepIdx,
						isActive: isCurrentStep && !isPastStep,
						// For multi-KR, each KR group is self-contained; otherwise all stages are one group
						firstInGroup: hasMultipleKRs ? isFirstInKr : false,
						lastInGroup: hasMultipleKRs ? isLastInKr : false,
						groupHeader:
						hasMultipleKRs && isFirstInKr && krName
							? { name: krName, index: krIdx + 1, total: pipelineValidRollouts.length }
							: undefined,
						stageData: {
							kr,
							stepNum,
							isCurrentStep,
							isPastStep,
							isStepPaused,
							isStepReady,
							rolloutDone,
							rolloutRunning,
							rolloutFailed,
							bakeDone,
							bakingNow,
							stepTests,
							hasTests,
							allTestsSucceeded,
							stageTestsFailed,
							bakeFailed,
							waitingForBake,
							isLastStep,
							stageAllDone
						}
					});
				}
			}

			/**
			 * ⛔ THE STEP NAME IS NO LONGER AN EXCEPTION. (Reversed 2026-08-31.)
			 *
			 * `bake-status.ts` renamed the STATE to `checking` and explicitly
			 * spared the pipeline's step names — `Bake`, `Final Bake`, `Baked` —
			 * as proper nouns for the step. That ruling assumed the step name
			 * sits alone. On rollout detail it does not: a live critic watched
			 * one deploy print `Baking` in this chip, `InProgress` on the version
			 * card and `checking` on `/`, for the same rollout at the same
			 * second — Bake x7, Baking x3, bake x2, checking x1 on ONE page.
			 *
			 * A proper noun that shares its stem with the deprecated state word
			 * cannot be told apart from the state word by a reader who has never
			 * seen this product, which is the whole test the rename was made to
			 * pass. So the step goes with it: `Check` / `Final check` / `Checked`.
			 * The CRD field names (`spec.bakeTime`, `status.bakeStatus`) are
			 * untouched — they are the mechanism, and no reader sees them.
			 */
			let bakeStatus: NodeStatus;
			let bakeStatusLabel: string;
			if (bakeIsSucceeded) {
				bakeStatus = 'done';
				bakeStatusLabel = 'Done';
			} else if (bakeIsFailed) {
				bakeStatus = 'failed';
				bakeStatusLabel = 'Failed';
			} else if (bakeIsInProgress) {
				bakeStatus = 'paused';
				bakeStatusLabel = 'Checking';
			} else if (bakeIsDeploying) {
				bakeStatus = 'running';
				bakeStatusLabel = 'Deploying';
			} else {
				bakeStatus = 'pending';
				bakeStatusLabel = 'Pending';
			}

			result.push({
				id: 'bake',
				kind: 'bake',
				shortLabel: 'Check',
				longLabel: bakeIsSucceeded ? 'Checked' : 'Final check',
				status: bakeStatus,
				statusLabel: bakeStatusLabel,
				isActive: bakeIsDeploying || bakeIsInProgress,
				firstInGroup: true,
				lastInGroup: true
			});

			return result;
		})()
	);

	// All nodes that are actively doing something right now. When multiple
	// KruiseRollout tracks progress in parallel, there can be more than one.
	let activeNodes = $derived(
		nodes.filter(
			(n) => n.status === 'running' || n.status === 'paused' || n.status === 'failed'
		)
	);

	// Default auto-selection: every active node if any exist, otherwise the last
	// node in the pipeline (typically Bake once the whole rollout is done).
	// A2: while the deploy is still going out and no step has started yet (the new rollout has not begun), the selected step is the NEXT one
	// (first pending stage), never "Final check — the new version is already live", which is false for a deploying build.
	let nextPendingId = $derived(
		latestEntry.bakeStatus === 'Deploying'
			? (nodes.find((n) => n.status === 'pending' && n.kind !== 'bake')?.id ?? null)
			: null
	);
	let autoSelectedIds = $derived(
		activeNodes.length > 0
			? activeNodes.map((n) => n.id)
			: nextPendingId
				? [nextPendingId]
				: nodes.length > 0
				? [nodes[nodes.length - 1].id]
				: []
	);

	let userSelectedId = $state<string | null>(null);

	// Clear any sticky user selection when a new deployment starts — so that
	// the moment a rollout kicks off we jump back to the active stage rather
	// than stranding the viewer on whatever step they were inspecting.
	let latestEntryKey = $derived(
		latestEntry?.timestamp ?? latestEntry?.version?.tag ?? latestEntry?.version?.revision ?? ''
	);
	$effect(() => {
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		latestEntryKey;
		userSelectedId = null;
	});

	let selectedIds = $derived(userSelectedId !== null ? [userSelectedId] : autoSelectedIds);
	let selectedNodes = $derived(
		selectedIds
			.map((id) => nodes.find((n) => n.id === id))
			.filter((n): n is StageNode => n !== undefined)
	);
	let isAutoSelected = $derived(userSelectedId === null);

	// Label + decoration for the "jump back to default selection" button.
	let jumpButton = $derived.by(() => {
		if (activeNodes.length > 0) {
			return { label: 'Jump to active stage', active: true };
		}
		const fallbackId = autoSelectedIds[0];
		const fallback = fallbackId ? nodes.find((n) => n.id === fallbackId) : null;
		if (fallback) {
			return { label: `Jump to ${fallback.shortLabel.toLowerCase()}`, active: false };
		}
		return { label: 'Reset view', active: false };
	});

	function select(id: string) {
		userSelectedId = id;
	}

	function jumpToActive() {
		userSelectedId = null;
	}

	/**
	 * ⛔ ITEM 9 (integration round 3, Gates design review). `running` used to
	 * fold BOTH the literal `running` status (blue, `Deploying`) AND `paused`
	 * (yellow, `checking` in `bake-status.ts`'s own vocabulary — a canary
	 * mid-bake) into one bucket, and the header always painted that bucket
	 * blue — so a pipeline where every active step was `paused` (checking)
	 * still showed a blue "in progress" rollup, disagreeing with every one
	 * of its own step chips (`pillClasses`' `paused` branch, yellow). The
	 * header now reads `checking` separately, and the tone it picks follows
	 * which status is actually active — matching the step's own chip colour,
	 * never defaulting to blue.
	 */
	let summary = $derived(
		(() => {
			const failed = nodes.filter((n) => n.status === 'failed').length;
			const done = nodes.filter((n) => n.status === 'done').length;
			const running = nodes.filter((n) => n.status === 'running').length;
			const checking = nodes.filter((n) => n.status === 'paused').length;
			return { failed, done, running, checking, active: running + checking, total: nodes.length };
		})()
	);

	// Styling helpers
	/** a node's status as the one state-tone key (the disc, the ping and the sub-dot all read the table) */
	const nodeTone = (status: NodeStatus) => (({ done: 'done', running: 'deploying', paused: 'checking', failed: 'failed', pending: 'notreached' }) as const)[status];

	/**
	 * ⛔ THE STEP LABEL IS THE CHIP ATOM. (2026-09-03, from the human: "typography
	 * on these badges looks weird.") The type census had moved these pills to
	 * `t-label` — Montserrat 10/600 at 0.16em tracking — inside a rounded-full
	 * ring, which is the eyebrow role wearing a badge's clothes. A state word in
	 * a box is what `.chip` is for: mono 10/600 uppercase at 0.08em, 20px, 4px
	 * radius, 1px border. Only ink changes per state; the border stays neutral
	 * and nothing fills — the alarm chip is the only fill in the product.
	 */
	function pillClasses(status: NodeStatus): string {
		return {
			done: 'border-success-line text-success',
			running: 'border-active-line text-active',
			paused: 'border-progress-line text-progress',
			failed: 'border-danger-line text-danger',
			pending: 'border-line text-fg-subtle'
		}[status];
	}

	/** the sub-dot / ping fill: the status's solid (a pending node pings in the active blue, as before) */
	function subDotBg(status: NodeStatus): string {
		return TONE[status === 'pending' ? 'deploying' : nodeTone(status)].bg;
	}

	function leftEdgeAccent(status: NodeStatus, selected: boolean): string {
		if (!selected) return 'bg-transparent';
		return subDotBg(status);
	}

	function rolloutSubStatus(sd: NonNullable<StageNode['stageData']>): {
		status: NodeStatus;
		label: string;
	} {
		if (sd.rolloutFailed || sd.stageTestsFailed) return { status: 'failed', label: 'Failed' };
		if (sd.rolloutDone) return { status: 'done', label: 'Done' };
		if (sd.rolloutRunning) return { status: 'running', label: 'Rolling' };
		return { status: 'pending', label: 'Pending' };
	}

	function testsSubStatus(sd: NonNullable<StageNode['stageData']>): {
		status: NodeStatus;
		label: string;
	} {
		if (!sd.hasTests) return { status: 'pending', label: 'None' };
		const anyFailed = sd.stepTests.some((t) => t.status?.phase === 'Failed');
		const anyRunning = sd.stepTests.some((t) => t.status?.phase === 'Running');
		const anyPending = sd.stepTests.some((t) =>
			['Pending', 'Unknown'].includes(t.status?.phase || '')
		);
		const done = sd.isPastStep || (sd.isCurrentStep && sd.isStepPaused && sd.allTestsSucceeded);
		if (anyFailed) return { status: 'failed', label: 'Failed' };
		if (done) return { status: 'done', label: 'Passed' };
		if (anyRunning) return { status: 'running', label: 'Running' };
		if (anyPending) return { status: 'pending', label: 'Pending' };
		return { status: 'pending', label: 'Pending' };
	}

	function stageBakeSubStatus(sd: NonNullable<StageNode['stageData']>): {
		status: NodeStatus;
		label: string;
	} {
		if (sd.bakeFailed) return { status: 'failed', label: 'Failed' };
		if (sd.bakeDone) return { status: 'done', label: 'Done' };
		if (sd.bakingNow) return { status: 'paused', label: 'Checking' };
		if (sd.waitingForBake) return { status: 'pending', label: 'Waiting' };
		return { status: 'pending', label: 'Pending' };
	}

	let finalHCStatus = $derived<{ status: NodeStatus; label: string }>(
		(() => {
			// The recorded failure wins over an unreadable LIVE list: "Unavailable"
			// describes only the current load, never the history's verdict.
			if (bakeIsFailed && hcUnknown) return { status: 'failed', label: 'Failed' };
			if (healthChecksUnavailable)
				return { status: 'pending', label: HEALTH_CHECKS_UNAVAILABLE.label };
			// A list that has not arrived is `[]` only by default: never Healthy.
			if (healthChecksPending) return { status: 'pending', label: 'Pending' };
			if (bakeIsFailed && !allHCHealthy) return { status: 'failed', label: 'Failed' };
			// Once any bake activity has started, report checks as healthy as soon
			// as they actually are — don't keep showing "Waiting" just because the
			// bake hasn't transitioned to InProgress yet.
			if (
				allHCHealthy &&
				(bakeIsDeploying || bakeIsInProgress || bakeIsSucceeded || bakeIsFailed)
			)
				return { status: 'done', label: 'Healthy' };
			if (bakeIsDeploying && !allHCHealthy) return { status: 'running', label: 'Waiting' };
			return { status: 'pending', label: 'Pending' };
		})()
	);

	// ⛔ U-19 — `Checking`, NOT `In progress`. (2026-10-08.) This was the fifth
	// spelling of "this is checking right now" on the card (`Checking` on the
	// stage/bake node itself, `CHECKING` on its chip, `In progress` here) —
	// the exact class the step-name rename (see the comment above `nodes`)
	// closed for the step NAME, still open for the STATE word. One state, one
	// word, same as every other `NodeStatus` label on this card.
	let finalBakeTimerStatus = $derived<{ status: NodeStatus; label: string }>(
		(() => {
			if (bakeIsFailed && timerHCHealthy === true) return { status: 'failed', label: 'Failed' };
			if (bakeIsSucceeded) return { status: 'done', label: 'Done' };
			if (bakeIsInProgress) return { status: 'paused', label: 'Checking' };
			return { status: 'pending', label: 'Pending' };
		})()
	);

	function testIconColor(phase: string): string {
		if (phase === 'Succeeded') return 'text-success';
		if (phase === 'Failed') return 'text-danger';
		if (phase === 'Cancelled') return 'text-fg-subtle';
		if (phase === 'Skipped') return 'text-fg-subtle';
		if (phase === 'Pending') return 'text-progress';
		return 'text-fg-subtle';
	}

	/**
	 * ⭐ THE SAME TINT RECIPE AS THE BANNERS, AT THE ROW'S OWN STRENGTH.
	 * (2026-09-20.) These were `dark:bg-red-950/20` / `dark:bg-blue-950/15`,
	 * which composite BELOW the card they sit on — a failed stage drawn darker
	 * than the stages that are fine, the banner's own upside-down defect one
	 * object down. `app.css`'s `.alert-fill-*-quiet`/`-active` carry the
	 * mirrored version; light is byte-identical (the class's light half is the
	 * same `/40` and `/30` composite these strings already produced).
	 *
	 * ⛔ The ACTIVE node is in this commit too, though only the failed one was
	 * asked for: they are two branches of one function, and fixing one would
	 * have left a running stage and a failed stage at the same value — the
	 * distinction this function exists to draw.
	 */
	function nodeAccentRow(node: StageNode): string {
		if (node.status === 'failed') return 'alert-fill-error-quiet';
		if (node.isActive) return 'alert-fill-active';
		return '';
	}

	function shouldShowLineAbove(node: StageNode, idx: number): boolean {
		if (idx === 0) return false;
		if (hasMultipleKRs) {
			// In parallel-tracks mode, bookends (Started, Bake) are isolated
			if (node.kind === 'started' || node.kind === 'bake') return false;
			// First stage of a KR group starts its own track
			if (node.kind === 'stage' && node.firstInGroup) return false;
		}
		return true;
	}

	function shouldShowLineBelow(node: StageNode, idx: number): boolean {
		if (idx === nodes.length - 1) return false;
		if (hasMultipleKRs) {
			if (node.kind === 'started' || node.kind === 'bake') return false;
			if (node.kind === 'stage' && node.lastInGroup) return false;
		}
		return true;
	}
	/**
	 * The stage the reader has asked to advance, held until they confirm. `null`
	 * closes the dialog. Holding the DERIVED `adv` rather than re-deriving it in
	 * the dialog means the sentence they confirm is character-for-character the
	 * sentence they read on the button's caption.
	 */
	let pendingAdvance = $state<{ adv: StageAdvance; sd: any } | null>(null);
	let advanceModalOpen = $state(false);

	function askAdvance(adv: StageAdvance, sd: any) {
		pendingAdvance = { adv, sd };
		advanceModalOpen = true;
	}

	function cancelAdvance() {
		advanceModalOpen = false;
		pendingAdvance = null;
	}

	function confirmAdvance() {
		const p = pendingAdvance;
		advanceModalOpen = false;
		pendingAdvance = null;
		if (p) onContinue(p.sd.kr.rolloutResource.name, p.sd.kr.rolloutResource.namespace);
	}
</script>

<!-- ━━━━━━━━━━━━━━━━━━━━━━ snippets ━━━━━━━━━━━━━━━━━━━━━━ -->

<!--
	⛔ U-19 — ONE CHIP PER ROW. (2026-10-08.) `navRow` (and its mobile twin
	below) used to print a SECOND chip, "Active", beside the status chip
	whenever `node.isActive` — so the active bake step read `Check` ·
	`ACTIVE` · `CHECKING`, three objects for one fact. The pulsing ring
	already drawn on the circle (`node.isActive && status !== 'failed'`,
	just below) is the product's one "this is live right now" mark; the
	chip's own job is the STATE WORD, and that word (`Checking`) already
	says it is in progress. Deleted rather than merged into the status
	chip — a chip that said both would be two facts in one box, the other
	defect this rule exists to prevent.
-->
{#snippet navRow(node: StageNode, showLineAbove: boolean, showLineBelow: boolean)}
	{@const isSelected = selectedIds.includes(node.id)}
	<li class="relative">
		<!-- Vertical connector line (behind circle) -->
		{#if showLineAbove}
			<div
				aria-hidden="true"
				class="absolute left-[29px] top-0 h-2 w-0.5 bg-line-strong"
			></div>
		{/if}
		{#if showLineBelow}
			<div
				aria-hidden="true"
				class="absolute left-[29px] top-9 bottom-0 w-0.5 bg-line-strong"
			></div>
		{/if}

		<button
			type="button"
			onclick={() => select(node.id)}
			aria-current={isSelected ? 'step' : undefined}
			class="group relative flex w-full items-center gap-3 py-2 pl-4 pr-3 text-left transition-colors hover:bg-hover {isSelected
				? 'bg-selected'
				: nodeAccentRow(node)}"
		>
			<!-- Left accent bar when selected -->
			<span
				aria-hidden="true"
				class="absolute inset-y-0 left-0 w-0.5 {leftEdgeAccent(node.status, isSelected)}"
			></span>

			<!-- Circle -->
			<!-- `isolate`: the disc's z-10 only has to beat its own ping ring and
			     connector; without a stacking context here it also beat the sticky
			     tab strip (z-10 too) and rode over it while scrolling (2026-09-04). -->
			<div class="relative isolate flex-shrink-0">
				{#if node.isActive && node.status === 'running'}
					<span
						aria-hidden="true"
						class="absolute inset-0 animate-ping rounded-full opacity-40 {subDotBg(node.status)}"
					></span>
				{/if}
				<StepDisc state={nodeTone(node.status)} class="relative z-10 h-7 w-7" />
			</div>

			<!-- Label -->
				<div class="flex min-w-0 flex-1 items-center justify-between gap-2">
					<div class="flex min-w-0 items-center gap-1.5">
						<span
							class="truncate {node.status === 'failed'
								? 't-card-title text-danger'
								: isSelected
									? 't-card-title text-fg'
									: 't-body text-fg-muted'}"
						>
							{node.shortLabel}{#if node.weight}{" "}<span class="t-meta text-fg-subtle">· {node.weight.label}</span>{/if}
						</span>
					</div>
					<!-- ⭐ THE CHIP BUDGET, ROUND 2 (2026-10-08, coordinator
					     review): "one fact, once" — a FAILED row's circle is
					     already red and its name is now red too, so a `FAILED`
					     chip repeated beside them was a third mark for one
					     fact. Only a stage that is still LIVE (running/paused)
					     or at its starting point keeps a chip; done and failed
					     are both legible from glyph + ink alone. -->
					{#if node.status !== 'done' && node.status !== 'failed'}
						<span
							class="chip t-label chip-wide flex-shrink-0 {pillClasses(
								node.status
							)}"
						>
							{node.statusLabel}
						</span>
					{/if}
				</div>
			</button>
	</li>
{/snippet}

{#snippet progressLine(live: boolean, pct: number, text: string)}
	<!-- ⭐ A SLOT, NOT AN ARRIVAL. While a deploy is in flight this line is laid out from the first frame and
	     simply drawn invisible until its bar has something to measure (`pipelineSlots`), so the rows below it
	     do not drop a line when the check window opens. `bar-progress-active`: see app.css — the width is a
	     true, $now-derived percentage; the stripe is the mark that this is still a live process. -->
	<div class="mt-2 pl-5" class:invisible={!live} aria-hidden={!live}>
		<div class="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-line">
			<div
				class="h-full rounded-full bg-progress-solid transition-[width] duration-500 bar-progress-active"
				style="width: {pct}%"
			></div>
		</div>
		<p class="t-meta mt-1 text-fg-subtle">{text}</p>
	</div>
{/snippet}

{#snippet subRow(
	title: string,
	status: NodeStatus,
	label: string,
	extra: 'tests' | 'bake' | 'hc' | 'timer' | null,
	sd: NonNullable<StageNode['stageData']> | null
)}
	<div class="px-4 py-3">
		<div class="flex items-center gap-3">
			<span
				aria-hidden="true"
				class="h-3 w-3 flex-shrink-0 rounded-full {subDotBg(status)} {status === 'running'
					? 'animate-pulse'
					: ''}"
			></span>
			<span class="t-card-title flex min-w-0 flex-1 items-center gap-1.5 text-fg">
				<span class="truncate">{title}</span>
				{#if extra === 'tests' && sd?.hasTests}
					<span
						class="t-ui-sm inline-flex h-4 min-w-[1.125rem] flex-shrink-0 items-center justify-center rounded-full bg-selected px-1 leading-none text-fg-muted tabular-nums"
					>
						{sd.stepTests.length}
					</span>
				{/if}
			</span>
			<!-- ⭐ ONE FACT, ONCE, ROUND 2 (2026-10-08): a failed sub-row's dot
			     and title are already red; a `FAILED` chip beside them was a
			     third mark. Every other state keeps its chip. -->
			{#if status === 'pending'}
				<!-- Sub-rows: the detail header above already carries the stage's
				     one chip; a running or done sub-row is its glyph + ink only,
				     so CHECKING is said once, not three times. -->
				<span
					class="chip t-label chip-wide flex-shrink-0 {pillClasses(
						status
					)}"
				>
					{label}
				</span>
			{:else}
				<span class="t-meta flex-shrink-0 text-fg-subtle">{label}</span>
			{/if}
		</div>

		{#if extra === 'hc' && status === 'failed' && recordedFailedCheckNames.length > 0}
			<!-- The history's own snapshot names what failed, so it survives an unreadable live list. -->
			<p class="t-meta mt-1 pl-5 text-fg-subtle">{recordedFailedCheckNames.join(', ')}</p>
		{/if}

		{#if extra === 'tests' && sd}
			{#if sd.hasTests}
				<ul class="mt-2 space-y-1.5 pl-5">
					{#each sd.stepTests as test}
						{#if test.metadata}
							{@const phase = test.status?.phase || 'Unknown'}
							{@const retryCount = test.status?.retryCount || 0}
							{@const testLinks = mergeTestLinks(
								test.metadata.annotations,
								extractDatadogInfoFromContainers(
									test.spec?.jobTemplate?.template?.spec?.containers || []
								),
								getDisplayVersion(latestEntry.version)
							)}
							<li class="t-meta flex flex-wrap items-center gap-x-3 gap-y-1">
								{#if canHover.current}
									<Tooltip class="z-50" placement="top" triggeredBy={'#pipe-test-' + test.metadata.name}>
										{phase}
									</Tooltip>
								{/if}
								<span id={'pipe-test-' + test.metadata.name} class="inline-flex items-center gap-1.5">
									{#if phase === 'Running'}
										<Spinner size="4" color="blue" />
									{:else if phase === 'Succeeded'}
										<CheckCircleSolid class="h-4 w-4 {testIconColor(phase)}" />
									{:else if phase === 'Failed'}
										<ExclamationCircleSolid class="h-4 w-4 {testIconColor(phase)}" />
									{:else if phase === 'Cancelled'}
										<CircleMinusSolid class="h-4 w-4 {testIconColor(phase)}" />
									{:else if phase === 'Skipped'}
										<CircleMinusSolid class="h-4 w-4 {testIconColor(phase)}" />
									{:else if phase === 'Pending'}
										<ClockArrowOutline class="h-3 w-3 {testIconColor(phase)}" />
									{:else}
										<ClockSolid class="h-4 w-4 {testIconColor(phase)}" />
									{/if}
									<span class="t-code-sm text-fg-muted">
										{test.metadata.name}
									</span>
									{#if retryCount > 0}
										<span
											class="chip t-label gap-0.5 border-line text-fg-subtle tabular-nums"
											title="{retryCount} retr{retryCount === 1 ? 'y' : 'ies'}"
										>
											<RefreshOutline class="h-3 w-3" />
											{retryCount}
										</span>
									{/if}
								</span>
								{#if phase === 'Failed'}
									<a
										href={href(`/rollouts/${cluster}/${namespace}/${name}/logs?tab=tests`)}
										class="t-ui-sm inline-flex items-center gap-0.5 text-accent-text hover:underline"
									>
										Logs<ArrowUpRightFromSquareOutline class="h-3 w-3" />
									</a>
								{/if}
								{#each testLinks as link}
									{@const Mark = TEST_LINK_MARK[link.kind]}
									<a
										href={link.url}
										target="_blank"
										rel="noopener noreferrer"
										title={link.vendor ? `${link.label} in ${link.vendor}` : link.label}
										aria-label={link.vendor ? `${link.label} in ${link.vendor}` : undefined}
										class="t-ui-sm inline-flex items-center gap-1 text-accent-text hover:underline"
									>
										<Mark class="h-3 w-3 shrink-0" />{link.label}<ArrowUpRightFromSquareOutline
											class="h-3 w-3"
										/>
									</a>
								{/each}
							</li>
						{/if}
					{/each}
				</ul>
			{:else}
				<p class="t-meta mt-2 pl-5 text-fg-subtle">
					No tests configured
				</p>
			{/if}
		{/if}

		{#if extra === 'bake' && sd}
			{@const ann = sd.kr.kruiseRollout?.metadata?.annotations || {}}
			{@const stepBakeTime = ann[`rollout.kuberik.io/step-${sd.stepNum}-bake-time`]}
			{@const stepReadyAt = ann[`internal.rollout.kuberik.io/step-${sd.stepNum}-ready-at`]}
			{@const bakeTimeMs = stepBakeTime ? parseDuration(stepBakeTime) : 0}
			{@const live = sd.bakingNow && !!stepReadyAt && bakeTimeMs > 0}
			{@const elapsed = live ? $now.getTime() - new Date(stepReadyAt).getTime() : 0}
			{@const remainingBake = live ? Math.max(0, bakeTimeMs - elapsed) : 0}
			{#if live || pipelineSlots({ deployInFlight, canUpdate, stageCheckConfigured: bakeTimeMs > 0, timerConfigured: false, stageOpen: !sd.isPastStep }).checkLine}
				{@render progressLine(
					live,
					live ? Math.min(100, (elapsed / bakeTimeMs) * 100) : 0,
					live
						? remainingBake > 0
							? formatShortDuration(remainingBake) + ' remaining'
							: 'Ready to continue'
						: '0s remaining'
				)}
			{/if}
		{/if}

		<!-- ⛔ THE FAILED-CHECK PILLS NO LONGER REPEAT HERE (design language,
		     2026-10-08, "one fact, once"). The same check was named by the
		     banner, this sub-row's pill AND the rail's Health checks card. The
		     rail card is the authority on checks; this sub-row keeps its own
		     status line and stops there. -->

		{#if extra === 'timer' && rollout.spec?.bakeTime}
			{@const live = bakeIsInProgress && !!latestEntry.bakeStartTime}
			{@const totalMs = parseDuration(rollout.spec.bakeTime)}
			{@const elapsedMs = live ? $now.getTime() - new Date(latestEntry.bakeStartTime).getTime() : 0}
			{@const remainingMs = Math.max(0, totalMs - elapsedMs)}
			{#if live || pipelineSlots({ deployInFlight, canUpdate, stageCheckConfigured: false, timerConfigured: totalMs > 0 }).timerLine}
				{@render progressLine(
					live,
					live && totalMs > 0 ? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)) : 0,
					live ? (remainingMs > 0 ? formatShortDuration(remainingMs) + ' remaining' : 'Finishing…') : '0s remaining'
				)}
			{/if}
		{/if}
	</div>
{/snippet}

{#snippet detailPanel(node: StageNode, hideHeader = false)}
	<div class="space-y-4">
		{#if !hideHeader}
			<!-- Detail header: title + status + meta -->
			<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
				<h3 class="t-heading text-fg">
					{node.longLabel}
				</h3>
				{#if hasMultipleKRs && node.krName}
					<span
						class="inline-flex items-center gap-1 rounded-xs bg-subtle px-1.5 py-0.5 text-fg-muted"
					>
						<ArrowsRepeatOutline class="h-3 w-3" />
						{node.krName}
					</span>
				{/if}
				<!-- ⭐ ONE FACT, ONCE, ROUND 2 (2026-10-08): a failed detail
				     header already carries the red heading ink (above); a
				     `FAILED` chip beside it restated the same fact a third
				     time (circle, ink, chip). Every other state keeps its
				     chip — this header has no DONE suppression elsewhere, so
				     only `failed` is special-cased. -->
				{#if node.status === 'pending'}
					<!-- Only a WAITING step earns a chip: the page header's pill and
					     the stage's own glyph already say running / checking (one
					     fact, once). DONE is the norm: the green glyph already says it (design
					     review 2026-10-08). Only an in-flight or waiting state earns
					     a chip, and only here — the sub-rows below stay chip-free. -->
					<span
						class="chip t-label chip-wide flex-shrink-0 {pillClasses(
							node.status
						)}"
					>
						{node.statusLabel}
					</span>
				{/if}

				{#if node.kind === 'started' && latestEntry.timestamp}
					<span class="t-meta text-fg-subtle" title={formatDate(latestEntry.timestamp)}>
						{formatTimeAgoCompact(latestEntry.timestamp, $now)}
					</span>
				{:else if node.kind === 'bake' && bakeIsSucceeded && latestEntry.bakeEndTime}
					<!-- ⛔ U-34 — ONE DURATION FORMAT, NOT TWO ON ONE LINE.
					     (2026-10-08.) This printed `formatTimeAgoCompact` ("1h", the
					     compact form every other timestamp on this card uses) next to
					     `formatDuration` ("1 minute", the long-form word this card
					     uses nowhere else) for two DIFFERENT spans — time since the
					     check finished, and how long the check took. Both now use the
					     same compact unit the rest of the card already prints
					     (`formatShortDuration`, see the remaining-time bars above). -->
					<span class="t-meta text-fg-subtle" title={formatDate(latestEntry.bakeEndTime)}>
						{formatTimeAgoCompact(latestEntry.bakeEndTime, $now)} ·
						{formatShortDuration(
							new Date(latestEntry.bakeEndTime).getTime() -
								new Date(latestEntry.bakeStartTime || latestEntry.timestamp).getTime()
						)}
					</span>
				{:else if node.kind === 'bake' && bakeIsFailed && latestEntry.bakeEndTime}
					<span class="t-meta text-fg-subtle" title={formatDate(latestEntry.bakeEndTime)}>
						{formatTimeAgoCompact(latestEntry.bakeEndTime, $now)}
					</span>
				{:else if node.kind === 'bake' && !bakeIsSucceeded && !bakeIsFailed && rollout.spec?.deployTimeout && !bakeIsDeploying && !bakeIsInProgress}
					<span class="t-meta text-fg-subtle">
						{(() => {
							const deploymentTime = new Date(latestEntry.timestamp).getTime();
							const timeoutMs = parseDuration(rollout.spec.deployTimeout);
							const timeUntilTimeout = deploymentTime + timeoutMs - $now.getTime();
							return timeUntilTimeout > 0
								? `Timeout in ${formatShortDuration(timeUntilTimeout)}`
								: 'Timed out';
						})()}
					</span>
				{/if}
			</div>
		{/if}

		<!-- Started content -->
		{#if node.kind === 'started'}
			<div class="space-y-3">
				{#if latestEntry.message}
					<div
						class="rounded bg-subtle px-3 py-2"
					>
						<p class="t-body text-fg-muted">
							{latestEntry.message}
						</p>
					</div>
				{/if}
				{#if latestEntry.triggeredBy}
					<div class="t-meta inline-flex items-center gap-1.5 text-fg-subtle">
						{#if latestEntry.triggeredBy.kind === 'User'}
							<UserSolid class="h-4 w-4 flex-shrink-0" />
							<span>
								Triggered by
								<span class="t-ui-sm text-fg-muted">
									{latestEntry.triggeredBy.name}
								</span>
							</span>
						{:else}
							<CogSolid class="h-4 w-4 flex-shrink-0" />
							<span>Triggered by System</span>
						{/if}
					</div>
				{/if}
				{#if !latestEntry.message && !latestEntry.triggeredBy}
					<p class="t-body text-fg-subtle">
						Deployment initiated{#if latestEntry.timestamp}
							{' '}at {formatTimestamp(latestEntry.timestamp)}{/if}.
					</p>
				{/if}
			</div>
		{/if}

		<!-- Stage content -->
		{#if node.kind === 'stage' && node.stageData}
			{@const sd = node.stageData}
			{@const rolloutSub = rolloutSubStatus(sd)}
			{@const testsSub = testsSubStatus(sd)}
			{@const bakeSub = stageBakeSubStatus(sd)}

			<!-- Split meter: how much traffic this stage sends to the new build. New by design: no reference
			     region draws a share of one thing; it borrows the Check progress bar's 6px track and the
			     subtle/line tokens, and is present for every weighted stage so selecting another stage
			     changes words, never height. -->
			{#if sd.kr.canarySteps && stageWeight(sd.kr.canarySteps[sd.stepNum - 1])}
				{@const w = stageWeight(sd.kr.canarySteps[sd.stepNum - 1])!}
				<div class="space-y-1.5" data-testid="stage-split">
					<div class="t-meta text-fg-muted">
						{stageSplitText(
							w,
							sd.isPastStep || sd.stageAllDone ? 'past' : sd.isCurrentStep ? 'current' : 'pending',
							getDisplayVersion(latestEntry.version)
						)}
					</div>
					<div
						class="h-1.5 w-full overflow-hidden rounded-full bg-line"
						role="img"
						aria-label="{w.label} of traffic on the new version"
					>
						<div
							class="h-full rounded-full {sd.isCurrentStep && !sd.isPastStep && node.status !== 'failed' ? 'bg-progress-solid' : 'bg-fg-subtle'}"
							style="width: {w.pct}%"
						></div>
					</div>
				</div>
			{/if}

			<div
				class="overflow-hidden rounded-md border border-line bg-subtle"
			>
				{@render subRow('Rollout', rolloutSub.status, rolloutSub.label, null, sd)}
				{#if !sd.isLastStep}
					<div class="border-t border-line"></div>
					{@render subRow('Tests', testsSub.status, testsSub.label, 'tests', sd)}
					<div class="border-t border-line"></div>
					{@render subRow('Check', bakeSub.status, bakeSub.label, 'bake', sd)}
				{/if}
				{#if sd.isLastStep && sd.hasTests}
					<div class="border-t border-line"></div>
					<div class="t-meta flex items-center gap-1.5 px-3 py-2 text-warning">
						<ExclamationCircleSolid class="h-4 w-4 shrink-0" />
						Tests on last step won't run — rollout completes without pausing.
					</div>
				{/if}
			</div>

			{@const advLive = sd.isCurrentStep && !sd.isPastStep && sd.isStepPaused && canUpdate}
			{#if advLive || pipelineSlots({ deployInFlight, canUpdate, stageCheckConfigured: false, timerConfigured: false, stageOpen: !sd.isPastStep, lastStep: sd.isLastStep }).advance}
				{@const adv = stageAdvance(
					{
						stepNum: sd.stepNum,
						isLastStep: sd.isLastStep,
						canarySteps: sd.kr.canarySteps,
						annotations: sd.kr.kruiseRollout?.metadata?.annotations || {},
						trackName: sd.kr.kruiseRollout?.metadata?.name,
						multipleTracks: pipelineValidRollouts.length > 1
					},
					$now
				)}
				<!--
					⛔ THIS BUTTON USED TO SAY `Continue to next stage` AND FIRE
					INSTANTLY. A live UX critique pressed it and moved a PRODUCTION
					canary 1/9 → 2/9, skipping 13 seconds of remaining bake, with no
					dialog — on the same page where deploying one listed version made
					you type the sha. The friction was inverted.

					Two changes, and deliberately not "a modal everywhere":

					1. THE LABEL AND A CAPTION NOW SAY WHAT WILL HAPPEN — which stage,
					   what share of traffic, which track when there is more than one,
					   and how much bake is being cut short. The caption is visible AT
					   REST, which is the part that also works on a touch screen where
					   a tooltip does not exist.
					2. ONE CONFIRMATION CLICK, NO TYPING. This moves live traffic and
					   pressing it again cannot undo it, so it earns a dialog — but it
					   is a decision a reader can verify from the sentence in front of
					   them, so it does not earn a transcription exercise.
				-->
				<!-- ⭐ A SLOT, NOT AN ARRIVAL (owner 2026-11-12; landing film AD P1-2). While a deploy is in flight the
				     action's place is laid out from the first frame and drawn invisible and inert until the stage
				     pauses, and the caption is sized for its longest form (`consequenceReserve`: one line grows to
				     two when the check window opens), so nothing below it drops. The button is `primary` only when
				     nothing else advances the stage; with a check window running the controller continues by itself
				     and this is an override, so it is offered, not pushed (AD P3-3). -->
				<div class="flex flex-col gap-1.5" class:invisible={!advLive} inert={!advLive} aria-hidden={!advLive}>
					<div>
						<button
							type="button"
							class="btn {adv.emphasis === 'primary' ? 'btn-primary' : 'btn-secondary'} btn-sm"
							title={adv.consequence}
							onclick={() => askAdvance(adv, sd)}
						>
							<PlaySolid />
							{adv.label}
						</button>
					</div>
					<div class="grid max-w-md">
						<p class="t-meta invisible col-start-1 row-start-1 text-fg-subtle" aria-hidden="true">{adv.consequenceReserve}</p>
						<p class="t-meta col-start-1 row-start-1 text-fg-subtle">{adv.consequence}</p>
					</div>
				</div>
			{/if}
		{/if}

		<!-- Final bake content -->
		{#if node.kind === 'bake'}
			<!--
				⛔ U-34 / D-P1 — THE EXPLAINER IS FOR WHILE YOU ARE WAITING, SO IT
				LEAVES ONCE YOU ARE NOT. (2026-10-08.) This used to render
				unconditionally, including after the check had finished — a
				sentence whose whole subject is "health checks are watched before
				the deploy counts as done" sitting under a node that already reads
				`Checked · Done`, the done fact restated as if it were still in
				question. `Leaving` (not `{#if}`) so the SAME promote that collapses
				the sub-rows below it (see the box after this one) also eases this
				text out instead of both vanishing in one frame — the phone film's
				promote beat found both cuts on the same frame. -->
			<Leaving value={!bakeIsSucceeded && !bakeIsFailed}>
				{#snippet children()}
					<div class="t-meta flex items-start gap-2 text-fg-subtle">
						<!-- Was a bare `span[tabindex=0]` (flowbite's `Tooltip` adds the
						     tabindex): a focus stop on rollout detail with no role and no
						     name, which a screen reader announced as nothing at all. A
						     `button` in a flex row is blockified exactly like the span was,
						     and Tailwind's preflight strips its chrome — measured
						     pixel-identical in both themes. -->
						<button
							type="button"
							id="bake-help-icon"
							aria-label="What the final check window means"
							class="btn btn-ghost btn-icon btn-xs shrink-0 cursor-help"
						>
							<QuestionCircleOutline class="h-3 w-3 flex-shrink-0" aria-hidden="true" />
						</button>
						<Tooltip
							triggeredBy="#bake-help-icon"
							trigger={canHover.current ? 'hover' : 'click'}
							placement="top"
							class="t-meta max-w-xs"
						>
							After it is deployed, the new version runs live for a configured period while its health
							checks are watched. If every check holds for the whole window, the deploy is marked
							successful.
						</Tooltip>
						<span>
							Final check window. The new version is already live; health checks are watched before the
							deploy counts as done.
						</span>
					</div>
				{/snippet}
			</Leaving>

			<!-- ⚠️ THE CONTROLLER'S OWN SENTENCE, AND ON SUCCESS IT SAYS NOTHING
			     THIS CARD HAS NOT. `Bake time completed successfully (no errors
			     within bake time)` was the LAST `bake` left on rollout detail
			     after the rename, sitting directly under a node reading
			     `Checked · Done` and the elapsed time — the exact two-vocabulary
			     split the rename exists to close. It is not rewritten (it is the
			     cluster's text, not ours); it is shown only when it CARRIES
			     something — a failure, a cancellation, a stall. -->
			<!-- Leaves with its last words rather than vanishing — see `Leaving`. -->
			<Leaving value={!bakeIsSucceeded && latestEntry.bakeStatusMessage}>
				{#snippet children(message)}
					<div class="rounded bg-subtle px-3 py-2">
						<p class="t-body text-fg-muted">
							{message}
						</p>
					</div>
				{/snippet}
			</Leaving>

			<!--
				⛔ D-P1 — THE SUB-ROWS LEAVE, THEY DO NOT VANISH. (2026-10-08, phone
				film, promote beat.) This box used to be a plain `{#if}`: the moment
				the deploy finished, `bakeIsDeploying`/`bakeIsInProgress`/`bakeIsFailed`
				all went false in the same tick and the health-checks + check-timer
				rows (together ~60px at 390) disappeared in one frame, with nothing
				below them to glide into the gap. `Leaving` renders the LAST sub-row
				state while it collapses, so the rows beneath ease up over 300ms
				instead of jumping. -->
			<!-- A finished check keeps its two rows too (AD round 1: the detail pane
			     was a title floating in an empty box once the check had passed). -->
			<Leaving value={bakeIsDeploying || bakeIsInProgress || bakeIsFailed || bakeIsSucceeded}>
				{#snippet children()}
					<div
						class="overflow-hidden rounded-md border border-line"
					>
						{#if hasHCSelector}
							{@render subRow('Health checks', finalHCStatus.status, finalHCStatus.label, 'hc', null)}
							<div class="border-t border-line"></div>
						{/if}
						{@render subRow(
							'Check timer',
							finalBakeTimerStatus.status,
							finalBakeTimerStatus.label,
							'timer',
							null
						)}
					</div>
				{/snippet}
			</Leaving>
		{/if}
	</div>
{/snippet}

{#snippet groupHeader(info: { name: string; index: number; total: number })}
	<li aria-hidden="false" class="px-4 pt-4 pb-1">
		<div
			class="t-label flex items-center gap-2 text-fg-subtle"
		>
			<ArrowsRepeatOutline class="h-3 w-3 flex-shrink-0" />
			<span class="truncate">{info.name}</span>
			<span class="h-px flex-1 bg-line"></span>
			<span
				class="chip t-label chip-wide flex-shrink-0 border-line text-fg-subtle"
				title="Parallel rollouts progress independently"
			>
				track {info.index} / {info.total}
			</span>
		</div>
	</li>
{/snippet}

<!-- ━━━━━━━━━━━━━━━━━━━━━━ card ━━━━━━━━━━━━━━━━━━━━━━ -->

<!-- The card (its own border, not just what follows it) glides to a new height when the pipeline's state changes
     (`$lib/smooth-height`): a retry turning a failed check with its alert
     into a pending one, and its header from two lines to one, used to drop
     this card ~100px in one frame. -->
<div
	data-tour="pipeline"
	class="dpc-cq overflow-hidden rounded-md border border-line bg-surface"
	use:smoothHeight
>
	<div use:steadyHeight={deployKey(latestEntry, `${cluster ?? ""}/${namespace}/${name}`)}>
	<!--
		⭐ `min-h-[47px]`, MATCHING `Card`'S OWN FLOOR EXACTLY. (defect #4,
		design re-check) This header hand-rolls its own bar rather than using
		`Card` — its body is a master-detail split (a left nav column plus a
		right detail pane, desktop and mobile laid out differently) that does
		not fit `Card`'s single `children` slot without restructuring the
		component, so the migration is deferred. The NUMBER does not have to
		wait: `Card`'s header measures 47px because of this exact class
		(`min-h-47px`, `px-4 py-3`); this bar had no floor and measured 45px —
		one pixel value short of the reference page's own `Deployment
		Pipeline`. Byte-identical now.
	-->
	<!-- The header's own height can change with its rollup (at 390 a failed
	     run's `1 failed · 1/2 done` wraps the title to two lines; after a Retry
	     it is one). The border sits on this gliding box, so the rows below it
	     follow smoothly instead of jumping 18px — `$lib/smooth-height`. -->
	<div class="border-b border-line" use:smoothHeight>
	<div
		class="flex min-h-[47px] flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3"
	>
		<div class="flex items-center gap-2">
			{#if summary.failed > 0}
				<ExclamationCircleSolid class="h-4 w-4 text-danger" />
			{:else if summary.running > 0}
				<!-- The in-flight tone follows WHAT is in flight: deploying is
				     blue (active), checking/baking is yellow (progress). -->
				<StatusSpinner size="4" color={inflightIsDeploy ? 'blue' : 'yellow'} />
			{:else if summary.checking > 0}
				<!-- ITEM 9: the active steps are all `paused` (checking) — same
				     yellow spin as `pillClasses`' own `paused` chip, never blue. -->
				<StatusSpinner size="4" color="yellow" />
			{:else if summary.done === summary.total}
				<CheckCircleSolid class="h-4 w-4 text-success" />
			{:else}
				<CodePullRequestSolid class="h-4 w-4 text-fg-subtle" />
			{/if}
			<h2 class="t-card-title text-fg">Deployment pipeline</h2>
		</div>
		<div class="flex items-center gap-3">
			{#if !isAutoSelected}
				<button
					type="button"
					onclick={jumpToActive}
					class="pill"
				>
					{#if jumpButton.active}
						<span class="relative flex h-1.5 w-1.5">
							{#if inflightIsDeploy}
								<span
									class="absolute inline-flex h-full w-full animate-ping rounded-full bg-active-solid opacity-70"
								></span>
							{/if}
							<span class="relative inline-flex h-1.5 w-1.5 rounded-full {inflightIsDeploy ? 'bg-active-solid' : 'bg-progress-solid'}"></span>
						</span>
					{/if}
					{jumpButton.label}
				</button>
			{/if}
			<!--
				⛔ U-19 — `STEPS DONE`, NOT THE BARE WORD `done`. (2026-10-08.) Home's
				own rail counts a DIFFERENT thing under the same word — its
				promotion stepper's "N/M stages done" is environments reached
				(dev → staging → prod), while this card's "done" is pipeline NODES
				(the Started marker, each canary step, the final check) for ONE
				environment's one deploy. Measured live, the two numbers for the
				same rollout at the same moment disagreed (`1/2` here, `2/3` there)
				with nothing to tell a reader they were never counting the same
				thing. `steps` scopes the word to what THIS card counts; Home's own
				stepper needs the matching scope word on its side (flagged to that
				lane — see the commit message).

				⛔ ITEM 2 (integrate-fixa, 2026-10-08) — ONE LINE ON PHONES, TWO
				WORDINGS OF THE SAME FACTS. At 360/390 this header measured 64px
				(two lines, not the `min-h-[47px]` floor above) because the h2 had
				no `whitespace-nowrap` of its own (fixed above) AND because "1/2
				steps done · in progress" plus "Deployment pipeline" plus the
				icon simply do not fit a ~340px content width on one line. Rather
				than drop the `steps` word everywhere (losing the U-19 fix above
				on every width), the card keeps the full "N/M steps done" phrasing
				once there is room for it (`.dpc-summary-full`, ≥480px of this
				card's own container — well under the 600px master-detail split
				above, which is about the BODY, not this header) and falls back to
				"N/M · in progress" / "N/M" below that — `steps` is implied by the
				fraction sitting next to the pipeline's own heading, the way
				`cardVerdict`'s chips already imply their own units next to a named
				row. Same four branches, same colours, half the characters. -->
			<!-- ONE SHORT ROLLUP, NO FULL/COMPACT TWINS (design rollout, 2026-10-09):
			     "N/M steps" fits a 47px header at 360 on its own. The rollup tone
			     follows the step (integrator's rule): failed is stated by the
			     banner (one fact, once), so the count stays subtle; in flight =
			     the step's own ink (deploying active, checking progress — the
			     word "checking" is the step's own, not repeated here, so the
			     header holds 47px at 360); all
			     done = success. -->
			{#if summary.failed > 0}
				<span class="t-ui-sm whitespace-nowrap tabular-nums text-fg-subtle">
					{summary.done}/{summary.total} steps
				</span>
			{:else if summary.running > 0}
				<span class="t-ui-sm whitespace-nowrap tabular-nums {inflightIsDeploy ? 'text-active' : 'text-progress'}">
					{summary.done}/{summary.total} steps
				</span>
			{:else if summary.checking > 0}
				<span class="t-ui-sm whitespace-nowrap tabular-nums text-progress">
					{summary.done}/{summary.total} steps
				</span>
			{:else if summary.done === summary.total}
				<span class="t-ui-sm whitespace-nowrap tabular-nums text-success">
					{summary.total}/{summary.total} steps
				</span>
			{:else}
				<span class="t-ui-sm whitespace-nowrap tabular-nums text-fg-subtle">
					{summary.done}/{summary.total} steps
				</span>
			{/if}
		</div>
	</div>
	</div>

	<!--
		⭐ F4: MASTER-DETAIL SPLIT ON A CONTAINER QUERY (`.dpc-desktop`), NOT
		`md`. (2026-09-03,
		breakpoints pass) This card sits in rollout detail's MAIN column, whose
		own width is decided by a separate container query now (see that
		page's `.ov-split` note) — so this card's rendered width and the
		viewport are two different numbers. Measured on the live page at 1024
		viewport (main 417px before that fix): the explanation pane fell to
		127px, wrapping a single sentence over 14 lines. `.dpc-cq`
		(`container-type: inline-size`, on the card's own outer wrapper above)
		makes the query subject this card's actual box. 600px is the same
		floor the finding measured against (`~600px`): below it, the nav list
		and the step detail stack in reading order (the mobile shape below);
		at or above it, the two-pane split returns.
	-->
	<div class="dpc-desktop">
		<!-- Left nav. ⭐ ONE SURFACE, ROUND 2 (2026-10-08, coordinator
		     review): the nav used to sit on its own `bg-subtle` panel beside
		     the detail pane's plain `bg-surface` — two surfaces reading as
		     two cards glued together. Both panes are `bg-surface` now (the
		     card's own ground); the `border-r` alone is the seam. -->
		<nav
			class="border-r border-line"
			aria-label="Pipeline stages"
		>
			<ol class="py-2">
				{#each nodes as node, idx}
					{#if node.groupHeader}
						{@render groupHeader(node.groupHeader)}
					{/if}
					{@render navRow(node, shouldShowLineAbove(node, idx), shouldShowLineBelow(node, idx))}
				{/each}
			</ol>
		</nav>

		<!-- Right detail -->
		<div class="p-5 sm:p-6">
			{#each selectedNodes as node, idx (node.id)}
				{#if idx > 0}
					<div class="my-5 border-t border-line"></div>
				{/if}
				{@render detailPanel(node)}
			{/each}
		</div>
	</div>

	<!-- Mobile (card under 600px): vertical stepper with inline detail -->
	<div class="dpc-mobile">
		<ol class="py-2">
			{#each nodes as node, idx}
				{@const isSelected = selectedIds.includes(node.id)}
				{#if node.groupHeader}
					{@render groupHeader(node.groupHeader)}
				{/if}
				<li class="relative">
					<!-- connector line pieces -->
					{#if shouldShowLineAbove(node, idx)}
						<div
							aria-hidden="true"
							class="absolute left-[29px] top-0 h-2 w-0.5 bg-line-strong"
						></div>
					{/if}
					{#if shouldShowLineBelow(node, idx)}
						<!-- Line below: spans from circle bottom to li bottom. When selected, li height
						     expands to include the inline detail panel, so the line continues through it. -->
						<div
							aria-hidden="true"
							class="absolute left-[29px] top-9 bottom-0 w-0.5 bg-line-strong"
						></div>
					{/if}

					<button
						type="button"
						onclick={() => select(node.id)}
						aria-current={isSelected ? 'step' : undefined}
						class="group relative flex w-full items-center gap-3 py-2 pl-4 pr-4 text-left transition-colors hover:bg-hover {isSelected
							? 'bg-selected'
							: nodeAccentRow(node)}"
					>
						<span
							aria-hidden="true"
							class="absolute inset-y-0 left-0 w-0.5 {leftEdgeAccent(node.status, isSelected)}"
						></span>

						<!-- `isolate`: the disc's z-10 only has to beat its own ping ring and
			     connector; without a stacking context here it also beat the sticky
			     tab strip (z-10 too) and rode over it while scrolling (2026-09-04). -->
			<div class="relative isolate flex-shrink-0">
							{#if node.isActive && node.status === 'running'}
								<span
									aria-hidden="true"
									class="absolute inset-0 animate-ping rounded-full opacity-40 {subDotBg(
										node.status
									)}"
								></span>
							{/if}
							<StepDisc state={nodeTone(node.status)} class="relative z-10 h-7 w-7" />
						</div>

						<div class="flex min-w-0 flex-1 items-center justify-between gap-2">
							<div class="flex min-w-0 items-center gap-1.5">
								<span
									class="truncate {node.status === 'failed'
										? 't-card-title text-danger'
										: isSelected
											? 't-card-title text-fg'
											: 't-body text-fg-muted'}"
								>
									{node.shortLabel}{#if node.weight}{" "}<span class="t-meta text-fg-subtle">· {node.weight.label}</span>{/if}
								</span>
							</div>
							<!-- Chip budget, round 2 — see `navRow`'s identical note above. -->
							{#if node.status !== 'done' && node.status !== 'failed'}
								<span
									class="chip t-label chip-wide flex-shrink-0 {pillClasses(
										node.status
									)}"
								>
									{node.statusLabel}
								</span>
							{/if}
						</div>
					</button>

					{#if isSelected}
						<div class="pl-[54px] pr-4 pb-5 pt-1">
							{@render detailPanel(node, true)}
						</div>
					{/if}
				</li>
			{/each}
		</ol>
	</div>
	</div>
</div>

<style>
	/*
	 * ⭐ F4: THE TWO RENDERED SHAPES, TOGGLED BY THE CARD'S OWN WIDTH. See the
	 * doc comment on `.dpc-desktop` in the markup. Both blocks always render
	 * (two different DOM structures, not a CSS reflow of one), so the
	 * container query only ever flips `display`, matching the mobile-first
	 * default `hidden md:grid` / `md:hidden` used to. One class per state,
	 * both properties set together in each rule, so there is no cross-class
	 * specificity tie to reason about.
	 */
	.dpc-cq {
		container-type: inline-size;
	}

	.dpc-desktop {
		display: none;
	}

	.dpc-mobile {
		display: block;
	}

	@container (min-width: 600px) {
		.dpc-desktop {
			display: grid;
			grid-template-columns: minmax(260px, 300px) 1fr;
		}

		.dpc-mobile {
			display: none;
		}
	}
</style>

{#if pendingAdvance}
	<Modal bind:open={advanceModalOpen} title={pendingAdvance.adv.confirmTitle} size="sm" autoclose={false}>
		<div class="space-y-4">
			<p class="t-body text-fg-subtle">{pendingAdvance.adv.consequence}</p>
			<div class="flex justify-end gap-2">
				<button type="button" class="btn btn-secondary" onclick={cancelAdvance}>Cancel</button>
				<button type="button" class="btn btn-primary" onclick={confirmAdvance}>
					<PlaySolid />
					{pendingAdvance.adv.label}
				</button>
			</div>
		</div>
	</Modal>
{/if}
