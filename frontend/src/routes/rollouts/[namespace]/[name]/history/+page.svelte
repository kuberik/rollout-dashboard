<script lang="ts">
	import type { Rollout } from '../../../../../types';
	import {
		Badge,
		Timeline,
		TimelineItem,
		Blockquote,
		Button,
		Clipboard,
		Spinner
	} from 'flowbite-svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		CheckOutline,
		ClipboardCleanSolid,
		CodePullRequestSolid,
		UndoOutline
	} from 'flowbite-svelte-icons';
	import { formatTimeAgo, formatDuration } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import SourceViewer from '$lib/components/SourceViewer.svelte';
	import GitHubViewButton from '$lib/components/GitHubViewButton.svelte';
	import DeployModal from '$lib/components/DeployModal.svelte';

	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { createQuery } from '@tanstack/svelte-query';

	// Params (runes)
	const namespace = $derived(get(page).params.namespace as string);
	const name = $derived(get(page).params.name as string);

	// Query for rollout
	const rolloutQuery = createQuery(() => ({
		queryKey: ['rollout', namespace, name],
		queryFn: async (): Promise<{ rollout: Rollout | null }> => {
			const res = await fetch(`/api/rollouts/${namespace}/${name}`);
			if (!res.ok) {
				if (res.status === 404) {
					return { rollout: null };
				}
				throw new Error('Failed to load rollout');
			}
			return await res.json();
		}
	}));

	// Derive local vars used in template
	const rollout = $derived(rolloutQuery.data?.rollout as Rollout | null);
	const loading = $derived(rolloutQuery.isLoading);
	const error = $derived(rolloutQuery.isError ? (rolloutQuery.error as Error).message : null);

	// Local state for deploy modal (rollback)
	let showDeployModal = $state(false);
	let selectedVersionTag = $state<string | null>(null);
	let selectedVersionDisplay = $state<string | null>(null);

	function getBakeStatusIcon(bakeStatus?: string) {
		switch (bakeStatus) {
			case 'Succeeded':
				return { icon: CheckCircleSolid, color: 'text-green-600 dark:text-green-400' };
			case 'Failed':
				return { icon: ExclamationCircleSolid, color: 'text-red-600 dark:text-red-400' };
			case 'InProgress':
				return { icon: Spinner, color: 'text-yellow-600 dark:text-yellow-400' };
			default:
				return { icon: ClockSolid, color: 'text-gray-500 dark:text-gray-400' };
		}
	}

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
</script>

<svelte:head>
	<title
		>kuberik | {rollout?.metadata
			? `${rollout.metadata.name} (${rollout.metadata.namespace}) - History`
			: 'Rollout History'}</title
	>
</svelte:head>

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
		<p class="text-red-600">{error}</p>
	</div>
{:else if !rollout}
	<div class="p-4">
		<p>Release not found</p>
	</div>
{:else}
	<div class="p-8">
		<div class="mb-6">
			<h3 class="text-xl font-semibold text-gray-900 dark:text-white">Deployment History</h3>
			<p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
				Complete timeline of all deployments for this rollout
			</p>
		</div>

		{#if rollout.status?.history}
			<Timeline order="vertical" class="w-full">
				{#each rollout.status.history as entry, i ((entry.version.tag, i))}
					<TimelineItem
						h3Class="font-mono"
						liClass="mr-4"
						title={getDisplayVersion(entry.version)}
						date="Deployed {formatTimeAgo(entry.timestamp, $now)}"
					>
						{#snippet orientationSlot()}
							<span
								class="absolute -start-3 flex h-6 w-6 items-center justify-center rounded-full bg-white ring-8 ring-white dark:bg-gray-800 dark:ring-gray-800"
							>
								<svelte:component
									this={getBakeStatusIcon(entry.bakeStatus).icon}
									color={entry.bakeStatus === 'InProgress' ? 'yellow' : undefined}
									class="h-6 w-6 {entry.bakeStatus === 'InProgress'
										? 'undefined'
										: getBakeStatusIcon(entry.bakeStatus).color}"
								/>
							</span>
						{/snippet}
						<div class="flex h-full flex-col space-y-3">
							<div class="flex-1">
								{#if getRevisionInfo(entry.version)}
									<Badge color="gray" class="mb-2">
										{formatRevision(getRevisionInfo(entry.version)!)}
									</Badge>
								{/if}
								{#if entry.message}
									<Blockquote class="mt-2 text-sm">
										"{entry.message}"
									</Blockquote>
								{/if}
							</div>

							<div class="mt-auto space-y-2">
								{#if entry.bakeStatus}
									<div class="space-y-1">
										{#if entry.bakeStatusMessage}
											<p class="text-xs text-gray-600 dark:text-gray-400">
												{entry.bakeStatusMessage}
											</p>
										{/if}
										{#if entry.bakeStartTime && entry.bakeEndTime}
											<p class="text-xs text-gray-500 dark:text-gray-500">
												Bake completed in {formatDuration(
													entry.bakeStartTime,
													new Date(entry.bakeEndTime)
												)}
											</p>
										{/if}
									</div>
								{/if}
								<div class="flex flex-wrap gap-2 pt-3">
									{#if rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
										<SourceViewer
											namespace={rollout.metadata?.namespace || ''}
											name={rollout.metadata?.name || ''}
											version={entry.version.tag}
										/>
									{/if}
									{#if i < rollout.status.history.length - 1 && rollout?.status?.artifactType === 'application/vnd.cncf.flux.config.v1+json'}
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
			</Timeline>
		{:else}
			<div class="flex h-64 items-center justify-center text-gray-500 dark:text-gray-400">
				<p>No deployment history available</p>
			</div>
		{/if}

		<DeployModal
			bind:open={showDeployModal}
			{rollout}
			{selectedVersionTag}
			{selectedVersionDisplay}
			isPinVersionMode={true}
		/>
	</div>
{/if}
