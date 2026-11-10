<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE TOAST. A transient confirmation of something the reader just did
	 * ("Deploy started", "Pin cleared"). Never a place for a problem the page
	 * itself must show — that is a banner (`AlertPanel`).
	 *
	 * WHY A COMPONENT: three call sites drew Flowbite's `Toast` with three
	 * different icon boxes and colour pairs. Proportions borrow the banner's
	 * anatomy at overlay scale: an OVERLAY surface (it floats, so it is one of
	 * the two things in the product that casts a shadow), 8px radius, a 16px
	 * status glyph in its hue, the message in `t-body`, a ghost dismiss.
	 * THE HOUSE POSITION (U-30/S-4 and integration round 3 item 3, coordinator
	 * decisions, 2026-10-08/09). From `sm`: fixed bottom-right (top-right sat
	 * over the Health checks card at 1440); a page whose last rows could sit
	 * under it reserves end-of-page clearance (the rollout Overview's
	 * `TOAST_DOCK_CLEARANCE`). On a phone: over the fixed APP BAR, 4px below
	 * the safe area, 8px gutters. The 44px one-line toast fits inside the 52px
	 * bar, so at rest it covers only the bar's controls. Once the header has
	 * auto-hidden on scroll, it sits over the top of the content instead
	 * (qa8 S1): briefly, and never over the row the reader acted on, which is
	 * below where they tapped. Both
	 * content docks failed: under the header it covered the page's h1, and
	 * above the tab bar it covered the pipeline's Check row right after Retry
	 * at scroll 0 (qa7, measured; end-of-page clearance only helps once the
	 * reader scrolls). A toast may cover chrome briefly; never the row the
	 * reader just acted on. Call sites never pass a position.
	 *
	 * qa9 B2: "over the bar" only holds while the bar is actually there. The
	 * same auto-hide that frees up phone scroll space (`ScrollDirectionTracker`)
	 * can hide the bar out from under a toast that is already docked at its
	 * position, landing it over page content instead. While a floating toast
	 * is open it registers with `toastVisibility` (`$lib/stores/toast-visibility.svelte`),
	 * which the root layout reads to keep the header revealed — auto-hide
	 * resumes the instant the toast closes. Non-floating (`floating={false}`)
	 * render is the design specimen only and never registers.
	 * Enter: 160ms fade + 8px rise; leave: 120ms fade. Status is the ICON's
	 * colour only — the toast body stays neutral.
	 */
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import {
		CheckCircleSolid,
		ExclamationCircleSolid,
		InfoCircleSolid,
		CloseOutline
	} from 'flowbite-svelte-icons';
	import StatusSpinner from './StatusSpinner.svelte';
	import { showToast, hideToast } from '$lib/stores/toast-visibility.svelte';
	import { untrack, type Snippet } from 'svelte';

	type Tone = 'success' | 'danger' | 'info' | 'loading';

	let {
		open = $bindable(false),
		tone = 'info',
		message = '',
		dismissable = true,
		floating = true,
		description = '',
		children,
		action
	}: {
		open?: boolean;
		tone?: Tone;
		message?: string;
		dismissable?: boolean;
		/** `false` renders in flow (the design specimen); never false in product. */
		floating?: boolean;
		/**
		 * ⭐ LANE P, §5 (2026-10-09, TL-approved, additive): a second line,
		 * under `message`, for the fact the confirmation's own title has no
		 * room for — "Deploy requested" / "9a1f4c2 is deploying to prod."
		 * `t-meta text-fg-muted`, same ink a card's own subtitle uses.
		 * Omitted call sites render exactly as before: a toast with no
		 * `description` is one line, unchanged.
		 */
		description?: string;
		/**
		 * ⭐ LANE P, §5 (2026-10-09, TL-approved, additive); ⭐ ROUND 3, ITEM
		 * 13 (AD): one `.nav-link` after a deploy ("View logs") — the
		 * toast's own one destination, not a second button (§0 rule 7). Now
		 * sits BESIDE the one-line text, not below it (see the template) —
		 * a stacked action row was what pushed a two-line toast to three on
		 * a phone, which is what covered the title/pill underneath.
		 */
		action?: Snippet;
		children?: Snippet;
	} = $props();

	const ICON = { success: CheckCircleSolid, danger: ExclamationCircleSolid, info: InfoCircleSolid };
	const INK: Record<Tone, string> = {
		success: 'text-success',
		danger: 'text-danger',
		info: 'text-fg-subtle',
		loading: 'text-active'
	};
	const Icon = $derived(tone === 'loading' ? null : ICON[tone]);

	// qa9 B2: while this floating toast is open, suspend the header's scroll
	// auto-hide so the toast's dock position never lands over content. The
	// effect's cleanup (re-run on every `open`/`floating` change, and on
	// unmount) is what guarantees `hideToast()` always pairs with a prior
	// `showToast()`. Both calls are wrapped in `untrack()` — `showToast()`'s
	// `showing += 1` both reads and writes the shared counter, and without
	// `untrack` that read makes THIS effect depend on `showing`, so its own
	// write to `showing` re-triggers it: an infinite `effect_update_depth_exceeded`
	// loop (reproduced in dev before this fix).
	$effect(() => {
		if (open && floating) {
			untrack(showToast);
			return () => untrack(hideToast);
		}
	});
</script>

{#if open}
	<div
		role={tone === 'danger' ? 'alert' : 'status'}
		class="{floating
			? 'fixed right-2 left-2 z-[60] top-[calc(env(safe-area-inset-top,0px)+4px)] sm:top-auto sm:right-4 sm:bottom-4 sm:left-auto sm:w-[380px]'
			: 'relative w-full max-w-[380px]'} flex items-start gap-3 rounded-md bg-overlay px-4 py-3"
		style="box-shadow: var(--k-shadow-overlay)"
		in:fly={{ y: 8, duration: 160, easing: cubicOut }}
		out:fade={{ duration: 120 }}
	>
		<span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center {INK[tone]}">
			{#if Icon}
				<Icon class="h-4 w-4" />
			{:else}
				<StatusSpinner size="4" color="blue" />
			{/if}
		</span>
		<!-- On a phone the toast lives inside the 52px app bar, so a
		     confirmation is ONE line (full text in `title`); only a danger
		     toast may wrap, because its words are the thing to read. -->
		<div
			class="t-body min-w-0 flex-1 text-fg {floating && tone !== 'danger' ? 'max-sm:truncate' : ''}"
			title={floating && tone !== 'danger' && message
				? description
					? `${message} · ${description}`
					: message
				: undefined}
		>
			{#if children}{@render children()}{:else}{message}{#if description}<span class="text-fg-muted"
						> · {description}</span
					>{/if}{/if}
		</div>
		{#if action}
			<div class="shrink-0">{@render action()}</div>
		{/if}
		{#if dismissable}
			<button
				type="button"
				class="btn btn-ghost btn-icon btn-xs -my-1 -mr-2"
				aria-label="Dismiss"
				onclick={() => (open = false)}
			>
				<CloseOutline class="h-3 w-3" />
			</button>
		{/if}
	</div>
{/if}
