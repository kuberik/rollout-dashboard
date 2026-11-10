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
	import { StableOrder } from '$lib/view-models/stable-order';
	import { type Node, type Edge, type EdgeTypes } from '@xyflow/svelte';
	import { ARROW, ARROW_PATH, ARROW_VIEWBOX, wireKind } from '$lib/graph-arrow';
	import { ChevronDoubleRightOutline, ShareNodesSolid } from 'flowbite-svelte-icons';
	import GraphCanvas from '$lib/components/GraphCanvas.svelte';
	import DependencyNode from '$lib/components/DependencyNode.svelte';
	import ContractHopEdge from '$lib/components/ContractHopEdge.svelte';
	import { theme } from '$lib/stores/theme';
	import {
		getEnvironmentThemeStyle,
		shortEnvLabel,
		type EnvironmentTheme
	} from '$lib/environment-theme';
	import type { DependencyNodeData } from '$lib/components/dependency-node-data';
	import { href } from '$lib/paths';
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
		hrefOf = (n: GraphNode) => href(`/rollouts/${n.cluster}/${n.namespace}/${n.name}`),
		themeOf = () => null,
		compact = false,
		orderKey = '',
		heldRequirement = (e: GraphEdge) => e.requiredVersion
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
		/**
		 * When this changes the node order is re-sorted (held first); while it
		 * stays the same, live updates keep every node where it is. See
		 * `stable-order.ts`.
		 */
		orderKey?: string;
		/**
		 * The range a held contract edge's own build needs. Default: the edge's
		 * agreed range (null when its held builds ask for different ones).
		 */
		heldRequirement?: (e: GraphEdge) => string | null;
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
	/**
	 * ⭐ 2026-10-08 · D-20 — THE SECOND, INDEPENDENT STACKING THRESHOLD: NOT
	 * "the card is too narrow for its columns" (`STACK_BELOW`, above) but
	 * "the zoom rescue may fall back to a single column when the fit is
	 * bad, but only below here." Coordinator decision: a fleet-sized network
	 * must stay a layered `LR` graph, sitting at its readability floor and
	 * panned onto the first blocked node, at desktop widths — never a
	 * 2000px-plus single column just because the full fit landed under
	 * `SINGLE_FILE_FLOOR`.
	 *
	 * This reads `GraphCanvasInner`'s `availableWidth` (the page's own offer
	 * one level outside `.graph-canvas`, never narrowed by this component's
	 * own `snugFrameWidth`), not `containerWidth` or the viewport — measured
	 * live on this page with the rescue disabled: **783px at a 1024px
	 * viewport, 527px at 768px.** `700` sits comfortably inside that gap —
	 * right up against the boundary (e.g. 780) measured flaky: on a cold
	 * mount `availableWidth` can read a few px low before the pane's first
	 * real measurement settles, and the whole point of this ceiling is that
	 * it must never trip at a desktop width by a timing accident. `700`
	 * keeps a wide margin on both sides, so the full `/dependencies` page
	 * reads as `>= 1024px viewport` (never stacks, floor-and-pan) reliably
	 * from 1024 up, and the 768-1024 band below it keeps the zoom rescue
	 * exactly as it already behaved: `LR` if the fleet fits at the floor,
	 * `TB` if it does not.
	 */
	const FORCE_STACK_CEILING = 700;
	/** Written by the canvas once it has measured itself. See `onorientation`. */
	let stacked = $state(false);
	/**
	 * ⭐ 2026-09-18 · THE LEGEND MOVED BELOW THE DRAWING AND LOST ITS CENTRING.
	 *
	 * Until this redesign it sat ABOVE `<GraphCanvas>`, width-synced to
	 * `GraphCanvasInner`'s `snugFrameWidth` (a small single-rank graph draws
	 * in a canvas sized to its own content, centred, rather than stretched to
	 * the full card) via the `onsnugwidth` callback — the row picked that
	 * width up as its own `max-width` + `margin-inline: auto` so the two
	 * objects shared one measured edge.
	 *
	 * On the rollout tab (`compact`) that centred pairing is exactly the
	 * *"floating label"* the human named: a caption hanging above a narrow,
	 * centred figure in a sea of empty card. §5c's `snugFrame={!compact}`
	 * means the compact caller's frame is never narrowed in the first place
	 * — the rail card is already sized to the drawing — so there is nothing
	 * left to centre over. The legend now sits BELOW the drawing, left-
	 * aligned at the card body's own left edge, as an ordinary caption. The
	 * glyphs and their `stacked` rotation are unchanged.
	 *
	 * `snugWidth` is gone from THIS file, and `GraphCanvasInner`'s
	 * `onsnugwidth` callback is gone with it: this was its only caller in the
	 * product, and a reporting channel nobody reads is a second source of
	 * truth waiting to drift from the one the template already uses.
	 * `snugFrameWidth` itself is untouched — it still narrows
	 * `/dependencies`' frame for a small subgraph, read where it is written,
	 * by that component's own template.
	 */

	const nodeById = $derived(new Map(graph.nodes.map((n) => [n.id, n] as const)));
	const inbound = $derived.by(() => {
		const m = new Map<string, GraphEdge[]>();
		for (const e of graph.edges) m.set(e.to, [...(m.get(e.to) ?? []), e]);
		return m;
	});
	/**
	 * ⭐ 2026-09-03 · THE OTHER DIRECTION, FOR `anchorSpan` ON A PROVIDER'S
	 * OWN PAGE — see that derivation's own note. `inbound` answers "what is
	 * holding this node back"; a rollout that HOLDS someone else back (and is
	 * not itself held by anything) has nothing in `inbound`, so without this
	 * `anchorSpan` fell back to `null` on exactly the page most likely to
	 * want it: `hello-api-app`'s own Dependencies tab, where `anchor` is
	 * `hello-api-app` and the story is who IT is holding, not who holds it.
	 */
	const outbound = $derived.by(() => {
		const m = new Map<string, GraphEdge[]>();
		for (const e of graph.edges) m.set(e.from, [...(m.get(e.from) ?? []), e]);
		return m;
	});

	/**
	 * An SVG `stroke` and a marker `color` take a literal, not a Tailwind class,
	 * so the two hues this canvas spends are named once here and resolved
	 * against the product's own theme store rather than sniffed off the DOM.
	 */
	const INK = {
		// ⭐ THE TOKENS THEMSELVES, NOT `$lib/graph-arrow`'s SPEC. (round 4
		// review, 2026-10-09) `WIRE_INK.held` (`#ff8904` dark / `#ca3500`
		// light — Tailwind's orange-700/400) is a SECOND orange on this page,
		// separable from `--k-held-line`/`--k-held-fg` (`#ffa46e`/`#ac430e`
		// as rendered) by eye — two oranges made the graph the loudest
		// colour in the dashboard. `$lib/graph-arrow` still owns the SHAPE
		// (arrowhead geometry, stroke widths) shared with the rollout tab's
		// neighbourhood graph; only the COLOUR moves onto this page's own
		// `--k-held-line` (stroke + arrowhead) and `--k-held-fg` (the
		// label's ink — see `blockedLabel` below, previously the label just
		// reused the stroke colour). `quiet` moves from `WIRE_INK.quiet`
		// (`#d1d5dc`/`#4a5565`, Tailwind gray-300/600) onto `--k-line-strong`
		// — the exact token an unheld line is everywhere else on the page.
		// Values read live via `getComputedStyle` against the running theme
		// (`/tmp/tokens2.mjs`, round 4) rather than hand-converted to hex, so
		// they cannot silently drift from the ramp if it is retinted again.
		blocked: { light: 'oklch(0.84 0.095 45)', dark: 'oklch(0.48 0.12 50)' },
		blockedLabel: { light: 'oklch(0.52 0.15 42)', dark: 'oklch(0.8 0.13 50)' },
		quiet: { light: 'oklch(0.862 0.012 222)', dark: 'oklch(0.38 0.019 222)' },
		// ⭐ THE RETINTED RAMP'S OWN HEX, NOT TAILWIND'S OLD GRAY. (round 2
		// review, 2026-10-08) These were `gray-500`/`gray-400` (`#6b7280`/
		// `#9ca3af`) and plain white/`gray-800` (`#ffffff`/`#1f2937`) — the
		// PRE-retint ramp (DESIGN-LANGUAGE.md §2.3 moved to hue 222, chroma
		// ≤0.019), so an edge label was the one object on this canvas still
		// drawing the old material. `label` = `--k-fg-subtle`'s own hex;
		// `ground` = `--k-ground`'s (the canvas draws on `.canvas-dots`,
		// which is `bg-ground`, not `bg-surface` — a label sitting on the
		// canvas has to match ITS ground, not a card's).
		label: { light: '#616e73', dark: '#889599' },
		ground: { light: '#f4f7f9', dark: '#0e1619' }
	};
	const markerUid = `dn-${Math.random().toString(36).slice(2, 8)}`;
	const dark = $derived($theme === 'dark');
	const ink = $derived((k: keyof typeof INK) => (dark ? INK[k].dark : INK[k].light));

	/**
	 * ⭐ THE ORDER IS THE SEED dagre'S WITHIN-RANK PASS STARTS FROM, so the
	 * nodes are emitted in `layoutOrder` rather than in the model's own sort.
	 * It is what puts a contract's two ends adjacent along the within-rank axis
	 * — rows under `LR`, columns under `TB` — and the held service first on it.
	 */
	// Held first on arrival, then stable under live updates (`stable-order.ts`):
	// under `singleFile` this order IS the row order, and it seeds dagre's
	// within-rank pass under `LR`, so re-sorting live moved boxes in one frame.
	const nodeOrder = new StableOrder();
	const orderedNodes = $derived.by(() => {
		const rank = new Map(layoutOrder(graph).map((id, i) => [id, i] as const));
		const sorted = [...graph.nodes].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
		return nodeOrder.apply(orderKey, sorted, (n) => n.id);
	});

	/** The gates holding a node that ARE drawn as edges, for its tooltip. */
	function nodeTitle(n: GraphNode): string {
		if (n.unresolved) return `${n.name} — no Rollout of this name is visible to this dashboard`;
		const lines = [nodeLabel(n)];
		if (n.build) lines.push(`running ${n.build}`);
		if (n.candidateCount > 0)
			lines.push(`${n.candidateCount} newer build${n.candidateCount === 1 ? '' : 's'} available`);
		for (const e of inbound.get(n.id) ?? []) lines.push(edgeSentence(e, nodeById));
		// ⛔ NOT `h.short` WHILE PENDING. (2026-09-04, load-state audit
		// finding 4) `short` is the `check` fallback's claim until
		// `/schedules` answers, and the native tooltip is as much a printed
		// claim as the node's own text — see `DependencyNode.svelte`'s same
		// guard on the drawn reason line.
		for (const h of n.holds) lines.push(h.pending ? 'Checking a rule…' : h.short);
		return lines.join('\n');
	}

	/**
	 * ⭐ D-20b ROUND 2 — THE HELD CONSTRAINT, READ AT ITS CONSUMER. See
	 * `DependencyNodeData.heldConstraints`'s own doc for why this moved off
	 * the edge. `inbound` already indexes every edge by its consumer
	 * (`to`); filtering to `writer === 'contract' && state === 'blocked'`
	 * is the exact same test `edgeOf`'s own stroke colour and the OLD
	 * `contractLabel` both used, so a node's held line and its edge's held
	 * colour can never disagree about which edges are the story. Sorted by
	 * contract name — graph edge order is insertion order off the API, not
	 * a reading order a person chose.
	 */
	function heldConstraintsFor(n: GraphNode): DependencyNodeData['heldConstraints'] {
		return (inbound.get(n.id) ?? [])
			.filter((e) => e.writer === 'contract' && e.state === 'blocked')
			.map((e) => ({
				contract: e.contract ?? 'contract',
				requiredVersion: heldRequirement(e),
				providedVersion: e.providedVersion
			}))
			.sort((a, b) => a.contract.localeCompare(b.contract));
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
				holds: n.holds.map((h) => ({
					gate: h.gate,
					clears: h.clears,
					short: h.short,
					pending: h.pending
				})),
				heldConstraints: heldConstraintsFor(n),
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
		/**
		 * ⭐ `contractHop` UNDER `singleFile` ONLY. See `ContractHopEdge`'s own
		 * header for the defect this replaces — the library's `smoothstep`
		 * routes a `Right`→`Left` edge between two vertically stacked nodes
		 * by swinging behind the column, off the pane's own left edge. `LR`
		 * (`stacked` false) keeps the library's default; it never had this
		 * problem, because a contract partner really is beside the node
		 * there, not somewhere else in the same column.
		 */
		/**
		 * ⛔ 2026-09-13 · NO LONGER `stacked`-ONLY. The hook itself still is
		 * (`ContractHopEdge` draws it only when the layout hands it a
		 * `gutterX`, which only a `singleFile` `TB` column gets), but the
		 * LABEL placement this component owns has to apply everywhere,
		 * because `stacked` is not the same question as "did dagre put these
		 * two nodes in one column". Under `LR` a contract edge does not rank
		 * anything, so two services in ONE environment land in the same
		 * column with `stacked` false — the library then loops the
		 * `Bottom`→`Top` route and drops its label inside a node. Seen in the
		 * film's own 06-dependencies take as a floating `ents`.
		 */
		const type = promotion ? 'smoothstep' : 'contractHop';
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
			// `contract`: the bare relationship name (`e.contract`, never the
			// constraint-bearing `label` text) — D-20 round 6's own trunk
			// bundling groups by this, in `GraphCanvasInner`'s `trunkKeyOf`, so
			// a provider's edges into DIFFERENT environments/components under
			// the SAME contract still read as one trunk, not one lane each.
			// `blocked`: D-20 round 7 — when a bundled trunk's branches carry
			// different constraint text, `GraphCanvasInner`'s own label-carrier
			// choice must prefer a BLOCKED one (the held constraint is the
			// most important text on the graph) over an open "payments" with
			// nothing to say. Read off the SAME `e.state` the stroke colour
			// and `contractLabel` already key on, never recomputed.
			data:
				type === 'contractHop'
					? {
							lane: contractLane.get(e.key) ?? 0,
							contract: e.contract ?? 'contract',
							blocked: e.state === 'blocked'
						}
					: undefined,
			/**
			 * ⭐ D-20b round 2 (coordinator decision) — NO EDGE EVER CARRIES
			 * TEXT, PERIOD. The constraint text used to live on the edge
			 * (one representative per provider/text group, R3's own fix for
			 * the worst of the pileups that caused) — but any edge label at
			 * all meant a placement problem on a canvas this dense, and
			 * label collisions never reached zero. A held constraint is now
			 * read at the CONSUMER node (`DependencyNode`'s own quiet
			 * second line, fed by `heldConstraints` below) and in the Held
			 * links rail, which already existed. The edge itself still
			 * carries the fact — `stroke`/`stroke-width` below — just never
			 * a string: held ink and weight for a blocked edge, quiet and
			 * thin for an open one, with no placement problem possible
			 * because there is no box to place.
			 */
			label: undefined,
			style: `stroke:${stroke};stroke-width:${ARROW[wireKind(e.state)].stroke};${
				e.cyclic ? 'stroke-dasharray:2 4;' : e.state === 'unknown' ? 'stroke-dasharray:4 3;' : ''
			}`,
			// The shared head (`$lib/graph-arrow`), defined once below. xyflow's
			// paths end AT the target, so this variant puts the TIP there.
			markerEnd: `${markerUid}-${wireKind(e.state)}`,
			ariaLabel: edgeSentence(e, nodeById),
			animated: false,
			selectable: false
		} satisfies Edge;
	}

	const flowEdges = $derived<Edge[]>(graph.edges.map(edgeOf));
	/**
	 * Only these advance a dagre rank. See `GraphCanvasInner.layoutEdges`.
	 *
	 * ⛔ 2026-10-09 · D-20 round 4 — THE ENV-TIER SPINE (round 3's
	 * `envSpineEdges`) IS GONE. It glued every disconnected chain into one
	 * shared dagre graph to force environment columns onto nodes with no
	 * promotion edge of their own, and the tech lead's own re-review traced
	 * two defects to exactly that gluing: a 24-node fleet drawing 1990px wide
	 * at 1024/1440/1920 (unrelated chains sharing one rank/row structure has
	 * no notion of "the row is already spent"), and dagre routing an edge
	 * from one chain through a NODE belonging to an entirely unrelated one.
	 * `GraphCanvasInner`'s own `packComponents` (its doc, beside
	 * `forceStackCeiling`) replaces the spine: it lays out each weakly
	 * connected component — union-find over `flowEdges`, so two nodes joined
	 * only by a CONTRACT edge still count as one cluster — on its own dagre
	 * pass and shelf-packs the results, so a node with no promotion edge
	 * simply renders whichever single-node column its own component's local
	 * ranking gives it, never sharing rank space with a chain it has nothing
	 * to do with.
	 */
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
	 * one.
	 *
	 * ⭐ 2026-09-03 · AND WHEN `anchor` HOLDS SOMEONE ELSE INSTEAD OF BEING
	 * HELD. Measured on `hello-api-app`'s own tab at 1024/1152: `anchor` is
	 * the PROVIDER, which has no inbound blocked edge at all (nothing holds
	 * IT back), so this used to fall through to `null` and the single-node
	 * `anchor` path — no promise that the consumer it is holding stays on
	 * screen. At 1024, measured, that clipped `hello-frontend-app` PROD by 3px
	 * off the pane's own right edge: the anchor itself rested inside the
	 * frame, satisfying the single-node rule to the letter, while the other
	 * half of the one relationship this page is ABOUT sat just past it.
	 * `outbound` is checked second, so a node that is BOTH held and holding
	 * (rare, but the promotion axis and the contract axis can both bite one
	 * node) keeps its inbound span — the row this reader is standing on beats
	 * the row it is blocking.
	 *
	 * `null` here (nothing on either edge is blocked, or there is no anchor)
	 * falls back to `GraphCanvasInner`'s single-node `anchor` path unchanged.
	 *
	 * ⭐ 2026-09-03 · THIRD RE-CHECK — AND EXTENDED TO THE FURTHEST COLUMN
	 * THE SAME STORY REACHES, ON THE OVERVIEW PAGE ONLY. The pair above is
	 * always SAME-COLUMN (a contract runs within one environment), so on
	 * `/dependencies` — no `focus`, `anchor` is just the first blocked node
	 * `orderedNodes` finds — the span this produces sits wherever that FIRST
	 * held column happens to be, which on the live fleet is DEV (held first
	 * in promotion order). When `hello-api-app` blocks `hello-frontend-app`
	 * in DEV *and* STAGING *and* PROD at once (the banner's own "in dev,
	 * staging and prod" sentence), the DEV pair being fully on screen proves
	 * nothing about PROD, which is the column most likely to run past the
	 * frame's right edge at the resting floor zoom — measured, 47px past it
	 * at 1024. `GraphCanvasInner`'s own subset-fit and rank-axis-pan both
	 * operate on WHATEVER two ids this returns; they do not know or care
	 * that a "column span" can cross ranks, so widening the pair here is
	 * sufficient — no change needed on that side.
	 *
	 * Extending is SAFE to skip whenever it does not apply: `sameStory` is
	 * only non-trivial when more than one node shares `anchorNode.name` and
	 * is ALSO blocked, which is exactly the multi-environment-hold shape.
	 * `focus` is left untouched — a rollout's own Dependencies tab already
	 * names the ONE environment the reader came for (`hello-api-app`'s own
	 * tab, PROD), and widening its own pair to reach past that would show
	 * the reader environments they did not ask about.
	 */
	const anchorSpan = $derived.by<[string, string] | null>(() => {
		if (!anchor) return null;
		const holding = (inbound.get(anchor) ?? []).find((e) => e.state === 'blocked');
		const held = !holding ? (outbound.get(anchor) ?? []).find((e) => e.state === 'blocked') : null;
		const near: [string, string] | null = holding
			? [holding.from, anchor]
			: held
				? [anchor, held.to]
				: null;
		if (!near || focus) return near;
		const anchorNode = nodeById.get(anchor);
		if (!anchorNode) return near;
		const sameStory = graph.nodes.filter((n) => n.name === anchorNode.name && n.blocked);
		if (sameStory.length <= 1) return near;
		const furthest = sameStory.reduce((f, n) => (n.envRank > f.envRank ? n : f));
		if (furthest.id === anchorNode.id || furthest.envRank <= anchorNode.envRank) return near;
		// Keep the PROVIDER end (`near[0]`) — the column span runs from where
		// the story starts to the furthest column it still holds.
		return [near[0], furthest.id];
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
	<!-- The shared arrowheads (`$lib/graph-arrow`): same shape, px size and inks
	     as the rollout tab's. Tip on the path's end (`refX` = the head's
	     length), because xyflow ends an edge's path at its target. -->
	<svg class="pointer-events-none absolute h-0 w-0" aria-hidden="true">
		<defs>
			{#each ['held', 'quiet'] as k (k)}
				{@const kk = k as 'held' | 'quiet'}
				<marker
					id="{markerUid}-{kk}"
					viewBox={ARROW_VIEWBOX}
					refX="10"
					refY="8"
					markerUnits="userSpaceOnUse"
					markerWidth={ARROW[kk].length}
					markerHeight={ARROW[kk].width}
					orient="auto"
				>
					<path d={ARROW_PATH} fill={kk === 'held' ? ink('blocked') : ink('quiet')} />
				</marker>
			{/each}
		</defs>
	</svg>
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
		snugFrame={!compact}
		snugHeight
		forceStackCeiling={compact ? null : FORCE_STACK_CEILING}
		onorientation={(o) => (stacked = o === 'TB')}
		{dark}
		ariaLabel="Dependency graph"
		class="canvas-dots rounded-md border border-line"
	/>
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

		⭐ 2026-09-18 · BELOW THE DRAWING NOW, NOT ABOVE IT — see the LEGEND
		doc comment beside `STACK_BELOW` further up this file for the full
		argument. In one line: this row used to width-sync to a narrowed,
		centred frame; the compact caller's frame no longer narrows, so a
		caption hanging above a centred figure in a sea of empty card was the
		"floating label" the human named. Left-aligned at the card body's own
		edge, below the figure, it reads as a caption should.

		⛔ AND IT IS LAID OUT AGAINST THE CARD, NOT AGAINST THE FRAME. That is
		only safe while the frame is at the card's full width, which is what
		`snugFrame={!compact}` buys. When the `TB` hook branch was still
		narrowing the frame behind that opt-out (fixed 2026-09-20), this row
		ran past the frame's right edge at every width below `STACK_BELOW` —
		the defect the opt-out existed to prevent, reappearing through the
		branch that ignored it.
	-->
	<p class="t-meta mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-fg-subtle">
		<span class="inline-flex items-center gap-1">
			<ChevronDoubleRightOutline class="h-3 w-3 shrink-0 {stacked ? 'rotate-90' : ''}" />
			environments
		</span>
		<span class="inline-flex items-center gap-1">
			<ShareNodesSolid class="h-3 w-3 shrink-0 {stacked ? '' : 'rotate-90'}" />
			services in one environment
		</span>
	</p>
{/if}
