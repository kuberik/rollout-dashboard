<svelte:options runes={true} />

<script lang="ts">
	import type { Rollout } from '../types';
	import { Alert, Sidebar, SidebarGroup } from 'flowbite-svelte';
	import { SearchOutline, ArrowUpOutline, HeartSolid } from 'flowbite-svelte-icons';
	import { getDisplayVersion } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import BakeStatusIcon from '$lib/components/BakeStatusIcon.svelte';

	const rolloutsQuery = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 30000 } })
	);

	const rollouts = $derived<Rollout[]>(rolloutsQuery.data?.rollouts?.items || []);
	const loading  = $derived(rolloutsQuery.isLoading);
	const error    = $derived(
		rolloutsQuery.isError ? (rolloutsQuery.error as Error).message || 'Unknown error' : null
	);

	let searchQuery     = $state('');
	let namespaceFilter = $state('all');
	let statusFilter    = $state('all');

	const uniqueNamespaces = $derived(
		[...new Set(rollouts.map((r) => r.metadata?.namespace || 'default'))].sort()
	);

	const STATUS_TEXT: Record<string, string> = {
		Succeeded:  'text-green-600 dark:text-green-400',
		Failed:     'text-red-600 dark:text-red-400',
		InProgress: 'text-yellow-600 dark:text-yellow-400',
		Deploying:  'text-blue-600 dark:text-blue-400',
		Cancelled:  'text-gray-500 dark:text-gray-400',
		None:       'text-gray-400 dark:text-gray-500',
	};

	const ACTIVE_LABEL: Record<string, string> = {
		InProgress: 'Baking',
		Deploying:  'Deploying',
	};

	function getBakeStatus(r: Rollout): string {
		return r.status?.history?.[0]?.bakeStatus || 'None';
	}

	function compactTime(timestamp: string, n: Date): string {
		const s = Math.floor((n.getTime() - new Date(timestamp).getTime()) / 1000);
		if (s < 60)    return `${s}s`;
		if (s < 3600)  return `${Math.floor(s / 60)}m`;
		if (s < 86400) return `${Math.floor(s / 3600)}h`;
		return `${Math.floor(s / 86400)}d`;
	}

	function parseDuration(duration: string): number {
		const m = duration.match(/^(\d+)([smhd])$/);
		if (!m) return 0;
		const v = parseInt(m[1]);
		switch (m[2]) {
			case 's': return v * 1000;
			case 'm': return v * 60000;
			case 'h': return v * 3600000;
			case 'd': return v * 86400000;
			default:  return 0;
		}
	}

	const STATUS_SORT: Record<string, number> = {
		Failed: 0, InProgress: 1, Deploying: 2, None: 3, Cancelled: 4, Succeeded: 5
	};

	const filteredRolloutsByNamespace = $derived.by(() => {
		const filtered = rollouts
			.filter((r) => {
				const ns   = r.metadata?.namespace || 'default';
				const name = r.metadata?.name || '';
				const st   = getBakeStatus(r);
				const matchesSearch = searchQuery === '' ||
					name.toLowerCase().includes(searchQuery.toLowerCase()) ||
					ns.toLowerCase().includes(searchQuery.toLowerCase());
				const matchesNs = namespaceFilter === 'all' || ns === namespaceFilter;
				const matchesStatus =
					statusFilter === 'all'       ||
					(statusFilter === 'active'    && (st === 'InProgress' || st === 'Deploying')) ||
					(statusFilter === 'failed'    && st === 'Failed') ||
					(statusFilter === 'succeeded' && st === 'Succeeded') ||
					(statusFilter === 'idle'      && st === 'None');
				return matchesSearch && matchesNs && matchesStatus;
			})
			.sort((a, b) => {
				const diff = (STATUS_SORT[getBakeStatus(a)] ?? 3) - (STATUS_SORT[getBakeStatus(b)] ?? 3);
				return diff !== 0 ? diff : (a.metadata?.name || '').localeCompare(b.metadata?.name || '');
			});

		const grouped: Record<string, Rollout[]> = {};
		filtered.forEach((r) => {
			const ns = r.metadata?.namespace || 'default';
			if (!grouped[ns]) grouped[ns] = [];
			grouped[ns].push(r);
		});
		return Object.keys(grouped).sort().map((ns) => ({ ns, rollouts: grouped[ns] }));
	});

	const totalFiltered = $derived(
		filteredRolloutsByNamespace.reduce((s, g) => s + g.rollouts.length, 0)
	);

	const statusCounts = $derived.by(() => {
		const c = { active: 0, failed: 0, succeeded: 0, idle: 0 };
		rollouts.forEach((r) => {
			const st = getBakeStatus(r);
			if (st === 'InProgress' || st === 'Deploying') c.active++;
			else if (st === 'Failed')    c.failed++;
			else if (st === 'Succeeded') c.succeeded++;
			else if (st === 'None')      c.idle++;
		});
		return c;
	});

	// Flowbite SidebarItem-compatible active/inactive classes
	function sidebarItemClass(active: boolean) {
		return `flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-left transition-colors ${
			active
				? 'bg-gray-100 font-semibold text-gray-900 dark:bg-gray-700 dark:text-white'
				: 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white'
		}`;
	}
