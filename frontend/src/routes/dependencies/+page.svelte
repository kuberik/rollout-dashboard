<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `/dependencies` — WHAT IS BLOCKING WHAT, as ONE graph.
	 *
	 * From the human, three times: the CONTRACT dependencies and the
	 * ENVIRONMENT dependencies are ONE graph. Not two cards, not a graph beside
	 * a chain, not two tabs. The model that finally makes that true is in
	 * `dependency-graph.ts`: **a node is a Rollout — a (service, environment) —
	 * and an edge is a `RolloutGate` on one rollout keyed to another.** Which
	 * controller wrote the gate is an attribute of the edge.
	 *
	 * So the operator sees the real picture: a build moves RIGHTWARDS through
	 * environments and SIDEWAYS between services that must ship in order, and
	 * `hello-frontend-app` in prod is visibly held by two inbound edges at once
	 * — staging has not deployed, and the api it needs is a version behind.
	 *
	 * ── ⭐ THE DATA IS ON THE LIST ENDPOINT ONLY ────────────────────────────
	 *
	 * `rolloutDependencies` is served by `GET /api/rollouts` with per-cluster
	 * attribution, and is **NOT** on `GET /api/rollouts/:ns/:name`. That
	 * omission caused a real bug the night this page was designed. This page
	 * reads the list endpoint, which is also what `/rollouts`, `/apps` and `/`
	 * read, so it shares their cache.
	 *
	 * ── THE TWO REGIONS ─────────────────────────────────────────────────────
	 *
	 * 1. `Dependency graph` — the SHAPE.
	 * 2. `Blocked links` — one row per held gate, naming the two rollouts, what
	 *    the gate is waiting for, and where. The ACTION. It renders only when
	 *    something is held; drawing an empty "blocked" card would be drawing
	 *    the norm.
	 *
	 * ── ⛔ THE EMPTY STATE IS THE COMMON CASE AND MUST NOT LOOK BROKEN ──────
	 *
	 * Most clusters declare no relationship at all, and the human's standing
	 * complaint about pages with nothing wrong is that they *"look weird, like
	 * something is missing"*. So the empty state PROVES the page looked —
	 * `15 rollouts across 2 clusters, none is gated on another` — and then says
	 * what would put something here.
	 *
	 * ⛔ THIS PAGE IS NOT IN THE NAV, DELIBERATELY. It was added there once,
	 * unasked, and reverted. It is reached from the rollout `Dependencies` tab.
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
	import { rolloutMatchesEnvironment } from '$lib/source-dashboard';
	import { buildGateContext } from '$lib/view-models/blocking-story';
	import {
		buildRolloutGraph,
		filterByEnv,
		networkVerdict,
		nodeLabel,
		type GraphEdge
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
	 * The gate join table, built ONCE from this payload and handed to the graph
	 * builder. It is what classifies the gates that are NOT edges — a schedule,
	 * a check, an approval — so a clock on a node here and the banner on the
	 * rollout's own page cannot disagree about what it is.
	 */
	const gateContext = $derived(
		buildGateContext({
			environments: query.data?.environments ?? null,
			rolloutDependencies: query.data?.rolloutDependencies ?? null
		})
	);

	/** One theme per tier, for the chips. Identity is a function of the name. */
	const envThemes = $derived.by(() => {
		const m = new Map<string, EnvironmentTheme | null>();
		for (const e of environments) {
			const tier = e.spec?.environment;
			if (!tier || m.has(tier)) continue;
			const rollout = rollouts.find((r) => rolloutMatchesEnvironment(r, e));
			m.set(tier, rollout ? getRolloutEnvironmentTheme(rollout, e) : null);
		}
		return m;
	});
	const themeOf = $derived((env: string) => envThemes.get(env) ?? null);

	const envOrder = $derived(
		[...new Set(environments.map((e) => e.spec?.environment).filter(Boolean) as string[])].sort(
			compareEnvironmentNames
		)
	);

	const full = $derived(
		buildRolloutGraph({
			rollouts,
			environments,
			dependencies: deps,
			envOrder,
			gates: gateContext
		})
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
	const nodeById = $derived(new Map(full.nodes.map((n) => [n.id, n] as const)));

	/** Environments the graph actually touches, in promotion order. */
	const graphEnvs = $derived(full.envs);

	/**
	 * ⛔ `clusters` LISTS ONLY THE DISCOVERED SPOKES — THE HUB IS IMPLICIT.
	 * Measured on the live payload: two clusters serve this fleet and
	 * `clusters` has ONE entry. `RolloutGrid` composes its own list the same
	 * way (`[local, ...spokes]`), and this number is a claim about how much of
	 * the fleet was looked at, so getting it wrong understates the search.
	 */
	const clusterCount = $derived((query.data?.clusters?.length ?? 0) + 1);

	/** True when there is nothing to draw: no gate anywhere keys to a rollout. */
	const trivial = $derived(full.edges.length === 0);

	function envLabel(env: string): string {
		const t = envThemes.get(env);
		return (t ? shortEnvLabel(t) : shortEnvLabel(env)) || env;
	}

	/** The row's second line — the concrete consequence, per edge kind. */
	function consequence(e: GraphEdge): string {
		const from = nodeById.get(e.from);
		const to = nodeById.get(e.to);
		if (e.writer === 'promotion') {
			const verb = e.relType === 'Parallel' ? 'alongside' : 'first';
			return `${to?.env ?? 'This environment'} takes nothing newer until ${from?.env ?? 'its upstream'} has deployed the next build ${verb}.`;
		}
		const needs = e.requiredVersion ? ` ${e.requiredVersion}` : '';
		const serves = e.providedVersion
			? `${from?.name ?? 'the provider'} serves ${e.providedVersion} here.`
			: `${from?.name ?? 'the provider'} has not deployed a version of it here.`;
		return `Its next release needs ${e.contract}${needs}. ${serves}`;
	}

	const bannerTitle = $derived.by(() => {
		if (blocked.length === 1) {
			const to = nodeById.get(blocked[0].to);
			return to ? `${to.name} is held in ${to.env}` : 'One rollout is held';
		}
		const held = new Set(blocked.map((e) => e.to));
		return `${held.size} rollout${held.size === 1 ? ' is' : 's are'} held by another deploy`;
	});
	const bannerMessage = $derived.by(() => {
		if (blocked.length === 1) return consequence(blocked[0]);
		const names = [...new Set(blocked.map((e) => nodeById.get(e.to)).filter(Boolean))].map((n) =>
			nodeLabel(n!)
		);
		return `${names.join(', ')} cannot take their next release until the deploy in front of each of them lands.`;
	});
</script>

<svelte:head>
	<title>kuberik | Dependencies</title>
</svelte:head>

<div class="mx-auto max-w-7xl px-4 py-6 sm:px-6">
	<!-- ══ THE HEAD BAND ════════════════════════════════════════════════════
	     ⚠️ THE `h1` STAYS DRAWN HERE, AND THAT IS THE RULE BEING FOLLOWED, NOT
	     AN EXCEPTION TO IT. (2026-09-01) The duplicate-title rule tests for
	     DUPLICATION: `/rollouts`, `/environments`, `/apps` and `/versions` all
	     had the navbar printing the same word 25px above the `h1`.
	     `/dependencies` does not. `Navbar.svelte`'s `currentSection` has no
	     branch for this path, so it falls through to `SECTIONS[0]` — `control`
	     — and the breadcrumb is `{#if currentSection.key !== 'control'}`, i.e.
	     NOT RENDERED. There is no `Dependencies` item in `Sidebar.svelte`
	     either. Unvoicing this `h1` would leave the page with no visible name
	     at all: a graph, a banner, and nothing saying what you are looking at.
	     **Check the navbar before applying the rule; the test is duplication,
	     not position.**

	     ⭐ WHAT DID CHANGE IS THE RHYTHM. The title was `t-display` on its own
	     line with the rollup on a SECOND line and `mb-6` below, so the first
	     card landed at y=98 while `/apps`, `/environments`, `/versions` and
	     `/activity` all start theirs at y=72. One head row now — title, rollup
	     on its baseline, `mb-5` — and this page joins them. -->
	<div class="mb-5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
		<h1 class="t-display min-w-0 truncate text-gray-900 dark:text-white">Dependencies</h1>
		{#if !query.isLoading && !query.isError}
			<p class="t-dense min-w-0 text-gray-500 dark:text-gray-400">
				{#if trivial}
					No rollout in this fleet is gated on another.
				{:else}
					{full.nodes.length} rollouts · {full.edges.length} gate{full.edges.length === 1
						? ''
						: 's'} between them
					{#if blocked.length > 0}
						· <span class="font-medium text-gray-700 dark:text-gray-200"
							>{blocked.length} holding</span
						>
					{:else}
						<!-- ⛔ A PAGE WITH NOTHING WRONG MUST STILL SAY SOMETHING.
						     Naming the healthy verdict is what turns silence into an
						     answer rather than "something is missing". -->
						· nothing is waiting on another deploy
					{/if}
					{#if full.unlinkedRollouts > 0}
						· {full.unlinkedRollouts} not in the graph
					{/if}
					{#if full.hasCycle}
						· <span class="font-medium text-gray-700 dark:text-gray-200">contains a cycle</span>
					{/if}
				{/if}
			</p>
		{/if}
	</div>

	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this graph"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<div
			class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
		>
			<div
				class="flex min-h-[47px] items-center gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
			>
				<div class="h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="h-3.5 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-700"></div>
				<div class="ml-auto h-3 w-20 animate-pulse rounded bg-gray-200/70 dark:bg-gray-700/60"></div>
			</div>
			<!-- The skeleton mirrors the MATRIX — the shape a reader is waiting
			     for is the shape they are looking at. -->
			<div class="flex gap-16 p-4">
				{#each Array(3) as _, col (col)}
					<div class="flex flex-col gap-6">
						{#each Array(2) as __, row (row)}
							<div class="h-16 w-44 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"></div>
						{/each}
					</div>
				{/each}
			</div>
		</div>
	{:else if query.isError}
		<ErrorState
			error={query.error}
			subject="the dependency graph"
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
			states what it FOUND — a real number, scanned across real clusters.
		-->
		<div class="mx-auto max-w-2xl py-12">
			<div class="text-center">
				<div
					class="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"
				>
					<ShareNodesSolid class="h-5 w-5 text-gray-400 dark:text-gray-500" />
				</div>
				<p class="t-body font-semibold text-gray-900 dark:text-white">Nothing waits on anything</p>
				<p class="t-dense mx-auto mt-2 max-w-md text-gray-500 dark:text-gray-400">
					{rollouts.length} rollout{rollouts.length === 1 ? '' : 's'} across
					{clusterCount} cluster{clusterCount === 1 ? '' : 's'}, and no gate on any of them is keyed
					to another rollout. This is the normal state — most fleets deploy every service
					independently.
				</p>
				<p class="t-dense mx-auto mt-4 max-w-md text-gray-500 dark:text-gray-400">
					A link appears here when an
					<code class="t-code-sm rounded bg-gray-100 px-1 dark:bg-gray-800">Environment</code>
					holds one environment until the one before it has deployed a build, or a
					<code class="t-code-sm rounded bg-gray-100 px-1 dark:bg-gray-800">RolloutDependency</code>
					holds one rollout until another has served a contract version its release asks for.
				</p>
			</div>
		</div>
	{:else}
		{#if blocked.length > 0}
			<!-- THE PAGE'S ONE BLOCKING FACT, at banner scale. Amber: neither kind
			     of block clears itself and neither clears on approval — somebody
			     has to ship the thing in front. -->
			<AlertPanel severity="warning" icon={LockSolid} title={bannerTitle} message={bannerMessage} />
		{/if}

		{#if graphEnvs.length > 1}
			<!-- ⭐ THE CHIPS FILTER WHICH COLUMNS RENDER. A node IS a
			     (service, environment), so selecting `prod` leaves the prod column
			     and the contract edges inside it — the promotion edges into it
			     come from a column that is no longer on screen and are dropped
			     with it. Multi-select, no `All` pill, no dropdown. -->
			<div class="mb-4 flex flex-wrap items-center gap-1.5">
				{#each graphEnvs as env (env)}
					{@const sel = envFilters.includes(env)}
					{@const t = envThemes.get(env) ?? null}
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
						style={t ? getEnvironmentThemeStyle(t) : undefined}
					>
						<Chip role="env" theme={t} label={envLabel(env)} wide />
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
			title="Dependency graph"
			verdict={verdict.text}
			verdictTone={verdict.tone}
			class="mb-6"
		>
			{#if graph.nodes.length === 0}
				<p class="t-dense py-6 text-center text-gray-500 dark:text-gray-400">
					No rollout in {envFilters.join(', ')} is gated on another.
				</p>
			{:else}
				<DependencyNetwork {graph} {themeOf} />
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
						{@const from = nodeById.get(e.from)}
						{@const to = nodeById.get(e.to)}
						<li class="px-4 py-3">
							<!-- The relation, as one line a person can read aloud. A
							     promotion is one service between two environments; a
							     contract is two services inside one. The row prints
							     whichever it is, and never both shapes at once. -->
							<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
								<ServerSolid class="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
								{#if e.writer === 'promotion'}
									<a
										href={`/apps/${to?.name ?? ''}`}
										class="truncate text-sm font-semibold text-gray-900 hover:underline dark:text-white"
										>{to?.name}</a
									>
									<span
										class="environment-theme-scope inline-flex"
										style={from && themeOf(from.env) ? getEnvironmentThemeStyle(themeOf(from.env)!) : undefined}
										><Chip role="env" theme={from ? themeOf(from.env) : null} label={envLabel(from?.env ?? '')} wide /></span
									>
									<ArrowRightOutline class="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" />
									<span
										class="environment-theme-scope inline-flex"
										style={to && themeOf(to.env) ? getEnvironmentThemeStyle(themeOf(to.env)!) : undefined}
										><Chip role="env" theme={to ? themeOf(to.env) : null} label={envLabel(to?.env ?? '')} wide /></span
									>
								{:else}
									<a
										href={`/apps/${from?.name ?? ''}`}
										class="truncate text-sm font-semibold text-gray-900 hover:underline dark:text-white"
										>{from?.name}</a
									>
									<ArrowRightOutline class="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" />
									<a
										href={`/apps/${to?.name ?? ''}`}
										class="truncate text-sm font-semibold text-gray-900 hover:underline dark:text-white"
										>{to?.name}</a
									>
									<span
										class="environment-theme-scope inline-flex"
										style={to && themeOf(to.env) ? getEnvironmentThemeStyle(themeOf(to.env)!) : undefined}
										><Chip role="env" theme={to ? themeOf(to.env) : null} label={envLabel(to?.env ?? '')} wide /></span
									>
								{/if}
								{#if to}
									<a
										href={`/rollouts/${to.cluster}/${to.namespace}/${to.name}`}
										class="ml-auto shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
										>Open ›</a
									>
								{/if}
							</div>
							<p class="t-dense mt-1 pl-6 text-gray-600 dark:text-gray-300">{consequence(e)}</p>
							{#if to?.cluster}
								<p class="t-micro mt-1 flex flex-wrap items-center gap-1.5 pl-6 text-gray-400 dark:text-gray-500">
									<ClusterMark name={to.cluster} />
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	{/if}
</div>
