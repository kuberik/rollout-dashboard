<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ENVIRONMENT STATE LINE + BAR (r39 kit parts/envtile.js `envStateLine` + `envBar`), extracted from EnvTile so the Environments tile and the
	 * single Environment page's header draw the SAME two lines: ONE state line (the worst fact leads in its ink, the rest muted, on a 16px mark
	 * column) and ONE proportional bar (one fill per state, healthy neutral). Nothing is decided here: the model is environments-page.ts.
	 */
	import { hueInk } from '$lib/view-models/state-tone';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import { barSegments, type EnvTile } from './environments-page';

	let { tile }: { tile: Pick<EnvTile, 'mark' | 'lead' | 'parts' | 'calm' | 'label' | 'failing' | 'waiting' | 'moving' | 'rest'> } = $props();
	const segs = $derived(barSegments(tile));
</script>

<p class="et-state t-meta">
	<span class="et-mk">
		{#if tile.mark === 'rest'}<StatusMark state="newest" />
		{:else if tile.mark === 'approval-yours'}<StatusMark state="approval" tone="held" />
		{:else if tile.mark === 'approval'}<StatusMark state="approval" tone="neutral" />
		{:else}<StatusMark state={tile.mark} />{/if}
	</span>
	<span class="et-lead {hueInk(tile.lead.ink)}" data-truth="state-lead">{tile.lead.text}{#if tile.lead.you}{' '}<span class="text-held">({tile.lead.you})</span>{/if}</span>
	{#if tile.parts.length}<span class="et-rest">{#each tile.parts as p, i (i)}{#if i}<span aria-hidden="true">{' · '}</span>{/if}{p.text}{#if p.you}{' '}<span class="text-held">({p.you})</span>{/if}{/each}</span>{/if}
</p>

<div class="et-bar" class:ok={tile.calm} role="img" aria-label={tile.label}>
	{#each segs as s (s.k)}<i class={s.k} style="--g:{s.v}" title={String(s.v)}></i>{/each}
</div>

<style>
	.et-state { display: flex; align-items: center; flex-wrap: wrap; column-gap: 8px; min-width: 0; line-height: 20px; color: var(--k-fg-muted); }
	.et-mk { width: 16px; height: 20px; display: inline-grid; place-items: center; flex: none; }
	.et-lead { font-weight: 500; }
	.et-rest { min-width: 0; }
	.et-bar { display: flex; gap: 2px; height: 6px; border-radius: 3px; overflow: hidden; background: var(--k-subtle); }
	.et-bar i { display: block; height: 100%; flex: var(--g) var(--g) 0; }
	.et-bar .f { background: var(--k-danger-solid); }
	.et-bar .w { background: var(--k-held-solid); }
	.et-bar .m { background: var(--k-active-solid); }
	.et-bar .r { background: var(--k-line-strong); }
	.et-bar.ok { background: var(--k-line-strong); }
</style>
