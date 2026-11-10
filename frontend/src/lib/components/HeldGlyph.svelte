<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE HELD GLYPH — a thin pause. (Design language, 2026-10-09, v3.)
	 *
	 * ROLE: the one mark for "held": a newer build exists and a rule has not
	 * let it through yet. Every held mark in the product draws this component
	 * (StatusMark draws the same path at 10px inside its tinted circle).
	 *
	 * WHY A THIN PAUSE: "on hold" has one universal sign, and it is the pause.
	 * The owner's two objections were to the WEIGHT, not the sign: the filled
	 * PauseSolid in a solid disc was "an eyesore", and the replacement gate
	 * (two posts, two rails) "makes no sense" — it read as a ladder or an "H".
	 * Compared side by side in the status column, inline at 12px, in a stop
	 * pill and bare at 16px, light and dark, 1x and 2x
	 * (design-lang/held2/sheet-*.png) against a short pause (specks at 12px),
	 * an hourglass (collides with "Typical to prod", a duration) and a circle
	 * with a hold bar (reads as "remove"; a circle inside StatusMark's circle;
	 * a clock would collide with checking). The WORD "paused" stays retired —
	 * nobody paused it, a rule is holding it — only the glyph is a pause.
	 *
	 * DRAWING: 24-unit viewBox, two 13.5-unit bars 6 apart, stroke 2.25, round
	 * caps: at 16px that is 1.5px bars about 9px tall, 4px apart (the owner's
	 * ~1.5px; AD held v3). Inside StatusMark the bars are ~8px of the circle at
	 * 1.5px, the "!"'s optical weight. No fill: the hue is the stroke, set
	 * by the caller (`text-held`). Never beside the word "Held" inline or in a
	 * stop pill — the word in held ink carries it there, as "Checking" and
	 * "Deploying" carry theirs, and a pill leads with its 6px dot (at 12px next
	 * to the word the bars read as "II Held"). In a status column or a banner it
	 * is StatusMark's held state, never a heavy fill; bare 16px where it stands
	 * alone. Not the Gates tab's icon: a tab names a place,
	 * not a state. Sizes 12 / 16 / 20. Decorative by default (`aria-hidden`);
	 * the word "held" beside it carries the meaning.
	 */
	let {
		size = 16,
		class: className = '',
		title = undefined
	}: {
		size?: 12 | 16 | 20;
		/** Colour and layout only (e.g. `text-held shrink-0`). */
		class?: string;
		/** When the glyph stands alone, its accessible name ("Held"). */
		title?: string;
	} = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2.25"
	stroke-linecap="round"
	stroke-linejoin="round"
	class="shrink-0 {className}"
	role={title ? 'img' : undefined}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title}
>
	<path d="M9 5.25v13.5M15 5.25v13.5" />
</svg>
