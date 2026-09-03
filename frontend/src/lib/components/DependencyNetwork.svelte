<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE DEPENDENCY GRAPH, DRAWN — ONE graph, two edge kinds, on Svelte Flow
	 * laid out by dagre.
	 *
	 * ── ⭐ THE LAYOUT, AND WHAT WAS REJECTED ────────────────────────────────
	 *
	 * The picture is a MATRIX: **one axis is environments, the other is
	 * services.** A build moves along its service's line through the
	 * environments, and sideways within one environment between services that
	 * must ship in order. That is the operator's own model and it is the only
	 * arrangement in which the two edge kinds are told apart by geometry alone.
	 *
	 * Which axis is which is a function of the CARD'S WIDTH and nothing else —
	 * environments across at 1440, environments down at 390. See the
	 * one-component section below.
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
	 *   · a PROMOTION is *the same thing moving*: it runs along the ENVIRONMENT
	 *     axis, `env-out` to `env-in`, between two boxes printing the SAME
	 *     service name, and it is UNLABELLED — a promotion has no name, because
	 *     it is not an agreement. Its state is legible from the two build ids
	 *     on its ends.
	 *   · a CONTRACT is *two different things agreeing*: it runs along the
	 *     SERVICE axis, `contract-out` to `contract-in`, inside ONE
	 *     environment, between two boxes with DIFFERENT names, and it is
	 *     LABELLED with the contract and the constraint (`api ^1.67.0`) — the
	 *     thing being agreed.
	 *
	 * ⭐ NEITHER HALF OF THAT IS A DIRECTION, which is why it survives the
	 * `LR`→`TB` transpose at phone width intact: *same name + no label* against
	 * *two names + a label* reads the same whichever way the matrix is turned.
	 * `DependencyNode` moves the handles; this file names the same four ids at
	 * every width and never learns which way round the canvas is.
	 *
	 * ── WHAT SPENDS COLOUR ──────────────────────────────────────────────────
	 *
	 * ⛔ ALMOST NOTHING. An open gate is a thin gray line; open is the norm on
	 * this fleet and the product does not draw the norm. A BLOCKED edge is RED,
	 * not amber — `Chip`'s own reasoning for the `blocked` role: amber means
	 * `stuck` and nothing else. A gate we could not READ is a DASHED gray line,
	 * never an open one.
	 *
	 * ── ⭐ ONE COMPONENT AT EVERY WIDTH. THE PHONE GETS THE SAME GRAPH ──────
	 *
	 * Until 2026-08-31 this file rendered TWO things behind a `matchMedia`
	 * gate: the canvas at `sm` and above, and the same graph flattened into
	 * SERVICE LINES below it. That is deleted, and it is not coming back.
	 *
	 * ⛔ TWO RENDERINGS OF ONE FACT DRIFT, AND THE PHONE BRANCH IS THE ONE
	 * NOBODY LOOKS AT. It had already happened once: the mobile list this file
	 * inherited was CONTRACT-ONLY and silently omitted every promotion edge —
	 * half the truth, on the screen least likely to be checked. Replacing it
	 * with a second hand-written list that carried both relations fixed that
	 * instance and kept the defect class. Rendering the canvas at every width
	 * removes the class.
	 *
	 * The mechanism is the one `GraphCanvasInner` already had for
	 * `AppPromotionFlow`: `rankdir="auto"` flips dagre to `TB` below
	 * `STACK_BELOW` px of MEASURED CONTAINER width. At 390 the environments
	 * then run DOWN the page and the services ACROSS it — the transpose of the
	 * desktop reading, and the right way round, because the axis that grows
	 * with the fleet is services and that axis must not be the page's own
	 * scroll axis. `DependencyNode` transposes its handles to match.
	 *
	 * ⛔ AND NO `matchMedia` HERE. The canvas measures its own container and
	 * reports back through `onorientation`; a breakpoint read a second time in
	 * this file is a second opinion about the width that can disagree with the
	 * drawing it is captioning. The card is not the viewport — it is 326px
	 * inside a 390px page and 526px inside a 768px one.
	 */
	import { MarkerType, type Node, type Edge, type EdgeTypes } from '@xyflow/svelte';
	import { ChevronDoubleRightOutline, ShareNodesSolid } from 'flowbite-svelte-icons';
	import GraphCanvas from '$lib/components/GraphCanvas.svelte';
	import DependencyNode from '$lib/components/DependencyNode.svelte';
	import ContractHopEdge from '$lib/components/ContractHopEdge.svelte';
	import { theme } from '$lib/stores/theme';
	import { getEnvironmentThemeStyle, shortEnvLabel, type EnvironmentTheme } from '$lib/environment-theme';
	import type { DependencyNodeData } from '$lib/components/dependency-node-data';
	import {
		layoutOrder,
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
	/** `contractHop` only means something under `singleFile` — see `edgeOf`. */
	const edgeTypes: EdgeTypes = { contractHop: ContractHopEdge };

	/**
	 * ⭐ THE FLIP IS ON THE CARD'S WIDTH, NOT THE VIEWPORT'S, and 620 is where
	 * three environment columns at ~210px stop fitting. Measured on the live
	 * fleet: the canvas is 1182px inside a 1440px page and 326px inside a 390px
	 * one, and on the rollout tab 990px at 1280 and 526px at 768 — so the same
	 * number covers a phone and a narrow rollout tab without either knowing the
	 * other exists.
	 */
	const STACK_BELOW = 620;
	/** Written by the canvas once it has measured itself. See `onorientation`. */
	let stacked = $state(false);

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
	 * It is what puts a contract's two ends adjacent along the within-rank axis
	 * — rows under `LR`, columns under `TB` — and the held service first on it.
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

	/**
	 * ⭐ ONE LANE PER CONTRACT EDGE THAT SHARES GUTTER SPACE WITH ANOTHER —
	 * greedy interval scheduling over RANK SPANS, the same trick a calendar
	 * view uses to stack overlapping meetings into columns.
	 *
	 * `orderedNodes`' own position IS the rank a `singleFile` layout assigns
	 * (`GraphCanvasInner`'s spine walks this exact array), so a contract
	 * edge's span in that order is the range of rows its hook's vertical run
	 * actually crosses. Two edges whose spans overlap would draw the same
	 * gutter channel on top of each other; sorted by where they start and
	 * assigned the lowest lane not already busy past that point, they don't.
	 * Only read when `stacked` — `LR` never asks for a lane.
	 */
	const contractLane = $derived.by(() => {
		const rankOf = new Map(orderedNodes.map((n, i) => [n.id, i] as const));
		const spans = graph.edges
			.filter((e) => e.writer === 'contract')
			.map((e) => {
				const a = rankOf.get(e.from) ?? 0;
				const b = rankOf.get(e.to) ?? 0;
				return { key: e.key, lo: Math.min(a, b), hi: Math.max(a, b) };
			})
			.sort((x, y) => x.lo - y.lo);
		const laneEnds: number[] = [];
		const lanes = new Map<string, number>();
		for (const s of spans) {
			let lane = laneEnds.findIndex((end) => end < s.lo);
			if (lane === -1) {
				lane = laneEnds.length;
				laneEnds.push(s.hi);
			} else {
				laneEnds[lane] = s.hi;
			}
			lanes.set(s.key, lane);
		}
		return lanes;
	});

	function edgeOf(e: GraphEdge): Edge {
		const stroke = e.state === 'blocked' ? ink('blocked') : ink('quiet');
		const promotion = e.writer === 'promotion';
		const label = promotion ? undefined : contractLabel(e);
		/**
		 * ⭐ `contractHop` UNDER `singleFile` ONLY. See `ContractHopEdge`'s own
		 * header for the defect this replaces — the library's `smoothstep`
		 * routes a `Right`→`Left` edge between two vertically stacked nodes
		 * by swinging behind the column, off the pane's own left edge. `LR`
		 * (`stacked` false) keeps the library's default; it never had this
		 * problem, because a contract partner really is beside the node
		 * there, not somewhere else in the same column.
		 */
		const type = !promotion && stacked ? 'contractHop' : 'smoothstep';
		return {
			id: e.key,
			source: e.from,
			target: e.to,
			// THE HANDLES ARE THE DISCRIMINATOR, and only the AXIS is named here.
			// Which side each one is on follows the canvas's `LR`/`TB` — see
			// `DependencyNode`.
			sourceHandle: promotion ? 'env-out' : 'contract-out',
			targetHandle: promotion ? 'env-in' : 'contract-in',
			type,
			data: type === 'contractHop' ? { lane: contractLane.get(e.key) ?? 0 } : undefined,
			label,
			// An edge label is an HTML div in this library, so it takes `color`
			// and `background` — not the SVG `fill` a <text> node would.
			// Size moves WITH the weight so each state lands on a declared
			// type-role combo (`t-micro` 11/400 unblocked, `t-button` 12/600
			// blocked) instead of the shared 10.5px neither state owns.
			labelStyle: `font-size:${e.state === 'blocked' ? 12 : 11}px;font-weight:${
				e.state === 'blocked' ? 600 : 400
			};color:${e.state === 'blocked' ? stroke : ink('label')};background:${ink('ground')};`,
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

	/**
	 * ⭐ WHICH NODE THE READER LANDS ON when the drawing does not fit — a design
	 * decision, and the answer is the BLOCKED one.
	 *
	 * `layoutOrder` already puts the held component first, but WITHIN it the
	 * order is topological, so the first node is the PROVIDER: on the live fleet
	 * `hello-api-app`, which is fine, and the red `hello-frontend-app` is the
	 * one actually held. On a 1182px canvas that costs nothing because the whole
	 * graph fits. On a 324px card it is the difference between opening on the
	 * problem and opening one column to the left of it.
	 *
	 * A page that already knows what the reader came for — the rollout tab —
	 * wins, because "this rollout" beats "some blocked rollout".
	 */
	const anchor = $derived(focus ?? orderedNodes.find((n) => n.blocked)?.id ?? null);

	/**
	 * ⭐ THE BLOCKED EDGE ITSELF — BOTH ENDS — for the resting view to contain.
	 * (2026-09-02, measured on `/dependencies` at 390: the pane opened on
	 * `hello-frontend-app`'s three environments with `hello-api-app`, the
	 * PROVIDER the banner names, entirely off-screen. `anchor` alone is a
	 * single point; the edge that HOLDS it has a second end, and that end is
	 * the rest of the sentence the banner and the `Blocked links` card both
	 * print.)
	 *
	 * The edge chosen is whichever inbound edge on `anchor` is actually
	 * `blocked` — there can be more than one (a node held by both a
	 * promotion gate and a contract gate at once), and the first is as good
	 * as any: the point is showing A blocked relationship, not an exhaustive
	 * one, and `null` here (nothing inbound is blocked, or there is no
	 * anchor) falls back to `GraphCanvasInner`'s single-node `anchor` path
	 * unchanged.
	 */
	const anchorSpan = $derived.by<[string, string] | null>(() => {
		if (!anchor) return null;
		const holding = (inbound.get(anchor) ?? []).find((e) => e.state === 'blocked');
		return holding ? [holding.from, anchor] : null;
	});

	/**
	 * ⭐ THE `TB` GUTTER USED TO CARRY A CONTRACT LABEL IN A SHARED ROW —
	 * THERE IS NO SHARED ROW ANY MORE. (2026-09-03) Before `singleFile`, a
	 * `TB` rank held every service at one environment side by side, and the
	 * within-rank gutter (`nodesep`) had to be sized from the widest contract
	 * label so it did not print across the neighbour's chip. `singleFile`
	 * puts one node per row, so nothing shares a row under `TB` any more and
	 * the label-width gutter this used to compute is dead weight — deleted
	 * with it. `LR`'s `nodesep={36}` was always a plain constant (a label is
	 * ~18px tall there, not wide) and is untouched.
	 */
</script>

{#if graph.nodes.length > 0}
	<!--
		⭐ A TWO-AXIS LEGEND HAS A SHAPE, SO IT IS DRAWN, NOT WRITTEN.
		(2026-09-02) Two full sentences of prose ("Across: a build moving
		through environments, left first. Down: a service waiting on another
		in the same environment.") said the same thing this glyph pair shows
		in one line — direction is the one thing a graph can get
		catastrophically wrong, and no arrowhead convention is universal, but
		the FIX is geometry, not more words. The two marks are the product's
		own, already-shipped icons for these two edge kinds
		(`ChevronDoubleRightOutline` for a promotion, `ShareNodesSolid` for a
		contract — `GateRecord.svelte`'s `gateMark()`), so the legend and the
		graph cannot drift about what a mark means. The chevron ROTATES with
		`stacked`, because that edge is genuinely vertical under `TB` and the
		glyph should say so; the share icon has no orientation to carry.
	-->
	<p class="t-micro mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-500 dark:text-gray-400">
		<span class="inline-flex items-center gap-1">
			<ChevronDoubleRightOutline class="h-3 w-3 shrink-0 {stacked ? 'rotate-90' : ''}" />
			environments
		</span>
		<span class="inline-flex items-center gap-1">
			<ShareNodesSolid class="h-3 w-3 shrink-0 {stacked ? '' : 'rotate-90'}" />
			services in one environment
		</span>
	</p>
	<!--
		⭐ 2026-09-03 · THE SAME COMPONENT, ONE NODE PER ROW UNDER `TB`, NOT A
		SECOND COMPONENT. The human's standing decision, reaffirmed this week:
		one component at every width now that this is the flow library, not a
		hand-rolled mobile list ("I'd rather have one component now that we
		use flow library instead").

		`DependencyNode` shrinks its own box under `TB` (see its header), but
		measured, a narrower box alone does not clear the floor: a `TB` rank
		is every SERVICE at one environment, not just the held pair, because
		`rankEdges` (promotion only) ranks each service chain independently
		from rank 0. Four boxes plus three gutters is wider than a 307px pane
		at any zoom this product accepts as legible, and a `Chip` label is
		already AT the "no label under 10 effective px" floor — this canvas
		cannot shrink even a little to rescue it. `singleFile` (passed to
		`GraphCanvas` below) is the actual fix: under `TB` it replaces ranking
		by ENVIRONMENT with ranking by NODE, one per row, in this file's own
		`orderedNodes` order — so the held component still opens at the top,
		and no row is ever more than one box wide. `fillWidth` goes off at the
		same time: it exists to spend a WIDE card's slack (`AppPromotionFlow`'s
		reason for it); at 390 there is no slack to spend.

		`ranksep`/`nodesep` shrink to match: `ranksep` is now the gap between
		CONSECUTIVE ROWS, not between environment bands, so the generous `TB`
		gutter this card used before (sized for a labelled edge landing in a
		shared row) is unnecessary — every row holds one box and dagre's own
		`nodesep` no longer separates anything. `maxHeight` stops clamping,
		because a single-file list is exactly as tall as its rows and there is
		nothing to fit into a fixed frame — the PAGE scrolls, the pane's own
		height just follows its content (`frameFor` in `GraphCanvasInner`,
		unclamped once `maxHeight` is this large).

		⭐ 2026-09-03 · `minZoomWide`/`snugHeight` — see `GraphCanvasInner`'s
		own doc on each. Measured at 1024 (a 749px card against this graph's
		927px natural `LR` width): the fit landed at 0.711, an under-floor
		7.1px `Chip` label, with 36% of the pane's own height left empty
		below a drawing that was never resized to the zoom it actually
		rendered at. `0.85` unifies this graph's `LR` floor with `narrow`'s —
		one legibility floor at every width, not just below 520px — and
		`snugHeight` makes the pane follow that floor's zoom instead of
		assuming 1. `AppPromotionFlow` passes neither and is unaffected.
	-->
	<GraphCanvas
		nodes={flowNodes}
		edges={flowEdges}
		layoutEdges={rankEdges}
		{nodeTypes}
		{edgeTypes}
		rankdir="auto"
		stackBelow={STACK_BELOW}
		singleFile
		ranksep={stacked ? 22 : compact ? 96 : 116}
		nodesep={stacked ? 24 : 36}
		minHeight={compact ? 148 : 168}
		maxHeight={stacked ? 100000 : compact ? 400 : 680}
		fallbackNodeWidth={stacked ? 110 : compact ? 190 : 210}
		fallbackNodeHeight={stacked ? 72 : 68}
		minimapFrom={14}
		{anchor}
		{anchorSpan}
		fillWidth={!stacked}
		minZoomWide={0.85}
		snugHeight
		onorientation={(o) => (stacked = o === 'TB')}
		{dark}
		ariaLabel="Dependency graph"
		class="rounded-lg border border-gray-200 bg-gray-50/40 dark:border-gray-700 dark:bg-gray-900/40"
	/>
{/if}
