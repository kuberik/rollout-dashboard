<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE OUTAGE GATE for the pages drawn from the fleet list (Home, Apps, Changes, Environments).
	 * Role: when `/api/rollouts` fails, the page must say so — it may never draw a calm page out of a failure
	 * (2026-08-31 operator critique, pinned by lib/outage-states.svelte.test.ts); and when the hub answers
	 * partially (`clusterErrors`), the page declares the missing cluster. No existing region plays this role for
	 * these pages: ErrorState and PartialDataNotice are the product's one failure/partial objects and are used
	 * as-is; this component only decides WHEN, so four pages do not each repeat the query and the branches.
	 * It reads the same cache entry as the pages' own list query (rolloutsListQueryKey), so it adds no request.
	 *
	 * LIVE DATA (r39, 2026-11-08): it is also the provider of the pages' data. It reads the queries every other page reads (the fleet list,
	 * the fleet health checks, the viewer's GitHub status, the GitHub changes), assembles them into one FleetSource and installs it for data.ts
	 * (home-data.ts `source()`); nothing here is new on the wire. Until the fleet list has answered it draws the page's skeleton (same
	 * container, a section header and two card shells), so the page never flashes an empty fleet; an unconnected GitHub is carried as
	 * `changesState`, which the pages that need changes state in a sentence.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import type { Snippet } from 'svelte';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { fleetHealthChecksQuery, rolloutHealthChecks } from '$lib/api/health-checks';
	import { fetchNetworkSchedules } from '$lib/api/schedules';
	import { fetchGithubStatus, githubStatusQueryKey } from '$lib/api/github';
	import { changesQueryOptions, FetchChangesError } from '$lib/api/changes';
	import { installLiveSource, liveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	import { onMount } from 'svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import { stickyList } from '$lib/view-models/sticky-supporting-lists';
	import type { KruiseRollout, Kustomization } from '../../../types';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';

	/** `bare`: a page that owns its own loading and failure states (the rollout detail and its Gates tab) mounts the gate only to install the live source for the model helpers (`approvalAskAt`): no skeleton, no error card, children always render and are told whether the source is `ready`. */
	let { subject = 'the fleet', bare = false, children }: { subject?: string; bare?: boolean; children: Snippet<[boolean]> } = $props();
	/* stream-aware like every fleet list: the change stream invalidates ['rollouts','all'], so a healthy stream backs the poll off */
	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: staleTimeWhenHealthy(10000, 30000), refetchInterval: pollWhenHealthy(10000, 60000) } })
	);
	const hcQuery = createQuery(() => fleetHealthChecksQuery());
	/* ONE /api/schedules request per cluster (the hub '' + the spokes), the join that lets a closed deploy window read as a window (data.ts windowCause) */
	const clusterNames = $derived(['', ...(query.data?.clusters ?? []).map((c) => c.name)]);
	const schedulesQuery = createQuery(() => ({
		queryKey: ['network-schedules', clusterNames],
		queryFn: () => fetchNetworkSchedules(clusterNames),
		staleTime: staleTimeWhenHealthy(15000, 30000),
		refetchInterval: pollWhenHealthy(30000, 60000),
		enabled: !!query.data
	}));
	const ghStatus = createQuery(() => ({ queryKey: githubStatusQueryKey, queryFn: fetchGithubStatus, staleTime: 300_000, refetchInterval: false as const }));
	const connected = $derived(!!ghStatus.data?.connected);
	const changesQuery = createQuery(() => changesQueryOptions({ days: 30, enabled: connected }));
	/* ages tick once a minute (the compact age has minute resolution) */
	let clock = $state(new Date());
	onMount(() => { const t = setInterval(() => (clock = new Date()), 60_000); return () => clearInterval(t); });

	const changesState = $derived<FleetSource['changesState']>(
		ghStatus.isLoading ? 'loading'
		: ghStatus.data?.configured === false ? 'not_configured'
		: !connected ? 'not_connected'
		: changesQuery.isError ? (changesQuery.error instanceof FetchChangesError && changesQuery.error.reason === 'not_connected' ? 'not_connected' : 'error')
		: changesQuery.isLoading ? 'loading' : 'ok'
	);
	/* last populated supporting lists: an empty one after a populated one is a failed server read, never "no canaries" (see sticky-supporting-lists.ts) */
	let lastKruise: readonly KruiseRollout[] | null = null;
	let lastKust: readonly Kustomization[] | null = null;
	const src = $derived.by<FleetSource | null>(() => {
		const d = query.data;
		if (!d) return null;
		const present = (d.rollouts?.items ?? []).length > 0;
		const kruiseRollouts = stickyList(lastKruise, d.kruiseRollouts?.items ?? [], present) as KruiseRollout[];
		const kustomizations = stickyList(lastKust, d.kustomizations?.items ?? [], present) as Kustomization[];
		lastKruise = kruiseRollouts; lastKust = kustomizations;
		return {
			rollouts: d.rollouts?.items ?? [],
			environments: d.environments?.items ?? [],
			rolloutDependencies: d.rolloutDependencies ?? null,
			kustomizations,
			kruiseRollouts,
			changes: changesQuery.data?.changes ?? [],
			changesState,
			healthChecks: hcQuery.data ? rolloutHealthChecks(hcQuery.data) : null,
			schedules: schedulesQuery.data ?? null,
			github: { configured: ghStatus.data?.configured ?? null, connected, login: ghStatus.data?.login, avatarUrl: ghStatus.data?.avatarUrl },
			me: connected ? (ghStatus.data?.login ?? '').toLowerCase() : '',
			now: clock
		};
	});
	/* installed BEFORE the children render, so their first derivation already reads the live source.
	 * It also READS the installed source, so it re-runs whenever someone clears or replaces it: on a client-side navigation the previous
	 * route's gate tears down (clearing the slot) AFTER this one installed, and an effect that only tracked `src` never ran again, leaving
	 * the page on its skeleton for good (2026-11-12; e2e/fleetgate-nav.test.ts). */
	$effect.pre(() => { if (src && liveSource() !== src) installLiveSource(src); });
	/* the live source never outlives its gate: a stale snapshot must not shadow the route that mounts next (batch4 #3b M1) */
	$effect(() => () => installLiveSource(null));
	const ready = $derived(!!src && liveSource() === src);
</script>

{#if bare}
	{@render children(ready)}
{:else if query.isError}
	<div class="w-full px-4 py-6 sm:px-6">
		<ErrorState
			error={query.error}
			{subject}
			backHref="/rollouts"
			backLabel="Go to Rollouts"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-2"
		/>
	</div>
{:else}
	{#if (query.data?.clusterErrors ?? []).length}
		<div class="w-full px-4 pt-6 sm:px-6">
			<PartialDataNotice errors={query.data?.clusterErrors ?? []} subject="this page" onRetry={() => query.refetch()} isRetrying={query.isFetching} />
		</div>
	{/if}
	{#if ready}
		{@render children(true)}
	{:else}
		<div class="w-full px-4 py-6 sm:px-6" data-fleet-loading aria-busy="true">
			<div class="flex flex-col gap-8">
				{#if query.isLoading}<StillTryingNotice failureCount={query.failureCount} />{/if}
				<div class="flex h-6 items-center gap-2"><SkeletonBar width="w-32" height="h-4" /></div>
				<CardSkeleton titleWidth="w-40" rollupWidth="w-24" rows={3} rowHeight={48} />
				<CardSkeleton titleWidth="w-32" rollupWidth="w-20" rows={4} rowHeight={48} />
			</div>
		</div>
	{/if}
{/if}
