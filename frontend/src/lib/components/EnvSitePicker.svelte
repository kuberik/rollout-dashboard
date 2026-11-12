<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE SITE PICKER (change-strip r1, owner 2026-11-12: "on prod box we couldn't select exact site"). New name, never used before.
	 *
	 * ROLE: the list behind an EnvRow box that holds several sites (prod's regions, in waves). It opens on a tap of the box and lists
	 * every site of that tier under its wave, each row a link to that site's rollout. Nothing else in the product picks one place out
	 * of an environment box: RulePopover is a rule record on a <details> whose phone form renders IN FLOW (it would push the page);
	 * this panel always floats (position fixed, clamped to the viewport), so opening it moves nothing.
	 *
	 * CHROME: RulePopover's / the overlay menus' (radius 8, surface, 1px line, `--k-shadow-overlay`). ROWS: the 16px status column
	 * (the strip's own marks), site name t-ui-sm, state word t-meta in the state's ink, aside t-meta subtle tabular. 32px rows, 44px
	 * below sm. Reference: GitHub's deployment-environment list, Vercel's environment switcher (one row per target, a dot + a word).
	 */
	import type { EnvSite } from './EnvRow.svelte';
	import SiteMark from './SiteMark.svelte';

	let { sites, title, sub, anchor, open = $bindable(false), id }: { sites: EnvSite[]; title: string; sub: string; anchor: HTMLElement | undefined; open?: boolean; id: string } = $props();

	let panel: HTMLElement | undefined = $state();
	const waves = $derived([...new Set(sites.map((s) => s.wave ?? 0))]);
	const multiWave = $derived(waves.length > 1);

	function place() {
		if (!anchor || !panel) return;
		const r = anchor.getBoundingClientRect();
		const vw = document.documentElement.clientWidth;
		const vh = document.documentElement.clientHeight;
		const w = panel.offsetWidth, h = panel.offsetHeight;
		const left = Math.min(Math.max(8, r.left), Math.max(8, vw - w - 8));
		const below = r.bottom + 6;
		const top = below + h > vh - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below;
		panel.style.left = `${left}px`;
		panel.style.top = `${top}px`;
	}
	function close(refocus = false) {
		open = false;
		if (refocus) anchor?.focus();
	}
	$effect(() => {
		if (!open) return;
		place();
		const raf = requestAnimationFrame(place);
		const onDoc = (e: MouseEvent) => {
			const path = e.composedPath();
			if (panel && !path.includes(panel) && !(anchor && path.includes(anchor))) close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close(true);
		};
		document.addEventListener('click', onDoc, true);
		document.addEventListener('keydown', onKey);
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		return () => {
			cancelAnimationFrame(raf);
			document.removeEventListener('click', onDoc, true);
			document.removeEventListener('keydown', onKey);
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
		};
	});
</script>

{#if open}
	<div bind:this={panel} {id} class="site-picker" role="dialog" aria-label={title} data-site-picker>
		<div class="sp-head">
			<span class="t-ui-sm text-fg">{title}</span>
			<span class="t-meta tabular-nums text-fg-subtle">{sub}</span>
		</div>
		{#each waves as w (w)}
			{#if multiWave}<div class="sp-wave t-meta text-fg-subtle">Wave {w}</div>{/if}
			{#each sites.filter((s) => (s.wave ?? 0) === w) as s (s.key)}
				<a href={s.href} class="sp-row" class:sp-row--here={s.here} aria-current={s.here ? 'location' : undefined} onclick={() => close()} data-site-row={s.key}>
					<span class="sp-mk"><SiteMark state={s.state} /></span>
					<span class="sp-name t-ui-sm text-fg">{s.name}</span>
					{#if s.here}<span class="t-meta shrink-0 text-fg-muted">This rollout</span>{/if}
					<span class="sp-word t-meta {s.wordInk ?? 'text-fg-muted'}">{s.word}</span>
					{#if s.aside}<span class="t-meta shrink-0 tabular-nums text-fg-subtle">{s.aside}</span>{/if}
				</a>
			{/each}
		{/each}
	</div>
{/if}

<style>
	.site-picker {
		position: fixed;
		z-index: 60;
		width: 300px;
		max-width: calc(100vw - 16px);
		padding: 4px;
		border: 1px solid var(--k-line);
		border-radius: 8px;
		background-color: var(--k-surface);
		box-shadow: var(--k-shadow-overlay);
	}
	.sp-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 8px 6px;
	}
	.sp-wave {
		padding: 8px 8px 2px;
	}
	.sp-row {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 8px;
		border-radius: 6px;
		white-space: nowrap;
	}
	.sp-row:hover,
	.sp-row:focus-visible {
		background-color: var(--k-hover);
		outline: none;
	}
	.sp-row--here {
		background-color: var(--k-subtle);
	}
	.sp-mk {
		display: inline-flex;
		width: 16px;
		height: 16px;
		flex: none;
		align-items: center;
		justify-content: center;
	}
	.sp-name {
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sp-word {
		flex: none;
	}
	@media (max-width: 639.98px) {
		.sp-row {
			height: 44px;
		}
	}
</style>
