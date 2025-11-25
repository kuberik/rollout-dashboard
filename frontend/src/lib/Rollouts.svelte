<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import type { Rollout } from '../types';
	import { Badge, Spinner, Alert, Card } from 'flowbite-svelte';
	import { formatTimeAgo } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import {
		ClockSolid,
		CheckCircleSolid,
		ExclamationCircleSolid,
		PauseSolid,
		CloseOutline
	} from 'flowbite-svelte-icons';

	let rollouts = $state<Rollout[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Group rollouts by namespace
	const rolloutsByNamespace = $derived.by(() => {
		const grouped: Record<string, Rollout[]> = {};
		rollouts.forEach((r) => {
			const ns = r.metadata?.namespace || 'default';
			if (!grouped[ns]) {
				grouped[ns] = [];
			}
			grouped[ns].push(r);
		});
		// Sort namespaces alphabetically
		return Object.keys(grouped)
			.sort()
			.reduce(
				(acc, key) => {
					acc[key] = grouped[key];
					return acc;
				},
				{} as Record<string, Rollout[]>
			);
	});

	function getBakeStatusIcon(bakeStatus?: string) {
		switch (bakeStatus) {
			case 'Succeeded':
				return { icon: CheckCircleSolid, color: 'text-green-600 dark:text-green-400' };
			case 'Failed':
				return { icon: ExclamationCircleSolid, color: 'text-red-600 dark:text-red-400' };
			case 'InProgress':
				return { icon: ClockSolid, color: 'text-yellow-600 dark:text-yellow-400' };
			case 'Cancelled':
				return { icon: CloseOutline, color: 'text-gray-600 dark:text-gray-400' };
			case 'None':
				return { icon: PauseSolid, color: 'text-gray-600 dark:text-gray-400' };
			default:
				return { icon: ClockSolid, color: 'text-gray-600 dark:text-gray-400' };
		}
	}

	onMount(async () => {
		try {
			const response = await fetch('/api/rollouts');
			if (!response.ok) {
				throw new Error('Failed to fetch rollouts');
			}
			const data = await response.json();
			rollouts = data.rollouts.items || [];
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error occurred';
		} finally {
			loading = false;
		}
	});
</script>

<div class="flex w-full justify-center px-4 py-8 dark:bg-gray-900">
	{#if loading}
		<div class="mx-auto flex h-16 w-16 items-center justify-center">
			<Spinner size="8" />
		</div>
	{:else if error}
		<Alert color="red" class="mb-4">
			{error}
		</Alert>
	{:else if rollouts.length === 0}
		<Alert color="yellow" class="mb-4">No rollouts found</Alert>
	{:else}
		<div class="mx-auto flex w-full max-w-3xl flex-col items-center gap-6">
			{#each Object.entries(rolloutsByNamespace) as [namespace, namespaceRollouts]}
				<div class="w-full">
					<!-- Namespace Header -->
					<div class="mb-4 flex items-center gap-2">
						<h2 class="text-2xl font-bold text-gray-900 dark:text-white">{namespace}</h2>
					</div>
					<!-- Rollouts in this namespace -->
					<div class="flex flex-col gap-4">
						{#each namespaceRollouts as deployment}
							{@const upgradeCount = deployment.status?.releaseCandidates?.length || 0}
							{@const hasUpgrades = upgradeCount > 0}
							{@const isLatest =
								!hasUpgrades &&
								deployment.status?.availableReleases &&
								deployment.status.availableReleases.length > 0}
							{@const latestEntry = deployment.status?.history?.[0]}
							{@const bakeStatus = latestEntry?.bakeStatus}
							{@const { icon: StatusIcon, color: iconColor } = getBakeStatusIcon(bakeStatus)}
							<a
								href="/rollouts/{deployment.metadata?.namespace}/{deployment.metadata?.name}"
								class="block w-full"
							>
								<Card class="w-full max-w-full p-2 sm:p-4 md:p-6">
									<div class="flex flex-col gap-3">
										<div class="flex flex-wrap items-start justify-between gap-4">
											<div class="flex flex-1 items-start gap-4">
												<div
													class="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"
												>
													{#if bakeStatus === 'InProgress'}
														<Spinner color="yellow" size="6" />
													{:else}
														<StatusIcon class={`h-6 w-6 ${iconColor}`} />
													{/if}
												</div>
												<div class="min-w-0 flex-1">
													<div class="flex flex-wrap items-center gap-2">
														<h3 class="text-xl font-semibold text-gray-900 dark:text-white">
															{deployment.metadata?.name}
														</h3>
														{#if hasUpgrades}
															<Badge color="orange" size="small">
																{upgradeCount} upgrade{upgradeCount > 1 ? 's' : ''}
															</Badge>
														{:else if isLatest}
															<Badge color="blue" size="small">Latest</Badge>
														{/if}
													</div>
													{#if deployment.status?.title}
														<p class="text-sm text-gray-500 dark:text-gray-400">
															{deployment.status.title}
														</p>
													{/if}
												</div>
											</div>
											<div class="flex flex-wrap items-center justify-end gap-2">
												<Badge color="gray" border class="flex items-center gap-1">
													<ClockSolid class="h-3 w-3" />
													{deployment.status?.history?.length
														? formatTimeAgo(deployment.status?.history[0].timestamp, $now)
														: 'Never'}
												</Badge>
											</div>
										</div>
										{#if deployment.status?.description}
											<p class="text-sm text-gray-600 dark:text-gray-400">
												{deployment.status.description}
											</p>
										{/if}
									</div>
								</Card>
							</a>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
