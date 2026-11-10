<svelte:options runes={true} />

<script lang="ts">
	import { isApplePlatform } from '$lib/shortcut-hint';
	/**
	 * ⭐ THE PRODUCT'S ONE "THIS DOES NOT EXIST" COMPOSITION. (2026-10-08,
	 * design-rollout round 2, coordinator ruling via design review 4; round 3
	 * revised the layout and restored "Go back" per QA4.)
	 *
	 * ── ROLE ─────────────────────────────────────────────────────────────
	 * A missing object (a 404 route, a rollout/app/env whose id resolves to
	 * nothing) is NOT an incident. It needed a banner-free, hue-free page:
	 * the reader asked for something that is not there, and nobody needs to
	 * be paged. Every prior version of this state (bare `<h1>`, a `warning`
	 * `AlertPanel`) either had no structural heading or spent the STUCK-only
	 * amber token on an everyday "wrong address" — both defects this
	 * component closes once, for every caller.
	 *
	 * ── WHY NO EXISTING COMPONENT FIT, AND WHICH ONES THIS BORROWS FROM ────
	 * `AlertPanel` is for a BLOCKING FACT that needs a person's attention and
	 * a remediation action (§3.12) — a missing object needs nobody and has no
	 * remediation, only a few ways out. `ErrorState`/`+error.svelte` both
	 * reached for `AlertPanel` anyway because nothing else existed for "the
	 * request succeeded and came back empty." This is that component:
	 *   - `PageHeader` (object form) for the one `<h1>` the page owns —
	 *     `eyebrow` + `title` name what was asked for, exactly as any other
	 *     object page's header does.
	 *   - ⭐ MAIN + RAIL AT ≥1024, NOT ONE FULL-WIDTH CARD. (round 3, QA4)
	 *     A single full-width card holding both the record AND every way out
	 *     read as a wide, mostly-empty page at 1440 — `≥1024 is never single
	 *     column` (DESIGN-LANGUAGE.md §2.9) applies here same as any other
	 *     page. `lg:grid-cols-[3fr_minmax(22rem,2fr)] lg:items-start` is the
	 *     rollout Overview's own main+rail split, byte-identical (that
	 *     page's own comment calls out the exact class this borrows).
	 *     MAIN: one Card holding the record — the requested identifiers as a
	 *     `FactList` (`ns/name`, cluster, address — whatever the caller
	 *     knows), then the §3.15 EMPTY anatomy (20px outline icon
	 *     `text-fg-disabled`, `t-ui` one-line headline, `t-meta` next step) —
	 *     the same anatomy `/changes`' own "Nothing built yet" card already
	 *     uses, borrowed verbatim rather than invented.
	 *     RAIL: a second, small Card — "Where to look" — holding every way
	 *     out: Search (opens the SAME command palette the navbar's own
	 *     button does, by clicking it via its stable `aria-label` selector —
	 *     the same one `CommandPalette.svelte`'s own focus effect keys off),
	 *     the list link, Home, and (404 only) "Go back". `.nav-link`s
	 *     throughout: nothing here DOES anything except Search, every other
	 *     control only goes somewhere.
	 */
	import type { Component, Snippet } from 'svelte';
	import PageHeader from './PageHeader.svelte';
	import Card from './Card.svelte';
	import FactList, { type Fact } from './FactList.svelte';
	import {
		SearchOutline,
		HomeOutline,
		ArrowLeftOutline,
		ClockArrowOutline,
		MapPinOutline
	} from 'flowbite-svelte-icons';
	import { href } from '$lib/paths';

	let {
		/** The kind of object that is missing ("Rollout", "App"). Omit for a bare route. */
		eyebrow = null,
		/** The requested name/address — the `PageHeader`'s title. */
		title,
		/** Card header icon. Structural, never a status glyph. */
		icon = SearchOutline,
		/** The one-line empty headline, e.g. "This rollout does not exist". */
		headline,
		/** The next-step sentence under the headline. */
		nextStep,
		/** What was actually asked for, as a record — `ns/name`, cluster, address. */
		facts = [],
		backHref,
		backLabel,
		homeHref = href('/'),
		/** Suppress the Home link when `backHref` already IS Home. */
		showHome = true,
		/**
		 * ⭐ RESTORED, 404-ONLY. (round 3, QA4) `history.back()` is not a URL
		 * — it is the session's own back entry, which only a route that was
		 * actually REACHED by navigating (a mistyped/stale link) can promise
		 * anything about. `+error.svelte`'s 404 passes this; every other
		 * caller (a missing rollout/app/env the reader opened deliberately
		 * from a list) leaves it unset and the control does not render.
		 */
		onBack = null,
		below
	}: {
		eyebrow?: string | null;
		title: string;
		icon?: Component;
		headline: string;
		nextStep: string;
		facts?: Fact[];
		backHref: string;
		backLabel: string;
		homeHref?: string;
		showHome?: boolean;
		onBack?: (() => void) | null;
		/** Extra content under the standard body, before the way-out links. */
		below?: Snippet;
	} = $props();

	let isMac = $state(false);
	$effect(() => {
		isMac = isApplePlatform(navigator.platform);
	});

	/**
	 * Opens the SAME palette instance the navbar mounts, by clicking its own
	 * trigger button — the stable selector `CommandPalette.svelte`'s own
	 * focus-on-open effect already relies on, so this never drifts from the
	 * one real entry point.
	 */
	function openSearch() {
		document.querySelector<HTMLElement>('[aria-label^="Search ("]')?.click();
	}

	// `{@const}` must be the immediate child of a block/snippet/component —
	// a plain `<div>` does not qualify, so the icon component is bound here
	// instead of inline in the template.
	const EmptyIcon = $derived(icon);
