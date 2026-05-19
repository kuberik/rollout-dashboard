<svelte:options runes={true} />

<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteFlow, Background, useSvelteFlow, type Node, type Edge } from '@xyflow/svelte';
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

	const NODE_WIDTH = 216;
	const NODE_HEIGHT = 148;

	let containerEl = $state<HTMLDivElement | null>(null);
	let orientation = $state<'LR' | 'TB'>('LR');

	function pickOrientation(width: number) {
		// Below ~620px, stack vertically. Otherwise lay out left→right.
		orientation = width < 620 ? 'TB' : 'LR';
	}

	const { fitView } = useSvelteFlow();

	$effect(() => {
		if (!containerEl) return;
		pickOrientation(containerEl.clientWidth);
		const ro = new ResizeObserver((entries) => {
			for (const entry of entries) {
				pickOrientation(entry.contentRect.width);
			}
			requestAnimationFrame(() => fitView({ duration: 150, padding: 0.18 }));
		});
		ro.observe(containerEl);
		return () => ro.disconnect();
	});

	// Build base nodes + edges from cells; then run dagre to position.
	const layout = $derived.by<{ nodes: Node[]; edges: Edge[] }>(() => {
		if (cells.length === 0) return { nodes: [], edges: [] };

		const baseNodes: Node[] = cells.map((c, i) => {
			const href = c.rollout
				? `/rollouts/${c.rollout.metadata?.namespace}/${c.rollout.metadata?.name}`
				: null;
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
					? '#9ca3af'
					: rel.kind === 'same'
						? '#22c55e'
						: rel.kind === 'ahead'
							? '#10b981'
							: rel.kind === 'behind'
								? '#f97316'
								: '#9ca3af';
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

		const g = new dagre.graphlib.Graph();
		g.setDefaultEdgeLabel(() => ({}));
		g.setGraph({
			rankdir: orientation,
			nodesep: orientation === 'TB' ? 30 : 24,
			ranksep: orientation === 'TB' ? 50 : 70,
			marginx: 12,
			marginy: 12
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

	// Re-fit when layout changes (orientation flip, cells change)
	$effect(() => {
		// touch dependencies
		flowNodes.length;
		orientation;
		requestAnimationFrame(() => fitView({ duration: 150, padding: 0.18 }));
	});

	// Canvas height: in TB mode we stack — grow vertically; in LR mode
	// a single row of nodes with edge labels above/below — fixed height.
	const canvasHeight = $derived(
		orientation === 'LR'
			? NODE_HEIGHT + 60
			: cells.length * (NODE_HEIGHT + 40) + 40
	);
</script>

<div
	bind:this={containerEl}
	class="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
	style="height: {canvasHeight}px"
>
	<SvelteFlow
		nodes={flowNodes}
		edges={flowEdges}
		{nodeTypes}
		fitView
		fitViewOptions={{ padding: 0.18 }}
		proOptions={{ hideAttribution: true }}
		nodesDraggable={false}
		nodesConnectable={false}
		elementsSelectable={false}
		panOnDrag={false}
		panOnScroll={false}
		zoomOnScroll={false}
		zoomOnPinch={false}
		zoomOnDoubleClick={false}
		preventScrolling={false}
	>
		<Background bgColor="transparent" patternColor="rgb(148 163 184 / 0.25)" gap={18} size={1} />
	</SvelteFlow>
</div>
