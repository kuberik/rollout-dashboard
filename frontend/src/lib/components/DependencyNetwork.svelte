<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE DEPENDENCY NETWORK, DRAWN.
	 *
	 * The human asked for *"a full graph to show whole network of
	 * dependencies"* and got per-rollout lists twice. This is the graph. It is
	 * ONE component rendered at two scales — the fleet at `/dependencies` and
	 * one node's neighbourhood on the rollout `dependencies` tab — so the two
	 * are the same idea rather than two designs, the way `/versions` and its
	 * detail page were built.
	 *
	 * ── WHAT IS DRAWN ───────────────────────────────────────────────────────
	 *
	 * · A NODE is a SERVICE (a Rollout name), not a (service, environment).
	 *   See `dependency-graph.ts` DECISION 1 — the topology is identical in
	 *   every environment because the constraint lives in the consumer BUILD,
	 *   so per-environment nodes would draw one shape three times.
	 * · An EDGE points PROVIDER → CONSUMER, i.e. the way releases must travel.
	 *   The columns are therefore RELEASE ORDER, left to right, which is the
	 *   controller's own model (*"providers advance before the consumers"*).
	 *   The card says this in words: direction on a graph must never be a
	 *   thing the reader has to infer.
	 * · The EDGE carries the environment axis: a contract satisfied in dev and
	 *   blocked in prod prints both, and the env chips above filter to one
	 *   environment's slice.
	 *
	 * ── WHAT SPENDS COLOUR ──────────────────────────────────────────────────
	 *
	 * ⛔ ALMOST NOTHING. A satisfied edge is a thin gray line with no label
	 * beyond its contract, and a service that is not held is a plain card.
	 * `Satisfied=True` is the norm on every gate on the live cluster and the
	 * product does not draw the norm.
	 *
	 * The BLOCKED edge is RED, not amber, and that is `Chip`'s own reasoning
	 * for the `blocked` role, written for this very page: *"amber means `stuck`
	 * and nothing else for state, and a gate correctly refusing a candidate is
	 * not a stoppage."* The page's ONE blocking fact still gets the amber
	 * `AlertPanel` — banner scale, one per page — exactly as the rollout
	 * `dependencies` tab does.
	 *
	 * An UNEVALUATED gate is a DASHED gray line. It is not drawn as satisfied,
	 * because a missing condition is not an observation.
	 *
	 * ── MOBILE IS A DIFFERENT OBJECT, DESIGNED, NOT DERIVED ─────────────────
	 *
	 * A pannable canvas at 390px is a hairball you scroll past. So below `sm`
	 * this renders RELEASE WAVES: the layout's own ranks as a numbered
	 * sequence of sections — *ships 1st*, *ships 2nd* — each listing its
	 * services and, under each, the contracts it waits on. That is the same
	 * two facts the columns carry (order, and who waits on whom) in the shape
	 * a phone can actually read, and it comes from `layout.waves`, not from a
	 * separate model that could drift.
	 */
	import type { Component } from 'svelte';
	import {
		ServerSolid,
		QuestionCircleOutline,
		ArrowRightOutline,
		RefreshOutline
	} from 'flowbite-svelte-icons';
	import Chip from '$lib/components/Chip.svelte';
	import {
		layoutGraph,
		edgeSentence,
		type DependencyGraph,
		type GraphEdge,
		type GraphNode
	} from '$lib/view-models/dependency-graph';

	let {
		graph,
		focus = null,
		hrefOf = (id: string) => `/apps/${id}`,
		compact = false
	}: {
		/** Already filtered by environment by the caller. */
		graph: DependencyGraph;
		/** The node this view is about, drawn with the product's selected ring. */
		focus?: string | null;
		/** Where a node links. Return null for a service with no page. */
		hrefOf?: (id: string) => string | null;
		/** Tighter geometry for the rollout tab, where the card is narrower. */
		compact?: boolean;
	} = $props();

	/**
	 * ⭐ THE BOX IS SIZED TO THE LONGEST NAME, NOT TO A ROUND NUMBER.
	 *
	 * At a fixed 184px `hello-frontend-app` rendered as `hello-frontend-a…`,
	 * and a truncated service name is the same defect as a truncated
	 * environment chip: `prod-us-east-1` and `prod-us-west-1` become the same
	 * eight characters. The identifier IS the node, so the column widens to
	 * hold it — bounded, so one pathological name cannot push the graph off
	 * screen.
	 *
	 * 7.7px/char is the MEASURED advance of the 13px/600 system face —
	 * `hello-frontend-app` reports `scrollWidth: 138` for 18 characters — and
	 * 47 is the `held` chip plus its gap, measured at 41.3 in the browser. Both
	 * were read off the rendered page rather than estimated, because the first
	 * estimate (7.3) was 9px short and truncated the exact name this widening
	 * exists for.
	 */
	const nodeWidth = $derived.by(() => {
		const longest = Math.max(0, ...graph.nodes.map((n) => n.id.length));
		const held = graph.nodes.some((n) => n.blocked) ? 47 : 0;
		// +4 of slack: the advance is an average and a name of wide glyphs lands a
		// pixel or two over, which is enough to trip the ellipsis.
		const want = Math.ceil(longest * 7.7) + 16 + 6 + 24 + held + 4;
		return Math.min(compact ? 260 : 300, Math.max(compact ? 168 : 184, want));
	});

	const layout = $derived(
		layoutGraph(graph, {
			nodeWidth,
			nodeHeight: compact ? 56 : 60,
			// Wide enough that an edge label sits in the gutter rather than on
			// top of the box it points at.
			colGap: compact ? 104 : 124
		})
	);
	const nodeById = $derived(new Map(graph.nodes.map((n) => [n.id, n] as const)));
	const inbound = $derived.by(() => {
		const m = new Map<string, GraphEdge[]>();
		for (const e of graph.edges) m.set(e.to, [...(m.get(e.to) ?? []), e]);
		return m;
	});
	const outbound = $derived.by(() => {
		const m = new Map<string, GraphEdge[]>();
		for (const e of graph.edges) m.set(e.from, [...(m.get(e.from) ?? []), e]);
		return m;
	});

	/**
	 * The second line of a node box.
	 *
	 * A provider states WHAT IT SERVES and at what version, because that number
	 * is the floor under everyone downstream and is the fact a person about to
	 * roll it back needs. A leaf consumer states how many contracts hold it.
	 * Neither line is a status word: the box's own treatment carries state.
	 */
	function nodeMeta(n: GraphNode): string {
		const out = outbound.get(n.id) ?? [];
		const serving = out.find((e) => e.providedVersion);
		if (serving) return `serves ${serving.contract} ${serving.providedVersion}`;
		if (out.length > 0)
			return `serves ${out.length} contract${out.length === 1 ? '' : 's'}`;
		const inn = inbound.get(n.id) ?? [];
		if (inn.length > 0) return `waits on ${inn.length} service${inn.length === 1 ? '' : 's'}`;
		return 'no contracts';
	}

	/** A label is drawn when it says something the two node names do not. */
	function edgeLabel(e: GraphEdge): string | null {
		if (e.state === 'blocked') {
			return e.requiredVersion ? `${e.contract} ${e.requiredVersion}` : e.contract;
		}
		// MARK THE DEVIATION, NEVER THE NORM. The CRD defaults `contract` to the
		// provider's own name, so on a default edge the label would restate the
		// box it points out of.
		return e.contract === e.from ? null : e.contract;
	}

	const STROKE: Record<string, string> = {
		blocked: 'stroke-red-500 dark:stroke-red-400',
		satisfied: 'stroke-gray-300 dark:stroke-gray-600',
		unknown: 'stroke-gray-300 dark:stroke-gray-600'
	};

	function nodeIcon(n: GraphNode): Component {
		return n.unresolved ? QuestionCircleOutline : ServerSolid;
	}

	const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
	const waveLabel = (i: number) => `Ships ${ORDINALS[i] ?? `${i + 1}th`}`;
