<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE PRODUCT'S ONE GRAPH CANVAS — Svelte Flow laid out by dagre.
	 *
	 * ── WHY THIS IS SHARED ──────────────────────────────────────────────────
	 *
	 * `AppPromotionFlow` already solved every problem a second graph
	 * hits in this repo and this Svelte version: how `SvelteFlow` wants
	 * BINDABLE `nodes`/`edges` rather than `$derived` ones, how dagre's ranks
	 * become positions once the DOM has measured the nodes, how `LR` flips to
	 * `TB` on a narrow container, and how a custom node registers. It was
	 * orphaned in May 2026 when the app page was rebuilt, and the dependency
	 * network was then hand-rolled from scratch with its own ranking,
	 * barycentre ordering and SVG path maths — a second layout engine in the
	 * same tree, for a library that was already a dependency.
	 *
	 * So the MECHANICS live here once and the two callers pass data. Nothing
	 * about the promotion flow is distorted by it: both want the same effect
	 * loop and differ only in option values.
	 *
	 * ── ⭐ WHY `$state` AND NOT `$derived` ──────────────────────────────────
	 *
	 * `SvelteFlow` MUTATES the arrays it is given — it writes `measured` onto
	 * every node once the DOM reports a size, and that measurement is the input
	 * to the layout. A `$derived` array would be rebuilt on every dependency
	 * change and throw the library's own state away, so the caller's data is
	 * SYNCED into `$state` and the library's fields are carried across.
	 *
	 * ── ⭐ A CONTROL THAT DOES NOTHING IS NOT SHIPPED ───────────────────────
	 *
	 * Pan, zoom, the zoom buttons and the minimap are all gated on the laid-out
	 * content actually EXCEEDING the frame. The live fleet is two services and
	 * one contract: at that size the graph fits, so there is nothing to pan to,
	 * nothing to fit back to, and a minimap of two boxes is a toy. They appear
	 * when the graph is big enough to need them and not before.
	 *
	 * ⛔ `zoomOnScroll` IS NEVER ENABLED. A canvas inside a page that captures
	 * the wheel is a scroll trap — the reader tries to leave the card and zooms
	 * it instead. Zoom is on the buttons and on pinch, both of which are asked
	 * for on purpose.
	 */
	import {
		SvelteFlow,
		Background,
		useSvelteFlow,
		type Node,
		type Edge,
		type NodeTypes
	} from '@xyflow/svelte';
	import { MiniMap } from '@xyflow/svelte';
	import * as dagre from '@dagrejs/dagre';
	import { untrack } from 'svelte';
	import { ZoomInOutline, ZoomOutOutline, ExpandOutline } from 'flowbite-svelte-icons';

	let {
		nodes: sourceNodes,
		edges: sourceEdges,
		layoutEdges = null,
		nodeTypes,
		rankdir = 'LR',
		stackBelow = 620,
		nodesep,
		ranksep,
		fallbackNodeWidth = 184,
		fallbackNodeHeight = 60,
		height = null,
		minHeight = 180,
		maxHeight = 560,
		interaction = 'auto',
		controls = true,
		minimapFrom = 12,
		dark = false,
		ariaLabel = 'Graph',
		class: className = ''
	}: {
		/** Positions are assigned here — the caller supplies topology only. */
		nodes: Node[];
		edges: Edge[];
		/**
		 * ⭐ THE EDGES dagre RANKS BY, when that is not every drawn edge.
		 *
		 * dagre is a LAYERED layout: every edge it is given advances a rank. A
		 * graph whose edges are of two kinds — some that must cross ranks and
		 * some that must stay INSIDE one — cannot be expressed to it. Measured
		 * on `@dagrejs/dagre@1.1.8` against the live fleet:
		 *
		 *   · `{ minlen: 0 }`, the documented same-rank trick, THROWS
		 *     (`Cannot read properties of undefined`) out of the normaliser;
		 *   · giving the same-rank edges to dagre as ordinary ones turned three
		 *     environment columns into FOUR, with `hello-frontend-app` in dev
		 *     sharing a column with `hello-api-app` in staging. A column a
		 *     reader believes is an environment and is not is worse than no
		 *     columns at all.
		 *
		 * So the caller may hand dagre the rank-advancing edges ONLY. Svelte
		 * Flow still draws every edge in `edges`: dagre supplies node
		 * POSITIONS, and edge ROUTING is the library's. Nothing is
		 * hand-laid-out — the within-rank ordering the omitted edges would have
		 * influenced is bought back through node insertion order instead
		 * (`layoutOrder` in `dependency-graph.ts`).
		 *
		 * `null` — the default, and what `AppPromotionFlow` passes — means
		 * every drawn edge ranks.
		 */
		layoutEdges?: Edge[] | null;
		nodeTypes: NodeTypes;
		/** `auto` flips to `TB` below `stackBelow` px of container width. */
		rankdir?: 'LR' | 'TB' | 'auto';
		stackBelow?: number;
		nodesep?: number;
		ranksep?: number;
		/** Used until the DOM has measured a node. */
		fallbackNodeWidth?: number;
		fallbackNodeHeight?: number;
		/** Exact frame height. `null` fits the content between min and max. */
		height?: number | null;
		minHeight?: number;
		maxHeight?: number;
		/** `static` never pans or zooms. `auto` enables both once it overflows. */
		interaction?: 'static' | 'auto';
		/** Zoom/fit buttons. Rendered only when the content overflows. */
		controls?: boolean;
		/** Minimap, from this node count up — and only when it overflows. */
		minimapFrom?: number | null;
		/** The product's theme, so the library's own chrome matches the page. */
		dark?: boolean;
		ariaLabel?: string;
		class?: string;
	} = $props();

	/**
	 * ⭐ TWO FITS, BECAUSE `fit` MEANS TWO DIFFERENT THINGS.
	 *
	 * `FIT` is what the canvas does to itself on mount, on resize and after a
	 * re-layout — the RESTING view, and it has a floor and a ceiling:
	 *
	 * · `maxZoom: 1` — a fit may SHRINK a graph that does not fit; it may never
	 *   MAGNIFY one that does. Without it, the live two-service network was
	 *   drawn at 1.6x in a 1200px card: the node title came out at 21px against
	 *   the 13px it is designed at, and the card read as a different type scale
	 *   from every other card on the page.
	 * · `minZoom: 0.55` — a fit may not shrink a graph below legibility either.
	 *   The 40-node fixture is five ranks wide and twenty-eight rows tall; an
	 *   unbounded fit into a 520px frame lands at 0.25, i.e. 3px type, which is
	 *   a picture of a graph rather than a graph. Below the floor the reader
	 *   gets a readable slice and PANS — which is exactly the affordance the
	 *   library buys us, and why the minimap turns on at the same size.
	 *
	 * `FIT_ALL` is the BUTTON, and it has no floor: *show me the whole shape,
	 * however small*. That is a different request from *put me back where I
	 * started*, and the split is why the button still does something on a graph
	 * that opens clipped.
	 */
	const FIT = { padding: 0.14, maxZoom: 1, minZoom: 0.55, duration: 150 };
	const FIT_ALL = { padding: 0.08, maxZoom: 1, duration: 200 };

	/**
	 * The library's default screen-reader text offers to MOVE and DELETE nodes.
	 * Neither is true here — nothing on either canvas is draggable, deletable
	 * or connectable — and a description that promises an interaction the page
	 * does not have is worse than none.
	 */
	const ARIA = {
		'node.a11yDescription.default': 'Use tab to move between items. Enter opens the one in focus.',
		'node.a11yDescription.keyboardDisabled':
			'Use tab to move between items. Enter opens the one in focus.',
		'edge.a11yDescription.default': ''
	};

	let containerEl = $state<HTMLDivElement | null>(null);
	let containerWidth = $state(0);
	// Owned by the effect below — `rankdir` is read there so a caller that
	// switches it at runtime is followed rather than sampled once at mount.
	let orientation = $state<'LR' | 'TB'>('LR');
	/** dagre's own content box, in graph units. */
	let contentSize = $state({ width: 0, height: 0 });

	let flowNodes = $state<Node[]>([]);
	let flowEdges = $state<Edge[]>([]);

	const { fitView, zoomIn, zoomOut, getViewport, setViewport } = useSvelteFlow();

	/**
	 * ⭐ THE RESTING VIEW OF AN OVERFLOWING GRAPH IS ITS TOP, NOT ITS MIDDLE.
	 *
	 * `fitView` CENTRES what it cannot fit. Measured on a 40-service ×
	 * 4-environment fixture: the canvas opened on rows 15-24 of 40, and the
	 * caller had just spent `layoutOrder` putting the HELD rows at row 1.
	 * Centring threw that away — the reader landed in the middle of a fleet
	 * with no reason to believe the answer was above them rather than below.
	 *
	 * So when the drawing is taller than the frame, the fit is followed by a
	 * pan to the top edge. Horizontal placement is left exactly as `fitView`
	 * computed it: the columns ARE the environments and there is no
	 * "first" one to prefer.
	 *
	 * A graph that fits is untouched, so nothing about `AppPromotionFlow`
	 * changes.
	 */
	function restingFit() {
		fitView(FIT);
		requestAnimationFrame(() => {
			if (contentSize.height === 0) return;
			const vp = getViewport();
			if (contentSize.height * vp.zoom <= frameHeight + 4) return;
			setViewport({ x: vp.x, y: 8, zoom: vp.zoom }, { duration: 0 });
		});
	}

	$effect(() => {
		if (rankdir !== 'auto') {
			orientation = rankdir;
			return;
		}
		orientation = containerWidth > 0 && containerWidth < stackBelow ? 'TB' : 'LR';
	});

	$effect(() => {
		if (!containerEl) return;
		containerWidth = containerEl.clientWidth;
		const refit = () => requestAnimationFrame(() => restingFit());
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) containerWidth = entry.contentRect.width;
			refit();
		});
		ro.observe(containerEl);
		window.addEventListener('resize', refit);
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', refit);
		};
	});

	/**
	 * Sync the caller's topology into the library's state, carrying `measured`
	 * and the position dagre last assigned. `untrack` keeps this effect
	 * depending on the CALLER's data only — without it the layout effect's
	 * position writes re-enter here on every frame of a fit.
	 */
	$effect(() => {
		const incoming = sourceNodes.map((n) => ({
			...n,
			position: n.position ?? { x: 0, y: 0 },
			data: { ...n.data, orientation }
		}));
		const incomingEdges = sourceEdges;
		untrack(() => {
			const next = incoming.map((bn) => {
				const existing = flowNodes.find((fn) => fn.id === bn.id);
				return existing
					? { ...bn, measured: existing.measured, position: existing.position }
					: bn;
			});
			const sameIds =
				JSON.stringify(next.map((n) => n.id)) === JSON.stringify(flowNodes.map((n) => n.id));
			const sameData =
				JSON.stringify(next.map((n) => n.data)) === JSON.stringify(flowNodes.map((n) => n.data));
			if (!sameIds || !sameData) flowNodes = next;
			if (JSON.stringify(incomingEdges) !== JSON.stringify(flowEdges)) flowEdges = incomingEdges;
		});
	});

	/** Re-layout whenever the measurements or the orientation move. */
	$effect(() => {
		if (flowNodes.length === 0) {
			contentSize = { width: 0, height: 0 };
			return;
		}
		const dir = orientation;
		const g = new dagre.graphlib.Graph();
		g.setDefaultEdgeLabel(() => ({}));
		g.setGraph({
			rankdir: dir,
			nodesep: nodesep ?? (dir === 'TB' ? 30 : 22),
			ranksep: ranksep ?? (dir === 'TB' ? 50 : 96),
			marginx: 12,
			marginy: 12
		});
		flowNodes.forEach((node) => {
			g.setNode(node.id, {
				width: node.measured?.width ?? fallbackNodeWidth,
				height: node.measured?.height ?? fallbackNodeHeight
			});
		});
		(layoutEdges ?? flowEdges).forEach((edge) => {
			// A self-loop would make dagre's ranking meaningless; xyflow draws it
			// on its own without help from the layout.
			if (edge.source === edge.target) return;
			/**
			 * ⭐ THE LABEL IS PART OF THE EDGE, SO dagre IS TOLD ITS SIZE.
			 *
			 * dagre reserves rank space for a labelled edge. Without this,
			 * `api ^1.67.0 +2` was drawn into a gutter sized for a bare arrow and
			 * its ground ran under the arrowhead and up to the consumer's border.
			 *
			 * The width is ESTIMATED from the character count, and that is fine
			 * HERE in a way it was not for the node boxes: an estimate that is a
			 * few pixels out moves a gutter, where the same error on a node
			 * truncated the service name the box exists to print. Nothing is
			 * clipped if this is wrong.
			 */
			const label = typeof edge.label === 'string' ? edge.label : '';
			g.setEdge(
				edge.source,
				edge.target,
				label ? { width: label.length * 6 + 12, height: 18, labelpos: 'c' } : {}
			);
		});

		dagre.layout(g);

		const gg = g.graph();
		const nextSize = { width: gg.width ?? 0, height: gg.height ?? 0 };
		if (nextSize.width !== contentSize.width || nextSize.height !== contentSize.height) {
			contentSize = nextSize;
		}

		let changed = false;
		const next = flowNodes.map((node) => {
			const dn = g.node(node.id);
			if (!dn) return node;
			const pos = { x: dn.x - dn.width / 2, y: dn.y - dn.height / 2 };
			if (Math.abs(node.position.x - pos.x) > 0.5 || Math.abs(node.position.y - pos.y) > 0.5) {
				changed = true;
				return { ...node, position: pos };
			}
			return node;
		});
		if (changed) {
			flowNodes = next;
			requestAnimationFrame(() => restingFit());
		}
	});

	const frameHeight = $derived.by(() => {
		if (height !== null) return height;
		if (contentSize.height === 0) return minHeight;
		return Math.round(Math.min(maxHeight, Math.max(minHeight, contentSize.height + 16)));
	});

	/**
	 * Does the drawing need more room than the frame gives it? This is the one
	 * predicate every interactive affordance is gated on.
	 */
	const overflows = $derived(
		interaction === 'auto' &&
			contentSize.width > 0 &&
			(contentSize.height > frameHeight + 4 ||
				(containerWidth > 0 && contentSize.width > containerWidth + 4))
	);
	const showControls = $derived(controls && overflows);
	const showMinimap = $derived(
		minimapFrom !== null && overflows && flowNodes.length >= minimapFrom
	);
