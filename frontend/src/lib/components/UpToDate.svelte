<svelte:options runes={true} />

<script lang="ts">
	/**
	 * "IS THIS THING UP TO DATE?" — one object, one wording, four pages.
	 *
	 * ── WHY THIS IS A COMPONENT AND NOT MORE INLINE MARKUP ──────────────────
	 *
	 * The fleet cell on `/apps` is the FIFTH attempt at this fact and the first
	 * one the human did not reject. Four earlier forms — a ruler, a composition
	 * bar, a dot strip, an `N BUILDS` chip — were all cut for the same reason:
	 * *"an object that has to be taught is a failed object."* Their encoding was
	 * PROXIMITY or LENGTH or HUE, none of which a reader can decode without a
	 * legend, and the legend was itself rejected twice.
	 *
	 * What survived encodes the fact in two channels a reader already owns:
	 *
	 *   · A LITERAL GLYPH for consistency — `CodeMergeSolid` when every place
	 *     that runs this thing runs the same version, `CodeBranchSolid` when
	 *     they have split, `PauseSolid` when nothing runs yet. Merge and branch
	 *     are pictures of the fact, not codes for it.
	 *   · A COUNT for distance, in the reference page's own `3/3 healthy`
	 *     rollup idiom, at 14px, tabular, so a column of them scans.
	 *
	 * Three pages want that same fact (`/apps` per row, `/environments` per
	 * card, `/apps/[name]` as the state rollup) and were about to spell it
	 * three different ways. **A reader should learn this object once.** That is
	 * the whole justification for the component: not code reuse, WORDING reuse.
	 *
	 * ── THE NOVICE TEST DECIDED THE WORDS ───────────────────────────────────
	 *
	 * It used to print `3/3 on head` / `0/3 on head` / `2 builds`. `head` is
	 * git's word for a pointer, not a person's word for a state, and a reader
	 * who has never seen this tool cannot tell whether `0/3 on head` is bad.
	 * It prints `Up to date everywhere` / `1 of 7 up to date` / `4 versions
	 * running` instead — same numbers, same marks, zero new colour, and no
	 * word that has to be looked up.
	 *
	 * GREEN ONLY WHEN THE ANSWER IS YES. Being behind is *"the normal state of
	 * a promotion pipeline"* and may not borrow an adverse hue, so everything
	 * short of "all of them" is the muted gray glyph with neutral ink.
	 */
	import {
		CheckCircleSolid,
		CodeBranchSolid,
		CodeMergeSolid,
		PauseSolid
	} from 'flowbite-svelte-icons';
	import {
		isAllCurrent,
		isNowhere,
		upToDateHeadline,
		upToDateCaption
	} from '$lib/view-models/up-to-date';

	let {
		onHead,
		deployed,
		total,
		spread = 1,
		pending = 0,
		diverged = 0,
		unknown = 0,
		/** What the denominator counts. Plural is derived, never passed. */
		noun = 'environment',
		caption = null,
		title,
		class: className = ''
	}: {
		/** Places running the newest version this thing has. */
		onHead: number;
		/** Places that have deployed it at all — the denominator. */
		deployed: number;
		/** Places configured for it, deployed or not. */
		total: number;
		/** Distinct versions across the deployed places. */
		spread?: number;
		pending?: number;
		diverged?: number;
		unknown?: number;
		noun?: string;
		/** Overrides the derived caption. Pass `''` to print none. */
		caption?: string | null;
		title?: string;
		class?: string;
	} = $props();

	// ⛔ THE TWO SENTENCES LIVE IN `view-models/up-to-date.ts`. (2026-08-31)
	// A live critique caught `0 of 3 up to date` printed above
	// `in all 3 environments` — the caption completing a headline it does not
	// belong to, reached by fall-through. Lifted out so a unit test can pin
	// it; this component picks the glyph and the ink and nothing else.
	const facts = $derived({ onHead, deployed, total, spread, pending, diverged, unknown, noun });
	const allCurrent = $derived(isAllCurrent(facts));
	const nowhere = $derived(isNowhere(facts));

	const Icon = $derived(
		nowhere ? PauseSolid : allCurrent ? CheckCircleSolid : spread === 1 ? CodeMergeSolid : CodeBranchSolid
	);

	const headline = $derived(upToDateHeadline(facts));
	const derivedCaption = $derived(upToDateCaption(facts));

	const shownCaption = $derived(caption === null ? derivedCaption : caption);
</script>

<span class="flex min-w-0 flex-col gap-1 {className}" {title}>
	<span class="utd-mark flex min-w-0 items-center gap-1.5">
		<Icon
			class="h-4 w-4 shrink-0 {allCurrent
				? 'text-green-700 dark:text-green-400'
				: 'text-gray-500 dark:text-gray-400'}"
		/>
		<span
			class="t-body truncate {allCurrent
				? 'font-medium text-green-700 tabular-nums dark:text-green-400'
				: nowhere
					? 'text-gray-500 dark:text-gray-400'
					: 'font-medium text-gray-900 tabular-nums dark:text-white'}">{headline}</span
		>
	</span>
	{#if shownCaption}
		<span class="t-micro truncate text-gray-500 dark:text-gray-400">{shownCaption}</span>
	{/if}
</span>

<style>
	/* Exactly 20px — a chip's own height — and it HOLDS that height when the
	   glyph and the word are short, so a column of these shares one baseline
	   down a list. Same device, same number, as `/apps`'s `.apps-mark`. */
	.utd-mark {
		min-height: 20px;
	}
</style>
