<script lang="ts">
	import type { Rollout, Kustomization, ManagedResourceStatus, RolloutTest } from '../../../../../types';
	import { Badge, Button, Clipboard, Spinner, Alert } from 'flowbite-svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		CheckOutline,
		ClipboardCleanSolid,
		CodePullRequestSolid,
		UndoOutline,
		UserSolid,
		CogSolid,
		ChevronDownOutline,
		ChevronUpOutline,
		LayersSolid
	} from 'flowbite-svelte-icons';
	import {
		formatTimeAgo,
		formatDuration,
		formatDate,
		extractDatadogInfoFromContainers,
		buildDatadogTestRunsUrl,
		buildDatadogLogsUrl
	} from '$lib/utils';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import DeployModal from '$lib/components/DeployModal.svelte';
	import DatadogLogo from '$lib/components/DatadogLogo.svelte';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';
	import DeploymentTimeline from '$lib/components/DeploymentTimeline.svelte';

	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutQueryOptions, rolloutsInNamespaceQueryOptions } from '$lib/api/rollouts';

	const namespace = $derived(get(page).params.namespace as string);
	const name = $derived(get(page).params.name as string);

	const rolloutQuery = createQuery(() => rolloutQueryOptions({ namespace, name }));

	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const kustomizations = $derived(
		(rolloutQuery.data?.kustomizations?.items as Kustomization[]) || []
	);
	const loading = $derived(rolloutQuery.isLoading);
	const error = $derived(rolloutQuery.isError ? (rolloutQuery.error as Error).message : null);

	// Environment data (shipped with rollout query response)
	const environment = $derived(rolloutQuery.data?.environment);
	const envInfos = $derived(environment?.status?.environmentInfos ?? []);
	const currentEnvName = $derived(environment?.spec?.environment);
	const hasOtherEnvs = $derived(
		envInfos.filter((e) => e.environment !== currentEnvName).length > 0
	);

	// Toggles: show sibling environments / compare rollouts across namespace
	let showEnvironments = $state(false);
	let showComparison = $state(false);

	const nsRolloutsQuery = createQuery(() => ({
		...rolloutsInNamespaceQueryOptions({ namespace }),
		enabled: showComparison
	}));

	const nsRollouts = $derived(
		showComparison ? ((nsRolloutsQuery.data?.rollouts?.items as Rollout[]) ?? []) : []
	);

	// Managed resources for Datadog info
	let managedResources = $state<ManagedResourceStatus[]>([]);

	$effect(() => {
		const currentKustomizations = kustomizations;
		if (!currentKustomizations || currentKustomizations.length === 0) {
			managedResources = [];
			return;
		}
		Promise.all(
			currentKustomizations
				.filter((ks) => Boolean(ks.metadata?.name))
				.map(async (ks) => {
					const ksName = ks.metadata!.name as string;
					const ksNamespace = ks.metadata?.namespace || namespace;
					try {
						const res = await fetch(
							`/api/kustomizations/${ksNamespace}/${ksName}/managed-resources`
						);
						if (res.ok) {
							const data = await res.json();
							return (data.managedResources || []) as ManagedResourceStatus[];
						}
					} catch (e) {
						console.error(`Failed to fetch managed resources for ${ksName}:`, e);
					}
					return [] as ManagedResourceStatus[];
				})
		).then((results) => {
			if (kustomizations === currentKustomizations) {
				managedResources = results.flat();
			}
		});
	});

	const datadogTestInfo = $derived.by(() => {
		const rolloutTests = managedResources
			.filter((r) => r.groupVersionKind === 'rollout.kuberik.com/v1alpha1/RolloutTest')
			.map((r) => r.object as RolloutTest);
		if (rolloutTests.length === 0) return null;
		for (const test of rolloutTests) {
			const containers = test.spec?.jobTemplate?.template?.spec?.containers || [];
			const info = extractDatadogInfoFromContainers(containers);
			if (info) return info;
		}
		return null;
	});

	// Timeline state
	type PresetRange = '1h' | '6h' | '1d' | '7d' | '30d' | 'all';
	type TimeRange = PresetRange | { start: number; end: number };
	let timeRange = $state<TimeRange>('7d');
	let selectedEntry = $state<{ serviceId: string; index: number } | null>(null);

	// Build service rows for the chart
	const chartServices = $derived.by(() => {
		if (!rollout) return [];
		const current = {
			id: `${namespace}/${name}`,
			name: currentEnvName ? `${name} (${currentEnvName})` : name,
			history: rollout.status?.history ?? [],
			isCurrent: true
		};
		const rows: typeof current[] = [current];

		if (showEnvironments) {
			const envRows = envInfos
				.filter((env) => env.environment && env.environment !== currentEnvName)
				.map((env) => ({
					id: `env:${env.environment}`,
					name: env.environment,
					history: (env.history ?? []) as typeof current.history,
					isCurrent: false
				}));
			rows.push(...envRows);
		}

		if (showComparison) {
			const others = nsRollouts
				.filter((r) => r.metadata?.name !== name)
				.map((r) => ({
					id: `${r.metadata?.namespace}/${r.metadata?.name}`,
					name: r.metadata?.name ?? 'unknown',
					history: r.status?.history ?? [],
					isCurrent: false
				}))
				.sort((a, b) => a.name.localeCompare(b.name));
			rows.push(...others);
		}

		return rows;
	});

	// Filter history list by selected time range
	const filteredHistory = $derived.by(() => {
		const history = rollout?.status?.history ?? [];
		if (timeRange === 'all') return history.map((e, i) => ({ e, i }));
		if (typeof timeRange === 'object') {
			const { start, end } = timeRange;
			return history
				.map((e, i) => ({ e, i }))
				.filter(({ e }) => {
					const t = new Date(e.timestamp).getTime();
					return t >= start && t <= end;
				});
		}
		const msMap: Record<string, number> = {
			'1h': 3_600_000,
			'6h': 21_600_000,
			'1d': 86_400_000,
			'7d': 604_800_000,
			'30d': 2_592_000_000
		};
		const cutoff = Date.now() - msMap[timeRange];
		return history
			.map((e, i) => ({ e, i }))
			.filter(({ e }) => new Date(e.timestamp).getTime() >= cutoff);
	});

	// Stats (over all history, not filtered)
	const allHistory = $derived(rollout?.status?.history ?? []);
	const totalDeploys = $derived(allHistory.length);
	const succeeded = $derived(allHistory.filter((e) => e.bakeStatus === 'Succeeded').length);
	const failed = $derived(allHistory.filter((e) => e.bakeStatus === 'Failed').length);
	const successRate = $derived(totalDeploys > 0 ? Math.round((succeeded / totalDeploys) * 100) : 0);

	// Expanded entry state
	let expandedIdx = $state<Set<number>>(new Set());
	function toggleExpand(i: number) {
		const next = new Set(expandedIdx);
		next.has(i) ? next.delete(i) : next.add(i);
		expandedIdx = next;
	}

	// Element refs for scroll-to-entry
	const listEntryEls = new Map<number, HTMLElement>();
	function registerEntry(node: HTMLElement, idx: number) {
		listEntryEls.set(idx, node);
		return {
			update(newIdx: number) {
				listEntryEls.set(newIdx, node);
			},
			destroy() {
				listEntryEls.delete(idx);
			}
		};
	}

	// Rollback modal
	let showDeployModal = $state(false);
	let selectedVersionTag = $state<string | null>(null);
	let selectedVersionDisplay = $state<string | null>(null);
	let deployExplanation = $state('');

	function getDisplayVersion(v: { version?: string; revision?: string; tag: string }) {
		return v.version || v.revision || v.tag;
	}

	function formatRevision(revision: string) {
		let r = revision.includes('@sha1:') ? revision.split('@sha1:')[1] : revision;
		return r.length > 12 ? r.substring(0, 12) : r;
	}

	function statusBadgeColor(bakeStatus?: string) {
		switch (bakeStatus) {
			case 'Succeeded':
				return 'green';
			case 'Failed':
				return 'red';
			case 'Deploying':
				return 'blue';
			case 'InProgress':
				return 'yellow';
			default:
				return 'gray';
		}
	}

	function handleChartEntryClick(serviceId: string, index: number) {
		const currentSvcId = `${namespace}/${name}`;
		if (serviceId !== currentSvcId) return;
		selectedEntry = { serviceId, index };
		expandedIdx = new Set([...expandedIdx, index]);
		const el = listEntryEls.get(index);
		if (el) {
			el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	}
</script>

<svelte:head>
	<title>
		kuberik | {rollout?.metadata
			? `${rollout.metadata.name} (${rollout.metadata.namespace}) - History`
			: 'Rollout History'}
	</title>
</svelte:head>

<div class="h-full w-full dark:bg-gray-900">
	{#if loading}
		<div class="flex h-full items-center justify-center">
			<Spinner size="8" />
		</div>
	{:else if error}
		<div class="p-4">
			<Alert color="red">{error}</Alert>
		</div>
	{:else if !rollout}
		<div class="p-4">
			<Alert color="yellow">Release not found</Alert>
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto p-3 sm:p-5">
			<!-- Page header + stats bar -->
			<div class="mb-5 flex flex-wrap items-start justify-between gap-4">
				<div>
					<h2 class="text-xl font-bold text-gray-900 dark:text-white">Deployment History</h2>
					<p class="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
						All deployments for <span class="font-mono">{name}</span>
					</p>
				</div>
				<!-- Stat pills -->
				<div class="flex flex-wrap items-center gap-2">
					<div
						class="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs dark:bg-gray-800"
					>
						<span class="text-gray-500 dark:text-gray-400">Total</span>
						<span class="font-semibold text-gray-900 dark:text-white">{totalDeploys}</span>
					</div>
					<div
						class="flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs dark:bg-green-950/30"
					>
						<CheckCircleSolid class="h-3 w-3 text-green-500" />
						<span class="font-semibold text-green-700 dark:text-green-400">{succeeded}</span>
					</div>
					<div
						class="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs dark:bg-red-950/30"
					>
						<ExclamationCircleSolid class="h-3 w-3 text-red-500" />
						<span class="font-semibold text-red-700 dark:text-red-400">{failed}</span>
					</div>
					<div
						class="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs {successRate >= 90
							? 'bg-green-50 dark:bg-green-950/30'
							: successRate >= 70
								? 'bg-yellow-50 dark:bg-yellow-950/30'
								: 'bg-red-50 dark:bg-red-950/30'}"
					>
						<span
							class="font-semibold {successRate >= 90
								? 'text-green-700 dark:text-green-400'
								: successRate >= 70
									? 'text-yellow-700 dark:text-yellow-400'
									: 'text-red-700 dark:text-red-400'}">{successRate}% success</span
						>
					</div>
				</div>
			</div>

			<!-- Timeline chart card -->
			<div
				class="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800/50"
			>
				<div class="mb-3 flex flex-wrap items-center justify-between gap-3">
					<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
						Deployment Timeline
					</h3>
					<div class="flex flex-wrap gap-2">
						{#if hasOtherEnvs}
							<button
								class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors {showEnvironments
									? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
									: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
								onclick={() => {
									showEnvironments = !showEnvironments;
								}}
								title="Show sibling environments on the timeline"
							>
								<LayersSolid class="h-3.5 w-3.5" />
								{showEnvironments ? 'Hide environments' : 'Show environments'}
							</button>
						{/if}
						<button
							class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors {showComparison
								? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
								: 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'}"
							onclick={() => {
								showComparison = !showComparison;
							}}
							title="Show all other rollouts in this namespace"
						>
							<LayersSolid class="h-3.5 w-3.5" />
							{showComparison ? 'Hide namespace' : 'Compare namespace'}
							{#if showComparison && nsRolloutsQuery.isLoading}
								<Spinner size="4" />
							{/if}
						</button>
					</div>
				</div>
				<DeploymentTimeline
					services={chartServices}
					bind:timeRange
					{selectedEntry}
					onEntryClick={handleChartEntryClick}
				/>
			</div>

			<!-- Deployment list -->
			<div class="space-y-1">
				<div class="mb-3 flex items-center justify-between">
					<h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300">
						Deployments
						{#if filteredHistory.length !== totalDeploys}
							<span class="ml-1.5 font-normal text-gray-400">
								({filteredHistory.length} of {totalDeploys})
							</span>
						{/if}
					</h3>
				</div>

				{#if filteredHistory.length === 0}
					<div
						class="flex h-24 items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-700 dark:text-gray-600"
					>
						No deployments in this time range
					</div>
				{:else}
					{#each filteredHistory as { e: entry, i } (i)}
						{@const isCurrent = i === 0}
						{@const isExpanded = expandedIdx.has(i)}
						{@const isSelected =
							selectedEntry?.serviceId === `${namespace}/${name}` &&
							selectedEntry?.index === i}

						<div
							use:registerEntry={i}
							class="overflow-hidden rounded-xl border transition-all duration-200 {isSelected
								? 'border-blue-400 shadow-md shadow-blue-100 dark:border-blue-600 dark:shadow-blue-950/50'
								: 'border-gray-200 dark:border-gray-700'} bg-white dark:bg-gray-800/50"
						>
							<!-- Collapsed row (always visible) -->
							<button
								class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800"
								onclick={() => toggleExpand(i)}
							>
								<!-- Status icon -->
								<div class="flex-shrink-0">
									<BakeStatusIcon bakeStatus={entry.bakeStatus} size="medium" />
								</div>

								<!-- Version -->
								<div class="min-w-0 flex-1">
									<div class="flex flex-wrap items-center gap-2">
										<span class="font-mono text-sm font-semibold text-gray-900 dark:text-white">
											{getDisplayVersion(entry.version)}
										</span>
										{#if isCurrent}
											<Badge color="blue" class="text-xs">Current</Badge>
										{/if}
										<Badge color={statusBadgeColor(entry.bakeStatus)} class="text-xs">
											{entry.bakeStatus || 'Unknown'}
										</Badge>
										{#if entry.version.revision}
											<Badge color="gray" class="font-mono text-xs">
												{formatRevision(entry.version.revision)}
											</Badge>
										{/if}
									</div>
								</div>

								<!-- Time + actor -->
								<div class="hidden flex-shrink-0 text-right sm:block">
									<div class="text-xs text-gray-500 dark:text-gray-400">
										{formatTimeAgo(entry.timestamp, $now)}
									</div>
									{#if entry.triggeredBy}
										<div class="mt-0.5 flex items-center justify-end gap-1 text-xs text-gray-400">
											{#if entry.triggeredBy.kind === 'User'}
												<UserSolid class="h-3 w-3" />
												{entry.triggeredBy.name}
											{:else}
												<CogSolid class="h-3 w-3" />
												System
											{/if}
										</div>
									{/if}
								</div>

								<!-- Expand chevron -->
								<div class="flex-shrink-0 text-gray-400">
									{#if isExpanded}
										<ChevronUpOutline class="h-4 w-4" />
									{:else}
										<ChevronDownOutline class="h-4 w-4" />
									{/if}
								</div>
							</button>

							<!-- Expanded details -->
							{#if isExpanded}
								<div
									class="border-t border-gray-100 px-4 py-4 dark:border-gray-700"
								>
									<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
										<!-- Left: metadata -->
										<div class="space-y-2.5">
											<div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
												<ClockSolid class="h-3.5 w-3.5 flex-shrink-0" />
												<span>{formatDate(entry.timestamp)}</span>
											</div>
											{#if entry.triggeredBy}
												<div class="flex items-center gap-1.5 text-xs">
													<span class="text-gray-400">Deployed by</span>
													{#if entry.triggeredBy.kind === 'User'}
														<UserSolid class="h-3 w-3 text-gray-500" />
														<span class="font-medium text-gray-700 dark:text-gray-300">
															{entry.triggeredBy.name}
														</span>
													{:else}
														<CogSolid class="h-3 w-3 text-gray-500" />
														<span class="font-medium text-gray-700 dark:text-gray-300">System</span>
													{/if}
												</div>
											{/if}
											{#if entry.message}
												<div class="flex items-baseline gap-1.5 text-xs">
													<span class="flex-shrink-0 text-gray-400">Reason</span>
													<span class="italic text-gray-600 dark:text-gray-400">{entry.message}</span>
												</div>
											{/if}
										</div>

										<!-- Right: bake info -->
										<div class="space-y-2.5">
											{#if entry.bakeStatusMessage}
												<p class="text-xs text-gray-600 dark:text-gray-400">
													{entry.bakeStatusMessage}
												</p>
											{/if}
											{#if entry.bakeStartTime && entry.bakeEndTime}
												<div
													class="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-2.5 py-1.5 dark:bg-gray-800"
												>
													<ClockSolid class="h-3.5 w-3.5 text-gray-500" />
													<span class="text-xs font-medium text-gray-700 dark:text-gray-300">
														Bake: {formatDuration(entry.bakeStartTime, new Date(entry.bakeEndTime))}
													</span>
												</div>
											{/if}
											{#if entry.failedHealthChecks && entry.failedHealthChecks.length > 0}
												<div class="space-y-1">
													{#each entry.failedHealthChecks as check}
														<div
															class="rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400"
														>
															<span class="font-medium">{check.name}:</span>
															{check.message}
														</div>
													{/each}
												</div>
											{/if}
										</div>
									</div>

									<!-- Action buttons -->
									<div class="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
										{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
											<SourceViewer
												namespace={rollout.metadata?.namespace || ''}
												name={rollout.metadata?.name || ''}
												version={entry.version.tag}
											/>
										{/if}
										{#if i < (rollout?.status?.history?.length ?? 0) - 1 && rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
											<Button
												color="light"
												size="xs"
												href={`/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/diff/${entry.version.tag}`}
											>
												<CodePullRequestSolid class="mr-1 h-3 w-3" />
												Show diff
											</Button>
										{/if}
										{#if entry.version.tag !== rollout?.status?.history?.[0]?.version?.tag}
											<Button
												color="light"
												size="xs"
												onclick={() => {
													selectedVersionTag = entry.version.tag;
													selectedVersionDisplay = getDisplayVersion(entry.version);
													if (rollout?.status?.history && rollout.status.history.length > 0) {
														const cur = rollout.status.history[0].version;
														deployExplanation = `Rollback from ${getDisplayVersion(cur)} to ${getDisplayVersion(entry.version)} due to issues with the current deployment.`;
													}
													showDeployModal = true;
												}}
											>
												<UndoOutline class="mr-1 h-3 w-3" />
												Rollback
											</Button>
										{/if}
										{#if datadogTestInfo}
											<Button
												color="light"
												size="xs"
												href={buildDatadogLogsUrl(datadogTestInfo.service, datadogTestInfo.env)}
												target="_blank"
											>
												<DatadogLogo class="mr-1 h-3 w-3" />
												Logs
											</Button>
											<Button
												color="light"
												size="xs"
												href={buildDatadogTestRunsUrl(
													datadogTestInfo.service,
													isCurrent && datadogTestInfo.version
														? datadogTestInfo.version
														: '*' + entry.version.tag + '*'
												)}
												target="_blank"
											>
												<DatadogLogo class="mr-1 h-3 w-3" />
												CI
											</Button>
										{/if}
										{#if rollout?.status?.source}
											<GitHubViewButton
												sourceUrl={rollout.status.source}
												version={getDisplayVersion(entry.version)}
												size="xs"
												color="light"
											/>
										{/if}
										<Clipboard value={entry.version.tag} size="xs" color="light">
											{#snippet children(success)}
												{#if success}
													<CheckOutline class="mr-1 h-3 w-3" />
													Copied
												{:else}
													<ClipboardCleanSolid class="mr-1 h-3 w-3" />
													Copy Tag
												{/if}
											{/snippet}
										</Clipboard>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>

		<DeployModal
			bind:open={showDeployModal}
			{rollout}
			{selectedVersionTag}
			{selectedVersionDisplay}
			isPinVersionMode={true}
			initialExplanation={deployExplanation}
		/>
	{/if}
</div>