</script>

<div
	bind:this={containerEl}
	class="graph-canvas relative overflow-hidden {className}"
	style="height: {frameHeight}px"
	role="group"
	aria-label={ariaLabel}
>
	<SvelteFlow
		bind:nodes={flowNodes}
		bind:edges={flowEdges}
		{nodeTypes}
		colorMode={dark ? 'dark' : 'light'}
		fitView
		fitViewOptions={FIT}
		minZoom={0.25}
		maxZoom={1.6}
		ariaLabelConfig={ARIA}
		proOptions={{ hideAttribution: true }}
		nodesDraggable={false}
		nodesConnectable={false}
		elementsSelectable={false}
		panOnDrag={overflows}
		panOnScroll={false}
		zoomOnScroll={false}
		zoomOnPinch={overflows}
		zoomOnDoubleClick={false}
		preventScrolling={false}
	>
		<Background bgColor="transparent" patternColor="rgb(148 163 184 / 0.22)" gap={18} size={1} />
		{#if showMinimap}
			<MiniMap
				position="bottom-right"
				pannable
				zoomable
				height={72}
				width={128}
				bgColor="transparent"
				maskColor="rgb(148 163 184 / 0.18)"
				nodeColor={(n) =>
					(n.data as { blocked?: boolean })?.blocked
						? dark
							? '#f87171'
							: '#ef4444'
						: dark
							? '#4b5563'
							: '#cbd5e1'}
				nodeStrokeWidth={0}
				nodeBorderRadius={2}
				class="!m-2 !rounded-md !border !border-gray-200 !bg-white/80 dark:!border-gray-700 dark:!bg-gray-900/80"
			/>
		{/if}
	</SvelteFlow>

	{#if showControls}
		<!-- The product's own buttons, not the library's: the library's controls
		     are a white stack with no dark mode, and these need to read as the
		     same chrome as every other icon button in the dashboard. -->
		<div class="absolute top-2 right-2 z-10 flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white/90 shadow-sm backdrop-blur dark:border-gray-700 dark:bg-gray-900/90">
			<button
				type="button"
				onclick={() => zoomIn({ duration: 150 })}
				aria-label="Zoom in"
				title="Zoom in"
				class="flex h-7 w-7 items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
			>
				<ZoomInOutline class="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onclick={() => zoomOut({ duration: 150 })}
				aria-label="Zoom out"
				title="Zoom out"
				class="flex h-7 w-7 items-center justify-center border-t border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
			>
				<ZoomOutOutline class="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onclick={() => fitView(FIT_ALL)}
				aria-label="Fit the whole graph"
				title="Fit the whole graph"
				class="flex h-7 w-7 items-center justify-center border-t border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
			>
				<ExpandOutline class="h-3.5 w-3.5" />
			</button>
		</div>
	{/if}
</div>

<style>
	/* The library paints its own selection/hover chrome on the pane; the
	   dashboard's ground is the card, so the pane is transparent and the
	   cursor states are the ones the interaction actually offers. */
	.graph-canvas :global(.svelte-flow) {
		background: transparent;
	}
	.graph-canvas :global(.svelte-flow__node) {
		cursor: default;
	}
	/* An edge label is an HTML div, not SVG <text>, so its ground is a
	   background and it has to follow the theme like every other surface. */
	.graph-canvas :global(.svelte-flow__edge-label) {
		font-size: 10.5px;
		line-height: 1.3;
		padding: 0 3px;
		border-radius: 3px;
	}
</style>
