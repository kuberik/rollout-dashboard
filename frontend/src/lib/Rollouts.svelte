<script lang="ts">
	import { onMount } from 'svelte';
	import type { Rollout } from '../types';
	import { Badge, Spinner, Alert, Card, Timeline, TimelineItem } from 'flowbite-svelte';
	import { formatTimeAgo, getRolloutStatus } from '$lib/utils';
	import { now } from '$lib/stores/time';

	let rollouts: Rollout[] = [];
	let loading = true;
	let error: string | null = null;
	let annotationsByRollout: Record<string, Record<string, string>> = {};
	function rolloutKey(d: Rollout): string {
		const ns = (d as any)?.metadata?.namespace || '';
		const name = (d as any)?.metadata?.name || '';
		return `${ns}/${name}`;
	}

	onMount(async () => {
		try {
			const response = await fetch('/api/rollouts');
			if (!response.ok) {
				throw new Error('Failed to fetch rollouts');
			}
			const data = await response.json();
			rollouts = data.rollouts.items || [];

			// Fetch annotations for each rollout's current version
			const requests: Promise<void>[] = [];
			for (const r of rollouts) {
				const ns = (r as any)?.metadata?.namespace;
				const name = (r as any)?.metadata?.name;
				const version = r.status?.history?.[0]?.version;
				if (!ns || !name || !version) continue;
				const key = rolloutKey(r);
				requests.push(
					fetch(`/api/rollouts/${ns}/${name}/annotations/${version}`)
						.then(async (res) => {
							if (res.ok) {
								const payload = await res.json();
								annotationsByRollout[key] = payload.annotations || {};
							} else {
								annotationsByRollout[key] = {};
							}
							annotationsByRollout = { ...annotationsByRollout };
						})
						.catch(() => {
							annotationsByRollout[key] = {};
							annotationsByRollout = { ...annotationsByRollout };
						})
				);
			}
			await Promise.all(requests);
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
			{#each rollouts as deployment}
				<a
					href="/rollouts/{deployment.metadata?.namespace}/{deployment.metadata?.name}"
					class="block w-full"
				>
					<Card class="w-full max-w-full p-2 sm:p-4 md:p-6">
						<div class="flex flex-col gap-2">
							<div class="flex items-center justify-between">
								<h3 class="text-xl font-semibold text-gray-900 dark:text-white">
									{deployment.metadata?.name}
								</h3>
								<Badge color={getRolloutStatus(deployment).color}>
									{getRolloutStatus(deployment).text}
								</Badge>
							</div>
							<h5 class="text-sm text-gray-500">
								{deployment.metadata?.namespace}
							</h5>
							<div class="flex flex-col gap-1">
								<div class="flex items-center gap-2">
									<span class="text-sm text-gray-500">Current version:</span>
									<Badge color="blue">
										{annotationsByRollout[rolloutKey(deployment)]?.[
											'org.opencontainers.image.version'
										] ||
											deployment.status?.history?.[0]?.version ||
											'Unknown'}
									</Badge>
								</div>
								<div class="text-sm text-gray-500">
									Last deployment: {deployment.status?.history?.length
										? formatTimeAgo(deployment.status?.history[0].timestamp, $now)
										: 'Never'}
								</div>
							</div>
						</div>
					</Card>
				</a>
			{/each}
		</div>
	{/if}
</div>
