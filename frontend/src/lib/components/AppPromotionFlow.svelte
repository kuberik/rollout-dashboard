<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteFlow, Background, type Node, type Edge } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import * as dagre from '@dagrejs/dagre';
	import PromotionNode from '$lib/components/PromotionNode.svelte';
	import { compareRollouts, detectStuck, detectStuckBehind } from '$lib/utils';
	import type { Rollout, Environment } from '../../types';
	import { now } from '$lib/stores/time';
	import type { getRolloutEnvironmentTheme } from '$lib/environment-theme';

	type Cell = {
		envName: string;
		envLabel: string;
		environment: Environment;
		rollout: Rollout | null;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
	};

	let { cells, hasEnvironmentBinding = true }: { cells: Cell[]; hasEnvironmentBinding?: boolean } = $props();

	const nodeTypes = { promotion: PromotionNode };

	const NODE_WIDTH = 224;
	const NODE_HEIGHT = 160;

	let orientation = $state<'LR' | 'TB'>('LR');
	let containerEl = $state<HTMLDivElement | null>(null);

	function pickOrientation() {
		if (typeof window === 'undefined') return;
		orientation = window.matchMedia?.('(max-width: 640px)').matches ? 'TB' : 'LR';
	}

	onMount(() => {
		pickOrientation();
		const mq = window.matchMedia?.('(max-width: 640px)');
		mq?.addEventListener?.('change', pickOrientation);
		return () => mq?.removeEventListener?.('change', pickOrientation);
	});

	// Build base nodes + edges from cells; then run dagre to position.
	const layout = $derived.by<{ nodes: Node[]; edges: Edge[] }>(() => {
		if (cells.length === 0) return { nodes: [], edges: [] };

		const baseNodes: Node[] = cells.map((c, i) => {
			const href = c.rollout
				? `/rollouts/${c.rollout.metadata?.namespace}/${c.rollout.metadata?.name}`
				: null;
			// Determine if this cell is stuck relative to peers (cross-env) or by itself.
			let stuck = c.rollout ? detectStuck(c.rollout, { now: $now }) : null;
			if (!stuck && c.rollout) {
				for (const peer of cells) {
					if (peer === c || !peer.rollout) continue;
					const r = detectStuckBehind(c.rollout, peer.rollout, peer.envName, { now: $now });
					if (r) { stuck = r; break; }
				}
			}
			return {
				id: `n${i}`,
				type: 'promotion',
				position: { x: 0, y: 0 },
				data: {
					rollout: c.rollout,
					envName: c.envName,
					envLabel: c.envLabel,
					theme: c.theme,
					href,
					stuck,
					showHandles: { source: i < cells.length - 1, target: i > 0 },
					orientation
				},
				selectable: false,
				draggable: false
			};
		});

		const baseEdges: Edge[] = [];
		if (hasEnvironmentBinding) {
			for (let i = 0; i < cells.length - 1; i++) {
				const a = cells[i];
				const b = cells[i + 1];
				const rel = compareRollouts(a.rollout, b.rollout);
				const stroke = !rel
					? 'rgb(209 213 219)'
					: rel.kind === 'same'
						? 'rgb(74 222 128)'
						: rel.kind === 'ahead'
							? 'rgb(16 185 129)'
							: rel.kind === 'behind'
								? 'rgb(251 146 60)'
								: 'rgb(156 163 175)';
				const label = !rel
					? '—'
					: rel.kind === 'same'
						? 'in sync'
						: rel.kind === 'ahead'
							? `+${rel.by ?? '?'}`
							: rel.kind === 'behind'
								? `−${rel.by ?? '?'}`
								: 'diverged';
				baseEdges.push({
					id: `e${i}-${i + 1}`,
					source: `n${i}`,
					target: `n${i + 1}`,
					type: 'smoothstep',
					animated: rel?.kind === 'behind',
					label,
					labelStyle: `font-size: 10px; font-weight: 600; fill: ${stroke};`,
					style: `stroke: ${stroke}; stroke-width: 2; ${!rel || rel.kind === 'divergent' ? 'stroke-dasharray: 4 4;' : ''}`
				} as Edge);
			}
		}

		// Dagre layout
		const g = new dagre.graphlib.Graph();
		g.setDefaultEdgeLabel(() => ({}));
		g.setGraph({
			rankdir: orientation,
			nodesep: 24,
			ranksep: 60,
			marginx: 16,
			marginy: 16
		});
		for (const n of baseNodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
		for (const e of baseEdges) g.setEdge(e.source, e.target);
		dagre.layout(g);

		const nodes = baseNodes.map((n) => {
			const p = g.node(n.id);
			return {
				...n,
				position: { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 }
			};
		});

		return { nodes, edges: baseEdges };
	});

	const flowNodes = $derived(layout.nodes);
	const flowEdges = $derived(layout.edges);

	// Approximate canvas height so the flow fits without vertical scroll
	// inside the page. Horizontal layout: a single row; vertical layout:
	// stacked.
	const canvasHeight = $derived(
		orientation === 'LR' ? NODE_HEIGHT + 80 : cells.length * (NODE_HEIGHT + 60) + 60
	);
</script>

<div
	bind:this={containerEl}
	class="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800/40"
	style="height: {canvasHeight}px"
>
	<SvelteFlow
		nodes={flowNodes}
		edges={flowEdges}
		{nodeTypes}
		fitView
		fitViewOptions={{ padding: 0.15 }}
		proOptions={{ hideAttribution: true }}
		nodesDraggable={false}
		nodesConnectable={false}
		elementsSelectable={false}
		panOnDrag={true}
		zoomOnScroll={false}
		zoomOnPinch
		minZoom={0.5}
		maxZoom={1.5}
	>
		<Background bgColor="transparent" patternColor="rgb(229 231 235)" gap={20} />
	</SvelteFlow>
</div>
