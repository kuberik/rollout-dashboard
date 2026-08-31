<svelte:options runes={true} />

<script lang="ts">
	/**
	 * The provider wrapper for `GraphCanvasInner`.
	 *
	 * `useSvelteFlow()` reads a context that `<SvelteFlow>` publishes, so a
	 * component that both RENDERS the flow and calls the hook has to sit inside
	 * a `SvelteFlowProvider`. That is the only reason this file exists, and it
	 * is also the one place the library's stylesheet is imported so no caller
	 * has to remember to.
	 */
	import { SvelteFlowProvider, type Node, type Edge, type NodeTypes } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import GraphCanvasInner from '$lib/components/GraphCanvasInner.svelte';

	type Props = {
		nodes: Node[];
		edges: Edge[];
		/** Rank-advancing edges only, when that is not every drawn edge. */
		layoutEdges?: Edge[] | null;
		nodeTypes: NodeTypes;
		rankdir?: 'LR' | 'TB' | 'auto';
		stackBelow?: number;
		nodesep?: number;
		ranksep?: number;
		fallbackNodeWidth?: number;
		fallbackNodeHeight?: number;
		height?: number | null;
		minHeight?: number;
		maxHeight?: number;
		interaction?: 'static' | 'auto';
		controls?: boolean;
		minimapFrom?: number | null;
		dark?: boolean;
		ariaLabel?: string;
		/** The node the resting view must land on when the drawing overflows. */
		anchor?: string | null;
		/** The `LR`/`TB` this canvas settled on, for a caller that names axes. */
		onorientation?: ((o: 'LR' | 'TB') => void) | undefined;
		class?: string;
	};

	let props: Props = $props();
</script>

<SvelteFlowProvider>
	<GraphCanvasInner {...props} />
</SvelteFlowProvider>
