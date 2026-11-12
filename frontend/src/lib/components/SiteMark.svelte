<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE SITE'S MARK in the environment strip and its site picker (change-strip r1). A 16px slot, the Stages tiles' family:
	 * reached / healthy = the tabs' rest dot (RestGlyph: 6px success-solid; owner 2026-11-12 "it doesn't show green on deployed"), not reached = EmptyGlyph's dashed 8px ring in fg-subtle (AD strip r1: line-strong was 1.33:1 on the light box), not affected = a 6px line dot,
	 * anything that needs reading = StatusMark (failed is the one solid disc). Width never depends on the state.
	 */
	import StatusMark from './StatusMark.svelte';

	export type SiteState = 'done' | 'checking' | 'deploying' | 'held' | 'approval' | 'failed' | 'stuck' | 'notreached' | 'notaffected';
	let { state }: { state: SiteState } = $props();
</script>

<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
	{#if state === 'done'}<span class="h-1.5 w-1.5 rounded-full bg-success-solid"></span>
	{:else if state === 'notreached'}<span class="h-2 w-2 rounded-full border border-dashed border-fg-subtle"></span>
	{:else if state === 'notaffected'}<span class="h-1.5 w-1.5 rounded-full bg-line-strong"></span>
	{:else if state === 'approval'}<StatusMark state="approval" tone="held" />
	{:else}<StatusMark {state} />{/if}
</span>
