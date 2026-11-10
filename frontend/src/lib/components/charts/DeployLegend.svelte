<svelte:options runes={true} />

<script lang="ts">
	/**
	 * DEPLOY LEGEND — the key for `DeployBars`, for a Card header's rollup.
	 * (Shared by Home's Deploys card and /activity so the two cannot drift,
	 * coordinator 2026-10-10.)
	 *
	 * Three swatches, each shown only when the chart draws it:
	 *   deploys        — always (the single fill);
	 *   reached prod   — when some bucket has `emphasis` (the darker depth of
	 *                    the same fill);
	 *   <previousLabel> — when `previous` is set (the bar behind each bar).
	 * Swatches are drawn with the exact fills DeployBars uses. Hidden below
	 * `sm` in the header; `placement="below"` is the phone's one-line key under
 * the plot (squad-changes /activity AD), so phones are never legend-less.
	 */
	import type { DeployBucket } from '$lib/view-models/deploy-bars';

	let {
		buckets,
		previous = null,
		previousLabel = 'the period before',
		reachedLabel = 'reached prod',
		placement = 'header',
		class: className = ''
	}: {
		buckets: DeployBucket[];
		previous?: DeployBucket[] | null;
		previousLabel?: string;
		reachedLabel?: string;
		/** `header`: the Card rollup, from sm up. `below`: a one-line key under
		 *  the plot, below sm only (a phone header has no room). Render both. */
		placement?: 'header' | 'below';
		class?: string;
	} = $props();

	const hasEmphasis = $derived(buckets.some((b) => b.emphasis));
	const hasPrevious = $derived(!!previous && previous.some((b) => b.count > 0));
</script>

<span
	class="dl text-fg-subtle {placement === 'below'
		? 't-meta flex flex-wrap items-center gap-x-3 gap-y-1 sm:hidden'
		: 't-ui-sm hidden items-center gap-3 sm:inline-flex'} {className}"
>
	<span class="inline-flex items-center gap-1.5"><span class="dl-sw dl-bar"></span>deploys</span>
	{#if hasEmphasis}<span class="inline-flex items-center gap-1.5"><span class="dl-sw dl-em"></span>{reachedLabel}</span>{/if}
	{#if hasPrevious}<span class="{placement === 'below' ? 'inline-flex' : 'hidden md:inline-flex'} items-center gap-1.5"><span class="dl-sw dl-prev"></span>{previousLabel}</span>{/if}
</span>

<style>
	.dl-sw {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	/* The same fills as DeployBars' .db-bar / .db-bar-em / .db-ghost. */
	.dl-bar {
		background: color-mix(in oklab, var(--k-fg-subtle) 55%, transparent);
	}
	.dl-em {
		background: var(--k-fg-muted);
	}
	.dl-prev {
		background: color-mix(in oklab, var(--k-fg-subtle) 22%, transparent);
		box-shadow: inset 0 1.5px 0 var(--k-fg-subtle);
	}
</style>
