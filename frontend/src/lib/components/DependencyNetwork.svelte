<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE DEPENDENCY NETWORK, DRAWN — on Svelte Flow, laid out by dagre.
	 *
	 * The human asked for *"a full graph to show whole network of
	 * dependencies"* and got per-rollout lists twice. This is the graph. It is
	 * ONE component rendered at two scales — the fleet at `/dependencies` and
	 * one node's neighbourhood on the rollout `dependencies` tab — so the two
	 * are the same idea rather than two designs.
	 *
	 * ── ⭐ THE LIBRARY WAS ALREADY HERE ─────────────────────────────────────
	 *
	 * The first version of this component drew its own SVG from a hand-rolled
	 * Sugiyama layout, with a comment arguing that a graph library was too
	 * heavy to add. `@xyflow/svelte` and `@dagrejs/dagre` were already
	 * dependencies, and `AppPromotionFlow` had already wired them
	 * together in this repo. Everything geometric here now goes through
	 * `GraphCanvas`, which is that component's mechanics extracted so both
	 * flows share one canvas. What is left in this file is the mapping from
	 * the domain model to nodes and edges — and the phone's view, which is not
	 * a canvas at all.
	 *
	 * ── WHAT IS DRAWN ───────────────────────────────────────────────────────
	 *
	 * · A NODE is a SERVICE (a Rollout name), not a (service, environment).
	 *   See `dependency-graph.ts` DECISION 1 — the topology is identical in
	 *   every environment because the constraint lives in the consumer BUILD,
	 *   so per-environment nodes would draw one shape three times.
	 * · An EDGE points PROVIDER → CONSUMER, i.e. the way releases must travel.
	 *   The columns are therefore RELEASE ORDER, left to right, which is the
	 *   controller's own model. The caption says this in words: direction on a
	 *   graph must never be a thing the reader has to infer.
	 * · The EDGE carries the environment axis: a contract satisfied in dev and
	 *   blocked in prod prints both, and the env chips above filter to one
	 *   environment's slice.
	 *
	 * ── WHAT SPENDS COLOUR ──────────────────────────────────────────────────
	 *
	 * ⛔ ALMOST NOTHING. A satisfied edge is a thin gray line and an unheld
	 * service is a plain card; `Satisfied=True` is the norm on every gate on
	 * the live cluster and the product does not draw the norm. The BLOCKED
	 * edge is RED, not amber — `Chip`'s own reasoning for the `blocked` role:
	 * amber means `stuck` and nothing else, and a gate correctly refusing a
	 * candidate is not a stoppage. An UNEVALUATED gate is a DASHED gray line,
	 * never a satisfied one, because a missing condition is not an
	 * observation.
	 *
	 * ── ⭐ MOBILE IS A DIFFERENT OBJECT, AND THE CANVAS DOES NOT MOUNT ──────
	 *
	 * `GraphCanvas` can flip to `TB` on a narrow container — that is what the
	 * promotion flow does — but a pannable, zoomable canvas at 390px is worse
	 * than a list for a graph with crossings in it: the reader is given a
	 * viewport onto something they cannot see all of, on a device with no
	 * hover and no scroll-wheel. So below `sm` this renders RELEASE WAVES,
	 * the ranks as a numbered sequence of sections, and the canvas is NOT IN
	 * THE DOM AT ALL.
	 *
	 * ⛔ `hidden sm:block` WOULD NOT DO. A `SvelteFlow` inside a `display:none`
	 * container measures every node at zero, hands dagre a graph of empty
	 * boxes and fits the viewport to nothing — and then keeps a
	 * `ResizeObserver` and a wheel listener alive for a thing nobody can see.
	 * The breakpoint is therefore a `matchMedia` gate on MOUNTING, not a CSS
	 * class on visibility.
	 */
	import { onMount } from 'svelte';
	import { MarkerType, type Node, type Edge } from '@xyflow/svelte';
	import {
		ArrowRightOutline,
		RefreshOutline,
		ServerSolid,
		QuestionCircleOutline
	} from 'flowbite-svelte-icons';
	import GraphCanvas from '$lib/components/GraphCanvas.svelte';
	import DependencyNode from '$lib/components/DependencyNode.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { theme } from '$lib/stores/theme';
	import type { DependencyNodeData } from '$lib/components/dependency-node-data';
	import {
		releaseWaves,
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

	const nodeTypes = { service: DependencyNode };

	/**
	 * `sm` — the same breakpoint the waves used to be gated on in CSS.
	 *
	 * Read at INIT, not in `onMount`: starting at `false` would render the whole
	 * wave list once on a desktop load and throw it away, and at forty services
	 * that is forty list items built for nobody. The guard is for the prerender
	 * pass, where there is no `window` and no viewport to ask about — the phone
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
		if (n.unresolved) return 'not in this dashboard';
		if (n.blocked) return `held in ${n.blockedEnvs.join(', ')}`;
		const out = outbound.get(n.id) ?? [];
		const serving = out.find((e) => e.providedVersion);
		if (serving) return `serves ${serving.contract} ${serving.providedVersion}`;
		if (out.length > 0) return `serves ${out.length} contract${out.length === 1 ? '' : 's'}`;
		const inn = inbound.get(n.id) ?? [];
		if (inn.length > 0) return `waits on ${inn.length} service${inn.length === 1 ? '' : 's'}`;
		return 'no contracts';
	}

	/** A label is drawn when it says something the two node names do not. */
	function edgeLabel(e: GraphEdge): string | null {
		const base =
			e.state === 'blocked'
				? e.requiredVersion
					? `${e.contract} ${e.requiredVersion}`
					: e.contract
				: // MARK THE DEVIATION, NEVER THE NORM. The CRD defaults `contract` to
					// the provider's own name, so on a default edge the label would just
					// restate the box it points out of.
					e.contract === e.from
					? null
					: e.contract;
		if (e.cyclic) return base ? `cycle · ${base}` : 'cycle';
		return base;
	}

	/**
	 * An SVG `stroke` and a marker `color` take a literal, not a Tailwind class,
	 * so the two hues this canvas spends are named once here and resolved
	 * against the product's own theme store rather than sniffed off the DOM.
	 *
	 * RED for a held link, gray for everything else. That is the whole palette:
	 * `Satisfied=True` is the norm and the norm is not drawn.
	 */
	const INK = {
		blocked: { light: '#dc2626', dark: '#f87171' },
		quiet: { light: '#cbd5e1', dark: '#4b5563' },
		label: { light: '#6b7280', dark: '#9ca3af' },
		ground: { light: '#ffffff', dark: '#1f2937' }
	};
	const dark = $derived($theme === 'dark');
	const ink = $derived((k: keyof typeof INK) => (dark ? INK[k].dark : INK[k].light));

	const flowNodes = $derived<Node[]>(
		graph.nodes.map((n) => {
			const href = hrefOf(n.id);
			const data: DependencyNodeData = {
				name: n.id,
				unresolved: n.unresolved,
				blocked: n.blocked,
				meta: nodeMeta(n),
				href,
				focused: n.id === focus,
				title: n.unresolved
					? `${n.id} — no Rollout of this name is visible to this dashboard`
					: (inbound.get(n.id) ?? []).map((e) => edgeSentence(e)).join('\n') || n.id
			};
			return {
				id: n.id,
				type: 'service',
				position: { x: 0, y: 0 },
				data: data as unknown as Record<string, unknown>,
				selectable: false,
				draggable: false,
				connectable: false
			} satisfies Node;
		})
	);

	/**
	 * ⭐ N CONTRACTS BETWEEN ONE PAIR ARE ONE DRAWN LINK.
	 *
	 * `buildDependencyGraph` keeps them separate on purpose — `platform` can
	 * provide `api`, `events` and `schema` to `checkout`, and folding them in
	 * the MODEL would lose which one is held. But on the CANVAS all three leave
	 * the same handle and arrive at the same one, so they are drawn as one line
	 * carrying three labels stacked on top of each other, which is how
	 * `api ^1.67.0`, `events` and `schema` rendered as the unreadable
	 * `a| schema .0`. (The hand-rolled layout this replaces had the same defect
	 * — it routed every parallel path through the same two centres — and
	 * `smoothstep`'s `offset` cannot separate them either, because two nodes on
	 * one rank pair have no vertical segment to offset.)
	 *
	 * So the canvas draws the RELATION and the `Blocked links` card enumerates
	 * the contracts. The link takes the worst state of its members — blocked
	 * outranks unevaluated outranks satisfied — because a pair with one held
	 * contract is a held pair, and its label leads with the held one.
	 */
	type Link = { key: string; from: string; to: string; edges: GraphEdge[] };
	const links = $derived.by<Link[]>(() => {
		const byPair = new Map<string, GraphEdge[]>();
		for (const e of graph.edges) {
			const pair = `${e.from}\u0000${e.to}`;
			byPair.set(pair, [...(byPair.get(pair) ?? []), e]);
		}
		return [...byPair.values()].map((edges) => ({
			key: edges.map((e) => e.key).join('|'),
			from: edges[0].from,
			to: edges[0].to,
			edges
		}));
	});

	/** Blocked outranks unevaluated outranks satisfied. */
	function linkState(l: Link): 'blocked' | 'unknown' | 'satisfied' {
		if (l.edges.some((e) => e.state === 'blocked')) return 'blocked';
		if (l.edges.some((e) => e.state === 'unknown')) return 'unknown';
		return 'satisfied';
	}

	/**
	 * The held contract first, then a count of the rest. `+2` is enough on a
	 * line; the card below names all three.
	 */
	function linkLabel(l: Link): string | null {
		const ordered = [...l.edges].sort(
			(a, b) => (a.state === 'blocked' ? 0 : 1) - (b.state === 'blocked' ? 0 : 1)
		);
		const labels = ordered.map(edgeLabel).filter((x): x is string => x !== null);
		const rest = l.edges.length - 1;
		if (labels.length === 0) return rest > 0 ? `${l.edges.length} contracts` : null;
		return rest > 0 ? `${labels[0]} +${rest}` : labels[0];
	}

	const flowEdges = $derived<Edge[]>(
		links.map((l) => {
			const state = linkState(l);
			const cyclic = l.edges.some((e) => e.cyclic);
			const stroke = state === 'blocked' ? ink('blocked') : ink('quiet');
			const label = linkLabel(l);
			return {
				id: l.key,
				source: l.from,
				target: l.to,
				type: 'smoothstep',
				label: label ?? undefined,
				// An edge label is an HTML div in this library, so it takes `color`
				// and `background` — not the SVG `fill` a <text> node would.
				labelStyle: `font-weight:${state === 'blocked' ? 600 : 400};color:${
					state === 'blocked' ? stroke : ink('label')
				};background:${ink('ground')};`,
				style: `stroke:${stroke};stroke-width:${state === 'blocked' ? 2 : 1.5};${
					cyclic ? 'stroke-dasharray:2 4;' : state === 'unknown' ? 'stroke-dasharray:4 3;' : ''
				}`,
				markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: stroke },
				ariaLabel: l.edges.map((e) => edgeSentence(e)).join('. '),
				animated: false,
				selectable: false
			} satisfies Edge;
		})
	);

	const waves = $derived(releaseWaves(graph));
	const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
	const waveLabel = (i: number) => `Ships ${ORDINALS[i] ?? `${i + 1}th`}`;
