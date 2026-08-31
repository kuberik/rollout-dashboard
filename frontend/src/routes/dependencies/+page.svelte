<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `/dependencies` — THE WHOLE NETWORK.
	 *
	 * From the human, verbatim: *"dependencies we used a full graph to show
	 * whole network of dependencies."* Said twice, after two rounds of
	 * per-rollout lists. This is the fleet-level answer the lists could not
	 * give: which services depend on which, in what release order, and where
	 * the network is blocked right now.
	 *
	 * ── ⭐ THE DATA IS ON THE LIST ENDPOINT ONLY ────────────────────────────
	 *
	 * `rolloutDependencies` is served by `GET /api/rollouts` with per-cluster
	 * attribution, and is **NOT** on `GET /api/rollouts/:ns/:name`. That
	 * omission caused a real bug the same night this page was designed. This
	 * page reads the list endpoint, which is also what `/rollouts`, `/apps` and
	 * `/` read, so it shares their cache.
	 *
	 * ── THE TWO REGIONS ─────────────────────────────────────────────────────
	 *
	 * 1. `Dependency network` — the graph. The SHAPE.
	 * 2. `Blocked links` — one card per held contract, naming the two services,
	 *    the constraint, the version the provider actually serves, and the
	 *    environments. The ACTION. It renders only when something is blocked;
	 *    showing a problem without offering the action is an unfinished design,
	 *    and drawing an empty "blocked" card would be drawing the norm.
	 *
	 * ── ⛔ THE EMPTY STATE IS THE COMMON CASE AND IT MUST NOT LOOK BROKEN ───
	 *
	 * Most clusters declare NO dependencies at all, and the human's standing
	 * complaint about pages with nothing wrong is that they *"look weird, like
	 * something is missing"*. So the empty state is not a shrug: it PROVES the
	 * page looked — `15 rollouts across 2 clusters, none declares a contract
	 * dependency` — and then explains what would put something here, with the
	 * CRD that does it. A graph of one node is the same case: one box and no
	 * edges is not a network, so it takes the same treatment.
	 */
	import { createQuery } from '@tanstack/svelte-query';
	import {
		ShareNodesSolid,
		LockSolid,
		ServerSolid,
		ArrowRightOutline,
		ExclamationCircleSolid
	} from 'flowbite-svelte-icons';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import ClusterMark from '$lib/components/ClusterMark.svelte';
	import DependencyNetwork from '$lib/components/DependencyNetwork.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy } from '$lib/api/errors';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import { getEnvironmentThemeStyle, type EnvironmentTheme } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import {
		buildDependencyGraph,
		filterByEnv,
		networkVerdict
	} from '$lib/view-models/dependency-graph';

	const query = createQuery(() =>
		rolloutsListQueryOptions({
			options: { staleTime: 15000, refetchInterval: pollWhenHealthy(15000) }
		})
	);

	const rollouts = $derived(query.data?.rollouts?.items ?? []);
	const environments = $derived(query.data?.environments?.items ?? []);
	const deps = $derived(query.data?.rolloutDependencies?.items ?? []);

	/**
	 * Namespace → environment tier, read off the `Environment` objects rather
	 * than off the namespace's NAME. `hello-dep-prod` happens to end in the
	 * tier word; nothing guarantees that, and a heuristic on a name would
	 * silently mislabel a fleet that does not use the convention.
	 */
	const envOf = $derived.by(() => {
		const m = new Map<string, string>();
		for (const e of environments) {
			const ns = e.metadata?.namespace;
			const tier = e.spec?.environment;
			if (ns && tier && !m.has(ns)) m.set(ns, tier);
		}
		return (ns: string) => m.get(ns) ?? null;
	});

	/** One theme per tier, for the filter chips. Identity is a function of the name. */
	const envThemes = $derived.by(() => {
		const m = new Map<string, EnvironmentTheme | null>();
		for (const e of environments) {
			const tier = e.spec?.environment;
			if (!tier || m.has(tier)) continue;
			const rollout = rollouts.find(
				(r) =>
					r.metadata?.namespace === e.metadata?.namespace &&
					r.metadata?.name === e.spec?.rolloutRef?.name
			);
			m.set(tier, rollout ? getRolloutEnvironmentTheme(rollout, e) : null);
		}
		return m;
	});

	const envOrder = $derived(
		[...new Set(environments.map((e) => e.spec?.environment).filter(Boolean) as string[])].sort(
			compareEnvironmentNames
		)
	);

	const knownRollouts = $derived(
		new Set(rollouts.map((r) => r.metadata?.name).filter(Boolean) as string[])
	);

	const full = $derived(
		buildDependencyGraph({ deps, envOf: envOf, envOrder, knownRollouts })
	);

	// Multi-select chips, no `All` pill: an empty selection is every
	// environment. Same convention as `/rollouts`.
	let envFilters = $state<string[]>([]);
	function toggleEnv(name: string) {
		envFilters = envFilters.includes(name)
			? envFilters.filter((x) => x !== name)
			: [...envFilters, name];
	}

	const graph = $derived(filterByEnv(full, envFilters));
	const verdict = $derived(networkVerdict(graph));
	const blocked = $derived(graph.blockedEdges);

	/** Environments the network actually touches, in promotion order. */
	const networkEnvs = $derived(full.envs);

	/**
	 * Where a CONSUMER runs in one environment, for a deep link.
	 *
	 * ⛔ CONSUMER ONLY, AND THE ASYMMETRY IS REAL. A dependency object lives in
	 * the consumer's namespace on the consumer's cluster, so `e.envs[].namespace`
	 * IS the consumer's — but `spec.providerRef.namespace` may point somewhere
	 * else entirely, and using this for a provider would link to a namespace it
	 * does not live in. The provider is linked through `/apps/<name>` instead,
	 * which is namespace-free.
	 *
	 * Returns null with no cluster attribution rather than guessing one: a
	 * `/rollouts/<cluster>/…` path built on a wrong cluster is a 500.
	 */
	function consumerHref(consumer: string, env: string): string | null {
		for (const e of full.edges) {
			if (e.to !== consumer) continue;
			for (const x of e.envs) {
				if (x.env === env && x.cluster) return `/rollouts/${x.cluster}/${x.namespace}/${consumer}`;
			}
		}
		return null;
	}

	/** The headline for the amber banner — one blocked link reads differently from four. */
	const bannerTitle = $derived(
		blocked.length === 1
			? `${blocked[0].to} is waiting on ${blocked[0].from}`
			: `${blocked.length} services are held by a contract`
	);
	const bannerMessage = $derived.by(() => {
		if (blocked.length !== 1) {
			const names = [...new Set(blocked.map((e) => e.to))];
			return `${names.join(', ')} cannot take their next release until their providers ship.`;
		}
		const e = blocked[0];
		const needs = e.requiredVersion ? ` ${e.requiredVersion}` : '';
		const has = e.providedVersion ? `, and ${e.from} serves ${e.providedVersion}` : '';
		const where = e.blockedEnvs.length > 0 ? ` in ${e.blockedEnvs.join(', ')}` : '';
		return `It needs ${e.contract}${needs}${has}. Its next release is held${where}.`;
	});

	/**
	 * ⛔ `clusters` LISTS ONLY THE DISCOVERED SPOKES — THE HUB IS IMPLICIT.
	 * Measured on the live payload: two clusters serve this fleet and
	 * `clusters` has ONE entry. `RolloutGrid` composes its own list the same
	 * way (`[local, ...spokes]`), and this number is a claim about how much of
	 * the fleet was looked at, so getting it wrong understates the search.
	 * An unreachable spoke is named by `PartialDataNotice` above, not here.
	 */
	const clusterCount = $derived((query.data?.clusters?.length ?? 0) + 1);

	/** True when there is no network to draw: no dependency, or a lone service. */
	const trivial = $derived(full.edges.length === 0);

	function envLabel(env: string): string {
		const theme = envThemes.get(env);
		return theme ? shortEnvLabel(theme) || env : env;
	}
