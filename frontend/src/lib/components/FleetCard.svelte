<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE FLEET CARD (r39 kit parts/repocard.js `fleetCard`): Home's side column. "Is anything wrong elsewhere, and what just shipped."
	 * Role: the rail's context card. WHY NOTHING EXISTING FITS: HomeRail/FleetRow draw every app as a lane (a spreadsheet of cells beside an Attention
	 * band that already carries the asks); this card names only the trouble that is NOT the viewer's (failing / held rollouts), one row per app +
	 * state, then the last deploys, so the reader sees the fleet without a second copy of their own work. PROPORTIONS: the Card shell with its 47px
	 * header and the 40px quiet row of the list cards (Rollouts' At rest, Environments' Recent deploys). Marks are StatusMark (failed / held), a
	 * quiet 6px dot for a clean deploy, the tier chip family for the place. The whole row is one link (`.tap-zone` + `.tap-link`).
	 * The model is home-page.ts `fleet` (unit-tested); nothing is decided here.
	 */
	import { GridOutline, CheckOutline } from 'flowbite-svelte-icons';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import HeldGlyph from '$lib/components/HeldGlyph.svelte';
	import { envTheme } from '$lib/components/new/rollout-view';
	import type { FleetTrouble, FleetDeploy } from '$lib/components/new/home-page';

	let { trouble, deploys }: { trouble: FleetTrouble[]; deploys: FleetDeploy[] } = $props();
	const label = (tier: string, place: string) => (!place ? tier : /^(\d+ of )?\d+ regions?$/.test(place) ? place.replace(/ (regions?)$/, ` ${tier} $1`) : `${tier}-${place}`);
</script>

<Card icon={GridOutline} title="Fleet" padded={false} class="fleet-card">
	{#snippet rollup()}<a href="/apps" class="t-meta relative z-[1] text-fg-subtle hover:text-fg hover:underline">all apps</a>{/snippet}
	<div data-fleet>
		{#if !trouble.some((t) => t.mark !== 'deploying' && t.mark !== 'checking')}
			<p class="t-body m-0 flex min-h-10 items-center gap-2 px-4 text-fg-muted" data-fleet-calm><span class="inline-grid h-4 w-4 shrink-0 place-items-center"><CheckOutline class="h-4 w-4 text-success" aria-hidden="true" /></span>All healthy elsewhere</p>
		{/if}
		{#if trouble.length}
			<ul class="m-0 list-none p-0" data-fleet-trouble>
				{#each trouble as t (t.key)}
					<li class="fl tap-zone relative flex min-h-10 min-w-0 flex-wrap items-center gap-x-2 px-4 py-1 hover:bg-hover" data-fleet-row="trouble" data-truth-app={t.app}>
						<span class="inline-grid h-4 w-4 shrink-0 place-items-center">{#if t.mark === 'held'}<HeldGlyph size={16} class="text-fg-muted" title="Held" />{:else}<StatusMark state={t.mark} tone="neutral" />{/if}</span>
						<a href={t.href} class="tap-link t-body min-w-0 max-w-full shrink-0 truncate text-fg">{t.app}</a>
						<span class="flex shrink-0 items-center gap-1">{#each t.places as p (p.tier + p.place)}<Chip role="env" theme={envTheme(p.tier)} label={label(p.tier, p.place)} wide />{/each}</span>
						<span class="t-meta ml-auto shrink-0 tabular-nums text-fg-muted">{t.word}</span>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="t-meta mt-2 border-t border-line-subtle px-4 pb-1 pt-3 text-fg-subtle">Recent deploys</div>
		{#if deploys.length}
			<ul class="m-0 list-none p-0" data-fleet-deploys>
				{#each deploys as d (d.key)}
					<li class="fl tap-zone relative flex min-h-10 min-w-0 items-center gap-2 px-4 hover:bg-hover" data-fleet-row="deploy" data-truth-app={d.app}>
						<span class="inline-grid h-4 w-4 shrink-0 place-items-center">{#if d.failing}<StatusMark state="failed" />{:else}<span class="h-1.5 w-1.5 rounded-full bg-fg-disabled"></span>{/if}</span>
						<a href={d.href} class="tap-link t-body min-w-0 truncate text-fg">{d.app}</a>
						<span class="flex shrink-0 items-center"><Chip role="env" theme={envTheme(d.tier)} label={label(d.tier, d.place)} wide /></span>
						<span class="t-meta ml-auto shrink-0 tabular-nums text-fg-subtle">{d.age}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="t-meta m-0 px-4 py-3 text-fg-subtle">No deploys in the last 24 h</p>
		{/if}
		<div class="mt-2 flex border-t border-line-subtle px-4 pb-4 pt-3"><a href="/activity" class="btn btn-secondary btn-sm max-sm:w-full">Show all</a></div>
	</div>
</Card>
