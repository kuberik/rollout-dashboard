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
	class="card-cq flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 {className}"
>
	<header
		class="flex min-h-[47px] shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-gray-200 px-4 py-3 dark:border-gray-700 {titleHref
			? 'tap-zone transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30'
			: ''}"
	>
		<!--
			⭐ THE TITLE IS THE LAST THING THAT SHRINKS, NOT THE FIRST — AND A
			ROLLUP THAT FITS STAYS ON THE TITLE'S LINE. (2026-09-02, narrowed at
			the design re-check: the `basis-full` fix below solved the
			truncation fight by forcing the title onto its OWN full-width line
			unconditionally, which also made every header with a rollup 65px at
			390 even when the two would happily share 47px — measured on
			`/apps/<name>`, `Promotion pipeline` (wraps, needed to) sitting above
			`Source` (didn't wrap, had no rollup at all at the time) as two
			different header heights in one column.)

			Dropped `basis-full`. A flex-wrap line's break is decided by each
			item's HYPOTHETICAL size — its resolved `flex-basis`, which for the
			unset `flex-basis: auto` this group now carries is its natural
			content width, not 0 — so the browser wraps the ROLLUP to a second
			line only when title + rollup genuinely do not both fit, and never
			shrinks the title to manufacture room on a shared line. That is the
			mechanism the truncation bug was missing: the group used to compute
			a zero hypothetical size (effectively `flex-1`-shaped), so nothing
			ever wrapped and the title was squeezed instead. `min-w-0` stays on
			both the group and the `h2` — it only lowers the shrink FLOOR.

			⛔ `sm:flex-nowrap` IS GONE. (F3, 2026-09-03, breakpoints pass) It
			forced title+rollup onto ONE line at every viewport ≥640 regardless
			of the CARD's own rendered width — and a card sitting in a two-up
			grid (`/versions/<rev>`) can be far narrower than the viewport
			suggests. Measured on the live page at 640: all four card titles
			truncated (`What each service calls it` 202→62px = `What …`); the
			rollup was winning a fight the header wasn't free to lose. Plain
			`flex-wrap`, unprefixed, is ALREADY the container query this needs —
			a flex line's wrap decision is made against the box's own computed
			width, not the viewport's, which is exactly the mechanism the
			comment above already relies on for the rollup. Removing the
			viewport override just lets it run at every width, not only below
			640.

			⛔ `truncate` ON THE TITLE IS GONE TOO. A title that cannot share a
			line with its rollup now WRAPS (this component's job is answering a
			question, not fitting a single line) — `break-words` so an
			identifier with no spaces (a mono revision, a service name) still
			wraps instead of overflowing the card. Truncation is what a narrow
			CARD used to do when the real defect was an unconditional shared
			line; the fix is not to have that fight at all.
		-->
		<div class="flex min-w-0 items-center gap-2.5">
			{#if Icon}
				<Icon class="h-4 w-4 shrink-0 {iconClass}" />
			{/if}
			<h2 class="t-card-title min-w-0 break-words text-gray-900 dark:text-white">
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
		<!--
			HARD-ALIGNED RIGHT ONCE THE CARD IS WIDE ENOUGH, ALWAYS. Below that
			the margin is NOT auto: `margin-left: auto` resolves against the
			FREE SPACE OF ITS OWN LINE, so on a line the rollup has wrapped onto
			BY ITSELF that free space is the whole remaining card width —
			exactly the 155px empty gutter the design re-check measured (the
			rollup right-floating on a narrow line with nothing beside it).
			Below the threshold it sits at its natural position instead:
			immediately after the title when they share a line, or flush left
			under the title when they do not — the same left edge as the title
			in both cases.

			⛔ WAS `sm:ml-auto` — A VIEWPORT THRESHOLD FOR A DECISION THE HEADER
			ITSELF NOW MAKES FROM ITS OWN WIDTH. (F3, 2026-09-03) With
			`sm:flex-nowrap` gone (see the header's own note), the rollup can
			wrap onto its own line at ANY viewport once the card is narrow
			enough — a card in a two-up grid at 1024 viewport is exactly this
			case — and `sm:ml-auto` would still fire because it never stopped
			reading the viewport, reopening the 155px-gutter bug one level up.
			`.card-cq` (`container-type: inline-size` on the `<section>`) makes
			the CARD the query subject; the threshold is the same 640px number
			`sm` used, moved from the wrong signal to the right one.
		-->
		{#if rollup}
			<!-- ⭐ `.card-header-rollup` — F6, DESIGN PASS 5. A card header whose
			     rollup is a `.nav-link` (`/`, `/apps`, `/envs/<name>`'s
			     `View all activity ›` / `Whole network ›`) measured 61px against
			     the product's 47px, 85px at 390: `.nav-link`'s own `padding: 8px 0`
			     + 14px/1.4 line-height resolves to 35.6px, 7.8px taller each side
			     than the title's 20px (`text-sm`) line box. A link in THIS slot is
			     a rollup, not a button, and app.css now sizes it at the rollup's
			     own scale — see the rule beside `.nav-link`. -->
			<div class="card-header-rollup flex shrink-0 items-center gap-2">
				{@render rollup()}
			</div>
		{:else if verdict}
			<span
				class="t-card-rollup card-header-verdict shrink-0 whitespace-nowrap {VERDICT_TONE[verdictTone]}"
				title={verdictTitle}>{verdict}</span
			>
		{/if}
	</header>
	<div class="grow {padded ? `p-4 ${bodyClass}` : bodyClass}">
		{@render children()}
	</div>
</section>

<style>
	/*
	 * ⭐ F3: THE CARD IS ITS OWN QUERY SUBJECT, NOT THE VIEWPORT. (2026-09-03,
	 * breakpoints pass) Every reusable card sits in layouts of very different
	 * widths — a full-bleed rail card, one of two on `/versions/<rev>`, one
	 * of three in a grid — so a rule keyed to the VIEWPORT is a rule keyed to
	 * the wrong box. `container-type: inline-size` here is the same
	 * mechanism `/apps/<name>`'s own container-query notes already use.
	 */
	.card-cq {
		container-type: inline-size;
	}

	@container (min-width: 640px) {
		.card-header-rollup,
		.card-header-verdict {
			margin-left: auto;
		}
	}
</style>