</script>

<div class="flex h-full overflow-hidden">

	<!-- ── Sidebar (desktop only) ── -->
	<div class="hidden lg:block">
		<Sidebar class="h-full border-r border-gray-200 dark:border-gray-700" position="static">
			<div class="flex flex-col gap-4 px-3 py-4">

				<!-- Search -->
				<div class="relative">
					<SearchOutline class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
					<input
						type="search"
						placeholder="Search…"
						bind:value={searchQuery}
						class="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
					/>
				</div>

				<!-- Status filter group -->
				<SidebarGroup>
					<p class="mb-1 px-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Status</p>
					<button onclick={() => (statusFilter = 'all')} class={sidebarItemClass(statusFilter === 'all')}>
						All
						<span class="text-xs tabular-nums text-gray-400 dark:text-gray-500">{rollouts.length}</span>
					</button>
					<button onclick={() => (statusFilter = 'active')} class={sidebarItemClass(statusFilter === 'active')}>
						<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-yellow-400"></span>Active</span>
						<span class="text-xs tabular-nums {statusCounts.active > 0 ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}">{statusCounts.active}</span>
					</button>
					<button onclick={() => (statusFilter = 'failed')} class={sidebarItemClass(statusFilter === 'failed')}>
						<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-red-500"></span>Failed</span>
						<span class="text-xs tabular-nums {statusCounts.failed > 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'text-gray-300 dark:text-gray-600'}">{statusCounts.failed}</span>
					</button>
					<button onclick={() => (statusFilter = 'succeeded')} class={sidebarItemClass(statusFilter === 'succeeded')}>
						<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-green-500"></span>Succeeded</span>
						<span class="text-xs tabular-nums text-gray-400 dark:text-gray-500">{statusCounts.succeeded}</span>
					</button>
					<button onclick={() => (statusFilter = 'idle')} class={sidebarItemClass(statusFilter === 'idle')}>
						<span class="flex items-center gap-2"><span class="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600"></span>Idle</span>
						<span class="text-xs tabular-nums text-gray-400 dark:text-gray-500">{statusCounts.idle}</span>
					</button>
				</SidebarGroup>

				<!-- Namespace filter group -->
				{#if uniqueNamespaces.length > 1}
					<SidebarGroup border>
						<p class="mb-1 px-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">Namespace</p>
						<button onclick={() => (namespaceFilter = 'all')} class={sidebarItemClass(namespaceFilter === 'all')}>All</button>
						{#each uniqueNamespaces as ns}
							<button onclick={() => (namespaceFilter = ns)} class={sidebarItemClass(namespaceFilter === ns)}>
								<span class="truncate">{ns}</span>
							</button>
						{/each}
					</SidebarGroup>
				{/if}

			</div>
		</Sidebar>
	</div>

	<!-- ── Right side: mobile filter bar + cards ── -->
	<div class="flex min-w-0 flex-1 flex-col overflow-hidden">

		<!-- Mobile filter bar (hidden on desktop) -->
		<div class="sticky top-0 z-10 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 lg:hidden">
			<div class="flex flex-col gap-2 px-3 py-2.5">
				<!-- Search -->
				<div class="relative">
					<SearchOutline class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
					<input
						type="search"
						placeholder="Search rollouts…"
						bind:value={searchQuery}
						class="w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
					/>
				</div>
				<!-- Selects row -->
				<div class="flex gap-2">
					<select
						bind:value={statusFilter}
						class="min-w-0 flex-1 rounded-md border border-gray-200 bg-gray-50 py-1.5 px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
					>
						<option value="all">All statuses</option>
						<option value="active">Active ({statusCounts.active})</option>
						<option value="failed">Failed ({statusCounts.failed})</option>
						<option value="succeeded">Succeeded ({statusCounts.succeeded})</option>
						<option value="idle">Idle ({statusCounts.idle})</option>
					</select>
					{#if uniqueNamespaces.length > 1}
						<select
							bind:value={namespaceFilter}
							class="min-w-0 flex-1 rounded-md border border-gray-200 bg-gray-50 py-1.5 px-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
						>
							<option value="all">All namespaces</option>
							{#each uniqueNamespaces as ns}
								<option value={ns}>{ns}</option>
							{/each}
						</select>
					{/if}
				</div>
			</div>
		</div>

		<!-- Cards area -->
		<div class="flex-1 overflow-y-auto dark:bg-gray-900">
			{#if loading}
				<div class="grid grid-cols-1 gap-2.5 p-4 sm:grid-cols-2 xl:grid-cols-3">
					{#each Array(6) as _}
						<div class="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
							<div class="flex items-center gap-2.5">
								<div class="h-3 w-3 shrink-0 animate-pulse rounded-full bg-gray-200 dark:bg-gray-700"></div>
								<div class="h-3 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
								<div class="h-3 w-8 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
							</div>
							<div class="mt-2 flex gap-2 pl-5">
								<div class="h-2.5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else if error}
				<div class="p-4"><Alert color="red">{error}</Alert></div>
			{:else if rollouts.length === 0}
				<div class="p-4"><Alert color="yellow">No rollouts found</Alert></div>
			{:else if totalFiltered === 0}
				<div class="py-16 text-center">
					<p class="text-sm text-gray-500 dark:text-gray-400">No results.</p>
					<button
						onclick={() => { searchQuery = ''; namespaceFilter = 'all'; statusFilter = 'all'; }}
						class="mt-2 text-xs text-blue-600 hover:underline dark:text-blue-400"
					>Clear filters</button>
				</div>
			{:else}
				<div class="flex flex-col gap-4 p-3 sm:p-4">
					{#each filteredRolloutsByNamespace as group}
						<div>
							{#if filteredRolloutsByNamespace.length > 1}
								<div class="mb-2 flex items-center gap-2.5">
									<span class="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">{group.ns}</span>
									<div class="h-px flex-1 bg-gray-200 dark:bg-gray-700"></div>
								</div>
							{/if}

							<div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
								{#each group.rollouts as r}
									{@const ns            = r.metadata?.namespace || 'default'}
									{@const name          = r.metadata?.name || ''}
									{@const latest        = r.status?.history?.[0]}
									{@const status        = getBakeStatus(r)}
									{@const versionLabel  = latest?.version ? getDisplayVersion(latest.version) : null}
									{@const upgradeCount  = r.status?.releaseCandidates?.length || 0}
									{@const failedHCCount = latest?.failedHealthChecks?.length || 0}
									{@const activeLabel   = ACTIVE_LABEL[status] ?? null}
									{@const statusText    = STATUS_TEXT[status] ?? STATUS_TEXT['None']}
									{@const bakeProgressPct = (() => {
										if (status !== 'InProgress' || !latest?.bakeStartTime || !r.spec?.bakeTime) return null;
										const elapsed = $now.getTime() - new Date(latest.bakeStartTime).getTime();
										const total = parseDuration(r.spec.bakeTime);
										return total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : null;
									})()}

									<a
										href="/rollouts/{ns}/{name}"
										class="group flex flex-col overflow-hidden rounded-lg border transition-colors
											{status === 'Failed'
												? 'border-red-200 bg-red-50 hover:border-red-300 dark:border-red-900/50 dark:bg-red-950/20 dark:hover:border-red-800'
												: 'border-gray-200 bg-white hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600'}"
									>
										<div class="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
											<BakeStatusIcon bakeStatus={status} size="small" class="shrink-0" />
											<span class="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 dark:text-white">{name}</span>
											{#if latest?.timestamp}
												<span class="shrink-0 text-xs tabular-nums text-gray-400 dark:text-gray-500">{compactTime(latest.timestamp, $now)}</span>
											{/if}
										</div>
										<div class="flex min-h-[1.75rem] items-center gap-1.5 px-3 pb-2.5 pl-7">
											{#if versionLabel}
												<span class="font-mono text-xs text-gray-400 dark:text-gray-500">{versionLabel}</span>
											{/if}
											{#if activeLabel}
												<span class="text-xs font-medium {statusText}">{activeLabel}</span>
											{/if}
											<div class="flex-1"></div>
											{#if upgradeCount > 0}
												<span class="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
													<ArrowUpOutline class="h-2.5 w-2.5" />{upgradeCount}
												</span>
											{/if}
											{#if failedHCCount > 0}
												<span class="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
													<HeartSolid class="h-2.5 w-2.5" />{failedHCCount}
												</span>
											{/if}
										</div>
										{#if bakeProgressPct !== null}
											<div class="h-0.5 w-full bg-gray-100 dark:bg-gray-700">
												<div class="h-full bg-yellow-400 transition-all duration-300 dark:bg-yellow-500" style="width: {bakeProgressPct}%"></div>
											</div>
										{/if}
									</a>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

</div>
