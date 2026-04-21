<svelte:options runes={true} />

<script lang="ts">
	import { Button, Spinner, Tooltip } from 'flowbite-svelte';
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
		CircleMinusSolid
	} from 'flowbite-svelte-icons';
	import DatadogLogo from './DatadogLogo.svelte';
	import HealthCheckBadge from './HealthCheckBadge.svelte';
	import {
		formatTimeAgo,
		formatDuration,
		getDisplayVersion,
		parseLinkAnnotations,
		extractDatadogInfoFromContainers,
		buildDatadogTestRunsUrl,
		buildDatadogLogsUrl
	} from '$lib/utils';
	import { now } from '$lib/stores/time';
	import type { Rollout, RolloutTest, HealthCheck, KruiseRollout } from '../../types';

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
		canUpdate: boolean;
		namespace: string;
		name: string;
		onContinue: (kruiseRolloutName: string, kruiseRolloutNamespace: string) => void;
	}

	let {
		rollout,
		latestEntry,
		pipelineValidRollouts,
		pipelineValidTests,
		healthChecks,
		canUpdate,
		namespace,
		name,
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

	function formatDurationFromMs(ms: number): string {
		if (ms <= 0) return '0s';
		const s = Math.floor(ms / 1000);
		const m = Math.floor(s / 60);
		const h = Math.floor(m / 60);
		const d = Math.floor(h / 24);
		if (d > 0) return `${d}d ${h % 24}h`;
		if (h > 0) return `${h}h ${m % 60}m`;
		if (m > 0) return `${m}m ${s % 60}s`;
		return `${s}s`;
	}

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

	type NodeStatus = 'done' | 'running' | 'paused' | 'failed' | 'pending';

	type StageNode = {
		id: string;
		kind: 'started' | 'stage' | 'bake';
		shortLabel: string;
		longLabel: string;
		status: NodeStatus;
		statusLabel: string;
		krName?: string;
		isLive: boolean;
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
	let bakeIsInProgress = $derived(allStagesDone && latestEntry.bakeStatus === 'InProgress');
	let bakeIsSucceeded = $derived(allStagesDone && latestEntry.bakeStatus === 'Succeeded');
	let bakeIsFailed = $derived(allStagesDone && latestEntry.bakeStatus === 'Failed');
	let hasHCSelector = $derived(Boolean(rollout.spec?.healthCheckSelector));
	let allHCHealthy = $derived(
		healthChecks.length === 0 || healthChecks.every((hc) => hc.status?.status === 'Healthy')
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
				isLive: false
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
						!hasTests || stepTests.every((t) => t.status?.phase === 'Succeeded');
					const bakingNow =
						isCurrentStep && isStepPaused && allTestsSucceeded && !isKrStalled;
					const stageTestsFailed =
						isCurrentStep && stepTests.some((t) => t.status?.phase === 'Failed');
					const bakeFailed =
						isKrStalled && isCurrentStep && isStepPaused && !stageTestsFailed;
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
						statusLabel = 'Baking';
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

					result.push({
						id: `stage-${krIdx}-${stepIdx}`,
						kind: 'stage',
						shortLabel: `Stage ${stepNum}`,
						longLabel: `Stage ${stepNum}`,
						status,
						statusLabel,
						krName,
						isLive: isCurrentStep,
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
				bakeStatusLabel = 'Baking';
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
				shortLabel: 'Bake',
				longLabel: bakeIsSucceeded ? 'Baked' : 'Final Bake',
				status: bakeStatus,
				statusLabel: bakeStatusLabel,
				isLive: bakeIsDeploying || bakeIsInProgress
			});

			return result;
		})()
	);

	let liveNodeId = $derived(
		nodes.find(
			(n) => n.status === 'running' || n.status === 'paused' || n.status === 'failed'
		)?.id ?? nodes[nodes.length - 1]?.id ?? 'started'
	);

	let userSelectedId = $state<string | null>(null);
	let selectedId = $derived(userSelectedId ?? liveNodeId);
	let selectedNode = $derived(nodes.find((n) => n.id === selectedId) ?? nodes[0]);
	let isAutoSelected = $derived(userSelectedId === null);

	function select(id: string) {
		userSelectedId = id;
	}

	function jumpToLive() {
		userSelectedId = null;
	}

	// Header summary
	let summary = $derived(
		(() => {
			const failed = nodes.filter((n) => n.status === 'failed').length;
			const done = nodes.filter((n) => n.status === 'done').length;
			const running = nodes.filter((n) => n.status === 'running' || n.status === 'paused').length;
			const pending = nodes.filter((n) => n.status === 'pending').length;
			return { failed, done, running, pending, total: nodes.length };
		})()
	);

	// Styling helpers
	function circleBg(status: NodeStatus): string {
		return {
			done: 'bg-green-500 text-white',
			running: 'bg-blue-500 text-white',
			paused: 'bg-yellow-500 text-white',
			failed: 'bg-red-500 text-white',
			pending:
				'bg-white border-2 border-gray-300 text-gray-400 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-500'
		}[status];
	}

	function connectorBg(fromStatus: NodeStatus, toStatus: NodeStatus): string {
		if (toStatus === 'failed') return 'bg-red-500';
		if (fromStatus === 'done' && toStatus === 'done') return 'bg-green-500';
		if (fromStatus === 'done')
			return 'bg-gradient-to-r from-green-500 to-gray-200 dark:to-gray-700';
		return 'bg-gray-200 dark:bg-gray-700';
	}

	function verticalConnectorBg(fromStatus: NodeStatus, toStatus: NodeStatus): string {
		if (toStatus === 'failed') return 'bg-red-500';
		if (fromStatus === 'done' && toStatus === 'done') return 'bg-green-500';
		if (fromStatus === 'done')
			return 'bg-gradient-to-b from-green-500 to-gray-200 dark:to-gray-700';
		return 'bg-gray-200 dark:bg-gray-700';
	}

	function pillClasses(status: NodeStatus): string {
		return {
			done: 'bg-green-50 text-green-700 ring-green-200 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-800/60',
			running:
				'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800/60',
			paused:
				'bg-yellow-50 text-yellow-700 ring-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300 dark:ring-yellow-800/60',
			failed:
				'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800/60',
			pending:
				'bg-gray-50 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700'
		}[status];
	}

	function subDotBg(status: NodeStatus): string {
		return {
			done: 'bg-green-500',
			running: 'bg-blue-500',
			paused: 'bg-yellow-500',
			failed: 'bg-red-500',
			pending: 'bg-gray-300 dark:bg-gray-600'
		}[status];
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
		if (!sd.hasTests) return { status: 'pending', label: '—' };
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
		if (sd.bakingNow) return { status: 'paused', label: 'In progress' };
		if (sd.waitingForBake) return { status: 'pending', label: 'Waiting' };
		return { status: 'pending', label: 'Pending' };
	}

	let finalHCStatus = $derived<{ status: NodeStatus; label: string }>(
		(() => {
			if (bakeIsFailed && !allHCHealthy) return { status: 'failed', label: 'Failed' };
			if (bakeIsInProgress || bakeIsSucceeded || (bakeIsFailed && allHCHealthy))
				return { status: 'done', label: 'Healthy' };
			if (bakeIsDeploying && !allHCHealthy) return { status: 'running', label: 'Waiting' };
			return { status: 'pending', label: 'Pending' };
		})()
	);

	let finalBakeTimerStatus = $derived<{ status: NodeStatus; label: string }>(
		(() => {
			if (bakeIsFailed && allHCHealthy) return { status: 'failed', label: 'Failed' };
			if (bakeIsSucceeded) return { status: 'done', label: 'Done' };
			if (bakeIsInProgress) return { status: 'paused', label: 'In progress' };
			return { status: 'pending', label: 'Pending' };
		})()
	);

	function testIconColor(phase: string): string {
		if (phase === 'Succeeded') return 'text-green-500';
		if (phase === 'Failed') return 'text-red-500';
		if (phase === 'Cancelled') return 'text-gray-400';
		if (phase === 'Pending') return 'text-yellow-500';
		return 'text-gray-400';
	}
