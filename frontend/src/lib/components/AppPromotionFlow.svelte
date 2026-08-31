<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE PROMOTION FLOW — one environment per node, in promotion order.
	 *
	 * ⚠️ NOT CURRENTLY MOUNTED. This was the promotion strip on `/apps/[name]`
	 * from `fb58dc5` until `5d00de0` rebuilt that page around a
	 * `PromotionPipeline` card. It is kept because it works and because its
	 * SvelteFlow + dagre mechanics are what `GraphCanvas` was extracted from —
	 * it is now a caller of that canvas rather than a second copy of it.
	 *
	 * The strip is DELIBERATELY INERT: a fixed row of environments is not a
	 * network, there is nothing off-frame to pan to, and dragging a node would
	 * destroy the one thing its position means. Hence `interaction="static"`,
	 * no controls, no minimap, and a `height` the caller computes rather than
	 * one fitted to content.
	 */
	import { compareRollouts, detectStuck, detectStuckBehind } from '$lib/utils';
	import { MarkerType, type Node, type Edge } from '@xyflow/svelte';
	import GraphCanvas from '$lib/components/GraphCanvas.svelte';
	import PromotionNode from '$lib/components/PromotionNode.svelte';
	import { theme } from '$lib/stores/theme';
	import { now } from '$lib/stores/time';
	import type { Rollout, Environment } from '../../types';
	import type { getRolloutEnvironmentTheme } from '$lib/environment-theme';

	type Cell = {
		envName: string;
		envLabel: string;
		environment: Environment;
		rollout: Rollout | null;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
	};

	let {
		cells,
		hasEnvironmentBinding = true
	}: { cells: Cell[]; hasEnvironmentBinding?: boolean } = $props();

	const nodeTypes = { promotion: PromotionNode };

	const NODE_WIDTH = 216;
	const NODE_HEIGHT = 148;

	const nodes = $derived<Node[]>(
		cells.map((c, i) => {
			const href = c.rollout
				? `/rollouts/${c.rollout.metadata?.namespace}/${c.rollout.metadata?.name}`
				: null;
			let stuck = c.rollout ? detectStuck(c.rollout, { now: $now }) : null;
			if (!stuck && c.rollout) {
				for (const peer of cells) {
					if (peer === c || !peer.rollout) continue;
					const r = detectStuckBehind(c.rollout, peer.rollout, peer.envName, { now: $now });
					if (r) {
						stuck = r;
						break;
					}
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
					showHandles: { source: i < cells.length - 1, target: i > 0 }
				},
				selectable: false,
				draggable: false
			} satisfies Node;
		})
	);

	const edges = $derived<Edge[]>(
		hasEnvironmentBinding
			? cells.slice(0, -1).map((a, i) => {
					const b = cells[i + 1];
					const rel = compareRollouts(a.rollout, b.rollout);
					const stroke = !rel
						? '#9ca3af'
						: rel.kind === 'same'
							? '#008236'
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
					return {
						id: `e${i}-${i + 1}`,
						source: `n${i}`,
						target: `n${i + 1}`,
						type: 'smoothstep',
						animated: rel?.kind === 'behind',
						label,
						labelStyle: `font-size: 10px; font-weight: 600; fill: ${stroke};`,
						style: `stroke: ${stroke}; stroke-width: 2; ${
							!rel || rel.kind === 'divergent' ? 'stroke-dasharray: 4 4;' : ''
						}`,
						markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: stroke }
					} satisfies Edge;
				})
			: []
	);

	/**
	 * `GraphCanvas` flips to `TB` below 620px, so the frame has to grow the
	 * same way: one row of nodes wide, or a stack of them tall.
	 */
	let viewportWidth = $state(1440);
	const height = $derived(
		viewportWidth < 620 ? cells.length * (NODE_HEIGHT + 40) + 40 : NODE_HEIGHT + 60
	);
</script>

<svelte:window bind:innerWidth={viewportWidth} />

<GraphCanvas
	{nodes}
	{edges}
	{nodeTypes}
	rankdir="auto"
	stackBelow={620}
	ranksep={70}
	nodesep={24}
	fallbackNodeWidth={NODE_WIDTH}
	fallbackNodeHeight={NODE_HEIGHT}
	{height}
	interaction="static"
	controls={false}
	minimapFrom={null}
	dark={$theme === 'dark'}
	ariaLabel="Promotion flow"
	class="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
/>
