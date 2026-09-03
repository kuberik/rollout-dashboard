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
	import { BaseEdge, type EdgeProps } from '@xyflow/svelte';

	let { sourceX, sourceY, targetX, targetY, label, labelStyle, style, markerEnd, markerStart, data }: EdgeProps =
		$props();

	const FALLBACK_GUTTER = 28;
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
	const path = $derived(
		`M ${sourceX} ${sourceY} L ${gutterX} ${sourceY} L ${gutterX} ${targetY} L ${targetX} ${targetY}`
	);

	/** Midpoint of the OUTBOUND segment only — always gutter, never a node. */
	const labelX = $derived((sourceX + gutterX) / 2);
	const labelY = $derived(sourceY);
</script>

<BaseEdge {path} {labelX} {labelY} {label} {labelStyle} {markerStart} {markerEnd} {style} />
