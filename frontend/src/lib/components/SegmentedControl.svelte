<svelte:options runes={true} />

<script lang="ts" generics="T extends string">
	/**
	 * SEGMENTED CONTROL: one single-select choice drawn as one object. Today it
	 * is the time window (History's `1d 7d 30d All`, /activity's
	 * `1h 6h 1d 7d 30d All`).
	 *
	 * ROLE: a VIEW choice with exactly one value, never a filter. Before this
	 * (visual audit #5, 2026-11-13) the same window control had two looks on two
	 * pages: History drew four separate bordered `.pill`s (the multi-select
	 * FILTER grammar) and /activity drew borderless `btn-ghost` segments with an
	 * 8% wash. Neither followed the toggle rule in `lib/CLAUDE.md` ("selected
	 * toggles are gray-900 light / gray-100 dark").
	 *
	 * Why nothing existing fits: `.pill` is multi-select (each pill is its own
	 * box, its selected state is a wash), `.btn[aria-pressed]` is a lone
	 * on/off switch. A set of mutually exclusive values wants ONE track so the
	 * reader sees "pick one of these" before reading any label.
	 *
	 * Proportions borrow the `.pill` row it replaces (28px tall, 12px/500,
	 * 6px outer radius) and the selected fill is `.pill-selected`'s inverse
	 * (`--k-inverse` / `--k-fg-inverse`), so it is the product's existing
	 * selected-toggle ink, not a new colour. Inside: 2px inset, 4px segment
	 * radius. Below `sm` the track is 44px (the phone tap-target rule the
	 * filter pills follow) and `fill` spreads the segments across the width.
	 *
	 * Buttons keep `aria-pressed` (the contract the callers' tests read).
	 */
	type Option = { value: T; label: string; title?: string };

	let {
		options,
		value,
		onChange,
		label,
		fill = false,
		disabled = false,
		class: className = ''
	}: {
		options: Option[];
		value: T | null;
		onChange: (v: T) => void;
		/** the group's accessible name (`Time range`) */
		label: string;
		/** stretch the segments to the track's full width (a phone row of its own) */
		fill?: boolean;
		disabled?: boolean;
		class?: string;
	} = $props();
</script>

<div class="seg {fill ? 'seg-fill' : ''} {className}" role="group" aria-label={label}>
	{#each options as o (o.value)}
		<button
			type="button"
			class="seg-btn tabular-nums"
			aria-pressed={value === o.value}
			title={o.title}
			{disabled}
			onclick={() => onChange(o.value)}>{o.label}</button
		>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		flex: none;
		align-items: stretch;
		gap: 2px;
		height: 28px;
		padding: 2px;
		border: 1px solid var(--k-line);
		border-radius: 6px;
		background-color: var(--k-surface);
	}
	.seg-fill {
		display: flex;
		width: 100%;
	}
	.seg-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 32px;
		padding: 0 8px;
		border-radius: 4px;
		color: var(--k-fg-muted);
		font-size: 12px;
		line-height: 16px;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--k-dur-fast) var(--ease-out),
			color var(--k-dur-fast) var(--ease-out);
	}
	.seg-fill .seg-btn {
		flex: 1 1 0;
	}
	.seg-btn:hover:not(:disabled):not([aria-pressed='true']) {
		background-color: var(--k-selected);
		color: var(--k-fg);
	}
	.seg-btn[aria-pressed='true'] {
		background-color: var(--k-inverse);
		color: var(--k-fg-inverse);
	}
	.seg-btn:disabled {
		cursor: default;
		opacity: 0.5;
	}
	@media (max-width: 639.98px) {
		.seg {
			height: 44px;
		}
	}
</style>
