<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE RULE RECORD, IN A POPOVER, ON A `<details>`. (2026-09-02)
	 *
	 * ── WHAT THE HUMAN SAID ──────────────────────────────────────────────────
	 *
	 * > *"i think i also don't like 'details' expansion. it's formatted just as
	 * > text when in some cases it could be more richly formatted. i think maybe
	 * > a popover would be better?"*
	 *
	 * They are right about the payoff. The control opened onto a PARAGRAPH —
	 * the verdict, then `rule: dependency-hello-frontend-needs-api` — inside a
	 * 300px card, in the card's own gray, at the card's own 11px. A disclosure
	 * whose reward is more prose in a narrower column is the weakest possible
	 * one. The content behind it is a RECORD (which rule, what kind, what
	 * clears it, when, and the raw handle to paste after `kubectl`), and a
	 * record wants an aligned two-column list and room to be wide.
	 *
	 * The product already uses a popover for exactly this: rollout detail's
	 * release-candidate rows open one on the `Held by a gate` chip, listing
	 * each gate with its pretty name, its description and what clears it. So
	 * this ADOPTS an idiom rather than inventing one, and it takes that
	 * panel's own chrome verbatim — flowbite's `popover` theme slots,
	 * `rounded-lg shadow-md border-gray-200 bg-white`.
	 *
	 * ── ⛔ WHY IT IS NOT flowbite's `<Popover>` ───────────────────────────────
	 *
	 * `Popper.svelte` renders `{#if isOpen}`. **A closed flowbite popover has no
	 * DOM.** `lib/messages/` pins these sentences by walking `textContent` —
	 * `truth.test.ts` from state, `subject.svelte.test.ts` for the subject
	 * property — and a `<details>` counts because a closed `<details>` still
	 * has its subtree. Swapping in a component that unmounts its children would
	 * have made `story.verdict` and every gate handle silently unreachable to
	 * the census WHILE THE SUITE STAYED GREEN, which is the precise failure
	 * `AlertPanel.svelte.test.ts` was written to catch and which its header
	 * names by construction: *"or for `{#if expanded}` (the fact becomes
	 * unreachable …)"*.
	 *
	 * Its default `trigger="hover"` is the second reason. A hover-only control
	 * is unreachable on a phone, and the product's own rule is that a
	 * hover-revealed control becomes permanently visible at 390.
	 *
	 * ── SO: `<details>` IS THE MECHANISM, THE PANEL IS THE PRESENTATION ──────
	 *
	 * The element stays exactly what it was — a native disclosure. What changed
	 * is that its body is drawn as a floating card instead of as two paragraphs
	 * in the flow. Everything the disclosure already gave us is kept for free:
	 *
	 *   · the subtree is in the DOM when closed        → the census still reads it
	 *   · `<summary>` is focusable, Enter and Space    → keyboard
	 *   · it opens on CLICK                            → touch, at 390, unchanged
	 *   · `details.open` is a readable boolean         → both directions testable
	 *
	 * and what it did not give — Escape, click-away, and escaping `Card`'s
	 * `overflow-hidden` — is added here in twenty lines.
	 *
	 * ⚠️ `position: fixed`, NOT `absolute`. `Card.svelte` is
	 * `flex flex-col overflow-hidden rounded-lg`, so an absolutely positioned
	 * panel inside any card on `/environments`, `/apps/<name>` or `/envs/<name>`
	 * is CLIPPED at the card's edge — the same `overflow:hidden` trap
	 * `app.css`'s `.tap-zone` note records for a ring drawn inside a `truncate`
	 * box. Fixed coordinates are measured off the summary on open, flipped above
	 * it when the viewport has no room below, and clamped to 8px gutters so the
	 * panel can never open off-screen at 390.
	 */
	import { ChevronRightOutline } from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';
	import { countLabel } from '$lib/disclosure';

	let {
		/**
		 * ⭐ THE LABEL IS THE COUNT FORM, PRODUCT-WIDE NOW. `BlockReason` has
		 * said `1 rule` / `2 rules` since 2026-09-01 and `BlockingStoryLines`
		 * said `Details`, so one affordance had two grammars and the two
		 * rendered one viewport apart on `/environments`. The count form wins
		 * because the content behind it IS a set of rules and the count is the
		 * one thing a reader wants before deciding to open it — the
		 * `Show 8 ready resources ›` shape `COMPOSITION-GRAMMAR.md` §8 names.
		 *
		 * ⭐ AND `AlertPanel` SPEAKS IT TOO NOW. (2026-09-02) The earlier note
		 * here said the banner's `Details` was *"deliberately untouched: its body
		 * is a SENTENCE, not a set with a count"*. That was true of SOME of its
		 * ten call sites and false of others — `BlockingStoryPanel` is the same
		 * gates as this control, one viewport above it on `/environments`, and it
		 * said `Details` while this said `2 rules`. The grammar is stated once in
		 * `lib/disclosure.ts` now and both objects derive from it.
		 */
		count,
		/** What is being counted. Singular; `lib/disclosure.ts` adds the `-s`. */
		noun = 'rule',
		/** The record. Rendered inside the panel; in the DOM when closed. */
		children,
		class: className = ''
	}: { count: number; noun?: string; children: Snippet; class?: string } = $props();

	const label = $derived(countLabel(count, noun));

	let detailsEl: HTMLDetailsElement | undefined = $state();
	let summaryEl: HTMLElement | undefined = $state();
	let panelEl: HTMLElement | undefined = $state();
	let open = $state(false);

	/**
	 * Measure off the summary, flip above when the viewport is short, clamp to
	 * an 8px gutter. Deliberately not floating-ui: the panel has one placement,
	 * one flip and one clamp, and the product already pays for floating-ui
	 * only through flowbite's own components.
	 */
	function place() {
		if (!summaryEl || !panelEl) return;
		const r = summaryEl.getBoundingClientRect();
		const vw = document.documentElement.clientWidth;
		const vh = document.documentElement.clientHeight;
		const w = panelEl.offsetWidth;
		const h = panelEl.offsetHeight;
		const left = Math.min(Math.max(8, r.left), Math.max(8, vw - w - 8));
		const below = r.bottom + 6;
		const top = below + h > vh - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below;
		panelEl.style.left = `${left}px`;
		panelEl.style.top = `${top}px`;
	}

	function close() {
		if (detailsEl) detailsEl.open = false;
	}

	$effect(() => {
		if (!open) return;
		place();
		// A THIRD FRAME, NOT A GUESS. The panel's own width settles after the
		// browser has laid out its `<dl>` grid; measuring in the toggle handler
		// alone put it 40px left of where it ended up on a first open.
		const raf = requestAnimationFrame(place);
		const onDocClick = (e: MouseEvent) => {
			if (detailsEl && !e.composedPath().includes(detailsEl)) close();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			close();
			// FOCUS COMES BACK. Escaping a panel that had focus inside it and
			// leaving focus on `<body>` is how a keyboard reader loses their
			// place in a list of twelve rows.
			summaryEl?.focus();
		};
		document.addEventListener('click', onDocClick, true);
		document.addEventListener('keydown', onKey);
		window.addEventListener('scroll', place, true);
		window.addEventListener('resize', place);
		return () => {
			cancelAnimationFrame(raf);
			document.removeEventListener('click', onDocClick, true);
			document.removeEventListener('keydown', onKey);
			window.removeEventListener('scroll', place, true);
			window.removeEventListener('resize', place);
		};
	});
