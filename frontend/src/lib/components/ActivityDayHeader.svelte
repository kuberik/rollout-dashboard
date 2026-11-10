<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ACTIVITY DAY HEADER: one day of an activity feed, named.
	 *
	 * ROLE: the header over a day's activity rows: its label, ONE single-fill
	 * volume bar (that day's share of the busiest day shown) and "N deploys · M
	 * failed". Failures are words in danger ink only while one is still its
	 * rollout's current state (`open`); a day whose failures were all resolved
	 * reads "· M failed · resolved" in neutral ink. Never a red segment.
	 *
	 * WHY A COMPONENT: ActivityRail (Home, /apps, …) drew it inline, and the
	 * repository page's Recent activity needs the identical header. Extracted
	 * from ActivityRail verbatim (squad-fleet's cb61b0c `open` rule included),
	 * so the two can never drift.
	 */
	let {
		label,
		count,
		busiest,
		failed = 0,
		open = 0
	}: {
		/** "Today", "Yesterday", a weekday or a date. */
		label: string;
		/** Deploys that day. */
		count: number;
		/** The busiest day's count among those shown (the bar's 100%). */
		busiest: number;
		/** Failed deploys that day. */
		failed?: number;
		/** Of those, failures that are still their rollout's current state. */
		open?: number;
	} = $props();
</script>

<div class="mb-3 flex items-center gap-3">
	<span class="t-label shrink-0 text-fg-subtle">{label}</span>
	<span class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
		<span
			class="block h-full rounded-full bg-fg-subtle"
			style="width: {Math.max(4, Math.round((count / busiest) * 100))}%"
		></span>
	</span>
	<span class="t-meta shrink-0 tabular-nums text-fg-subtle"
		>{count} deploy{count === 1 ? '' : 's'}{#if failed}<span class={open > 0 ? 'text-danger' : ''} data-failed-open={open > 0 ? 'true' : 'false'}
			>{' · '}{failed} failed{#if open === 0}{' · resolved'}{/if}</span
		>{/if}</span
	>
</div>