</script>

<!-- ─────────────────────  snippets  ───────────────────── -->

{#snippet nodeIcon(status: NodeStatus, size: 'sm' | 'lg')}
	{#if status === 'done'}
		<CheckCircleSolid class={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
	{:else if status === 'failed'}
		<ExclamationCircleSolid class={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} />
	{:else if status === 'running' || status === 'paused'}
		<div
			class="{size === 'lg'
				? 'h-5 w-5'
				: 'h-4 w-4'} animate-spin rounded-full border-2 border-white/70 border-t-white"
		></div>
	{:else}
		<ClockSolid class={size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
	{/if}
{/snippet}

{#snippet subRow(
	title: string,
	status: NodeStatus,
	label: string,
	extra: 'tests' | 'bake' | 'hc' | 'timer' | null,
	sd: NonNullable<StageNode['stageData']> | null
)}
	<div class="px-4 py-3 sm:px-5">
		<div class="flex items-center gap-3">
			<span
				aria-hidden="true"
				class="h-2.5 w-2.5 flex-shrink-0 rounded-full {subDotBg(status)} {status ===
					'running' || status === 'paused'
					? 'animate-pulse'
					: ''}"
			></span>
			<span class="flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">
				{title}
				{#if extra === 'tests' && sd?.hasTests}
					<span class="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
						({sd.stepTests.length})
					</span>
				{/if}
			</span>
			<span
				class="inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset {pillClasses(
					status
				)}"
			>
				{label}
			</span>
		</div>

		<!-- Tests list -->
		{#if extra === 'tests' && sd}
			{#if sd.hasTests}
				<ul class="mt-2.5 space-y-1.5 pl-5">
					{#each sd.stepTests as test}
						{#if test.metadata}
							{@const phase = test.status?.phase || 'Unknown'}
							{@const retryCount = test.status?.retryCount || 0}
							{@const linkAnnotations = parseLinkAnnotations(test.metadata.annotations)}
							{@const ddInfo = extractDatadogInfoFromContainers(
								test.spec?.jobTemplate?.template?.spec?.containers || []
							)}
							<li class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
								<Tooltip class="z-50" placement="top" triggeredBy={'#pipe-test-' + test.metadata.name}>
									{phase}{retryCount > 0
										? ` (${retryCount} retr${retryCount === 1 ? 'y' : 'ies'})`
										: ''}
								</Tooltip>
								<span id={'pipe-test-' + test.metadata.name} class="inline-flex items-center gap-1.5">
									{#if phase === 'Running'}
										<Spinner size="4" color="blue" />
									{:else if phase === 'Succeeded'}
										<CheckCircleSolid class="h-3.5 w-3.5 {testIconColor(phase)}" />
									{:else if phase === 'Failed'}
										<ExclamationCircleSolid class="h-3.5 w-3.5 {testIconColor(phase)}" />
									{:else if phase === 'Cancelled'}
										<CircleMinusSolid class="h-3.5 w-3.5 {testIconColor(phase)}" />
									{:else if phase === 'Pending'}
										<ClockArrowOutline class="h-3.5 w-3.5 {testIconColor(phase)}" />
									{:else}
										<ClockSolid class="h-3.5 w-3.5 {testIconColor(phase)}" />
									{/if}
									<span class="font-mono text-gray-700 dark:text-gray-200">
										{test.metadata.name}{retryCount > 0 ? ` (retry ${retryCount})` : ''}
									</span>
								</span>
								{#if phase === 'Failed'}
									<a
										href="/rollouts/{namespace}/{name}/logs?tab=tests"
										class="inline-flex items-center gap-0.5 font-medium text-blue-600 hover:underline dark:text-blue-400"
									>
										Logs<ArrowUpRightFromSquareOutline class="h-2.5 w-2.5" />
									</a>
								{/if}
								{#each linkAnnotations as link}
									<a
										href={link.url}
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-0.5 font-medium text-blue-600 hover:underline dark:text-blue-400"
									>
										{link.label}<ArrowUpRightFromSquareOutline class="h-2.5 w-2.5" />
									</a>
								{/each}
								{#if ddInfo}
									<a
										href={buildDatadogLogsUrl(ddInfo.service, ddInfo.env)}
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-0.5 font-medium text-purple-600 hover:underline dark:text-purple-400"
									>
										<DatadogLogo class="h-2.5 w-2.5" />Logs
									</a>
									<a
										href={buildDatadogTestRunsUrl(
											ddInfo.service,
											ddInfo.version || getDisplayVersion(latestEntry.version)
										)}
										target="_blank"
										rel="noopener noreferrer"
										class="inline-flex items-center gap-0.5 font-medium text-purple-600 hover:underline dark:text-purple-400"
									>
										<DatadogLogo class="h-2.5 w-2.5" />CI
									</a>
								{/if}
							</li>
						{/if}
					{/each}
				</ul>
			{:else}
				<p class="mt-1.5 pl-5 text-xs italic text-gray-400 dark:text-gray-500">
					No tests configured
				</p>
			{/if}
		{/if}

		<!-- Stage-level bake progress bar -->
		{#if extra === 'bake' && sd?.bakingNow}
			{@const ann = sd.kr.kruiseRollout?.metadata?.annotations || {}}
			{@const bakeTimeKey = `rollout.kuberik.io/step-${sd.stepNum}-bake-time`}
			{@const readyAtKey = `internal.rollout.kuberik.io/step-${sd.stepNum}-ready-at`}
			{@const stepBakeTime = ann[bakeTimeKey]}
			{@const stepReadyAt = ann[readyAtKey]}
			{#if stepReadyAt}
				{@const readyAtMs = new Date(stepReadyAt).getTime()}
				{@const elapsed = $now.getTime() - readyAtMs}
				{@const bakeTimeMs = stepBakeTime ? parseDuration(stepBakeTime) : 0}
				{@const remainingBake = bakeTimeMs > 0 ? Math.max(0, bakeTimeMs - elapsed) : 0}
				{#if bakeTimeMs > 0}
					{@const progress = Math.min(100, (elapsed / bakeTimeMs) * 100)}
					<div class="mt-2.5 pl-5">
						<div
							class="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
						>
							<div
								class="h-full rounded-full bg-yellow-500 transition-[width] duration-500"
								style="width: {progress}%"
							></div>
						</div>
						<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
							{remainingBake > 0
								? formatDurationFromMs(remainingBake) + ' remaining'
								: 'Ready to continue'}
						</p>
					</div>
				{/if}
			{/if}
		{/if}

		<!-- Final HC failed list -->
		{#if extra === 'hc' && bakeIsFailed && (latestEntry.failedHealthChecks?.length ?? 0) > 0}
			<div class="mt-2 flex flex-col gap-1 pl-5">
				{#each latestEntry.failedHealthChecks || [] as failedHC, index}
					<HealthCheckBadge
						failedHealthCheck={failedHC}
						fullHealthCheck={findFullHealthCheck(failedHC, healthChecks)}
						{index}
						prefix="failed-hc-pipeline"
					/>
				{/each}
			</div>
		{/if}

		<!-- Final bake timer progress -->
		{#if extra === 'timer' && bakeIsInProgress && latestEntry.bakeStartTime && rollout.spec?.bakeTime}
			{@const bakeStartMs = new Date(latestEntry.bakeStartTime).getTime()}
			{@const elapsedMs = $now.getTime() - bakeStartMs}
			{@const totalMs = parseDuration(rollout.spec.bakeTime)}
			{@const progress = totalMs > 0 ? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)) : 0}
			{@const remainingMs = Math.max(0, totalMs - elapsedMs)}
			<div class="mt-2.5 pl-5">
				<div class="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
					<div
						class="h-full rounded-full bg-yellow-500 transition-[width] duration-500"
						style="width: {progress}%"
					></div>
				</div>
				<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
					{remainingMs > 0 ? formatDurationFromMs(remainingMs) + ' remaining' : 'Finishing…'}
				</p>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet detailPanel(node: StageNode)}
	<div class="space-y-4">
		<!-- Title row -->
		<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
			<div class="flex min-w-0 items-center gap-3">
				<h6 class="text-base font-bold tracking-tight text-gray-900 sm:text-lg dark:text-white">
					{node.longLabel}
				</h6>
				{#if hasMultipleKRs && node.krName}
					<span
						class="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[11px] text-gray-600 dark:bg-gray-700 dark:text-gray-300"
					>
						{node.krName}
					</span>
				{/if}
				<span
					class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset {pillClasses(
						node.status
					)}"
				>
					{node.statusLabel}
				</span>
			</div>

			{#if node.kind === 'started' && latestEntry.timestamp}
				<span class="text-xs text-gray-500 dark:text-gray-400">
					{formatTimeAgo(latestEntry.timestamp, $now)}
				</span>
			{:else if node.kind === 'bake' && bakeIsSucceeded && latestEntry.bakeEndTime}
				<span class="text-xs text-gray-500 dark:text-gray-400">
					{formatTimeAgo(latestEntry.bakeEndTime, $now)} ·
					{formatDuration(
						latestEntry.bakeStartTime || latestEntry.timestamp,
						new Date(latestEntry.bakeEndTime)
					)}
				</span>
			{:else if node.kind === 'bake' && bakeIsFailed && latestEntry.bakeEndTime}
				<span class="text-xs text-gray-500 dark:text-gray-400">
					{formatTimeAgo(latestEntry.bakeEndTime, $now)}
				</span>
			{:else if node.kind === 'bake' && !bakeIsSucceeded && !bakeIsFailed && rollout.spec?.deployTimeout && !bakeIsDeploying && !bakeIsInProgress}
				<span class="text-xs text-gray-400 dark:text-gray-500">
					{(() => {
						const deploymentTime = new Date(latestEntry.timestamp).getTime();
						const timeoutMs = parseDuration(rollout.spec.deployTimeout);
						const timeUntilTimeout = deploymentTime + timeoutMs - $now.getTime();
						return timeUntilTimeout > 0
							? `Timeout in ${formatDurationFromMs(timeUntilTimeout)}`
							: 'Timed out';
					})()}
				</span>
			{/if}
		</div>

		<!-- Started content -->
		{#if node.kind === 'started'}
			<div class="space-y-3">
				{#if latestEntry.message}
					<div
						class="rounded-md border-l-2 border-gray-300 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-900/40"
					>
						<p class="text-sm italic text-gray-700 dark:text-gray-300">
							{latestEntry.message}
						</p>
					</div>
				{/if}
				{#if latestEntry.triggeredBy}
					<div
						class="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400"
					>
						{#if latestEntry.triggeredBy.kind === 'User'}
							<UserSolid class="h-3.5 w-3.5 flex-shrink-0" />
							<span>
								Triggered by
								<span class="font-medium text-gray-700 dark:text-gray-200">
									{latestEntry.triggeredBy.name}
								</span>
							</span>
						{:else}
							<CogSolid class="h-3.5 w-3.5 flex-shrink-0" />
							<span>Triggered by System</span>
						{/if}
					</div>
				{/if}
				{#if !latestEntry.message && !latestEntry.triggeredBy}
					<p class="text-sm text-gray-500 dark:text-gray-400">
						Deployment initiated{#if latestEntry.timestamp}
							{' '}at {new Date(latestEntry.timestamp).toLocaleString()}{/if}.
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

			<div
				class="overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30"
			>
				{@render subRow('Rollout', rolloutSub.status, rolloutSub.label, null, sd)}
				<div class="border-t border-gray-200 dark:border-gray-700"></div>
				{@render subRow('Tests', testsSub.status, testsSub.label, 'tests', sd)}
				{#if !sd.isLastStep}
					<div class="border-t border-gray-200 dark:border-gray-700"></div>
					{@render subRow('Bake', bakeSub.status, bakeSub.label, 'bake', sd)}
				{/if}
			</div>

			{#if sd.isCurrentStep && canUpdate}
				<div>
					<Button
						size="sm"
						color="blue"
						disabled={!sd.isStepPaused}
						onclick={() =>
							onContinue(sd.kr.rolloutResource.name, sd.kr.rolloutResource.namespace)}
					>
						<PlaySolid class="mr-1.5 h-3.5 w-3.5" />
						Continue to next stage
					</Button>
					{#if !sd.isStepPaused}
						<p class="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
							Available once the stage has baked successfully.
						</p>
					{/if}
				</div>
			{/if}
		{/if}

		<!-- Final bake content -->
		{#if node.kind === 'bake'}
			<div class="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400">
				<span id="bake-help-icon">
					<QuestionCircleOutline class="mt-0.5 h-3.5 w-3.5 cursor-help flex-shrink-0" />
				</span>
				<Tooltip triggeredBy="#bake-help-icon" placement="top" class="max-w-xs text-xs">
					After deployment, the new version bakes in production for a configured period. Health
					checks are monitored during this time. If all checks pass throughout the bake window,
					the deployment is marked as successful.
				</Tooltip>
				<span>
					Final bake window. Health checks are monitored before the deployment is marked
					successful.
				</span>
			</div>

			{#if latestEntry.bakeStatusMessage}
				<div
					class="rounded-md border-l-2 border-gray-300 bg-gray-50 px-3 py-2 dark:border-gray-600 dark:bg-gray-900/40"
				>
					<p class="text-sm italic text-gray-700 dark:text-gray-300">
						{latestEntry.bakeStatusMessage}
					</p>
				</div>
			{/if}

			{#if bakeIsDeploying || bakeIsInProgress || bakeIsFailed}
				<div
					class="overflow-hidden rounded-lg border border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/30"
				>
					{#if hasHCSelector}
						{@render subRow('Health checks', finalHCStatus.status, finalHCStatus.label, 'hc', null)}
						<div class="border-t border-gray-200 dark:border-gray-700"></div>
					{/if}
					{@render subRow(
						'Bake timer',
						finalBakeTimerStatus.status,
						finalBakeTimerStatus.label,
						'timer',
						null
					)}
				</div>
			{/if}
		{/if}
	</div>
{/snippet}

<!-- ─────────────────────  card  ───────────────────── -->

<div
	class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
>
	<!-- Header: matches HealthChecksCard / ResourcesCard pattern -->
	<div
		class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700"
	>
		<div class="flex items-center gap-2">
			{#if summary.failed > 0}
				<ExclamationCircleSolid class="h-4 w-4 text-red-500 dark:text-red-400" />
			{:else if summary.running > 0}
				<div
					aria-hidden="true"
					class="h-4 w-4 animate-spin rounded-full border-2 border-blue-500/40 border-t-blue-500"
				></div>
			{:else if summary.done === summary.total}
				<CheckCircleSolid class="h-4 w-4 text-green-500 dark:text-green-400" />
			{:else}
				<CodePullRequestSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
			{/if}
			<span class="text-sm font-semibold text-gray-900 dark:text-white">
				Deployment Pipeline
			</span>
		</div>
		<div class="flex items-center gap-3">
			{#if !isAutoSelected}
				<button
					type="button"
					onclick={jumpToLive}
					class="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
				>
					Jump to live
				</button>
			{/if}
			{#if summary.failed > 0}
				<span class="text-xs font-semibold text-red-600 dark:text-red-400">
					{summary.failed} failed · {summary.done}/{summary.total} done
				</span>
			{:else if summary.running > 0}
				<span class="text-xs font-medium text-blue-600 dark:text-blue-400">
					{summary.done}/{summary.total} done · active
				</span>
			{:else if summary.done === summary.total}
				<span class="text-xs font-medium text-green-600 dark:text-green-400">
					{summary.total}/{summary.total} done
				</span>
			{:else}
				<span class="text-xs text-gray-500 dark:text-gray-400">
					{summary.done}/{summary.total} done
				</span>
			{/if}
		</div>
	</div>

	<!-- ═══ Desktop: horizontal stepper + detail panel ═══ -->
	<div class="hidden md:block">
		<!-- Horizontal stepper -->
		<div class="border-b border-gray-200 dark:border-gray-700">
			<div class="overflow-x-auto">
				<ol class="mx-auto flex items-start px-4 pt-5 pb-4 sm:px-6" style="width: max-content;">
					{#each nodes as node, idx}
						{#if idx > 0}
							<li
								aria-hidden="true"
								class="mt-[18px] h-1 w-12 flex-shrink-0 rounded-full lg:w-16 {connectorBg(
									nodes[idx - 1].status,
									node.status
								)}"
							></li>
						{/if}
						<li class="flex-shrink-0">
							<button
								type="button"
								onclick={() => select(node.id)}
								aria-current={selectedId === node.id ? 'step' : undefined}
								class="group flex w-24 flex-col items-center gap-2 focus:outline-none lg:w-28"
							>
								<div class="relative">
									{#if selectedId === node.id}
										<span
											aria-hidden="true"
											class="absolute -inset-1 rounded-full ring-2 ring-blue-500 dark:ring-blue-400"
										></span>
									{/if}
									{#if node.isLive && node.status !== 'failed'}
										<span
											aria-hidden="true"
											class="absolute inset-0 animate-ping rounded-full opacity-40 {subDotBg(
												node.status
											)}"
										></span>
									{/if}
									<div
										class="relative z-10 flex h-10 w-10 items-center justify-center rounded-full shadow-sm transition-transform duration-150 group-hover:scale-105 {circleBg(
											node.status
										)}"
									>
										{@render nodeIcon(node.status, 'lg')}
									</div>
								</div>
								<div class="flex flex-col items-center gap-0.5">
									<span
										class="text-xs whitespace-nowrap transition-colors {selectedId === node.id
											? 'font-semibold text-gray-900 dark:text-white'
											: 'text-gray-500 group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-200'}"
									>
										{node.shortLabel}
									</span>
									{#if hasMultipleKRs && node.krName}
										<span class="max-w-[7rem] truncate font-mono text-[10px] text-gray-400 dark:text-gray-500">
											{node.krName}
										</span>
									{/if}
								</div>
							</button>
						</li>
					{/each}
				</ol>
			</div>
		</div>

		<!-- Detail panel -->
		{#if selectedNode}
			<div class="px-4 py-5 sm:px-6 sm:py-6">
				{@render detailPanel(selectedNode)}
			</div>
		{/if}
	</div>

	<!-- ═══ Mobile: vertical stepper with inline detail ═══ -->
	<div class="md:hidden">
		<ol class="relative">
			{#each nodes as node, idx}
				{@const isSelected = selectedId === node.id}
				<li class="relative">
					<!-- Vertical connector segments (above/below circle) -->
					{#if idx > 0}
						<div
							aria-hidden="true"
							class="absolute left-[27px] top-0 h-6 w-0.5 {verticalConnectorBg(
								nodes[idx - 1].status,
								node.status
							)}"
						></div>
					{/if}
					{#if idx < nodes.length - 1 && !isSelected}
						<div
							aria-hidden="true"
							class="absolute left-[27px] bottom-0 top-[2.75rem] w-0.5 {verticalConnectorBg(
								node.status,
								nodes[idx + 1].status
							)}"
						></div>
					{/if}

					<button
						type="button"
						onclick={() => select(node.id)}
						aria-current={isSelected ? 'step' : undefined}
						class="relative flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40 {isSelected
							? 'bg-gray-50 dark:bg-gray-700/30'
							: ''}"
					>
						<!-- Circle -->
						<div class="relative flex-shrink-0">
							{#if isSelected}
								<span
									aria-hidden="true"
									class="absolute -inset-0.5 rounded-full ring-2 ring-blue-500 dark:ring-blue-400"
								></span>
							{/if}
							{#if node.isLive && node.status !== 'failed'}
								<span
									aria-hidden="true"
									class="absolute inset-0 animate-ping rounded-full opacity-40 {subDotBg(
										node.status
									)}"
								></span>
							{/if}
							<div
								class="relative z-10 flex h-10 w-10 items-center justify-center rounded-full shadow-sm {circleBg(
									node.status
								)}"
							>
								{@render nodeIcon(node.status, 'lg')}
							</div>
						</div>

						<!-- Label + status -->
						<div class="flex min-w-0 flex-1 flex-col gap-0.5">
							<div class="flex items-center justify-between gap-2">
								<div class="flex min-w-0 items-center gap-2">
									<span
										class="truncate text-sm {isSelected
											? 'font-semibold text-gray-900 dark:text-white'
											: 'font-medium text-gray-700 dark:text-gray-200'}"
									>
										{node.shortLabel}
									</span>
									{#if node.isLive}
										<span
											class="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800/60"
										>
											Live
										</span>
									{/if}
								</div>
								<span
									class="inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset {pillClasses(
										node.status
									)}"
								>
									{node.statusLabel}
								</span>
							</div>
							{#if hasMultipleKRs && node.krName}
								<span class="truncate font-mono text-[10px] text-gray-400 dark:text-gray-500">
									{node.krName}
								</span>
							{/if}
						</div>
					</button>

					<!-- Inline detail panel -->
					{#if isSelected}
						<div class="relative">
							<!-- Continue vertical line through the detail content -->
							{#if idx < nodes.length - 1}
								<div
									aria-hidden="true"
									class="absolute left-[27px] top-0 bottom-0 w-0.5 {verticalConnectorBg(
										node.status,
										nodes[idx + 1].status
									)}"
								></div>
							{/if}
							<div class="px-4 pb-5 pl-[60px]">
								{@render detailPanel(node)}
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ol>
	</div>
</div>
