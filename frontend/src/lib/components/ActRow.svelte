<svelte:options runes={true} />

<script lang="ts" module>
	import type { Component } from 'svelte';

	/** One action of a statement banner. Content only: the row decides how it looks. */
	export interface Act {
		label: string;
		href?: string;
		onclick?: (e?: MouseEvent) => void;
		/** GitHub / another site: prints "↗". A same-tab link prints "›". */
		external?: boolean;
		busy?: boolean;
		disabled?: boolean;
		icon?: Component;
		/** icon size override (default h-4 w-4); the signed tab banner's Retry keeps its historical 20px play glyph */
		iconClass?: string;
		/** native title + aria-label for rows that repeat the same label (per-app Roll back) */
		title?: string;
		ariaLabel?: string;
		/** stable hook for tests and truth scripts: data-action */
		key?: string;
		id?: string;
		/** a text link ("Open rollout ›"), not a button; always after the primary on desktop */
		quiet?: boolean;
		/** this action is the phone's lead (flex-1, 44px) although it is not a primary (rows whose actions are equals) */
		lead?: boolean;
		/** extra data-* attributes (truth hooks) */
		data?: Record<string, string>;
		/** a secondary that sits after the primary on desktop (before it otherwise) */
		after?: boolean;
		/** a disclosure ("Details") that only a phone needs: hidden from 640 (viewport), never in the "⋯" menu */
		phoneOnly?: boolean;
		/** a link the phone leaves to the row above ("Open rollout"): hidden below 640 (viewport), never in the "⋯" menu */
		desktopOnly?: boolean;
		/** the icon follows the label (a disclosure chevron) */
		iconAfter?: boolean;
		/** the icon's own rotation class (the chevron turns when open) */
		iconTurn?: boolean;
	}
</script>

<script lang="ts">
	/**
	 * THE ACTION ROW OF EVERY STATEMENT BANNER (owner ruling 2026-11-02: "some things
	 * should behave exactly the same across pages").
	 *
	 * Role: the one place where a banner's buttons are laid out. Reference: the owner's
	 * praised /rollouts failing lead — below 640 the row spans the card's full inner
	 * width: the lead action (the primary, or the first action when there is none)
	 * is `flex-1` and 44px tall, ONE compact secondary sits beside it, anything else
	 * lives behind a "⋯" button (never three stacked full-width buttons). From 640
	 * every action is inline, in desktop order (secondaries, primary, then `after`/
	 * `quiet` ones).
	 *
	 * The switch is a CONTAINER query on the surrounding AlertPanel (its own width,
	 * 640px), so it must live inside an AlertPanel. `fill=false` keeps the lead at its
	 * natural width (a row inside a table-like cell, e.g. the per-failure rows of
	 * /envs/<name>).
	 */

	let {
		primary,
		secondary = [],
		fill = true,
		phoneMax = 2,
		align = 'start'
	}: {
		primary?: Act;
		secondary?: Act[];
		fill?: boolean;
		/** how many actions stay on the phone row (lead + one side by default); the rest go to "⋯" */
		phoneMax?: number;
		/** `end`: from 640 the actions end on the right edge (a pane's action row) */
		align?: 'start' | 'end';
	} = $props();

	type Item = { act: Act; variant: 'primary' | 'secondary' | 'quiet'; phone: 'lead' | 'side' | 'menu' | 'none' };

	const items = $derived.by<Item[]>(() => {
		const before = secondary.filter((a) => !a.after && !a.quiet);
		const after = secondary.filter((a) => a.after || a.quiet);
		const ordered: { act: Act; variant: Item['variant'] }[] = [
			...before.map((act) => ({ act, variant: 'secondary' as const })),
			...(primary ? [{ act: primary, variant: 'primary' as const }] : []),
			...after.map((act) => ({ act, variant: (act.quiet ? 'quiet' : 'secondary') as Item['variant'] }))
		];
		const onPhone = (o: { act: Act }) => !o.act.desktopOnly;
		const flagged = ordered.findIndex((o) => o.act.lead);
		const first = ordered.findIndex(onPhone);
		const leadAt = primary ? ordered.findIndex((o) => o.act === primary) : flagged >= 0 ? flagged : first;
		const sideAt = phoneMax >= 2 ? ordered.findIndex((o, i) => i !== leadAt && onPhone(o)) : -1;
		return ordered.map((o, i) => ({
			...o,
			phone: !onPhone(o) ? 'none' : i === leadAt ? 'lead' : i === sideAt ? 'side' : 'menu'
		}));
	});
	const menu = $derived(items.filter((i) => i.phone === 'menu'));

	let menuOpen = $state(false);
	let root: HTMLElement | undefined = $state();
	function away(e: Event) {
		if (menuOpen && root && !root.contains(e.target as Node)) menuOpen = false;
	}
	function pick(a: Act) {
		menuOpen = false;
		a.onclick?.();
	}
