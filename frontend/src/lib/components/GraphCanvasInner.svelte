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
		type NodeTypes,
		type EdgeTypes
	} from '@xyflow/svelte';
	import { MiniMap } from '@xyflow/svelte';
	import * as dagre from '@dagrejs/dagre';
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { ZoomInOutline, ZoomOutOutline, ExpandOutline } from 'flowbite-svelte-icons';

	let {
		nodes: sourceNodes,
		edges: sourceEdges,
		layoutEdges = null,
		nodeTypes,
		edgeTypes = undefined,
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
		anchorSpan = null,
		fillWidth = false,
		singleFile = false,
		minZoomWide = 0.55,
		snugHeight = false,
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
		/** Custom edge renderers, keyed by `edge.type`. `undefined` — the
		 *  default — leaves the library's own built-ins (`smoothstep` etc.)
		 *  as the only registered types, exactly as before this prop existed. */
		edgeTypes?: EdgeTypes;
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
		 * ⭐ THE TWO NODES A BLOCKED EDGE HAS, WHEN THE RESTING VIEW MUST SHOW
		 * BOTH, NOT JUST `anchor` WITH A LEAD GUTTER IN FRONT OF IT.
		 *
		 * (2026-09-02, measured on `/dependencies` at 390: the pane opened on
		 * `hello-frontend-app`'s three environments with `hello-api-app` — the
		 * PROVIDER the banner names — entirely off-screen to the left. `anchor`
		 * alone reserves one gutter's worth of lead in front of the held node;
		 * that is sized for an edge LABEL, not for the box on the other end of
		 * the edge, which on the within-rank axis can be a full node-width
		 * further away.
		 *
		 * `[from, to]` — the blocked edge's own two ends — asks the library to
		 * fit EXACTLY those two nodes (`fitView({ nodes })`, which
		 * `@xyflow/system` already computes bounds and a zoom for) instead of
		 * fitting the whole graph and panning within it. This is the "fit the
		 * blocked subgraph" half of the rule: if the fleet does not fit at a
		 * legible zoom, the two nodes that ARE the story do, and the rest stays
		 * reachable by pan or `Fit the whole graph`.
		 *
		 * `null` — the default — keeps the single-node `anchor` behaviour
		 * byte-identical, which is what `AppPromotionFlow` gets since it never
		 * passes this.
		 */
		anchorSpan?: [string, string] | null;
		/**
		 * ⭐ LET THE LAYOUT SPAN THE FRAME — see the long note in the layout
		 * effect. Opt-in, because `AppPromotionFlow`'s stages are a LINE whose
		 * gutter is already tuned against its own card, and this pass owns the
		 * dependency network only. Off, the layout is byte-identical to before.
		 */
		fillWidth?: boolean;
		/**
		 * ⭐ 2026-09-03 · ONE NODE PER RANK, UNDER `TB` ONLY — THE FIX FOR A
		 * WIDTH `fillWidth`/A NARROWER BOX COULD NOT REACH.
		 *
		 * The coordinator's own measurement on the live fleet: at 390 a `TB`
		 * rank is not "the held pair" — dagre ranks by PROMOTION edges only
		 * (`layoutEdges`), and every independent service chain starts its own
		 * rank 0, so a rank at ENVIRONMENT `dev` holds every service the
		 * fleet has, not just the two in the story. Four ~100px boxes plus
		 * the gutters between them do not fit a 307px pane at any zoom this
		 * product accepts as legible (`NARROW`, 0.85), and a `Chip` label is
		 * already AT the 10px floor — this canvas cannot shrink to rescue it.
		 *
		 * `singleFile` replaces the caller's `layoutEdges` with a SYNTHETIC
		 * spine — `flowNodes[i] → flowNodes[i+1]` for every consecutive pair,
		 * in the caller's own insertion order — used for RANKING ONLY, never
		 * drawn. A spine edge between every node guarantees `rank(i) = i`
		 * (`minlen: 1` on a total order), so there is never more than one
		 * node per rank and the within-rank axis this file already had to
		 * fight (`nodesep`, `fillWidth`) simply has nothing left to hold. The
		 * REAL edges — promotion and contract — are still `flowEdges`,
		 * unranked and unchanged; dagre supplies positions, the library still
		 * routes them, exactly as `layoutEdges`'s own doc describes for the
		 * contract edges it already excludes.
		 *
		 * A contract pair is no longer guaranteed adjacent ranks (the caller
		 * orders by SERVICE, not by environment, to keep held components
		 * first — see `layoutOrder`), so a contract edge may now span more
		 * than one row. It still lands on `contractIn`/`contractOut`
		 * (`DependencyNode`'s Left/Right under `TB`), so it still reads as a
		 * sideways relationship and not a promotion, whatever its length.
		 *
		 * `false` — the default, and what `AppPromotionFlow` gets since it
		 * never passes this — keeps `layoutEdges` exactly as the caller sent
		 * it, at every orientation. Only `orientation === 'TB'` engages it
		 * even when `true`: the `LR` desktop reading has room for the real
		 * ranking and loses nothing by keeping it.
		 */
		singleFile?: boolean;
		/**
		 * ⭐ 2026-09-03 · THE `LR` FLOOR AT DESKTOP WIDTHS, WHICH USED TO BE
		 * `0.55` FOR EVERY NON-`narrow` CALLER — AND `0.55` IS NOT LEGIBLE
		 * EITHER, JUST AT A WIDER FRAME THAN `narrow`'s.
		 *
		 * Measured on the dependency network at its natural 927px width: a
		 * 749px card (1024) landed the fit at **0.711 — a 10px `Chip` label
		 * at 7.1px**, below the exact floor `narrow`'s own 0.85 exists to
		 * hold, for the identical reason `narrow` was raised past `0.55` in
		 * the first place. The graph was never TOO BIG here (a 40-node
		 * fixture); it is one dagre pass short of fitting a mid-width card,
		 * and the type paid for it.
		 *
		 * `AppPromotionFlow` never passes this, so its own `0.55` — measured
		 * against ITS stages, not this graph's — is untouched. The dependency
		 * network passes `0.85`, unifying its floor with `narrow`'s at every
		 * width rather than only below 520px: **1024 → 0.85 (12% pan, was
		 * 29%), 1152 → 0.85 (was already close at 0.83), 1280 → unchanged**
		 * (0.95 already clears it). A card whose fit lands under the floor
		 * now overflows and gets its pan/zoom controls exactly as `narrow`
		 * already did — the mechanism is identical, only the width it kicks
		 * in at moves.
		 */
		minZoomWide?: number;
		/**
		 * ⭐ 2026-09-03 · THE PANE STOPS ASSUMING ZOOM 1 FOR ITS OWN HEIGHT.
		 *
		 * `frameHeight` was always `contentHeight + 16` — the height the
		 * drawing needs AT ZOOM 1 — clamped to `[minHeight, maxHeight]`.
		 * That is correct when the resting fit lands at 1, but once a width
		 * floor (`minZoomWide`, above) holds the zoom below what the frame's
		 * width would otherwise allow, the drawing renders SMALLER than the
		 * pane it was sized for: measured at 1024, a 380px pane held a
		 * 259px-tall drawing at 0.711 — **36% empty board below it**, on a
		 * card with nothing else to put there.
		 *
		 * `true` sizes the pane to the WIDTH-DRIVEN zoom the resting fit will
		 * actually land on (`contentHeight * zoom`, same clamp), so the pane
		 * shrinks to what it is actually holding instead of what it would
		 * hold at a zoom the width floor has already ruled out. Only
		 * `orientation === 'LR'` reads it — under `TB` the width is never the
		 * constraint (`singleFile`'s own guarantee), so there is no zoom
		 * shortfall to correct for and this must not perturb that branch's
		 * already-settled height maths.
		 *
		 * `false` — the default, and what `AppPromotionFlow` gets since it
		 * never passes this — keeps `frameHeight` byte-identical to before
		 * this prop existed.
		 */
		snugHeight?: boolean;
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
	 * `FIT_ALL` is the BUTTON. Until 2026-09-02 it had no floor at all — *show
	 * me the whole shape, however small* — but the critic caught it landing a
	 * 12-node fleet at 0.25 (4px type) on a 390px card, the exact "picture of
	 * a graph" `FIT`'s own floor exists to prevent; a press is a request, not
	 * a licence to go illegible. It now shares `restingFit`'s own rule: whole
	 * graph if the whole graph reads at `READABLE_FLOOR` or above (see
	 * `wholeGraphFitZoom`, defined beside `restingFit`), otherwise a press
	 * centres on the blocked edge at the floor and leaves the rest to pan —
	 * "show me the whole shape" demoted to "show me the shape that matters"
	 * exactly when the first is unreadable.
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

	/**
	 * ⛔ THE ARIA TEXT ABOVE PROMISED "Enter opens the one in focus" AND
	 * NOTHING DID IT. (UX sweep finding 5.) The library's own `NodeWrapper`
	 * keydown handler only acts when `selectable` (Escape/select) or
	 * `draggable` (arrow keys) — this canvas sets `elementsSelectable={false}`
	 * and `nodesDraggable={false}` (see the note on those props below), which
	 * a screen-reader user cannot see from the DOM: the node is still
	 * `tabIndex=0`/`role="group"`, still takes focus, and Enter on it was
	 * silently swallowed. `DependencyNode`/`PromotionNode` both already wrap
	 * their content in an `<a href={data.href}>` for the MOUSE path — a click
	 * anywhere in the box works today — so this is the keyboard path to the
	 * exact same destination, not a new affordance.
	 *
	 * Delegated on the container (below `SvelteFlow`'s own subtree) rather
	 * than owned per-node: the library re-renders `.svelte-flow__node` on
	 * every layout pass, so a listener attached there would need re-binding
	 * on every dagre run. One listener, `event.target.closest`, done. `data-id`
	 * is the library's own attribute on that element (`NodeWrapper.svelte`,
	 * vendored copy) — reading it needs no new markup on either node type.
	 *
	 * `preventDefault` fires whenever a node was hit, href or not: Space on a
	 * focused, non-input element is the browser's own "scroll the page" key,
	 * and swallowing Enter/Space is only half the fix if Space still jumps
	 * the reader's scroll position on an unresolved (href-less) node.
	 */
	function onCanvasKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		const target = event.target as HTMLElement | null;
		const nodeEl = target?.closest<HTMLElement>('.svelte-flow__node');
		if (!nodeEl) return;
		event.preventDefault();
		const id = nodeEl.dataset.id;
		const node = id ? flowNodes.find((n) => n.id === id) : undefined;
		const href = (node?.data as { href?: string | null } | undefined)?.href;
		if (href) goto(href);
	}

	let containerEl = $state<HTMLDivElement | null>(null);
	let containerWidth = $state(0);
	// Owned by the effect below — `rankdir` is read there so a caller that
	// switches it at runtime is followed rather than sampled once at mount.
	let orientation = $state<'LR' | 'TB'>('LR');
	/**
	 * ⭐ 2026-09-03 · THE RESTING FIT'S OWN ESCAPE HATCH FROM THE ZOOM FLOOR —
	 * see `SINGLE_FILE_FLOOR` beside `restingFit`. Set true when `LR` cannot
	 * hold the whole graph (or the anchor span) at a legible zoom; reset on
	 * a resize so a wider frame gets a fresh `LR` trial rather than staying
	 * stacked forever.
	 *
	 * ⛔ NOT reset on EVERY resize notification, though — `singleFile`'s own
	 * `TB` layout is far taller than `LR`'s (every node stacks into one
	 * column, unclamped `maxHeight`), so flipping into it can grow the page
	 * enough to bring in a scrollbar, which shrinks THIS component's own
	 * measured width by the scrollbar's ~15px and fires the SAME
	 * `ResizeObserver` that is supposed to only hear about the READER
	 * resizing something. Measured live: that shrink reset `forceStack`,
	 * flipping back to `LR`, which un-grows the page, which regrows the
	 * width, which re-fires the observer, which re-derives `forceStack`
	 * from the (still too-small) zoom and sets it again — an infinite
	 * LR⇄TB oscillation with no user input, one tick after the very first
	 * layout. `widthAtForceStack` below is what breaks it: only a width
	 * change bigger than a scrollbar (`FORCE_STACK_RESIZE_TOLERANCE`) counts
	 * as a real resize worth re-trying `LR` for.
	 */
	let forceStack = $state(false);
	/** The width `forceStack` was set at — see its own doc. Not `$state`:
	 *  read only inside the resize handler and `restingFit`, never rendered. */
	let widthAtForceStack = 0;
	const FORCE_STACK_RESIZE_TOLERANCE = 24;
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
	 * `Fit the whole graph` — which, since 2026-09-02, floors at
	 * `READABLE_FLOOR` too rather than the unbounded zoom-to-fit it used to
	 * do (see `fitAll`, beside `restingFit`): the button existed to escape a
	 * clipped view, and landing it at 4px type was the same failure by
	 * another door.
	 */
	const NARROW = 520;
	const narrow = $derived(containerWidth > 0 && containerWidth < NARROW);
	const FIT = $derived({
		padding: 0.14,
		maxZoom: 1,
		minZoom: narrow ? 0.85 : minZoomWide,
		duration: 150
	});

	/** The anchor's dagre-assigned top-left, in graph units. */
	const anchorPosition = $derived(
		anchor ? (flowNodes.find((n) => n.id === anchor)?.position ?? null) : null
	);

	/**
	 * ⭐ 2026-09-03 · THE SPAN'S OWN X-EXTENT, IN GRAPH UNITS — for the
	 * horizontal pan-to-anchorSpan fix below. `anchorPosition` is a single
	 * point; the RANK axis (columns, under `LR`) never had ANY pan-to-anchor
	 * logic at all before this — see `restingFit`'s own note on why not, and
	 * why that stopped being enough once `anchorSpan` existed.
	 */
	function anchorSpanXBounds(): { left: number; right: number } | null {
		if (!anchorSpan) return null;
		const [a, b] = anchorSpan;
		const na = flowNodes.find((n) => n.id === a);
		const nb = flowNodes.find((n) => n.id === b);
		if (!na || !nb) return null;
		const wa = na.measured?.width ?? fallbackNodeWidth;
		const wb = nb.measured?.width ?? fallbackNodeWidth;
		return {
			left: Math.min(na.position.x, nb.position.x),
			right: Math.max(na.position.x + wa, nb.position.x + wb)
		};
	}

	/**
	 * ⭐ `zoomIn`/`zoomOut` FROM `useSvelteFlow()` ARE DEAD ON THIS CANVAS, AND
	 * IT IS AN UPSTREAM GOTCHA, NOT A TYPO. (2026-09-02, measured: every click
	 * resolved `false` and the transform never moved, forever, at both 390 and
	 * 1440 — only `Fit the whole graph` ever worked.)
	 *
	 * `@xyflow/svelte@1.4.2`'s `useSvelteFlow()` returns MOST of its methods as
	 * closures that re-read the store on every call (`fitView: (o) =>
	 * store.fitView(o)`, `getViewport`, `setViewport`, `setZoom`, `getZoom`) —
	 * but `zoomIn`/`zoomOut` are the two exceptions, returned as a bare
	 * property snapshot: `zoomIn: store.zoomIn`. That distinction is invisible
	 * from the caller and would not matter if `useSvelteFlow()` were called
	 * from a component NESTED INSIDE `<SvelteFlow>`. It is not, here: this
	 * component (`GraphCanvasInner`) is the one that RENDERS `<SvelteFlow>`, so
	 * the call happens before `<SvelteFlow>` has mounted and registered its
	 * real store with the surrounding `<SvelteFlowProvider>`. At that instant
	 * `useStore()` resolves to the PROVIDER'S OWN PLACEHOLDER store
	 * (`createStore({ props: {}, nodes: [], edges: [] })` in
	 * `SvelteFlowProvider.svelte`) — a store whose `panZoom` is never set,
	 * because the real `<SvelteFlow>` never mounts INSIDE it. `store.zoomIn`
	 * captures THAT placeholder's `zoomIn` forever; every later click calls
	 * `zoomBy` on a store with `panZoom === null`, which resolves `false` and
	 * touches nothing. `fitView`, being a closure, re-reads `useStore()` on
	 * every call and always finds the real, swapped-in store — which is why it
	 * alone appeared to work.
	 *
	 * The fix is to never destructure `zoomIn`/`zoomOut` at all and rebuild the
	 * SAME ×1.2 step (`zoomBy`'s own factor, in `@xyflow/system`) on top of
	 * `getZoom`/`setZoom`, both confirmed-lazy closures.
	 */
	const { fitView, getViewport, setViewport, getZoom, setZoom } = useSvelteFlow();
	const ZOOM_STEP = 1.2;
	function zoomIn(options?: { duration?: number }) {
		return setZoom(getZoom() * ZOOM_STEP, options);
	}
	function zoomOut(options?: { duration?: number }) {
		return setZoom(getZoom() / ZOOM_STEP, options);
	}

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
	/**
	 * ⭐ BELOW THIS, THE WHOLE GRAPH IS A PICTURE OF A GRAPH, NOT A GRAPH —
	 * AND ABOVE IT, THE WHOLE GRAPH IS WHAT RESTS. (2026-09-02, a coordinator
	 * correction: the first cut of `anchorSpan` took the subset-fit branch
	 * UNCONDITIONALLY whenever a blocked edge existed, so at 1440 — where
	 * the whole 12-node fleet already fit at 0.97 — it cropped to two nodes
	 * that were already fully on screen, cutting PROD off the right edge and
	 * `hello-world-app` off the bottom to show LESS. The subset fit exists
	 * for when the whole graph genuinely cannot be read; it is not a
	 * standing preference over the whole graph.)
	 *
	 * `wholeGraphFitZoom` answers *what zoom would the whole graph get*,
	 * using the exact arithmetic `fitInset`/`frameFor` already give
	 * `fillWidth` for this same question — uncapped by any floor, only by
	 * `maxZoom: 1` (a fit may shrink, never magnify). `READABLE_FLOOR` is
	 * the line: at or above it, resting on the whole graph is the answer,
	 * same as before `anchorSpan` existed. Below it, the whole graph is a
	 * confetti of unreadable boxes and the blocked edge is what earns the
	 * screen.
	 */
	const READABLE_FLOOR = 0.6;
	/**
	 * ⭐ 2026-09-03 · THE RESTING VIEW's OWN, HIGHER BAR — FIT-TO-PANE WINS
	 * OVER THE ZOOM FLOOR. (Third re-check finding: at 1024/1152 the whole
	 * dependency graph fit landed BETWEEN this line and `FIT.minZoom`
	 * — e.g. ~0.80 — so `fitView({ ...FIT })` clamped the RESTING zoom up to
	 * the 0.85 floor rather than down to what actually fits, and the floor
	 * WINNING is exactly what let `prod hello-frontend-app` render 47px past
	 * the pane's right edge: the fit no longer matched what was requested,
	 * it matched the floor.
	 *
	 * `anchorSpan`'s subset-fit branch already existed for a lower bar
	 * (`READABLE_FLOOR`, 0.6 — still what the `Fit the whole graph` BUTTON
	 * uses, unchanged) but that bar sat below the resting floor itself, so
	 * there was a band — `READABLE_FLOOR` to `FIT.minZoom` — where NEITHER
	 * branch fired: too legible for the subset rescue, not legible enough
	 * to rest on without the floor clamping it. Raising the resting-view
	 * trigger to `FIT.minZoom` (0.85 at these widths, unifying with
	 * `narrow`'s own floor) closes that band: whenever the whole graph
	 * cannot rest AT the floor without the floor doing the clamping, the
	 * blocked pair's own two-node span is fit instead — a subset fit's zoom
	 * is set by the SPAN's own extent, not by the fleet's, so it lands
	 * near 1 for two ~200px boxes and both ends are guaranteed inside the
	 * frame (`fitView({ nodes })` computes bounds for exactly those nodes).
	 * `FIT.minZoom` still does not apply to the subset fit itself — see the
	 * existing note below; capping it would recreate the exact bug at a
	 * smaller scale if the pair's own natural fit ever needed to go lower.
	 */
	function readableSpanFloor(): number {
		return FIT.minZoom;
	}
	/**
	 * ⭐ 2026-09-03 · WHEN THERE IS NO PAIR TO RESCUE THE VIEW WITH — e.g. an
	 * environment filtered down to no blocked edge — OR THE PAIR ITSELF
	 * CANNOT BE SHOWN AT A LEGIBLE ZOOM (`anchorSpanFitZoom` below the same
	 * line — a "column span" running edge-to-edge on the graph, see
	 * `DependencyNetwork`'s own extension), clamping to the floor and
	 * letting it clip — or shrinking the subset fit to satisfy it — is still
	 * the worse choice. Below this line the resting view switches the graph
	 * to the `singleFile` stacked column (`forceStack`) instead: one node
	 * per row, zoom 1, the page scrolls. `AppPromotionFlow` never passes
	 * `singleFile` so this branch never touches it.
	 *
	 * Measured on the live fleet's `/dependencies` at 1024: the DEV→PROD
	 * column span (three environments all holding `hello-frontend-app` at
	 * once) needs **0.727** to show both ends — clearing the OLD `0.7` cut
	 * by a hair while still printing a 7.3px `Chip` label, well under the
	 * "no label under 8.5 effective px" bar. `0.75` catches it; `0.85`
	 * itself is not the cut here on purpose — a span that needs, say, 0.80
	 * is still far more legible resting on ITS OWN two ends than stacked
	 * into a scrolling column it did not otherwise need.
	 */
	const SINGLE_FILE_FLOOR = 0.75;
	function wholeGraphFitZoom(): number {
		if (contentSize.width <= 0 || contentSize.height <= 0 || containerWidth <= 0) return 0;
		const zw = (containerWidth - fitInset(containerWidth)) / contentSize.width;
		const zh = (frameHeight - fitInset(frameHeight)) / contentSize.height;
		return Math.min(1, zw, zh);
	}

	/**
	 * ⭐ 2026-09-03 · WHAT ZOOM THE SUBSET FIT WILL ACTUALLY LAND ON, before
	 * asking the library to compute it — so `restingFit` can tell "both ends
	 * fit at a legible zoom" from "both ends fit, but only by shrinking past
	 * `SINGLE_FILE_FLOOR`" BEFORE committing to the subset-fit branch. A
	 * `anchorSpan` that runs from the graph's first column to its last (the
	 * "column span" case — see `DependencyNetwork`'s own extension) has a
	 * bounding box nearly as wide as the WHOLE graph, so it is not safe to
	 * assume a 2-node subset is always small and always near zoom 1.
	 * Mirrors `wholeGraphFitZoom`'s own arithmetic, over the span's bounding
	 * box instead of the full content box.
	 */
	function anchorSpanFitZoom(a: string, b: string): number {
		const na = flowNodes.find((n) => n.id === a);
		const nb = flowNodes.find((n) => n.id === b);
		if (!na || !nb || containerWidth <= 0) return 0;
		const wa = na.measured?.width ?? fallbackNodeWidth;
		const wb = nb.measured?.width ?? fallbackNodeWidth;
		const ha = na.measured?.height ?? fallbackNodeHeight;
		const hb = nb.measured?.height ?? fallbackNodeHeight;
		const boxWidth = Math.max(na.position.x + wa, nb.position.x + wb) - Math.min(na.position.x, nb.position.x);
		const boxHeight =
			Math.max(na.position.y + ha, nb.position.y + hb) - Math.min(na.position.y, nb.position.y);
		if (boxWidth <= 0 || boxHeight <= 0) return 0;
		const zw = (containerWidth - fitInset(containerWidth)) / boxWidth;
		const zh = (frameHeight - fitInset(frameHeight)) / boxHeight;
		return Math.min(1, zw, zh);
	}

	function restingFit() {
		/**
		 * ⭐ `singleFile` UNDER `TB` SKIPS `fitView` ENTIRELY — ZOOM 1, ALWAYS.
		 *
		 * `fitView`'s `padding` is a PROPORTION of the frame, and the frame
		 * this canvas grows for `singleFile` is sized to the content it holds
		 * (`frameFor`, below — no `maxHeight` clamp on this path). A
		 * proportional pad on a frame that is ALREADY a snug fit is not
		 * breathing room, it is a forced shrink: measured, `FIT.padding:
		 * 0.14` on a 12-row single column pushed the resting zoom under 1 and
		 * put the 10px `Chip` label under its own floor for no reason a
		 * reader could see (nothing was cropped; there was nothing left to
		 * fit). Every node is already guaranteed to fit the frame's width at
		 * zoom 1 — that guarantee is `singleFile`'s whole job — so the
		 * resting view is just "zoom 1, centred", no fit maths required.
		 */
		if (singleFile && orientation === 'TB') {
			if (contentSize.width > 0 && containerWidth > 0) {
				/**
				 * ⭐ LEFT-ALIGNED, NOT CENTRED, WHEN A HOOK NEEDS THE GUTTER.
				 * (2026-09-03.) Centring split the frame's leftover width
				 * evenly on both sides of the column, which is exactly wrong
				 * once `ContractHopEdge` needs a right-hand lane to route
				 * in: half the slack a hook could use was spent on a LEFT
				 * margin nothing draws into. A small fixed margin instead
				 * hands the rest to the gutter, where `gutterX` (computed
				 * above, from the widest node in the column) already assumes
				 * it is there. A graph with no contract edges — nothing to
				 * hook — keeps the old centred reading, since there is no
				 * gutter to reserve room for.
				 */
				const hasHook = flowEdges.some((e) => e.type === 'contractHop');
				const x = hasHook ? 20 : Math.max(0, (containerWidth - contentSize.width) / 2);
				/**
				 * ⭐ CENTRED VERTICALLY, NOT TOP-PINNED — measured, `y: 0` put
				 * dagre's own 12px top margin above the first row and the
				 * frame's `+16` slack (`frameFor`) entirely below the last
				 * one: 12px above, 28px below, same drawing, opposite void.
				 * Splitting the ONE pool of slack (content already carries
				 * its own 12px margin on both edges — this is the `frameFor`
				 * pad only) evens it to ~20/20, under the 24px ceiling either
				 * side.
				 */
				const y = Math.max(0, (frameHeight - contentSize.height) / 2);
				setViewport({ x, y, zoom: 1 }, { duration: 0 });
			}
			return;
		}
		/**
		 * ⭐ `anchorSpan` SKIPS THE WHOLE-GRAPH FIT AND ASKS THE LIBRARY TO
		 * FIT JUST THOSE TWO NODES — BUT ONLY WHEN THE WHOLE GRAPH CANNOT
		 * REST AT THE FLOOR WITHOUT THE FLOOR CLAMPING IT. See the prop's own
		 * comment for the defect this exists to fix, and `readableSpanFloor`
		 * above for why the resting view's own trigger sits at `FIT.minZoom`
		 * now, not at `READABLE_FLOOR` (still the button's own, lower bar).
		 * `fitView({ nodes })` is `@xyflow/system`'s own subset-fit — it
		 * computes the bounds and the zoom for exactly the nodes named, so
		 * the two ends of a blocked edge are guaranteed to both be on screen
		 * when this branch is taken. The single-node `anchor` path below is
		 * untouched for every caller that does not pass `anchorSpan` —
		 * `AppPromotionFlow` among them — and for every caller that does,
		 * once the whole graph itself is legible.
		 *
		 * ⛔ AND `FIT.minZoom` DOES NOT APPLY TO THE SUBSET FIT, ON PURPOSE.
		 * That floor (0.85 narrow / 0.55 wide) was measured against the WHOLE
		 * fleet staying legible; it is exactly what was clamping the pan to a
		 * window too narrow to hold a provider AND a consumer side by side —
		 * two adjacent services can span more raw width than the whole-graph
		 * floor allows a 390px frame to show. `maxZoom: 1` stays (a 2-node
		 * close-up must not blow past the product's own type scale), but the
		 * lower bound falls back to the canvas's global floor (`minZoom` on
		 * `<SvelteFlow>`, 0.25) — resting on the blocked subgraph means AT
		 * WHATEVER ZOOM THAT TAKES to show both ends, not at whatever zoom
		 * the fleet-sized floor still allows.
		 */
		const wholeZoom = wholeGraphFitZoom();
		if (anchorSpan && wholeZoom > 0 && wholeZoom < readableSpanFloor()) {
			const [a, b] = anchorSpan;
			const ids = new Set(flowNodes.map((n) => n.id));
			if (ids.has(a) && ids.has(b)) {
				/**
				 * ⭐ A "column span" can run edge-to-edge on the graph (see
				 * `DependencyNetwork`'s own extension), so before committing to
				 * the subset fit, check whether IT ALSO clears a legible zoom —
				 * `anchorSpanFitZoom` mirrors `wholeGraphFitZoom`'s own maths
				 * over just the span's bounding box. Below `SINGLE_FILE_FLOOR`
				 * the subset fit would satisfy "both ends inside" only by
				 * shrinking type past the floor `narrow` itself exists to
				 * hold — the same failure this whole branch exists to fix, one
				 * level down. Stack instead.
				 */
				const spanZoom = anchorSpanFitZoom(a, b);
				if (
					singleFile &&
					orientation === 'LR' &&
					!forceStack &&
					spanZoom > 0 &&
					spanZoom < SINGLE_FILE_FLOOR
				) {
					forceStack = true;
					widthAtForceStack = containerWidth;
					return;
				}
				fitView({
					nodes: [{ id: a }, { id: b }],
					padding: FIT.padding,
					maxZoom: 1,
					duration: 0
				} as Parameters<typeof fitView>[0]);
				return;
			}
		}
		/**
		 * No pair to rescue the view with, and the floor would be clamping the
		 * zoom UP from something genuinely illegible-at-scale — stack instead
		 * of resting on a clip. See `SINGLE_FILE_FLOOR`'s own doc.
		 */
		if (
			!anchorSpan &&
			singleFile &&
			orientation === 'LR' &&
			!forceStack &&
			wholeZoom > 0 &&
			wholeZoom < SINGLE_FILE_FLOOR
		) {
			forceStack = true;
			widthAtForceStack = containerWidth;
			return;
		}
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
				const x = Math.min(8, Math.max(containerWidth - contentSize.width * z - 8, want));
				if (Math.abs(x - vp.x) > 0.5) setViewport({ x, y: vp.y, zoom: z }, { duration: 0 });
				return;
			}
			let nextX = vp.x;
			let nextY = vp.y;
			let move = false;
			if (contentSize.height > 0 && contentSize.height * z > frameHeight + 4) {
				const want = a ? 8 - (a.y - lead) * z : 8;
				const y = Math.min(8, Math.max(frameHeight - contentSize.height * z - 8, want));
				if (Math.abs(y - vp.y) > 0.5) {
					nextY = y;
					move = true;
				}
			}
			/**
			 * ⭐ 2026-09-03 · THE RANK AXIS NOW PANS TOO, BUT ONLY TO KEEP AN
			 * `anchorSpan` WHOLE — NEVER TO PREFER AN ENVIRONMENT.
			 * (Coordinator finding, ORIGINAL cut: at 1024/1152 the whole graph
			 * read above the OLD `READABLE_FLOOR` of 0.6, so `anchorSpan`'s
			 * subset-fit branch above never engaged, and the ordinary fit's
			 * own centring left `hello-frontend-app` PROD clipped a few px
			 * past the frame's right edge while `anchor` — `hello-api-app`
			 * PROD, on a provider's own page — sat just inside it. The
			 * single-node anchor rule was satisfied to the letter while the
			 * edge it anchors was not.
			 *
			 * ⭐ Third re-check: raising the subset-fit trigger to
			 * `readableSpanFloor()` (`FIT.minZoom`, above) means 1024/1152 now
			 * take the subset-fit branch directly and this code below never
			 * runs for THAT case — but it stays load-bearing for any
			 * `anchorSpan` whose whole-graph fit clears the new, higher
			 * floor (e.g. 1280+) and would otherwise centre the span
			 * off-balance within a fit that basically works.)
			 *
			 * This nudges `x` ONLY WHEN THE SPAN ITSELF FITS the frame at the
			 * resting zoom (`spanWidthPx <= containerWidth`) — a span wider
			 * than the frame has no position that shows both ends, and
			 * `fitView`'s own centring is left alone rather than nudged
			 * toward a false promise. `docstring` above `anchorSpan` still
			 * governs WHICH two nodes this is; nothing about which
			 * environment reads "first" changes for a graph with no
			 * `anchorSpan` at all — `bounds` is `null` and this is a no-op,
			 * byte-identical to before.
			 */
			if (contentSize.width > 0 && containerWidth > 0) {
				const bounds = anchorSpanXBounds();
				if (bounds) {
					const spanWidthPx = (bounds.right - bounds.left) * z;
					if (spanWidthPx <= containerWidth + 4) {
						const screenLeft = bounds.left * z + nextX;
						const screenRight = bounds.right * z + nextX;
						let dx = 0;
						if (screenLeft < 8) dx = 8 - screenLeft;
						else if (screenRight > containerWidth - 8) dx = containerWidth - 8 - screenRight;
						if (dx !== 0) {
							const clampedX = Math.min(
								8,
								Math.max(containerWidth - contentSize.width * z - 8, nextX + dx)
							);
							if (Math.abs(clampedX - nextX) > 0.5) {
								nextX = clampedX;
								move = true;
							}
						}
					}
				}
			}
			if (move) setViewport({ x: nextX, y: nextY, zoom: z }, { duration: 0 });
		});
	}

	/**
	 * ⭐ THE BUTTON'S OWN VERSION OF THE SAME DECISION. See `FIT_ALL`'s comment
	 * above for the defect (12 nodes at 0.25 = 4px type) and `wholeGraphFitZoom`
	 * beside `restingFit` for the shared math. A press keeps its animation
	 * either way — `FIT_ALL.duration` — because a press IS a request, unlike
	 * the instant resting settle.
	 */
	function fitAll() {
		/** Same reasoning as `restingFit`'s own `singleFile` branch — there is
		 *  nothing this button can show that the resting view does not
		 *  already, since every row is already on screen at zoom 1. */
		if (singleFile && orientation === 'TB') {
			restingFit();
			return;
		}
		if (anchorSpan && wholeGraphFitZoom() < READABLE_FLOOR) {
			const [a, b] = anchorSpan;
			const ids = new Set(flowNodes.map((n) => n.id));
			if (ids.has(a) && ids.has(b)) {
				fitView({
					nodes: [{ id: a }, { id: b }],
					padding: FIT_ALL.padding,
					minZoom: READABLE_FLOOR,
					maxZoom: 1,
					duration: FIT_ALL.duration
				} as Parameters<typeof fitView>[0]);
				return;
			}
		}
		fitView(FIT_ALL);
	}

	$effect(() => {
		if (rankdir !== 'auto') {
			orientation = rankdir;
		} else {
			orientation =
				containerWidth > 0 && (containerWidth < stackBelow || forceStack) ? 'TB' : 'LR';
		}
		onorientation?.(orientation);
	});

	$effect(() => {
		if (!containerEl) return;
		const el = containerEl;
		containerWidth = el.clientWidth;
		const refit = () => requestAnimationFrame(() => restingFit());
		const ro = new ResizeObserver((entries) => {
			const newWidth = entries[entries.length - 1]?.contentRect.width ?? containerWidth;
			/**
			 * A resize is a new width, so it earns a fresh `LR` trial — but
			 * see `forceStack`'s own doc for why a SMALL width delta while
			 * already stacked is not treated as one (a scrollbar toggling on
			 * `TB`'s own taller layout, not the reader resizing anything).
			 */
			if (!(forceStack && Math.abs(newWidth - widthAtForceStack) < FORCE_STACK_RESIZE_TOLERANCE)) {
				forceStack = false;
			}
			containerWidth = newWidth;
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
			data: { ...n.data, orientation, singleFile }
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

	/** dagre's own frame around the drawing, both axes. */
	const MARGIN = 12;

	/**
	 * The px `fitView` reserves for its own padding at a given frame size, for
	 * a NUMERIC padding — the exact arithmetic of `parsePadding` in
	 * `@xyflow/system@0.0.73`, doubled because it applies to both edges.
	 *
	 * It is duplicated here rather than guessed at because `fillWidth` has to
	 * predict the zoom the fit will choose: a layout stretched to the raw frame
	 * width is 14% too wide for it and comes back at 0.88, which is the type
	 * regression `maxZoom: 1` exists to prevent, arrived at from the other side.
	 */
	function fitInset(size: number): number {
		return 2 * Math.floor((size - size / (1 + FIT.padding)) * 0.5);
	}

	/** The frame this content height would get. Mirrors `frameHeight`, which
	 *  cannot be read here — it derives from the `contentSize` this effect
	 *  writes. */
	function frameFor(contentHeight: number): number {
		if (height !== null) return height;
		if (contentHeight === 0) return minHeight;
		return Math.round(Math.min(maxHeight, Math.max(minHeight, contentHeight + 16)));
	}

	/** Re-layout whenever the measurements, the orientation or the width move. */
	$effect(() => {
		if (flowNodes.length === 0) {
			contentSize = { width: 0, height: 0 };
			return;
		}
		const dir = orientation;
		const baseNodesep = nodesep ?? (dir === 'TB' ? 30 : 22);
		const baseRanksep = ranksep ?? (dir === 'TB' ? 50 : 96);
		// Read so a resize re-lays-out rather than only re-fitting.
		const frameWidth = containerWidth;

		/**
		 * `singleFile`'s spine — see the prop's own doc. `minlen` defaults to
		 * 1, so a chain covering every node forces `rank(i) = i`: one node per
		 * rank, guaranteed, whatever the real edges look like. Not drawn —
		 * `flowEdges` (below) is what `<SvelteFlow>` actually renders.
		 */
		const rankSource: { source: string; target: string; label?: unknown }[] =
			singleFile && dir === 'TB'
				? flowNodes.slice(1).map((n, i) => ({ source: flowNodes[i].id, target: n.id }))
				: (layoutEdges ?? flowEdges);

		const build = (ns: number, rs: number) => {
			const g = new dagre.graphlib.Graph();
			g.setDefaultEdgeLabel(() => ({}));
			g.setGraph({
				rankdir: dir,
				nodesep: ns,
				ranksep: rs,
				marginx: MARGIN,
				marginy: MARGIN
			});
			flowNodes.forEach((node) => {
				g.setNode(node.id, {
					width: node.measured?.width ?? fallbackNodeWidth,
					height: node.measured?.height ?? fallbackNodeHeight
				});
			});
			rankSource.forEach((edge) => {
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
			return g;
		};

		let g = build(baseNodesep, baseRanksep);

		/**
		 * ══ ⭐ THE LAYOUT FILLS THE FRAME. THE ZOOM NEVER DOES. ═══════════════
		 *
		 * From the human, on the rollout `Dependencies` tab: *"dependencies page
		 * doesn't use full width like the other pages."* Measured at 1800: a
		 * **571px drawing centred in a 988px canvas at scale 1.0**, 209px of
		 * empty ground on each side. Every other card on the page is full-bleed.
		 *
		 * ⛔ AND THE FIX IS NOT A HIGHER ZOOM CAP. `maxZoom: 1` is on record
		 * above: without it the same two-service graph came back at **1.6×**,
		 * printing a 13px node title at 21px. Raising the cap trades this defect
		 * for the one that rule was written to prevent, and the type would be
		 * wrong. The graph is not too small — it is drawn too NARROW, because
		 * dagre is handed a FIXED `ranksep` and a small graph is therefore
		 * INTRINSICALLY narrow at every frame width. No fit can rescue that.
		 *
		 * So the SEPARATION is derived from the measured frame: lay out once at
		 * the caller's values to learn the drawing's natural extent, and if it
		 * comes up short, re-lay-out with the horizontal gutter widened by the
		 * shortfall divided over the gaps that carry it.
		 *
		 * ── WHICH GUTTER, IN BOTH ORIENTATIONS ─────────────────────────────
		 *
		 * ⭐ ONE RULE: **only the separation running along the frame's
		 * CONSTRAINED axis stretches.** The card is bounded in WIDTH and its
		 * height is derived from its content, so the constrained axis is the
		 * horizontal one at every width — and which separation that is
		 * TRANSPOSES with `rankdir`, exactly like the resting pan above:
		 *
		 *   · `LR` — ranks are COLUMNS, so the horizontal gutter is `ranksep`.
		 *   · `TB` — ranks are ROWS and the within-rank axis is horizontal, so
		 *     the horizontal gutter is `nodesep` (which at `TB` is already the
		 *     one sized for the contract labels; widening it only helps).
		 *
		 * ⭐ AND NOTHING STRETCHES VERTICALLY, WHICH IS THE ANSWER TO *"does the
		 * card get taller"*: `frameHeight` is `contentHeight + 16`, so there is
		 * no vertical slack to fill — measured on the same card, 20px of ground
		 * above and below against 209px on each side. Spreading rows would
		 * INVENT height rather than use it, and it would spend the axis that
		 * grows with the fleet (services under `LR`) to fix a defect on the axis
		 * that does not (environments: two of them, forever, on this tab). The
		 * card's height is byte-identical before and after this change.
		 *
		 * ── ⭐ THE CAP: A GRAPH MAY NOT BE MORE GAP THAN GRAPH ─────────────
		 *
		 * An unbounded stretch would have put **582px** of nothing between the
		 * two columns on that tab. An arrow that long is not a relationship any
		 * more, it is a gap with an arrowhead on it, and past some width extra
		 * room is better left as MARGIN — outside the drawing, where the reader
		 * reads it as the card breathing rather than as distance between two
		 * services.
		 *
		 * The line is drawn where the drawing would become mostly empty:
		 *
		 *     **the gutters may never total more than the ranks they separate**
		 *
		 * i.e. at least half of the drawing's extent along the stretched axis is
		 * INK. The budget is the drawing's own — `natural.width` minus the base
		 * gutters IS the summed width of the ranks — so it needs no absolute px
		 * and no magic multiplier, it self-scales with the node boxes, and it
		 * tightens automatically as ranks are added (three environments split
		 * the same allowance two ways) which is exactly when the drawing needs
		 * less help anyway.
		 *
		 * Measured on the live fleet at 1800: the tab's two ranks are 468px of
		 * ink, so its one gutter caps at 468 and the drawing lands at 936 of a
		 * 1198px canvas — 131px of margin a side, against 209 before, and
		 * against the 138 that twelve-node `/dependencies` has always had
		 * WITHOUT anyone complaining about it. `/dependencies` itself never
		 * reaches its cap (347): it wants 178 and gets it.
		 *
		 * ── WHAT DOES NOT CHANGE ───────────────────────────────────────────
		 *
		 * A drawing that is ALREADY bigger than its frame — the 40-service
		 * fixture, and `/dependencies` at 390 — takes the `natural >= target`
		 * branch, runs exactly ONE dagre pass as before, and keeps its overflow,
		 * its pan, its controls and its resting pan-to-the-anchor untouched.
		 * The stretch is also clamped so the stretched drawing can never itself
		 * be reported as overflowing: a graph that fits must not grow zoom
		 * buttons and a pannable pane it had no reason to have.
		 */
		if (fillWidth && frameWidth > 0) {
			const natural = {
				width: (g.graph().width ?? 0) - 2 * MARGIN,
				height: (g.graph().height ?? 0) - 2 * MARGIN
			};
			const frameH = frameFor(g.graph().height ?? 0);
			/**
			 * ⛔ AND A DRAWING THAT ALREADY OVERFLOWS IS LEFT ENTIRELY ALONE.
			 * On the 40-service fixture the frame is `maxHeight` and the fit
			 * lands on `minZoom`, so the frame is not what bounds the drawing
			 * and there is no slack to fill — but the arithmetic below would
			 * still have found 14px of width to share out, spent a second dagre
			 * pass on 160 nodes to move four columns by 5px, and rendered the
			 * difference at 0.55 scale. Fitting on the FREE axis is the
			 * predicate: past it the reader is panning, and the pan, the
			 * controls, the minimap and the resting pan-to-the-anchor are
			 * settled behaviour that this must not touch.
			 */
			const fitsFreeAxis = natural.height + 2 * MARGIN <= frameH;
			if (fitsFreeAxis && natural.width > 0 && natural.height > 0 && frameH > 0) {
				// The zoom the fit will land on is set by the axis that is NOT
				// being stretched, so it is known before the stretch is chosen.
				const zoom = Math.min(1, (frameH - fitInset(frameH)) / natural.height);
				const target = Math.min(
					(frameWidth - fitInset(frameWidth)) / zoom,
					// …but never so wide that `overflows` flips on a graph that fits.
					frameWidth - 2 * MARGIN - 8
				);
				const gaps =
					new Set(flowNodes.map((n) => Math.round(g.node(n.id)?.x ?? 0))).size - 1;
				if (gaps >= 1 && natural.width < target - 4) {
					const base = dir === 'LR' ? baseRanksep : baseNodesep;
					// Everything the drawing is not already spending on gutters —
					// the ranks themselves. Half of the stretched extent, at most.
					const ink = natural.width - gaps * base;
					const next = Math.min(
						base + (target - natural.width) / gaps,
						Math.max(base, ink / gaps)
					);
					if (next > base + 2) {
						g = dir === 'LR' ? build(baseNodesep, next) : build(next, baseRanksep);
					}
				}
			}
		}

		const gg = g.graph();
		const nextSize = { width: gg.width ?? 0, height: gg.height ?? 0 };
		if (nextSize.width !== contentSize.width || nextSize.height !== contentSize.height) {
			contentSize = nextSize;
		}

		/**
		 * ⭐ `gutterX`, FOR EVERY `contractHop` EDGE — see `ContractHopEdge`'s
		 * own header for why this cannot be computed there. Every node shares
		 * one x under `singleFile` (a single dagre chain has no reason to
		 * stagger any node off it — see the prop's own doc), so ONE centre
		 * plus the WIDEST node in the column is enough to clear every node the
		 * vertical run passes, not just this edge's own two ends. `data.lane`
		 * — a caller-assigned integer, sharing edges get consecutive ones — is
		 * added on top so two hooks sharing the gutter still run in parallel
		 * channels instead of on top of each other.
		 */
		if (singleFile && dir === 'TB' && flowEdges.some((e) => e.type === 'contractHop')) {
			const centerX = g.node(flowNodes[0]?.id)?.x ?? 0;
			const maxWidth = Math.max(
				fallbackNodeWidth,
				...flowNodes.map((n) => n.measured?.width ?? fallbackNodeWidth)
			);
			/**
			 * ⭐ 2026-09-03 · `GUTTER_BASE` MUST CLEAR THE LABEL, NOT JUST THE
			 * NODE. Measured: `api ^1.67.0` at `t-button` (12/600) renders
			 * ~84px wide; `label` sits centred on the OUTBOUND segment's own
			 * midpoint (`ContractHopEdge`), so that segment has to be AT LEAST
			 * the label's width or the label's own left half overlaps the
			 * node it just left — exactly the residue this constant exists to
			 * fix. 96 clears the widest label this graph draws with margin to
			 * spare; the pane has the width for it (`restingFit`'s `singleFile`
			 * branch reserves the gutter on purpose).
			 */
			const GUTTER_BASE = 96;
			const LANE_GAP = 20;
			const nextEdges = flowEdges.map((e) => {
				if (e.type !== 'contractHop') return e;
				const lane = typeof (e.data as { lane?: number } | undefined)?.lane === 'number'
					? (e.data as { lane: number }).lane
					: 0;
				const gutterX = centerX + maxWidth / 2 + GUTTER_BASE + lane * LANE_GAP;
				const prevGutterX = (e.data as { gutterX?: number } | undefined)?.gutterX;
				if (prevGutterX === gutterX) return e;
				return { ...e, data: { ...(e.data ?? {}), gutterX } };
			});
			if (nextEdges.some((e, i) => e !== flowEdges[i])) flowEdges = nextEdges;
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

	/**
	 * The width-driven zoom the resting fit will land on, for `snugHeight`
	 * only — see that prop's own doc. `1` (no shrink) unless the pane is
	 * genuinely `LR` and narrower than the drawing's natural width; `TB`
	 * always returns `1` here, untouched.
	 */
	const restingWidthZoom = $derived.by(() => {
		if (!snugHeight || orientation !== 'LR' || contentSize.width <= 0 || containerWidth <= 0) {
			return 1;
		}
		const zw = (containerWidth - fitInset(containerWidth)) / contentSize.width;
		return Math.min(1, Math.max(FIT.minZoom, zw));
	});

	const frameHeight = $derived.by(() => {
		if (height !== null) return height;
		if (contentSize.height === 0) return minHeight;
		return Math.round(
			Math.min(maxHeight, Math.max(minHeight, contentSize.height * restingWidthZoom + 16))
		);
	});

	/**
	 * ⭐ THE CURRENT ZOOM, READ LIVE — because "does this overflow" has to be
	 * asked of what is ACTUALLY on screen, not just the resting fit's baseline.
	 * `getViewport()` is one of `useSvelteFlow()`'s confirmed-lazy closures
	 * (see the note above `zoomIn`/`zoomOut`), so reading it inside a
	 * `$derived` tracks the store's own reactive `viewport` field correctly.
	 *
	 * Without this, zooming IN via the button (now that it works) could not
	 * be followed by a pan: `overflows` was computed once at the natural
	 * (pre-zoom) size, so a graph that fit at rest stayed `panOnDrag={false}`
	 * even after the reader had zoomed past the frame's edge — a control that
	 * *worked* and then handed them a corner they could not reach.
	 */
	const liveZoom = $derived(getViewport().zoom);

	/**
	 * Does the drawing need more room than the frame gives it, AT THE CURRENT
	 * ZOOM? This is what pan and pinch are gated on.
	 */
	const overflows = $derived(
		interaction === 'auto' &&
			contentSize.width > 0 &&
			(contentSize.height * liveZoom > frameHeight + 4 ||
				(containerWidth > 0 && contentSize.width * liveZoom > containerWidth + 4))
	);
	/**
	 * ⭐ THE ZOOM/FIT BUTTONS ARE NOT GATED ON `overflows` ANY MORE.
	 * (2026-09-02, from the coordinator's own measurement: no zoom controls
	 * at all at 1440, where this fleet's graph legitimately fits its frame.)
	 * The ORIGINAL reason to hide them — "a control that does nothing is not
	 * shipped" — assumed showing them competed with the drawing for space,
	 * which was true while they floated OVER the pane. They no longer do:
	 * see the control strip below, which reserves its OWN row and never
	 * overlaps a node at any width. Zooming in to read small type is not
	 * "nothing" even when the graph technically fits at rest, so the only
	 * gate left is the caller's own `controls` opt-in and having something to
	 * draw at all. `AppPromotionFlow` is unaffected — it passes
	 * `controls={false}` outright.
	 */
	const showControls = $derived(controls && flowNodes.length > 0);
	/**
	 * A minimap sells "pan to see the rest of a shape you cannot see" — under
	 * `singleFile`+`TB` there is no rest: the resting view is already zoom 1
	 * with every row inside the frame, so a minimap here would be furniture
	 * with nothing to navigate to.
	 */
	const showMinimap = $derived(
		!(singleFile && orientation === 'TB') &&
			minimapFrom !== null &&
			flowNodes.length >= minimapFrom
	);
</script>

<div class="graph-canvas relative {singleFile && orientation === 'TB' ? 'graph-canvas--scroll' : ''} {className}">
	{#if showControls}
		<!-- ⭐ A STRIP, NOT AN OVERLAY. (2026-09-02) These used to float
		     `absolute` on top of the pane, which is how the zoom stack ended up
		     printed over the DEV node at 390 — there is no width narrow enough
		     to guarantee a top-right corner is empty. A row ABOVE the drawing
		     reserves its own space instead of gambling on the layout leaving a
		     gap, so it can never overlap a node at any width.

		     `rounded-lg` (2026-09-03; was `rounded-md`, the only 6px radius
		     across 18 routes) — the card vocabulary is 8px/4px, and a floating
		     control group reads as a small card, not as the odd radius in
		     between. The minimap below takes the same value for the same
		     reason. -->
		<div class="mb-1.5 flex justify-end">
			<div
				class="flex overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900"
			>
				<button
					type="button"
					onclick={() => zoomIn({ duration: 150 })}
					aria-label="Zoom in"
					title="Zoom in"
					class="flex h-8 w-8 items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
				>
					<ZoomInOutline class="h-4 w-4" />
				</button>
				<button
					type="button"
					onclick={() => zoomOut({ duration: 150 })}
					aria-label="Zoom out"
					title="Zoom out"
					class="flex h-8 w-8 items-center justify-center border-l border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
				>
					<ZoomOutOutline class="h-4 w-4" />
				</button>
				<button
					type="button"
					onclick={() => fitAll()}
					aria-label="Fit the whole graph"
					title="Fit the whole graph"
					class="flex h-8 w-8 items-center justify-center border-l border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
				>
					<ExpandOutline class="h-4 w-4" />
				</button>
			</div>
		</div>
	{/if}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- This `div` (`role="group"`) is a DELEGATION HOST, not itself the
	     interactive element — see `onCanvasKeydown`'s own note. The actual
	     keyboard target is the library's per-node wrapper, four+ levels
	     down, which already carries `role="group"`/`tabindex="0"` and is
	     where Tab actually lands; re-binding a listener there on every
	     dagre re-layout is the cost this delegation avoids. -->
	<div
		bind:this={containerEl}
		class="relative overflow-hidden"
		style="height: {frameHeight}px"
		role="group"
		aria-label={ariaLabel}
		onkeydown={onCanvasKeydown}
	>
		<SvelteFlow
			bind:nodes={flowNodes}
			bind:edges={flowEdges}
			{nodeTypes}
			{edgeTypes}
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
					class="!m-2 !rounded-lg !border !border-gray-200 !bg-white/80 dark:!border-gray-700 dark:!bg-gray-900/80"
				/>
			{/if}
		</SvelteFlow>
	</div>
</div>

<style>
	/* The library paints its own selection/hover chrome on the pane; the
	   dashboard's ground is the card, so the pane is transparent and the
	   cursor states are the ones the interaction actually offers. */
	.graph-canvas :global(.svelte-flow) {
		background: transparent;
	}
	/**
	 * ⭐ `singleFile`+`TB`: THE PAGE OWNS VERTICAL, THE LIBRARY OWNS THE REST.
	 * (2026-09-03.) `overflows` is false on this path (the frame is sized to
	 * the content — see `frameFor`), so `panOnDrag`/`zoomOnPinch` are already
	 * off and nothing here NEEDS this rule to behave correctly. It is a
	 * second, CSS-level guarantee, on the browser's own terms rather than
	 * this file's JS: a single finger scrolls the page (`pan-y`, native,
	 * no JS in the loop at all) and anything else (pinch) still reaches
	 * d3-zoom. Harmless alongside the capture-phase `touchstart` listener
	 * below, which exists for the `overflows === true` cases this rule does
	 * not cover. */
	.graph-canvas--scroll :global(.svelte-flow__pane) {
		touch-action: pan-y;
	}
	.graph-canvas :global(.svelte-flow__node) {
		cursor: default;
	}
	/* An edge label is an HTML div, not SVG <text>, so its ground is a
	   background and it has to follow the theme like every other surface.
	   font-size is a fallback only — every real caller (`DependencyNetwork`,
	   `AppPromotionFlow`) sets it per-edge via `labelStyle` now, landing on
	   a declared role (`t-micro` 11/400 or `t-button` 12/600) instead of
	   this component's own off-scale 10.5px. */
	.graph-canvas :global(.svelte-flow__edge-label) {
		font-size: 11px;
		line-height: 1.3;
		padding: 0 3px;
		/* 4px is the vocabulary's own small radius (`Chip`, `.chip-value`,
		   every other compact label on the canvas); this was the one
		   surface still on 3px. */
		border-radius: 4px;
	}
</style>
