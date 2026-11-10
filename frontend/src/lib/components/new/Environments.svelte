<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ENVIRONMENTS (r39 build, 2026-11-08; mock .work/home-r34/direction/r39/environments.html, FINAL.md "Environments", LANGUAGE §1/§3/§7).
	 * The operator's question: "what state is each environment in, what is arriving, what is holding things back?"
	 * ONE page template, no focal band (decided 2026-11-08: the Attention band pushed the tiles ~300px down and repeated Rollouts): the tier
	 * tiles (Dev / Test / Staging) -> Production, the same tile at full width with its regions as cells -> "Arrived in prod" on the page
	 * surface under the section header. No page title, no header facts, no rail: the old banner, Delivery path, Stages / Production list, Holding
	 * and Recent deploys retired with the old page (their facts live on Rollouts, Home and /envs/<name>). References: EnvTile (the kit's
	 * environment tile, extending the Card shell), SectionHeader (icon · 16/600 · rollup), AppGlyph. All composition lives in
	 * environments-page.ts (unit-tested); this file draws. The page is its own container so the grids step with the page, not the viewport.
	 */
	import { ClockOutline, GridOutline } from 'flowbite-svelte-icons';
	import SectionHeader from '$lib/components/SectionHeader.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import EnvTile from './EnvTile.svelte';
	import { environmentsPage } from './environments-page';
	import type { PageProps } from './pages';

	let { state: hs }: PageProps = $props();
	const P = $derived(environmentsPage(hs));
</script>

<div class="w-full px-4 py-6 sm:px-6">
	<div class="ev flex min-w-0 flex-col gap-8" data-environments-page>
		{#if P.empty}
			<div class="empty" data-list-empty>
				<GridOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
				<p class="t-ui text-fg">No environments yet</p>
				<p class="t-meta text-fg-subtle">Environments appear here as soon as a rollout is deployed to one.</p>
			</div>
		{:else}
			<div class="envgrid" data-section="tiles" data-n={Math.min(P.tiles.length, 3)}>
				{#each P.tiles as t (t.key)}<EnvTile tile={t} />{/each}
				{#if P.prod}<EnvTile tile={P.prod} wide />{/if}
			</div>

			{#if P.arrivals.length}
				<section id="arrived" data-section="arrived">
					<SectionHeader title="Arrived in prod" icon={ClockOutline} rollup={[`${P.arrivals.length} in ${P.window}`]} />
					<div class="arrcard" data-arrivals>
						<div class="arrgrid" data-n={Math.min(P.arrivals.length, 7)}>
							{#each P.arrivals as a (a.key)}
								<a class="arrtile" href={a.href} data-truth-kind="arrival" data-truth-app={a.app}>
									<AppGlyph name={a.app} size={24} class="shrink-0" />
									<span class="at-nm"><span class="at-app t-ui truncate">{a.app}</span><span class="at-sub t-meta truncate">{#if a.build}<span class="t-code-sm">{a.build}</span>{#if a.place}{' · '}{/if}{/if}{a.place}</span></span>
									<span class="at-age t-meta tabular-nums">{a.age}</span>
								</a>
							{/each}
						</div>
					</div>
				</section>
			{/if}
		{/if}
	</div>
</div>

<style>
	.ev { container-type: inline-size; }
	section { scroll-margin-top: 16px; }
	/* the tile grid: Dev · Test · Staging in a row, Production full width under them (the wide tile spans every column) */
	.envgrid { display: grid; gap: 16px; align-items: start; grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.envgrid > :global(.wide) { grid-column: 1 / -1; }
	/* QA #24: never a column more than there are tiles (two tiles fill the row; they do not leave an empty third column) */
	.envgrid[data-n='1'] { grid-template-columns: minmax(0, 1fr); }
	.envgrid[data-n='2'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	/* arrived in production: one card holding small tiles (glyph 24 · app · build · place · age) */
	.arrcard { border: 1px solid var(--k-line); border-radius: 8px; background: var(--k-surface); padding: 16px; min-width: 0; }
	.arrgrid { display: grid; gap: 16px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
	.arrtile { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 16px; border: 1px solid var(--k-line); border-radius: 8px; background: var(--k-surface); }
	.arrtile:hover { background: var(--k-hover); }
	.at-nm { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
	.at-app { color: var(--k-fg); font-weight: 500; }
	.at-sub { color: var(--k-fg-subtle); }
	.at-age { flex: none; color: var(--k-fg-subtle); }
	.arrgrid[data-n='1'] { grid-template-columns: minmax(0, 1fr); }
	.arrgrid[data-n='2'] { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.arrgrid[data-n='3'] { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	/* a count of tiles only ever CAPS the width's own column count: n columns exist only where the width has room for n */
	@container (min-width: 900px) { .arrgrid[data-n='4'] { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
	@container (min-width: 1500px) { .arrgrid[data-n='5'] { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
	@container (min-width: 2100px) { .arrgrid[data-n='6'] { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
	.empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 32px 16px; text-align: center; border: 1px solid var(--k-line); border-radius: 8px; }
	.empty p { margin: 0; }
	@container (min-width: 1500px) { .arrgrid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
	@container (min-width: 2100px) { .arrgrid { grid-template-columns: repeat(7, minmax(0, 1fr)); } }
	@container (max-width: 899px) { .envgrid, .envgrid[data-n] { grid-template-columns: repeat(2, minmax(0, 1fr)); } .arrgrid, .arrgrid[data-n] { grid-template-columns: repeat(3, minmax(0, 1fr)); } .envgrid[data-n='1'], .arrgrid[data-n='1'] { grid-template-columns: minmax(0, 1fr); } .arrgrid[data-n='2'] { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@container (max-width: 599px) { .envgrid, .envgrid[data-n], .arrgrid, .arrgrid[data-n] { grid-template-columns: minmax(0, 1fr); } .arrcard { padding: 12px; } .arrtile { padding: 12px; } }
</style>
