<svelte:options runes={true} />

<script lang="ts">
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	/**
	 * A GANGWAY TILE (r39, owner-approved body concept B, 2026-11-08; mock .work/home-r34/direction/r39/env-detail-b.html).
	 * ROLE: one app that has something waiting to ENTER this environment. Its question: "how far behind is this app, and what holds it at the door?"
	 * WHY NOTHING EXISTING FITS: Apps' Facia speaks about an app's whole footprint; this page is one environment, so only the stretch of road that
	 * leads INTO it matters: the environments before it that hold the app's unlanded changes (the shared EnvRow's beads, as Changes' repo cards
	 * draw them), then THIS environment's box carrying the gate's mark + word (or, when nothing holds it, the build here).
	 * PROPORTIONS borrowed from Facia's tile: the same card (8px, 20px padding), identity row (32px glyph, name 16/600), EnvRow size M, and the
	 * footer under a hairline (commit icon, title, ref, age). Anatomy: identity · env row · footer. Nothing in it is a second action: the tile is one link.
	 */
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import EnvRow from '$lib/components/EnvRow.svelte';
	import { CodeBranchOutline } from 'flowbite-svelte-icons';
	import type { GangTile } from './env-page';

	let { tile }: { tile: GangTile } = $props();
</script>

<li class="fp-tile tap-zone flex min-w-0 flex-col gap-5 rounded-[8px] border border-line bg-surface p-5 transition-colors hover:bg-hover max-sm:p-4 sm:max-[1279px]:p-4" data-gangway-tile data-truth-kind="app" data-truth-app={tile.app} data-truth-group={tile.hold ?? 'ready'} data-truth-href={tile.href}>
	<div class="flex min-w-0 items-center gap-x-3">
		<AppGlyph name={tile.app} size={32} />
		<a href={tile.href} class="tap-link t-card-title min-w-0 truncate text-fg hover:underline" aria-label={tile.count ? `${tile.app}: ${tile.count} on the way` : tile.app}>{tile.app}</a>
		<span class="t-meta ml-auto shrink-0 tabular-nums text-fg-subtle" data-gangway-count>{#if tile.count}{tile.count}{:else}<span data-held-pending aria-hidden="true"><SkeletonBar width="w-12" height="h-3.5" /></span>{/if}</span>
	</div>
	<EnvRow cells={tile.cells} size="M" class="pointer-events-none" />
	<div class="mt-auto flex min-w-0 items-center gap-2 border-t border-line-subtle pt-4 t-meta text-fg-muted" data-gangway-foot>
		<CodeBranchOutline class="h-4 w-4 shrink-0 text-fg-disabled" aria-hidden="true" />
		{#if tile.foot.title}
			<span class="min-w-0 truncate" title={tile.foot.title}>{tile.foot.title}</span>
			<span class="t-code-sm shrink-0 text-fg-subtle">{tile.foot.ref}</span>
			<span class="ml-auto shrink-0 whitespace-nowrap pl-2 tabular-nums text-fg-subtle" title={tile.foot.ageTitle}>{tile.foot.ageLabel} {tile.foot.age}</span>
		{:else}
			<span class="min-w-0 truncate">Build</span>
			<span class="t-code-sm shrink-0 text-fg-subtle">{tile.foot.ref}</span>
			{#if tile.foot.from}<span class="ml-auto shrink-0 whitespace-nowrap pl-2 text-fg-subtle">from {tile.foot.from}</span>{/if}
		{/if}
	</div>
</li>
