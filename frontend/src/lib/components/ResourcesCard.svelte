<svelte:options runes={true} />

<script lang="ts">
	import type { Kustomization, OCIRepository, ManagedResourceStatus } from '../../types';
	import StatusSpinner from './StatusSpinner.svelte';
	import Card from './Card.svelte';
	import DeploymentChildren from './DeploymentChildren.svelte';
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
		// Spoke URL when this rollout lives on a remote cluster — passed through
		// to `DeploymentChildren`, which is what actually fetches per-deployment
		// children now (see that component's own doc comment).
		cluster?: string;
	} = $props();


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
	// Track which deployments were auto-expanded (to avoid re-expanding after manual collapse)
	let autoExpandedKeys = $state<Set<string>>(new Set());

	// Auto-expand not-ready deployments once when they first appear not-ready.
	// ⭐ PERF-2026-09-04 — no fetch here any more. `expandedDeployments` only
	// decides whether `DeploymentChildren` is mounted (see the template
	// below); that component owns its own query now, so expanding a row
	// (auto or manual) no longer means this component reaches for `fetch`.
	$effect(() => {
		for (const resource of deploymentResources) {
			const isReady = ['Ready', 'Healthy', 'Succeeded', 'Current'].includes(resource.status || '');
			const key = getDeploymentKey(resource);
			if (!isReady && !autoExpandedKeys.has(key)) {
				autoExpandedKeys = new Set([...autoExpandedKeys, key]);
				expandedDeployments = new Set([...expandedDeployments, key]);
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

	// ⭐ PERF-2026-09-04 — a plain toggle. `DeploymentChildren` (mounted only
	// while `isExpanded`, see the template) owns fetching its own children
	// now, so this function no longer touches `fetch` or a cache at all.
	function toggleDeploymentChildren(resource: any) {
		const key = getDeploymentKey(resource);
		if (expandedDeployments.has(key)) {
			expandedDeployments = new Set([...expandedDeployments].filter((k) => k !== key));
		} else {
			expandedDeployments = new Set([...expandedDeployments, key]);
		}
	}

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

	/**
	 * ⛔ P10, OPERATOR-WALK FINDING (2026-09-03): "Resources 10/10 ready"
	 * WHILE FLUX SAID "Pending resources: hello-python (ReplicaSet not
	 * Available)". `notReadyResources` is derived entirely from
	 * `filteredManagedResources` — each item's OWN `.status`, as this
	 * dashboard's backend classifies it. `kustomizations` was a prop this
	 * component already received and never read: Flux's Kustomization
	 * controller runs a SEPARATE, more thorough health evaluation (kstatus)
	 * over the same inventory and publishes its verdict on the
	 * Kustomization's own `Ready` condition — including cases this
	 * component's simpler per-resource status missed. A rollup that ignores
	 * the more authoritative source and reports "ready" anyway is a false
	 * "all clear".
	 *
	 * This does not try to re-derive WHICH resource Flux considers
	 * unhealthy or reproduce kstatus — that is Flux's job, not this
	 * dashboard's. It only refuses to say "ready" when Flux itself has not
	 * said so, and surfaces Flux's own message (the fact this dashboard
	 * cannot originate) rather than inventing a different one.
	 */
	const unreadyKustomizations = $derived(
		kustomizations.filter((k) => {
			const ready = (k.status?.conditions ?? []).find((c) => c.type === 'Ready');
			return !!ready && ready.status !== 'True';
		})
	);
	const fluxDisagrees = $derived(notReadyResources.length === 0 && unreadyKustomizations.length > 0);
	const HeaderIcon = $derived(
		failedInHeader.length > 0
			? ExclamationCircleSolid
			: notReadyResources.length > 0 || fluxDisagrees
				? ClockSolid
				: CheckCircleSolid
	);
	const headerIconClass = $derived(
		failedInHeader.length > 0
			? 'text-red-500 dark:text-red-400'
			: notReadyResources.length > 0 || fluxDisagrees
				? 'text-yellow-700 dark:text-yellow-400'
				: 'text-green-700 dark:text-green-400'
	);

	// getPodStatusColor/getPodStatusLabel moved into DeploymentChildren.svelte
	// with the rest of the expanded-children rendering they served.
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
			{:else if fluxDisagrees}
				<!-- ⛔ EVERY RESOURCE THIS CARD KNOWS ABOUT LOOKS READY, AND FLUX
				     STILL SAYS OTHERWISE. Named, not silenced — see
				     `unreadyKustomizations`'s own note above. -->
				{@const msg = unreadyKustomizations[0]?.status?.conditions?.find((c) => c.type === 'Ready')?.message}
				<span
					class="text-xs text-yellow-700 dark:text-yellow-400"
					title={msg ?? 'Flux has not marked this Kustomization Ready'}
				>
					Flux reports issues
				</span>
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
						<span class="chip t-chip shrink-0
							{isFailing ? 'border-gray-200 text-red-700 dark:border-gray-700 dark:text-red-400'
							: isReconciling ? 'border-gray-200 text-yellow-700 dark:border-gray-700 dark:text-yellow-400'
							: isReady ? 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
							: 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}">
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

					<!-- Expanded children — own query, own cadence. See
					     `DeploymentChildren.svelte`'s own doc comment: mounted only
					     while `isExpanded`, which is what makes this "enabled only
					     while expanded" rather than a flag to remember to flip. -->
					{#if isExpanded}
						<DeploymentChildren namespace={resource.namespace} name={resource.name} {cluster} />
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
						<span class="chip t-chip shrink-0
							{isFailing ? 'border-gray-200 text-red-700 dark:border-gray-700 dark:text-red-400'
							: isReconciling ? 'border-gray-200 text-yellow-700 dark:border-gray-700 dark:text-yellow-400'
							: isReady ? 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
							: 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}">
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
						<span class="chip t-chip shrink-0
							{isFailing ? 'border-gray-200 text-red-700 dark:border-gray-700 dark:text-red-400'
							: isReconciling ? 'border-gray-200 text-yellow-700 dark:border-gray-700 dark:text-yellow-400'
							: 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}">
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
							<span class="chip t-chip shrink-0
								{isFailing ? 'border-gray-200 text-red-700 dark:border-gray-700 dark:text-red-400'
								: isReconciling ? 'border-gray-200 text-yellow-700 dark:border-gray-700 dark:text-yellow-400'
								: isReady ? 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
								: 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}">
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
