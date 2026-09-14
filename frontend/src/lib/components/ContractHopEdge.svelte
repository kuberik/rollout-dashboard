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

	const path = $derived(hooked ? hookPath : smooth[0]);

	/**
	 * Hooked: the midpoint of the OUTBOUND segment only — always gutter,
	 * never a node. Otherwise the layout's own collision-free point, and the
	 * library's path centre only until the first measured layout has run.
	 */
	const labelX = $derived.by(() => {
		if (hooked) return (sourceX + gutterX) / 2;
		const x = (data as { labelX?: number } | undefined)?.labelX;
		return typeof x === 'number' ? x : smooth[1];
	});
	const labelY = $derived.by(() => {
		if (hooked) return sourceY;
		const y = (data as { labelY?: number } | undefined)?.labelY;
		return typeof y === 'number' ? y : smooth[2];
	});
</script>

<BaseEdge {path} {labelX} {labelY} {label} {labelStyle} {markerStart} {markerEnd} {style} />
