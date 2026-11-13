<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE BEAD: a change's pill inside an env-row box. ONE pill, 20px tall at every size, state mark . #ref (or a count). The mark is
	 * the strip's own `WaveMark` (a dot in the state's tone, from view-models/state-tone.ts), never an icon: the same picture as the
	 * dots on the app page header and the Change page (2026-11-13). The old 8px per-family `step` meter (palette change rows) is gone;
	 * the palette draws `WaveMark` too. Failing = danger tint, waiting-for-you = held tint, the rest surface (dark: ground) so a bead
	 * always sits one step off the box it is in. Model + grouping: `view-models/bead.ts`.
	 */
	import type { Bead } from '$lib/view-models/bead';
	import WaveMark from '$lib/components/WaveMark.svelte';
	import { waveMark, type MarkSiteState } from '$lib/view-models/wave-mark';

	let { bead }: { bead: Bead } = $props();
	const SITE: Record<Exclude<Bead['state'], 'landed'>, MarkSiteState> = { failed: 'failed', held: 'held', deploying: 'deploying', checking: 'checking', healthy: 'done', 'approval-yours': 'approval-yours', approval: 'approval' };
</script>

<svelte:element
	this={bead.href ? 'a' : 'span'}
	class="cd-bead cd-bead--{bead.emphasis || 'plain'}"
	class:cd-bead--nomark={bead.state === 'landed'}
	href={bead.href}
	title={bead.title}
	data-bead={bead.state}
>
	{#if bead.state !== 'landed'}<WaveMark mark={waveMark([{ state: SITE[bead.state] }])} />{/if}
	{#if bead.count !== null}<span class="cd-x">{bead.count}</span>
	{:else}{#each bead.refs as r (r)}<span>{r}</span>{/each}{#if bead.more}<span class="cd-x">+{bead.more}</span>{/if}{/if}
</svelte:element>

<style>
	.cd-bead {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		padding: 0 7px 0 3px;
		border-radius: 10px;
		background: var(--k-surface);
		font: 400 12px/16px var(--font-mono, ui-monospace, monospace);
		color: var(--k-fg-muted);
		white-space: nowrap;
	}
	:global(.dark) .cd-bead { background: var(--k-ground); }
	.cd-bead--nomark { padding-left: 7px; }
	a.cd-bead:hover { background: var(--k-hover); color: var(--k-fg); }
	.cd-x { font-family: var(--font-sans, inherit); color: var(--k-fg-subtle); font-weight: 500; }
	.cd-bead--failed { background: color-mix(in srgb, var(--k-danger-tint) 45%, var(--k-surface)); color: var(--k-fg); }
	:global(.dark) .cd-bead--failed { background: var(--k-danger-tint); }
	.cd-bead--yours { background: var(--k-held-tint); color: var(--k-fg); }
</style>
