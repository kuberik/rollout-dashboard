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
	// ⭐ D-20b ROUND 2 (coordinator decision) — the candidate+greedy label
	// placement module this file used to import is deleted (with it, not
	// kept around unused): no route this file draws carries label text any
	// more, so there was nothing left anywhere in the app calling it.

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
		snugFrame = true,
		forceStackCeiling = null,
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
		 * ⭐ 2026-09-18 · OPT OUT OF `snugFrameWidth` ENTIRELY, PER CALLER.
		 *
		 * `snugFrameWidth` (see its own doc below) exists because a small `LR`
		 * drawing in a WIDE band is mostly dead card — it caps the frame at
		 * `natural.width / 0.5` so the ink does not drown in blank ground. That
		 * premise stops holding once the CALLER'S OWN CARD is already sized to
		 * the drawing rather than to a fixed wide band: there the ratio is
		 * already high, and narrowing the frame a second time draws a small
		 * tinted rectangle floating inside a bordered card with dead card
		 * either side of IT — the exact "box inside a box" `snugFrameWidth`
		 * exists to prevent, just moved one level in.
		 *
		 * `true` is the default and keeps every existing caller
		 * byte-identical (`/dependencies`, `AppPromotionFlow`). `false` is for
		 * a caller whose card was built around this drawing — currently only
		 * `DependencyNetwork`'s `compact` rollout-tab rendering.
		 */
		snugFrame?: boolean;
		/**
		 * ⭐ 2026-10-08 · D-20 — THE WIDTH ABOVE WHICH `forceStack` MAY NEVER
		 * ENGAGE, WHATEVER THE ZOOM SAYS.
		 *
		 * `forceStack` (see its own doc, and `SINGLE_FILE_FLOOR` beside
		 * `restingFit`) was built as a pure LEGIBILITY rescue: whatever the
		 * width, if the whole graph cannot rest above `SINGLE_FILE_FLOOR` it
		 * stacks into one column. That is right for a narrow card, where
		 * there is no width left to spend. It is wrong for a WIDE one: the
		 * coordinator's D-20 decision requires `/dependencies` to stay a
		 * layered `LR` network at desktop widths even when the full 24-node
		 * fleet cannot rest above the floor — sitting AT the floor and
		 * letting the reader pan, never collapsing a fleet-sized graph into
		 * a single 2000px-plus column at 1440/1920 just because the fit
		 * landed under a zoom number.
		 *
		 * `null` — the default, and what `AppPromotionFlow` gets since it
		 * never passes this — keeps `forceStack` byte-identical to before
		 * this prop existed: a pure zoom rescue, no width ceiling.
		 * `DependencyNetwork` passes `1024`, so `forceStack` can only engage
		 * below it; the plain width-only `stackBelow` flip (below) still
		 * stacks a genuinely narrow card regardless of zoom, and the band
		 * between the two (768-1024 here) keeps the zoom rescue exactly as
		 * it already behaved.
		 */
		forceStackCeiling?: number | null;
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
	/**
	 * ⭐ 2026-09-13 · THE `.graph-canvas` WRAPPER ITSELF, so its PARENT's width
	 * can be measured separately from `containerEl`'s — see `availableWidth`
	 * below for why the two must not be the same number once `snugFrameWidth`
	 * exists.
	 */
	let rootEl = $state<HTMLDivElement | null>(null);
	/**
	 * ⭐ THE WIDTH ON OFFER, UNCONTAMINATED BY OUR OWN `snugFrameWidth` CAP.
	 *
	 * `containerWidth` (above) is `containerEl.clientWidth` — the ACTUAL
	 * rendered pane, which `snugFrameWidth` can now narrow on purpose (see
	 * its own doc). Feeding that same number into the `LR`↔`TB` STACKING
	 * decision below would be circular: cap the width because there is
	 * nothing to stretch → the capped width drops under `stackBelow` → the
	 * canvas stacks into `TB` → `DependencyNetwork` turns `fillWidth` off
	 * for `TB` → the cap lifts → the width jumps back over `stackBelow` →
	 * `LR` returns → the cap re-applies → repeat, forever, on a desktop-width
	 * card that was never narrow. Measured live before this existed: a
	 * 1167px card computing a 442px snug width for a 2-node graph (under
	 * `stackBelow`'s default 620) would have oscillated on every
	 * `ResizeObserver` tick.
	 *
	 * `availableWidth` is measured off `rootEl.parentElement` — one level
	 * OUTSIDE `.graph-canvas`, which `snugFrameWidth` never touches — so it
	 * reports the CALLER's real offer whether or not this component has
	 * chosen to draw narrower than it. `0` until mount; every reader falls
	 * back to `containerWidth` while it is.
	 */
	let availableWidth = $state(0);
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
	 *
	 * ⛔ 2026-10-08 · D-20 — AND THE COMPARISON HAS TO READ A WIDTH
	 * `snugFrameWidth` NEVER TOUCHES, EITHER, OR THE SAME OSCILLATION COMES
	 * BACK BIGGER. The tolerance above was sized for a ~15px scrollbar; the
	 * full `/dependencies` page's `anchorRescueEligible` fix (above) made
	 * `forceStack` fire on a 24-node fleet for the first time at desktop
	 * widths, where the `TB` layout's own hooked-column narrowing
	 * (`snugFrameWidth`, this component's `max-width` on `rootEl`) measured
	 * a 466px snug width against a 1167px card — a 700px self-inflicted
	 * shrink of `containerEl` (what the `ResizeObserver` below actually
	 * watches), 29x the scrollbar tolerance. Comparing against
	 * `containerWidth` reset `forceStack` every tick, which un-stacked the
	 * graph, which widened `snugFrameWidth` back out, which re-fired the
	 * observer, which re-derived `forceStack` from the still-too-small
	 * `wholeGraphFitZoom` — the exact `LR`⇄`TB` loop this doc already
	 * describes, just triggered by the component's own CSS instead of a
	 * scrollbar. `availableWidth` (above) is measured one level outside
	 * `.graph-canvas`, which `snugFrameWidth` never narrows, so it is the
	 * one width in this file guaranteed not to move because WE decided to
	 * draw narrower — the reset now reads it instead.
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
	 * ⭐ 2026-09-13 · THE FRAME'S OWN WIDTH FOLLOWS CONTENT, THE SAME WAY
	 * `frameHeight` (`frameFor`, below) ALREADY DOES — FOR THE ONE SHAPE THE
	 * `fillWidth` STRETCH CANNOT REACH.
	 *
	 * `fillWidth`'s own long comment above answers "the drawing is narrower
	 * than its frame" by GROWING the drawing (widening `ranksep`/`nodesep`
	 * between ranks) — correct whenever there is more than one rank to widen
	 * a gap between. A graph with exactly ONE rank (a rollout's own
	 * neighbourhood filtered to one environment — two services joined by a
	 * single contract, no promotion edge to rank against) has no second rank
	 * to push apart: `gaps` (below) is `0`, the stretch branch never fires,
	 * and the drawing stays at its natural, single-node-column width
	 * whatever the frame is. Measured on the live fleet's
	 * `checkout-api-prod-us-east-2/checkout-api` Dependencies tab: a 221px
	 * node in a 1167px frame at 1440, later 1647px at 1920 — 81–87% of the
	 * canvas is ground, and doubling the viewport WIDENS the empty margin
	 * rather than the drawing, because nothing about the layout was ever a
	 * function of the frame in this branch.
	 *
	 * The fix is the same rule already governing the stretch, read the other
	 * way: **the gutters may never total more than the ranks they
	 * separate** — i.e. at least half of the frame, along the CONSTRAINED
	 * axis, is ink. When there is a gap to widen, `fillWidth` grows the ink
	 * to meet that ratio. When there is not (`gaps < 1`), the frame's own
	 * rendered width shrinks to meet it instead — `natural.width / 0.5`,
	 * floored so a single small node never renders in a canvas narrower than
	 * it can comfortably hold its own zoom controls, and ceilinged at the
	 * container's own width (a graph that already clears the ratio is a
	 * no-op, unchanged from before this existed).
	 *
	 * `null` — the default, and every `LR` graph with `gaps >= 1`, and every
	 * `TB` graph (the constrained axis there is height, not width — see
	 * `restingWidthZoom`'s identical `orientation === 'LR'` guard) — renders
	 * `.graph-canvas` at its parent's full width, byte-identical to before
	 * this existed. Read by the template as an optional `max-width` on the
	 * OUTER `.graph-canvas` wrapper, not on `containerEl` directly: the
	 * `ResizeObserver` already watches `containerEl`, which is a plain block
	 * child of the wrapper, so capping the wrapper's width is the one change
	 * that reaches every downstream measurement (`containerWidth`, the fit
	 * maths, the controls row) for free, with no second variable to keep in
	 * sync.
	 */
	let snugFrameWidth = $state<number | null>(null);
	/** Never narrower than this even for a single ~110px node — a canvas
	 *  under this holds its own 3-button zoom strip uncomfortably tight. */
	const SNUG_WIDTH_FLOOR = 280;
	/**
	 * ⭐ 2026-09-13 · THE `TB`+HOOK FLOOR IS LOWER, ON PURPOSE.
	 *
	 * `SNUG_WIDTH_FLOOR` was set for the `LR` single-rank case, where the
	 * card genuinely has nothing narrower than a full node to show. The
	 * `TB` hook case already computes a real `need` from the node, the
	 * (now label-measured) gutter and the fixed offsets `restingFit` uses
	 * — reusing the wider `LR` floor here just re-added back the dead
	 * margin the whole fix exists to remove (measured: `need` ≈ 213px for
	 * the `payments` label above, clamped up to 280 by the shared floor,
	 * i.e. 67px of the "fixed" canvas was still unaccounted-for gutter).
	 * `200` is the same "don't crowd the 3-button zoom strip" reasoning as
	 * `SNUG_WIDTH_FLOOR`, just not padded for a wider node this branch
	 * never draws (a hooked pair's own node width is already inside `need`).
	 */
	const TB_HOOK_WIDTH_FLOOR = 200;

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
	 * ⭐ 2026-10-08 · D-20 — THE RESCUE ONLY RESCUES A VIEW THAT IS MOSTLY THE
	 * PAIR ALREADY. Every comment above this line was written against
	 * `AppPromotionFlow`'s narrow neighbourhood card, where the anchor pair
	 * effectively WAS the whole graph (2-4 nodes). Nothing in the live
	 * product still calls `GraphCanvasInner` with `anchorSpan` from a small
	 * neighbourhood, though — today `anchorSpan` only ever arrives from
	 * `DependencyNetwork` on the full `/dependencies` page, where `anchor` is
	 * "just the first blocked node" over the WHOLE fleet (its own doc, line
	 * ~532). Measured live at 1440: 24 nodes, `wholeGraphFitZoom` 0.36-0.40
	 * (under `readableSpanFloor`), `anchorSpanFitZoom` for the chosen pair
	 * exactly 1 — so the rescue fired and centred the viewport on two ~200px
	 * boxes, with the other 22 nodes scattered above and below the 680px
	 * frame: the "canvas not fitted on load" `D-20` actually filed. The
	 * subset fit is a real subset of a real graph now, not a close-up of
	 * something that was already the whole picture.
	 *
	 * `forceStack` (`SINGLE_FILE_FLOOR`, right below) already has the
	 * correct answer for exactly this case — one node per row, the page
	 * scrolls, every node is on screen eventually — and is what narrow
	 * widths already use for the same fleet. This limit just lets WIDE
	 * widths fall through to it too, once the pair stops being a stand-in
	 * for "everything". 4 is chosen so a pair plus up to two more services
	 * (an upstream and a downstream, say) still reads as "this IS roughly
	 * the whole neighbourhood"; a fleet-sized graph (24 here) is nowhere
	 * near it.
	 */
	const ANCHOR_SPAN_NODE_LIMIT = 4;
	function anchorRescueEligible(): boolean {
		return !!anchorSpan && flowNodes.length <= ANCHOR_SPAN_NODE_LIMIT;
	}

	/** The width the stacking decisions read — the caller's real offer where
	 *  one has been measured, `containerWidth` otherwise. Shared by the
	 *  orientation effect and `restingFit`'s own `forceStack` gate so the two
	 *  never disagree about what "the width" is. */
	function effectiveWidth(): number {
		return availableWidth > 0 ? availableWidth : containerWidth;
	}

	/**
	 * ⭐ 2026-10-08 · D-20 — WHETHER THE ZOOM RESCUE IS EVEN ALLOWED TO STACK
	 * AT THIS WIDTH. See `forceStackCeiling`'s own doc on the prop. `null`
	 * (every caller but `DependencyNetwork`) means no ceiling — byte-identical
	 * to the zoom-only rescue this canvas always had.
	 */
	function canForceStack(): boolean {
		return forceStackCeiling === null || effectiveWidth() < forceStackCeiling;
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
		const boxWidth =
			Math.max(na.position.x + wa, nb.position.x + wb) - Math.min(na.position.x, nb.position.x);
		const boxHeight =
			Math.max(na.position.y + ha, nb.position.y + hb) - Math.min(na.position.y, nb.position.y);
		if (boxWidth <= 0 || boxHeight <= 0) return 0;
		const zw = (containerWidth - fitInset(containerWidth)) / boxWidth;
		const zh = (frameHeight - fitInset(frameHeight)) / boxHeight;
		return Math.min(1, zw, zh);
	}

	function restingFit() {
		/**
		 * ⭐ 2026-10-09 · D-20 round 3 — `forceStackCeiling`'S `LR` ALSO SKIPS
		 * `fitView` ENTIRELY, FOR THE SAME REASON `singleFile`+`TB` DOES, JUST
		 * BELOW.
		 *
		 * The coordinator's own re-review of D-20/D-20-round-2: sitting `LR` at
		 * the `minZoomWide` floor and panning was the fix for "never collapse
		 * into a single column at desktop widths", but it left the FRAME
		 * clipping — `maxHeight` (680) clamped a 24-node fleet's 1265px-tall
		 * drawing at 0.85 into a 680px box, so 12-15 nodes sat past the
		 * frame's own bottom edge, reachable only by finding the pan
		 * affordance first. `frameHeight`/`frameFor` (above) now grow the
		 * frame to the content's own height whenever this canvas is in that
		 * exact regime (`wideLR()`); once the frame is already that tall,
		 * there is nothing left for a fit to shrink FOR — every node already
		 * fits the frame at zoom 1, the same guarantee `singleFile`'s own
		 * branch below rests on, just along the axis `LR` actually uses it on.
		 * `maxZoom: 1` stays the product's own rule (`FIT_ALL`'s own doc: a
		 * fit may shrink, never magnify) — zoom 1 is already the ceiling, not
		 * a floor being raised.
		 *
		 * `x: 8` left-pins the drawing's own start, same constant and same
		 * reasoning as the D-20 round 2 pin below (which this branch replaces
		 * for its own regime) — the frame shows the graph's FIRST rank, and
		 * the reader pans or zooms-out right for the rest, never left into
		 * empty canvas. A graph narrower than its frame (a filtered view down
		 * to a couple of nodes) is still left-pinned rather than centred, for
		 * the identical reason: nothing about a dependency network has a
		 * "middle" worth resting on.
		 *
		 * ⭐ 2026-10-09 · D-20 round 4 — `zoom: packedZoom`, NOT A FLAT `1`.
		 * Shelf packing (`packComponents`) keeps `contentSize.width` at or
		 * under the container in the ordinary case, so `packedZoom` is 1 and
		 * this is unchanged from round 3. The one case packing cannot close
		 * — one component alone wider than the container — now shrinks
		 * toward (never past) the `0.75` readability floor instead of
		 * silently cropping at an unscaled zoom 1.
		 */
		if (wideLR()) {
			if (contentSize.width > 0 && containerWidth > 0) {
				setViewport({ x: 8, y: 8, zoom: packedZoom }, { duration: 0 });
			}
			return;
		}
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
				// ⛔ WHETHER AN EDGE ACTUALLY HOOKS, NOT WHETHER ONE COULD. This read
				// `e.type === 'contractHop'`, which is true for every contract edge
				// including the ones that now route straight down because nothing is
				// between their ends (see the gutter block's own note). Those have no
				// gutter running off the right of the content box, so there is nothing
				// to reserve room for and the column centres like any other.
				const hasHook = flowEdges.some(
					(e) => typeof (e.data as { gutterX?: number } | undefined)?.gutterX === 'number'
				);
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
		if (anchorRescueEligible() && wholeZoom > 0 && wholeZoom < readableSpanFloor()) {
			const [a, b] = anchorSpan as [string, string];
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
					canForceStack() &&
					spanZoom > 0 &&
					spanZoom < SINGLE_FILE_FLOOR
				) {
					forceStack = true;
					widthAtForceStack = availableWidth > 0 ? availableWidth : containerWidth;
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
		 * No pair to rescue the view with (or the pair is not a stand-in for
		 * the whole graph — `anchorRescueEligible`, D-20), and the floor
		 * would be clamping the zoom UP from something genuinely
		 * illegible-at-scale — stack instead of resting on a clip. See
		 * `SINGLE_FILE_FLOOR`'s own doc.
		 */
		if (
			!anchorRescueEligible() &&
			singleFile &&
			orientation === 'LR' &&
			!forceStack &&
			canForceStack() &&
			wholeZoom > 0 &&
			wholeZoom < SINGLE_FILE_FLOOR
		) {
			forceStack = true;
			widthAtForceStack = availableWidth > 0 ? availableWidth : containerWidth;
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
				/**
				 * ⭐ 2026-10-08 · D-20 round 2 — THE FLOOR CASE SHOWS THE GRAPH'S
				 * START, NOT A CENTRED CROP OF SOMEWHERE IN THE MIDDLE.
				 *
				 * The coordinator's own brief: "the frame must show the graph's
				 * start, not empty canvas" — and the same reasoning holds when
				 * what's past the frame is not empty canvas but a CROPPED node.
				 * Measured at 1024 (`forceStackCeiling` engaged, the whole fleet
				 * resting at the `minZoomWide` floor rather than its own fit):
				 * `fitView`'s own centring left a secondary chain's node
				 * (`platform-prod ledger-core`) a few px PAST THE LEFT EDGE —
				 * `platform-prod` rendered as `tform-prod`, a node cut open on
				 * load, not merely panned away from.
				 *
				 * `forceStackCeiling !== null` is this prop's own signal for
				 * "the caller opted into the floor-and-pan contract" (see its
				 * doc) — today only `DependencyNetwork`. There, when the
				 * content is wider than the frame at the resting zoom, the pan
				 * pins the LEFTMOST rank to the frame's own left padding (`8`,
				 * the same constant every other pin-to-start branch in this
				 * file uses) and lets the overflow run off the RIGHT, into the
				 * zoom/pan controls already on screen — never off the left,
				 * where nothing invites the reader to look. This replaces the
				 * `anchorSpan`-bounds nudge below for this caller: showing the
				 * graph's own start is a stronger promise than keeping one
				 * blocked pair in frame, and the two can disagree (the pair is
				 * rarely the first rank). `AppPromotionFlow` never sets
				 * `forceStackCeiling`, so it keeps the original `anchorSpan`
				 * nudge, byte-identical to before this existed.
				 */
				if (forceStackCeiling !== null) {
					if (contentSize.width * z > containerWidth + 4) {
						const x = 8;
						if (Math.abs(x - nextX) > 0.5) {
							nextX = x;
							move = true;
						}
					}
				} else {
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
		if (anchorRescueEligible() && wholeGraphFitZoom() < READABLE_FLOOR) {
			const [a, b] = anchorSpan as [string, string];
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
			// `availableWidth` — the real offer, not `snugFrameWidth`'s own
			// narrowing of it — see that variable's doc for the oscillation
			// this avoids. Falls back to `containerWidth` before the parent
			// has been measured (mount) or for any caller with no parent to
			// read (defensive only; every real caller renders inside one).
			const widthForStacking = effectiveWidth();
			orientation =
				widthForStacking > 0 && (widthForStacking < stackBelow || (forceStack && canForceStack()))
					? 'TB'
					: 'LR';
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
			containerWidth = newWidth;
			refit();
		});
		ro.observe(el);
		/**
		 * ⭐ `availableWidth`'s OWN OBSERVER — the CALLER's offer, one level
		 * outside `.graph-canvas`, so it moves only when the READER resizes
		 * something and never as a side effect of `snugFrameWidth` narrowing
		 * `containerEl` on purpose. See that variable's own doc.
		 *
		 * ⛔ 2026-10-08 · D-20 — AND THAT IS EXACTLY WHY THE `forceStack`
		 * RESET LIVES HERE NOW, NOT ON `ro` ABOVE. `ro` watches `containerEl`,
		 * which `snugFrameWidth` DOES narrow on purpose (the `TB` hooked
		 * column's own `max-width`), so a reset keyed off ITS width change
		 * was keyed off a width this component itself moves — see
		 * `forceStack`'s own doc for the 466px-vs-1167px loop that caused.
		 * This observer's width never moves for that reason, so it is the
		 * one `forceStack` can safely trust as "the reader resized
		 * something."
		 */
		const parentEl = rootEl?.parentElement ?? null;
		availableWidth = parentEl ? parentEl.clientWidth : el.clientWidth;
		const parentRo = parentEl
			? new ResizeObserver((entries) => {
					const newAvailable = entries[entries.length - 1]?.contentRect.width ?? availableWidth;
					/**
					 * A resize is a new width, so it earns a fresh `LR` trial —
					 * but see `forceStack`'s own doc for why a SMALL width delta
					 * while already stacked is not treated as one (a scrollbar
					 * toggling on `TB`'s own taller layout, not the reader
					 * resizing anything).
					 */
					if (
						!(
							forceStack &&
							Math.abs(newAvailable - widthAtForceStack) < FORCE_STACK_RESIZE_TOLERANCE
						)
					) {
						forceStack = false;
					}
					availableWidth = newAvailable;
					refit();
				})
			: null;
		parentRo?.observe(parentEl as Element);
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
			parentRo?.disconnect();
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
				return existing ? { ...bn, measured: existing.measured, position: existing.position } : bn;
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
	 * ⭐ 2026-10-09 · D-20 round 4 — ONE dagre PASS, PARAMETERISED, SHARED BY
	 * THE WHOLE-GRAPH BUILD AND THE PER-COMPONENT PACKER BELOW.
	 *
	 * Pulled out of the layout effect's own `build()` closure so a second
	 * caller (`packComponents`, further down) can run the identical pass over
	 * a NODE SUBSET without duplicating the dagre setup — same rankdir,
	 * margins and labelled-edge sizing either way. Pure: every input is a
	 * parameter, nothing is read off component state, so it is safe to call
	 * from inside the layout effect as many times as the component count
	 * requires.
	 */
	function layoutSubgraph(
		rankdir: 'LR' | 'TB',
		ns: number,
		rs: number,
		nodeIds: Iterable<string>,
		edges: { source: string; target: string; label?: unknown }[],
		dims: (id: string) => { width: number; height: number }
	) {
		const g = new dagre.graphlib.Graph();
		g.setDefaultEdgeLabel(() => ({}));
		g.setGraph({ rankdir, nodesep: ns, ranksep: rs, marginx: MARGIN, marginy: MARGIN });
		const idSet = new Set(nodeIds);
		for (const id of idSet) {
			const d = dims(id);
			g.setNode(id, { width: d.width, height: d.height });
		}
		for (const edge of edges) {
			// A self-loop would make dagre's ranking meaningless; xyflow draws it
			// on its own without help from the layout.
			if (edge.source === edge.target) continue;
			if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue;
			/** See `build()`'s identical note, kept verbatim: dagre reserves
			 *  rank space for a labelled edge, estimated from character count. */
			const label = typeof edge.label === 'string' ? edge.label : '';
			g.setEdge(
				edge.source,
				edge.target,
				label ? { width: label.length * 6 + 12, height: 18, labelpos: 'c' } : {}
			);
		}
		dagre.layout(g);
		return g;
	}

	/**
	 * ⭐ 2026-10-09 · D-20 round 4 — WEAKLY CONNECTED COMPONENTS, FOR
	 * `packComponents` BELOW.
	 *
	 * Union-find over every DRAWN edge (promotion and contract alike — a
	 * contract edge still means two nodes belong in the same cluster, even
	 * though it never advances a dagre rank), restricted to `ids` so an edge
	 * into a node this canvas was not handed (a filtered env) is ignored
	 * rather than growing a component across the filter. Components are
	 * returned ordered by the smallest original index among their own
	 * members, so the caller's own ordering (`orderedNodes`'s held-first
	 * seed) decides which component gets the first shelf slot — unchanged
	 * from what a single dagre pass already did with `layoutOrder`.
	 */
	function weakComponents(
		ids: string[],
		edges: { source: string; target: string }[]
	): string[][] {
		const idSet = new Set(ids);
		const parent = new Map(ids.map((id) => [id, id]));
		const find = (x: string): string => {
			let r = x;
			while (parent.get(r) !== r) r = parent.get(r) as string;
			let c = x;
			while (parent.get(c) !== r) {
				const next = parent.get(c) as string;
				parent.set(c, r);
				c = next;
			}
			return r;
		};
		for (const e of edges) {
			if (!idSet.has(e.source) || !idSet.has(e.target)) continue;
			const ra = find(e.source);
			const rb = find(e.target);
			if (ra !== rb) parent.set(ra, rb);
		}
		const order = new Map(ids.map((id, i) => [id, i] as const));
		const groups = new Map<string, string[]>();
		for (const id of ids) {
			const r = find(id);
			const arr = groups.get(r);
			if (arr) arr.push(id);
			else groups.set(r, [id]);
		}
		return [...groups.values()].sort(
			(a, b) =>
				Math.min(...a.map((id) => order.get(id) ?? 0)) - Math.min(...b.map((id) => order.get(id) ?? 0))
		);
	}

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

	/**
	 * ⭐ 2026-10-09 · D-20 round 3 — THE `forceStackCeiling` CALLER'S `LR` FRAME
	 * NEVER CLAMPS, EITHER — THE SAME "PAGE SCROLLS, NOTHING CLIPS" CONTRACT
	 * `singleFile`+`TB` ALREADY HAS, JUST FOR THE WIDE ORIENTATION.
	 *
	 * `maxHeight` (680 on `/dependencies`) was sized for a graph that RESTS at
	 * `minZoomWide` — the fixed clamp assumed the zoom floor would always do
	 * the shrinking. Once `forceStackCeiling` exists at all (D-20, above) the
	 * premise is "stay `LR`, sit at the floor and pan" — but the coordinator's
	 * own re-review caught what that still does to the FRAME: a 24-node fleet
	 * at 0.85 is 847×1265 of content in a 680px-tall box, so 12-15 nodes were
	 * clipped inside a frame nobody could see past without first finding the
	 * (small, easy-to-miss) pan affordance. The house rule is that the
	 * DOCUMENT scrolls, never an inner pane — exactly the rule `singleFile`'s
	 * own `TB` branch already lives by (`frameFor`'s `maxHeight` stops
	 * clamping there too, see `DependencyNetwork`'s `stacked ? 100000 : …`).
	 *
	 * `forceStackCeiling !== null && orientation === 'LR'` is this file's own
	 * signal for "the caller opted into floor-and-pan instead of stacking"
	 * (today only `DependencyNetwork`, above `FORCE_STACK_CEILING`) — so this
	 * never touches `AppPromotionFlow`, which never sets the prop, or the
	 * `compact` rollout-tab caller, which never crosses the ceiling in the
	 * first place (its own `maxHeight: 400` is still the right clamp for a
	 * neighbourhood that is meant to fit a rail card). Letting the frame grow
	 * to the content's own height removes the reason to shrink the zoom below
	 * 1 too — see `restingFit`'s matching branch — so this reads `+ 16` with
	 * NO `restingWidthZoom` multiplier, unlike the ordinary branch below.
	 */
	function wideLR(): boolean {
		return forceStackCeiling !== null && orientation === 'LR';
	}

	/** The frame this content height would get. Mirrors `frameHeight`, which
	 *  cannot be read here — it derives from the `contentSize` this effect
	 *  writes.
	 *
	 *  ⛔ 2026-10-09 · D-20 round 4 — its own `wideLR()` branch is now DEAD
	 *  CODE in practice: the only caller (`fillWidth`'s stretch block) is
	 *  itself skipped whenever `packed` is set (`!packed` guard, in the
	 *  layout effect), so this never runs in the packed regime it still
	 *  names. Left in, at the simpler zoom-1 form, rather than deleted —
	 *  `fillWidth` and `forceStackCeiling` are independent opt-ins and a
	 *  future caller could combine them without the packed guard. */
	function frameFor(contentHeight: number): number {
		if (height !== null) return height;
		if (contentHeight === 0) return minHeight;
		if (wideLR()) return Math.max(minHeight, Math.round(contentHeight + 16));
		return Math.round(Math.min(maxHeight, Math.max(minHeight, contentHeight + 16)));
	}

	/** Re-layout whenever the measurements, the orientation or the width move. */
	$effect(() => {
		if (flowNodes.length === 0) {
			contentSize = { width: 0, height: 0 };
			snugFrameWidth = null;
			return;
		}
		const dir = orientation;
		const baseNodesep = nodesep ?? (dir === 'TB' ? 30 : 22);
		const baseRanksep = ranksep ?? (dir === 'TB' ? 50 : 96);
		// Read so a resize re-lays-out rather than only re-fitting.
		const frameWidth = containerWidth;
		// Set inside the `fillWidth` block below, `LR` only — see
		// `snugFrameWidth`'s own doc for why `TB` and `gaps >= 1` leave it
		// `null`.
		let nextSnugWidth: number | null = null;

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

		const dimsOf = new Map(
			flowNodes.map(
				(n) =>
					[
						n.id,
						{
							width: n.measured?.width ?? fallbackNodeWidth,
							height: n.measured?.height ?? fallbackNodeHeight
						}
					] as const
			)
		);
		const build = (ns: number, rs: number) =>
			layoutSubgraph(
				dir,
				ns,
				rs,
				flowNodes.map((n) => n.id),
				rankSource,
				(id) => dimsOf.get(id) ?? { width: fallbackNodeWidth, height: fallbackNodeHeight }
			);

		let g = build(baseNodesep, baseRanksep);

		/**
		 * ⭐ 2026-10-09 · D-20 round 4 — `wideLR()` LAYS OUT EACH WEAKLY
		 * CONNECTED COMPONENT ON ITS OWN AND SHELF-PACKS THEM, INSTEAD OF ONE
		 * SHARED dagre PASS OVER THE WHOLE FLEET.
		 *
		 * The tech lead's own re-review of round 3: the env-tier spine
		 * (`DependencyNetwork`'s `envSpineEdges`, now DELETED) glued every
		 * disconnected chain into ONE dagre graph to force environment
		 * columns, and that had two costs the coordinator's own measurement
		 * caught. First, width: dagre's rank-only axis has no notion of
		 * "already used the row for something else", so unrelated chains
		 * sharing a rank space routinely drew wider than any container could
		 * hold at scale 1 (1990px natural width, panned at every desktop
		 * width). Second, and worse, CORRECTNESS: gluing chains into one
		 * rank/row structure let dagre's own ordering heuristic route an edge
		 * from one chain through a NODE belonging to an entirely unrelated
		 * one, and pushed the genuinely first (held) component's own row
		 * away from the frame's top — a ~270px dead band above the first
		 * node at 1920, measured.
		 *
		 * A weakly connected component (union-find over EVERY drawn edge —
		 * `flowEdges`, promotion and contract both, so two nodes joined only
		 * by a contract edge still count as one cluster even though contract
		 * edges never rank) has no such cross-talk: nothing outside it can
		 * ever route through one of its boxes, because nothing outside it
		 * shares a coordinate space with it until THIS code places it.
		 * Classic shelf packing — left to right until the next component
		 * would run past the container, then wrap to a new row below — uses
		 * the width a single rank-only dagre pass could not, without ever
		 * needing scale under 1 unless one SINGLE component alone is wider
		 * than the whole container (rare; `packedZoom`, beside `restingFit`,
		 * floors that case at 0.75 and falls back to pan beyond it).
		 *
		 * Rank order INSIDE a component still comes only from that
		 * component's own `rankSource` edges (promotion-only, same rule as
		 * the whole-graph pass) — packing changes which NODES share a dagre
		 * graph, never what ranks them once they do.
		 *
		 * `g` (the whole-graph pass above) is left computed but UNUSED on
		 * this path — recomputing it per component is cheap at this node
		 * count (24), and keeping one shared `build()` for both the ordinary
		 * and packed paths is simpler than threading a second code path
		 * through dagre's own setup.
		 */
		let packed: {
			node: (id: string) => { x: number; y: number; width: number; height: number } | undefined;
			graph: () => { width: number; height: number };
		} | null = null;
		if (wideLR()) {
			const ids = flowNodes.map((n) => n.id);
			/**
			 * ⭐ 2026-10-09 · D-20 round 4, SECOND CUT — GROUPED BY `rankSource`
			 * (PROMOTION EDGES), NOT EVERY DRAWN EDGE.
			 *
			 * The first cut grouped by `flowEdges` (promotion AND contract), on
			 * the reasoning that a contract edge still means two nodes belong
			 * in one visual cluster. Measured live, that undid exactly what
			 * this round exists to fix: a contract edge chains `ledger-core`
			 * through `payments-svc` to EVERY `checkout-api` region it serves,
			 * so grouping by all edges merged an entire multi-region fan-out
			 * and two otherwise-unrelated single-node services into ONE
			 * component — and inside that component, `ledger-core` and
			 * `payments-svc` (no promotion edge of their own) rank 0, the
			 * SAME rank `checkout-api`'s own chain starts its fan-out from,
			 * reproducing the exact "unrelated nodes sharing rank space"
			 * defect this round exists to remove, just one level down.
			 *
			 * Grouping by `rankSource` (promotion only, the SAME edges that
			 * rank nodes inside a component) means a component is never
			 * bigger than the nodes dagre will actually rank together. A
			 * contract-only pair (no promotion edge between them) becomes two
			 * single-node components, packed into whatever shelf slots they
			 * land in — the contract edge between them is drawn across that
			 * gap by the library same as any other edge, but neither node's
			 * COMPONENT was ever asked to share rank space with a fan-out it
			 * has nothing to do with.
			 */
			const promComponents = weakComponents(ids, rankSource);
			/**
			 * ⭐ 2026-10-09 · D-20 round 4, THIRD CUT — SHELF ORDER FOLLOWS
			 * CONTRACT ADJACENCY TOO, EVEN THOUGH RANKING NO LONGER DOES.
			 *
			 * Grouping by `rankSource` (promotion only, above) fixed the
			 * "unrelated nodes sharing a rank" defect, but it left every
			 * contract-only pair — `ledger-core`↔`payments-svc`,
			 * `payments-svc`↔ every `checkout-api` region — as components with
			 * no say in WHERE they land relative to each other. Shelf-packed
			 * in plain first-appearance order, a contract edge between two
			 * such components routinely had a THIRD, unrelated component's
			 * shelf slot sitting between them, and the library's straight/
			 * orthogonal routing drew straight through it. Measured live:
			 * 7-10 edge/node crossings at 1024-1920, all `contract:` edges.
			 *
			 * The fix never touches ranking — it only touches shelf ORDER.
			 * `weakComponents` over `flowEdges` (promotion AND contract, the
			 * full picture) gives the same "real cluster" grouping the first
			 * cut tried to rank by; read here purely to ask *which
			 * promotion-only components are part of the same real cluster*,
			 * and a STABLE sort pulls every promotion-component sharing a
			 * cluster next to each other in the shelf sequence — still
			 * packed as separate components (separate dagre passes, separate
			 * footprints), just no longer scattered to opposite ends of the
			 * canvas by accident of insertion order. Adjacent in the shelf
			 * sequence means adjacent on screen (same row, or a clean row
			 * seam) far more often than not, which is what lets a contract
			 * edge between them cross only the GAP, not a stranger's box.
			 */
			const superGroups = weakComponents(
				ids,
				flowEdges.map((e) => ({ source: e.source, target: e.target }))
			);
			const superIndexOf = new Map<string, number>();
			superGroups.forEach((grp, i) => grp.forEach((id) => superIndexOf.set(id, i)));
			const components = [...promComponents].sort(
				(a, b) => (superIndexOf.get(a[0]) ?? 0) - (superIndexOf.get(b[0]) ?? 0)
			);
			const positions = new Map<string, { x: number; y: number }>();
			/** Clearly bigger than the intra-component gutters (`ranksep`/
			 *  `nodesep`) so a reader never mistakes a shelf seam for a rank. */
			const COMPONENT_GAP_X = 96;
			/**
			 * ⭐ D-20b — 88, NOT 48. Measured live: with several trunks'
			 * labelled lines sharing one row's gutter band (the fleet's
			 * `payments`/`identity`/`search` neighbourhood), the greedy
			 * label placement reported MOST of its labels `degraded` — no
			 * candidate within its own trunk's bounded stagger ever cleared
			 * every other trunk's line, because the band itself (half of
			 * this constant on each side of the seam) was not big enough to
			 * hold them. The task's own rule is to grow the frame rather
			 * than keep shrinking the content to fit it; widening the one
			 * constant that sizes every row's own label gutter is that rule
			 * applied at its source, instead of fighting the shortage with
			 * an ever-larger candidate fan. `packedH` (below) already sums
			 * this per row, so the frame simply grows to match — no second
			 * constant to keep in sync.
			 */
			const COMPONENT_GAP_Y = 88;
			/**
			 * ⭐ 2026-10-09 · D-20 round 5 — A RESERVED MARGIN ABOVE THE FIRST
			 * SHELF ROW AND BELOW THE LAST ONE, SO EVERY ROW HAS A GUTTER ON
			 * BOTH SIDES. See the gutter router, below `packed`'s own
			 * assignment, for what reads it (`rowGutterAbove`/`rowGutterBelow`).
			 * Half of `COMPONENT_GAP_Y` — the same clearance an INTERIOR row
			 * seam already gets on each side of it.
			 */
			const OUTER_GUTTER_Y = COMPONENT_GAP_Y / 2;
			let shelfX = 0;
			let shelfY = OUTER_GUTTER_Y;
			let shelfH = 0;
			let packedW = 0;
			const usableW = frameWidth > 0 ? frameWidth : Number.POSITIVE_INFINITY;
			/** One entry per PLACED component — the gutter router's own map of
			 *  the canvas, read below `packed` to build the row/spine corridors
			 *  a cross-component edge travels. */
			const placedComponents: { ids: string[]; x: number; y: number; w: number; h: number }[] = [];
			for (const comp of components) {
				const idSet = new Set(comp);
				const compEdges = rankSource.filter((e) => idSet.has(e.source) && idSet.has(e.target));
				const cg = layoutSubgraph(dir, baseNodesep, baseRanksep, comp, compEdges, (id) =>
					dimsOf.get(id) ?? { width: fallbackNodeWidth, height: fallbackNodeHeight }
				);
				const cw = cg.graph().width ?? 0;
				const ch = cg.graph().height ?? 0;
				if (shelfX > 0 && shelfX + COMPONENT_GAP_X + cw > usableW) {
					shelfY += shelfH + COMPONENT_GAP_Y;
					shelfX = 0;
					shelfH = 0;
				}
				for (const id of comp) {
					const n = cg.node(id);
					if (n) positions.set(id, { x: (n.x ?? 0) + shelfX, y: (n.y ?? 0) + shelfY });
				}
					placedComponents.push({ ids: comp, x: shelfX, y: shelfY, w: cw, h: ch });
				shelfX += cw + COMPONENT_GAP_X;
				shelfH = Math.max(shelfH, ch);
				packedW = Math.max(packedW, shelfX - COMPONENT_GAP_X);
			}
			const packedH = shelfY + shelfH + OUTER_GUTTER_Y;

			/** Which PACKED COMPONENT (index into `components`) a node belongs
			 *  to — the gutter router's own "same cluster or not" test, below. */
			const compIndexOf = new Map<string, number>();
			components.forEach((comp, i) => comp.forEach((id) => compIndexOf.set(id, i)));
			/** A node's OWN component's placed bounding box — the row it lives
			 *  in, for the router's row-gutter lookup. */
			const compBoundsByNodeId = new Map<string, { x: number; y: number; w: number; h: number }>();
			for (const c of placedComponents) {
				for (const id of c.ids) compBoundsByNodeId.set(id, c);
			}

			/**
			 * ⭐ 2026-10-09 · D-20 round 4 — THE SAME HOOK `ContractHopEdge` ALREADY
			 * DRAWS FOR A `singleFile` `TB` COLUMN, GENERALISED TO ANY `LR` RANK
			 * THAT STACKS MORE THAN ONE NODE.
			 *
			 * A packed component with more than one node at the SAME rank —
			 * `checkout-api`'s five PROD regions, none promoting into another —
			 * stacks them in one column exactly like a `TB` run does, just as
			 * one column among several instead of the only one. `lrColumnBaseX`
			 * answers *is this node in a stacked column, and if so where is the
			 * clear vertical channel that clears every row in it* — read by
			 * BOTH the same-component hook just below (round 4's own fix, for
			 * an edge that never leaves its own component) and the
			 * cross-component gutter ROUTER further down (round 5's own fix,
			 * for one that does): entering a stacked column from the side,
			 * never from straight above or below crossing a sibling row, is
			 * the identical problem at both scales.
			 */
			const COLUMN_EPS = 2;
			const LR_GUTTER_BASE = 40;
			const LANE_GAP = 14;
			const lrColumns = new Map<number, string[]>();
			for (const id of ids) {
				const p = positions.get(id);
				if (!p) continue;
				const key = Math.round(p.x / COLUMN_EPS);
				const arr = lrColumns.get(key);
				if (arr) arr.push(id);
				else lrColumns.set(key, [id]);
			}
			const lrColumnBaseX = new Map<string, number>();
			for (const members of lrColumns.values()) {
				if (members.length < 2) continue;
				const rightEdge = Math.max(
					...members.map((id) => {
						const p = positions.get(id);
						const d = dimsOf.get(id);
						return (p?.x ?? 0) + (d?.width ?? 0) / 2;
					})
				);
				for (const id of members) lrColumnBaseX.set(id, rightEdge + LR_GUTTER_BASE);
			}

			/**
			 * ⭐ 2026-10-09 · D-20 round 5 — THE CROSS-COMPONENT GUTTER ROUTER.
			 *
			 * The tech lead's own correction to round 4: a per-column hook
			 * only guarantees clearance right next to the end it was computed
			 * from, so a contract edge whose SOURCE sits in a different,
			 * distant component could still cross a stranger's box on its own
			 * approach — measured, 3-4 residual crossings. Their direction,
			 * followed here: shelf packing already LEAVES KNOWN EMPTY CHANNELS
			 * — the `COMPONENT_GAP_Y` band between shelf rows, and the matching
			 * `OUTER_GUTTER_Y` margin above the first row and below the last —
			 * and every one of them spans the FULL PACKED WIDTH, clear of every
			 * node by construction (nothing is ever placed in a gap). Route a
			 * CROSS-component edge through them instead of trusting the
			 * library's own straight-line guess:
			 *
			 *   1. a short LOCAL hop from the node straight to its own row's
			 *      gutter (below the source's row, above the target's) — safe
			 *      because going straight up/down from a node only risks a
			 *      SAME-COLUMN sibling, exactly the case `lrColumnBaseX` (just
			 *      above) already has an answer for, reused here;
			 *   2. ACROSS that row's own gutter, the full packed width's worth
			 *      of guaranteed-clear horizontal travel, out to a vertical
			 *      SPINE parked past the packed drawing's own right edge —
			 *      also never occupied, because nothing is ever placed there;
			 *   3. UP OR DOWN the spine to the target's row gutter, and back
			 *      ACROSS it into the target the same way the source left.
			 *
			 * Every edge SHARING A PROVIDER INTO THE SAME STACKED COLUMN — the
			 * tech lead's own example, four `payments` lines into four
			 * `checkout-api` PROD regions — is grouped into one TRUNK first
			 * (`trunkKeyOf`): same `source`, same target COLUMN. All members of
			 * a trunk get the IDENTICAL lane (so segments 1-4 above render as
			 * ONE line, not four stacked copies of it) and only the FINAL hop
			 * into each one's own specific row differs — "one trunk, short
			 * branches at the end," literally the same path geometry drawn
			 * once per member but pixel-identical until the branch point.
			 * Exactly one edge per trunk keeps its label (the first with
			 * non-empty text — `labelledEdgeKeys`, one layer up in
			 * `DependencyNetwork`, already suppresses most duplicates before
			 * this ever runs), placed at the midpoint of whichever SHARED
			 * segment (2, 3 or 4 above) is longest.
			 *
			 * ⛔ SAME-COMPONENT edges are explicitly EXCLUDED — `compIndexOf`
			 * is the test. A same-component pair is already close (dagre laid
			 * them out together) and already has the plain clear-channel
			 * placement (the label-placement block, further down) or the
			 * same-column hook (just above) if it needs one; routing it
			 * through the gutter system too would be a longer, uglier path
			 * for no clearance it did not already have.
			 */
			const SPINE_PAD = 24;
			/** 4-6px apart, the tech lead's own number for a lane inside a
			 *  gutter — distinct trunks sharing a gutter read as parallel
			 *  lines, not one smear. */
			const TRUNK_LANE_GAP = 6;
			type GutterPt = { x: number; y: number };
			/**
			 * ⭐ 2026-10-09 · D-20 round 6 — GROUPED BY `source` + `contract`,
			 * NOT `source` + TARGET COLUMN.
			 *
			 * Measured live on r5: three visibly separate near-parallel lines
			 * beside the spine — the SAME provider (one `payments-svc`) with
			 * `needs-payments` edges into `checkout-api-dev`, into
			 * `checkout-api-staging`, AND into the whole PROD column, each a
			 * DIFFERENT target (or target column), so round 5's own grouping
			 * — same source, same target column — correctly bundled the four
			 * PROD-region branches into one trunk but gave the dev and
			 * staging edges their OWN lanes, reading as a tangle of
			 * near-duplicate lines for what is actually ONE relationship fanning
			 * out. `data.contract` (new, `DependencyNetwork`'s own `edgeOf`) is
			 * the bare relationship name, independent of which environment or
			 * component the far end lands in — grouping by it bundles every
			 * edge a provider has under ONE contract into a single trunk,
			 * however many different places its branches end up reaching.
			 */
			const trunkKeyOf = (e: Edge): string => {
				const contract = (e.data as { contract?: string } | undefined)?.contract ?? e.target;
				return `${e.source}=>${contract}`;
			};
			const crossEdges = flowEdges.filter((e) => {
				if (e.type !== 'contractHop') return false;
				const sc = compIndexOf.get(e.source);
				const tc = compIndexOf.get(e.target);
				return sc !== undefined && tc !== undefined && sc !== tc;
			});
			const trunks = new Map<string, Edge[]>();
			for (const e of crossEdges) {
				const key = trunkKeyOf(e);
				const arr = trunks.get(key);
				if (arr) arr.push(e);
				else trunks.set(key, [e]);
			}
			/** `edge.id` → the route this edge draws (shared prefix + its own
			 *  branch) and, for at most one edge per trunk, where its label
			 *  goes. Applied to `flowEdges` once, after every trunk is solved,
			 *  same pattern as every other edge-data pass in this effect. */
			const routeById = new Map<
				string,
				{ route: GutterPt[]; label?: { x: number; y: number; w: number; h: number } }
			>();
			/**
			 * ⭐ D-20b ROUND 2 — NO LONGER READ. `placedTrunkLines` used to
			 * be the static obstacle set a label placement pass checked
			 * every candidate against; that pass is gone (no route ever
			 * carries a label — see the ledger item). Left in place and
			 * still collected below: every trunk's own shared-prefix and
			 * spine-run segment is cheap to record and a future caller
			 * (a hover highlight, a debug overlay) may still want "every
			 * line this canvas has drawn" without re-deriving it from
			 * scratch.
			 */
			const placedTrunkLines: { l: number; r: number; t: number; b: number }[] = [];
			const LINE_PAD = 4;
			/** ⭐ D-20 round 6 — the minimum clearance every routed segment
			 *  keeps from a node box it is not entering, matching the tech
			 *  lead's own number. `LR_GUTTER_BASE`/`SPINE_PAD` already clear
			 *  this; named once so both read the same floor instead of two
			 *  independently-chosen constants that could drift apart. */
			const MIN_NODE_CLEARANCE = 12;
			/**
			 * The same `x: 8` / `y: 8` pin `restingFit`'s `wideLR()` branch
			 * rests the viewport at, PLUS a few px of slack — shared by every
			 * label clamp in this effect (trunk labels here, the plain
			 * clear-channel block's own copy further down). The slack exists
			 * because `lw` (every label-width estimate in this file,
			 * `text.length * 6 + 12`) is exactly that: an estimate, used
			 * BEFORE the real DOM has rendered the text to measure it.
			 * Measured live: an 8-character label estimated at 60px rendered
			 * at 66px (real font metrics plus the `.svelte-flow__edge-label`
			 * CSS padding), enough on its own to clip a label clamped against
			 * the estimate. The clamp's job is "never past the frame edge,"
			 * so it is the one place in this file an estimate being a little
			 * SHORT of reality is unsafe — everywhere else (collision
			 * avoidance between two labels) a few px of slop just means a
			 * slightly bigger gap, never a visible defect.
			 */
			const FRAME_PAD = 8 + 8;
			let laneIndex = 0;
			let maxSpineX = packedW;
			/**
			 * ⭐ D-20b ROUND 2 (coordinator decision, 2026-10-09) — EVERY
			 * TRUNK-LABEL PLACEMENT MECHANISM (THE CANDIDATE FAN, THE
			 * PER-ROW STAGGER COUNTER, `pendingLabelRequests`/
			 * `placeLabelsGreedy`) IS DELETED. No route a trunk draws ever
			 * carries label text any more — `DependencyNetwork`'s `edgeOf`
			 * always sets `label: undefined`, and a BLOCKED edge's
			 * constraint now reads at its CONSUMER node instead
			 * (`DependencyNode`'s own `heldConstraints` line, fed by
			 * `data.blocked`/`contract`/`requiredVersion`, the same facts
			 * this trunk router already threads through for the stroke
			 * colour). This was the fix for 9-22 measured label collisions
			 * at desktop widths that no amount of smarter placement closed:
			 * a label with nowhere to go is not a placement problem, it is
			 * too many labels for the space. Removing the thing being
			 * placed makes the collision impossible by construction, not
			 * merely less likely. See the ledger item (D-20b) for the full
			 * before/after.
			 */
			for (const members of trunks.values()) {
				const first = members[0];
				const sBounds = compBoundsByNodeId.get(first.source);
				const sp = positions.get(first.source);
				const sd = dimsOf.get(first.source);
				if (!sBounds || !sp || !sd) continue;
				const lane = laneIndex++;
				const spineX = packedW + SPINE_PAD + lane * TRUNK_LANE_GAP;
				maxSpineX = Math.max(maxSpineX, spineX);
				/**
				 * ⭐ D-20b — WIDENED STEP (7, NOT 3), SAME GLOBAL LANE INDEX.
				 * `COMPONENT_GAP_Y` (above) grew from 48 to 88 specifically
				 * to give labelled trunks room; the step grew alongside it
				 * so 6 trunks sharing one row span 0-35px of the new ~88px
				 * band (safely under `OUTER_GUTTER_Y`, 44), instead of 6 at
				 * `3` spanning only 0-15px of the old 48px one. (A per-row
				 * counter was tried here and measured WORSE — it keyed two
				 * unrelated, side-by-side components sharing a `y` onto the
				 * same stagger sequence, moving labels that already had
				 * plenty of room and regressing three of five widths. The
				 * simpler global index, wrapped every 6 lanes, is what is
				 * actually measured best; see the ledger for the residual
				 * this leaves at high trunk density.)
				 */
				const stagger = (lane % 6) * 7;
				const sHandleX = sp.x;
				const gYs = sBounds.y + sBounds.h + COMPONENT_GAP_Y / 2 + stagger;
				/**
				 * ⭐ 2026-10-09 · D-20 round 6 — ONLY SEGMENTS 1-2 ARE SHARED NOW.
				 * Grouping by `(source, contract)` instead of `(source, target
				 * column)` means a trunk's branches can land in DIFFERENT ROWS,
				 * not just different members of one column — `gYt` (the TARGET's
				 * own row gutter) can no longer be one shared value computed
				 * from the first member. Every member below computes its OWN
				 * `gYt` from its OWN target's component bounds; segments 1-2
				 * (local exit from the shared source, then across to the spine)
				 * are the only ones guaranteed identical across members, and
				 * still read as one trunk near the source for exactly that
				 * reason — the point the tech lead's own bundling note is
				 * after, generalised past "one column" to "one relationship".
				 */
				const prefix: GutterPt[] = [
					{ x: sHandleX, y: gYs },
					{ x: spineX, y: gYs }
				];
				/**
				 * ⭐ D-20b ROUND 2 (coordinator decision) — DELETED. This
				 * trunk used to decide which member (if any) carried the
				 * blocked constraint's text, and where on its own route that
				 * text would sit. No route ever carries text any more — see
				 * the ledger item (D-20b) for where that fact reads now (the
				 * consumer node's own `heldConstraints` line, fed straight
				 * off `data.blocked`, the same flag the stroke colour below
				 * already keys on).
				 */
				for (const e of members) {
					const tBounds = compBoundsByNodeId.get(e.target);
					const tp = positions.get(e.target);
					const td = dimsOf.get(e.target);
					if (!tBounds || !tp || !td) continue;
					const gYt = tBounds.y - COMPONENT_GAP_Y / 2 - stagger;
					const colBase = lrColumnBaseX.get(e.target);
					let branch: GutterPt[];
					/**
					 * ⭐ 2026-10-09 · D-20 round 6 — THE BRANCH ENDS EXACTLY ON THE
					 * NODE'S OWN BORDER, NEVER ITS CENTRE.
					 *
					 * Measured live on r5: stray arrowheads sitting on node TOPS
					 * while the visible line entered from the side. Root cause —
					 * `ContractHopEdge` always appended the library's OWN
					 * `targetX`/`targetY` (the `Top`-handle coordinate every
					 * contract-in handle uses under `LR`, see `DependencyNode`)
					 * AFTER this file's own last waypoint, which used to be the
					 * node's CENTRE (`tp.y`) — so the real path grew one more,
					 * invisible-until-you-look segment from that centre up to the
					 * Top handle, and the arrow (oriented by the FINAL segment's
					 * own tangent) pointed along THAT short vertical hop, not
					 * along the long visible approach.
					 *
					 * The fix is symmetric with round 4's same-component hook,
					 * which already had this right: end the route AT the real
					 * border point and nowhere past it.
					 *   · a STACKED column entry keeps approaching from its own
					 *     clear side-channel (`colX`), but now stops exactly at
					 *     the node's RIGHT-edge, mid-height (`tp.x + td.width/2,
					 *     tp.y`) — a horizontal final segment, arrow pointing
					 *     LEFT, into the side the line actually travels on.
					 *   · a SINGLE-member target keeps the top approach, but
					 *     stops exactly at `tp.y - td.height/2` (the real `Top`
					 *     handle Y) instead of the row gutter's own `gYt` or the
					 *     node's centre — a vertical final segment, arrow
					 *     pointing DOWN, into the top it actually travels on.
					 * `ContractHopEdge`'s own fix (not appending the library's
					 * raw target again when a `route` is present) makes this the
					 * SOLE authority on where the path — and so the arrow —
					 * actually ends.
					 */
					if (typeof colBase === 'number') {
						// Stacked target column: `colBase` already clears the
						// WIDEST member by `LR_GUTTER_BASE` (40, past
						// `MIN_NODE_CLEARANCE`); `lane * 2` stays well inside
						// that margin for any lane count this canvas sees.
						const colX = colBase + lane * 2;
						const rightEdge = tp.x + td.width / 2;
						branch = [
							{ x: colX, y: gYt },
							{ x: colX, y: tp.y },
							{ x: rightEdge, y: tp.y }
						];
					} else {
						const topEdge = tp.y - td.height / 2;
						branch = [{ x: tp.x, y: gYt }, { x: tp.x, y: topEdge }];
					}
					const route = [...prefix, { x: spineX, y: gYt }, ...branch];
					// ⭐ D-20b ROUND 2 (coordinator decision) — no label is ever
					// placed on this route any more; `label` stays `undefined`
					// unconditionally. See the ledger item for where the
					// constraint this used to carry reads now (the consumer
					// node's own `heldConstraints` line).
					routeById.set(e.id, { route, label: undefined });
					// This member's own spine run (segment 3, now per-member
					// since `gYt` is) becomes an obstacle for every trunk
					// processed AFTER this one.
					placedTrunkLines.push({
						l: spineX - LINE_PAD,
						r: spineX + LINE_PAD,
						t: Math.min(gYs, gYt) - LINE_PAD,
						b: Math.max(gYs, gYt) + LINE_PAD
					});
				}
				// The trunk's own SHARED segment (the local exit + the run
				// across to the spine) becomes an obstacle for every trunk
				// processed AFTER it.
				placedTrunkLines.push({
					l: Math.min(sHandleX, spineX) - LINE_PAD,
					r: Math.max(sHandleX, spineX) + LINE_PAD,
					t: gYs - LINE_PAD,
					b: gYs + LINE_PAD
				});
			}
			/**
			 * ⭐ D-20b ROUND 2 (coordinator decision) — DELETED. Every
			 * `routeById` entry's `label` is `undefined` unconditionally
			 * (set at the push site, above), so there is nothing left for a
			 * placement pass to resolve.
			 */
			/**
			 * ⭐ 2026-10-09 · D-20 round 7 — COMPUTED BEFORE `routeById` IS
			 * APPLIED, SO THE LABEL CLAMP BELOW CAN READ THE FRAME'S REAL
			 * RIGHT EDGE.
			 *
			 * Moved up from just after the `routeById` apply-block (where it
			 * used to sit, computed too late for that block's own writes to
			 * read it).
			 *
			 * ⛔ AND WIDENED TO COVER A LABEL THE PUSH-AWAY LOOP MOVED PAST
			 * THE SPINE. Measured live: clamping to the plain
			 * `maxSpineX + …` figure made the fix WORSE than the defect it
			 * targeted — a label that the per-trunk obstacle sweep had
			 * legitimately pushed right of `spineX` (to clear a crowd of
			 * earlier labels/lines in a busy gutter) got yanked back down to
			 * that same ceiling, landing two DIFFERENT, previously-separated
			 * labels (`ledger ^6.0.0`, `payments ^3.0.0`) on top of EACH
			 * OTHER — clipping fixed, a worse collision introduced. The frame
			 * must be at least as wide as the FURTHEST a label actually
			 * needed to go, not just as wide as the node content plus the
			 * spine's own fixed allowance; `packed.graph()`'s own width
			 * (read below) grows to match, so this also widens the real
			 * frame/pan range rather than clamping against a number the
			 * content has already outgrown.
			 */
			const maxLabelRight = Math.max(
				0,
				...[...routeById.values()].map((r) => (r.label ? r.label.x + r.label.w / 2 + FRAME_PAD : 0))
			);
			const packedWWithSpine = Math.max(
				laneIndex > 0 ? maxSpineX + TRUNK_LANE_GAP + SPINE_PAD : packedW,
				maxLabelRight
			);
			if (routeById.size > 0) {
				/**
				 * ⛔ 2026-10-09 · D-20 round 5 — `prevRouteKey === nextRouteKey`,
				 * NOT AN UNCONDITIONAL REWRITE. Every OTHER edge-data write in
				 * this effect (`gutterX`, `labelX`/`labelY`) compares the OLD
				 * value to the NEW one and returns the SAME edge object when
				 * they match, because `flowEdges` is `$state` and this effect
				 * READS it (`crossEdges`, above) — an unconditional `{...e,
				 * data: {...}}` produces a NEW array reference on every run
				 * whether or not the route actually moved, which re-triggers
				 * this very effect, which writes again, forever. A `route` is
				 * an array, so the comparison this block needs is by VALUE,
				 * not by reference — `JSON.stringify` is cheap at this size
				 * (a handful of points) and exact, which a float tolerance
				 * check would not be for free.
				 */
				const nextEdges = flowEdges.map((e) => {
					const r = routeById.get(e.id);
					if (!r) return e;
					/**
					 * ⭐ 2026-10-09 · D-20 round 6 — A TRUNK MEMBER THAT DOES NOT
					 * CARRY THE LABEL HAS ITS `label` PROP CLEARED TOO, NOT JUST
					 * LEFT WITHOUT A POSITION.
					 *
					 * `DependencyNetwork`'s own R3 dedup (`labelledEdgeKeys`)
					 * decides whether an edge carries TEXT at all, grouping by
					 * `(provider, exact text)` — a blocked edge's own distinct
					 * constraint (`payments ^3.0.0`) survives that dedup as ITS
					 * OWN group even when round 6's bundling now puts it in the
					 * SAME TRUNK as several unblocked siblings. This file's own
					 * `labelEdgeId` then picks only ONE member of the trunk to
					 * actually PLACE a label (`routeById`'s own `label`, possibly
					 * `undefined` here) — but the edge object's `label` PROP,
					 * coming from `DependencyNetwork`, was never told that. Measured
					 * live: `payments ^3.0.0`, not `labelEdgeId` for its trunk,
					 * still rendered — with no `routeLabelX`/`Y` ever set for it —
					 * and `BaseEdge` fell back to `(0, 0)`, an orphan label at the
					 * canvas's own origin corner. Overriding `label: undefined`
					 * here, for exactly this case, is the fix: text and position
					 * now come from the SAME decision instead of two different
					 * ones that could disagree.
					 */
					const label = r.label ? e.label : undefined;
					/**
					 * ⭐ 2026-10-09 · D-20 round 7 — CLAMPED INSIDE THE FRAME'S
					 * RIGHT EDGE TOO, NOW THAT `packedWWithSpine` (the frame's
					 * REAL width, spine included) IS KNOWN BEFORE THIS RUNS.
					 *
					 * Measured live: an "identity" trunk label resolved its
					 * push-away position past the frame's own right edge by
					 * ~21px, clipped by the pane's `overflow-hidden` — round
					 * 6's own clamp only ever enforced the LEFT bound (the
					 * defect it was written against, an orphan label near the
					 * canvas's own origin), on the unexamined assumption that
					 * every OTHER trunk label sits safely inside the frame
					 * because it is at or past `spineX`. That assumption
					 * missed that the push-away loop (`obstacles.find`, above)
					 * can still walk a label PAST the frame's own right edge
					 * when enough earlier trunks' lines/labels already crowd
					 * the gutter it landed in — exactly what happened here.
					 */
					const clampedLabel = r.label
						? {
								...r.label,
								x: Math.min(
									Math.max(r.label.x, r.label.w / 2 + FRAME_PAD),
									Math.max(r.label.w / 2 + FRAME_PAD, packedWWithSpine - r.label.w / 2 - FRAME_PAD)
								)
							}
						: undefined;
					const nextKey = JSON.stringify([r.route, clampedLabel ?? null]);
					const prevKey = (e.data as { routeKey?: string } | undefined)?.routeKey;
					if (prevKey === nextKey && label === e.label) return e;
					return {
						...e,
						label,
						data: {
							...(e.data ?? {}),
							route: r.route,
							routeLabelX: clampedLabel?.x,
							routeLabelY: clampedLabel?.y,
							routeKey: nextKey
						}
					};
				});
				if (nextEdges.some((e, i) => e !== flowEdges[i])) flowEdges = nextEdges;
			}

			packed = {
				node: (id) => {
					const p = positions.get(id);
					const d = dimsOf.get(id);
					if (!p || !d) return undefined;
					return { x: p.x, y: p.y, width: d.width, height: d.height };
				},
				graph: () => ({ width: packedWWithSpine, height: packedH })
			};

			/**
			 * ⭐ 2026-10-09 · D-20 round 4 — THE SAME-COMPONENT HOOK ONLY NOW.
			 * Cross-component edges are handled by the router above instead —
			 * see `crossEdges`'s own filter. A same-component pair sharing a
			 * stacked column (structurally possible, not exercised by today's
			 * fixture) still gets the plain hook: short, already close, no
			 * reason to leave its own neighbourhood for the gutter system.
			 */
			if (lrColumnBaseX.size > 0) {
				const laneBySource = new Map<string, number>();
				const nextEdges = flowEdges.map((e) => {
					if (e.type !== 'contractHop') return e;
					if (routeById.has(e.id)) return e;
					const sc = compIndexOf.get(e.source);
					const tc = compIndexOf.get(e.target);
					if (sc === undefined || tc === undefined || sc !== tc) return e;
					const base = lrColumnBaseX.get(e.target);
					if (typeof base !== 'number') return e;
					const lane = laneBySource.get(e.source) ?? 0;
					laneBySource.set(e.source, lane + 1);
					const gx = base + lane * LANE_GAP;
					/**
					 * ⭐ 2026-10-09 · D-20 round 7 — THE HOOK'S OWN LABEL, CLAMPED
					 * HERE TOO, NOT LEFT TO `ContractHopEdge`'s UNCLAMPED
					 * `(sourceX + gutterX) / 2`.
					 *
					 * This branch is the one other place a contract label's
					 * position is computed from raw geometry with no frame in
					 * sight — same class of defect the trunk router's own label
					 * just had fixed. `hookLabelX`/`Y` give `ContractHopEdge` a
					 * pre-clamped point to prefer over its own formula; `null`
					 * (missing `sp`, defensive only) falls back to the
					 * component's existing unclamped maths, unchanged.
					 */
					const sp = positions.get(e.source);
					const lw = typeof e.label === 'string' ? e.label.length * 6 + 12 : 0;
					const hookLabelX = sp
						? Math.min(
								Math.max((sp.x + gx) / 2, lw / 2 + FRAME_PAD),
								Math.max(lw / 2 + FRAME_PAD, packedWWithSpine - lw / 2 - FRAME_PAD)
							)
						: undefined;
					const prev = e.data as { gutterX?: number; hookLabelX?: number } | undefined;
					if (prev?.gutterX === gx && prev?.hookLabelX === hookLabelX) return e;
					return { ...e, data: { ...(e.data ?? {}), gutterX: gx, hookLabelX } };
				});
				if (nextEdges.some((e, i) => e !== flowEdges[i])) flowEdges = nextEdges;
			}
		}
		/** Reads `packed` when the canvas is in the shelf-packed `wideLR()`
		 *  regime, the single whole-graph `g` otherwise — every downstream
		 *  reader of a node's laid-out box goes through this one function so
		 *  the two code paths never have to be kept in sync by hand. */
		function nodeBox(id: string): { x: number; y: number; width: number; height: number } | undefined {
			if (packed) return packed.node(id);
			const n = g.node(id);
			return n ? { x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? 0, height: n.height ?? 0 } : undefined;
		}
		/** `graphSize`'s own `packed` counterpart to `nodeBox`, above. */
		function graphSize(): { width: number; height: number } {
			if (packed) return packed.graph();
			const gg = g.graph();
			return { width: gg.width ?? 0, height: gg.height ?? 0 };
		}

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
		/**
		 * ⛔ 2026-10-09 · D-20 round 4 — `!packed`. The width this stretch
		 * exists to fill is now spent by `packComponents`, above, which
		 * already shelf-packs across the full container width with no
		 * second dagre pass needed; running this on TOP of a packed layout
		 * would read `g` (the discarded whole-graph pass, see `packed`'s own
		 * doc) and stretch a drawing nothing downstream uses. `AppPromotionFlow`
		 * and the `compact` caller never set `forceStackCeiling`, so `packed`
		 * is always `null` for them and this guard is a no-op there.
		 */
		if (fillWidth && frameWidth > 0 && !packed) {
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
				const gaps = new Set(flowNodes.map((n) => Math.round(g.node(n.id)?.x ?? 0))).size - 1;
				if (gaps >= 1 && natural.width < target - 4) {
					const base = dir === 'LR' ? baseRanksep : baseNodesep;
					// Everything the drawing is not already spending on gutters —
					// the ranks themselves. Half of the stretched extent, at most.
					const ink = natural.width - gaps * base;
					const next = Math.min(base + (target - natural.width) / gaps, Math.max(base, ink / gaps));
					if (next > base + 2) {
						g = dir === 'LR' ? build(baseNodesep, next) : build(next, baseRanksep);
					}
				} else if (gaps < 1 && dir === 'LR' && snugFrame) {
					/**
					 * ⭐ THE COMPLEMENT: NO GAP TO WIDEN, SO THE FRAME SHRINKS TO
					 * THE INK INSTEAD. See `snugFrameWidth`'s own doc above. Only
					 * `LR` — under `TB` the constrained axis is height, and a
					 * `singleFile` column already sizes its own width via the
					 * `hasHook`/centring branch in `restingFit`, untouched here.
					 *
					 * `&& snugFrame` — 2026-09-18: this is the whole of the
					 * `snugFrame={false}` opt-out (see that prop's own doc). When
					 * false, the branch simply never runs and the frame keeps the
					 * caller's full offered width, exactly as if `gaps >= 1`.
					 *
					 * ⚠️ THE TOLERANCE CHECK READS `availableWidth`, NOT
					 * `frameWidth`. `frameWidth` is `containerWidth` — the
					 * pane's OWN width, which this very branch may just have
					 * shrunk on a previous tick. Comparing the new candidate
					 * against an already-shrunk `frameWidth` is comparing the
					 * cap against itself: once `containerWidth` settles at
					 * the capped value, `snug < frameWidth - 4` flips false
					 * (the two numbers converge), the cap lifts, `containerWidth`
					 * springs back to the full offer, the branch re-fires, and
					 * the cap re-applies — forever. `availableWidth` is the
					 * caller's offer with the cap never subtracted from it
					 * (see that variable's own doc), so the comparison stays
					 * true at exactly the same value on every tick once
					 * converged.
					 */
					const snug = Math.round(Math.max(SNUG_WIDTH_FLOOR, natural.width / 0.5));
					const offer = availableWidth > 0 ? availableWidth : frameWidth;
					nextSnugWidth = snug < offer - 4 ? snug : null;
				}
			}
		}

		const nextSize = graphSize();
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
			 * fix.
			 *
			 * ⛔ 2026-09-13 · WAS A FLAT `96`, SIZED FOR THE WORST LABEL THIS
			 * GRAPH CAN DRAW — WHICH MADE EVERY SHORTER ONE A LOOP AROUND
			 * EXTRA GUTTER IT NEVER NEEDED. Measured on the live fleet's
			 * two-node `checkout-api`⇄`payments-svc` neighbourhood (label
			 * `payments`, no version constraint drawn): the label rendered
			 * **60.7px**, and a flat 96 hook still drew a 96px-wide dashed
			 * loop with 35px of dead gutter past the label's own right edge
			 * — the loop's SIZE was never a function of what it was carrying.
			 * `GUTTER_BASE` is now MEASURED per canvas, from the actual
			 * `label.length` of every `contractHop` edge that will use it —
			 * the identical `length * 6 + 12` estimate `GraphCanvasInner`'s
			 * own dagre pass already uses to reserve rank space for a
			 * labelled edge (see `build()`'s `g.setEdge` call above), not a
			 * second guess at the same number. `+24` keeps the same "margin
			 * to spare" the flat constant's own comment asked for; `56` is
			 * the floor — short enough that a bare word never over-shrinks,
			 * long enough that a one-word label at `t-micro` still clears
			 * its own edge markers. A graph with a genuinely wide worst-case
			 * label (`api ^1.67.0`, ~84px) still lands close to the old 96.
			 */
			const maxLabelWidth = Math.max(
				0,
				...flowEdges
					.filter((e) => e.type === 'contractHop')
					.map((e) => (typeof e.label === 'string' ? e.label.length * 6 + 12 : 0))
			);
			const GUTTER_BASE = Math.max(56, maxLabelWidth + 24);
			const LANE_GAP = 20;
			/**
			 * ⭐ 2026-09-20 · AN EDGE WITH NOTHING TO GO ROUND DOES NOT GO ROUND.
			 *
			 * The gutter exists for ONE reason: under `singleFile` every node
			 * shares an x, so an edge between two nodes in the column would run
			 * straight THROUGH whatever sits between them. When nothing sits
			 * between them there is nothing to clear, and the out-and-back was
			 * drawn anyway — measured on the two-node neighbourhood the rail
			 * opens on, an 84x96 dashed elbow plus a 197px gutter at 1280-1600,
			 * around a pair of boxes that are already adjacent.
			 *
			 * ⭐ AND IT IS WHY THE DRAWING WAS NOT CENTRED. `restingFit`'s
			 * `singleFile`/`TB` branch pins a HOOKED column at `x = 20` (it has
			 * to: the gutter runs off the right of the content box, so centring
			 * the content would push the hook out of the canvas). No hook, and
			 * the same branch's `else` centres the column in the canvas — so
			 * killing a gutter nobody needed also centres the figure, with no
			 * second rule and no new constant.
			 *
			 * "Between" is measured on dagre's own y bands, not on the edge's
			 * endpoints, because the node boxes are what an edge would cross.
			 */
			const nodeBands = flowNodes
				.map((n) => {
					const nn = g.node(n.id);
					if (!nn) return null;
					const hh = nn.height ?? 0;
					return { id: n.id, top: (nn.y ?? 0) - hh / 2, bottom: (nn.y ?? 0) + hh / 2 };
				})
				.filter((x): x is { id: string; top: number; bottom: number } => x !== null);
			const crossesANode = (e: Edge) => {
				const a = nodeBands.find((n) => n.id === e.source);
				const c = nodeBands.find((n) => n.id === e.target);
				if (!a || !c) return true; // cannot prove it is clear, so keep the gutter
				const lo = Math.min(a.bottom, c.bottom);
				const hi = Math.max(a.top, c.top);
				return nodeBands.some(
					(n) => n.id !== e.source && n.id !== e.target && n.bottom > lo && n.top < hi
				);
			};

			let maxLane = 0;
			const nextEdges = flowEdges.map((e) => {
				if (e.type !== 'contractHop') return e;
				const prevGutterX = (e.data as { gutterX?: number } | undefined)?.gutterX;
				if (!crossesANode(e)) {
					// No gutter key at all: `ContractHopEdge` reads its absence as
					// "not hooked" and draws the library's own smoothstep path.
					if (prevGutterX === undefined) return e;
					const { gutterX: _drop, ...rest } = (e.data ?? {}) as { gutterX?: number };
					return { ...e, data: rest };
				}
				const lane =
					typeof (e.data as { lane?: number } | undefined)?.lane === 'number'
						? (e.data as { lane: number }).lane
						: 0;
				maxLane = Math.max(maxLane, lane);
				const gutterX = centerX + maxWidth / 2 + GUTTER_BASE + lane * LANE_GAP;
				if (prevGutterX === gutterX) return e;
				return { ...e, data: { ...(e.data ?? {}), gutterX } };
			});
			const anyHook = nextEdges.some(
				(e) =>
					e.type === 'contractHop' &&
					typeof (e.data as { gutterX?: number } | undefined)?.gutterX === 'number'
			);
			if (nextEdges.some((e, i) => e !== flowEdges[i])) flowEdges = nextEdges;

			/**
			 * ⭐ D-20b ROUND 2 (coordinator decision) — DELETED. The mobile
			 * "R3 residual" fix this block existed for (a provider with
			 * distinct constraint texts piling labels up at one `sourceY`)
			 * cannot recur: no contract edge carries label text any more
			 * (`DependencyNetwork`'s `edgeOf` always sets `label: undefined`).
			 * The held constraint reads at the CONSUMER node instead
			 * (`DependencyNode`'s `heldConstraints` line) at every width,
			 * phone included. `gutterX` (just above, unchanged) still routes
			 * the hook's LINE; only the label-position half of this file's old
			 * job is gone.
			 */

			/**
			 * ⭐ 2026-09-13 · THE FRAME SHRINKS TO THE HOOK, THE SAME WAY IT
			 * SHRINKS TO A SINGLE-RANK `LR` DRAWING — see `snugFrameWidth`'s own
			 * doc above. Measured on the live fleet's phone-width Dependencies
			 * card (a two-node, one-contract neighbourhood): the frame stayed
			 * the CARD's full width while the hook's own routed extent — node
			 * width plus `GUTTER_BASE` plus the fixed left offset `restingFit`
			 * gives a hooked column (20px, see its own `hasHook` branch) — was
			 * under half of it, so the segment `ContractHopEdge` draws OUT to
			 * the gutter and back IN reads as a dashed loop around a wide band
			 * of otherwise-unused canvas, with its label stranded at the
			 * loop's own right turn rather than near either node.
			 *
			 * dagre never sees this gutter (`ContractHopEdge`'s routing is a
			 * decoration on top of dagre's own node positions, per its own
			 * header), so `contentSize` — dagre's `g.graph().width/height` —
			 * does not include it either; the required width is computed here,
			 * once per lane count, from the exact same `centerX`/`maxWidth`/
			 * `GUTTER_BASE` arithmetic the edges above were just given, plus
			 * the fixed 20px `restingFit` offsets everything by and a small
			 * breathing margin past the widest lane.
			 *
			 * Sets the SAME `nextSnugWidth` the `LR` branch above uses — the
			 * two can never both be non-null in one pass (`dir` is either
			 * `'LR'` or `'TB'`), and the sync at the end of this effect is one
			 * write for whichever ran.
			 *
			 * ⛔ AND IT TAKES THE SAME `snugFrame` OPT-OUT, WHICH IT DID NOT
			 * UNTIL 2026-09-20 AND THAT WAS A SHIPPED DEFECT. The `LR` branch
			 * above was gated on `snugFrame` and this one was not, so a caller
			 * that had opted out still got a narrowed frame the moment the
			 * canvas flipped to `TB` — which on the Dependencies rail is EVERY
			 * width below `STACK_BELOW`. Measured: a 259px frame inside a 472px
			 * card at 390, 1280 and 1440, with the legend (which is laid out
			 * against the CARD, not against this frame) hanging past its right
			 * edge. One branch honouring a prop and its sibling ignoring it is
			 * the prop not existing.
			 */
			const TB_HOOK_LEFT_OFFSET = 20; // restingFit's fixed `x` when `hasHook`
			const TB_HOOK_RIGHT_PAD = 16;
			// `anyHook` false: no edge routes out to the gutter, so the width the
			// drawing needs is the column itself, not the column plus a channel
			// nothing runs in.
			const need = Math.round(
				anyHook
					? centerX +
							maxWidth / 2 +
							GUTTER_BASE +
							maxLane * LANE_GAP +
							TB_HOOK_LEFT_OFFSET +
							TB_HOOK_RIGHT_PAD
					: centerX + maxWidth / 2 + TB_HOOK_RIGHT_PAD
			);
			const offer = availableWidth > 0 ? availableWidth : frameWidth;
			nextSnugWidth = snugFrame && need < offer - 4 ? Math.max(TB_HOOK_WIDTH_FLOOR, need) : null;
		}
		/**
		 * ⭐ D-20b ROUND 2 (coordinator decision) — DELETED. No contract edge
		 * ever carries label text any more (`DependencyNetwork`'s `edgeOf`
		 * always sets `label: undefined`) — the constraint a reader used to
		 * find floating in the clear channel between two boxes now reads at
		 * the CONSUMER node itself (`DependencyNode`'s `heldConstraints`
		 * line). This block computed WHERE that floating label would sit;
		 * with nothing left to place, it is dead code, removed rather than
		 * left to silently do nothing — see the ledger item (D-20b) for the
		 * full before/after.
		 */

		if (nextSnugWidth !== snugFrameWidth) snugFrameWidth = nextSnugWidth;

		let changed = false;
		const next = flowNodes.map((node) => {
			const dn = nodeBox(node.id);
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

	/**
	 * ⭐ 2026-10-09 · D-20b ROUND 3 (coordinator decision) — ALWAYS 1. NEVER
	 * A SHRINK, EVEN WHEN A SINGLE COMPONENT IS WIDER THAN THE CONTAINER.
	 *
	 * Shelf packing (`packComponents`, in the layout effect) already uses the
	 * container's width — wrapping components onto new rows rather than
	 * stacking everything into one tall column — so `contentSize.width`
	 * should already sit at or under `containerWidth` in the ordinary case.
	 * The one case packing cannot fix is a SINGLE component whose own
	 * natural width already exceeds the container (measured live at 1024:
	 * `checkout-api`'s 7-node promotion family alone needs 969px against a
	 * 693px frame, `hello-world`'s plain 3-node chain needs 866px) — it is
	 * one atomic dagre pass, so there is no seam to wrap it at.
	 *
	 * ⛔ THE OLD RULE SHRUNK TO A 0.75 FLOOR HERE. Measured against the
	 * product's own "scale 1 where the content fits" bar: 0.75 is not a
	 * fallback for an unreadable case, it is the RESTING state at every one
	 * of 1024/1280/1440 on this exact fixture — three of the four desktop
	 * widths this canvas ships at rested BELOW zoom 1 by default, on a
	 * perfectly ordinary graph, because one promotion chain happens to be
	 * wider than the frame. That is a shrink users would hit on load, not
	 * an edge case.
	 *
	 * ⭐ THE FIX IS THE OTHER HALF OF THE SAME CONTRACT THIS FILE ALREADY
	 * HONOURS FOR `forceStackCeiling` (see `restingFit`'s own matching
	 * branch): when the packed drawing is wider than the frame, rest at
	 * zoom 1, pinned to the drawing's own START (`x: 8, y: 8`), and let the
	 * reader PAN right for the rest — never shrink type to make everything
	 * visible at once. The zoom/pan controls (`GraphCanvas`'s own corner
	 * buttons, already on screen at every width) are the visible affordance
	 * that the canvas scrolls; `overflows` (below) already reads the LIVE
	 * zoom against `contentSize`, so a reader who zooms back OUT past 1 via
	 * the minus button still sees the standard pan/scroll chrome, unchanged.
	 */
	const packedZoom = $derived.by(() => 1);

	/**
	 * ⭐ 2026-10-09 · D-20 round 3/4 — `wideLR()` SKIPS THE `maxHeight` CLAMP
	 * AND USES `packedZoom` INSTEAD OF `restingWidthZoom`. See `frameFor`'s
	 * matching doc just above for the clamp. `restingWidthZoom` floors at
	 * `FIT.minZoom` (0.85/`minZoomWide`) for `snugHeight`'s own, unrelated
	 * regime; this one floors at `0.75` and is driven by the PACKED content
	 * width (`packedZoom`, above), which is 1 in the ordinary — already
	 * width-packed — case.
	 */
	const frameHeight = $derived.by(() => {
		if (height !== null) return height;
		if (contentSize.height === 0) return minHeight;
		if (wideLR()) return Math.max(minHeight, Math.round(contentSize.height * packedZoom + 16));
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
		!(singleFile && orientation === 'TB') && minimapFrom !== null && flowNodes.length >= minimapFrom
	);
</script>

<div
	bind:this={rootEl}
	class="graph-canvas relative {singleFile && orientation === 'TB'
		? 'graph-canvas--scroll'
		: ''} {className}"
	style={snugFrameWidth !== null ? `max-width:${snugFrameWidth}px;margin-inline:auto` : undefined}
>
	{#if showControls}
		<!-- ⭐ A STRIP, NOT AN OVERLAY. (2026-09-02) These used to float
		     `absolute` on top of the pane, which is how the zoom stack ended up
		     printed over the DEV node at 390 — there is no width narrow enough
		     to guarantee a top-right corner is empty. A row ABOVE the drawing
		     reserves its own space instead of gambling on the layout leaving a
		     gap, so it can never overlap a node at any width.

		     `rounded-md` (DESIGN-LANGUAGE.md §2.7: 8px is cards/tiles/banners;
		     this reserved-row control group reads as a small well, not a
		     floating popover, so it takes NO shadow either — the elevation
		     model reserves shadow for things that float, and this strip sits
		     in its own row, never over the drawing. The minimap below takes
		     the same radius for the same reason. -->
		<div class="mb-1.5 flex justify-end">
			<div class="flex overflow-hidden rounded-md border border-line bg-surface">
				<button
					type="button"
					onclick={() => zoomIn({ duration: 150 })}
					aria-label="Zoom in"
					title="Zoom in"
					class="flex h-8 w-8 items-center justify-center text-fg-subtle hover:bg-hover hover:text-fg"
				>
					<ZoomInOutline class="h-4 w-4" />
				</button>
				<button
					type="button"
					onclick={() => zoomOut({ duration: 150 })}
					aria-label="Zoom out"
					title="Zoom out"
					class="flex h-8 w-8 items-center justify-center border-l border-line text-fg-subtle hover:bg-hover hover:text-fg"
				>
					<ZoomOutOutline class="h-4 w-4" />
				</button>
				<button
					type="button"
					onclick={() => fitAll()}
					aria-label="Fit the whole graph"
					title="Fit the whole graph"
					class="flex h-8 w-8 items-center justify-center border-l border-line text-fg-subtle hover:bg-hover hover:text-fg"
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
					class="!m-2 !rounded-md !border !border-line !bg-surface/80"
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
	   a declared role (`t-meta` 12/16/400 or `t-ui-sm` 12/16/500; the legacy
	   `t-micro` 11/400 / `t-button` 12/600 names were off the closed scale)
	   instead of this component's own off-scale 10.5px.

	   ⭐ 2026-10-09 · D-20 round 3 — `padding` GAINED A VERTICAL COMPONENT.
	   The background ALREADY knocks a line out from behind the text (it is
	   opaque, and `.svelte-flow__edge-labels` already paints after
	   `.svelte-flow__edges` in the DOM — confirmed live, zoomed 3x: the wire
	   visibly BREAKS at the label and resumes past it). What was missing was
	   breathing room: `0 3px` had no vertical pad at all, so the wire
	   touched the text's own ascender/descender on both edges with no gap —
	   legible, but reading as a crowded box rather than a deliberate
	   knockout. `2px` top/bottom (the `4px` horizontal already there) is the
	   same margin this file's own label-placement sweep already reserves
	   around a label box (`PAD`, `GraphCanvasInner`'s layout effect) — one
	   number, now also visible as the padding it was computed to leave. */
	.graph-canvas :global(.svelte-flow__edge-label) {
		font-size: 12px;
		line-height: 16px;
		padding: 2px 4px;
		/* 4px is the vocabulary's own small radius (`Chip`, `.chip-value`,
		   every other compact label on the canvas); this was the one
		   surface still on 3px. */
		border-radius: 4px;
	}
</style>
