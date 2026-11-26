<svelte:options runes={true} />

<script lang="ts">
	/**
	 * DEPENDENCY CELL SHEET — the phone detail for one service in one environment on /dependencies (take B, phone).
	 *
	 * ROLE: what a desktop reader gets by looking along a row and down a column of the lanes matrix, said once for the
	 * tapped cell: what it needs (and what is served now), what it serves and to whom, where it sits on its own
	 * promotion line, its regions, how long it has been held, and the way to act (Open). Operator questions 3 and 4 in
	 * one tap.
	 *
	 * WHY NOTHING EXISTING FITS: the product has exactly one phone bottom sheet, `ApprovalLayer`'s confirm (a sentence
	 * and two buttons); this is a record, not a confirmation. `RulePopover` is anchored to a control and too narrow for
	 * a region list. The SHELL is ApprovalLayer's (fixed, `inset-x-2 bottom-2`, `bg-overlay`, 8px radius, 40% scrim,
	 * the fly-in, safe-area padding, `aria-modal`), moved to <body> with `portal` like `CommandPalette`, and it locks
	 * the document with the same `__scrollLockCount` idiom. The body rows are the rail card `dl` grammar (`t-label`
	 * term over a `t-meta` value), the path is the lanes' own cell words.
	 * DIVIDERS: `line-subtle` in light, `line` in dark — dark's `line-subtle` IS the overlay ground (oklch 0.262), so the
	 * sheet's header/footer rules and the region list drew nothing there (R2-DES-B-6).
	 */
	import { fade, fly } from 'svelte/transition';
	import { CloseOutline } from 'flowbite-svelte-icons';
	import StatusMark from './StatusMark.svelte';
	import HeldGlyph from './HeldGlyph.svelte';
	import Chip from './Chip.svelte';
	import { href } from '$lib/paths';
	import { portal, modalFocusReturn } from '$lib/a11y.svelte';
	import { getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import { NO_ENV, ageOf, regionShare, type LaneCell, type LaneModel } from '$lib/view-models/dependency-lanes';
	import { promotionPath } from '$lib/view-models/dependency-lanes-phone';

	let { model, cell, now, onclose }: { model: LaneModel; cell: LaneCell | null; now: Date; onclose: () => void } = $props();

	const colLabel = (c: string) => (c === NO_ENV ? 'No environment' : c);
	modalFocusReturn(() => !!cell);

	$effect(() => {
		if (!cell) return;
		const w = window as unknown as { __scrollLockCount?: number };
		w.__scrollLockCount = (w.__scrollLockCount ?? 0) + 1;
		document.documentElement.classList.add('scroll-locked');
		const key = (e: KeyboardEvent) => e.key === 'Escape' && onclose();
		window.addEventListener('keydown', key);
		return () => {
			window.removeEventListener('keydown', key);
			w.__scrollLockCount = Math.max(0, (w.__scrollLockCount ?? 1) - 1);
			if (w.__scrollLockCount === 0) document.documentElement.classList.remove('scroll-locked');
		};
	});

	const inbound = $derived(cell ? model.links.filter((l) => l.kind === 'contract' && l.to === cell.key) : []);
	const outbound = $derived(cell ? model.links.filter((l) => l.kind === 'contract' && l.from === cell.key) : []);
	const promoIn = $derived(cell ? model.links.find((l) => l.kind === 'promotion' && l.to === cell.key && l.held) : undefined);
	const path = $derived(cell ? promotionPath(model, cell.service) : []);
	const since = $derived.by(() => {
		if (!cell) return null;
		const s = model.links.filter((l) => l.to === cell.key && l.held && l.since).map((l) => l.since!).sort()[0];
		return ageOf(s ?? null, now);
	});
	const svcOf = (k: string) => model.cells.get(k)?.service ?? k;
	const openHref = $derived(
		cell
			? cell.nodes.length === 1
				? href(`/rollouts/${cell.nodes[0].cluster}/${cell.nodes[0].namespace}/${cell.nodes[0].name}`)
				: href(`/apps/${cell.service}`)
			: '#'
	);
	let panel: HTMLElement | undefined = $state();
	$effect(() => {
		if (cell) panel?.querySelector<HTMLElement>('[data-sheet-close]')?.focus();
	});
</script>

{#if cell}
	<div use:portal>
		<div class="fixed inset-0 z-[69] bg-black/40" transition:fade={{ duration: 120 }} aria-hidden="true" onclick={onclose}></div>
		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-label="{cell.service} in {colLabel(cell.col)}"
			class="fixed inset-x-2 bottom-2 z-[70] flex max-h-[80dvh] flex-col overflow-y-auto rounded-lg bg-overlay pb-[calc(env(safe-area-inset-bottom,0px)+8px)]"
			transition:fly={{ y: 24, duration: 140 }}
			data-dep-sheet
		>
			<div class="flex items-center gap-2 border-b border-line-subtle dark:border-line py-1 pr-1 pl-4">
				<StatusMark state={cell.held ? 'held' : 'newest'} />
				<span class="t-card-title min-w-0 truncate text-fg">{cell.service}</span>
				{#if cell.col !== NO_ENV}
					<Chip role="env" theme={getRolloutEnvironmentTheme(null, cell.col)} label={cell.col} />
				{:else}
					<span class="t-meta text-fg-subtle">No environment</span>
				{/if}
				<button type="button" class="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:text-fg" aria-label="Close" onclick={onclose} data-sheet-close>
					<CloseOutline class="h-5 w-5" />
				</button>
			</div>

			<div class="flex flex-col gap-4 px-4 pt-3 pb-2">
				{#if cell.held && cell.reason}
					<p class="t-ui flex items-start gap-2 text-held">
						<HeldGlyph size={16} class="mt-[2px]" />
						<span class="min-w-0">
							Held · {cell.reason}{#if since}<span class="text-fg-subtle">{' · '}{since}</span>{/if}
						</span>
					</p>
				{/if}

				<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
					{#if inbound.length}
						<dt class="t-label pt-[2px] text-fg-subtle">Needs</dt>
						<dd class="flex flex-col gap-1">
							{#each inbound as l (l.key)}
								<span class="t-meta {l.held ? 'text-held' : 'text-fg-muted'}">
									<span class="font-medium {l.held ? '' : 'text-fg'}">{l.contract}</span>
									{l.needs.length ? l.needs.join(', ') : ''} from {svcOf(l.from)}{#if l.serves}<span class={l.held ? '' : 'text-fg-subtle'}>{' · '}has {l.serves}</span>{/if}{#if l.held && l.heldCount < cell.sites.length && cell.sites.length > 1}{' · '}<span class="whitespace-nowrap">{regionShare(l.heldCount, cell.sites.length)}</span>{/if}
								</span>
							{/each}
						</dd>
					{/if}
					{#if outbound.length}
						<dt class="t-label pt-[2px] text-fg-subtle">Serves</dt>
						<dd class="t-meta text-fg-muted">
							<span class="font-medium text-fg">{[...new Set(outbound.map((l) => l.contract))].join(', ')}</span>
							{#if outbound[0].serves}<span class="t-code-sm"> {outbound[0].serves}</span>{/if}
							to {outbound.map((l) => svcOf(l.to)).join(', ')}{#if outbound.some((l) => l.held)}<span class="text-held">{' · '}{outbound.filter((l) => l.held).length} held</span>{/if}
						</dd>
					{/if}
					{#if promoIn}
						<dt class="t-label pt-[2px] text-fg-subtle">Order</dt>
						<dd class="t-meta text-held">waits for {colLabel(model.cells.get(promoIn.from)?.col ?? '')}</dd>
					{/if}
					{#if path.length > 1}
						<dt class="t-label pt-[2px] text-fg-subtle">Path</dt>
						<dd class="t-meta flex flex-wrap items-center gap-x-1.5 gap-y-1">
							{#each path as s, i (s.cell.key)}
								{#if i > 0}<span class="{s.link?.held ? 'text-held' : 'text-fg-disabled'}" aria-hidden="true">›</span>{/if}
								<span class="inline-flex items-center gap-1 {s.cell.key === cell.key ? 'font-semibold text-fg' : s.cell.held ? 'text-held' : 'text-fg-muted'}">
									{colLabel(s.col)}
									<span class="t-code-sm {s.cell.key === cell.key ? '' : 'text-fg-subtle'}">{s.cell.sites.length > 1 ? `${s.cell.sites.length} regions` : (s.cell.build ?? '—')}</span>
								</span>
							{/each}
						</dd>
					{/if}
				</dl>

				{#if cell.sites.length > 1}
					<div>
						<p class="t-label mb-1 text-fg-subtle">{cell.sites.length} regions{#if cell.held}<span class="text-held">{' · '}{cell.held} held</span>{/if}</p>
						<ul class="divide-y divide-line-subtle rounded-md border border-line-subtle dark:divide-line dark:border-line">
							{#each cell.sites as s (s.node.id)}
								<li>
									<a href={href(`/rollouts/${s.node.cluster}/${s.node.namespace}/${s.node.name}`)} class="flex min-h-10 items-center gap-2 px-3">
										<span class="t-meta w-6 shrink-0 tabular-nums text-fg-disabled">{s.wave != null ? `W${s.wave}` : ''}</span>
										<span class="t-meta min-w-0 truncate text-fg">{s.site}</span>
										<span class="t-code-sm ml-auto shrink-0 text-fg-muted">{s.node.build ?? '—'}</span>
										<span class="w-3 shrink-0">{#if s.held}<HeldGlyph size={12} class="text-held" title={s.reason ?? 'Held'} />{/if}</span>
									</a>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			<div class="flex items-center gap-2 border-t border-line-subtle dark:border-line px-2 pt-1">
				<a href={openHref} class="nav-link min-h-11 flex-1 justify-center" data-sheet-open>
					Open {cell.nodes.length === 1 ? `${cell.service} in ${colLabel(cell.col)}` : cell.service} ›
				</a>
			</div>
		</div>
	</div>
{/if}
