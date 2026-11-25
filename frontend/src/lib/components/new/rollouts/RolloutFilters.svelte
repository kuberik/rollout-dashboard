<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE /rollouts FILTER BAR (R7, owner 2026-11-21): a search box and three multi-select chip rows above "All rollouts".
	 * ROLE: narrow the list to what a person is looking for. REFERENCE: Activity's filter chips (FilterChip, the one chip). WHY A NEW COMPONENT: no list page
	 * has a search box over chips; the sidebar's Ctrl K is the palette, not a page filter. Proportions borrow the sidebar search (border, surface, kbd hint).
	 * No "STATUS / ENV / NAMESPACE" label column: each row names itself by what its chips carry (state chips their StatusMark, env chips the env tint,
	 * namespace chips a folder glyph). Empty selection = everything, so there is no "All" pill; rows WRAP (never scroll sideways, 390 included);
	 * one "Clear" text button appears only while something is set. '/' focuses the box when focus is not already in a field; Esc clears and blurs.
	 * Pure logic (what matches, the counts, the URL) is rollouts-filter.ts; this file draws and reports `onchange`.
	 */
	import { SearchOutline, FolderOutline } from 'flowbite-svelte-icons';
	import FilterChip from '$lib/components/FilterChip.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import { envTheme } from '../rollout-view';
	import { STATE_WORD, isFiltered, toggled, type RolloutFilter, type Facets, type StateKey } from '../rollouts-filter';

	let { filter, facets, onchange }: { filter: RolloutFilter; facets: Facets; onchange: (f: RolloutFilter) => void } = $props();
	let input: HTMLInputElement | undefined = $state();
	/** a long namespace row folds behind one pill (the busiest first; a selected one is always shown): the search box finds the rest */
	let phone = $state(false);
	$effect(() => {
		const mq = matchMedia('(max-width: 639px)');
		phone = mq.matches;
		const on = () => (phone = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});
	const NS_CAP = $derived(phone ? 4 : 8);
	let nsAll = $state(false);
	const nsShown = $derived(nsAll ? facets.ns : facets.ns.filter((o, i) => i < NS_CAP || o.selected));
	const nsHidden = $derived(facets.ns.length - nsShown.length);
	const MARK: Record<StateKey, 'deploying' | 'approval' | 'held' | null> = { progress: 'deploying', waiting: 'approval', held: 'held', rest: null };

	const inField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
	function onkey(e: KeyboardEvent) {
		if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !inField(e.target)) { e.preventDefault(); input?.focus(); input?.select(); }
	}
	function inputKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		if (filter.q) onchange({ ...filter, q: '' });
		input?.blur();
	}
</script>

<svelte:window onkeydown={onkey} />

<div class="rf flex min-w-0 flex-col gap-3" data-rollout-filters>
	<div class="flex min-w-0 items-center gap-3">
		<label class="rf-search relative flex min-w-0 flex-1 items-center">
			<SearchOutline class="pointer-events-none absolute left-2.5 h-4 w-4 text-fg-subtle" aria-hidden="true" />
			<input bind:this={input} type="text" value={filter.q} oninput={(e) => onchange({ ...filter, q: e.currentTarget.value })} onkeydown={inputKey}
				class="rf-in t-ui h-9 w-full rounded-md border border-line bg-surface pl-8 pr-10 text-fg placeholder:text-fg-subtle hover:border-line-strong focus:border-line-strong focus:outline-none"
				placeholder="Search name, namespace, version" aria-label="Search rollouts" autocomplete="off" autocapitalize="off" spellcheck="false" data-rollout-search />
			<kbd class="t-code-sm pointer-events-none absolute right-2 hidden rounded-xs border border-line px-1 text-fg-subtle sm:block" aria-hidden="true">/</kbd>
		</label>
		{#if isFiltered(filter)}
			<button type="button" class="nav-link shrink-0" onclick={() => onchange({ q: '', state: [], env: [], ns: [] })} data-filter-clear>Clear</button>
		{/if}
	</div>
	{#if facets.state.length > 1}
		<ul class="rf-row" role="group" aria-label="State">
			{#each facets.state as o (o.value)}
				{@const mk = MARK[o.value]}
				<li><FilterChip selected={o.selected} count={o.count} dot={mk ? null : 'bg-fg-disabled'} onclick={() => onchange({ ...filter, state: toggled(filter.state, o.value) })}>
					{#if mk}<span class="inline-grid h-4 w-4 place-items-center"><StatusMark state={mk} /></span>{/if}{STATE_WORD[o.value]}
				</FilterChip></li>
			{/each}
		</ul>
	{/if}
	{#if facets.env.length > 1}
		<ul class="rf-row" role="group" aria-label="Environment">
			{#each facets.env as o (o.value)}
				<li><FilterChip selected={o.selected} count={o.count} onclick={() => onchange({ ...filter, env: toggled(filter.env, o.value) })}><Chip role="env" theme={envTheme(o.value)} label={o.value} /></FilterChip></li>
			{/each}
		</ul>
	{/if}
	{#if facets.ns.length > 1}
		<ul class="rf-row" role="group" aria-label="Namespace">
			{#each nsShown as o (o.value)}
				<li><FilterChip selected={o.selected} count={o.count} onclick={() => onchange({ ...filter, ns: toggled(filter.ns, o.value) })}><FolderOutline class="h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" />{o.value}</FilterChip></li>
			{/each}
			{#if nsHidden > 0 || (nsAll && facets.ns.length > NS_CAP)}
				<li><button type="button" class="pill" onclick={() => (nsAll = !nsAll)} data-ns-fold>{nsAll ? 'Fewer' : `${nsHidden} more`}</button></li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	.rf-row { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0; padding: 0; }
	/* the pills sit inside <li>, so app.css's phone rule (a row of direct pills scrolls sideways) does not apply: these rows wrap */
	@media (max-width: 639px) { .rf-row { gap: 6px; } .rf-row :global(.pill) { min-height: 36px; padding: 0 7px; gap: 4px; } }
</style>