</script>

<svelte:head>
	<title>kuberik | Dependencies</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<div class="mb-6 min-w-0">
		<h1 class="t-display min-w-0 truncate text-gray-900 dark:text-white">Dependencies</h1>
		{#if !query.isLoading && !query.isError}
			<p class="t-dense mt-1 text-gray-500 dark:text-gray-400">
				{#if trivial}
					No service in this fleet waits on another.
				{:else}
					{full.nodes.length} services · {full.edges.length} contract{full.edges.length === 1
						? ''
						: 's'}
					{#if blocked.length > 0}
						· <span class="font-medium text-gray-700 dark:text-gray-200"
							>{blocked.length} blocked</span
						>
					{:else}
						<!-- ⛔ A PAGE WITH NOTHING WRONG MUST STILL SAY SOMETHING.
						     The human's complaint about the quiet states is that they
						     "look weird, like something is missing". Naming the healthy
						     verdict is what turns silence into an answer. -->
						· nothing is waiting on another service
					{/if}
					{#if full.hasCycle}
						· <span class="font-medium text-gray-700 dark:text-gray-200"
							>contains a cycle</span
						>
					{/if}
				{/if}
			</p>
		{/if}
	</div>

	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this network"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<div
			class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
		>
			<div class="flex min-h-[47px] items-center gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
				<div class="h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-3.5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="ml-auto h-3 w-20 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
			</div>
			<!-- The skeleton mirrors the COLUMNS, not a generic list — so the
			     shape a reader is waiting for is the shape they are looking at. -->
			<div class="flex gap-16 p-4">
				{#each Array(3) as _, col (col)}
					<div class="flex flex-col gap-5">
						{#each Array(col === 1 ? 2 : 1) as __, row (row)}
							<div class="h-14 w-44 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	{:else if query.isError}
		<ErrorState
			error={query.error}
			subject="the dependency network"
			backHref="/"
			backLabel="Go to Home"
			onRetry={() => query.refetch()}
			isRetrying={query.isFetching}
			class="py-2"
		/>
	{:else if trivial}
		<!--
			⛔ NO EMPTY GRAPH FRAME. An empty card with a titled header and a blank
			body is exactly the "looks like something is missing" reading. The page
			states what it FOUND — a real number, scanned across real clusters — so
			the silence is an answer rather than a gap, and then says what would put
			something here.
		-->
		<div class="mx-auto max-w-2xl py-12">
			<div class="text-center">
				<div
					class="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"
				>
					<ShareNodesSolid class="h-5 w-5 text-gray-400 dark:text-gray-500" />
				</div>
				<p class="t-body font-semibold text-gray-900 dark:text-white">
					{#if full.nodes.length === 0}
						No dependencies declared
					{:else}
						One service, no links
					{/if}
				</p>
				<p class="t-dense mx-auto mt-2 max-w-md text-gray-500 dark:text-gray-400">
					{rollouts.length} rollout{rollouts.length === 1 ? '' : 's'} across
					{clusterCount} cluster{clusterCount === 1 ? '' : 's'}
					{full.nodes.length === 0 ? 'declare no contract dependency' : 'form no network'}. This is the
					normal state — most fleets deploy every service independently.
				</p>
				<p class="t-dense mx-auto mt-4 max-w-md text-gray-500 dark:text-gray-400">
					A link appears here when a
					<code class="t-code-sm rounded bg-gray-100 px-1 dark:bg-gray-800">RolloutDependency</code>
					holds one rollout until another has deployed a contract version its release asks for.
				</p>
			</div>
		</div>
	{:else}
		{#if blocked.length > 0}
			<!-- THE PAGE'S ONE BLOCKING FACT, at banner scale. Amber, matching the
			     rollout `dependencies` tab: a contract block neither clears itself
			     nor clears on approval — somebody has to ship the other service. -->
			<AlertPanel
				severity="warning"
				icon={LockSolid}
				title={bannerTitle}
				message={bannerMessage}
			/>
		{/if}

		{#if networkEnvs.length > 1}
			<!-- ⭐ THE OTHER MODEL, REACHABLE. A node here is a SERVICE and the
			     environments live on the edge; picking one environment reduces the
			     network to that environment's slice, which IS the
			     (service, environment) graph. Multi-select, no `All` pill, no
			     dropdown — the standing filter convention. -->
			<div class="mb-4 flex flex-wrap items-center gap-1.5">
				{#each networkEnvs as env (env)}
					{@const sel = envFilters.includes(env)}
					{@const theme = envThemes.get(env) ?? null}
					<button
						type="button"
						onclick={() => toggleEnv(env)}
						aria-pressed={sel}
						aria-label={`Environment ${env}`}
						class="environment-theme-scope inline-flex items-center rounded transition-opacity
							{sel
							? 'ring-1 ring-gray-900/30 dark:ring-gray-100/30'
							: envFilters.length === 0
								? ''
								: 'opacity-40 hover:opacity-100'}"
						style={theme ? getEnvironmentThemeStyle(theme) : undefined}
					>
						<Chip role="env" {theme} label={envLabel(env)} wide />
					</button>
				{/each}
				{#if envFilters.length > 0}
					<button
						type="button"
						onclick={() => (envFilters = [])}
						class="ml-1 text-[11px] text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
						>clear</button
					>
				{/if}
			</div>
		{/if}

		<Card
			icon={ShareNodesSolid}
			title="Dependency network"
			verdict={verdict.text}
			verdictTone={verdict.tone}
			class="mb-6"
		>
			{#if graph.nodes.length === 0}
				<!-- A `RolloutDependency` collection is SPARSE: no object in an
				     environment is not the same as a satisfied link there, so the
				     filtered view says which, rather than drawing nothing. -->
				<p class="t-dense py-6 text-center text-gray-500 dark:text-gray-400">
					No dependency is declared in {envFilters.join(', ')}.
				</p>
			{:else}
				<DependencyNetwork {graph} />
			{/if}
		</Card>

		{#if blocked.length > 0}
			<Card
				icon={ExclamationCircleSolid}
				iconClass="text-red-500 dark:text-red-400"
				title="Blocked links"
				verdict={`${blocked.length} of ${graph.edges.length}`}
				verdictTone="adverse"
				padded={false}
			>
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each blocked as e (e.key)}
						<li class="px-4 py-3">
							<!-- The relation, as one line a person can read aloud:
							     provider → consumer, with the contract between them. -->
							<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
								<ServerSolid class="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
								<a
									href={`/apps/${e.from}`}
									class="truncate text-sm font-semibold text-gray-900 hover:underline dark:text-white"
									>{e.from}</a
								>
								<ArrowRightOutline class="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" />
								<a
									href={`/apps/${e.to}`}
									class="truncate text-sm font-semibold text-gray-900 hover:underline dark:text-white"
									>{e.to}</a
								>
								<span class="ml-auto flex shrink-0 flex-wrap items-center gap-1">
									{#each e.blockedEnvs as env (env)}
										{@const href = consumerHref(e.to, env)}
										{@const theme = envThemes.get(env) ?? null}
										{#if href}
											<a href={href} class="environment-theme-scope inline-flex" style={theme ? getEnvironmentThemeStyle(theme) : undefined}
												><Chip role="env" {theme} label={envLabel(env)} wide /></a
											>
										{:else}
											<span class="environment-theme-scope inline-flex" style={theme ? getEnvironmentThemeStyle(theme) : undefined}
												><Chip role="env" {theme} label={envLabel(env)} wide /></span
											>
										{/if}
									{/each}
								</span>
							</div>
							<!-- The consequence, in English, then the numbers. -->
							<p class="t-dense mt-1 pl-6 text-gray-600 dark:text-gray-300">
								<span class="font-medium text-gray-900 dark:text-white">{e.to}</span>'s next release
								needs
								<span class="font-medium text-gray-900 dark:text-white"
									>{e.contract}{e.requiredVersion ? ` ${e.requiredVersion}` : ''}</span
								>.
								{#if e.providedVaries}
									<span class="text-gray-500 dark:text-gray-400"
										>{e.from} is on a different version in each environment.</span
									>
								{:else if e.providedVersion}
									<span class="font-medium text-gray-900 dark:text-white">{e.from}</span> serves
									<span class="font-medium text-gray-900 dark:text-white">{e.providedVersion}</span>.
								{:else}
									<span class="text-gray-500 dark:text-gray-400"
										>{e.from} has not deployed a version of it.</span
									>
								{/if}
							</p>
							{#if e.envs.some((x) => x.cluster)}
								<p class="t-micro mt-1 flex flex-wrap items-center gap-1.5 pl-6 text-gray-400 dark:text-gray-500">
									{#each [...new Set(e.envs.filter((x) => x.cluster).map((x) => x.cluster as string))] as cl (cl)}
										<ClusterMark name={cl} />
									{/each}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	{/if}
</div>
