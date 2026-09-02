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

	/**
	 * ⭐ THE HEADER IS A DESTINATION WHEN THE CARD HAS ONE — `titleHref`.
	 *
	 * From the human, on `/environments`: *"it's also not clickable in places
	 * where you'd expect it to be. i think some other views have this problem
	 * too."* A 47px bar carrying an object's own name, above a body about that
	 * object, reads as a door. It was not one; the only door was a button in
	 * the footer.
	 *
	 * ⛔ NOT A CARD-WIDE `<a>`. The body holds links and buttons of its own,
	 * so wrapping the card nests interactive elements — invalid, and it
	 * doubles the tab stops on every row. The header is a `.tap-zone` and the
	 * title is the `.tap-link` inside it; see the block in `app.css` for the
	 * whole argument. One tab stop, no nesting, and the rollup chips beside it
	 * stay independently clickable because the zone raises them.
	 *
	 * DEFAULT `undefined` — every existing call site renders exactly as before.
	 */
	let {
		icon,
		title,
		titleHref = undefined,
		verdict = null,
		verdictTone = 'neutral',
		verdictTitle,
		rollup,
		iconClass = 'text-gray-500 dark:text-gray-400',
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
		/** Makes the whole header bar go here. See the note above. */
		titleHref?: string;
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

<!--
	⚠️ `flex flex-col` IS A NO-OP EVERYWHERE EXCEPT A STRETCHED GRID CELL, and
	that is why it is safe to put on the shared card. A `<section>` whose height
	is `auto` lays a header and a body out identically as a block or as a flex
	column — neither child has a margin, so there is no collapsing to lose. What
	it buys is the ONE case that needed it: `/environments` puts these cards in a
	real CSS grid with `items-stretch`, and a card that fills its row needs its
	BODY to take the slack so the footer lands on the row's shared baseline
	instead of the content floating with a gap under it. `grow` on the body is
	the other half; with `flex-basis: auto` it never shrinks natural content.
-->
<section
	class="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 {className}"
>
	<header
		class="flex min-h-[47px] shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-gray-200 px-4 py-3 sm:flex-nowrap dark:border-gray-700 {titleHref
			? 'tap-zone transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30'
			: ''}"
	>
		<!--
			⭐ THE TITLE IS THE LAST THING THAT SHRINKS, NOT THE FIRST.
			(2026-09-02, measured defect: at 390 `min-w-0 truncate` on the `h2`
			let it lose the fight for width against the right-aligned rollup —
			`All apps` clipped to `All a…` against a full-width chip row.)

			This inner group (icon + title) carries `basis-full` below `sm`, so
			on a wrapping header it is FORCED onto its own line at its natural
			width — nothing is left over on that line for the rollup to share,
			so the title never truncates to make room for it. The rollup
			(or `verdict`) becomes the header's own next flex item and, unable
			to fit beside a full-width sibling, wraps to a second line where
			its `ml-auto` right-aligns it under the title — the exact shape
			`COMPOSITION-GRAMMAR.md`'s head-row idiom already uses.

			At `sm` and up the header reverts to one row (`sm:flex-nowrap`,
			`sm:basis-auto`): the group sizes to content and shrinks under
			`min-w-0` exactly as before, so the 47px floor and the truncating
			title are unchanged there — this only ever fires below `sm`, which
			is the only width the defect was measured at.
		-->
		<div class="flex min-w-0 basis-full items-center gap-2.5 sm:basis-auto">
			{#if Icon}
				<Icon class="h-4 w-4 shrink-0 {iconClass}" />
			{/if}
			<h2 class="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-white">
				{#if titleHref}
					<a
						href={titleHref}
						class="tap-link hover:underline"
						>{title}</a
					>
				{:else}
					{title}
				{/if}
			</h2>
		</div>
		<!-- HARD-ALIGNED RIGHT. `ml-auto` rather than `justify-between` so at
		     `sm`+ a long title truncates instead of shoving the rollup off the
		     bar; below `sm` the title's group already claimed the whole first
		     line, so `ml-auto` right-aligns this on the second line instead. -->
		{#if rollup}
			<div class="ml-auto flex shrink-0 items-center gap-2">{@render rollup()}</div>
		{:else if verdict}
			<span
				class="ml-auto shrink-0 text-xs font-medium whitespace-nowrap {VERDICT_TONE[verdictTone]}"
				title={verdictTitle}>{verdict}</span
			>
		{/if}
	</header>
	<div class="grow {padded ? `p-4 ${bodyClass}` : bodyClass}">
		{@render children()}
	</div>
</section>