</script>

<svelte:window onclick={away} onkeydown={(e) => e.key === 'Escape' && (menuOpen = false)} />

{#snippet face(a: Act, variant: Item['variant'])}
	{#if a.icon && !a.iconAfter}{@const I = a.icon}<I class={a.iconClass ?? 'h-4 w-4'} aria-hidden="true" />{/if}<span>{a.label}</span>{#if a.icon && a.iconAfter}{@const I = a.icon}<I class="{a.iconClass ?? 'h-4 w-4'} transition-transform {a.iconTurn ? 'rotate-180' : ''}" aria-hidden="true" />{/if}{#if a.href && !a.icon}<span aria-hidden="true" class="shrink-0">{a.external ? '↗' : '›'}</span>{/if}
{/snippet}

<div class="ar" class:ar-fill={fill} class:ar-end={align === 'end'} bind:this={root} data-act-row>
	{#each items as { act, variant, phone } (act.key ?? act.label)}
		{@const cls = `ar-item ar-${phone} ${act.phoneOnly ? 'ar-phoneonly' : ''} ${act.desktopOnly ? 'ar-desktoponly' : ''} relative z-[1] shrink-0 gap-1.5 ${variant === 'quiet' ? 'nav-link inline-flex h-8 min-h-0 items-center' : variant === 'primary' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}`}
		{#if act.href}
			<a href={act.href} class={cls} id={act.id} data-action={act.key} {...act.data} title={act.title} aria-label={act.ariaLabel} target={act.external ? '_blank' : undefined} rel={act.external ? 'noopener noreferrer' : undefined}>{@render face(act, variant)}</a>
		{:else}
			<button type="button" class={cls} id={act.id} data-action={act.key} {...act.data} title={act.title} aria-label={act.ariaLabel} disabled={act.busy || act.disabled} onclick={act.onclick}>{@render face(act, variant)}</button>
		{/if}
	{/each}
	{#if menu.length}
		<div class="ar-more relative shrink-0">
			<button type="button" class="btn btn-secondary btn-sm relative z-[1] min-h-11 min-w-11 !px-0" aria-label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)} data-action="more">
				<svg viewBox="0 0 16 16" class="h-4 w-4" fill="currentColor" aria-hidden="true"><circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" /><circle cx="13" cy="8" r="1.4" /></svg>
			</button>
			{#if menuOpen}
				<div role="menu" class="absolute right-0 top-full z-30 mt-1 flex min-w-40 flex-col rounded-md border border-line bg-surface p-1 text-fg shadow-lg">
					{#each menu as { act } (act.key ?? act.label)}
						{#if act.href}
							<a role="menuitem" href={act.href} class="t-ui flex min-h-11 items-center gap-2 rounded px-3 hover:bg-hover" onclick={() => (menuOpen = false)}>{act.label}<span aria-hidden="true">{act.external ? '↗' : '›'}</span></a>
						{:else}
							<button role="menuitem" type="button" class="t-ui flex min-h-11 items-center gap-2 rounded px-3 text-left hover:bg-hover disabled:opacity-50" disabled={act.busy || act.disabled} onclick={() => pick(act)}>{act.label}</button>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.ar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 12px;
	}
	.ar-more {
		display: none;
	}
	@container (min-width: 640px) {
		.ar-end {
			justify-content: flex-end;
		}
	}
	@media (min-width: 640px) {
		.ar :global(.ar-phoneonly) {
			display: none;
		}
	}
	@media (max-width: 639px) {
		.ar :global(.ar-desktoponly) {
			display: none;
		}
	}
	@container (max-width: 639px) {
		.ar {
			flex-wrap: nowrap;
			gap: 8px;
		}
		.ar-fill {
			width: 100%;
		}
		.ar :global(.ar-item) {
			min-height: 44px;
			justify-content: center;
		}
		.ar-fill :global(.ar-lead) {
			flex: 1 1 0;
			min-width: 0;
		}
		.ar-fill {
			align-items: stretch;
		}
		.ar :global(.ar-menu) {
			display: none;
		}
		.ar-more {
			display: block;
		}
	}
</style>
