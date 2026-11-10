<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE LEADING GLYPH OF A DENSE LIST ROW, WITH A QUIET "AT REST" FORM.
	 *
	 * ROLE: the 16px status slot at the start of a row in a dense list (Home's
	 * Trailing and Steady). A healthy rollout that has been healthy for a while
	 * draws a 6px `success-solid` dot centred in the slot; the filled check
	 * (`BakeStatusIcon`) is kept for anything else — just succeeded (within
	 * `recentMs` of `timestamp`), in flight, failed, or carrying a state mark
	 * (held, pinned, rolled back).
	 *
	 * WHY: measured by the design review (2026-10-08) — ~45 filled green checks
	 * down Trailing/Steady were the loudest repeated mark on Home, louder than
	 * the one red and the held marks that should lead. Same 16px slot, so the
	 * names stay aligned whichever form a row draws. Check-result rows inside a
	 * Card (Health checks) keep the check: there the glyph IS the result.
	 * Proportions: the 16px slot of `BakeStatusIcon size="small"`, the 6px of
	 * `.section-dot`.
	 */
	import BakeStatusIcon from './BakeStatusIcon.svelte';

	let {
		bakeStatus,
		state = null,
		stateWord = '',
		timestamp = null,
		recentMs = 30 * 60 * 1000,
		now = Date.now(),
		behind = false,
		behindLabel = 'behind the newest build',
		class: className = ''
	}: {
		bakeStatus?: string;
		state?: 'rolled-back' | 'pinned' | 'held' | null;
		stateWord?: string;
		timestamp?: string | null;
		recentMs?: number;
		now?: number;
		/** The rollout is not on its app's newest build (lane state 'behind').
		 *  At rest it draws StatusMark's hollow neutral ring, never the green
		 *  "on the newest" dot (home-map 9f80a88: one behind mark product-wide). */
		behind?: boolean;
		/**
		 * ⭐ ITEM 5 (AD palette round 8): THE SR-ONLY TEXT MUST SAY WHAT THE
		 * ROW'S OWN FACT SAYS. Measured live: `payments-core`
		 * `prod-eu-central`'s rank fact read "unreleased" while this glyph's
		 * fixed sr-only text said "behind the newest build" — two words for
		 * one build, and the fact ("unreleased": never promoted anywhere, not
		 * merely N releases back) is the truth. Callers that distinguish
		 * "behind" from "diverged/unreleased" (`env-rank.ts`'s `rankLabel`)
		 * pass that exact string here so the two can never say two things
		 * about the same build again; callers that don't make the
		 * distinction keep the original default.
		 */
		behindLabel?: string;
		class?: string;
	} = $props();

	const atRest = $derived(
		bakeStatus === 'Succeeded' &&
			!state &&
			!(timestamp && now - new Date(timestamp).getTime() < recentMs)
	);
</script>

{#if atRest}
	<span class="inline-flex h-4 w-4 shrink-0 items-center justify-center {className}">
		{#if behind}
			<span class="sr-only">{behindLabel}</span>
			<span class="h-2 w-2 rounded-full ring-[1.5px] ring-inset ring-fg-subtle" aria-hidden="true" data-mark="behind"></span>
		{:else}
			<span class="sr-only">deploy succeeded</span>
			<span class="h-1.5 w-1.5 rounded-full bg-success-solid" aria-hidden="true"></span>
		{/if}
	</span>
{:else}
	<BakeStatusIcon {bakeStatus} size="small" {state} {stateWord} class="shrink-0 {className}" />
{/if}
