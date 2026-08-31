<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE SERVICE, on the dependency canvas.
	 *
	 * ⭐ THE BOX SIZES ITSELF. The hand-rolled layout this replaces had to
	 * ESTIMATE the box width from the longest name at 7.7px per character —
	 * a number read off the browser because the first guess (7.3) truncated
	 * `hello-frontend-app`, the exact name the widening existed for. Svelte
	 * Flow measures the rendered node and hands dagre the real number, so the
	 * estimate is gone: `w-max` between a floor and a ceiling, and the layout
	 * is laid out around whatever the type engine actually produced.
	 *
	 * ⛔ ALMOST NOTHING SPENDS COLOUR. `Satisfied=True` is the norm on every
	 * gate on the live cluster and the product does not draw the norm, so an
	 * unheld service is a plain card. A HELD one is RED — `Chip`'s own
	 * reasoning for the `blocked` role, written for this page: amber means
	 * `stuck` and nothing else, and a gate correctly refusing a candidate is
	 * not a stoppage.
	 */
	import type { Component } from 'svelte';
	import { Handle, Position } from '@xyflow/svelte';
	import { ServerSolid, QuestionCircleOutline } from 'flowbite-svelte-icons';
	import Chip from '$lib/components/Chip.svelte';
	import type { DependencyNodeData } from '$lib/components/dependency-node-data';

	let { data }: { data: DependencyNodeData } = $props();

	const Icon = $derived<Component>(data.unresolved ? QuestionCircleOutline : ServerSolid);
	const linked = $derived(Boolean(data.href) && !data.unresolved);
	const sourcePos = $derived(data.orientation === 'TB' ? Position.Bottom : Position.Right);
	const targetPos = $derived(data.orientation === 'TB' ? Position.Top : Position.Left);
</script>

<!--
	The handles are the anchor points the library routes edges to. They carry no
	meaning of their own here — nothing is connectable — so they are invisible
	and inert, and the arrowhead is the only thing that lands on the border.
-->
<Handle type="target" position={targetPos} class="!pointer-events-none !opacity-0" />
<Handle type="source" position={sourcePos} class="!pointer-events-none !opacity-0" />

<svelte:element
	this={linked ? 'a' : 'div'}
	href={linked ? data.href : undefined}
	title={data.title}
	class="flex w-max min-w-[168px] max-w-[300px] flex-col justify-center gap-0.5 rounded-lg border px-3 py-2 transition-colors
		{data.blocked
		? 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/40'
		: data.unresolved
			? 'border-dashed border-gray-300 bg-gray-50 dark:border-gray-600 dark:bg-gray-800/50'
			: 'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800'}
		{linked ? 'cursor-pointer hover:border-gray-400 dark:hover:border-gray-500' : ''}
		{data.focused ? 'ring-2 ring-gray-900/70 dark:ring-white/70' : ''}"
>
	<span class="flex min-w-0 items-center gap-1.5">
		<Icon
			class="h-4 w-4 shrink-0 {data.blocked
				? 'text-red-600 dark:text-red-400'
				: 'text-gray-400 dark:text-gray-500'}"
		/>
		<span class="min-w-0 truncate text-[13px] font-semibold text-gray-900 dark:text-white"
			>{data.name}</span
		>
		{#if data.blocked}
			<!-- The MARK on the name line, the WHERE on the line under it.
			     Folding both into one chip truncated to `DEV · STAGING · P…`,
			     which loses the environment that matters most. -->
			<span class="ml-auto shrink-0 pl-1"><Chip role="blocked" label="held" /></span>
		{/if}
	</span>
	<span
		class="t-micro min-w-0 truncate pl-[22px] {data.blocked
			? 'text-red-700 dark:text-red-400'
			: 'text-gray-500 dark:text-gray-400'}">{data.meta}</span
	>
</svelte:element>
