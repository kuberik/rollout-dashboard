<svelte:options runes={true} />

<script lang="ts">
	import type { Kustomization, OCIRepository, ManagedResourceStatus } from '../../types';
	import StatusSpinner from './StatusSpinner.svelte';
	import Card from './Card.svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		ChevronDownOutline,
		ChevronRightOutline,
		ArrowUpRightFromSquareOutline
	} from 'flowbite-svelte-icons';
	import { getResourceStatus, getLastTransitionTime } from '$lib/utils';

	let {
		kustomizations,
		ociRepositories,
		filteredManagedResources,
		cluster
	}: {
		kustomizations: Kustomization[];
		ociRepositories: OCIRepository[];
		filteredManagedResources: Record<string, ManagedResourceStatus[]>;
		// Spoke URL when this rollout lives on a remote cluster — appended as
		// ?cluster=<name> so the hub proxies deployment-children lookups too.
		cluster?: string;
	} = $props();

	const clusterParam = $derived(cluster ? `?cluster=${encodeURIComponent(cluster)}` : '');

	// All managed resources (for status summary + "other" section)
	const allManagedResources = $derived(
		Object.values(filteredManagedResources).flat()
			.map((r) => ({ ...r, type: r.groupVersionKind?.split('/').pop() || 'Resource' }))
	);
	const deploymentResources = $derived(allManagedResources.filter((r) => r.type === 'Deployment'));
	const httpRouteResources = $derived(allManagedResources.filter((r) => r.type === 'HTTPRoute'));
	const otherResources = $derived(allManagedResources.filter((r) => r.type !== 'Deployment' && r.type !== 'HTTPRoute'));
	const READY_STATUSES = ['Ready', 'Healthy', 'Succeeded', 'Current'];
	// Only ready/healthy resources are collapsible; everything else is always visible
	const visibleOtherResources = $derived(otherResources.filter((r) => !READY_STATUSES.includes(r.status || '')));
	const collapsibleOtherResources = $derived(otherResources.filter((r) => READY_STATUSES.includes(r.status || '')));

	const show = $derived(allManagedResources.length > 0);

	// Status summary uses ALL resources
	const notReadyResources = $derived(
		allManagedResources.filter(
			(r) => !READY_STATUSES.includes(r.status || '')
		)
	);

	// Toggle to reveal ready/healthy non-deployment resources
	let showOtherResources = $state(false);

	/**
	 * ⛔ A RAW camelCase ENUM WAS REACHING THE SCREEN. (2026-08-31)
	 *
	 * A live critic watched one deploy and found `InProgress` printed in this
	 * card's status chip at the same second the version card said `deploying`
	 * and `/` said `checking`. This chip's `InProgress` is the RESOURCE's
	 * reconciliation state (kstatus), not the deploy's `bakeStatus` — two
	 * different enums that happen to spell the same word, which is exactly why
	 * a reader cannot tell them apart.
	 *
	 * Only the states that are not already English are translated. `Current`,
	 * `Ready`, `Failed`, `Pending`, `Reconciling`, `Terminating` and `Unknown`
	 * are left exactly as they are — this closes a defect, it does not
	 * relabel a vocabulary that works.
	 */
	const RESOURCE_STATUS_WORD: Record<string, string> = {
		InProgress: 'Updating',
		NotFound: 'Not found',
		WaitingForStep: 'Waiting'
	};
	function resourceStatusWord(status: string | undefined | null): string {
		const raw = status || 'Unknown';
		return RESOURCE_STATUS_WORD[raw] ?? raw;
	}

	// Track which deployments are expanded to show children
	let expandedDeployments = $state<Set<string>>(new Set());
	// Cache of fetched children per deployment key
	let deploymentChildren = $state<Record<string, { replicaSets: any[]; loading: boolean; error?: string }>>({});
	// Track which deployments were auto-expanded (to avoid re-expanding after manual collapse)
	let autoExpandedKeys = $state<Set<string>>(new Set());

	// Auto-expand not-ready deployments once when they first appear not-ready
	$effect(() => {
		for (const resource of deploymentResources) {
			const isReady = ['Ready', 'Healthy', 'Succeeded', 'Current'].includes(resource.status || '');
			const key = getDeploymentKey(resource);
			if (!isReady && !autoExpandedKeys.has(key)) {
				autoExpandedKeys = new Set([...autoExpandedKeys, key]);
				expandedDeployments = new Set([...expandedDeployments, key]);
				if (!deploymentChildren[key]) {
					deploymentChildren = { ...deploymentChildren, [key]: { replicaSets: [], loading: true } };
					fetch(`/api/namespaces/${resource.namespace}/deployments/${resource.name}/children${clusterParam}`)
						.then((r) => r.json())
						.then((data) => {
							deploymentChildren = { ...deploymentChildren, [key]: { replicaSets: data.replicaSets || [], loading: false } };
						})
						.catch(() => {
							deploymentChildren = { ...deploymentChildren, [key]: { replicaSets: [], loading: false, error: 'Failed to load' } };
						});
				}
			}
		}
	});

	function isDeployment(resource: any): boolean {
		return resource.groupVersionKind?.includes('Deployment') || resource.type === 'Deployment';
	}

	function getDeploymentKey(resource: any): string {
		return `${resource.namespace}/${resource.name}`;
	}

	function getDeploymentReplicas(resource: any): { ready: number; total: number } | null {
		const obj = resource.object;
		if (!obj) return null;
		const status = obj.status || obj.Status;
		if (!status) return null;
		return {
			ready: status.readyReplicas || 0,
			total: status.replicas || 0
		};
	}

	function getHTTPRouteURLs(resource: any): string[] {
		const hostnames: string[] = resource.object?.spec?.hostnames || [];
		return hostnames.map((h) => `https://${h}`);
	}

	async function toggleDeploymentChildren(resource: any) {
		const key = getDeploymentKey(resource);
		if (expandedDeployments.has(key)) {
			expandedDeployments = new Set([...expandedDeployments].filter((k) => k !== key));
			return;
		}

		expandedDeployments = new Set([...expandedDeployments, key]);

		if (deploymentChildren[key]) return; // already loaded

		deploymentChildren = {
			...deploymentChildren,
			[key]: { replicaSets: [], loading: true }
		};

		try {
			const res = await fetch(
				`/api/namespaces/${resource.namespace}/deployments/${resource.name}/children${clusterParam}`
			);
			if (!res.ok) throw new Error('Failed to fetch children');
			const data = await res.json();
			deploymentChildren = {
				...deploymentChildren,
				[key]: { replicaSets: data.replicaSets || [], loading: false }
			};
		} catch (e) {
			deploymentChildren = {
				...deploymentChildren,
				[key]: { replicaSets: [], loading: false, error: 'Failed to load' }
			};
		}
	}

	// Auto-refresh expanded deployments every 5 seconds
	$effect(() => {
		const expanded = [...expandedDeployments];
		if (expanded.length === 0) return;

		const refresh = async () => {
			for (const key of expanded) {
				const slashIdx = key.indexOf('/');
				const ns = key.substring(0, slashIdx);
				const depName = key.substring(slashIdx + 1);
				try {
					const res = await fetch(`/api/namespaces/${ns}/deployments/${depName}/children${clusterParam}`);
					if (!res.ok) continue;
					const data = await res.json();
					deploymentChildren = {
						...deploymentChildren,
						[key]: { replicaSets: data.replicaSets || [], loading: false }
					};
				} catch {}
			}
		};

		const interval = setInterval(refresh, 5000);
		return () => clearInterval(interval);
	});

	/**
	 * ⭐ NOW USES `Card`. (defect #4, design re-check, coordinator follow-up)
	 * The hand-rolled header measured 45px against the other three reference
	 * cards' 47px. `Card`'s `icon` prop renders a static glyph with a class,
	 * not an arbitrary component — it cannot take `StatusSpinner`'s own prop
	 * signature (`size`/`color`, not `class`), so the header's "not ready,
	 * not failing" state (previously an animated spinner) is `ClockSolid`
	 * here, the same static glyph `HealthChecksCard`'s own header already
	 * uses for "pending". The live spinners inside every row are untouched —
	 * this only changes the ONE icon in the 47px bar.
	 */
	const failedInHeader = $derived(
		notReadyResources.filter((r) => ['Unhealthy', 'Failed', 'Error'].includes(r.status || ''))
	);
	const HeaderIcon = $derived(
		failedInHeader.length > 0
			? ExclamationCircleSolid
			: notReadyResources.length > 0
				? ClockSolid
				: CheckCircleSolid
	);
	const headerIconClass = $derived(
		failedInHeader.length > 0
			? 'text-red-500 dark:text-red-400'
			: notReadyResources.length > 0
				? 'text-yellow-700 dark:text-yellow-400'
				: 'text-green-700 dark:text-green-400'
	);

	function getPodStatusColor(phase: string, ready: boolean, terminating: boolean): string {
		if (terminating) return 'text-orange-500 dark:text-orange-400';
		if (phase === 'Running' && ready) return 'text-green-700 dark:text-green-400';
		if (phase === 'Running' && !ready) return 'text-yellow-700 dark:text-yellow-400';
		if (phase === 'Pending') return 'text-yellow-700 dark:text-yellow-400';
		if (phase === 'Failed') return 'text-red-600 dark:text-red-400';
		if (phase === 'Succeeded') return 'text-green-700 dark:text-green-400';
		return 'text-gray-500 dark:text-gray-400';
	}

	function getPodStatusLabel(phase: string, ready: boolean, terminating: boolean): string {
		if (terminating) return 'Terminating';
		if (phase === 'Running' && ready) return 'Ready';
		if (phase === 'Running' && !ready) return 'Not Ready';
		return phase;
	}
