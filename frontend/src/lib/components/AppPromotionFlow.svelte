<svelte:options runes={true} />

<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import AppPromotionFlowCanvas from '$lib/components/AppPromotionFlowCanvas.svelte';
	import type { Rollout, Environment } from '../../types';
	import type { getRolloutEnvironmentTheme } from '$lib/environment-theme';

	type Cell = {
		envName: string;
		envLabel: string;
		environment: Environment;
		rollout: Rollout | null;
		theme: ReturnType<typeof getRolloutEnvironmentTheme> | null;
	};

	let { cells, hasEnvironmentBinding = true }: { cells: Cell[]; hasEnvironmentBinding?: boolean } = $props();
</script>

<SvelteFlowProvider>
	<AppPromotionFlowCanvas {cells} {hasEnvironmentBinding} />
</SvelteFlowProvider>