</script>

{#if graph.nodes.length > 0}
	<!--
		THE READING, IN WORDS. Direction is the one thing a dependency graph can
		get catastrophically wrong, and no arrowhead convention is universal:
		half the world draws `depends on`, half draws `feeds`. So the page says
		which, once, at 11px, above the canvas — and the columns then mean what
		they look like they mean.
	-->
	<p class="t-micro mb-3 hidden text-gray-500 sm:block dark:text-gray-400">
		Arrows point from a service to the one waiting on it — left ships first.
	</p>
	<!-- The phone reads waves, not arrows, so it gets the sentence that
	     describes what it is actually looking at. One line, two shapes. -->
	<p class="t-micro mb-3 text-gray-500 sm:hidden dark:text-gray-400">
		Each wave waits on the one above it.
	</p>

	<!-- ══ DESKTOP: the graph ═══════════════════════════════════════════════ -->
	<div class="hidden overflow-x-auto overscroll-x-contain pb-1 sm:block">
		<div
			class="relative"
			style="width:{layout.width}px;height:{layout.height}px;min-width:100%"
		>
			<svg
				class="pointer-events-none absolute inset-0"
				width={layout.width}
				height={layout.height}
				aria-hidden="true"
			>
				<defs>
					<!-- Two markers, because a marker cannot inherit `stroke` from
					     its path in every engine and a red edge with a gray head
					     reads as two different edges. -->
					<marker
						id="dep-arrow"
						viewBox="0 0 8 8"
						refX="7"
						refY="4"
						markerWidth="6"
						markerHeight="6"
						orient="auto-start-reverse"
					>
						<path d="M 0 1 L 7 4 L 0 7 z" class="fill-gray-400 dark:fill-gray-500" />
					</marker>
					<marker
						id="dep-arrow-blocked"
						viewBox="0 0 8 8"
						refX="7"
						refY="4"
						markerWidth="6"
						markerHeight="6"
						orient="auto-start-reverse"
					>
						<path d="M 0 1 L 7 4 L 0 7 z" class="fill-red-500 dark:fill-red-400" />
					</marker>
				</defs>
				{#each layout.edges as e (e.key)}
					<path
						d={e.d}
						fill="none"
						class={STROKE[e.state]}
						stroke-width={e.state === 'blocked' ? 2 : 1.5}
						stroke-dasharray={e.cyclic ? '2 4' : e.state === 'unknown' ? '4 3' : undefined}
						marker-end={e.state === 'blocked' ? 'url(#dep-arrow-blocked)' : 'url(#dep-arrow)'}
					/>
				{/each}
			</svg>

			<!-- Edge labels are HTML, not <text>: they need the product's own
			     type roles and a ground so two crossing labels stay readable. -->
			{#each layout.edges as e (e.key)}
				{@const label = edgeLabel(e.edge)}
				{#if label || e.cyclic}
					<span
						class="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-white px-1 py-px whitespace-nowrap dark:bg-gray-800
							{e.state === 'blocked'
							? 'text-[10.5px] font-semibold text-red-700 dark:text-red-400'
							: 'text-[10.5px] text-gray-500 dark:text-gray-400'}"
						style="left:{e.labelX}px;top:{e.labelY}px"
						title={edgeSentence(e.edge)}
					>
						{#if e.cyclic}<span class="mr-1 text-gray-400 dark:text-gray-500">cycle</span>{/if}{label}
					</span>
				{/if}
			{/each}

			{#each layout.nodes as p (p.id)}
				{@const n = nodeById.get(p.id)}
				{#if n}
					{@const Icon = nodeIcon(n)}
					{@const href = hrefOf(n.id)}
					{@const isFocus = n.id === focus}
					<svelte:element
						this={href && !n.unresolved ? 'a' : 'div'}
						href={href && !n.unresolved ? href : undefined}
						title={n.unresolved
							? `${n.id} — no Rollout of this name is visible to this dashboard`
							: (inbound.get(n.id) ?? []).map((e) => edgeSentence(e)).join('\n') || n.id}
						class="absolute flex flex-col justify-center gap-0.5 overflow-hidden rounded-lg border px-3 transition-colors
							{n.blocked
							? 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/40'
							: n.unresolved
								? 'border-dashed border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50'
								: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}
							{href && !n.unresolved ? 'hover:border-gray-400 dark:hover:border-gray-500' : ''}
							{isFocus ? 'ring-2 ring-gray-900/70 dark:ring-white/70' : ''}"
						style="left:{p.x}px;top:{p.y}px;width:{p.w}px;height:{p.h}px"
					>
						<span class="flex min-w-0 items-center gap-1.5">
							<Icon
								class="h-4 w-4 shrink-0 {n.blocked
									? 'text-red-600 dark:text-red-400'
									: 'text-gray-400 dark:text-gray-500'}"
							/>
							<span
								class="min-w-0 truncate text-[13px] font-semibold text-gray-900 dark:text-white"
								>{n.id}</span
							>
							{#if n.blocked}
								<!-- The MARK on the name line, the WHERE on the line under
								     it. Folding both into one chip truncated to
								     `DEV · STAGING · P…`, which loses the environment that
								     matters most. -->
								<span class="ml-auto shrink-0"><Chip role="blocked" label="held" /></span>
							{/if}
						</span>
						<span class="flex min-w-0 items-center gap-1.5 pl-[22px]">
							<span
								class="t-micro min-w-0 truncate {n.blocked
									? 'text-red-700 dark:text-red-400'
									: 'text-gray-500 dark:text-gray-400'}"
								>{n.blocked
									? `in ${n.blockedEnvs.join(', ')}`
									: n.unresolved
										? 'not in this dashboard'
										: nodeMeta(n)}</span
							>
						</span>
					</svelte:element>
				{/if}
			{/each}
		</div>
	</div>

	<!-- ══ MOBILE: release waves ════════════════════════════════════════════ -->
	<!--
		NOT the graph shrunk. The ranks the layout already computed, printed as
		an ordered sequence: what ships first, what ships after it, and under
		each service the contracts holding it. `layout.waves` is the same array
		the columns are drawn from, so the two cannot disagree.
	-->
	<div class="sm:hidden">
		{#each layout.waves as wave, i (i)}
			{#if wave.length > 0}
				<div class="mb-4 last:mb-0">
					<div
						class="mb-2 flex items-baseline gap-2 border-b border-gray-100 pb-1.5 dark:border-gray-700/60"
					>
						<span class="t-label text-gray-500 dark:text-gray-400">{waveLabel(i)}</span>
						<span class="t-micro ml-auto text-gray-400 dark:text-gray-500"
							>{wave.length} service{wave.length === 1 ? '' : 's'}</span
						>
					</div>
					<ul class="space-y-2">
						{#each wave as id (id)}
							{@const n = nodeById.get(id)}
							{#if n}
								{@const Icon = nodeIcon(n)}
								{@const href = hrefOf(n.id)}
								{@const holds = inbound.get(n.id) ?? []}
								<li
									class="rounded-lg border px-3 py-2
										{n.blocked
										? 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/40'
										: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}
										{n.id === focus ? 'ring-2 ring-gray-900/70 dark:ring-white/70' : ''}"
								>
									<div class="flex min-w-0 items-center gap-2">
										<Icon
											class="h-4 w-4 shrink-0 {n.blocked
												? 'text-red-600 dark:text-red-400'
												: 'text-gray-400 dark:text-gray-500'}"
										/>
										{#if href && !n.unresolved}
											<a
												{href}
												class="min-w-0 truncate text-[13px] font-semibold text-gray-900 dark:text-white"
												>{n.id}</a
											>
										{:else}
											<span
												class="min-w-0 truncate text-[13px] font-semibold text-gray-900 dark:text-white"
												>{n.id}</span
											>
										{/if}
										{#if n.blocked}
											<span class="ml-auto shrink-0"
												><Chip role="blocked" label="held" /></span
											>
										{/if}
									</div>
									{#if holds.length === 0}
										<!-- A ROOT PROVIDER STILL HAS TO SAY WHAT IT SERVES. On the
										     desktop box that number is the second line; without this
										     the phone dropped it, and it is the floor under everyone
										     downstream. -->
										<p class="t-micro mt-0.5 pl-6 text-gray-500 dark:text-gray-400">
											{n.unresolved ? 'not in this dashboard' : nodeMeta(n)}
										</p>
									{/if}
									{#each holds as e (e.key)}
										<div class="mt-1.5 flex min-w-0 items-start gap-1.5 pl-6">
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
												from <span class="font-medium text-gray-900 dark:text-white">{e.from}</span>
												{#if e.state === 'blocked'}
													<!-- WHERE, not just WHY. The desktop box prints the
													     environments on its second line; the phone's `held`
													     chip has no room for them, so they land here — a
													     block in prod only and a block everywhere are two
													     different mornings. -->
													<span class="text-red-700 dark:text-red-400">
														— {e.from} serves {e.providedVersion ?? 'an older version'}{e
															.blockedEnvs.length > 0
															? `, held in ${e.blockedEnvs.join(', ')}`
															: ''}</span
													>
												{:else if e.state === 'unknown'}
													<span class="text-gray-500 dark:text-gray-400"> — not evaluated</span>
												{/if}
											</span>
										</div>
									{/each}
								</li>
							{/if}
						{/each}
					</ul>
				</div>
			{/if}
		{/each}
	</div>
{/if}