</script>

{#if show}
	<Card icon={HeaderIcon} iconClass={headerIconClass} title="Resources" padded={false}>
		{#snippet rollup()}
			{#if failedInHeader.length > 0}
				{@const reconcilingCount = notReadyResources.filter((r) => r.status === 'Reconciling').length}
				<span class="text-xs font-semibold text-red-600 dark:text-red-400">
					{failedInHeader.length} failed{reconcilingCount > 0 ? ` · ${reconcilingCount} reconciling` : ''}
				</span>
			{:else if notReadyResources.length > 0}
				<span class="text-xs text-yellow-700 dark:text-yellow-400">{notReadyResources.length} not ready</span>
			{:else}
				<span class="text-xs text-green-700 dark:text-green-400">{allManagedResources.length}/{allManagedResources.length} ready</span>
			{/if}
		{/snippet}
		<div class="divide-y divide-gray-100 dark:divide-gray-700/50">
			<!-- Deployment resources -->
			{#each deploymentResources as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
				{@const isReady = ['Ready','Healthy','Succeeded','Current'].includes(resource.status || '')}
				{@const isFailing = ['Unhealthy','Failed','Error'].includes(resource.status || '')}
				{@const isReconciling = resource.status === 'Reconciling'}
				{@const replicas = getDeploymentReplicas(resource)}
				{@const depKey = getDeploymentKey(resource)}
				{@const isExpanded = expandedDeployments.has(depKey)}
				{@const childData = deploymentChildren[depKey]}

				<div class="{isFailing ? 'bg-red-50 dark:bg-red-950/10' : isReconciling ? 'bg-yellow-50/50 dark:bg-yellow-950/5' : ''}">
					<!-- Deployment row -->
					<div class="flex items-center gap-2 px-4 py-2.5">
						<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center">
							{#if isFailing}
								<ExclamationCircleSolid class="h-4 w-4 text-red-500 dark:text-red-400" />
							{:else if isReconciling}
								<StatusSpinner size="4" color="yellow" />
							{:else if resource.status === 'Pending' || resource.status === 'InProgress'}
								<StatusSpinner size="4" color="blue" />
							{:else if isReady}
								<CheckCircleSolid class="h-4 w-4 text-green-700 dark:text-green-400" />
							{:else}
								<ExclamationCircleSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
							{/if}
						</div>
						<!-- ⛔ F7: `hello-frontend` AND `hello-api` BOTH TRUNCATED TO
						     `hell…` AT 390 (35/85 and 35/52 client/scroll) WHILE
						     `Deployment`, `2/2 pods` AND THE STATUS BADGE — IDENTICAL,
						     NON-DISCRIMINATING TEXT — KEPT FULL WIDTH. The name is the
						     one thing on this row that tells two deployments apart; a
						     type tag repeated on every Deployment row and a `pods` noun
						     the number beside it already implies are not. Both drop below
						     `sm`, in the `title` instead — the name gets the width back
						     at the one size where the row cannot afford both. -->
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5">
								<span
									class="truncate text-xs font-medium text-gray-900 dark:text-white"
									title="{resource.name} — Deployment">{resource.name}</span
								>
								<span
									class="rc-type-tag hidden shrink-0 rounded bg-gray-100 px-1 py-0.5 t-micro text-gray-700 dark:bg-gray-700 dark:text-gray-300"
									>Deployment</span
								>
							</div>
							{#if resource.message && !isReady}
								<p class="mt-0.5 break-words t-micro text-gray-500 dark:text-gray-400">{resource.message}</p>
							{/if}
						</div>
						{#if replicas}
							<span
								class="shrink-0 text-xs font-medium {replicas.ready === replicas.total && replicas.total > 0 ? 'text-green-700 dark:text-green-400' : replicas.ready < replicas.total ? 'text-yellow-700 dark:text-yellow-400' : 'text-gray-500 dark:text-gray-400'}"
								title="{replicas.ready}/{replicas.total} pods"
							>
								{replicas.ready}/{replicas.total}
								<span class="rc-pods-word hidden font-normal t-micro text-gray-500 dark:text-gray-400">pods</span>
							</span>
						{/if}
						<span class="shrink-0 t-label rounded-full px-1.5 py-0.5
							{isFailing ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
							: isReconciling ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
							: isReady ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
							: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}">
							{resourceStatusWord(resource.status)}
						</span>
						<!-- A chevron is not a name. `title` alone made this announce as
						     "Show pods" with no indication of WHICH deployment, and
						     `aria-expanded` was missing entirely, so the state the glyph
						     carries visually was carried by nothing else. -->
						<button
							type="button"
							onclick={() => toggleDeploymentChildren(resource)}
							class="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
							aria-expanded={isExpanded}
							aria-label={`${isExpanded ? 'Hide' : 'Show'} pods for ${resource.name}`}
							title={isExpanded ? 'Hide pods' : 'Show pods'}
						>
							{#if isExpanded}
								<ChevronDownOutline class="h-3.5 w-3.5" aria-hidden="true" />
							{:else}
								<ChevronRightOutline class="h-3.5 w-3.5" aria-hidden="true" />
							{/if}
						</button>
					</div>

					<!-- Expanded children -->
					{#if isExpanded}
						<div class="border-t border-gray-100 bg-gray-50/50 pb-1 dark:border-gray-700/50 dark:bg-gray-800/50">
							{#if childData?.loading}
								<div class="flex items-center gap-2 px-4 py-2 text-xs text-gray-500 dark:text-gray-400">
									<StatusSpinner size="4" color="gray" /> Loading...
								</div>
							{:else if childData?.error}
								<p class="px-4 py-2 text-xs text-red-600 dark:text-red-400">{childData.error}</p>
							{:else if childData}
								{#each childData.replicaSets.filter((rs: any) => rs.desiredReplicas > 0) as rs}
									<!-- ReplicaSet row -->
									<div class="flex items-center gap-2 py-1.5 pl-9 pr-4">
										<div class="flex h-4 w-4 shrink-0 items-center justify-center">
											{#if rs.readyReplicas === rs.desiredReplicas}
												<CheckCircleSolid class="h-3 w-3 text-green-700 dark:text-green-400" />
											{:else}
												<StatusSpinner size="3" color="yellow" />
											{/if}
										</div>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-1">
												<span class="truncate text-[11px] font-medium text-gray-700 dark:text-gray-300">{rs.name}</span>
												<span class="shrink-0 rounded bg-gray-100 px-1 py-0.5 t-micro text-gray-700 dark:bg-gray-700 dark:text-gray-300">ReplicaSet</span>
												{#if rs.isCurrentRS}
													<span class="shrink-0 rounded bg-blue-100 px-1 py-0.5 t-micro text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">current</span>
												{/if}
											</div>
										</div>
										<span class="shrink-0 text-[11px] {rs.readyReplicas === rs.desiredReplicas ? 'text-green-700 dark:text-green-400' : 'text-yellow-700 dark:text-yellow-400'}">
											{rs.readyReplicas}/{rs.desiredReplicas} <span class="t-micro text-gray-500 dark:text-gray-400">pods</span>
										</span>
									</div>

									<!-- Pod rows -->
									{#each (rs.pods || []) as pod}
										<div class="flex items-start gap-2 py-1 pl-14 pr-4">
											<div class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
												{#if pod.terminating}
													<StatusSpinner size="3" color="orange" />
												{:else if pod.phase === 'Running' && pod.ready}
													<CheckCircleSolid class="h-3 w-3 text-green-700 dark:text-green-400" />
												{:else if pod.phase === 'Pending' || (pod.phase === 'Running' && !pod.ready)}
													<StatusSpinner size="3" color="yellow" />
												{:else if pod.phase === 'Failed'}
													<ExclamationCircleSolid class="h-3 w-3 text-red-500 dark:text-red-400" />
												{:else}
													<div class="h-2.5 w-2.5 rounded-full bg-gray-300 dark:bg-gray-600"></div>
												{/if}
											</div>
											<div class="min-w-0 flex-1">
												<div class="flex items-center gap-1">
													<span class="truncate text-[11px] text-gray-600 dark:text-gray-400">{pod.name}</span>
													<span class="shrink-0 rounded bg-gray-100 px-1 py-0.5 t-micro text-gray-700 dark:bg-gray-700 dark:text-gray-300">Pod</span>
												</div>
												{#if pod.message}
													<span class="block break-words t-micro text-gray-500 dark:text-gray-400">{pod.message}</span>
												{/if}
											</div>
											{#if pod.restarts > 0}
												<span class="shrink-0 rounded bg-orange-100 px-1 py-0.5 t-micro text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
													{pod.restarts}r
												</span>
											{/if}
											{#if pod.age}
												<span class="shrink-0 t-micro text-gray-500 dark:text-gray-400">{pod.age}</span>
											{/if}
											<span class="t-label shrink-0 {getPodStatusColor(pod.phase, pod.ready, pod.terminating)}">
												{getPodStatusLabel(pod.phase, pod.ready, pod.terminating)}
											</span>
										</div>
									{/each}

									{#if (rs.pods?.length ?? 0) === 0}
										<p class="pb-1 pl-14 pr-4 t-micro text-gray-500 dark:text-gray-400">No pods</p>
									{/if}
								{/each}

								{#if childData.replicaSets.filter((rs: any) => rs.desiredReplicas > 0).length === 0}
									<p class="px-9 py-2 text-xs text-gray-500 dark:text-gray-400">No active ReplicaSets</p>
								{/if}
							{/if}
						</div>
					{/if}
				</div>
			{/each}

			<!-- HTTPRoute resources -->
			{#each httpRouteResources as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
				{@const isReady = ['Ready','Healthy','Succeeded','Current'].includes(resource.status || '')}
				{@const isFailing = ['Unhealthy','Failed','Error'].includes(resource.status || '')}
				{@const isReconciling = resource.status === 'Reconciling'}
				{@const urls = getHTTPRouteURLs(resource)}

				<div class="{isFailing ? 'bg-red-50 dark:bg-red-950/10' : isReconciling ? 'bg-yellow-50/50 dark:bg-yellow-950/5' : ''}">
					<!-- HTTPRoute row -->
					<div class="flex items-center gap-2 px-4 py-2.5">
						<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center">
							{#if isFailing}
								<ExclamationCircleSolid class="h-4 w-4 text-red-500 dark:text-red-400" />
							{:else if isReconciling}
								<StatusSpinner size="4" color="yellow" />
							{:else if isReady}
								<CheckCircleSolid class="h-4 w-4 text-green-700 dark:text-green-400" />
							{:else}
								<ExclamationCircleSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5">
								<span class="truncate text-xs font-medium text-gray-900 dark:text-white">{resource.name}</span>
								<span class="shrink-0 rounded bg-gray-100 px-1 py-0.5 t-micro text-gray-700 dark:bg-gray-700 dark:text-gray-300">HTTPRoute</span>
							</div>
							{#if resource.message && !isReady}
								<p class="mt-0.5 break-words t-micro text-gray-500 dark:text-gray-400">{resource.message}</p>
							{/if}
						</div>
						<span class="shrink-0 t-label rounded-full px-1.5 py-0.5
							{isFailing ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
							: isReconciling ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
							: isReady ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
							: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}">
							{resourceStatusWord(resource.status)}
						</span>
						<!-- ⛔ F4 (finding 13): FIXED COLUMNS — THE CHEVRON HAS ITS OWN
						     TRACK WHETHER PRESENT OR NOT. (2026-09-03) The Deployment
						     row above ends in a real toggle button; this row (and the
						     two below) had nothing there, so the status chip — the same
						     `Current` pill, same column, same card — landed 26px further
						     right. Measured on the live cluster: 1358 (Deployment row)
						     vs 1384 (this row). An `invisible` same-box spacer keeps the
						     chip's right edge identical without adding a fake control. -->
						<span class="invisible shrink-0 rounded p-0.5" aria-hidden="true">
							<ChevronRightOutline class="h-3.5 w-3.5" />
						</span>
					</div>

					<!-- URL children -->
					{#if urls.length > 0}
						<div class="border-t border-gray-100 bg-gray-50/50 dark:border-gray-700/50 dark:bg-gray-800/50">
							{#each urls as url}
								<div class="flex items-center gap-2 py-1.5 pl-9 pr-4">
									<ArrowUpRightFromSquareOutline class="h-3 w-3 flex-shrink-0 text-blue-600 dark:text-blue-400" />
									<a
										href={url}
										target="_blank"
										rel="noopener noreferrer"
										class="truncate text-xs text-blue-600 hover:underline dark:text-blue-400"
									>{url}</a>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Non-ready other-resources: always visible -->
		{#if visibleOtherResources.length > 0}
			<div class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700/50 dark:border-gray-700/50">
				{#each visibleOtherResources as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
					{@const isFailing = ['Unhealthy', 'Failed', 'Error'].includes(resource.status || '')}
					{@const isReconciling = resource.status === 'Reconciling'}
					<div class="flex items-center gap-2 px-4 py-2 {isFailing ? 'bg-red-50 dark:bg-red-950/10' : isReconciling ? 'bg-yellow-50/50 dark:bg-yellow-950/5' : ''}">
						<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center">
							{#if isFailing}
								<ExclamationCircleSolid class="h-4 w-4 text-red-500 dark:text-red-400" />
							{:else if isReconciling}
								<StatusSpinner size="4" color="yellow" />
							{:else if resource.status === 'Pending' || resource.status === 'InProgress'}
								<StatusSpinner size="4" color="blue" />
							{:else}
								<ExclamationCircleSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-1.5">
								<span class="truncate text-xs text-gray-700 dark:text-gray-300">{resource.name}</span>
								<span class="shrink-0 rounded bg-gray-100 px-1 py-0.5 t-micro text-gray-700 dark:bg-gray-700 dark:text-gray-300">{resource.type}</span>
							</div>
							{#if resource.message}
								<p class="mt-0.5 break-words t-micro text-gray-500 dark:text-gray-400">{resource.message}</p>
							{/if}
						</div>
						<span class="shrink-0 t-label rounded-full px-1.5 py-0.5
							{isFailing ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
							: isReconciling ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
							: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}">
							{resourceStatusWord(resource.status)}
						</span>
						<!-- Fixed chevron column — see the note beside the HTTPRoute
						     row above (finding 13). -->
						<span class="invisible shrink-0 rounded p-0.5" aria-hidden="true">
							<ChevronRightOutline class="h-3.5 w-3.5" />
						</span>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Ready resources (hidden by default) -->
		{#if collapsibleOtherResources.length > 0}
			<button
				type="button"
				onclick={() => { showOtherResources = !showOtherResources; }}
				aria-expanded={showOtherResources}
				aria-controls="resources-card-ready"
				class="flex w-full items-center gap-1.5 border-t border-gray-100 px-4 py-2 text-left text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700/50 dark:text-gray-400 dark:hover:bg-gray-700/30"
			>
				{#if showOtherResources}
					<ChevronDownOutline class="h-3 w-3" aria-hidden="true" />
				{:else}
					<ChevronRightOutline class="h-3 w-3" aria-hidden="true" />
				{/if}
				{showOtherResources ? 'Hide' : 'Show'} {collapsibleOtherResources.length} ready resource{collapsibleOtherResources.length !== 1 ? 's' : ''}
			</button>

			{#if showOtherResources}
				<div id="resources-card-ready" class="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700/50 dark:border-gray-700/50">
					{#each collapsibleOtherResources as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
						{@const isReady = ['Ready','Healthy','Succeeded','Current'].includes(resource.status || '')}
						{@const isFailing = ['Unhealthy','Failed','Error'].includes(resource.status || '')}
						{@const isReconciling = resource.status === 'Reconciling'}
						<div class="flex items-center gap-2 px-4 py-2 {isFailing ? 'bg-red-50 dark:bg-red-950/10' : isReconciling ? 'bg-yellow-50/50 dark:bg-yellow-950/5' : ''}">
							<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center">
								{#if isFailing}
									<ExclamationCircleSolid class="h-4 w-4 text-red-500 dark:text-red-400" />
								{:else if isReconciling}
									<StatusSpinner size="4" color="yellow" />
								{:else if resource.status === 'Pending' || resource.status === 'InProgress'}
									<StatusSpinner size="4" color="blue" />
								{:else if isReady}
									<CheckCircleSolid class="h-4 w-4 text-green-700 dark:text-green-400" />
								{:else}
									<ExclamationCircleSolid class="h-4 w-4 text-gray-500 dark:text-gray-400" />
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-1.5">
									<span class="truncate text-xs text-gray-700 dark:text-gray-300">{resource.name}</span>
									<span class="shrink-0 rounded bg-gray-100 px-1 py-0.5 t-micro text-gray-700 dark:bg-gray-700 dark:text-gray-300">{resource.type}</span>
								</div>
								{#if resource.message && !isReady}
									<p class="mt-0.5 break-words t-micro text-gray-500 dark:text-gray-400">{resource.message}</p>
								{/if}
							</div>
							<span class="shrink-0 t-label rounded-full px-1.5 py-0.5
								{isFailing ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
								: isReconciling ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
								: isReady ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
								: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'}">
								{resourceStatusWord(resource.status)}
							</span>
							<!-- Fixed chevron column — see the note beside the HTTPRoute
							     row (finding 13). -->
							<span class="invisible shrink-0 rounded p-0.5" aria-hidden="true">
								<ChevronRightOutline class="h-3.5 w-3.5" />
							</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</Card>
{/if}

<style>
	/*
	 * ⭐ F4: THE `Deployment` TAG AND `pods` WORD DROP ON THE CARD'S OWN
	 * WIDTH, NOT THE VIEWPORT. (2026-09-03, breakpoints pass) `sm:inline` /
	 * `sm:inline-block` hid them below 640px of VIEWPORT — a guard that
	 * never fires once this card is used inside rollout detail's rail,
	 * because the rail sits at 1024–1440+ viewport while its OWN rendered
	 * width is 352–486px (a fixed `minmax(22rem, 2fr)` track that can never
	 * clear 640, since it is capped by the page's own 1280px content cap).
	 * Measured on the live page: the name column down to 44px beside 200px
	 * of `Deployment 2/2 pods CURRENT` — the exact "type tag repeated on
	 * every row" clutter the row's own F7 note already argued against, just
	 * arriving through the wrong signal. No `container-type` declared here:
	 * `Card.svelte`'s own `<section class="card-cq">` — this component
	 * always renders inside a `Card` — is already the nearest container
	 * ancestor, so this reuses that context rather than nesting a second
	 * one.
	 */
	@container (min-width: 640px) {
		.rc-type-tag {
			display: inline-block;
		}
		.rc-pods-word {
			display: inline;
		}
	}
</style>