</script>

<!--
	⚠️ `flex flex-col items-start` IS LOAD-BEARING, NOT TIDINESS, and it is the
	trap `AlertPanel` and both call sites already record: a block `<details>`
	puts its `inline-flex` summary in an anonymous LINE BOX which inherits the
	surround's strut, so the control measures TALLER than the line of prose it
	replaced. As a flex column the summary is a flex item with no strut.
-->
<details
	bind:this={detailsEl}
	ontoggle={() => (open = !!detailsEl?.open)}
	class="group flex flex-col items-start {className}"
>
	<summary
		bind:this={summaryEl}
		class="t-micro inline-flex cursor-pointer list-none items-center gap-1 rounded text-gray-500 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none dark:text-gray-400 dark:hover:text-white [&::-webkit-details-marker]:hidden"
	>
		<ChevronRightOutline
			class="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
			aria-hidden="true"
		/>
		{label}
	</summary>
	<!-- FLOWBITE'S OWN `popover` THEME SLOTS, verbatim, so this panel and the
	     gate popover on rollout detail's release-candidate rows are one object
	     with one chrome. `w-[19rem]` is the record's measure — two aligned
	     columns of 11px — and `max-w-[calc(100vw-16px)]` is what keeps it
	     inside the 390 viewport once `place()` has clamped its left edge. -->
	<div
		bind:this={panelEl}
		class="fixed z-50 w-[22rem] max-w-[calc(100vw-16px)] rounded-lg border border-gray-200 bg-white p-3 shadow-md dark:border-gray-700 dark:bg-gray-800"
	>
		{@render children()}
	</div>
</details>