</script>

<div class="mx-auto w-full px-4 pt-6 pb-10 sm:px-6">
	<PageHeader {eyebrow} {title} />
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_minmax(22rem,2fr)] lg:items-start">
		<Card {icon} title="Requested">
			{#if facts.length > 0}
				<FactList {facts} tone="card" class="mb-5" />
			{/if}
			<div class="flex flex-col items-start py-6">
				<EmptyIcon class="mb-3 h-5 w-5 text-fg-disabled" aria-hidden="true" />
				<p class="t-ui text-fg">{headline}</p>
				<p class="t-meta mt-1 max-w-[320px] text-fg-subtle">{nextStep}</p>
			</div>
			{#if below}{@render below()}{/if}
		</Card>
		<Card icon={MapPinOutline} title="Where to look">
			<div class="flex flex-col items-start gap-3">
				<button type="button" class="nav-link" onclick={openSearch}>
					<SearchOutline aria-hidden="true" />
					Search
					<!-- ⭐ HIDDEN BELOW `sm` / ON TOUCH. (round 3, QA4) There is no
					     physical keyboard to press ⌘K/Ctrl K on a phone, so the hint
					     was a label for a shortcut that does not exist on that
					     device — same reasoning the navbar's own search button
					     already applies to this exact hint. `hidden sm:inline-flex`
					     matches the navbar's own breakpoint for it. -->
					<kbd
						class="t-code-sm hidden shrink-0 rounded-xs border border-line-strong bg-subtle px-1 py-0.5 sm:inline-flex"
						>{isMac ? '⌘K' : 'Ctrl K'}</kbd
					>
				</button>
				<!-- Every row leads with its icon (palette AD): a trailing chevron
				     left this one label 24px left of Search and Home. -->
				<a href={backHref} class="nav-link">
					<ArrowLeftOutline aria-hidden="true" />
					{backLabel}
				</a>
				{#if showHome}
					<a href={homeHref} class="nav-link">
						<HomeOutline aria-hidden="true" />
						Home
					</a>
				{/if}
				{#if onBack}
					<!-- Browser history, not a destination: the history clock, so it
					     never reads as a second "Back to …" arrow. -->
					<button type="button" class="nav-link" onclick={onBack}>
						<ClockArrowOutline aria-hidden="true" />
						Go back
					</button>
				{/if}
			</div>
		</Card>
	</div>
</div>
