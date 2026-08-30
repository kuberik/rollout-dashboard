<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE CARD. The product's one titled panel.
	 *
	 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
	 *
	 * Six pages were rebuilt without it and every one was rejected. The
	 * measured diagnosis (`.agents-context/design/COMPOSITION-GRAMMAR.md`):
	 *
	 *   | page           | SVG icons in <main> | card radii | verdict                    |
	 *   | rollout detail | 115                 | 8px + 12px | "beautiful"                |
	 *   | /apps          | 4                   | 12px only  | rejected                   |
	 *   | /versions      | 0                   | 12px only  | "criminally underdesigned" |
	 *
	 * Every region on rollout detail is a card with a HEADER BAR. Every
	 * rejected page is a bordered box with a `t-label` caption floating above
	 * it, or no header at all. That difference is the whole diagnosis, and it
	 * had no component, so three pages were about to invent three of them.
	 *
	 * ── THE GEOMETRY IS MEASURED, NOT CHOSEN ────────────────────────────────
	 *
	 * Every number below was read off the running rollout-detail page
	 * (`/rollouts/prod/hello-world-prod/hello-world-app`, 1440, light) with
	 * `getComputedStyle`, not derived from taste:
	 *
	 *   border-radius   8px          ← `Deployment Pipeline`, `Health Checks`,
	 *                                  `Resources`, `Recent Events`, all four
	 *   header padding  12px 16px    ← measured 45px tall; this component
	 *                                  floors it at 47 so an iconless header
	 *                                  and a chip-bearing one are one height
	 *   header border   1px bottom   ← neutral border colour, not a shadow
	 *   title           14px / 600   ← NOT 16px. COMPOSITION-GRAMMAR.md says
	 *                                  16; the rendered page says 14/600 and
	 *                                  the page is the authority.
	 *   verdict         12px         ← `5/5 done`, `3/3 healthy`, `10/10 ready`
	 *   icon            16px (h-4)   ← every card header on the reference has
	 *                                  one. If a card has a title, it has an
	 *                                  icon.
	 *
	 * ⛔ 8px IS LEGAL. `DESIGN.md`'s "exactly two radii — 12px panels, 4px
	 * chips" rule literally forbade the shape the good page is built from and
	 * is superseded. 12px stays for the OUTERMOST panel, 4px stays for chips,
	 * 8px is the card.
	 *
	 * ── THE RIGHT-ALIGNED ROLLUP IS THE POINT ───────────────────────────────
	 *
	 * `3/3 healthy`, `10/10 ready`, `5/5 done`. It lets a reader take a card's
	 * ANSWER without reading a row of it, and it is the single most
	 * transferable thing on the reference page. A card with a header and no
	 * rollup is half the pattern. Pass `verdict` (a string) or the `rollup`
	 * snippet (chips, a link, a button) — never both.
	 *
	 * THE SHADOW IS NEAR-ZERO ON PURPOSE. Separation comes from the 1px border
	 * against the tinted page ground, exactly as on the reference. A card that
	 * needs `shadow-lg` to be visible is a card on the wrong ground.
	 */
	import type { Component, Snippet } from 'svelte';

	/**
	 * The verdict's ink. FOUR VALUES, all already in the closed budget — this
	 * component adds no colour.
	 *
	 *   neutral  gray   the count is a denominator, not a state
	 *   good     green  `green-700` / `green-400`, the product's ONE state
	 *                   green — the same value the reference prints
	 *                   `3/3 healthy` in (measured oklch(0.527 0.154 150.069))
	 *   adverse  red    `Failed` / `diverged` / `−N`'s red
	 *   active   blue   `Deploying`
	 *
	 * There is deliberately NO amber option. Amber is `stuck` and `stuck` is
	 * the alarm chip's, and a whole card header tinted amber would be a field
	 * at header scale outranking the one mark this product keeps loudest.
	 * A blocked card states its blocking fact in a BANNER (`AlertPanel`), not
	 * by staining its own header.
	 */
	type VerdictTone = 'neutral' | 'good' | 'adverse' | 'active';

	let {
		icon,
		title,
		verdict = null,
		verdictTone = 'neutral',
		verdictTitle,
		rollup,
		iconClass = 'text-gray-400 dark:text-gray-500',
		padded = true,
		bodyClass = '',
		class: className = '',
		children
	}: {
		/**
		 * A `flowbite-svelte-icons` component, rendered at 16px.
		 *
		 * IT IS OPTIONAL IN THE TYPE AND MANDATORY IN PRACTICE. Icons are
		 * STRUCTURAL here, not decoration: the page the human calls beautiful
		 * carries 115 of them and the page called criminally underdesigned
		 * carries zero. If a card has a title, give it an icon.
		 */
		icon?: Component;
		title: string;
		/** The rolled-up answer, right-aligned. `3/3 healthy`, `2 builds`. */
		verdict?: string | null;
		verdictTone?: VerdictTone;
		verdictTitle?: string;
		/** The rollup as markup — chips, a count plus a link. Beats `verdict`. */
		rollup?: Snippet;
		/** Override the icon's ink when the icon itself carries the state. */
		iconClass?: string;
		/** `false` when the body is a `<ul>` of rows that own their padding. */
		padded?: boolean;
		bodyClass?: string;
		/** LAYOUT ONLY — margin, span, visibility. Never colour or radius. */
		class?: string;
		children: Snippet;
	} = $props();

	const VERDICT_TONE: Record<VerdictTone, string> = {
		neutral: 'text-gray-500 dark:text-gray-400',
		good: 'text-green-700 dark:text-green-400',
		adverse: 'text-red-700 dark:text-red-400',
		active: 'text-blue-700 dark:text-blue-400'
	};

	const Icon = $derived(icon);
</script>

<section
	class="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 {className}"
>
	<header
		class="flex min-h-[47px] items-center gap-2.5 border-b border-gray-200 px-4 py-3 dark:border-gray-700"
	>
		{#if Icon}
			<Icon class="h-4 w-4 shrink-0 {iconClass}" />
		{/if}
		<h2 class="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
		<!-- HARD-ALIGNED RIGHT. `ml-auto` rather than `justify-between` so a
		     long title truncates instead of shoving the rollup off the bar. -->
		{#if rollup}
			<div class="ml-auto flex shrink-0 items-center gap-2">{@render rollup()}</div>
		{:else if verdict}
			<span
				class="ml-auto shrink-0 text-xs font-medium whitespace-nowrap {VERDICT_TONE[verdictTone]}"
				title={verdictTitle}>{verdict}</span
			>
		{/if}
	</header>
	<div class={padded ? `p-4 ${bodyClass}` : bodyClass}>
		{@render children()}
	</div>
</section>
