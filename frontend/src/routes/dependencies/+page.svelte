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
	import CardSkeleton from '$lib/components/skeleton/CardSkeleton.svelte';
	import { ShareNodesSolid, ServerOutline, ArrowRightOutline } from 'flowbite-svelte-icons';
	import HeldGlyph from '$lib/components/HeldGlyph.svelte';
	import AlertPanel from '$lib/components/AlertPanel.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import ClusterMark from '$lib/components/ClusterMark.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import DependencyNetwork from '$lib/components/DependencyNetwork.svelte';
	import ErrorState from '$lib/components/ErrorState.svelte';
	import PartialDataNotice from '$lib/components/PartialDataNotice.svelte';
	import StillTryingNotice from '$lib/components/StillTryingNotice.svelte';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { pollWhenHealthy, staleTimeWhenHealthy } from '$lib/api/errors';
	import { pageTitle } from '$lib/page-title';
	import { getRolloutEnvironmentTheme, shortEnvLabel } from '$lib/environment-theme';
	import { getEnvironmentThemeStyle, type EnvironmentTheme } from '$lib/environment-theme';
	import { compareEnvironmentNames } from '$lib/env-order';
	import { rolloutMatchesEnvironment, SOURCE_CLUSTER_ANNOTATION } from '$lib/source-dashboard';
	import { href } from '$lib/paths';
	import { cardContext } from '$lib/view-models/card-context';
