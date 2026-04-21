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
		if (days > 0) return `${days}d ${hours % 24}h`;
		if (hours > 0) return `${hours}h ${minutes % 60}m`;
		if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
		return `${seconds}s`;
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
		// for 'stage' kind
		krIndex?: number;
		stepIndex?: number;
		// convenience data
		stageData?: {
			kr: ValidKruiseRollout;
			stepNum: number;
			currentStepIndex: number | undefined;
			isKrCompleted: boolean;
			isKrStalled: boolean;
			isCurrentStep: boolean;
			isPastStep: boolean;
			isStepPaused: boolean;
			isStepReady: boolean;
			isStepRunning: boolean;
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

	let nodes = $derived<StageNode[]>(
		(() => {
			const result: StageNode[] = [];

			result.push({
				id: 'started',
				kind: 'started',
				shortLabel: 'Started',
				longLabel: 'Started',
				status: 'done',
				statusLabel: 'Started'
			});

			for (const [krIdx, kr] of pipelineValidRollouts.entries()) {
				for (const [stepIdx, _step] of kr.canarySteps.entries()) {
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
					const krName = kr.kruiseRollout?.metadata?.name;
					const stepTests = pipelineValidTests.filter(
						(t: RolloutTest) =>
							krName && t.spec?.rolloutName === krName && t.spec?.stepIndex === stepNum
					);
					const hasTests = stepTests.length > 0;
					const allTestsSucceeded =
						!hasTests ||
						stepTests.every((t: RolloutTest) => t.status?.phase === 'Succeeded');
					const bakingNow =
						isCurrentStep && isStepPaused && allTestsSucceeded && !isKrStalled;
					const stageTestsFailed =
						isCurrentStep && stepTests.some((t: RolloutTest) => t.status?.phase === 'Failed');
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
						krIndex: krIdx,
						stepIndex: stepIdx,
						stageData: {
							kr,
							stepNum,
							currentStepIndex,
							isKrCompleted,
							isKrStalled,
							isCurrentStep,
							isPastStep,
							isStepPaused,
							isStepReady,
							isStepRunning,
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
				bakeStatusLabel = 'Baked';
			} else if (bakeIsFailed) {
				bakeStatus = 'failed';
				bakeStatusLabel = 'Bake Failed';
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
				longLabel: bakeIsSucceeded ? 'Baked' : 'Bake',
				status: bakeStatus,
				statusLabel: bakeStatusLabel
			});

			return result;
		})()
	);

	// Default-select the most meaningful node: first non-done node (current work), else last (done).
	let autoSelectedId = $derived(
		(nodes.find((n) => n.status === 'running' || n.status === 'paused' || n.status === 'failed')?.id) ??
			nodes[nodes.length - 1]?.id ??
			'started'
	);

	let userSelectedId = $state<string | null>(null);
	let selectedId = $derived(userSelectedId ?? autoSelectedId);
	let selectedNode = $derived(nodes.find((n) => n.id === selectedId) ?? nodes[0]);

	function select(id: string) {
		userSelectedId = id;
	}

	function selectCurrent() {
		userSelectedId = null;
	}

	let isAutoSelected = $derived(userSelectedId === null);

	function nodeDotClasses(status: NodeStatus, selected: boolean): string {
		const base =
			'flex h-9 w-9 items-center justify-center rounded-full ring-2 transition-all duration-200';
		const color = {
			done: 'bg-green-100 ring-green-300 dark:bg-green-900/50 dark:ring-green-700',
			running: 'bg-blue-100 ring-blue-300 dark:bg-blue-900/50 dark:ring-blue-700',
			paused: 'bg-yellow-100 ring-yellow-300 dark:bg-yellow-900/50 dark:ring-yellow-700',
			failed: 'bg-red-100 ring-red-300 dark:bg-red-900/50 dark:ring-red-700',
			pending: 'bg-gray-100 ring-gray-300 dark:bg-gray-800 dark:ring-gray-600'
		}[status];
		const sel = selected
			? 'scale-110 ring-4 ring-offset-2 ring-offset-white dark:ring-offset-gray-800'
			: 'group-hover:scale-105';
		return `${base} ${color} ${sel}`;
	}

	function connectorClasses(fromStatus: NodeStatus, toStatus: NodeStatus): string {
		// Connector line between two nodes — colored by progress state
		if (fromStatus === 'failed' || toStatus === 'failed') {
			return 'bg-red-300 dark:bg-red-800';
		}
		if (fromStatus === 'done') {
			return 'bg-green-300 dark:bg-green-800';
		}
		if (fromStatus === 'running' || fromStatus === 'paused') {
			return 'bg-gradient-to-r from-blue-300 to-gray-200 dark:from-blue-700 dark:to-gray-700';
		}
		return 'bg-gray-200 dark:bg-gray-700';
	}

	function statusPillClasses(status: NodeStatus): string {
		return {
			done: 'bg-green-100 text-green-700 ring-green-200 dark:bg-green-900/40 dark:text-green-300 dark:ring-green-800',
			running:
				'bg-blue-100 text-blue-700 ring-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:ring-blue-800',
			paused:
				'bg-yellow-100 text-yellow-700 ring-yellow-200 dark:bg-yellow-900/40 dark:text-yellow-300 dark:ring-yellow-800',
			failed: 'bg-red-100 text-red-700 ring-red-200 dark:bg-red-900/40 dark:text-red-300 dark:ring-red-800',
			pending: 'bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700'
		}[status];
	}

	function subRowClasses(status: NodeStatus): string {
		return {
			done: 'bg-green-100 ring-green-200 dark:bg-green-900/40 dark:ring-green-800',
			running: 'bg-blue-100 ring-blue-200 dark:bg-blue-900/40 dark:ring-blue-800',
			paused: 'bg-yellow-100 ring-yellow-200 dark:bg-yellow-900/40 dark:ring-yellow-800',
			failed: 'bg-red-100 ring-red-200 dark:bg-red-900/40 dark:ring-red-800',
			pending: 'bg-gray-100 ring-gray-200 dark:bg-gray-700 dark:ring-gray-600'
		}[status];
	}

	function subTextClasses(status: NodeStatus): string {
		return {
			done: 'text-green-600 dark:text-green-400',
			running: 'text-blue-600 dark:text-blue-400',
			paused: 'text-yellow-600 dark:text-yellow-400',
			failed: 'text-red-600 dark:text-red-400',
			pending: 'text-gray-400 dark:text-gray-500'
		}[status];
	}

	function rolloutSubStatus(sd: NonNullable<StageNode['stageData']>): NodeStatus {
		if (sd.rolloutFailed || sd.stageTestsFailed) return 'failed';
		if (sd.rolloutDone) return 'done';
		if (sd.rolloutRunning) return 'running';
		return 'pending';
	}

	function testsSubStatus(sd: NonNullable<StageNode['stageData']>): {
		status: NodeStatus;
		label: string;
	} {
		const anyFailed = sd.stepTests.some((t) => t.status?.phase === 'Failed');
		const anyRunning = sd.stepTests.some((t) => t.status?.phase === 'Running');
		const anyPending = sd.stepTests.some((t) =>
			['Pending', 'Unknown'].includes(t.status?.phase || '')
		);
		const done = sd.isPastStep || (sd.isCurrentStep && sd.isStepPaused && sd.allTestsSucceeded);
		if (anyFailed) return { status: 'failed', label: 'Failed' };
		if (done) return { status: 'done', label: 'Done' };
		if (anyRunning) return { status: 'running', label: 'Running' };
		if (anyPending) return { status: 'paused', label: 'Pending' };
		return { status: 'pending', label: 'Pending' };
	}

	function bakeSubStatus(sd: NonNullable<StageNode['stageData']>): {
		status: NodeStatus;
		label: string;
	} {
		if (sd.bakeFailed) return { status: 'failed', label: 'Failed' };
		if (sd.bakeDone) return { status: 'done', label: 'Done' };
		if (sd.bakingNow) return { status: 'paused', label: 'In progress' };
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
</script>

<div
	class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
>
	<!-- Header -->
	<div class="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
		<h5 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
			<CodePullRequestSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
			Deployment Pipeline
		</h5>
		{#if !isAutoSelected}
			<button
				type="button"
				onclick={selectCurrent}
				class="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
			>
				Jump to current
			</button>
		{/if}
	</div>

	<!-- Stepper -->
	<div class="border-b border-gray-200 px-4 pt-4 pb-2 dark:border-gray-700">
		<div class="overflow-x-auto pb-2">
			<ol class="flex min-w-max items-start gap-0">
				{#each nodes as node, idx}
					{#if idx > 0}
						<li class="mt-[17px] h-0.5 min-w-[32px] flex-1 {connectorClasses(nodes[idx - 1].status, node.status)}"></li>
					{/if}
					<li class="flex flex-col items-center">
						<button
							type="button"
							class="group flex flex-col items-center gap-1.5 px-1 focus:outline-none"
							aria-current={selectedId === node.id ? 'step' : undefined}
							onclick={() => select(node.id)}
						>
							<div class={nodeDotClasses(node.status, selectedId === node.id)}>
								{#if node.status === 'done'}
									<CheckCircleSolid class="h-4 w-4 text-green-600 dark:text-green-400" />
								{:else if node.status === 'failed'}
									<ExclamationCircleSolid class="h-4 w-4 text-red-600 dark:text-red-400" />
								{:else if node.status === 'running'}
									<Spinner size="4" color="blue" />
								{:else if node.status === 'paused'}
									<Spinner size="4" color="yellow" />
								{:else if node.kind === 'started'}
									<ClockSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
								{:else}
									<ClockSolid class="h-4 w-4 text-gray-400 dark:text-gray-500" />
								{/if}
							</div>
							<span
								class="text-xs whitespace-nowrap {selectedId === node.id
									? 'font-semibold text-gray-900 dark:text-white'
									: 'text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-300'}"
							>
								{node.shortLabel}
							</span>
						</button>
					</li>
				{/each}
			</ol>
		</div>
	</div>

	<!-- Detail Panel -->
	{#if selectedNode}
		<div class="px-4 py-5 sm:px-6">
			<!-- Title row -->
			<div class="mb-4 flex flex-wrap items-center gap-3">
				<h6 class="text-base font-semibold text-gray-900 dark:text-white">
					{selectedNode.longLabel}
				</h6>
				<span
					class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {statusPillClasses(
						selectedNode.status
					)}"
				>
					{selectedNode.statusLabel}
				</span>
				{#if selectedNode.kind === 'started' && latestEntry.timestamp}
					<span class="text-xs text-gray-500 dark:text-gray-400">
						{formatTimeAgo(latestEntry.timestamp, $now)}
					</span>
				{/if}
				{#if selectedNode.kind === 'bake' && bakeIsSucceeded && latestEntry.bakeEndTime}
					<span class="text-xs text-gray-500 dark:text-gray-400">
						{formatTimeAgo(latestEntry.bakeEndTime, $now)} ·
						{formatDuration(
							latestEntry.bakeStartTime || latestEntry.timestamp,
							new Date(latestEntry.bakeEndTime)
						)}
					</span>
				{:else if selectedNode.kind === 'bake' && bakeIsFailed && latestEntry.bakeEndTime}
					<span class="text-xs text-gray-500 dark:text-gray-400">
						{formatTimeAgo(latestEntry.bakeEndTime, $now)}
					</span>
				{:else if selectedNode.kind === 'bake' && !bakeIsSucceeded && !bakeIsFailed && rollout.spec?.deployTimeout && !bakeIsDeploying && !bakeIsInProgress}
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

			<!-- Started details -->
			{#if selectedNode.kind === 'started'}
				{#if latestEntry.message}
					<div class="mb-3 border-l-2 border-gray-300 pl-3 dark:border-gray-600">
						<p class="text-sm italic text-gray-600 dark:text-gray-300">
							{latestEntry.message}
						</p>
					</div>
				{/if}
				{#if latestEntry.triggeredBy}
					<div class="inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
						{#if latestEntry.triggeredBy.kind === 'User'}
							<UserSolid class="h-3 w-3 flex-shrink-0" />
							<span>Triggered by <span class="font-medium text-gray-700 dark:text-gray-300">{latestEntry.triggeredBy.name}</span></span>
						{:else}
							<CogSolid class="h-3 w-3 flex-shrink-0" />
							<span>Triggered by System</span>
						{/if}
					</div>
				{/if}
				{#if !latestEntry.message && !latestEntry.triggeredBy}
					<p class="text-sm text-gray-500 dark:text-gray-400">
						Deployment initiated{#if latestEntry.timestamp}
							at {new Date(latestEntry.timestamp).toLocaleString()}{/if}.
					</p>
				{/if}
			{/if}

			<!-- Stage details -->
			{#if selectedNode.kind === 'stage' && selectedNode.stageData}
				{@const sd = selectedNode.stageData}
				{@const rolloutSub = rolloutSubStatus(sd)}
				{@const testsSub = testsSubStatus(sd)}
				{@const bakeSub = bakeSubStatus(sd)}

				<div class="grid gap-3 sm:grid-cols-2">
					<!-- Rollout sub -->
					<div class="rounded-md border border-gray-200 p-3 dark:border-gray-700">
						<div class="flex items-center gap-2">
							<div
								class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1 {subRowClasses(
									rolloutSub
								)}"
							>
								{#if rolloutSub === 'failed'}
									<ExclamationCircleSolid class="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
								{:else if rolloutSub === 'done'}
									<CheckCircleSolid class="h-2.5 w-2.5 text-green-600 dark:text-green-400" />
								{:else if rolloutSub === 'running'}
									<Spinner size="4" color="blue" />
								{:else}
									<ClockSolid class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500" />
								{/if}
							</div>
							<span class="text-sm font-medium text-gray-700 dark:text-gray-200">Rollout</span>
							<span class="ml-auto text-xs {subTextClasses(rolloutSub)}">
								{rolloutSub === 'failed'
									? 'Failed'
									: rolloutSub === 'done'
										? 'Done'
										: rolloutSub === 'running'
											? 'Rolling'
											: 'Pending'}
							</span>
						</div>
					</div>

					<!-- Bake sub (only if not last step) -->
					{#if !sd.isLastStep}
						<div class="rounded-md border border-gray-200 p-3 dark:border-gray-700">
							<div class="flex items-center gap-2">
								<div
									class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1 {subRowClasses(
										bakeSub.status
									)}"
								>
									{#if bakeSub.status === 'failed'}
										<ExclamationCircleSolid class="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
									{:else if bakeSub.status === 'done'}
										<CheckCircleSolid class="h-2.5 w-2.5 text-green-600 dark:text-green-400" />
									{:else if bakeSub.status === 'paused'}
										<Spinner size="4" color="yellow" />
									{:else}
										<ClockSolid class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500" />
									{/if}
								</div>
								<span class="text-sm font-medium text-gray-700 dark:text-gray-200">Bake</span>
								<span class="ml-auto text-xs {subTextClasses(bakeSub.status)}">
									{bakeSub.label}
								</span>
							</div>
							{#if sd.bakingNow}
								{@const ann = sd.kr.kruiseRollout?.metadata?.annotations || {}}
								{@const bakeTimeKey = `rollout.kuberik.io/step-${sd.stepNum}-bake-time`}
								{@const readyAtKey = `internal.rollout.kuberik.io/step-${sd.stepNum}-ready-at`}
								{@const stepBakeTime = ann[bakeTimeKey]}
								{@const stepReadyAt = ann[readyAtKey]}
								{#if stepReadyAt}
									{@const readyAtMs = new Date(stepReadyAt).getTime()}
									{@const elapsed = $now.getTime() - readyAtMs}
									{@const bakeTimeMs = stepBakeTime ? parseDuration(stepBakeTime) : 0}
									{@const remainingBake =
										bakeTimeMs > 0 ? Math.max(0, bakeTimeMs - elapsed) : 0}
									{#if bakeTimeMs > 0}
										{@const bakeProgress = Math.min(100, (elapsed / bakeTimeMs) * 100)}
										<div class="mt-2">
											<div class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
												<div
													class="h-full rounded-full bg-yellow-400 transition-all duration-300 dark:bg-yellow-500"
													style="width: {bakeProgress}%"
												></div>
											</div>
											<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
												{remainingBake > 0 ? formatDurationFromMs(remainingBake) + ' left' : 'Ready'}
											</p>
										</div>
									{/if}
								{/if}
							{/if}
						</div>
					{/if}

					<!-- Tests sub (full width) -->
					{#if sd.hasTests}
						<div class="rounded-md border border-gray-200 p-3 sm:col-span-2 dark:border-gray-700">
							<div class="flex items-center gap-2">
								<div
									class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1 {subRowClasses(
										testsSub.status
									)}"
								>
									{#if testsSub.status === 'failed'}
										<ExclamationCircleSolid class="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
									{:else if testsSub.status === 'done'}
										<CheckCircleSolid class="h-2.5 w-2.5 text-green-600 dark:text-green-400" />
									{:else if testsSub.status === 'running'}
										<Spinner size="4" color="blue" />
									{:else if testsSub.status === 'paused'}
										<ClockArrowOutline class="h-2.5 w-2.5 text-yellow-500 dark:text-yellow-400" />
									{:else}
										<ClockSolid class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500" />
									{/if}
								</div>
								<span class="text-sm font-medium text-gray-700 dark:text-gray-200">
									Tests
									<span class="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
										({sd.stepTests.length})
									</span>
								</span>
								<span class="ml-auto text-xs {subTextClasses(testsSub.status)}">
									{testsSub.label}
								</span>
							</div>
							<ul class="mt-2 flex flex-col gap-1">
								{#each sd.stepTests as test}
									{#if test.metadata}
										{@const phase = test.status?.phase || 'Unknown'}
										{@const retryCount = test.status?.retryCount || 0}
										{@const linkAnnotations = parseLinkAnnotations(test.metadata.annotations)}
										{@const ddInfo = extractDatadogInfoFromContainers(
											test.spec?.jobTemplate?.template?.spec?.containers || []
										)}
										<li class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
											<Tooltip
												class="z-50"
												placement="top"
												triggeredBy={'#pipe-test-' + test.metadata.name}
											>
												{phase}{retryCount > 0
													? ` (${retryCount} retr${retryCount === 1 ? 'y' : 'ies'})`
													: ''}
											</Tooltip>
											<span
												id={'pipe-test-' + test.metadata.name}
												class="flex items-center gap-1"
											>
												{#if phase === 'Running'}
													<Spinner size="4" color="blue" />
												{:else if phase === 'Succeeded'}
													<CheckCircleSolid class="h-3 w-3 text-green-500 dark:text-green-400" />
												{:else if phase === 'Failed'}
													<ExclamationCircleSolid class="h-3 w-3 text-red-500 dark:text-red-400" />
												{:else if phase === 'Cancelled'}
													<CircleMinusSolid class="h-3 w-3 text-gray-400 dark:text-gray-500" />
												{:else if phase === 'Pending'}
													<ClockArrowOutline class="h-3 w-3 text-yellow-500 dark:text-yellow-400" />
												{:else}
													<ClockSolid class="h-3 w-3 text-gray-400 dark:text-gray-500" />
												{/if}
												<span class="text-xs text-gray-700 dark:text-gray-300">
													{test.metadata.name}{retryCount > 0 ? ` (retry ${retryCount})` : ''}
												</span>
											</span>
											{#if phase === 'Failed'}
												<a
													href="/rollouts/{namespace}/{name}/logs?tab=tests"
													class="text-xs text-blue-600 hover:underline dark:text-blue-400"
												>
													Logs
												</a>
											{/if}
											{#each linkAnnotations as link}
												<a
													href={link.url}
													target="_blank"
													rel="noopener noreferrer"
													class="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
												>
													{link.label}<ArrowUpRightFromSquareOutline class="h-2.5 w-2.5" />
												</a>
											{/each}
											{#if ddInfo}
												<a
													href={buildDatadogLogsUrl(ddInfo.service, ddInfo.env)}
													target="_blank"
													rel="noopener noreferrer"
													class="inline-flex items-center gap-0.5 text-xs text-purple-600 hover:underline dark:text-purple-400"
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
													class="inline-flex items-center gap-0.5 text-xs text-purple-600 hover:underline dark:text-purple-400"
												>
													<DatadogLogo class="h-2.5 w-2.5" />CI
												</a>
											{/if}
										</li>
									{/if}
								{/each}
							</ul>
						</div>
					{/if}
				</div>

				{#if sd.isCurrentStep && canUpdate}
					<div class="mt-4">
						<Button
							size="xs"
							color="blue"
							disabled={!sd.isStepPaused}
							onclick={() =>
								onContinue(sd.kr.rolloutResource.name, sd.kr.rolloutResource.namespace)}
						>
							<PlaySolid class="mr-1.5 h-3 w-3" />Continue
						</Button>
					</div>
				{/if}
			{/if}

			<!-- Bake (final) details -->
			{#if selectedNode.kind === 'bake'}
				<div class="flex items-center gap-2 pb-3 text-xs text-gray-500 dark:text-gray-400">
					<span id="bake-help-icon">
						<QuestionCircleOutline class="h-3.5 w-3.5 cursor-help" />
					</span>
					<Tooltip triggeredBy="#bake-help-icon" placement="top" class="max-w-xs text-xs">
						After deployment, the new version bakes in production for a configured period. Health
						checks are monitored during this time. If all checks pass throughout the bake window,
						the deployment is marked as successful.
					</Tooltip>
					<span>Final bake window. Health checks are monitored before marking the deployment successful.</span>
				</div>
				{#if latestEntry.bakeStatusMessage}
					<p class="mb-3 text-sm italic text-gray-500 dark:text-gray-400">
						{latestEntry.bakeStatusMessage}
					</p>
				{/if}

				{#if bakeIsDeploying || bakeIsInProgress || bakeIsFailed}
					<div class="grid gap-3 sm:grid-cols-2">
						<!-- Health checks sub -->
						{#if hasHCSelector}
							<div class="rounded-md border border-gray-200 p-3 dark:border-gray-700">
								<div class="flex items-center gap-2">
									<div
										class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1 {subRowClasses(
											finalHCStatus.status
										)}"
									>
										{#if finalHCStatus.status === 'failed'}
											<ExclamationCircleSolid class="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
										{:else if finalHCStatus.status === 'done'}
											<CheckCircleSolid class="h-2.5 w-2.5 text-green-600 dark:text-green-400" />
										{:else if finalHCStatus.status === 'running'}
											<Spinner size="4" color="blue" />
										{:else}
											<ClockSolid class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500" />
										{/if}
									</div>
									<span class="text-sm font-medium text-gray-700 dark:text-gray-200">
										Health checks
									</span>
									<span class="ml-auto text-xs {subTextClasses(finalHCStatus.status)}">
										{finalHCStatus.label}
									</span>
								</div>
								{#if bakeIsFailed && (latestEntry.failedHealthChecks?.length ?? 0) > 0}
									<div class="mt-2 flex flex-col gap-1">
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
							</div>
						{/if}

						<!-- Bake timer sub -->
						<div class="rounded-md border border-gray-200 p-3 dark:border-gray-700">
							<div class="flex items-center gap-2">
								<div
									class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1 {subRowClasses(
										finalBakeTimerStatus.status
									)}"
								>
									{#if finalBakeTimerStatus.status === 'failed'}
										<ExclamationCircleSolid class="h-2.5 w-2.5 text-red-600 dark:text-red-400" />
									{:else if finalBakeTimerStatus.status === 'done'}
										<CheckCircleSolid class="h-2.5 w-2.5 text-green-600 dark:text-green-400" />
									{:else if finalBakeTimerStatus.status === 'paused'}
										<Spinner size="4" color="yellow" />
									{:else}
										<ClockSolid class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500" />
									{/if}
								</div>
								<span class="text-sm font-medium text-gray-700 dark:text-gray-200">Bake timer</span>
								<span class="ml-auto text-xs {subTextClasses(finalBakeTimerStatus.status)}">
									{finalBakeTimerStatus.label}
								</span>
							</div>
							{#if bakeIsInProgress && latestEntry.bakeStartTime && rollout.spec?.bakeTime}
								{@const bakeStartMs = new Date(latestEntry.bakeStartTime).getTime()}
								{@const elapsedMs = $now.getTime() - bakeStartMs}
								{@const totalMs = parseDuration(rollout.spec.bakeTime)}
								{@const bakeProgressVal =
									totalMs > 0 ? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100)) : 0}
								{@const remainingBakeMs = Math.max(0, totalMs - elapsedMs)}
								<div class="mt-2">
									<div
										class="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
									>
										<div
											class="h-full rounded-full bg-yellow-400 transition-all duration-300 dark:bg-yellow-500"
											style="width: {bakeProgressVal}%"
										></div>
									</div>
									<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
										{remainingBakeMs > 0
											? formatDurationFromMs(remainingBakeMs) + ' left'
											: 'Finishing...'}
									</p>
								</div>
							{/if}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>
