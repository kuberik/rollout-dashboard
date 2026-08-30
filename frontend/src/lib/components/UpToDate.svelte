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

	const allCurrent = $derived(deployed > 0 && onHead === deployed);
	const nowhere = $derived(deployed === 0);

	const Icon = $derived(
		nowhere ? PauseSolid : allCurrent ? CheckCircleSolid : spread === 1 ? CodeMergeSolid : CodeBranchSolid
	);

	const headline = $derived(
		nowhere
			? 'Never deployed'
			: allCurrent
				? 'All up to date'
				: `${onHead} of ${deployed} up to date`
	);

	/**
	 * THE CAPTION NEVER RESTATES THE HEADLINE. The headline carries
	 * `onHead/deployed`; this carries only what a distance cannot say — how
	 * many different versions are live, and the places that have no distance
	 * at all.
	 */
	const derivedCaption = $derived.by(() => {
		if (total === 0) return `no ${noun}s`;
		if (nowhere) return `${total} ${noun}${total === 1 ? '' : 's'} waiting`;
		const parts: string[] = [];
		if (spread > 1) parts.push(`${spread} versions live`);
		if (pending > 0) parts.push(`${pending} never deployed`);
		if (diverged > 0) parts.push(`${diverged} unreleased`);
		if (unknown > 0) parts.push(`${unknown} unknown`);
		if (parts.length > 0) return parts.join(' · ');
		return `in all ${total} ${noun}${total === 1 ? '' : 's'}`;
	});

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