import { heldHereGates } from '$lib/view-models/held';
	import {
		filterByEnv,
		networkVerdict,
		heldSummary,
		heldClause,
		type GraphEdge,
		type GraphNode
	} from '$lib/view-models/dependency-graph';
	import { fetchNetworkSchedules } from '$lib/api/schedules';

	// ⭐ PERF-2026-09-04 §C.7 SLICE 4 — STREAM-AWARE (see RolloutGrid.svelte).
	const query = createQuery(() =>
		rolloutsListQueryOptions({
			options: {
				staleTime: staleTimeWhenHealthy(15000, 30000),
				refetchInterval: pollWhenHealthy(15000, 60000)
			}
		})
	);

	const rollouts = $derived(query.data?.rollouts?.items ?? []);
	const environments = $derived(query.data?.environments?.items ?? []);

	/**
	 * ⭐ ONE `/api/schedules` REQUEST PER CLUSTER, NOT PER ROLLOUT. (2026-09-03,
	 * operator-walk finding B1 — see `withNetworkSchedules`'s own comment for
	 * the full account.) `''` is the local/hub cluster, matching every other
	 * `?cluster=` call site; `clusters` lists only the discovered SPOKES.
	 */
	const clusterNames = $derived(['', ...(query.data?.clusters ?? []).map((c) => c.name)]);
	// ⭐ STREAM-AWARE — see ControlCenter.svelte's identical comment.
	const schedulesQuery = createQuery(() => ({
		queryKey: ['network-schedules', clusterNames],
		queryFn: () => fetchNetworkSchedules(clusterNames),
		staleTime: staleTimeWhenHealthy(15000, 30000),
		refetchInterval: pollWhenHealthy(30000, 60000),
		enabled: clusterNames.length > 0
	}));

	/**
	 * The gate join table, built ONCE from this payload and handed to the graph
	 * builder. It is what classifies the gates that are NOT edges — a schedule,
	 * a check, an approval — so a clock on a node here and the banner on the
	 * rollout's own page cannot disagree about what it is.
	 */
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

	/**
	 * ⭐ ONE GATE SOURCE (2026-10-25): the shared `cardContext`, the construction
	 * the Gates tab, /apps/<name> and Home use. Its graph and gate context are
	 * this page's; `storyFor` hands every story the contract holds, which is how
	 * a held edge learns the range its own build needs (see `heldRequirement`).
	 */
	const appCtx = $derived(
		cardContext({
			rollouts,
			environments: query.data?.environments ?? null,
			rolloutDependencies: query.data?.rolloutDependencies ?? null,
			envOrder,
			schedulesByCluster: schedulesQuery.data ?? new Map()
		})
	);
	const full = $derived(appCtx.providerNetwork);

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
	 * ⭐ NAMESPACES ARE NOT ENVIRONMENTS (round 6 review, 2026-10-09).
	 * `full.envs` (`dependency-graph.ts`) is every distinct `node.env` the
	 * graph drew a column for — real `Environment` tiers AND the per-node
	 * NAMESPACE fallback it uses when nothing binds a node to one (the same
	 * fallback the Held-links `envMark` snippet already tells apart from a
	 * real environment, and the swimlane fix on `/activity` collapses to
	 * one "No environment" lane). `themeOf(env)` resolves for a real tier
	 * and is `null` for a namespace — that is the one signal this page has,
	 * so the filter row splits on it: real environments keep the identity
	 * dot, a namespace fallback (if the fleet has any un-bound rollouts at
	 * all) gets a second, visually quieter group with no dot — it is a
	 * real, useful filter (the node IS placed in that column), just not an
	 * environment, so it may not borrow that chip's identity mark.
	 */
	const realEnvs = $derived(graphEnvs.filter((e) => envThemes.has(e)));
	const namespaceEnvs = $derived(graphEnvs.filter((e) => !envThemes.has(e)));

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

	/**
	 * ⭐ THE RANGE A HELD EDGE'S OWN BUILD NEEDS. (2026-10-25) The edge keeps a
	 * `requiredVersion` only when every held build agrees on it; checkout-api
	 * holds builds that ask `~2.9.0` and `^3.0.0` of the same provider, so the
	 * edge said "Needs payments" with no range. The Gates tab names the build
	 * refused in THIS environment (`heldHereGates` over a story built with the
	 * contract holds), so the edge reads that gate's `need`, and falls back to
	 * its own agreed range.
	 */
	const heldRequirementByEdge = $derived.by(() => {
		const out: Record<string, string> = {};
		for (const e of full.edges) {
			if (e.writer !== 'contract' || e.state !== 'blocked' || e.requiredVersion) continue;
			const to = nodeById.get(e.to);
			const from = nodeById.get(e.from);
			if (!to || !from) continue;
			const rollout = rollouts.find(
				(r) =>
					r.metadata?.namespace === to.namespace &&
					r.metadata?.name === to.name &&
					(r.metadata?.annotations?.[SOURCE_CLUSTER_ANNOTATION] ?? '') === to.cluster
			);
			if (!rollout) continue;
			const need = heldHereGates(appCtx.storyFor(rollout), to.env).find(
				(g) => g.kind === 'dependency' && g.subject === from.name && g.need
			)?.need;
			if (need) out[e.key] = need;
		}
		return out;
	});
	const heldRequirement = (e: GraphEdge): string | null =>
		e.requiredVersion ?? heldRequirementByEdge[e.key] ?? null;

	/** The row's second line — the concrete consequence, per edge kind. */
	function consequence(e: GraphEdge): string {
		const from = nodeById.get(e.from);
		const to = nodeById.get(e.to);
		if (e.writer === 'promotion') {
			const verb =
				e.edgeKind === 'follow' ? 'and picked it' : e.edgeKind === 'wave' ? 'in the earlier wave' : 'first';
			return `${to?.env ?? 'This environment'} takes nothing newer until ${from?.env ?? 'its upstream'} has deployed the next build ${verb}.`;
		}
		const required = heldRequirement(e);
		const needs = required ? ` ${required}` : '';
		const serves = e.providedVersion
			? `${from?.name ?? 'the provider'} serves ${e.providedVersion} here.`
			: `${from?.name ?? 'the provider'} has not deployed a version of it here.`;
		return `Its next release needs ${e.contract}${needs}. ${serves}`;
	}

	/**
	 * ⛔ SUPERSEDED (round 4 review, 2026-10-09) — the banner no longer
	 * hand-picks an icon at all. `AlertPanel`'s `pinned` severity draws
	 * `HeldGlyph` by default now, the one mark for every held state product-
	 * wide; a share-node here was a SECOND held glyph, not a third kind
	 * this page uniquely needed. See the call site's own note.
	 */

	const bannerTitle = $derived.by(() => {
		if (blocked.length === 1) {
			const to = nodeById.get(blocked[0].to);
			return to ? `${to.name} is held in ${to.env}` : 'One rollout is held';
		}
		const held = new Set(blocked.map((e) => e.to));
		return `${held.size} rollout${held.size === 1 ? ' is' : 's are'} held by another deploy`;
	});
	/**
	 * ⭐ THE HELD ROLLOUTS ARE GROUPED BY APP. (2026-09-02.) This mapped every
	 * held node through `nodeLabel` and joined with commas, so one app held in
	 * three environments printed its own name three times. The grouping is
	 * `heldSubjects`' — a property of the sentence builder, not of this banner,
	 * so nothing else that says the same thing can drift from it.
	 */
	const bannerMessage = $derived.by(() => {
		if (blocked.length === 1) return consequence(blocked[0]);
		// ⭐ ONE SHORT SENTENCE (round 4 review, 2026-10-09) — §3.12: a banner
		// prints ONE sentence, the rest goes under `Details`. The headline
		// already states the count ("N rollouts are held…"); the message
		// now says only what they are waiting FOR, not also who they are —
		// `bannerDetail` below carries the subject clause (`heldSummary`)
		// for the reader who opens `Details`.
		const until = heldClause(blocked, nodeById, { brief: true });
		return `Waiting until ${until}.`;
	});

	/**
	 * The fuller sentence — who is held, not just what they are waiting
	 * for — disclosed under the banner's own `Details`, never printed at
	 * banner scale. `null` for the single-link case: `consequence()` is
	 * already the one sentence there, with nothing left to disclose.
	 */
	const bannerDetail = $derived.by(() => {
		if (blocked.length === 1) return null;
		const held = [...new Set(blocked.map((e) => e.to))]
			.map((id) => nodeById.get(id))
			.filter((n): n is GraphNode => !!n);
		const until = heldClause(blocked, nodeById, { brief: true });
		return `${heldSummary(held)} cannot take their next release until ${until}.`;
	});
