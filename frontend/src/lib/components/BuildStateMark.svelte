<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ A BUILD'S STATE, AS ONE GLYPH AND ONE PLAIN SENTENCE.
	 *
	 * ── WHY THIS IS A COMPONENT ─────────────────────────────────────────────
	 *
	 * The same fact — *what is happening to this build* — was drawn three times
	 * on the two revision pages, by three separate pieces of code: `rowMark()`
	 * in `/versions`, the state text in the hero, and the glyph on the detail
	 * page's bucket headers. Three implementations of one sentence is three
	 * chances for the glyph and the words to disagree, and the words were the
	 * ones the human named as jargon (`has places left to reach`, `partly
	 * rolled past`, `live everywhere it is carried`).
	 *
	 * There is now exactly one: `buildState()` in `revision-coverage.ts`
	 * computes the phrase off the same buckets `CoverageBar` is drawn from, and
	 * this component picks the glyph for it. The bar, the glyph and the sentence
	 * are three channels carrying one answer, which is the reference page's own
	 * habit (`✓ 51b976a Succeeded` beside `5/5 done`) — and REDUNDANCY ACROSS
	 * CHANNELS is what lets the bar read with no legend, which the human has
	 * rejected twice.
	 *
	 * ── IT ALSO FIXES THE RAGGED LEFT EDGE BY CONSTRUCTION ──────────────────
	 *
	 * The glyph used to be a 20px box in its own grid column while the sha and
	 * the service list started 23px further right — three different x's down one
	 * card. Here the glyph and the words are ONE inline object with one baseline,
	 * so a row can put it in a 16px icon track and everything else at a single
	 * second x. There is no third.
	 *
	 * ── THE INKS ────────────────────────────────────────────────────────────
	 *
	 * Two values, both already owned by the product: the mint is the `newest`
	 * chip's and `CoverageBar`'s live segment, so a green tick here is literally
	 * the colour of the bar segment it agrees with. Red keeps `failing`.
	 * `notYet` and `ahead` take NO colour: being behind is the normal state of a
	 * promotion pipeline (`DESIGN.md`: *"'Drift' is not a valid status"*) and
	 * amber belongs to `stuck`.
	 */
	import {
		ArrowRightOutline,
		CheckCircleSolid,
		ExclamationCircleSolid,
		HourglassOutline,
		MinusOutline,
		PauseSolid
	} from 'flowbite-svelte-icons';
	import { buildState, type RevisionCoverage } from '$lib/view-models/revision-coverage';

	let {
		coverage,
		size = 'row',
		showWord = true,
		showGlyph = true,
		class: className = ''
	}: {
		coverage: RevisionCoverage;
		/** `row` — 16px glyph, 12px word. `lead` — 20px glyph, 14px word. */
		size?: 'row' | 'lead';
		/** Glyph only, when the word is printed elsewhere on the same line. */
		showWord?: boolean;
		/**
		 * Word only. The list row puts the GLYPH in its 16px icon track — which
		 * is what makes the card's left edge a single second x — and the WORD
		 * beside the sha two columns over. Same state, same function, drawn in
		 * the two places the row's grid puts them.
		 */
		showGlyph?: boolean;
		/** LAYOUT ONLY. Never colour. */
		class?: string;
	} = $props();

	const state = $derived(buildState(coverage));

	// ⭐ `held` ADDED 2026-09-03 (operator-walk BLOCKING item — see
	// `revision-coverage.ts`'s `buildState`). A `live` place that is not on
	// the row's own release of the revision — held by a gate, or simply not
	// promoted to it yet — is neither `done` nor absent, and reusing
	// `notYet`'s glyph would say "this place has not taken the REVISION",
	// which is false: it has. `PauseSolid` is the product's own glyph for
	// this exact fact everywhere else it is drawn (`BakeStatusIcon.svelte`'s
	// `held` state, `getStatusCircleClass`), reused rather than invented.
	// TONE stays `tone-mute`, the SAME two-ink discipline the header comment
	// above states: a gate correctly refusing a candidate is not adverse, so
	// it takes no third colour here either.
	const GLYPH = {
		failing: ExclamationCircleSolid,
		notYet: HourglassOutline,
		ahead: ArrowRightOutline,
		held: PauseSolid,
		nowhere: MinusOutline,
		done: CheckCircleSolid
	} as const;

	const TONE = {
		failing: 'tone-bad',
		notYet: 'tone-mute',
		ahead: 'tone-mute',
		held: 'tone-mute',
		nowhere: 'tone-mute',
		done: 'tone-live'
	} as const;

	const Glyph = $derived(GLYPH[state.key]);
</script>

<span class="bsm bsm--{size} {className}" title={state.title}>
	{#if showGlyph}
		<Glyph
			class="{size === 'lead' ? 'h-5 w-5' : 'h-4 w-4'} shrink-0 {TONE[state.key]}"
			aria-hidden="true"
		/>
	{/if}
	{#if showWord}
		<span class="bsm-word">{state.word}</span>
	{/if}
</span>

<style>
	/* GEOMETRY AND THE TWO GLYPH INKS ONLY — a Svelte-scoped rule outranks a
	   Tailwind utility, so nothing else may live here. */
	.bsm {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}

	.bsm-word {
		min-width: 0;
		color: var(--color-gray-500);
	}

	:global(.dark) .bsm-word {
		color: var(--color-gray-400);
	}

	.bsm--row .bsm-word {
		font-size: 12px;
		line-height: 16px;
	}

	.bsm--lead .bsm-word {
		font-size: 14px;
		line-height: 20px;
	}

	/* ⛔ THE THREE GLYPH INKS MOVED TO `app.css` AND MUST STAY THERE.
	   Declared here they were SCOPED, and the class lands on a `<Glyph>` —
	   a child component's `<svg>`, which Svelte 5 does not give the scoping
	   hash. The rules matched nothing; every glyph rendered PURE BLACK
	   (1.43:1 on the dark card). Do not move them back into a component. */
</style>
