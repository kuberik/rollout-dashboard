<script lang="ts">
	import type { Rollout } from '../../../../../types';
	import {
		Badge,
		Timeline,
		TimelineItem,
		Blockquote,
		Button,
		Clipboard,
		Spinner,
		Card,
		Alert
	} from 'flowbite-svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		CheckOutline,
		ClipboardCleanSolid,
		CodePullRequestSolid,
		UndoOutline,
		InfoCircleSolid
	} from 'flowbite-svelte-icons';
	import { formatTimeAgo, formatDuration, formatDate } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import DeployModal from '$lib/components/DeployModal.svelte';

	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutQueryOptions } from '$lib/api/rollouts';
	import { getBakeStatusIcon } from '$lib/bake-status';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';

	// Params (runes)
	const namespace = $derived(get(page).params.namespace as string);
	const name = $derived(get(page).params.name as string);

	// Query for rollout
	const rolloutQuery = createQuery(() =>
		rolloutQueryOptions({
			namespace,
			name
		})
	);

	// Derive local vars used in template
	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const loading = $derived(rolloutQuery.isLoading);
	const error = $derived(rolloutQuery.isError ? (rolloutQuery.error as Error).message : null);

	// Local state for deploy modal (rollback)
	let showDeployModal = $state(false);
	let selectedVersionTag = $state<string | null>(null);
	let selectedVersionDisplay = $state<string | null>(null);

	// Filter and search state
	let searchQuery = $state('');
	let statusFilter = $state<string>('all'); // 'all', 'Succeeded', 'Failed', 'InProgress', 'Deploying'

	function getDisplayVersion(versionInfo: {
		version?: string;
		revision?: string;
		tag: string;
	}): string {
		return versionInfo.version || versionInfo.revision || versionInfo.tag;
	}

	function getRevisionInfo(versionInfo: { revision?: string; tag: string }): string | undefined {
		return versionInfo.revision;
	}

	function formatRevision(revision: string) {
		let result = '';
		if (revision.includes('@sha1:')) {
			result = revision.split('@sha1:')[1];
		} else {
			result = revision;
		}
		if (result.length > 12) {
			return result.substring(0, 12);
		}
		return result;
	}

	// Filter and group history entries
	const filteredHistory = $derived.by(() => {
		if (!rollout?.status?.history) return [];
		let filtered = rollout.status.history;

		// Filter by status
		if (statusFilter !== 'all') {
			filtered = filtered.filter((entry) => entry.bakeStatus === statusFilter);
		}

		// Filter by search query
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			filtered = filtered.filter((entry) => {
				const version = getDisplayVersion(entry.version).toLowerCase();
				const tag = entry.version.tag.toLowerCase();
				const message = entry.message?.toLowerCase() || '';
				return version.includes(query) || tag.includes(query) || message.includes(query);
			});
		}

		return filtered;
	});

	// Group history by date
	const groupedHistory = $derived.by(() => {
		const groups: Record<string, typeof filteredHistory> = {};
		filteredHistory.forEach((entry) => {
			const date = new Date(entry.timestamp);
			const dateKey = date.toLocaleDateString('en-US', {
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			});
			if (!groups[dateKey]) {
				groups[dateKey] = [];
			}
			groups[dateKey].push(entry);
		});
		return groups;
	});

	const statusOptions = $derived.by(() => {
		const history = rollout?.status?.history || [];
		return [
			{ value: 'all', label: 'All', count: history.length },
			{
				value: 'Succeeded',
				label: 'Succeeded',
				count: history.filter((e) => e.bakeStatus === 'Succeeded').length
			},
			{
				value: 'Failed',
				label: 'Failed',
				count: history.filter((e) => e.bakeStatus === 'Failed').length
			},
			{
				value: 'InProgress',
				label: 'In Progress',
				count: history.filter((e) => e.bakeStatus === 'InProgress').length
			},
			{
				value: 'Deploying',
				label: 'Deploying',
				count: history.filter((e) => e.bakeStatus === 'Deploying').length
			}
		];
	});
