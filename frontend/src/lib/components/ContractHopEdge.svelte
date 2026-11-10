<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE CONTRACT EDGE, UNDER `singleFile` ONLY — A HOOK IN THE RIGHT
	 * GUTTER, NEVER THROUGH THE COLUMN.
	 *
	 * (2026-09-03, a coordinator correction.) The library's own `smoothstep`
	 * routes a `Right`-out → `Left`-in edge by looping around whichever side
	 * gets there shorter — and in a ONE-NODE-WIDE column, "shorter" is
	 * frequently BEHIND the column, because the target's `Left` handle asks
	 * to be approached from the left of a box that has no left to approach
	 * from (its neighbour is directly above it, not beside it). Measured:
	 * the auto-routed path swung to x=-11 in graph space — off the left edge
	 * of the pane, under the whole stack, printing the label across a node
	 * border on its way back.
	 *
	 * So `DependencyNode` puts BOTH contract handles on the right under
	 * `singleFile` (see its own `contractIn` note), and this component draws
	 * the three-segment path that shape asks for: OUT of the source's right
	 * edge, DOWN (or up) a vertical channel parked in the gutter — past
	 * every node the span crosses, never through one — and back IN to the
	 * target's right edge. The label sits on the FIRST segment, the one that
	 * is never anything but gutter: it cannot land on a node border because
	 * that segment starts exactly where the node's own border already is
	 * and moves away from it.
	 *
	 * ⭐ `gutterX` IS COMPUTED BY THE CALLER, NOT GUESSED HERE. Clearing every
	 * node the vertical run passes — not just this edge's own two ends — needs
	 * the WIDEST node in the whole column, which only `GraphCanvasInner`'s
	 * layout effect knows (post-measurement). `data.gutterX` is that answer,
	 * already inclusive of the caller's own per-edge LANE stagger for when two
	 * hooks share the gutter. The fallback here (`sourceX`/`targetX` plus a
	 * flat margin) only fires before the first measured layout has run.
	 *
	 * ⚠️ RESIDUAL R3 (2026-09-18) — `labelY` BELOW IS PINNED TO `sourceY`,
	 * WHICH IS WHY A SHARED PROVIDER USED TO PRINT ITS LABEL N TIMES ON TOP
	 * OF ITSELF. A contract edge's `from` is the PROVIDER; a provider with N
	 * consumers is N edges that all share that one source node, so all N
	 * resolved to the identical `sourceY` here — measured on `payments-svc`'s
	 * neighbourhood as `payments` drawn five times, unreadable as
	 * `p p p p p payments`. NOT fixed in this component and NOT by moving
	 * `labelY` — that would break the "always gutter, never a node" guarantee
	 * this file exists for. Fixed one layer up, in `DependencyNetwork.svelte`
	 * (`labelledEdgeKeys`): the CALLER decides which edges carry text at all,
	 * the same place that already decides what the text SAYS
	 * (`contractLabel`). This component still draws every edge's own route
	 * and lane; it just receives `undefined` for `label` on all but one
	 * per (provider, text) group, so the shared position stops mattering —
	 * one label, drawn once, is legible wherever it lands.
	 */
	import { BaseEdge, getSmoothStepPath, Position, type EdgeProps } from '@xyflow/svelte';

	let {
		sourceX,
		sourceY,
		targetX,
		targetY,
		sourcePosition,
		targetPosition,
		label,
		labelStyle,
		style,
		markerEnd,
		markerStart,
		data
	}: EdgeProps = $props();

	const FALLBACK_GUTTER = 28;
	/**
	 * ⭐ THE HOOK IS ONE OF TWO SHAPES THIS COMPONENT DRAWS, AND `gutterX` IS
	 * THE DISCRIMINATOR. (2026-09-13.)
	 *
	 * `GraphCanvasInner` hands `gutterX` to a contract edge only where the
	 * hook applies — a `singleFile` `TB` column. Everywhere else this edge
	 * draws the LIBRARY'S OWN `smoothstep`, byte for byte the path the
	 * default edge type drew before this component took the type over, so
	 * switching every contract edge onto it (see `DependencyNetwork`'s
	 * `edgeOf`) changed no line on any canvas.
	 *
	 * ⛔ WHY TAKE THE TYPE OVER AT ALL, THEN: THE LABEL. The library places a
	 * `smoothstep` label at ITS OWN path centre, which is a point on the
	 * route — and a route that has to LOOP (a `Bottom`→`Top` pair whose
	 * target sits ABOVE its source, which is every contract edge between two
	 * services dagre stacked in one column) runs that centre straight
	 * THROUGH a node. Measured at the film's capture geometry (3840×2160 at
	 * `html{zoom:2}`, i.e. a 1920px layout, `/rollouts/.../dependencies`):
	 * the `payments` label landed at x 1140-1201 against a `checkout-api`
	 * node spanning 922-1174, so 34px of the word sat UNDER the node and the
	 * frame showed a floating `ents`. The label's position is therefore
	 * computed from the real node boxes by the one layer that has them (the
	 * layout effect, as `data.labelX`/`data.labelY`) and only read here.
	 */
	const hooked = $derived(typeof (data as { gutterX?: number } | undefined)?.gutterX === 'number');
	const gutterX = $derived.by(() => {
		const g = (data as { gutterX?: number } | undefined)?.gutterX;
		return typeof g === 'number' ? g : Math.max(sourceX, targetX) + FALLBACK_GUTTER;
	});

	/**
	 * ⭐ 2026-10-09 · D-20 round 5 — A THIRD SHAPE: AN ARBITRARY ORTHOGONAL
	 * `route`, FOR THE CROSS-COMPONENT GUTTER ROUTER.
	 *
	 * `GraphCanvasInner`'s packed `LR` layout (`packComponents`) now routes a
	 * contract edge between two different packed components through the
	 * shelf gutters rather than guessing a straight/smoothstep line across
	 * the whole canvas — see its own doc on `routeById`. `data.route` is
	 * that path's INTERMEDIATE turns only (the elbows between the fixed
	 * `sourceX,sourceY` and `targetX,targetY` endpoints this component
	 * already receives as props, same as the hooked case above never
	 * recomputing those either). A member of a bundled TRUNK — several
	 * edges sharing one provider into the same stacked column — gets the
	 * IDENTICAL leading points as its siblings and only its own final
	 * approach differs, so drawing each one's full route independently
	 * still reads as one shared line with short branches, with no special
	 * "trunk" rendering needed here.
	 */
	const routed = $derived(
		Array.isArray((data as { route?: { x: number; y: number }[] } | undefined)?.route)
	);
	/**
	 * ⭐ 2026-10-09 · D-20 round 6 — THE ROUTE'S OWN LAST POINT IS THE TRUE
	 * TERMINUS. NOTHING IS APPENDED AFTER IT.
	 *
	 * Round 5 always appended the library's raw `targetX`/`targetY` (the
	 * `Top`-handle coordinate every contract-in handle resolves to under
	 * `LR`) after this file's own waypoints — harmless when the route's own
	 * last point already equalled that handle, which it usually did not: a
	 * stacked-column entry deliberately approaches from the SIDE, so the
	 * extra forced segment from that side point up to the Top handle was a
	 * short, easy-to-miss dogleg whose own tangent is what `marker-end`
	 * actually orients on — stray arrowheads on node TOPS while the visible
	 * line entered from a side. `GraphCanvasInner` now computes every
	 * route's own last point to BE the real border the edge is meant to
	 * cross (`routeById`'s own doc), so trusting it completely, instead of
	 * re-deriving a second "real" endpoint here, is what makes the
	 * rendered arrow match the rendered line.
	 */
	const routePath = $derived.by(() => {
		const pts = (data as { route?: { x: number; y: number }[] } | undefined)?.route ?? [];
		const all = [{ x: sourceX, y: sourceY }, ...pts];
		return all.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
	});

	/**
	 * Three segments, square corners: OUT to the gutter, ALONG it, IN to the
	 * target. No corner rounding — the acceptance bar here is geometric (zero
	 * node intersections), not decorative, and a right-angle hook reads fine
	 * at this size.
	 */
	const hookPath = $derived(
		`M ${sourceX} ${sourceY} L ${gutterX} ${sourceY} L ${gutterX} ${targetY} L ${targetX} ${targetY}`
	);

	const smooth = $derived(
		getSmoothStepPath({
			sourceX,
			sourceY,
			targetX,
			targetY,
			sourcePosition: sourcePosition ?? Position.Bottom,
			targetPosition: targetPosition ?? Position.Top
		})
	);

	const path = $derived(routed ? routePath : hooked ? hookPath : smooth[0]);

	/**
	 * Hooked: the midpoint of the OUTBOUND segment only — always gutter,
	 * never a node. Routed: `GraphCanvasInner` already computed a
	 * collision-free point on the trunk's own longest shared segment
	 * (`routeById`'s own doc) — `undefined` on every edge but the one
	 * trunk member chosen to carry text, which `BaseEdge` reads as "no
	 * label" the same way an edge with no `label` prop already does.
	 * Otherwise the layout's own collision-free point, and the library's
	 * path centre only until the first measured layout has run.
	 */
	/**
	 * ⭐ D-20b — `hookLabelX`/`hookLabelY`, WHEN `GraphCanvasInner` HAS THEM,
	 * ARE A COLLISION-CHECKED POINT AND WIN OVER EVERYTHING ELSE BELOW —
	 * HOOKED OR NOT. See that file's own doc beside the mobile "R3 residual"
	 * fix: a `singleFile`/`TB` canvas now places EVERY labelled contract
	 * edge's text through one greedy pass, including an UNHOOKED edge
	 * (`crossesANode` false — nothing between the two boxes to route
	 * around) that used to fall straight through to the library's own
	 * unchecked `smoothstep` label position and could land on a node. Both
	 * shapes write the SAME two fields, so reading them first, before the
	 * `hooked`/`routed` branches below, is the one place this file has to
	 * agree with that decision. Every OTHER regime (`routed` — the
	 * cross-component trunk router — and an `LR` canvas with no `TB`
	 * mobile placement at all) never sets these fields, so this is a no-op
	 * there.
	 */
	const hookLabelX = $derived((data as { hookLabelX?: number } | undefined)?.hookLabelX);
	const hookLabelY = $derived((data as { hookLabelY?: number } | undefined)?.hookLabelY);
	const labelX = $derived.by(() => {
		if (routed) return (data as { routeLabelX?: number } | undefined)?.routeLabelX;
		if (typeof hookLabelX === 'number') return hookLabelX;
		if (hooked) return (sourceX + gutterX) / 2;
		const x = (data as { labelX?: number } | undefined)?.labelX;
		return typeof x === 'number' ? x : smooth[1];
	});
	const labelY = $derived.by(() => {
		if (routed) return (data as { routeLabelY?: number } | undefined)?.routeLabelY;
		if (typeof hookLabelY === 'number') return hookLabelY;
		if (hooked) return sourceY;
		const y = (data as { labelY?: number } | undefined)?.labelY;
		return typeof y === 'number' ? y : smooth[2];
	});
</script>

<BaseEdge {path} {labelX} {labelY} {label} {labelStyle} {markerStart} {markerEnd} {style} />
