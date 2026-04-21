<script lang="ts">
	import { Button, Spinner, Timeline, TimelineItem, Tooltip } from 'flowbite-svelte';
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
	let showHCSubComponent = $derived(hasHCSelector);
	let hcSubDone = $derived(bakeIsInProgress || bakeIsSucceeded || (bakeIsFailed && allHCHealthy));
	let hcSubFailed = $derived(bakeIsFailed && !allHCHealthy);
	let hcSubWaiting = $derived(bakeIsDeploying && !allHCHealthy);
	let bakeTimerDone = $derived(bakeIsSucceeded);
	let bakeTimerRunning = $derived(bakeIsInProgress);
	let bakeTimerFailed = $derived(bakeIsFailed && allHCHealthy);
</script>

<div
	class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
>
	<div class="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
		<h5 class="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
			<CodePullRequestSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
			Deployment Pipeline
		</h5>
	</div>
	<div class="px-4 py-4">
		<Timeline order="horizontal" class="items-start">
			<TimelineItem
				order="horizontal"
				title=""
				date=""
				class="mb-0 flex min-w-0 flex-1 sm:block"
			>
				{#snippet orientationSlot()}
					<div class="mr-3 flex flex-col items-center sm:mr-0 sm:w-full sm:flex-row">
						<div
							class="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-200 ring-0 ring-white sm:ring-8 dark:bg-blue-900 dark:ring-gray-800"
						>
							<ClockSolid class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
						</div>
						<div
							class="min-h-4 w-0.5 flex-1 bg-gray-200 sm:h-0.5 sm:min-h-0 sm:w-full dark:bg-gray-700"
						></div>
					</div>
				{/snippet}
				<div class="min-w-0 flex-1 pt-0.5 pb-6 sm:pt-2 sm:pr-6 sm:pb-0">
					<p class="text-sm font-semibold text-gray-900 dark:text-white">Started</p>
					<p class="text-xs text-gray-500 dark:text-gray-400">
						{formatTimeAgo(latestEntry.timestamp, $now)}
					</p>
					{#if latestEntry.message || latestEntry.triggeredBy}
						<div class="mt-1.5">
							{#if latestEntry.message}
								<div class="border-l-2 border-gray-600 pl-2 dark:border-gray-500">
									<p class="text-xs text-gray-400 italic dark:text-gray-400">
										{latestEntry.message}
									</p>
								</div>
							{/if}
							{#if latestEntry.triggeredBy}
								<div class="mt-1 flex justify-end pr-2">
									<span
										class="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-500"
									>
										{#if latestEntry.triggeredBy.kind === 'User'}
											<UserSolid class="h-2.5 w-2.5 flex-shrink-0" />
											<span>{latestEntry.triggeredBy.name}</span>
										{:else}
											<CogSolid class="h-2.5 w-2.5 flex-shrink-0" />
											<span>System</span>
										{/if}
									</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</TimelineItem>

			{#each pipelineValidRollouts as kr}
				{#each kr.canarySteps as _step, stepIdx}
					{@const stepNum = stepIdx + 1}
					{@const currentStepIndex = kr.rolloutData.currentStepIndex}
					{@const isKrCompleted = kr.isCompleted}
					{@const isKrStalled = kr.kruiseRollout?.status?.conditions?.some(
						(c) => c.type === 'Stalled' && c.status === 'True'
					)}
					{@const isCurrentStep = currentStepIndex === stepNum}
					{@const isPastStep =
						isKrCompleted ||
						(currentStepIndex !== undefined && stepNum < currentStepIndex)}
					{@const isStepPaused =
						isCurrentStep && kr.rolloutData.currentStepState === 'StepPaused'}
					{@const isStepReady =
						isCurrentStep && kr.rolloutData.currentStepState === 'StepReady'}
					{@const isStepRunning =
						isCurrentStep &&
						!isStepPaused &&
						!isStepReady &&
						kr.rolloutData.currentStepState !== 'Completed' &&
						!isKrStalled}
					{@const rolloutDone =
						isPastStep || (isCurrentStep && (isStepPaused || isStepReady))}
					{@const rolloutRunning = isStepRunning}
					{@const rolloutFailed = isKrStalled && isCurrentStep && !isStepPaused}
					{@const bakeDone = isPastStep}
					{@const waitingForBake = isCurrentStep && isStepReady}
					{@const krName = kr.kruiseRollout?.metadata?.name}
					{@const krTests = pipelineValidTests.filter(
						(t: RolloutTest) => krName && t.spec?.rolloutName === krName
					)}
					{@const stepTests = krTests.filter(
						(t: RolloutTest) => t.spec?.stepIndex === stepNum
					)}
					{@const hasTests = stepTests.length > 0}
					{@const allTestsSucceeded =
						!hasTests ||
						stepTests.every((t: RolloutTest) => t.status?.phase === 'Succeeded')}
					{@const bakingNow =
						isCurrentStep && isStepPaused && allTestsSucceeded && !isKrStalled}
					{@const stageTestsFailed =
						isCurrentStep && stepTests.some((t: RolloutTest) => t.status?.phase === 'Failed')}
					{@const bakeFailed =
						isKrStalled && isCurrentStep && isStepPaused && !stageTestsFailed}
					{@const isLastStep = stepIdx === kr.canarySteps.length - 1}
					<TimelineItem
						order="horizontal"
						title=""
						date=""
						class="mb-0 flex min-w-0 flex-1 sm:block"
					>
						{#snippet orientationSlot()}
							<div
								class="mr-3 flex flex-col items-center sm:mr-0 sm:w-full sm:flex-row"
							>
								<div
									class="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-0 ring-white sm:ring-8 dark:ring-gray-800
											{rolloutFailed || stageTestsFailed || bakeFailed
										? 'bg-red-200 dark:bg-red-900'
										: isPastStep
											? 'bg-green-200 dark:bg-green-900'
											: isCurrentStep && bakingNow
												? 'bg-yellow-200 dark:bg-yellow-900'
												: isCurrentStep
													? 'bg-blue-200 dark:bg-blue-900'
													: 'bg-gray-200 dark:bg-gray-700'}"
								>
									{#if rolloutFailed || stageTestsFailed || bakeFailed}
										<ExclamationCircleSolid
											class="h-3.5 w-3.5 text-red-600 dark:text-red-400"
										/>
									{:else if isPastStep}
										<CheckCircleSolid
											class="h-3.5 w-3.5 text-green-600 dark:text-green-400"
										/>
									{:else if isCurrentStep && bakingNow}
										<Spinner size="4" color="yellow" />
									{:else if isCurrentStep}
										<Spinner size="4" color="blue" />
									{:else}
										<ClockSolid class="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
									{/if}
								</div>
								<div
									class="min-h-4 w-0.5 flex-1 bg-gray-200 sm:h-0.5 sm:min-h-0 sm:w-full dark:bg-gray-700"
								></div>
							</div>
						{/snippet}
						<div class="min-w-0 flex-1 pt-0.5 pb-6 sm:pt-2 sm:pr-6 sm:pb-0">
							{#if isCurrentStep}
								{@const stageAllDone =
									rolloutDone && allTestsSucceeded && !bakingNow && !waitingForBake && !bakeFailed}
								<p
									class="text-sm font-semibold {rolloutFailed || stageTestsFailed || bakeFailed
										? 'text-red-700 dark:text-red-400'
										: 'text-gray-900 dark:text-white'}"
								>
									Stage {stepNum}
									<span
										class="font-normal {rolloutFailed || stageTestsFailed || bakeFailed
											? 'text-red-600 dark:text-red-400'
											: stageAllDone
												? 'text-green-600 dark:text-green-400'
												: bakingNow || waitingForBake
													? 'text-yellow-600 dark:text-yellow-400'
													: 'text-blue-600 dark:text-blue-400'}"
									>
										· {rolloutFailed || stageTestsFailed || bakeFailed
											? 'Failed'
											: stageAllDone
												? 'Done'
												: bakingNow
													? 'Baking'
													: waitingForBake
														? 'Waiting'
														: 'In Progress'}
									</span>
								</p>
								{#if !stageAllDone}
									<div class="mt-2 space-y-2">
										<div class="flex items-center gap-2">
											<div
												class="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1
													{rolloutFailed || stageTestsFailed
													? 'bg-red-100 ring-red-200 dark:bg-red-900/40 dark:ring-red-800'
													: rolloutDone
														? 'bg-green-100 ring-green-200 dark:bg-green-900/40 dark:ring-green-800'
														: rolloutRunning
															? 'bg-blue-100 ring-blue-200 dark:bg-blue-900/40 dark:ring-blue-800'
															: 'bg-gray-100 ring-gray-200 dark:bg-gray-700 dark:ring-gray-600'}"
											>
												{#if rolloutFailed || stageTestsFailed}
													<ExclamationCircleSolid
														class="h-2.5 w-2.5 text-red-600 dark:text-red-400"
													/>
												{:else if rolloutDone}
													<CheckCircleSolid
														class="h-2.5 w-2.5 text-green-600 dark:text-green-400"
													/>
												{:else if rolloutRunning}
													<Spinner size="4" color="blue" />
												{:else}
													<ClockSolid
														class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500"
													/>
												{/if}
											</div>
											<span class="text-xs text-gray-600 dark:text-gray-400"
												>Rollout
												<span
													class={rolloutFailed || stageTestsFailed
														? 'text-red-600 dark:text-red-400'
														: rolloutDone
															? 'text-green-600 dark:text-green-400'
															: rolloutRunning
																? 'text-blue-600 dark:text-blue-400'
																: 'text-gray-400 dark:text-gray-500'}
													>· {rolloutFailed || stageTestsFailed
														? 'Failed'
														: rolloutDone
															? 'Done'
															: rolloutRunning
																? 'Rolling'
																: 'Pending'}</span
												>
											</span>
										</div>

										{#if hasTests}
											{@const anyTestFailed = stepTests.some(
												(t: RolloutTest) => t.status?.phase === 'Failed'
											)}
											{@const anyTestRunning = stepTests.some(
												(t: RolloutTest) => t.status?.phase === 'Running'
											)}
											{@const anyTestPending = stepTests.some((t: RolloutTest) =>
												['Pending', 'Unknown'].includes(t.status?.phase || '')
											)}
											{@const testsDone =
												isPastStep ||
												(isCurrentStep && isStepPaused && allTestsSucceeded)}
											{@const testsFailed = anyTestFailed}
											{@const testsRunning =
												!testsDone && !testsFailed && anyTestRunning}
											<div class="flex items-start gap-2">
												<div
													class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1
														{testsFailed
														? 'bg-red-100 ring-red-200 dark:bg-red-900/40 dark:ring-red-800'
														: testsDone
															? 'bg-green-100 ring-green-200 dark:bg-green-900/40 dark:ring-green-800'
															: testsRunning
																? 'bg-blue-100 ring-blue-200 dark:bg-blue-900/40 dark:ring-blue-800'
																: anyTestPending
																	? 'bg-yellow-100 ring-yellow-200 dark:bg-yellow-900/40 dark:ring-yellow-800'
																	: 'bg-gray-100 ring-gray-200 dark:bg-gray-700 dark:ring-gray-600'}"
												>
													{#if testsFailed}
														<ExclamationCircleSolid
															class="h-2.5 w-2.5 text-red-600 dark:text-red-400"
														/>
													{:else if testsDone}
														<CheckCircleSolid
															class="h-2.5 w-2.5 text-green-600 dark:text-green-400"
														/>
													{:else if testsRunning}
														<Spinner size="4" color="blue" />
													{:else if anyTestPending}
														<ClockArrowOutline
															class="h-2.5 w-2.5 text-yellow-500 dark:text-yellow-400"
														/>
													{:else}
														<ClockSolid
															class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500"
														/>
													{/if}
												</div>
												<div class="min-w-0 flex-1">
													<span class="text-xs text-gray-600 dark:text-gray-400"
														>Tests
														<span
															class={testsFailed
																? 'text-red-600 dark:text-red-400'
																: testsDone
																	? 'text-green-600 dark:text-green-400'
																	: testsRunning
																		? 'text-blue-600 dark:text-blue-400'
																		: 'text-gray-400 dark:text-gray-500'}
															>· {testsFailed
																? 'Failed'
																: testsDone
																	? 'Done'
																	: testsRunning
																		? 'Running'
																		: 'Pending'}</span
														>
													</span>
													<div class="mt-0.5 flex flex-col gap-0.5">
														{#each stepTests as test}
															{#if test.metadata}
																{@const phase = test.status?.phase || 'Unknown'}
																{@const retryCount = test.status?.retryCount || 0}
																{@const linkAnnotations = parseLinkAnnotations(
																	test.metadata.annotations
																)}
																{@const ddInfo = extractDatadogInfoFromContainers(
																	test.spec?.jobTemplate?.template?.spec?.containers ||
																		[]
																)}
																<div
																	class="flex flex-wrap items-center gap-x-2 gap-y-0.5"
																>
																	<Tooltip
																		class="z-50"
																		placement="top"
																		triggeredBy={'#pipe-test-' + test.metadata.name}
																	>
																		{phase}{retryCount > 0
																			? ` (${retryCount} retr${retryCount === 1 ? 'y' : 'ies'})`
																			: ''}
																	</Tooltip>
																	<div
																		id={'pipe-test-' + test.metadata.name}
																		class="flex items-center gap-1"
																	>
																		{#if phase === 'Running'}
																			<Spinner size="4" color="blue" />
																		{:else if phase === 'Succeeded'}
																			<CheckCircleSolid
																				class="h-3 w-3 text-green-500 dark:text-green-400"
																			/>
																		{:else if phase === 'Failed'}
																			<ExclamationCircleSolid
																				class="h-3 w-3 text-red-500 dark:text-red-400"
																			/>
																		{:else if phase === 'Cancelled'}
																			<CircleMinusSolid
																				class="h-3 w-3 text-gray-400 dark:text-gray-500"
																			/>
																		{:else if phase === 'Pending'}
																			<ClockArrowOutline
																				class="h-3 w-3 text-yellow-500 dark:text-yellow-400"
																			/>
																		{:else}
																			<ClockSolid
																				class="h-3 w-3 text-gray-400 dark:text-gray-500"
																			/>
																		{/if}
																		<span
																			class="text-xs text-gray-600 dark:text-gray-400"
																			>{test.metadata.name}{retryCount > 0
																				? ` (retry ${retryCount})`
																				: ''}</span
																		>
																	</div>
																	{#if phase === 'Failed'}
																		<a
																			href="/rollouts/{namespace}/{name}/logs?tab=tests"
																			class="text-xs text-blue-600 hover:underline dark:text-blue-400"
																			>Logs</a
																		>
																	{/if}
																	{#each linkAnnotations as link}
																		<a
																			href={link.url}
																			target="_blank"
																			rel="noopener noreferrer"
																			class="inline-flex items-center gap-0.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
																		>
																			{link.label}<ArrowUpRightFromSquareOutline
																				class="h-2.5 w-2.5"
																			/>
																		</a>
																	{/each}
																	{#if ddInfo}
																		<a
																			href={buildDatadogLogsUrl(
																				ddInfo.service,
																				ddInfo.env
																			)}
																			target="_blank"
																			rel="noopener noreferrer"
																			class="inline-flex items-center gap-0.5 text-xs text-purple-600 hover:underline dark:text-purple-400"
																		>
																			<DatadogLogo class="h-2.5 w-2.5" />Logs
																		</a>
																		<a
																			href={buildDatadogTestRunsUrl(
																				ddInfo.service,
																				ddInfo.version ||
																					getDisplayVersion(latestEntry.version)
																			)}
																			target="_blank"
																			rel="noopener noreferrer"
																			class="inline-flex items-center gap-0.5 text-xs text-purple-600 hover:underline dark:text-purple-400"
																		>
																			<DatadogLogo class="h-2.5 w-2.5" />CI
																		</a>
																	{/if}
																</div>
															{/if}
														{/each}
													</div>
												</div>
											</div>
										{/if}

										{#if !isLastStep}
											<div class="flex items-start gap-2">
												<div
													class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1
													{bakeFailed
														? 'bg-red-100 ring-red-200 dark:bg-red-900/40 dark:ring-red-800'
														: bakeDone
															? 'bg-green-100 ring-green-200 dark:bg-green-900/40 dark:ring-green-800'
															: bakingNow
																? 'bg-yellow-100 ring-yellow-200 dark:bg-yellow-900/40 dark:ring-yellow-800'
																: 'bg-gray-100 ring-gray-200 dark:bg-gray-700 dark:ring-gray-600'}"
												>
													{#if bakeFailed}
														<ExclamationCircleSolid
															class="h-2.5 w-2.5 text-red-600 dark:text-red-400"
														/>
													{:else if bakeDone}
														<CheckCircleSolid
															class="h-2.5 w-2.5 text-green-600 dark:text-green-400"
														/>
													{:else if bakingNow}
														<Spinner size="4" color="yellow" />
													{:else}
														<ClockSolid
															class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500"
														/>
													{/if}
												</div>
												<div class="min-w-0 flex-1">
													{#if bakingNow}
														{@const ann = kr.kruiseRollout?.metadata?.annotations || {}}
														{@const bakeTimeKey = `rollout.kuberik.io/step-${stepNum}-bake-time`}
														{@const readyAtKey = `internal.rollout.kuberik.io/step-${stepNum}-ready-at`}
														{@const stepBakeTime = ann[bakeTimeKey]}
														{@const stepReadyAt = ann[readyAtKey]}
														<span class="text-xs text-gray-600 dark:text-gray-400"
															>Bake <span class="text-yellow-600 dark:text-yellow-400"
																>· In progress</span
															></span
														>
														{#if stepReadyAt}
															{@const readyAtMs = new Date(stepReadyAt).getTime()}
															{@const elapsed = $now.getTime() - readyAtMs}
															{@const bakeTimeMs = stepBakeTime
																? parseDuration(stepBakeTime)
																: 0}
															{@const remainingBake =
																bakeTimeMs > 0 ? Math.max(0, bakeTimeMs - elapsed) : 0}
															{#if bakeTimeMs > 0}
																{@const bakeProgress = Math.min(
																	100,
																	(elapsed / bakeTimeMs) * 100
																)}
																<div class="mt-1 w-28">
																	<div
																		class="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
																	>
																		<div
																			class="h-full rounded-full bg-yellow-400 transition-all duration-300 dark:bg-yellow-500"
																			style="width: {bakeProgress}%"
																		></div>
																	</div>
																	<p
																		class="mt-0.5 text-xs text-gray-400 dark:text-gray-500"
																	>
																		{remainingBake > 0
																			? formatDurationFromMs(remainingBake)
																			: 'Ready'}
																	</p>
																</div>
															{/if}
														{/if}
													{:else if bakeFailed}
														<span class="text-xs text-gray-600 dark:text-gray-400"
															>Bake <span class="text-red-600 dark:text-red-400"
																>· Failed</span
															></span
														>
													{:else}
														<span class="text-xs text-gray-600 dark:text-gray-400"
															>Bake <span
																class={bakeDone
																	? 'text-green-600 dark:text-green-400'
																	: 'text-gray-400 dark:text-gray-500'}
																>· {bakeDone ? 'Done' : 'Pending'}</span
															></span
														>
													{/if}
												</div>
											</div>
										{/if}
										{#if isCurrentStep && canUpdate}
											<div>
												<Button
													size="xs"
													color="blue"
													class="px-2 py-0.5 text-xs"
													disabled={!isStepPaused}
													onclick={() =>
														onContinue(
															kr.rolloutResource.name,
															kr.rolloutResource.namespace
														)}
												>
													<PlaySolid class="mr-1 h-2.5 w-2.5" />Continue
												</Button>
											</div>
										{/if}
									</div>
								{/if}
							{:else}
								<p
									class="text-sm {isPastStep
										? 'font-medium text-gray-700 dark:text-gray-300'
										: 'text-gray-400 dark:text-gray-500'}"
								>
									Stage {stepNum}
									<span
										class={isPastStep
											? 'text-green-600 dark:text-green-400'
											: 'text-gray-400 dark:text-gray-500'}
										>· {isPastStep ? 'Done' : 'Pending'}</span
									>
								</p>
							{/if}
						</div>
					</TimelineItem>
				{/each}
			{/each}

			<TimelineItem
				order="horizontal"
				isLast
				title=""
				date=""
				class="mb-0 flex min-w-0 flex-1 sm:block"
			>
				{#snippet orientationSlot()}
					<div class="mr-3 flex flex-col items-center sm:mr-0 sm:w-full sm:flex-row">
						<div
							class="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-0 ring-white sm:ring-8 dark:ring-gray-800
									{bakeIsSucceeded
								? 'bg-green-200 dark:bg-green-900'
								: bakeIsFailed
									? 'bg-red-200 dark:bg-red-900'
									: bakeIsInProgress
										? 'bg-yellow-200 dark:bg-yellow-900'
										: bakeIsDeploying
											? 'bg-blue-200 dark:bg-blue-900'
											: 'bg-gray-200 dark:bg-gray-700'}"
						>
							{#if bakeIsSucceeded}
								<CheckCircleSolid class="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
							{:else if bakeIsFailed}
								<ExclamationCircleSolid
									class="h-3.5 w-3.5 text-red-600 dark:text-red-400"
								/>
							{:else if bakeIsInProgress}
								<Spinner size="4" color="yellow" />
							{:else if bakeIsDeploying}
								<Spinner size="4" color="blue" />
							{:else}
								<ClockSolid class="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
							{/if}
						</div>
						<div class="hidden h-0.5 w-full bg-gray-200 sm:flex dark:bg-gray-700"></div>
					</div>
				{/snippet}
				<div class="min-w-0 flex-1 pt-0.5 sm:pt-2 sm:pr-6 sm:pb-0">
					<div class="flex items-center gap-1.5">
						<p
							id="bake-step-label"
							class="text-sm font-semibold
								{bakeIsFailed ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-white'}"
						>
							{bakeIsSucceeded
								? 'Baked'
								: bakeIsFailed
									? 'Bake Failed'
									: bakeIsInProgress
										? 'Baking'
										: bakeIsDeploying
											? 'Bake'
											: 'Bake'}
						</p>
						<span id="bake-help-icon">
							<QuestionCircleOutline
								class="h-3.5 w-3.5 cursor-help text-gray-400 dark:text-gray-500"
							/>
						</span>
						<Tooltip
							triggeredBy="#bake-help-icon"
							placement="top"
							class="max-w-xs text-xs"
						>
							After deployment, the new version bakes in production for a configured
							period. Health checks are monitored during this time. If all checks pass
							throughout the bake window, the deployment is marked as successful.
						</Tooltip>
					</div>

					{#if bakeIsSucceeded && latestEntry.bakeEndTime}
						<p class="text-xs text-gray-500 dark:text-gray-400">
							{formatTimeAgo(latestEntry.bakeEndTime, $now)}
						</p>
						<p class="text-xs text-gray-400 dark:text-gray-500">
							{formatDuration(
								latestEntry.bakeStartTime || latestEntry.timestamp,
								new Date(latestEntry.bakeEndTime)
							)}
						</p>
					{:else if bakeIsFailed && latestEntry.bakeEndTime}
						<p class="text-xs text-gray-500 dark:text-gray-400">
							{formatTimeAgo(latestEntry.bakeEndTime, $now)}
						</p>
					{:else if !bakeIsSucceeded && !bakeIsFailed && rollout.spec?.deployTimeout && !bakeIsDeploying && !bakeIsInProgress}
						<p class="text-xs text-gray-400 dark:text-gray-500">
							{(() => {
								const deploymentTime = new Date(latestEntry.timestamp).getTime();
								const timeoutMs = parseDuration(rollout.spec.deployTimeout);
								const timeUntilTimeout = deploymentTime + timeoutMs - $now.getTime();
								return timeUntilTimeout > 0
									? `Timeout in ${formatDurationFromMs(timeUntilTimeout)}`
									: 'Timed out';
							})()}
						</p>
					{/if}
					{#if latestEntry.bakeStatusMessage}
						<p class="mt-0.5 text-xs text-gray-400 italic dark:text-gray-500">
							{latestEntry.bakeStatusMessage}
						</p>
					{/if}

					{#if bakeIsDeploying || bakeIsInProgress}
						<div class="mt-2 space-y-2">
							{#if showHCSubComponent}
								<div class="flex items-start gap-2">
									<div
										class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1
												{hcSubFailed
											? 'bg-red-100 ring-red-200 dark:bg-red-900/40 dark:ring-red-800'
											: hcSubDone
												? 'bg-green-100 ring-green-200 dark:bg-green-900/40 dark:ring-green-800'
												: hcSubWaiting
													? 'bg-blue-100 ring-blue-200 dark:bg-blue-900/40 dark:ring-blue-800'
													: 'bg-gray-100 ring-gray-200 dark:bg-gray-700 dark:ring-gray-600'}"
									>
										{#if hcSubFailed}
											<ExclamationCircleSolid
												class="h-2.5 w-2.5 text-red-600 dark:text-red-400"
											/>
										{:else if hcSubDone}
											<CheckCircleSolid
												class="h-2.5 w-2.5 text-green-600 dark:text-green-400"
											/>
										{:else if hcSubWaiting}
											<Spinner size="4" color="blue" />
										{:else}
											<ClockSolid
												class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500"
											/>
										{/if}
									</div>
									<div class="min-w-0 flex-1">
										<span class="text-xs text-gray-600 dark:text-gray-400"
											>Health checks
											<span
												class={hcSubFailed
													? 'text-red-600 dark:text-red-400'
													: hcSubDone
														? 'text-green-600 dark:text-green-400'
														: hcSubWaiting
															? 'text-blue-600 dark:text-blue-400'
															: 'text-gray-400 dark:text-gray-500'}
											>
												· {hcSubFailed
													? 'Failed'
													: hcSubDone
														? 'Healthy'
														: hcSubWaiting
															? 'Waiting'
															: 'Pending'}
											</span>
										</span>
										{#if bakeIsFailed && (latestEntry.failedHealthChecks?.length ?? 0) > 0}
											<div class="mt-1 flex flex-col gap-1">
												{#each latestEntry.failedHealthChecks || [] as failedHC, index}
													<HealthCheckBadge
														failedHealthCheck={failedHC}
														fullHealthCheck={findFullHealthCheck(
															failedHC,
															healthChecks
														)}
														{index}
														prefix="failed-hc-pipeline"
													/>
												{/each}
											</div>
										{/if}
									</div>
								</div>
							{/if}

							<div class="flex items-start gap-2">
								<div
									class="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ring-1
										{bakeTimerFailed
										? 'bg-red-100 ring-red-200 dark:bg-red-900/40 dark:ring-red-800'
										: bakeTimerDone
											? 'bg-green-100 ring-green-200 dark:bg-green-900/40 dark:ring-green-800'
											: bakeTimerRunning
												? 'bg-yellow-100 ring-yellow-200 dark:bg-yellow-900/40 dark:ring-yellow-800'
												: 'bg-gray-100 ring-gray-200 dark:bg-gray-700 dark:ring-gray-600'}"
								>
									{#if bakeTimerFailed}
										<ExclamationCircleSolid
											class="h-2.5 w-2.5 text-red-600 dark:text-red-400"
										/>
									{:else if bakeTimerDone}
										<CheckCircleSolid
											class="h-2.5 w-2.5 text-green-600 dark:text-green-400"
										/>
									{:else if bakeTimerRunning}
										<Spinner size="4" color="yellow" />
									{:else}
										<ClockSolid class="h-2.5 w-2.5 text-gray-400 dark:text-gray-500" />
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<span class="text-xs text-gray-600 dark:text-gray-400"
										>Bake
										<span
											class={bakeTimerFailed
												? 'text-red-600 dark:text-red-400'
												: bakeTimerDone
													? 'text-green-600 dark:text-green-400'
													: bakeTimerRunning
														? 'text-yellow-600 dark:text-yellow-400'
														: 'text-gray-400 dark:text-gray-500'}
										>
											· {bakeTimerFailed
												? 'Failed'
												: bakeTimerDone
													? 'Done'
													: bakeTimerRunning
														? 'In progress'
														: 'Pending'}
										</span>
									</span>
									{#if bakeTimerRunning && latestEntry.bakeStartTime}
										{@const bakeProgressVal = rollout.spec?.bakeTime
											? (() => {
													const bakeStartMs = new Date(
														latestEntry.bakeStartTime
													).getTime();
													const elapsedMs = $now.getTime() - bakeStartMs;
													const totalMs = parseDuration(rollout.spec.bakeTime);
													return totalMs > 0
														? Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100))
														: 0;
												})()
											: 0}
										{@const remainingBakeMs = rollout.spec?.bakeTime
											? (() => {
													const bakeStartMs = new Date(
														latestEntry.bakeStartTime
													).getTime();
													const elapsedMs = $now.getTime() - bakeStartMs;
													const totalMs = parseDuration(rollout.spec.bakeTime);
													return Math.max(0, totalMs - elapsedMs);
												})()
											: 0}
										{#if rollout.spec?.bakeTime}
											<div class="mt-1 w-28">
												<div
													class="h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
												>
													<div
														class="h-full rounded-full bg-yellow-400 transition-all duration-300 dark:bg-yellow-500"
														style="width: {bakeProgressVal}%"
													></div>
												</div>
												<p class="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
													{remainingBakeMs > 0
														? `${formatDurationFromMs(remainingBakeMs)} left`
														: 'Finishing...'}
												</p>
											</div>
										{/if}
									{/if}
								</div>
							</div>
						</div>
					{/if}
				</div>
			</TimelineItem>
		</Timeline>
	</div>
</div>
