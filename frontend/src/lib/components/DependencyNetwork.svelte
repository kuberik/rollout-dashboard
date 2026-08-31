<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE DEPENDENCY GRAPH, DRAWN — ONE graph, two edge kinds, on Svelte Flow
	 * laid out by dagre.
	 *
	 * ── ⭐ THE LAYOUT, AND WHAT WAS REJECTED ────────────────────────────────
	 *
	 * The picture is a MATRIX: **environments are columns, services are rows.**
	 * A build moves rightwards along its row through the environments, and
	 * sideways within a column between services that must ship in order. That
	 * is the operator's own model and it is the only arrangement in which the
	 * two edge kinds are told apart by geometry alone.
	 *
	 * Three ways to get dagre to produce it were tried, on the live fleet:
	 *
	 *  ⛔ **Every edge to dagre.** Rejected, measured: 3 environments came out
	 *     as FOUR columns, with `hello-frontend-app` in dev sharing a column
	 *     with `hello-api-app` in staging, because a contract edge inside dev
	 *     advances a rank exactly like a promotion out of dev does. A column a
	 *     reader believes is an environment and is not is worse than no
	 *     columns.
	 *  ⛔ **Contract edges with `minlen: 0`** — the documented same-rank
	 *     constraint. Rejected, measured: `@dagrejs/dagre@1.1.8` THROWS out of
	 *     its normaliser. dagre has no rank-constraint API; `rank: 'same'` is
	 *     graphviz, not this library.
	 *  ✅ **Promotion edges rank; contract edges are drawn but not ranked.**
	 *     dagre gets a graph of disjoint horizontal chains and produces exactly
	 *     three columns with every service on a dead-straight row. Svelte Flow
	 *     then draws the contract edges between the positions dagre assigned —
	 *     edge ROUTING is the library's job, and always was. Nothing here is
	 *     hand-laid-out: no ranking, no barycentres, no coordinates, no paths.
	 *
	 * Verified at scale on a 40-service × 4-environment fixture: 4 columns,
	 * 0 of 40 service rows misaligned, and 13 of 13 contract edges exactly one
	 * row apart — the last of those bought by `layoutOrder`, which is the ONE
	 * lever kept on the drawing and is an ORDER, not a position.
	 *
	 * ── ⭐ TWO EDGE KINDS, TOLD APART WITHOUT A LEGEND ──────────────────────
	 *
	 * The human has rejected legends. The difference used is the one already in
	 * the domain:
	 *
	 *   · a PROMOTION is *the same thing moving*: HORIZONTAL, left handle to
	 *     right handle, between two boxes printing the SAME service name, and
	 *     UNLABELLED — a promotion has no name, because it is not an agreement.
	 *     Its state is legible from the two build ids on its ends.
	 *   · a CONTRACT is *two different things agreeing*: VERTICAL, bottom
	 *     handle to top handle, inside ONE environment column, between two
	 *     boxes with DIFFERENT names, and LABELLED with the contract and the
	 *     constraint (`api ^1.67.0`) — the thing being agreed.
	 *
	 * ── WHAT SPENDS COLOUR ──────────────────────────────────────────────────
	 *
	 * ⛔ ALMOST NOTHING. An open gate is a thin gray line; open is the norm on
	 * this fleet and the product does not draw the norm. A BLOCKED edge is RED,
	 * not amber — `Chip`'s own reasoning for the `blocked` role: amber means
	 * `stuck` and nothing else. A gate we could not READ is a DASHED gray line,
	 * never an open one.
	 *
	 * ── ⭐ MOBILE IS A DIFFERENT OBJECT, AND THE CANVAS DOES NOT MOUNT ──────
	 *
	 * Below `sm` this renders SERVICE LINES — the matrix as rows, one service's
	 * journey through the environments, carrying BOTH relations. (The list it
	 * replaces printed release waves, which were contract-only and could not
	 * express a promotion at all.)
	 *
	 * ⛔ `hidden sm:block` WOULD NOT DO. A `SvelteFlow` inside a `display:none`
	 * container measures every node at zero, hands dagre a graph of empty boxes
	 * and fits the viewport to nothing — and then keeps a `ResizeObserver` and
	 * a wheel listener alive for a thing nobody can see. The breakpoint is a
	 * `matchMedia` gate on MOUNTING, not a CSS class on visibility.
	 */
	import { onMount } from 'svelte';
	import { MarkerType, type Node, type Edge } from '@xyflow/svelte';
	import {
		ArrowRightOutline,
		RefreshOutline,
		ServerSolid,
		ClockOutline,
		UserOutline,
		ExclamationCircleOutline,
		QuestionCircleOutline
	} from 'flowbite-svelte-icons';
	import GraphCanvas from '$lib/components/GraphCanvas.svelte';
	import DependencyNode from '$lib/components/DependencyNode.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { theme } from '$lib/stores/theme';
	import { getEnvironmentThemeStyle, shortEnvLabel, type EnvironmentTheme } from '$lib/environment-theme';
	import type { DependencyNodeData } from '$lib/components/dependency-node-data';
	import {
		layoutOrder,
		serviceLines,
		edgeSentence,
		nodeLabel,
		type RolloutGraph,
		type GraphEdge,
		type GraphNode
	} from '$lib/view-models/dependency-graph';

	let {
		graph,
		focus = null,
		hrefOf = (n: GraphNode) => `/rollouts/${n.cluster}/${n.namespace}/${n.name}`,
		themeOf = () => null,
		compact = false
	}: {
		/** Already filtered by environment by the caller. */
		graph: RolloutGraph;
		/** Node id this view is about, drawn with the product's selected ring. */
		focus?: string | null;
		/** Where a node links. Return null for a rollout with no page. */
		hrefOf?: (n: GraphNode) => string | null;
		/** The env identity theme for a tier. Chips are a function of the NAME. */
		themeOf?: (env: string) => EnvironmentTheme | null;
		/** Tighter geometry for the rollout tab, where the card is narrower. */
		compact?: boolean;
	} = $props();

	const nodeTypes = { rollout: DependencyNode };

	/**
	 * `sm` — read at INIT, not in `onMount`: starting at `false` would build the
	 * whole service-line list once on a desktop load and throw it away. The
	 * guard is for the prerender pass, where there is no `window` — the phone
	 * shape is the honest default there.
	 */
	const MQ = '(min-width: 640px)';
	let wide = $state(typeof window !== 'undefined' && window.matchMedia(MQ).matches);
	onMount(() => {
		const mq = window.matchMedia(MQ);
		wide = mq.matches;
		const onChange = (e: MediaQueryListEvent) => (wide = e.matches);
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	const nodeById = $derived(new Map(graph.nodes.map((n) => [n.id, n] as const)));
	const inbound = $derived.by(() => {
		const m = new Map<string, GraphEdge[]>();
		for (const e of graph.edges) m.set(e.to, [...(m.get(e.to) ?? []), e]);
		return m;
	});

	/**
	 * An SVG `stroke` and a marker `color` take a literal, not a Tailwind class,
	 * so the two hues this canvas spends are named once here and resolved
	 * against the product's own theme store rather than sniffed off the DOM.
	 */
	const INK = {
		blocked: { light: '#dc2626', dark: '#f87171' },
		quiet: { light: '#cbd5e1', dark: '#4b5563' },
		label: { light: '#6b7280', dark: '#9ca3af' },
		ground: { light: '#ffffff', dark: '#1f2937' }
	};
	const dark = $derived($theme === 'dark');
	const ink = $derived((k: keyof typeof INK) => (dark ? INK[k].dark : INK[k].light));

	/**
	 * ⭐ THE ORDER IS THE SEED dagre'S WITHIN-RANK PASS STARTS FROM, so the
	 * nodes are emitted in `layoutOrder` rather than in the model's own sort.
	 * It is what puts a contract's two ends in adjacent rows and a held service
	 * line at the top of a canvas taller than its frame.
	 */
	const orderedNodes = $derived.by(() => {
		const rank = new Map(layoutOrder(graph).map((id, i) => [id, i] as const));
		return [...graph.nodes].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
	});

	/** The gates holding a node that ARE drawn as edges, for its tooltip. */
	function nodeTitle(n: GraphNode): string {
		if (n.unresolved) return `${n.name} — no Rollout of this name is visible to this dashboard`;
		const lines = [nodeLabel(n)];
		if (n.build) lines.push(`running ${n.build}`);
		if (n.candidateCount > 0)
			lines.push(`${n.candidateCount} newer build${n.candidateCount === 1 ? '' : 's'} available`);
		for (const e of inbound.get(n.id) ?? []) lines.push(edgeSentence(e, nodeById));
		for (const h of n.holds) lines.push(h.short);
		return lines.join('\n');
	}

	const flowNodes = $derived<Node[]>(
		orderedNodes.map((n) => {
			const t = themeOf(n.env);
			const data: DependencyNodeData = {
				name: n.name,
				env: n.env,
				envLabel: (t ? shortEnvLabel(t) : shortEnvLabel(n.env)) || n.env,
				themeStyle: t ? getEnvironmentThemeStyle(t) : null,
				build: n.build,
				unresolved: n.unresolved,
				blocked: n.blocked,
				holds: n.holds.map((h) => ({ gate: h.gate, clears: h.clears, short: h.short })),
				href: n.unresolved ? null : hrefOf(n),
				focused: n.id === focus,
				title: nodeTitle(n)
			};
			return {
				id: n.id,
				type: 'rollout',
				position: { x: 0, y: 0 },
				data: data as unknown as Record<string, unknown>,
				selectable: false,
				draggable: false,
				connectable: false
			} satisfies Node;
		})
	);

	/**
	 * A contract edge's label. It is the ONLY label on the canvas, and that is
	 * the point: a contract has a name and a constraint, a promotion has
	 * neither because it is the same artifact on both ends.
	 *
	 * ⛔ MARK THE DEVIATION, NEVER THE NORM — except here the name is the
	 * discriminator, so it is always printed. What is conditional is the
	 * CONSTRAINT: only a held edge has one worth reading.
	 */
	function contractLabel(e: GraphEdge): string {
		const base = e.contract ?? 'contract';
		if (e.state === 'blocked' && e.requiredVersion) return `${base} ${e.requiredVersion}`;
		return base;
	}

	function edgeOf(e: GraphEdge): Edge {
		const stroke = e.state === 'blocked' ? ink('blocked') : ink('quiet');
		const promotion = e.writer === 'promotion';
		const label = promotion ? undefined : contractLabel(e);
		return {
			id: e.key,
			source: e.from,
			target: e.to,
			// THE HANDLES ARE THE DISCRIMINATOR. Left/right is the environment
			// axis, top/bottom the contract axis — see `DependencyNode`.
			sourceHandle: promotion ? 'env-out' : 'contract-out',
			targetHandle: promotion ? 'env-in' : 'contract-in',
			type: 'smoothstep',
			label,
			// An edge label is an HTML div in this library, so it takes `color`
			// and `background` — not the SVG `fill` a <text> node would.
			labelStyle: `font-weight:${e.state === 'blocked' ? 600 : 400};color:${
				e.state === 'blocked' ? stroke : ink('label')
			};background:${ink('ground')};`,
			style: `stroke:${stroke};stroke-width:${e.state === 'blocked' ? 2 : 1.5};${
				e.cyclic ? 'stroke-dasharray:2 4;' : e.state === 'unknown' ? 'stroke-dasharray:4 3;' : ''
			}`,
			markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
			ariaLabel: edgeSentence(e, nodeById),
			animated: false,
			selectable: false
		} satisfies Edge;
	}

	const flowEdges = $derived<Edge[]>(graph.edges.map(edgeOf));
	/** Only these advance a dagre rank. See `GraphCanvasInner.layoutEdges`. */
	const rankEdges = $derived<Edge[]>(
		graph.edges.filter((e) => e.writer === 'promotion').map(edgeOf)
	);

	const lines = $derived(serviceLines(graph));

	const HOLD_ICON = {
		clock: ClockOutline,
		person: UserOutline,
		check: ExclamationCircleOutline,
		upstream: ExclamationCircleOutline,
		unknown: QuestionCircleOutline
	} as const;
</script>

{#if graph.nodes.length > 0}
	{#if wide}
		<!--
			THE READING, IN WORDS — ONCE. Direction is the one thing a graph can
			get catastrophically wrong, and no arrowhead convention is universal.
			This also states which axis is which, so the geometry that replaces a
			legend is itself introduced in one line rather than guessed at.
		-->
		<p class="t-micro mb-3 text-gray-500 dark:text-gray-400">
			Across: a build moving through environments, left first. Down: a service waiting on
			another in the same environment.
		</p>
		<GraphCanvas
			nodes={flowNodes}
			edges={flowEdges}
			layoutEdges={rankEdges}
			{nodeTypes}
			rankdir="LR"
			ranksep={compact ? 96 : 116}
			nodesep={36}
			minHeight={compact ? 148 : 168}
			maxHeight={compact ? 400 : 680}
			fallbackNodeWidth={compact ? 190 : 210}
			fallbackNodeHeight={68}
			minimapFrom={14}
			{dark}
			ariaLabel="Dependency graph"
			class="rounded-lg border border-gray-200 bg-gray-50/40 dark:border-gray-700 dark:bg-gray-900/40"
		/>
	{:else}
		<!-- ══ PHONE: SERVICE LINES ═══════════════════════════════════════════
			The matrix as rows. One section per service, its environments in
			promotion order, and under each stop the contract edges holding it
			and the gates that are not edges at all. Both relations, in the shape
			a 390px column has.
		-->
		<p class="t-micro mb-3 text-gray-500 dark:text-gray-400">
			Each service, through its environments in order.
		</p>
		{#each lines as line (line.name)}
			<div class="mb-4 last:mb-0">
				<div
					class="mb-2 flex items-baseline gap-2 border-b border-gray-100 pb-1.5 dark:border-gray-700/60"
				>
					<span class="t-label min-w-0 truncate text-gray-700 dark:text-gray-200">{line.name}</span>
					<span class="t-micro ml-auto shrink-0 text-gray-400 dark:text-gray-500"
						>{line.nodes.length} environment{line.nodes.length === 1 ? '' : 's'}</span
					>
				</div>
				<ul class="space-y-2">
					{#each line.nodes as n, i (n.id)}
						{@const holds = inbound.get(n.id) ?? []}
						{@const promo = holds.filter((e) => e.writer === 'promotion')}
						{@const contracts = holds.filter((e) => e.writer === 'contract')}
						{@const href = n.unresolved ? null : hrefOf(n)}
						{@const t = themeOf(n.env)}
						<li>
							{#if i > 0}
								<!-- THE PROMOTION EDGE, AS THE GAP BETWEEN TWO ROWS. On the
								     canvas it is a horizontal line; here it is the step down
								     the ladder, and it carries its own state. -->
								<div class="flex items-center gap-1.5 pb-1 pl-3">
									<ArrowRightOutline
										class="h-3 w-3 shrink-0 rotate-90 {promo.some((e) => e.state === 'blocked')
											? 'text-red-500 dark:text-red-400'
											: 'text-gray-300 dark:text-gray-600'}"
									/>
									{#if promo.some((e) => e.state === 'blocked')}
										<!-- ⛔ NOT "dev has not deployed it". The two boxes may be
										     running the SAME build — what dev has not deployed is
										     the build that is WAITING, and a sentence a reader can
										     falsify by looking at the line above it is worse than
										     no sentence. This is `classifyGate`'s own wording for
										     the promotion gate. -->
										<span class="t-micro text-red-700 dark:text-red-400"
											>waiting for {line.nodes[i - 1].env} to deploy the next build{promo.some(
												(e) => e.relType === 'Parallel'
											)
												? ' alongside'
												: ' first'}</span
										>
									{:else if promo.length === 0}
										<span class="t-micro text-gray-400 dark:text-gray-500"
											>no promotion gate between these</span
										>
									{:else if promo.some((e) => e.state === 'unknown')}
										<span class="t-micro text-gray-500 dark:text-gray-400"
											>this promotion gate has not been read</span
										>
									{:else}
										<span class="t-micro text-gray-400 dark:text-gray-500"
											>after {line.nodes[i - 1].env}</span
										>
									{/if}
								</div>
							{/if}
							<div
								class="environment-theme-scope rounded-lg border px-3 py-2
									{n.blocked
									? 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/40'
									: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}
									{n.id === focus ? 'ring-2 ring-gray-900/70 dark:ring-white/70' : ''}"
								style={t ? getEnvironmentThemeStyle(t) : undefined}
							>
								<div class="flex min-w-0 items-center gap-2">
									<Chip role="env" label={(t ? shortEnvLabel(t) : shortEnvLabel(n.env)) || n.env} />
									{#if n.unresolved}
										<QuestionCircleOutline
											class="h-3.5 w-3.5 shrink-0 text-gray-400 dark:text-gray-500"
										/>
									{:else}
										<ServerSolid
											class="h-3.5 w-3.5 shrink-0 {n.blocked
												? 'text-red-600 dark:text-red-400'
												: 'text-gray-400 dark:text-gray-500'}"
										/>
									{/if}
									{#if n.unresolved}
										<span class="t-micro min-w-0 truncate text-gray-500 dark:text-gray-400"
											>not in this dashboard</span
										>
									{:else if href}
										<a
											{href}
											class="t-code-sm min-w-0 truncate text-gray-700 hover:underline dark:text-gray-200"
											>{n.build ?? 'never deployed'}</a
										>
									{:else}
										<span class="t-code-sm min-w-0 truncate text-gray-700 dark:text-gray-200"
											>{n.build ?? 'never deployed'}</span
										>
									{/if}
									{#if n.blocked}
										<span class="ml-auto shrink-0"><Chip role="blocked" label="held" /></span>
									{/if}
								</div>
								{#each contracts as e (e.key)}
									<div class="mt-1.5 flex min-w-0 items-start gap-1.5">
										{#if e.cyclic}
											<RefreshOutline
												class="mt-0.5 h-3 w-3 shrink-0 text-gray-400 dark:text-gray-500"
											/>
										{:else}
											<ArrowRightOutline
												class="mt-0.5 h-3 w-3 shrink-0 {e.state === 'blocked'
													? 'text-red-500 dark:text-red-400'
													: 'text-gray-400 dark:text-gray-500'}"
											/>
										{/if}
										<span class="t-micro min-w-0 text-gray-600 dark:text-gray-300">
											needs <span class="font-medium text-gray-900 dark:text-white"
												>{e.contract}{e.requiredVersion ? ` ${e.requiredVersion}` : ''}</span
											>
											from
											<span class="font-medium text-gray-900 dark:text-white"
												>{nodeById.get(e.from)?.name ?? e.from}</span
											>
											{#if e.state === 'blocked'}
												<span class="text-red-700 dark:text-red-400">
													— it serves {e.providedVersion ?? 'an older version'}</span
												>
											{:else if e.state === 'unknown'}
												<span class="text-gray-500 dark:text-gray-400"> — not read</span>
											{/if}
										</span>
									</div>
								{/each}
								{#each n.holds as hold (hold.gate + hold.short)}
									{@const Icon = HOLD_ICON[hold.clears] ?? QuestionCircleOutline}
									<div class="mt-1.5 flex min-w-0 items-start gap-1.5">
										<Icon
											class="mt-0.5 h-3 w-3 shrink-0 {hold.clears === 'person' ||
											hold.clears === 'unknown'
												? 'text-red-500 dark:text-red-400'
												: 'text-gray-400 dark:text-gray-500'}"
										/>
										<span
											class="t-micro min-w-0 {hold.clears === 'person' || hold.clears === 'unknown'
												? 'text-red-700 dark:text-red-400'
												: 'text-gray-500 dark:text-gray-400'}">{hold.short}</span
										>
									</div>
								{/each}
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	{/if}
{/if}
