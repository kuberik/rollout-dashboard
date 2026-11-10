<!--
	A block that LEAVES instead of vanishing. (2026-10-08, film critic: the
	Retry beat.)

	Pass the data the block shows as `value`; `null`/`undefined`/`false` means
	"not shown". While shown, `children(value)` renders it. When it stops being
	shown, the block stays mounted for one 300 ms collapse — the same CSS
	grid-row transition and symmetric ease as `AlertPanel`'s `open`, which the
	capture harness advances — rendering the LAST value it had, so it says what
	it said on the way out, and the rows beneath it glide up instead of jumping.
	Never-shown renders nothing.

	`class` goes on the collapsing wrapper (spacing that should collapse with
	the block, e.g. `mt-2`).
-->
<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';

	let {
		value,
		children,
		class: className = ''
	}: { value: T | null | undefined | false; children: Snippet<[T]>; class?: string } = $props();

	const shown = $derived(value !== null && value !== undefined && value !== false);
	// svelte-ignore state_referenced_locally
	let last = $state.raw<T | null>(shown ? (value as T) : null);
	let closing = $state(false);
	let wasShown = false;
	$effect.pre(() => {
		const isShown = shown;
		const v = value;
		if (isShown) {
			last = v as T;
			wasShown = true;
			closing = false;
			return;
		}
		if (!wasShown) return;
		wasShown = false;
		closing = true;
		// Unmount when the collapse has actually finished (`transitionend`, see
		// the wrapper), not on a fixed timer: under load the transition can
		// start late, and a 340 ms timer then cut it off mid-way — the last
		// half of the banner vanished in one frame. This is only the fallback.
		const t = setTimeout(() => (closing = false), 900);
		return () => clearTimeout(t);
	});
</script>

{#if (shown || closing) && last !== null}
	<div
		class="leaving {className}"
		class:leaving--closing={!shown}
		inert={!shown}
		ontransitionend={(e) => {
			if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows' && !shown) closing = false;
		}}
	>
		<div class="leaving-inner">
			{@render children(last)}
		</div>
	</div>
{/if}

<style>
	.leaving {
		display: grid;
		grid-template-rows: 1fr;
		transition:
			grid-template-rows 300ms cubic-bezier(0.45, 0, 0.55, 1),
			margin 300ms cubic-bezier(0.45, 0, 0.55, 1);
	}
	.leaving--closing {
		grid-template-rows: 0fr;
		margin-top: 0 !important;
		margin-bottom: 0 !important;
	}
	.leaving-inner {
		min-height: 0;
		transition: opacity 150ms cubic-bezier(0.45, 0, 0.55, 1);
	}
	/* The content stays rendered at full size and FADES while the box
	   collapses round it, so no frame loses content abruptly: the first frames
	   of the collapse move a few px of box edge, never a line of text. */
	.leaving--closing > .leaving-inner {
		opacity: 0;
	}
	.leaving--closing > .leaving-inner {
		overflow: hidden;
	}
	@media (prefers-reduced-motion: reduce) {
		.leaving,
		.leaving-inner {
			transition: none;
		}
	}
</style>