</script>

<svelte:head>
	<!-- ⭐ (2026-10-09, integration round 3, item 4) `pageTitle()` — ONE
	     DOCUMENT-TITLE FORMAT, PRODUCT-WIDE (`page-title.ts`'s own doc
	     comment). This page and the rollout detail Gates tab were the two
	     files left alone when `pageTitle()` landed everywhere else ("owned
	     by other lanes at the time"); this is that follow-up. -->
	<title>{pageTitle('Dependencies')}</title>
</svelte:head>

<div class="mx-auto w-full px-4 py-6 sm:px-6">
	<!-- ══ THE HEAD BAND ════════════════════════════════════════════════════
	     ⛔ THE `h1` IS `sr-only` NOW — THE PREMISE THAT KEPT IT DRAWN CHANGED
	     UNDER US. (2026-09-02) This page used to be the one documented
	     exception to the duplication rule: `Navbar.svelte`'s `currentSection`
	     had no branch for `/dependencies`, so the breadcrumb rendered nothing
	     and this `h1` was the page's ONLY visible name. `21e72da` gave the
	     navbar a `/dependencies` branch (`kuberik | Dependencies`), so the
	     breadcrumb now prints the same word this `h1` did, 25px above it — the
	     exact duplication `/apps`, `/environments`, `/versions` and `/activity`
	     were unvoiced for. The rule was always DUPLICATION, not position (see
	     `lib/CLAUDE.md`); the page just moved from one side of it to the
	     other.

	     ⛔ NOT DELETED. The skip link lands on `main` and a11y asserts a
	     level-1 heading exists, so `sr-only` — the mechanism every other
	     unvoiced `h1` on this product uses — keeps the word announced first to
	     a screen reader while costing zero pixels.

	     WHAT FILLS THE SLOT IS THE ROLLUP, PROMOTED — same sentence as before,
	     character for character, now carried by `PageHeader`'s list form (the
	     same component `/rollouts`, `/apps` and `/activity` use): the count on
	     the title's baseline, the sentence as `summary` below it. -->
	{#if !query.isLoading && !query.isError}
		<!-- ⭐ THE COUNT NAMES WHAT THE TITLE NAMES. (round 2 review, 2026-10-08)
		     This used to count NODES (rollouts) beside a title that says
		     "Dependencies" — a reader sees "Dependencies 24" and the page is
		     about RULES, so the count was the wrong axis, and the summary
		     then opened on a bare "rollout" with no lead-in. The header now
		     counts `full.edges.length` (the rules — "a `RolloutDependency` or
		     an `Environment` promotion order", this page's own subject); the
		     rollout count moves into the summary as "across N rollouts",
		     the axis the title does not already fix. -->
		<PageHeader title="Dependencies" count={full.edges.length} summaryBelow>
			{#snippet summary()}
				{#if trivial}
					across {full.nodes.length} rollout{full.nodes.length === 1 ? '' : 's'}, none depends on
					another.
				{:else}
					rule{full.edges.length === 1 ? '' : 's'} across {full.nodes.length} rollout{full.nodes
						.length === 1
						? ''
						: 's'}
					{#if blocked.length > 0}
						· <span class="text-fg">{blocked.length} holding</span>
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
						· <span class="text-fg">contains a cycle</span>
					{/if}
				{/if}
			{/snippet}
		</PageHeader>
	{:else}
		<h1 class="sr-only">Dependencies</h1>
	{/if}

	<PartialDataNotice
		errors={query.data?.clusterErrors ?? []}
		subject="this graph"
		onRetry={() => query.refetch()}
		isRetrying={query.isFetching}
	/>

	{#if query.isLoading}
		<StillTryingNotice failureCount={query.failureCount} />
		<CardSkeleton titleWidth="w-40" rollupWidth="w-20" padded={false}>
			<!-- The skeleton mirrors the MATRIX — the shape a reader is waiting
				     for is the shape they are looking at. -->
				<div class="flex gap-16 p-4">
					{#each Array(3) as _, col (col)}
						<div class="flex flex-col gap-6">
							{#each Array(2) as __, row (row)}
								<div class="skel-block h-16 w-44 rounded-md"></div>
							{/each}
						</div>
					{/each}
				</div>
		</CardSkeleton>
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
				<div class="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-subtle">
					<ShareNodesSolid class="h-5 w-5 text-fg-disabled" />
				</div>
				<p class="t-ui text-fg">Nothing waits on anything</p>
				<p class="t-meta mx-auto mt-2 max-w-md text-fg-subtle">
					{rollouts.length} rollout{rollouts.length === 1 ? '' : 's'} across
					{clusterCount} cluster{clusterCount === 1 ? '' : 's'}, and no rule on any of them is keyed
					to another rollout. This is the normal state — most fleets deploy every service
					independently.
				</p>
				<p class="t-meta mx-auto mt-4 max-w-md text-fg-subtle">
					A link appears here when an
					<code class="t-code-sm rounded-xs bg-subtle px-1">Environment</code>
					holds one environment until the one before it has deployed a build, or a
					<code class="t-code-sm rounded-xs bg-subtle px-1">RolloutDependency</code>
					holds one rollout until another has served a contract version its release asks for.
				</p>
			</div>
		</div>
	{:else}
		{#if blocked.length > 0}
			<!-- THE PAGE'S ONE BLOCKING FACT, at banner scale. `pinned` (held),
			     not `warning` (stuck only, per DESIGN-LANGUAGE.md §2.5/§3.12):
			     neither kind of block clears itself and neither clears on
			     approval — somebody has to ship the thing in front, but this
			     is a HOLD, not a stuck rollout. -->
			<!-- ⭐ NO `icon` OVERRIDE (round 4 review, 2026-10-09). `pinned`'s
			     `defaultIcon` is `HeldGlyph` now (`AlertPanel`'s own severity
			     table) — the TL is fixing the banner disc centrally there;
			     this call site stops hand-picking `ShareNodesSolid` via
			     `iconForKind`, the same share-node BlockingStoryPanel draws
			     for a contract block elsewhere, which doubled as a SECOND
			     "held" glyph beside `HeldGlyph`'s gate. -->
			<AlertPanel
				severity="pinned"
				title={bannerTitle}
				message={bannerMessage}
				footnote={bannerDetail ?? undefined}
			>
				{#snippet actions()}
					<!-- ⭐ THE BANNER'S RIGHT SLOT WAS EMPTY. (round 2 review,
					     2026-10-08) A plain in-page anchor, not a `goto` — the
					     held list is a real `id` on the page (`#held-links`),
					     at every width: first on a phone (see the mobile-order
					     note by `.dep-rail`), beside the graph in the rail at
					     ≥1024. -->
					<a href="#held-links" class="nav-link">Show held links</a>
				{/snippet}
			</AlertPanel>
		{/if}

		<!-- ⭐ MAIN + RAIL, ≥1024 NEVER SINGLE COLUMN — AND THE HELD LIST LEADS
		     ON A PHONE. (round 2 review, 2026-10-08) `.rail-wrap`/`.rail-grid`/
		     `.rail-main`/`.rail-side` (`app.css`) is the same shared shell Home
		     and `/activity`'s rail use, reused verbatim — only while there IS
		     a rail: a healthy graph with nothing held has no second card to
		     put beside it, and the grid's reserved 280-320px column would
		     just be empty space, so the plain single column renders when
		     `blocked.length === 0` (`{#if}`/`{:else}` around a shared
		     `graphSection` snippet, not a duplicated copy of the filters +
		     graph Card). The graph stays the CENTREPIECE — first and widest
		     in the rail-grid's source order, so it leads at ≥1024 where both
		     sit side by side — but on a phone the held list is what needs a
		     person RIGHT NOW and the graph is reference material, so
		     `.dep-rail-main`/`.dep-rail-side` flip `order` below the shell's
		     own container-query breakpoint (scoped styles below, same 760px
		     step `.rail-grid` itself turns on). -->
		{#snippet graphSection()}
			{#if graphEnvs.length > 1}
				<!-- ⭐ THE CHIPS FILTER WHICH COLUMNS RENDER. A node IS a
				     (service, environment), so selecting `prod` leaves the prod
				     column and the contract edges inside it — the promotion
				     edges into it come from a column that is no longer on
				     screen and are dropped with it. Multi-select, no `All`
				     pill, no dropdown. -->
				<!-- ⭐ THE `/rollouts` PILL DIALECT, NOT A WRAPPED 20PX `Chip`.
				     (round 4 review, 2026-10-09) This was `Chip role="env"`
				     in a button with its own ring/opacity "selected" — a
				     20px control beside `/rollouts` and `/activity`'s 28px
				     `.pill` env buttons, a different box on the same page as
				     `/rollouts`' identical filter. One control, one height,
				     one selected grammar (`.pill`'s own `aria-pressed`
				     inverse fill): `.chip-env-dot` inline + the label text,
				     the exact shape `RolloutGrid`'s env buttons already
				     draw. -->
				<div class="mb-4 flex flex-wrap items-center gap-1.5">
					{#each realEnvs as env (env)}
						{@const sel = envFilters.includes(env)}
						{@const t = envThemes.get(env) ?? null}
						<button
							type="button"
							onclick={() => toggleEnv(env)}
							aria-pressed={sel}
							aria-label={`Environment ${env}`}
							class="env-filter hit-32"
							><Chip role="env" theme={t} label={envLabel(env)} wide /></button
						>
					{/each}
					{#if namespaceEnvs.length > 0}
						<!-- ⭐ A SECOND, QUIETER GROUP — NOT THE SAME CHIP. (round 6
						     review) These columns exist (a rollout with no
						     `Environment` record still needs an axis to sit on),
						     so the filter is real and useful; they are not
						     environments, so they do not get the identity dot
						     or the environment-theme styling. Same `.pill`
						     control, same `aria-pressed` inverse-fill selected
						     state — one filter LANGUAGE — just no borrowed
						     identity mark. -->
						<span class="mx-1 hidden h-4 w-px bg-line sm:inline-block" aria-hidden="true"></span>
						{#each namespaceEnvs as env (env)}
							{@const sel = envFilters.includes(env)}
							<button
								type="button"
								onclick={() => toggleEnv(env)}
								aria-pressed={sel}
								aria-label={`Namespace ${env}`}
								title="Not bound to an Environment — grouped by namespace"
								class="pill"
								>{env}</button
							>
						{/each}
					{/if}
					{#if envFilters.length > 0}
						<button
							type="button"
							onclick={() => (envFilters = [])}
							class="t-meta ml-1 text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
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
					<p class="t-meta py-6 text-center text-fg-subtle">
						No rollout in {envFilters.join(', ')} depends on another.
					</p>
				{:else}
					<DependencyNetwork {graph} {themeOf} {heldRequirement} orderKey={envFilters.join(',')} />
				{/if}
			</Card>
		{/snippet}

		<!-- ⭐ A NAMESPACE IS NOT AN ENVIRONMENT CHIP (round 5 review,
		     2026-10-09). A node's `env` falls back to the rollout's
		     NAMESPACE when no `Environment` record binds it
		     (`dependency-graph.ts`'s own fallback — the graph still needs
		     an axis to place the node on) — `themeOf(env)` is `null` in
		     exactly that case, since `envThemes` is built from real
		     `Environment` tiers only. Drawing that fallback as `Chip
		     role="env"` (a bordered box + a 6px identity dot) claimed an
		     identity the page does not have for it; a namespace is a
		     name, so it prints as one — `t-meta text-fg-subtle`, the same
		     ink `ClusterMark` and every other quiet qualifier on this rail
		     already use. -->
		{#snippet envMark(node: GraphNode | undefined)}
			{@const t = node ? themeOf(node.env) : null}
			{#if t}
				<span
					class="environment-theme-scope inline-flex"
					style={getEnvironmentThemeStyle(t)}><Chip role="env" theme={t} label={envLabel(node!.env)} wide /></span
				>
			{:else if node?.env}
				<span class="t-meta text-fg-subtle">{envLabel(node.env)}</span>
			{/if}
		{/snippet}

		{#if blocked.length > 0}
			<div class="rail-wrap">
				<div class="rail-grid">
					<div class="rail-main dep-rail-main min-w-0">
						{@render graphSection()}
					</div>
					<div class="rail-side dep-rail-side min-w-0" id="held-links">
			<!-- HeldGlyph (round 4 review) — was `ExclamationCircleOutline`,
			     the failed/stuck glyph shape even in outline form. Every
			     held mark on the page is the same gate now. -->
			<Card
				icon={HeldGlyph}
				iconClass="text-held"
				title="Held links"
				verdict={`${blocked.length} of ${graph.edges.length}`}
				verdictTone="held"
				padded={false}
			>
				<ul class="divide-y divide-line-subtle">
					{#each blocked as e (e.key)}
						{@const from = nodeById.get(e.from)}
						{@const to = nodeById.get(e.to)}
						<li class="px-4 py-3">
							<!-- The relation, as one line a person can read aloud. A
							     promotion is one service between two environments; a
							     contract is two services inside one. The row prints
							     whichever it is, and never both shapes at once. -->
							<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
								<!-- `ServerOutline`, not `ServerSolid` (round 6 review):
								     a structural glyph naming "this row is about a
								     service", not a status mark. -->
								<ServerOutline class="h-4 w-4 shrink-0 text-fg-disabled" />
								{#if e.writer === 'promotion'}
									<a
										href={href(`/apps/${to?.name ?? ''}`)}
										class="t-card-title truncate text-fg hover:underline"
										>{to?.name}</a
									>
									{@render envMark(from)}
									<ArrowRightOutline class="h-3.5 w-3.5 shrink-0 text-held" />
									{@render envMark(to)}
								{:else}
									<a
										href={href(`/apps/${from?.name ?? ''}`)}
										class="t-card-title truncate text-fg hover:underline"
										>{from?.name}</a
									>
									<ArrowRightOutline class="h-3.5 w-3.5 shrink-0 text-held" />
									<a
										href={href(`/apps/${to?.name ?? ''}`)}
										class="t-card-title truncate text-fg hover:underline"
										>{to?.name}</a
									>
									{@render envMark(to)}
								{/if}
								{#if to}
									<a
										href={href(`/rollouts/${to.cluster}/${to.namespace}/${to.name}`)}
										class="nav-link ml-auto shrink-0 !py-0"
										>Open ›</a
									>
								{/if}
							</div>
							<p class="t-meta mt-1 pl-6 text-fg-muted">{consequence(e)}</p>
							{#if to?.cluster}
								<p class="t-meta mt-1 flex flex-wrap items-center gap-1.5 pl-6 text-fg-subtle">
									<ClusterMark name={to.cluster} />
								</p>
							{/if}
						</li>
					{/each}
				</ul>
			</Card>
					</div>
				</div>
			</div>
		{:else}
			{@render graphSection()}
		{/if}
	{/if}
</div>

<style>
	/* ⭐ THE HELD LIST LEADS ON A PHONE, THE GRAPH LEADS AT ≥1024. (round 2
	   review, 2026-10-08) `.rail-grid` (`app.css`) is a plain flex column
	   below its own container-query breakpoint and a two-column grid at and
	   above it — source order either way, with no opinion on WHICH child
	   should lead. This page wants the opposite order on a phone (the held
	   list needs a person right now; the graph is reference material) from
	   the order at ≥1024 (the graph is the centrepiece, first and widest).
	   `order` flips at the SAME step `.rail-grid` itself turns on, scoped
	   to this page only — the shared shell's own default (source order, no
	   `order` set) is untouched for every other caller.
	   ⭐ 760 → 700 (design-rollout, 5f10ba7): `.rail-grid` itself moved to
	   700px — measured, 1024 with the sidebar open gives the rail only
	   729px of container width, under the old 760px step, so the grid
	   stayed single-column there while this page's `order` still assumed
	   the two-column width had already kicked in. A private copy of a
	   shared breakpoint has exactly one job — stay the same number as the
	   original — so this moves with it, not a value chosen independently. */
	.dep-rail-main {
		order: 2;
	}
	.dep-rail-side {
		order: 1;
	}
	@container (min-width: 700px) {
		.dep-rail-main {
			order: 1;
		}
		.dep-rail-side {
			order: 2;
		}
	}
</style>
