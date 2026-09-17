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

	/**
	 * ⛔ TWO HOPS LEAVING ONE NODE PRINTED THEIR LABELS ON TOP OF EACH OTHER.
	 * (2026-09-10) `labelY` was `sourceY` for every edge and `labelX` is the
	 * midpoint of the outbound segment, so the ONLY thing separating two
	 * labels that share a source was the caller's lane stagger — and that
	 * stagger is `LANE_GAP` (20px) on `gutterX`, which a MIDPOINT halves to
	 * 10px. Against a label like `opencode-manager` (~120px at 11/400) 10px
	 * is nothing: measured on the rollout Dependencies tab at 390 and 768,
	 * two `opencode-manager` labels overlapped by 90% and rendered as one
	 * illegible smear.
	 *
	 * The gutter has vertical room and nothing else in it, so the labels
	 * separate along Y — one label row per lane. Lane 0 is byte-identical to
	 * before, so the ordinary single-hop graph does not move; only the
	 * additional hops that were colliding step down. `LABEL_ROW` is the 11px
	 * label's own line box plus a hair, so two rows read as two rows.
	 *
	 * ⚠️ NOT a bigger `LANE_GAP`: that gap sizes the vertical CHANNELS, where
	 * 20px is already right for a 2px stroke. Widening it to clear a label
	 * would push the whole gutter out and shrink the drawing for a reason
	 * that has nothing to do with the paths.
	 */
	const LABEL_ROW = 15;
	const lane = $derived.by(() => {
		const l = (data as { lane?: number } | undefined)?.lane;
		return typeof l === 'number' && l > 0 ? l : 0;
	});

	/** Midpoint of the OUTBOUND segment only — always gutter, never a node. */
	const labelX = $derived((sourceX + gutterX) / 2);
	const labelY = $derived(sourceY + lane * LABEL_ROW);
</script>

<BaseEdge {path} {labelX} {labelY} {label} {labelStyle} {markerStart} {markerEnd} {style} />
