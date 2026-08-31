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
	 *
	 * ── ⭐ AND THE SAME TRAP, WORSE, ON TOUCH ───────────────────────────────
	 *
	 * There is no wheel on a phone: a one-finger DRAG is how the page scrolls.
	 * A pannable canvas swallows it, so an operator whose thumb happens to land
	 * on this card cannot get past it — and the card is now the only rendering
	 * of the dependency graph at every width, so that is not a corner case.
	 *
	 * `panOnDrag` cannot express "two fingers only": `createFilter` in
	 * `@xyflow/system@0.0.73` rejects `touchstart` outright when it is false and
	 * accepts it whatever the array says when it is true (the array is checked
	 * against `event.button`, which touch events do not have). So the gate is a
	 * CAPTURE-PHASE listener on this container that stops a ONE-finger
	 * `touchstart` before d3-zoom's own listener on the descendant pane sees
	 * it. Nothing calls `preventDefault`, so the browser scrolls the page.
	 *
	 *   · one finger  → the PAGE scrolls, always, everywhere on the card
	 *   · two fingers → the CANVAS pans and pinch-zooms (d3 reads
	 *     `event.touches`, so the second finger's event starts the gesture with
	 *     both of them, and d3's own `nopropagation` stops the page moving too)
	 *   · a tap on a node still opens it — `click` is synthesised from the
	 *     touch sequence and never passed through `touchstart`
	 *
	 * This is the convention every embedded map uses, for this exact reason.
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
		anchor = null,
		onorientation = undefined,
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
		/**
		 * ⭐ THE NODE THE RESTING VIEW MUST LAND ON when the drawing does not fit.
		 *
		 * *Which node the reader sees first* is a design decision and it belongs
		 * to the caller, which is the only thing that knows what an adverse node
		 * is. `null` falls back to the origin edge of the ordered axis, which is
		 * what the promotion flow wants and what this did before.
		 *
		 * It matters most at phone width, where a 324px card holds about one
		 * service column: without it the canvas opens on whichever member of the
		 * held pair sorts first — on the live fleet the PROVIDER, with the red
		 * consumer clipped off the right edge.
		 */
		anchor?: string | null;
		/**
		 * ⭐ THE DIRECTION THIS CANVAS SETTLED ON, back to the caller.
		 *
		 * With `rankdir="auto"` the flip is decided HERE, from the container's
		 * own measured width — the caller has no `matchMedia` and no breakpoint
		 * class, and must not grow one, because a second opinion about the width
		 * is a second thing that can disagree with the drawing. A caller that
		 * prints a sentence naming the axes, or that wants a different rank
		 * gutter when the ranks are rows rather than columns, reads it from
		 * here.
		 */
		onorientation?: ((o: 'LR' | 'TB') => void) | undefined;
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

	/**
	 * ⭐ AND THE FLOOR IS HIGHER ON A PHONE, BECAUSE 0.55 IS NOT LEGIBLE THERE.
	 *
	 * 0.55 was derived on a 520px frame, where it still lands roughly two thirds
	 * of a wide graph on screen. On a 326px card it does not: the node's own
	 * title is 13px, so 0.55 prints it at 7px, and the result is a picture of a
	 * graph rather than a graph — the exact failure `minZoom` exists to stop,
	 * one screen size further down. At 0.85 the title is 11px, a ~200px node box
	 * is 170px, and just under two services fit across the card. That is what
	 * *read a name and a build id* costs, and it is the whole reason the phone
	 * gets a HIGHER floor than the desktop rather than a lower one.
	 *
	 * The reader then reaches the rest with two fingers, or with
	 * `Fit the whole graph`, which has no floor by design.
	 */
	const NARROW = 520;
	const narrow = $derived(containerWidth > 0 && containerWidth < NARROW);
	const FIT = $derived({
		padding: 0.14,
		maxZoom: 1,
		minZoom: narrow ? 0.85 : 0.55,
		duration: 150
	});

	/** The anchor's dagre-assigned top-left, in graph units. */
	const anchorPosition = $derived(
		anchor ? (flowNodes.find((n) => n.id === anchor)?.position ?? null) : null
	);

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
	 * So when the drawing is bigger than the frame, the fit is followed by a pan
	 * along the WITHIN-RANK axis — the one the caller ordered — onto `anchor`,
	 * the node it says the reader must land on, falling back to that axis's
	 * origin edge. The RANK axis is left exactly as `fitView` computed it: the
	 * ranks are the environments and there is no "first" one to prefer.
	 *
	 * ⭐ AND THAT AXIS TRANSPOSES WITH `orientation`, WHICH IS THE POINT.
	 * Under `LR` the ranks are columns and the ordered axis is VERTICAL, so the
	 * pan is downward onto the anchor's row. Under `TB` — what a 390px card
	 * gets — the ranks are rows and the ordered axis is HORIZONTAL, so the pan
	 * is sideways onto the anchor's COLUMN. Same rule, transposed; not a second
	 * rule for phones.
	 *
	 * ⛔ AND THE FIT ITSELF IS INSTANT, NOT ANIMATED. `fitView(FIT)` with its
	 * 150ms transition and a pan read one frame later froze the viewport
	 * mid-flight: measured at 390, the canvas settled at `scale(1)` rather than
	 * the 0.85 the fit was computing towards. A resting view is a settle, not a
	 * transition anybody asked for. `FIT_ALL` — the button — keeps its
	 * animation, because a press IS a request.
	 *
	 * ⭐ AND IT LEAVES THE WITHIN-RANK GUTTER IN FRONT OF THE ANCHOR, because
	 * that gutter is where the edge INTO the anchor draws its label. Landing the
	 * anchor's own border on the frame edge put `api ^1.67.0` — the whole reason
	 * the node is red — just off screen at 390, leaving an arrowhead arriving
	 * from nowhere. `nodesep` is already the size of that gutter, so no second
	 * number is invented for it.
	 *
	 * The pan is clamped to the drawing's own edges, so anchoring on a node
	 * near the far end scrolls the graph rather than revealing blank canvas
	 * past it.
	 *
	 * A graph that fits is untouched, so nothing about `AppPromotionFlow`
	 * changes.
	 */
	function restingFit() {
		fitView({ ...FIT, duration: 0 });
		requestAnimationFrame(() => {
			const vp = getViewport();
			const z = vp.zoom;
			const a = anchorPosition;
			const lead = nodesep ?? (orientation === 'TB' ? 30 : 22);
			if (orientation === 'TB') {
				if (contentSize.width === 0 || containerWidth === 0) return;
				if (contentSize.width * z <= containerWidth + 4) return;
				const want = a ? 8 - (a.x - lead) * z : 8;
				/**
				 * ⛔ AND THE DRAWING STOPS SHORT OF THE ZOOM BUTTONS. They are a
				 * 28px column in the top-right and they are opaque enough to
				 * hide what is under them: measured on the rollout tab at 390,
				 * the right-hand clamp pushed the graph flush to the frame edge
				 * and the buttons printed over the last two characters of
				 * `hello-frontend-app`. A clipped service name is a hard defect,
				 * and it is worse here than a strip of empty canvas, which is
				 * all this trades it for.
				 */
				const controlGutter = showControls ? 40 : 0;
				const x = Math.min(
					8,
					Math.max(containerWidth - controlGutter - contentSize.width * z - 8, want)
				);
				if (Math.abs(x - vp.x) > 0.5) setViewport({ x, y: vp.y, zoom: z }, { duration: 0 });
				return;
			}
			if (contentSize.height === 0) return;
			if (contentSize.height * z <= frameHeight + 4) return;
			const want = a ? 8 - (a.y - lead) * z : 8;
			const y = Math.min(8, Math.max(frameHeight - contentSize.height * z - 8, want));
			if (Math.abs(y - vp.y) > 0.5) setViewport({ x: vp.x, y, zoom: z }, { duration: 0 });
		});
	}

	$effect(() => {
		if (rankdir !== 'auto') {
			orientation = rankdir;
		} else {
			orientation = containerWidth > 0 && containerWidth < stackBelow ? 'TB' : 'LR';
		}
		onorientation?.(orientation);
	});

	$effect(() => {
		if (!containerEl) return;
		const el = containerEl;
		containerWidth = el.clientWidth;
		const refit = () => requestAnimationFrame(() => restingFit());
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) containerWidth = entry.contentRect.width;
			refit();
		});
		ro.observe(el);
		window.addEventListener('resize', refit);
		/**
		 * ⭐ ONE FINGER BELONGS TO THE PAGE. See the header comment: this stops
		 * a single-touch `touchstart` reaching d3-zoom's listener on the pane
		 * below, so the browser scrolls the page instead of the canvas eating
		 * the drag. Two or more touches propagate untouched, which is the pan
		 * and pinch gesture. Nothing is `preventDefault`ed here — that would put
		 * the trap back.
		 */
		const onTouchStart = (e: TouchEvent) => {
			if (e.touches.length < 2) e.stopPropagation();
		};
		el.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
		return () => {
			ro.disconnect();
			window.removeEventListener('resize', refit);
			el.removeEventListener('touchstart', onTouchStart, { capture: true });
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
