<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ENVIRONMENT TILE (r39 kit parts/envtile.js `envTile`; Environments C, the page the owner called "very clean").
	 * ROLE: one environment across the whole fleet (LANGUAGE §3, "environment tile") — no other part draws a fleet-wide environment.
	 * Anatomy, top to bottom: identity (tier chip · name · "N places · N apps") -> ONE state line (the worst fact leads in its ink, the rest
	 * muted) -> ONE proportional bar (one fill per state, healthy neutral) -> what is arriving (builds as app monograms) -> footer (last
	 * deploy · who). Production is the same tile at full width with its regions as cells (only regions with something to say; the healthy rest
	 * fold to one dashed count). Reference: the Card shell (1px line, r8, p16, tap-zone), AppGlyph, StatusMark, Chip, Avatar. Nothing is
	 * decided here: the model is environments-page.ts (unit-tested).
	 */
	import Chip from '$lib/components/Chip.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import EnvStateBar from './EnvStateBar.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { ArrowRightOutline } from 'flowbite-svelte-icons';
	import { envTheme } from './rollout-view';
	import { avatarSrc } from './data';
	import type { EnvTile } from './environments-page';
	import { plural } from './envs-model';

	let { tile, wide = false }: { tile: EnvTile; wide?: boolean } = $props();
	const shown = $derived(tile.arriving.apps.slice(0, 6));
	const regionMark = (m: string) => (m === 'failed' ? 'failed' : m === 'approval' ? 'approval' : m === 'held' ? 'held' : m === 'checking' ? 'checking' : 'deploying') as 'failed' | 'approval' | 'held' | 'checking' | 'deploying';
</script>

<section class="et tap-zone" class:wide data-env-tile={tile.key} data-truth-kind="env-tile" data-truth-tier={tile.key} data-truth-places={tile.places} data-truth-failing={tile.failing} data-truth-waiting={tile.waiting} data-truth-moving={tile.moving}>
	<header class="et-id">
		<Chip role="env" theme={envTheme(tile.key)} label={tile.key} wide />
		<h3 class="et-nm t-ui"><a href={tile.href} class="tap-link">{tile.name}</a></h3>
		<span class="et-cnt t-meta tabular-nums">{tile.places} places · {tile.apps} apps</span>
	</header>

	<EnvStateBar {tile} />

	{#if tile.regions}
		<div class="et-regions" data-regions>
			{#each tile.regions.cells as r (r.key)}
				<a class="et-region" href={r.href} data-truth-kind="region" data-truth-region={r.label}>
					<span class="et-rtop"><StatusMark state={regionMark(r.mark)} /><span class="et-rnm t-meta font-medium truncate">{r.label}</span></span>
					<span class="et-rst t-meta">
						{#if r.failing}<span class="text-danger">{r.failing} failing</span>{/if}{#if r.failing && (r.waiting || r.moving)}{' · '}{/if}{#if r.waiting}<span class="text-held">{r.waiting} waiting</span>{/if}{#if r.waiting && r.moving}{' · '}{/if}{#if r.moving}<span class="text-active">{r.movingWord}</span>{/if}
					</span>
				</a>
			{/each}
			{#if tile.regions.healthy}<span class="et-region more t-meta">{plural(tile.regions.healthy, 'region')} healthy</span>{/if}
			{#if tile.regions.held}<span class="et-region more t-meta" data-wave-held><span><span class="text-held">{plural(tile.regions.held.regions, 'region')} held</span>{' · '}{tile.regions.held.because}</span></span>{/if}
		</div>
	{/if}

	<p class="et-arr t-meta">
		{#if tile.arriving.builds}
			<ArrowRightOutline class="h-4 w-4 shrink-0 text-fg-muted" aria-hidden="true" />
			<span>{plural(tile.arriving.builds, 'build')} arriving</span>
			<span class="et-glyphs" title={tile.arriving.apps.join(', ')}>{#each shown as a (a)}<AppGlyph name={a} size={20} />{/each}</span>
			{#if tile.arriving.apps.length > shown.length}<span class="text-fg-subtle">+{tile.arriving.apps.length - shown.length}</span>{/if}
		{:else}<span class="text-fg-subtle">Nothing arriving</span>{/if}
	</p>

	<footer class="et-ft">
		{#if tile.last}
			<span class="et-ftl t-meta">
				<span class="et-lbl text-fg-subtle shrink-0">Last deploy</span><AppGlyph name={tile.last.app} size={20} class="shrink-0" /><span class="truncate text-fg-muted">{tile.last.app}</span>
				<span class="t-code-sm text-fg-subtle whitespace-nowrap">{tile.last.build}</span><span class="text-fg-subtle tabular-nums whitespace-nowrap">{tile.last.word ? `${tile.last.word} ` : ''}{tile.last.age}</span>
			</span>
			{#if tile.last.you}<span class="t-meta text-fg-muted">you</span>
			{:else if tile.last.author}<Avatar name={tile.last.author} src={avatarSrc(tile.last.author)} size={20} />{/if}
		{:else}<span class="et-ftl t-meta text-fg-subtle">No deploys yet</span>{/if}
	</footer>
</section>

<style>
	.et { display: flex; flex-direction: column; gap: 12px; min-width: 0; padding: 16px; border: 1px solid var(--k-line); border-radius: 8px; background: var(--k-surface); }
	.et:hover { background: var(--k-hover); }
	.et-id { display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 32px; }
	.et-nm { min-width: 0; color: var(--k-fg); font-weight: 500; }
	.et-nm a { color: inherit; }
	.et-cnt { margin-left: auto; flex: none; color: var(--k-fg-subtle); white-space: nowrap; }
	.et-arr { display: flex; align-items: center; gap: 8px; min-width: 0; line-height: 20px; color: var(--k-fg-muted); }
	.et-glyphs { display: flex; gap: 4px; min-width: 0; overflow: hidden; }
	.et-ft { margin-top: auto; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 12px; padding-top: 12px; border-top: 1px solid var(--k-line-subtle); }
	.et-ftl { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--k-fg-muted); }
	.et-regions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
	.et-region { display: flex; flex-direction: column; gap: 4px; min-width: 0; padding: 10px 12px; border: 1px solid var(--k-line-subtle); border-radius: 6px; background: var(--k-ground); }
	.et-region:hover { background: var(--k-hover); }
	.et-rtop { display: flex; align-items: center; gap: 8px; min-width: 0; }
	.et-rnm { color: var(--k-fg); }
	.et-rst { color: var(--k-fg-subtle); padding-left: 24px; }
	.et-region.more { justify-content: center; color: var(--k-fg-subtle); border-style: dashed; }
	.et-region.more:hover { background: var(--k-ground); }
	/* the regions size against the TILE (the page may have a rail or not): container queries on the wide tile */
	.et { container-type: inline-size; }
	@container (max-width: 400px) { .et-lbl { display: none; } }
	@container (min-width: 1500px) { .et-regions { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
	@container (min-width: 2100px) { .et-regions { grid-template-columns: repeat(9, minmax(0, 1fr)); } }
	@container (max-width: 1023px) { .et-regions { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
	@container (max-width: 560px) { .et-regions { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
