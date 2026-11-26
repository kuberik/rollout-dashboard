<svelte:options runes={true} />

<script lang="ts">
	/**
	 * WHAT AN AUTOMATIC ROLLBACK DID, READ AT A GLANCE (auto-rollback preview).
	 * Role: the body of every rollback banner: one chip row that draws the shaped fact (`failed build ⇢ running build`, plus
	 * one state word such as Held or Not rolled back), then at most one short line. Test rows and reasons go behind the
	 * banner's Details, never here. Owner rule (2026-11-26, glanceable UI): headline + one line of 12 words or fewer, facts
	 * drawn as chips and arrows, one word per state, each fact once.
	 * Structure is the contract the rollback-dependency banners share: headline (the panel's title) / chip row / one line /
	 * Details (the panel's footnote).
	 * Built from: `Chip` (the one chip; `issue` = failed, `ready` = running, `held` = the hold), no new geometry.
	 */
	import { ArrowRightOutline } from 'flowbite-svelte-icons';
	import Chip from './Chip.svelte';

	type State = { role: 'held' | 'issue' | 'unranked' | 'ready'; label: string; title?: string };

	let {
		from = null,
		to = null,
		states = [],
		line = ''
	}: {
		/** the build that failed (drawn `Failed · <build>`) */
		from?: string | null;
		/** the build running now (drawn `Running · <build>` after an arrow) */
		to?: string | null;
		/** one word each: Held, Not rolled back, ... */
		states?: State[];
		/** at most one short line (12 words or fewer) */
		line?: string;
	} = $props();
</script>

<div class="flex min-w-0 flex-col gap-1.5" data-rollback-glance>
	{#if from || to || states.length > 0}
		<div class="flex min-w-0 flex-wrap items-center gap-1.5" data-glance-chips>
			{#if from}<Chip role="issue" label="Failed" value={from} valueIsBuild={false} />{/if}
			{#if from && to}<ArrowRightOutline class="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-label="replaced by" />{/if}
			{#if to}<Chip role="ready" label="Running" value={to} valueIsBuild={false} />{/if}
			{#each states as s (s.label)}<Chip role={s.role} label={s.label} title={s.title} wide />{/each}
		</div>
	{/if}
	{#if line}<p class="min-w-0 text-fg [overflow-wrap:anywhere]" data-glance-line>{line}</p>{/if}
</div>
