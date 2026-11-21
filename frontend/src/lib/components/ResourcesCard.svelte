<svelte:options runes={true} />

<script lang="ts">
	import type { Kustomization, HelmRelease, OCIRepository, ManagedResourceStatus } from '../../types';
	import Chip from './Chip.svelte';
	import { helmView, helmKey, isHelmKey, helmEmptyLine, type HelmNote, type HelmView, type HelmWord } from '$lib/view-models/helm';
	import StatusSpinner from './StatusSpinner.svelte';
	import Card from './Card.svelte';
	import DeploymentChildren from './DeploymentChildren.svelte';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		ClockSolid,
		CubeSolid,
		ChevronDownOutline,
		ChevronRightOutline,
		ArrowUpRightFromSquareOutline
	} from 'flowbite-svelte-icons';
	import { getResourceStatus, getLastTransitionTime } from '$lib/utils';

	/**
	 * ROLE: the rollout page's Resources card. A HelmRelease the rollout deploys is one GROUP in it, beside the Kustomizations' flat
	 * list: a header row (name, chart + version, helm revision, Ready word) over the resources helm-controller manages. The
	 * group's rows ARE the Kustomization rows (the `deploymentRow` / `routeRow` / `otherRow` snippets below, one drawing each), so a
	 * Deployment inside a HelmRelease has the same card and the same pods drill-down as one inside a Kustomization.
	 *
	 * WHY A GROUP HEADER AND NOT A NEW CARD: nothing in the product groups rows inside a card, but a second card per release would
	 * split "what did this rollout deploy" over N cards. The header borrows its proportions from the card's own rows (px-4, `t-code-sm`
	 * name, `t-meta` second line) on the `bg-subtle` ground the expanded pod list already uses to mean "belongs to the row above".
	 */
	let {
		kustomizations,
		helmReleases = [],
		helmNotes = {},
		ociRepositories,
		filteredManagedResources,
		cluster
	}: {
		kustomizations: Kustomization[];
		/** the rollout's HelmReleases; their resources sit in `filteredManagedResources` under `helmKey(namespace, name)` */
		helmReleases?: HelmRelease[];
		/** per HelmRelease key: the backend hint, or why its managed-resources fetch failed */
		helmNotes?: Record<string, HelmNote>;
		ociRepositories: OCIRepository[];
		filteredManagedResources: Record<string, ManagedResourceStatus[]>;
		// Spoke URL when this rollout lives on a remote cluster — passed through
		// to `DeploymentChildren`, which is what actually fetches per-deployment
		// children now (see that component's own doc comment).
		cluster?: string;
	} = $props();


	const READY_STATUSES = ['Ready', 'Healthy', 'Succeeded', 'Current'];
	type Typed = ManagedResourceStatus & { type: string };
	const typed = (list: ManagedResourceStatus[]): Typed[] =>
		list.map((r) => ({ ...r, type: r.groupVersionKind?.split('/').pop() || 'Resource' }));
	/** one list split the way every group of this card is drawn: Deployments, HTTPRoutes, then the rest (not-ready always visible, ready collapsible) */
	function split(list: Typed[]) {
		const others = list.filter((r) => r.type !== 'Deployment' && r.type !== 'HTTPRoute');
		return {
			deployments: list.filter((r) => r.type === 'Deployment'),
			routes: list.filter((r) => r.type === 'HTTPRoute'),
			visibleOthers: others.filter((r) => !READY_STATUSES.includes(r.status || '')),
			readyOthers: others.filter((r) => READY_STATUSES.includes(r.status || ''))
		};
	}

	// The Kustomizations' resources: the flat list at the top of the card
	const plainResources = $derived(
		typed(Object.entries(filteredManagedResources).filter(([k]) => !isHelmKey(k)).flatMap(([, v]) => v))
	);
	const plain = $derived(split(plainResources));
	const deploymentResources = $derived(plain.deployments);
	const httpRouteResources = $derived(plain.routes);
	const visibleOtherResources = $derived(plain.visibleOthers);
	const collapsibleOtherResources = $derived(plain.readyOthers);

	// One group per HelmRelease
	type HelmGroup = { key: string; view: HelmView; resources: Typed[] } & ReturnType<typeof split>;
	const helmGroups = $derived<HelmGroup[]>(
		helmReleases
			.filter((h) => Boolean(h.metadata?.name))
			.map((h) => {
				const view = helmView(h);
				const key = helmKey(view.namespace, view.name);
				const resources = typed(filteredManagedResources[key] ?? []);
				return { key, view, resources, ...split(resources) };
			})
	);

	// All managed resources (for status summary)
	const allManagedResources = $derived([...plainResources, ...helmGroups.flatMap((g) => g.resources)]);
	const allDeployments = $derived(allManagedResources.filter((r) => r.type === 'Deployment'));
	const hasPlain = $derived(plainResources.length > 0);

	const show = $derived(allManagedResources.length > 0 || helmGroups.length > 0);

	// Status summary uses ALL resources
	const notReadyResources = $derived(
		allManagedResources.filter(
			(r) => !READY_STATUSES.includes(r.status || '')
		)
	);

	// Toggle to reveal ready/healthy non-deployment resources
	let showOtherResources = $state(false);
	// Same toggle per HelmRelease group
	let showReadyInGroup = $state<Set<string>>(new Set());
	function toggleReadyInGroup(key: string) {
		const next = new Set(showReadyInGroup);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		showReadyInGroup = next;
	}

	const helmChip: Record<Exclude<HelmWord, 'Pending'>, 'ready' | 'issue'> = { Ready: 'ready', Failed: 'issue' };

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
		for (const resource of allDeployments) {
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
	const failedHelm = $derived(helmGroups.filter((g) => g.view.word === 'Failed'));
	const failedResources = $derived(
		notReadyResources.filter((r) => ['Unhealthy', 'Failed', 'Error'].includes(r.status || ''))
	);
	/** failed resources plus failed HelmReleases: what the header's "N failed" counts */
	const failedCount = $derived(failedResources.length + failedHelm.length);

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
	// A HelmRelease that is not Ready counts the way a not-Ready Kustomization does: its resources can all look fine while helm-controller is still working or has given up.
	const unreadyHelm = $derived(helmGroups.filter((g) => g.view.word !== 'Ready'));
	const fluxDisagrees = $derived(notReadyResources.length === 0 && (unreadyKustomizations.length > 0 || unreadyHelm.length > 0));
	const HeaderIcon = $derived(
		failedCount > 0
			? ExclamationCircleSolid
			: notReadyResources.length > 0 || fluxDisagrees
				? ClockSolid
				: CheckCircleSolid
	);
	const headerIconClass = $derived(
		failedCount > 0
			? 'text-danger'
			: notReadyResources.length > 0 || fluxDisagrees
				? 'text-progress'
				: 'text-success'
	);

	// getPodStatusColor/getPodStatusLabel moved into DeploymentChildren.svelte
	// with the rest of the expanded-children rendering they served.
</script>

{#snippet deploymentRow(resource: any)}
	{@const isReady = ['Ready','Healthy','Succeeded','Current'].includes(resource.status || '')}
	{@const isFailing = ['Unhealthy','Failed','Error'].includes(resource.status || '')}
	{@const isReconciling = resource.status === 'Reconciling'}
	{@const replicas = getDeploymentReplicas(resource)}
	{@const depKey = getDeploymentKey(resource)}
	{@const isExpanded = expandedDeployments.has(depKey)}

	<div class="{isFailing ? 'alert-fill-error' : isReconciling ? 'alert-fill-progress' : ''}">
		<!-- Deployment row -->
		<div class="flex items-center gap-2 px-4 py-3">
			<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center">
				{#if isFailing}
					<ExclamationCircleSolid class="h-4 w-4 text-danger" />
				{:else if isReconciling}
					<StatusSpinner size="4" color="yellow" />
				{:else if resource.status === 'Pending' || resource.status === 'InProgress'}
					<StatusSpinner size="4" color="blue" />
				{:else if isReady}
					<CheckCircleSolid class="h-4 w-4 text-success" />
				{:else}
					<ExclamationCircleSolid class="h-4 w-4 text-fg-subtle" />
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
						class="t-body truncate text-fg"
						title="{resource.name} — Deployment">{resource.name}</span
					>
					<span
						class="rc-type-tag hidden shrink-0 rounded-xs bg-subtle px-1 py-0.5 t-meta text-fg-muted"
						>Deployment</span
					>
				</div>
				{#if resource.message && !isReady}
					<p class="mt-0.5 break-words t-meta text-fg-subtle">{resource.message}</p>
				{/if}
			</div>
			{#if replicas}
				<span
					class="t-ui-sm shrink-0 tabular-nums {replicas.ready === replicas.total && replicas.total > 0 ? 'text-success' : replicas.ready < replicas.total ? 'text-progress' : 'text-fg-subtle'}"
					title="{replicas.ready}/{replicas.total} pods"
				>
					{replicas.ready}/{replicas.total}
					<span class="rc-pods-word hidden t-meta text-fg-subtle">pods</span>
				</span>
			{/if}
			{#if isFailing || isReconciling}
			<span class="chip t-label shrink-0
				{isFailing ? 'border-danger-line text-danger'
				: 'border-progress-line text-progress'}">
				{resourceStatusWord(resource.status)}
			</span>
			{/if}
			<!-- A chevron is not a name. `title` alone made this announce as
			     "Show pods" with no indication of WHICH deployment, and
			     `aria-expanded` was missing entirely, so the state the glyph
			     carries visually was carried by nothing else. -->
			<button
				type="button"
				onclick={() => toggleDeploymentChildren(resource)}
				class="btn btn-ghost btn-icon btn-xs shrink-0"
				aria-expanded={isExpanded}
				aria-label={`${isExpanded ? 'Hide' : 'Show'} pods for ${resource.name}`}
				title={isExpanded ? 'Hide pods' : 'Show pods'}
			>
				{#if isExpanded}
					<ChevronDownOutline class="h-3 w-3" aria-hidden="true" />
				{:else}
					<ChevronRightOutline class="h-3 w-3" aria-hidden="true" />
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
{/snippet}

{#snippet routeRow(resource: any)}
	{@const isReady = ['Ready','Healthy','Succeeded','Current'].includes(resource.status || '')}
	{@const isFailing = ['Unhealthy','Failed','Error'].includes(resource.status || '')}
	{@const isReconciling = resource.status === 'Reconciling'}
	{@const urls = getHTTPRouteURLs(resource)}

	<div class="{isFailing ? 'alert-fill-error' : isReconciling ? 'alert-fill-progress' : ''}">
		<!-- HTTPRoute row -->
		<div class="flex items-center gap-2 px-4 py-3">
			<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center">
				{#if isFailing}
					<ExclamationCircleSolid class="h-4 w-4 text-danger" />
				{:else if isReconciling}
					<StatusSpinner size="4" color="yellow" />
				{:else if isReady}
					<CheckCircleSolid class="h-4 w-4 text-success" />
				{:else}
					<ExclamationCircleSolid class="h-4 w-4 text-fg-subtle" />
				{/if}
			</div>
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5">
					<span class="t-body truncate text-fg">{resource.name}</span>
					<span class="shrink-0 rounded-xs bg-subtle px-1 py-0.5 t-meta text-fg-muted">HTTPRoute</span>
				</div>
				{#if resource.message && !isReady}
					<p class="mt-0.5 break-words t-meta text-fg-subtle">{resource.message}</p>
				{/if}
			</div>
			{#if isFailing || isReconciling}
			<span class="chip t-label shrink-0
				{isFailing ? 'border-danger-line text-danger'
				: 'border-progress-line text-progress'}">
				{resourceStatusWord(resource.status)}
			</span>
			{/if}
			<!-- ⛔ F4 (finding 13): FIXED COLUMNS — THE CHEVRON HAS ITS OWN
			     TRACK WHETHER PRESENT OR NOT. (2026-09-03) The Deployment
			     row above ends in a real toggle button; this row (and the
			     two below) had nothing there, so the status chip — the same
			     `Current` pill, same column, same card — landed 26px further
			     right. Measured on the live cluster: 1358 (Deployment row)
			     vs 1384 (this row). An `invisible` same-box spacer keeps the
			     chip's right edge identical without adding a fake control. -->
			<span class="invisible shrink-0 rounded p-0.5" aria-hidden="true">
				<ChevronRightOutline class="h-3 w-3" />
			</span>
		</div>

		<!-- URL children -->
		{#if urls.length > 0}
			<div class="border-t border-line-subtle bg-subtle">
				{#each urls as url}
					<div class="flex items-center gap-2 py-1.5 pl-9 pr-4">
						<ArrowUpRightFromSquareOutline class="h-3 w-3 flex-shrink-0 text-accent-text" />
						<a
							href={url}
							target="_blank"
							rel="noopener noreferrer"
							class="t-meta truncate text-accent-text hover:underline"
						>{url}</a>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#snippet otherRow(resource: any)}
	{@const isReady = ['Ready','Healthy','Succeeded','Current'].includes(resource.status || '')}
	{@const isFailing = ['Unhealthy','Failed','Error'].includes(resource.status || '')}
	{@const isReconciling = resource.status === 'Reconciling'}
	<div class="flex items-center gap-2 px-4 py-2 {isFailing ? 'alert-fill-error' : isReconciling ? 'alert-fill-progress' : ''}">
		<div class="flex h-5 w-5 flex-shrink-0 items-center justify-center">
			{#if isFailing}
				<ExclamationCircleSolid class="h-4 w-4 text-danger" />
			{:else if isReconciling}
				<StatusSpinner size="4" color="yellow" />
			{:else if resource.status === 'Pending' || resource.status === 'InProgress'}
				<StatusSpinner size="4" color="blue" />
			{:else if isReady}
				<CheckCircleSolid class="h-4 w-4 text-success" />
			{:else}
				<ExclamationCircleSolid class="h-4 w-4 text-fg-subtle" />
			{/if}
		</div>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-1.5">
				<span class="t-body truncate text-fg-muted">{resource.name}</span>
				<span class="t-code-sm shrink-0 text-fg-subtle">{resource.type}</span>
			</div>
			{#if resource.message && !isReady}
				<p class="mt-0.5 break-words t-meta text-fg-subtle">{resource.message}</p>
			{/if}
		</div>
		{#if isFailing || isReconciling}
		<span class="chip t-label shrink-0
			{isFailing ? 'border-danger-line text-danger'
			: 'border-progress-line text-progress'}">
			{resourceStatusWord(resource.status)}
		</span>
		{/if}
		<!-- Fixed chevron column — see the note beside the HTTPRoute
		     row (finding 13). -->
		<span class="invisible shrink-0 rounded p-0.5" aria-hidden="true">
			<ChevronRightOutline class="h-3 w-3" />
		</span>
	</div>
{/snippet}

{#if show}
	<Card icon={HeaderIcon} iconClass={headerIconClass} title="Resources" padded={false}>
		{#snippet rollup()}
			{#if failedCount > 0}
				{@const reconcilingCount = notReadyResources.filter((r) => r.status === 'Reconciling').length}
				<span class="t-ui-sm text-danger">
					{failedCount} failed{reconcilingCount > 0 ? ` · ${reconcilingCount} reconciling` : ''}
				</span>
			{:else if notReadyResources.length > 0 || unreadyHelm.length > 0}
				<span class="t-ui-sm text-progress">{notReadyResources.length + (notReadyResources.length === 0 ? unreadyHelm.length : 0)} not ready</span>
			{:else if fluxDisagrees}
				<!-- ⛔ EVERY RESOURCE THIS CARD KNOWS ABOUT LOOKS READY, AND FLUX
				     STILL SAYS OTHERWISE. Named, not silenced — see
				     `unreadyKustomizations`'s own note above. -->
				{@const msg = unreadyKustomizations[0]?.status?.conditions?.find((c) => c.type === 'Ready')?.message}
				<span
					class="t-ui-sm text-progress"
					title={msg ?? 'Flux has not marked this Kustomization Ready'}
				>
					Flux reports issues
				</span>
			{:else}
				<span class="t-ui-sm text-success">{allManagedResources.length}/{allManagedResources.length} ready</span>
			{/if}
		{/snippet}
		<div class="divide-y divide-line-subtle">
			<!-- Deployment resources -->
			{#each deploymentResources as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
				{@render deploymentRow(resource)}
			{/each}

			<!-- HTTPRoute resources -->
			{#each httpRouteResources as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
				{@render routeRow(resource)}
			{/each}
		</div>

		<!-- Non-ready other-resources: always visible -->
		{#if visibleOtherResources.length > 0}
			<div class="divide-y divide-line-subtle border-t border-line-subtle">
				{#each visibleOtherResources as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
					{@render otherRow(resource)}
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
				class="t-ui-sm flex h-10 w-full items-center gap-2 border-t border-line-subtle px-4 text-left text-fg-subtle hover:bg-hover"
			>
				{#if showOtherResources}
					<ChevronDownOutline class="h-3 w-3" aria-hidden="true" />
				{:else}
					<ChevronRightOutline class="h-3 w-3" aria-hidden="true" />
				{/if}
				{showOtherResources ? 'Hide' : 'Show'} {collapsibleOtherResources.length} ready resource{collapsibleOtherResources.length !== 1 ? 's' : ''}
			</button>

			{#if showOtherResources}
				<div id="resources-card-ready" class="divide-y divide-line-subtle border-t border-line-subtle">
					{#each collapsibleOtherResources as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
						{@render otherRow(resource)}
					{/each}
				</div>
			{/if}
		{/if}
		<!-- One group per HelmRelease: header (name, chart + version, helm revision, Ready word), then the same rows as above. -->
		{#each helmGroups as g, gi (g.key)}
			{@const showReady = showReadyInGroup.has(g.key)}
			<section data-testid="helm-group" data-helm-word={g.view.word} class={hasPlain || gi > 0 ? 'border-t border-line-subtle' : ''}>
				<div class="bg-subtle px-4 py-2.5" data-testid="helm-group-header">
					<div class="flex items-center gap-2">
						<span class="flex h-5 w-5 shrink-0 items-center justify-center">
							<CubeSolid class="h-4 w-4 text-fg-subtle" aria-hidden="true" />
						</span>
						<span class="t-code-sm min-w-0 flex-1 truncate text-fg" title="{g.view.name} (HelmRelease)">{g.view.name}</span>
						{#if g.view.word === 'Pending'}
							<!-- the same amber outlined chip as a reconciling resource row above, so one card spells pending one way -->
							<span class="chip t-label shrink-0 border-progress-line text-progress">{g.view.word}</span>
						{:else}
							<Chip role={helmChip[g.view.word]} label={g.view.word} dot={false} />
						{/if}
					</div>
					<div class="mt-0.5 flex flex-wrap items-baseline gap-x-2 pl-7 t-meta text-fg-muted" data-testid="helm-group-meta">
						{#if g.view.chart}
							<span class="t-code-sm min-w-0 [overflow-wrap:anywhere]" title="chart {g.view.chart} {g.view.chartVersion}">{g.view.chart}{g.view.chartVersion ? ` ${g.view.chartVersion}` : ''}</span>
						{/if}
						{#if g.view.revision !== null}
							<span class="shrink-0" title="Helm release revision">rev {g.view.revision}</span>
						{/if}
						{#if g.view.appVersion}
							<span class="shrink-0 text-fg-subtle" title="Chart appVersion">app {g.view.appVersion}</span>
						{/if}
					</div>
					{#if g.view.word !== 'Ready' && g.view.message}
						<p class="mt-0.5 break-words pl-7 t-meta text-fg-subtle">{g.view.message}</p>
					{/if}
				</div>
				{#if g.resources.length === 0}
					<p class="border-t border-line-subtle px-4 py-3 t-meta {helmNotes[g.key]?.error ? 'text-danger' : 'text-fg-subtle'}" data-testid="helm-group-empty">
						{helmEmptyLine(helmNotes[g.key])}
					</p>
				{:else}
					<div class="divide-y divide-line-subtle border-t border-line-subtle">
						{#each g.deployments as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
							{@render deploymentRow(resource)}
						{/each}
						{#each g.routes as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
							{@render routeRow(resource)}
						{/each}
						{#each g.visibleOthers as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
							{@render otherRow(resource)}
						{/each}
					</div>
					{#if g.readyOthers.length > 0}
						<button
							type="button"
							onclick={() => toggleReadyInGroup(g.key)}
							aria-expanded={showReady}
							class="t-ui-sm flex h-10 w-full items-center gap-2 border-t border-line-subtle px-4 text-left text-fg-subtle hover:bg-hover"
						>
							{#if showReady}
								<ChevronDownOutline class="h-3 w-3" aria-hidden="true" />
							{:else}
								<ChevronRightOutline class="h-3 w-3" aria-hidden="true" />
							{/if}
							{showReady ? 'Hide' : 'Show'} {g.readyOthers.length} ready resource{g.readyOthers.length !== 1 ? 's' : ''}
						</button>
						{#if showReady}
							<div class="divide-y divide-line-subtle border-t border-line-subtle">
								{#each g.readyOthers as resource (resource.type + '/' + (resource.namespace || '') + '/' + resource.name)}
									{@render otherRow(resource)}
								{/each}
							</div>
						{/if}
					{/if}
				{/if}
			</section>
		{/each}
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
