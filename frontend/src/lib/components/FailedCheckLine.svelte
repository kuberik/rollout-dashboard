<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ ONE FAILED CHECK, ONE LINE — EXTRACTED FOR ITS OWN TEST (History
	 * round 14, AD round 10, D4, binding — coordinator follow-up, 2026-10-12:
	 * "add the D4 unit test… using a synthetic history in the test, not the
	 * shared scenario").
	 *
	 * Lived inline in the History tab's expanded panel until now. The mock
	 * fixtures carry exactly one `failedHealthChecks` array in the whole
	 * demo (the incident's own live row), so there was no "past, resolved"
	 * example to point a render test at without mutating that shared
	 * scenario's state — which other lanes' own screenshots depend on
	 * staying failed. Pulling the row into its own component with a plain
	 * `danger` boolean prop makes the muted-vs-danger behaviour testable
	 * with synthetic props, the same way `history-deeplink.ts`'s pure
	 * functions are tested without a live rollout.
	 *
	 * Glyph + check name in danger ink, message in fg-muted (AD round 8,
	 * item 6) — UNLESS `danger` is false, in which case the whole line
	 * reads fg-muted (AD round 10, D4): "a resolved failed check keeps the
	 * same line shape (glyph · check name · message), muted." Only the ink
	 * changes; the glyph, the colon, and the message's own muted tier stay
	 * the same shape either way.
	 *
	 * ⭐ `.check-line`, 14px AT `lg`+ (History round 15, AD round 11, item
	 * 7, binding): "the failed-check line is 14px, matching the Overview's
	 * failure line — measure the Overview's own computed size to match."
	 * Measured live: the Overview tab's own failure line is `t-body`
	 * (14px/20px/400) — this scoped class (Svelte's own scoping attribute
	 * beats a plain `.t-meta` class selector regardless of source order,
	 * same fix as `.build-id`'s own note in the History page) moves ONLY
	 * this line there at `lg`+; below `lg` it stays `t-meta`'s 12px, which
	 * reads correctly beside the panel's other facts at that width.
	 *
	 * ⭐ NO TRAILING COLON WITH NO MESSAGE (History round 15, AD round 11,
	 * item 7): a check with a name but no message would otherwise print
	 * "checkout-worker-high-error-rate:" with nothing after the colon — a
	 * label introducing a value that never arrives. The colon is part of
	 * the PAIRING (name: message), so it only prints when there is a
	 * message to pair it with.
	 */
	import { ExclamationCircleSolid } from 'flowbite-svelte-icons';

	interface Props {
		check: { name: string; message?: string };
		/** True for the open/live failure (History's own `isCurrent`); false
		 * for a past row whose failure a later deploy has already superseded. */
		danger: boolean;
		/** Hover-card scale (round 16, AD round 12, item 1): stays at `t-meta`'s
		 * 12px at every width and clamps to two lines. The History panel's own
		 * 14px-at-`lg` weight is for the panel, not the strip's small card. */
		compact?: boolean;
		/** apps-9 AQ1 (additive): the check NAME prints in ink (as the tab's banner does); only the 16px glyph keeps the danger hue. Default false = unchanged. */
		ink?: boolean;
	}

	let { check, danger, compact = false, ink = false }: Props = $props();
</script>

<div
	class="t-meta flex items-start gap-1.5 {compact ? '' : 'check-line'} {danger
		? 'text-danger'
		: 'text-fg-muted'}"
>
	<ExclamationCircleSolid class="check-glyph h-3 w-3 shrink-0 translate-y-0.5" aria-hidden="true" />
	<span class={compact ? 'line-clamp-2' : ''}
		><span class={ink ? 'text-fg' : danger ? 'text-danger' : 'text-fg-muted'}
			>{check.name}{check.message ? ':' : ''}</span
		>
		{#if check.message}
			<span class="text-fg-muted">{check.message}</span>
		{/if}</span
	>
</div>

<style>
	@media (min-width: 1024px) {
		.check-line {
			font-size: 14px;
			line-height: 20px;
		}
		/* build-r4 (AD /needs-you r2 #9, additive): a 12px glyph centred on a 20px line sits 4px down, not 1 (it measured 3px high) */
		.check-line :global(.check-glyph) {
			transform: translateY(3px);
		}
	}
</style>