</script>

<svelte:head>
	<title
		>kuberik | {rollout?.metadata
			? `${rollout.metadata.name} (${rollout.metadata.namespace}) - History`
			: 'Rollout History'}</title
	>
</svelte:head>

<div class="h-full w-full dark:bg-gray-900">
	{#if loading}
		<div class="space-y-4 p-4">
			<div class="w-full">
				<div class="h-8 w-48 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
			</div>
			<div class="grid gap-4">
				{#each Array(3) as _}
					<div class="w-full">
						<div class="h-16 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
					</div>
				{/each}
			</div>
		</div>
	{:else if error}
		<div class="p-4">
			<Alert color="red" class="mb-4">
				{error}
			</Alert>
		</div>
	{:else if !rollout}
		<div class="p-4">
			<Alert color="yellow" class="mb-4">Release not found</Alert>
		</div>
	{:else}
		<!-- Main Layout -->
		<div class="flex h-full overflow-hidden">
			<!-- Content -->
			<div class="flex flex-1 flex-col overflow-hidden">
				<!-- Content Area -->
				<div class="flex-1 overflow-y-auto p-4">
					<!-- Header Card with Stats -->
					{#if rollout.status?.history}
						{@const history = rollout.status.history}
						{@const totalDeployments = history.length}
						{@const successfulDeployments = history.filter(
							(e) => e.bakeStatus === 'Succeeded'
						).length}
						{@const failedDeployments = history.filter((e) => e.bakeStatus === 'Failed').length}
						{@const successRate =
							totalDeployments > 0
								? Math.round((successfulDeployments / totalDeployments) * 100)
								: 0}
						<Card class="mb-4 w-full max-w-none p-6">
							<div class="mb-4">
								<h3 class="text-xl font-bold text-gray-900 dark:text-white">Deployment History</h3>
								<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
									Complete timeline of all deployments for this rollout
								</p>
							</div>
							<!-- Summary Statistics -->
							<div
								class="grid grid-cols-2 gap-4 border-t border-gray-200 pt-4 sm:grid-cols-4 dark:border-gray-700"
							>
								<div>
									<p class="text-xs text-gray-500 dark:text-gray-400">Total Deployments</p>
									<p class="mt-1 text-lg font-semibold text-gray-900 dark:text-white">
										{totalDeployments}
									</p>
								</div>
								<div>
									<p class="text-xs text-gray-500 dark:text-gray-400">Success Rate</p>
									<p class="mt-1 text-lg font-semibold text-green-600 dark:text-green-400">
										{successRate}%
									</p>
								</div>
								<div>
									<p class="text-xs text-gray-500 dark:text-gray-400">Successful</p>
									<p class="mt-1 text-lg font-semibold text-green-600 dark:text-green-400">
										{successfulDeployments}
									</p>
								</div>
								<div>
									<p class="text-xs text-gray-500 dark:text-gray-400">Failed</p>
									<p class="mt-1 text-lg font-semibold text-red-600 dark:text-red-400">
										{failedDeployments}
									</p>
								</div>
							</div>
						</Card>
					{:else}
						<Card class="mb-4 w-full max-w-none p-6">
							<div class="mb-6">
								<h3 class="text-xl font-bold text-gray-900 dark:text-white">Deployment History</h3>
								<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
									Complete timeline of all deployments for this rollout
								</p>
							</div>
						</Card>
					{/if}

					<!-- History Timeline Card -->
					{#if rollout.status?.history}
						<Card class="w-full max-w-none p-6">
							<!-- Filters and Search -->
							<div class="mb-6 space-y-4 border-b border-gray-200 pb-4 dark:border-gray-700">
								<!-- Search -->
								<div class="relative">
									<div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
										<svg
											class="h-4 w-4 text-gray-500 dark:text-gray-400"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												stroke-linecap="round"
												stroke-linejoin="round"
												stroke-width="2"
												d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
											/>
										</svg>
									</div>
									<input
										type="text"
										bind:value={searchQuery}
										placeholder="Search by version, tag, or message..."
										class="block w-full rounded-lg border border-gray-300 bg-gray-50 p-2.5 pl-10 text-sm text-gray-900 focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-blue-500 dark:focus:ring-blue-500"
									/>
								</div>
								<!-- Status Filters -->
								<div class="flex flex-wrap items-center gap-2">
									<span class="text-xs font-medium text-gray-700 dark:text-gray-300">Filter:</span>
									{#each statusOptions as option}
										<button
											type="button"
											onclick={() => (statusFilter = option.value)}
											class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors {statusFilter ===
											option.value
												? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
												: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'}"
										>
											{option.label}
											<Badge color="gray" size="small" class="ml-0.5">
												{option.count}
											</Badge>
										</button>
									{/each}
								</div>
								{#if filteredHistory.length !== rollout.status.history.length}
									<div class="text-xs text-gray-500 dark:text-gray-400">
										Showing {filteredHistory.length} of {rollout.status.history.length} deployments
									</div>
								{/if}
							</div>

							{#if filteredHistory.length > 0}
								<Timeline order="vertical" class="w-full">
									{#each Object.entries(groupedHistory) as [dateKey, entries], groupIndex}
										{#if Object.keys(groupedHistory).length > 1}
											<div class="mb-4 mt-2 flex items-center gap-2">
												<div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
												<span class="text-xs font-semibold text-gray-500 dark:text-gray-400">
													{dateKey}
												</span>
												<div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
											</div>
										{/if}
										{#each entries as entry, i ((entry.version.tag, i))}
											{@const originalIndex = rollout.status.history.findIndex(
												(e) => e.version.tag === entry.version.tag
											)}
											{@const isCurrentEntry = originalIndex === 0}
											{@const isCurrent = i === 0}
											<TimelineItem
												h3Class="font-mono ml-2"
												liClass="mr-4"
												title={getDisplayVersion(entry.version)}
												date="Deployed {formatTimeAgo(entry.timestamp, $now)}"
											>
												{#snippet orientationSlot()}
													<span
														class="absolute -start-3 flex h-6 w-6 items-center justify-center rounded-full bg-white ring-8 ring-white transition-all duration-200 dark:bg-gray-800 dark:ring-gray-800"
													>
														<BakeStatusIcon bakeStatus={entry.bakeStatus} size="medium" />
													</span>
												{/snippet}
												<div
													class="group relative flex h-full flex-col gap-4 rounded-lg p-4 transition-all duration-200 hover:bg-gray-50 dark:hover:bg-gray-800/50"
												>
													<!-- Two-column layout for better space usage -->
													<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
														<!-- Left Column: Main Info -->
														<div class="flex-1 space-y-3">
															<div class="flex flex-wrap items-center gap-2">
																{#if isCurrentEntry}
																	<Badge color="blue" size="small" class="font-medium"
																		>Current</Badge
																	>
																{/if}
																{#if getRevisionInfo(entry.version)}
																	<Badge color="blue" size="small">
																		{formatRevision(getRevisionInfo(entry.version)!)}
																	</Badge>
																{/if}
																<Badge
																	color={entry.bakeStatus === 'Succeeded'
																		? 'green'
																		: entry.bakeStatus === 'Failed'
																			? 'red'
																			: entry.bakeStatus === 'Deploying'
																				? 'blue'
																				: entry.bakeStatus === 'InProgress'
																					? 'yellow'
																					: 'gray'}
																	size="small"
																>
																	{entry.bakeStatus || 'Unknown'}
																</Badge>
															</div>
															<div class="space-y-2">
																<div
																	class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
																>
																	<ClockSolid class="h-3 w-3" />
																	<span>{formatDate(entry.timestamp)}</span>
																</div>
																{#if entry.message}
																	<Blockquote
																		class="break-words text-sm text-gray-600 dark:text-gray-400"
																	>
																		"{entry.message}"
																	</Blockquote>
																{/if}
															</div>
														</div>

														<!-- Right Column: Additional Details -->
														<div class="flex-1 space-y-3">
															{#if entry.bakeStatus}
																<div class="space-y-2">
																	{#if entry.bakeStatusMessage}
																		<p class="text-sm text-gray-600 dark:text-gray-400">
																			{entry.bakeStatusMessage}
																		</p>
																	{/if}
																	{#if entry.bakeStartTime && entry.bakeEndTime}
																		<div
																			class="flex items-center gap-2 rounded-md bg-gray-100 px-2 py-1.5 dark:bg-gray-800"
																		>
																			<ClockSolid
																				class="h-3.5 w-3.5 text-gray-500 dark:text-gray-400"
																			/>
																			<p
																				class="text-xs font-medium text-gray-700 dark:text-gray-300"
																			>
																				Bake completed in {formatDuration(
																					entry.bakeStartTime,
																					new Date(entry.bakeEndTime)
																				)}
																			</p>
																		</div>
																	{/if}
																</div>
															{/if}
														</div>
													</div>

													<!-- Action Buttons Row -->
													<div
														class="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 dark:border-gray-700"
													>
														<!-- Primary Actions -->
														<div class="flex flex-wrap gap-2">
															{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
																<SourceViewer
																	namespace={rollout.metadata?.namespace || ''}
																	name={rollout.metadata?.name || ''}
																	version={entry.version.tag}
																/>
															{/if}
															{#if originalIndex < rollout.status.history.length - 1 && rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
																<Button
																	color="light"
																	size="xs"
																	href={`/rollouts/${rollout.metadata?.namespace}/${rollout.metadata?.name}/diff/${entry.version.tag}`}
																>
																	<CodePullRequestSolid class="mr-1 h-3 w-3" />
																	Show diff
																</Button>
															{/if}
															{#if entry.version.tag !== rollout.status?.history[0]?.version.tag}
																<Button
																	color="light"
																	size="xs"
																	onclick={() => {
																		selectedVersionTag = entry.version.tag;
																		selectedVersionDisplay = getDisplayVersion(entry.version);
																		showDeployModal = true;
																	}}
																>
																	<UndoOutline class="mr-1 h-3 w-3" />
																	Rollback
																</Button>
															{/if}
														</div>
														<!-- Secondary Actions -->
														<div class="flex flex-wrap gap-2">
															{#if rollout?.status?.source}
																<GitHubViewButton
																	sourceUrl={rollout.status.source}
																	version={getDisplayVersion(entry.version)}
																	size="xs"
																	color="light"
																/>
															{/if}
															<Clipboard bind:value={entry.version.tag} size="xs" color="light">
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
												</div>
											</TimelineItem>
										{/each}
									{/each}
								</Timeline>
							{:else}
								<div class="flex flex-col items-center justify-center py-12 text-center">
									<InfoCircleSolid class="mb-3 h-12 w-12 text-gray-400 dark:text-gray-500" />
									<p class="text-sm font-medium text-gray-900 dark:text-white">
										No deployments found
									</p>
									<p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
										Try adjusting your filters or search query
									</p>
									<button
										type="button"
										onclick={() => {
											searchQuery = '';
											statusFilter = 'all';
										}}
										class="mt-4 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
									>
										Clear filters
									</button>
								</div>
							{/if}
						</Card>
					{:else}
						<Card class="w-full max-w-none p-6">
							<div class="flex h-64 items-center justify-center text-gray-500 dark:text-gray-400">
								<p>No deployment history available</p>
							</div>
						</Card>
					{/if}
				</div>
			</div>
		</div>

		<DeployModal
			bind:open={showDeployModal}
			{rollout}
			{selectedVersionTag}
			{selectedVersionDisplay}
			isPinVersionMode={true}
		/>
	{/if}
</div>
