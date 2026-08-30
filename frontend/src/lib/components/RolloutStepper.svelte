<svelte:options runes={true} />

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { PipelineSummary, StageState } from '$lib/pipeline';

	// Segmented-meter pipeline glyph (mockup's "Segmented meter" style): every
	// pipeline stage (trigger + each track's steps + bake) becomes one segment
	// of a full-width progress meter. Segments are fungible progress — completed
	// first, then failing, then in-flight, then remaining — with a caption row
	// summarising how far the rollout has advanced. Driven by real derivePipeline
	// data. An optional `trailing` snippet renders at the right of the caption
	// row (e.g. the version + an action button on the needs-you cards).
	let {
		summary,
		triggered = true,
		trailing
	}: { summary: PipelineSummary; triggered?: boolean; trailing?: Snippet } = $props();

	type Seg = 'done' | 'fail' | 'active' | 'todo';
	function norm(s: StageState): Seg {
		if (s === 'done') return 'done';
		if (s === 'fail') return 'fail';
		if (s === 'active') return 'active';
		return 'todo'; // pending / cancelled
	}

	const meter = $derived.by(() => {
		const all: Seg[] = [
			triggered ? 'done' : 'todo',
			...summary.tracks.flatMap((t) => t.stages.map(norm)),
			norm(summary.bake)
		];
		const total = all.length;
		const doneN = all.filter((s) => s === 'done').length;
		const failN = all.filter((s) => s === 'fail').length;
		const activeN = all.filter((s) => s === 'active').length;
		const todoN = total - doneN - failN - activeN;
		const ordered: Seg[] = [
			...Array<Seg>(doneN).fill('done'),
			...Array<Seg>(failN).fill('fail'),
			...Array<Seg>(activeN).fill('active'),
			...Array<Seg>(todoN).fill('todo')
		];
		const cap = activeN
			? `${activeN} rolling out`
			: failN
				? `${failN} failing`
				: doneN === total
					? 'complete'
					: `${doneN}/${total} done`;
		// Keep colour only for the one thing worth shouting — failures. The
		// meter bar already carries deploying/baking/complete colour, so the
		// caption text stays neutral otherwise.
		const capTone = failN ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400';
		return { ordered, total, doneN, cap, capTone };
	});

	// When the bake stage is the active one, the rollout is baking → the
	// live segments read yellow; otherwise it's deploying → blue.
	const isBaking = $derived(norm(summary.bake) === 'active');

	function segCls(s: Seg): string {
		switch (s) {
			case 'done':
				return 'bg-green-700 dark:bg-green-400';
			case 'fail':
				return 'bg-red-500';
			case 'active':
				return isBaking ? 'bg-yellow-400 animate-pulse' : 'bg-blue-500 animate-pulse';
			default:
				return 'bg-gray-200 dark:bg-gray-700';
		}
	}
</script>

<div class="min-w-0" aria-label="Deploy pipeline">
	<div class="flex gap-0.5">
		{#each meter.ordered as s, i (i)}
			<span class="h-1.5 flex-1 rounded-sm {segCls(s)}"></span>
		{/each}
	</div>
	<div class="mt-1.5 flex items-center gap-2 text-[10px] leading-none">
		<span class="shrink-0 text-gray-500 dark:text-gray-400">{meter.doneN}/{meter.total} stages done</span>
		{#if trailing}
			<span class="shrink-0 font-medium {meter.capTone}">{meter.cap}</span>
			<span class="ml-auto flex shrink-0 items-center gap-2">{@render trailing()}</span>
		{:else}
			<span class="ml-auto shrink-0 font-medium {meter.capTone}">{meter.cap}</span>
		{/if}
	</div>
</div>
