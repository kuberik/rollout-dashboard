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
	import QueryBar from '$lib/components/filter/QueryBar.svelte';
	import { isFiltered, type FilterQuery, queryString } from '$lib/components/filter/filter-model';
	import { depDefs, depText, parseDepFilter, depParams, type DepEntry } from '$lib/components/dependencies-filter';
	import { applyQuery } from '$lib/components/filter/filter-model';
	import DependencyLanes, { lanesNaturalWidth, lanesMinWidth } from '$lib/components/DependencyLanes.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import { buildLanes, heldSinceByEdge, ageOf, freesByService, regionShare, otherHoldsPhrase, NO_ENV, type LaneBlocker } from '$lib/view-models/dependency-lanes';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import ClusterMark from '$lib/components/ClusterMark.svelte';
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

	// One query bar (shared filter/QueryBar): an empty query is every column; Environment and Namespace are two properties of it.
	// The filter lives in the URL (?env=&ns=&q=); an address changed from outside is adopted, never the echo of the one this page wrote.
	let f = $state<FilterQuery>(parseDepFilter(page.url.searchParams));
	let written = page.url.search;
	function setFilter(next: FilterQuery) {
		f = next;
		written = queryString(depParams(page.url.searchParams, next));
		void goto(`${page.url.pathname}${written}${page.url.hash}`, { replaceState: true, keepFocus: true, noScroll: true });
	}
	$effect(() => {
		const cur = page.url.search;
		if (cur === written) return;
		written = cur;
		f = parseDepFilter(page.url.searchParams);
	});
	/* TAKE B: the filter narrows the MATRIX. Environment = the column a rollout is drawn in (its Environment's tier, or where its
	   cluster says it runs), Namespace = the rollout's own namespace. A kept held rollout keeps its held providers (buildLanes), so the
	   banner, the ranked list and the matrix are computed from the same visible set and can never name something not drawn. */
	const heldSince = $derived(heldSinceByEdge(full, query.data?.rolloutDependencies?.items ?? []));
	/* The Gates tab's range or none: a held build set asking several ranges with no Gates-tab reading prints the contract alone
	   ("needs payments"), never the first range of the set — the map may not name a range the rollout's own page does not
	   (pinned by gates-agreement.svelte.test.ts). */
	const needOf = (e: GraphEdge) => heldRequirement(e);
	const fullLanes = $derived(buildLanes({ graph: full, environments, heldSince, needOf }));
	const colOfNode = $derived.by(() => {
		const m = new Map<string, string>();
		for (const c of fullLanes.cells.values()) for (const n of c.nodes) m.set(n.id, c.col);
		return m;
	});
	type DepRow = DepEntry & { id: string };
	const depRows = $derived<DepRow[]>(
		full.nodes.map((n) => {
			const col = colOfNode.get(n.id) ?? NO_ENV;
			return { id: n.id, env: col === NO_ENV ? '' : col, ns: n.namespace, name: n.name };
		})
	);
	const depFacets = $derived(depDefs(fullLanes.columns.map((c) => c.key), (e) => e));
	const filtered = $derived(isFiltered(f));
	const keep = $derived.by(() => {
		if (!filtered) return null;
		const kept = applyQuery(depRows, f, depFacets as never, depText as never) as DepRow[];
		return new Set(kept.map((r) => r.id));
	});
	const lanes = $derived(keep ? buildLanes({ graph: full, environments, heldSince, needOf, keep }) : fullLanes);
	const blocked = $derived(full.blockedEdges);
	let focusKey = $state<string | null>(null);
	const focusBlocker = $derived(lanes.blockers.find((b) => b.node.id === focusKey) ?? null);
	const focusSet = $derived(focusBlocker ? new Set([focusBlocker.node.id, ...focusBlocker.frees.map((n) => n.id)]) : null);
	let now = $state(new Date());
	$effect(() => {
		const t = setInterval(() => (now = new Date()), 60000);
		return () => clearInterval(t);
	});
	const topBlocker = $derived<LaneBlocker | null>(lanes.blockers[0] ?? null);
	/** No held link and no held cell: the map says "Nothing is held" (REFS pattern 11); approvals alone say "No deploy holds another". */
	const nothingHeld = $derived(lanes.heldLinks === 0 && [...lanes.cells.values()].every((c) => c.held === 0));
	/** Calm with held cells (R2-DES-B-5): never "nothing held" beside held marks — name what IS held, counted from the data. */
	const otherHolds = $derived(lanes.heldLinks === 0 ? otherHoldsPhrase(lanes) : null);
	/** The map card's cap: the widest the matrix draws (cells at their max, gutters capped), so the rest goes to the rail. */
	const mapMax = $derived(
		lanesNaturalWidth(
			lanes.columns.length,
			new Set(lanes.links.filter((l) => l.kind === 'contract').map((l) => l.from)).size
		)
	);
	/**
	 * THE MATRIX GETS ITS WIDTH FIRST (R2-DES-B-1). `mapMin` is the narrowest card in which every cell keeps its build and
	 * reason whole (`CELL_MIN`). Three forms, one decision, all read off the same wrap width:
	 *   side    — the rail sits beside the map only while the map still gets `mapMin` (1440 and up on the mock fleet);
	 *   stacked — otherwise the map takes the full width, the rail stacks (1280, 1366: cells 160-180px instead of 105);
	 *   phone   — when even a full-width map is under `mapMin` (980, 1024 with the sidebar open), the phone form draws
	 *             (blocker trees + line map), which was made for a narrow container.
	 * Chosen over narrowing the label column (it frees 28px, the 1024-1366 band needed 70-150) and over wrapping builds
	 * (a version split over two lines is not legible).
	 */
	const mapMin = $derived.by(() => {
		const t = new Map<string, Set<string>>();
		for (const c of lanes.columns) t.set(c.key, new Set());
		for (const l of lanes.links) if (l.kind === 'contract') t.get(lanes.cells.get(l.from)!.col)?.add(l.from);
		return lanesMinWidth(lanes.columns.map((c) => t.get(c.key)?.size ?? 0));
	});
	const RAIL_MIN = $derived(wrapW >= 1300 ? 320 : 300);
	const RAIL_GAP = 32;
	const layout = $derived<'phone' | 'stacked' | 'side'>(
		wrapW === 0 ? 'side' : wrapW < mapMin ? 'phone' : wrapW >= 1000 && wrapW - RAIL_GAP - RAIL_MIN >= mapMin ? 'side' : 'stacked'
	);
	let railHighlight = $state<string[] | null>(null);
	/* Held relationships only where the rail sits BESIDE the map (wrap ≥ 1000) and has room (rail ≥ 480, i.e. 2560 and up):
	   at 1440 the same fact is the edge's hover pill, and on a stacked tablet it would push the map a screen down. */
	let wrapW = $state(0);
	let railW = $state(0);
	/** One row per held CONTRACT relationship (regions already folded per cell pair by the view-model). Promotion rows are not
	 *  listed (R2-DES-B-11): "waits for dev" is already the held cell's own line in the map; the contract's "has" is the one fact
	 *  the map does not print at rest. */
	const heldRelations = $derived(
		lanes.links
			.filter((l) => l.held && l.kind === 'contract')
			.map((l) => {
				const a = lanes.cells.get(l.from)!;
				const b = lanes.cells.get(l.to)!;
				const share = regionShare(l.heldCount, b.sites.length);
				const regions = share ? ` · ${share}` : '';
				const where = a.col === b.col ? `${colWord(b.col)}${regions}` : `${colWord(a.col)} → ${colWord(b.col)}`;
				const build = l.edges.find((e) => e.held.length)?.held[0];
				const fact =
					l.kind === 'contract'
						? `needs ${l.contract ?? 'a contract'}${l.needs.length ? ` ${l.needs.join(' or ')}` : ''} · has ${l.serves ?? 'none here'}`
						: build
							? `${build} not in ${colWord(a.col)} yet`
							: `waits for ${colWord(a.col)}`;
				const n = b.nodes[0];
				return {
					key: l.key,
					from: l.kind === 'contract' ? a.service : null,
					to: b.service,
					where,
					fact,
					since: ageOf(l.since, now),
					href: b.nodes.length === 1 ? href(`/rollouts/${n.cluster}/${n.namespace}/${n.name}`) : href(`/apps/${b.service}`)
				};
			})
	);
	const colWord = (c: string) => (c === NO_ENV ? 'no environment' : c);
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
	/* the namespace pills' fold (visual audit #20): closed, the filter row is one line */

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
	<!-- THE HEAD BAND IS GONE (visual audit #20, 2026-11-13). The navbar already says "Dependencies", and a list page opens on its content
	     (lib/CLAUDE.md: a title that repeats the navbar is a duplicate; no page-level count rollup under a visible title, owner 2026-11-03).
	     The figures it printed live where they label something: "N of M links held" is the graph card's rollup and the Held links card's,
	     and "N not in the graph" / "contains a cycle" are the graph card's own footnote. The `h1` stays for the skip link and a11y. -->
	<h1 class="sr-only">Dependencies</h1>

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
		{#if lanes.heldByDeploy > 0 && topBlocker}
			<!-- THE PAGE'S ONE BLOCKING FACT (held = `pinned`, HeldGlyph). It names the blocker that frees the most; the matrix and the
			     ranked list below draw that exact cell, so headline and centrepiece cannot disagree (D2). -->
			<AlertPanel
				severity="pinned"
				title={`${lanes.heldByDeploy} rollout${lanes.heldByDeploy === 1 ? ' is' : 's are'} held by another deploy`}
				message={`${topBlocker.node.name} in ${colWord(topBlocker.cell.col)} frees the most: ${topBlocker.frees.length} rollout${topBlocker.frees.length === 1 ? '' : 's'} wait on it.`}
				footnote={lanes.oldestSince ? `Oldest hold ${ageOf(lanes.oldestSince, now)}, newest ${ageOf(lanes.newestSince, now)} ago. ${lanes.heldLinks} of ${lanes.totalLinks} links held.` : undefined}
			>
				{#snippet actions()}
					<button type="button" class="btn btn-secondary" data-action="focus-top" onclick={() => (focusKey = focusKey === topBlocker.node.id ? null : topBlocker.node.id)}>
						{focusKey === topBlocker.node.id ? 'Show all' : `Trace ${topBlocker.node.name}`}
					</button>
				{/snippet}
			</AlertPanel>
		{/if}

		{#snippet matrix()}
			<div class="mb-4" data-dep-filter>
				<QueryBar rows={depRows} defs={depFacets} text={depText} query={f} onchange={setFilter} placeholder="Search or filter rollouts" placeholderShort="Search or filter" label="Search and filter the dependency map" hints={{ env: 'prod, staging, dev …', ns: 'a namespace' }} />
			</div>
			<Card
				icon={ShareNodesSolid}
				title="Dependency map"
				verdict={lanes.totalLinks === 0 ? 'no links' : lanes.heldLinks ? `${lanes.heldLinks} of ${lanes.totalLinks} links held` : otherHolds ? `No dependency holds · ${otherHolds.n} held by ${otherHolds.by}` : nothingHeld ? 'Nothing is held' : 'No dependency holds'}
				verdictTone={lanes.heldLinks ? 'held' : 'neutral'}
			>
				{#if lanes.rows.length === 0}
					<p class="t-meta py-6 text-center text-fg-subtle">
						No rollout that depends on another matches this filter.
						<button type="button" class="btn btn-secondary ml-2" onclick={() => setFilter({ q: '', clauses: [] })} data-filter-clear>Clear filters</button>
					</p>
				{:else}
					<DependencyLanes model={lanes} phone={layout === 'phone'} focus={focusSet} highlight={railHighlight} {themeOf} {now} />
				{/if}
				<p class="t-meta mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-fg-subtle" data-graph-footnote>
					<span class="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><path d="M0,3 H22" stroke="var(--k-wire)" /></svg>clear</span>
					<span class="inline-flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><path d="M0,3 H22" stroke="var(--color-held)" stroke-width="1.5" /></svg>held</span>
					{#if layout !== 'phone'}<span>along a row: promotion · down a column: contract</span>{/if}
					{#if full.unlinkedRollouts > 0}<span>{full.unlinkedRollouts} more rollouts depend on nothing</span>{/if}
					{#if lanes.unboundCount > 0}<span>{lanes.unboundCount} without an Environment, placed where their cluster or consumers run</span>{/if}
				</p>
			</Card>
		{/snippet}

		<!-- main + rail at every state (calm included, so the page keeps one composition); the map card is capped at the widest
		     the matrix draws and the rail takes the rest of a 2560/3840 screen (round 2, TL item e) -->
		<div class="rail-wrap" class:mt-6={lanes.heldByDeploy > 0} bind:clientWidth={wrapW}>
			<div class="dep-grid" class:dep-grid--side={layout === 'side'} class:dep-grid--phone={layout === 'phone'} style="--map-max: {mapMax}px; --map-min: {mapMin}px">
				<div class="dep-rail-main min-w-0">{@render matrix()}</div>
				<div class="dep-rail-side min-w-0" id="held-links" bind:clientWidth={railW}>
					<div class="dep-rail-cards" class:dep-rail-cards--two={railW >= 1000}>
						{#if lanes.blockers.length > 0}
							<Card icon={HeldGlyph} iconClass="text-held" title="Unblocks the most" verdict={`${lanes.blockers.length} blocker${lanes.blockers.length === 1 ? '' : 's'}`} verdictTone="held" padded={false}>
								<ul class="divide-y divide-line-subtle">
									{#each lanes.blockers as b (b.node.id)}
										{@const on = focusKey === b.node.id}
										<li class="tap-zone relative px-4 py-3" class:bg-selected={on} data-blocker={b.node.name}>
											<div class="flex min-w-0 items-center gap-2">
												<StatusMark state={b.node.blocked ? 'held' : 'newest'} />
												<button type="button" class="tap-link t-card-title min-w-0 truncate text-left text-fg" aria-pressed={on} onclick={() => (focusKey = on ? null : b.node.id)}>{b.node.name}</button>
												<span class="t-meta shrink-0 text-fg-subtle">{colWord(b.cell.col)}</span>
												<a href={href(`/rollouts/${b.node.cluster}/${b.node.namespace}/${b.node.name}`)} class="nav-link ml-auto shrink-0 !py-0">Open ›</a>
											</div>
											<p class="t-meta mt-1 pl-6 text-fg-muted">{b.why}{#if b.since}<span class="text-fg-subtle">&nbsp;· {ageOf(b.since, now)}</span>{/if}</p>
											<p class="t-meta mt-1 pl-6 text-fg-subtle">
												<span class="tabular-nums text-held">frees {b.frees.length}</span> · {freesByService(b.freesCells).join('; ')}
											</p>
										</li>
									{/each}
								</ul>
							</Card>
						{:else}
							<!-- calm (REFS pattern 11): the same slot, no state ink, one line that says what would appear here -->
							<Card icon={HeldGlyph} iconClass="text-fg-disabled" title="Unblocks the most" verdict={otherHolds ? 'no dependency holds' : 'nothing held'} padded={false}>
								<p class="t-meta px-4 py-3 text-fg-muted" data-calm-rail>
									No deploy is waiting on another.{#if otherHolds}{' '}{otherHolds.n} rollout{otherHolds.n === 1 ? ' is' : 's are'} held by {otherHolds.by} instead; the map marks each.{/if}
									When a release holds others, the one that frees the most leads here.
								</p>
							</Card>
						{/if}
						{#if heldRelations.length && layout === 'side' && railW >= 480}
							<!-- WIDE ONLY (rail ≥ 480px, i.e. 2560 and up): each held relationship's whole fact, once. At 1440 the same fact is
							     the hover pill on its edge (density budget); on a wide screen the room the rail gains is spent on it here. -->
							<div>
								<Card icon={ShareNodesSolid} title="Held relationships" verdict={`${heldRelations.length}`} verdictTone="held" padded={false}>
									<ul class="divide-y divide-line-subtle">
										{#each heldRelations as r (r.key)}
											<!-- svelte-ignore a11y_no_noninteractive_element_interactions (pointer lights the edge; the link is the control) -->
											<li class="tap-zone relative px-4 py-3" data-relation={r.key} onmouseenter={() => (railHighlight = [r.key])} onmouseleave={() => (railHighlight = null)}>
												<div class="flex min-w-0 items-center gap-2">
													<HeldGlyph size={12} class="shrink-0 text-held" />
													<a href={r.href} class="tap-link t-card-title min-w-0 truncate text-fg" onfocus={() => (railHighlight = [r.key])} onblur={() => (railHighlight = null)}>{#if r.from}{r.from}&nbsp;<span class="text-fg-subtle">→</span>&nbsp;{/if}{r.to}</a>
													<span class="t-meta ml-auto shrink-0 text-fg-subtle">{r.where}</span>
												</div>
												<p class="t-meta mt-1 flex gap-2 pl-6 text-held">
													<span class="min-w-0 truncate">{r.fact}</span>
													{#if r.since}<span class="ml-auto shrink-0 tabular-nums text-fg-subtle">{r.since}</span>{/if}
												</p>
											</li>
										{/each}
									</ul>
								</Card>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	/* the ranked blockers lead on a phone, the matrix leads beside them */
	.dep-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.dep-rail-main {
		order: 2;
	}
	.dep-rail-side {
		order: 1;
		container-type: inline-size;
	}
	.dep-rail-cards {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.dep-rail-cards--two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		align-items: start;
	}
	/* ONE decision for the three forms (`layout`, R2-DES-B-1): the phone form carries its own ranked trees, so the rail steps
	   aside; stacked keeps the ranked card first (the tablet order); side sets the rail beside a map that still gets --map-min. */
	.dep-grid--phone .dep-rail-side {
		display: none;
	}
	.dep-grid--side {
		display: grid;
		grid-template-columns: minmax(var(--map-min), var(--map-max)) minmax(300px, 1fr);
		gap: 2rem;
		align-items: start;
	}
	.dep-grid--side .dep-rail-main {
		order: 1;
	}
	.dep-grid--side .dep-rail-side {
		order: 2;
	}
	@container (min-width: 1300px) {
		.dep-grid--side {
			grid-template-columns: minmax(var(--map-min), var(--map-max)) minmax(320px, 1fr);
		}
	}
</style>