</script>

{#if graph.nodes.length > 0}
	{#if wide}
		<!--
			THE READING, IN WORDS. Direction is the one thing a dependency graph
			can get catastrophically wrong, and no arrowhead convention is
			universal: half the world draws `depends on`, half draws `feeds`. So
			the page says which, once, above the canvas — and the columns then
			mean what they look like they mean.
		-->
		<p class="t-micro mb-3 text-gray-500 dark:text-gray-400">
			Arrows point from a service to the one waiting on it — left ships first.
		</p>
		<GraphCanvas
			nodes={flowNodes}
			edges={flowEdges}
			{nodeTypes}
			rankdir="LR"
			ranksep={compact ? 88 : 104}
			nodesep={22}
			minHeight={compact ? 132 : 148}
			maxHeight={compact ? 380 : 640}
			fallbackNodeWidth={compact ? 180 : 200}
			fallbackNodeHeight={56}
			minimapFrom={14}
			{dark}
			ariaLabel="Dependency network"
			class="rounded-lg border border-gray-200 bg-gray-50/40 dark:border-gray-700 dark:bg-gray-900/40"
		/>
	{:else}
		<!-- ══ PHONE: release waves ═══════════════════════════════════════════
			NOT the graph shrunk. The ranks as an ordered sequence: what ships
			first, what ships after it, and under each service the contracts
			holding it. Same two facts the columns carry, in the shape a phone
			can read.
		-->
		<p class="t-micro mb-3 text-gray-500 dark:text-gray-400">
			Each wave waits on the one above it.
		</p>
		{#each waves as wave, i (i)}
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
										{#if n.unresolved}
											<QuestionCircleOutline
												class="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500"
											/>
										{:else}
											<ServerSolid
												class="h-4 w-4 shrink-0 {n.blocked
													? 'text-red-600 dark:text-red-400'
													: 'text-gray-400 dark:text-gray-500'}"
											/>
										{/if}
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
											<span class="ml-auto shrink-0"><Chip role="blocked" label="held" /></span>
										{/if}
									</div>
									{#if holds.length === 0}
										<!-- A ROOT PROVIDER STILL HAS TO SAY WHAT IT SERVES. On the
										     canvas that number is the second line; without this the
										     phone dropped it, and it is the floor under everyone
										     downstream. -->
										<p class="t-micro mt-0.5 pl-6 text-gray-500 dark:text-gray-400">
											{nodeMeta(n)}
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
													<!-- WHERE, not just WHY. A block in prod only and a block
													     everywhere are two different mornings. -->
													<span class="text-red-700 dark:text-red-400">
														— {e.from} serves {e.providedVersion ?? 'an older version'}{e.blockedEnvs
															.length > 0
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
	{/if}
{/if}
