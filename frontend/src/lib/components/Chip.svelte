<svelte:options runes={true} />

<script lang="ts">
	/**
	 * The one chip. Replaces the eight badge geometries the product had
	 * grown (rounded-full / rounded-md, 9-11px, three paddings, four
	 * trackings). Single size, deliberately no `size` prop — a chip that
	 * can be small or smaller is a chip that will be both on the same row.
	 *
	 * Geometry lives in `.chip` (app.css) so it is defined once and can be
	 * measured; this component only picks the three colour values.
	 *
	 * PRODUCT-WIDE INVARIANT: an `env` chip's colour is a function of the
	 * environment's NAME and nothing else. If a chip's colour changes when
	 * deploy status changes, that is a bug — status belongs to the glyph,
	 * the ring and the state sentence, never to identity.
	 *
	 * THE JOINED FORM (`value`). A rank chip and the build it describes are
	 * ONE fact, and `/rollouts` has always drawn them that way: chip, then
	 * the sha, inside a single bordered box. `/apps`, `/apps/[name]` and `/`
	 * had the same two facts in two places — separate columns, separate
	 * parents, separate type — so the reader had to reassemble them. Passing
	 * `value` renders the joined unit instead. It is the SAME component and
	 * the same geometry: there is no second badge style to keep in sync.
	 *
	 * What is deliberately NOT copied from `/rollouts` is that badge's
	 * COLOUR and RADIUS — it fills `green-100` inside a `green-200` border at
	 * `rounded-md`, which is three greens against the closed budget's one and
	 * a sixth radius against the legal two. The structure is what the human
	 * was pointing at; the palette is already decided (see `DESIGN.md`).
	 *
	 * ⛔ TWO HALVES. NEVER THREE. (2026-08-27, from the human: *"I don't like
	 * that we split the badge in up to 4 sections."*) A joined box is
	 * `[role][value]` or `[role][role]` and that is the whole vocabulary.
	 * `/apps` had grown to three (`[●][PROD][STUCK]`) and
	 * `/versions/<rev>` to four (`[●][PROD][−19][STUCK]`); the status dot is
	 * DELETED and anything past the second half is now a LOOSE mark inside a
	 * `.chip-mark` group. The cap is enforced three ways so it cannot come back
	 * by accident:
	 *   1. this component never renders more than two halves itself;
	 *   2. `app.css`'s seam rules only join a FIRST and a LAST half, so a
	 *      third one renders as a visibly separate box;
	 *   3. the DEV assertion below fires on any `.chip-joined` that holds more
	 *      than two, including one hand-rolled at a call site.
	 */
	import { getEnvironmentThemeStyle, type EnvironmentTheme } from '$lib/environment-theme';

	type ChipRole =
		| 'env'
		| 'newest'
		| 'rank'
		| 'diverged'
		| 'count'
		| 'head'
		| 'alarm'
		| 'failing'
		| 'blocked'
		| 'unranked';

	let {
		role = 'rank',
		label = '',
		value = null,
		valueHref = null,
		valueTitle,
		valueDim = false,
		theme = null,
		title,
		wide = false,
		class: className = ''
	}: {
		role?: ChipRole;
		/**
		 * The word this chip prints. Every role prints it.
		 *
		 * IT MAY BE EMPTY, AND ONLY TOGETHER WITH `value`: that is the
		 * IDENTIFIER-ONLY form — the value half on its own, all four corners at
		 * the chip's 4px. `/versions` needs it: its Revision cell used to pair
		 * the sha with a WORDLESS status half, and that half is deleted (the
		 * `Live` column three tracks right prints the same predicate in words),
		 * so the box is left with one half. A lone chip with no label at all
		 * would be an empty box and is refused.
		 */
		label?: string;
		/**
		 * The build this chip is about. When set, the chip and the build render
		 * as ONE joined box — the `/rollouts` unit. Neutral ink, always: the
		 * rank is the mark, the sha is the identifier it points at.
		 */
		value?: string | null;
		/** Makes the value half a link. Ignored unless `value` is set. */
		valueHref?: string | null;
		valueTitle?: string;
		/**
		 * Secondary ink for the value half — the 2nd+ row of a converged run,
		 * where the sha is the SAME string as the row above. Still a link,
		 * still the full build, still above 4.5:1; just not competing with the
		 * row that differs. A declared state, not a free-form colour.
		 *
		 * ⛔ ONE CONSUMER LEFT, AND IT IS NOT A PATTERN TO COPY (2026-08-28).
		 * `RolloutGrid.svelte` — i.e. `/` and `/rollouts` — is the only caller.
		 * DIM-INSTEAD-OF-EXPLAIN is a pattern the human has now rejected twice:
		 * the revisions pages dropped it (grouping printed every name in full
		 * and the column's emptiness became a free signal), and `/envs/[name]`
		 * dropped it on 2026-08-28 (a `pending` row renders a LONE chip instead
		 * of a joined box holding a dimmed em dash, so the number of HALVES is
		 * the encoding). **Before reaching for this prop, ask whether STRUCTURE
		 * can carry the distinction instead. It usually can.**
		 *
		 * The prop and `.chip-value--dim` survive only because `RolloutGrid` is
		 * a protected call site under the current instruction. When that page is
		 * next opened, `valueDim={!c.version}` is the last one; delete the prop
		 * and the CSS rule with it.
		 */
		valueDim?: boolean;
		/** Required for role="env"; ignored otherwise. */
		theme?: EnvironmentTheme | null;
		title?: string;
		/**
		 * LIFTS THE 12ch WIDTH CAP ON THIS CHIP, in BOTH the lone and the
		 * joined form.
		 *
		 * `.chip` caps at 12ch so one long environment name cannot eat a row.
		 * That cap is a deliberate product-wide contract and it is right in a
		 * fixed table track; it is wrong wherever the chip IS the identifier
		 * and the row can afford the width — a wrapped list of regions, a
		 * page heading, a promotion chain. There, truncation does not just
		 * shorten a name, it DESTROYS it: `prod-us-east-1`, `prod-us-east-2`
		 * and `prod-us-west-1` all render as the same eight characters, which
		 * is the defect that killed the `/apps` convergence bar.
		 *
		 * IT IS A PROP AND NOT `class="max-w-none"` BECAUSE THE CLASS PROP
		 * CANNOT REACH THE CHIP HALF. In the joined form `class` lands on the
		 * `.chip-joined` WRAPPER, so `max-w-none` works on a lone chip and
		 * silently no-ops on a joined one — same prop, same value, two
		 * outcomes, no error. `wide` goes on the `.chip` element in both
		 * branches, so it is one mechanism with one result. Anything narrower
		 * than a whole-chip opt-out still belongs in `class`.
		 */
		wide?: boolean;
		/**
		 * LAYOUT ONLY — visibility, shrink, self-alignment, margin. Passing a
		 * colour, a size, a font or a radius here defeats the entire point of
		 * this component and will be caught by the design census.
		 *
		 * WHERE IT LANDS: on the `.chip` element in the lone form, and on the
		 * `.chip-joined` WRAPPER in the joined form — which is what you want
		 * for `shrink-0`, `min-w-0`, `hidden` and `self-center`, and is why
		 * width overrides must go through `wide` instead.
		 */
		class?: string;
	} = $props();

	// THE SILENT FAILURE, MADE LOUD. A `max-w-*` utility in `class` reaches the
	// chip in the lone form and the wrapper in the joined form, so the same
	// call site can work on one page and do nothing on another with no error to
	// notice. DEV-only: this is a call-site mistake, not a user-facing one.
	$effect(() => {
		if (!import.meta.env.DEV) return;
		if (/(^|\s)max-w-/.test(className)) {
			console.warn(
				`<Chip label="${label}"> was passed a max-width utility in \`class\` ("${className}"). ` +
					'In the joined form `class` lands on `.chip-joined`, not on the chip half, so it ' +
					'silently does nothing. Use the `wide` prop — it works in both forms.'
			);
		}
	});

	const joined = $derived(value !== null && value !== undefined && value !== '');
	/** The value half alone — see `label`. */
	const valueOnly = $derived(joined && label === '');

	// ── THE TWO-HALF CAP, ASSERTED ON THE RENDERED BOX ──────────────────────
	// `Chip` cannot render three halves, but a call site can put three `Chip`s
	// inside a hand-rolled `.chip-joined` — which is exactly how `/apps` grew
	// to three and `/versions/<rev>` to four. The CSS no longer joins a third
	// half, so the mistake is visible; this makes it NAMED as well, at the
	// first render, in the one place every chip in the product passes through.
	let el: HTMLElement | null = $state(null);
	$effect(() => {
		if (!import.meta.env.DEV || !el) return;
		const box = el.classList.contains('chip-joined') ? el : el.parentElement;
		if (!box || !box.classList.contains('chip-joined')) return;
		const halves = box.querySelectorAll(':scope > .chip, :scope > .chip-value');
		if (halves.length > 2) {
			console.error(
				`A .chip-joined box is rendering ${halves.length} halves ` +
					`("${box.textContent?.trim().replace(/\s+/g, ' ')}"). A badge is TWO halves, never ` +
					'more — see DESIGN.md, "TWO HALVES, NEVER THREE". Put the extra mark beside the ' +
					'box inside the same `.chip-mark` group instead.'
			);
		}
	});

	// THE THREE TONES A CHIP CAN TAKE, named once so they cannot drift apart.
	// Four roles are NEUTRAL and two are ADVERSE; before these constants existed
	// the same six strings were written out six times, which is how `newest`
	// spent eight months a different gray from `count`.
	//
	// NEUTRAL — the norm, or a caption. Spends no colour at all.
	const NEUTRAL = 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400';
	// MINT, KEPT UNDER `−N` — `newest` only. See `TONE.newest`.
	const MINT_QUIET = 'border-gray-200 text-[#426d64] dark:border-gray-700 dark:text-[#83b0a8]';
	// ADVERSE — the deviation half of the rank vocabulary. ONE hue for both
	// members (`−N` and `diverged`); the WORD says which kind. Text-only, so
	// `alarm` still outranks it.
	const ADVERSE = 'border-gray-200 text-red-700 dark:border-gray-700 dark:text-red-400';

	// Only `alarm` carries a FILL — that is the whole reason it reads as the
	// loudest object on the page without needing a bigger box, a heavier
	// weight, or a second colour. It used to carry a glyph as well; the human
	// removed that on 2026-08-27 and the fill now does the job alone. See
	// `TONE.alarm` for the re-measurement.
	const TONE: Record<ChipRole, string> = {
		env: 'chip-env',
		// MINT AT A THIRD OF ITS CHROMA (2026-08-26). From the human:
		// *"I changed my mind on newest chip. We probably want to mark it with
		// some color just not to be so prominent"*, which softens — not
		// reverses — the earlier *"NEWEST doesn't need attention and shouldn't
		// be colored"* that made this gray.
		//
		// `HANDOFF.md`'s own word for this chip is MINT, so mint is where this
		// started. FULL-CHROMA MINT FAILS TWO MEASUREMENTS AND IS NOT USED:
		//
		//   1. IT INVERTS THE HIERARCHY IT IS SUPPOSED TO SIT UNDER. Both
		//      halves of the rank vocabulary are text-only in the same face,
		//      size and weight, so their ink is `characters x chroma` and the
		//      glyph-coverage constant cancels. `NEWEST` is 6 characters and
		//      `−4` is 2. At `emerald-600` (OKLCH C 0.1274) mint measures
		//      6 x 0.1274 = 0.764 against `red-700`'s 2 x 0.1905 = 0.381 —
		//      the NORM would print twice the ink of the DEVIATION.
		//   2. IT IS A THIRD GREEN IN ONE ROW. `emerald-600` sits at hue
		//      163.2; DEV's identity ink is 149.5 and the `Succeeded` glyph is
		//      150.1, both at 3.5-3.8x mint's distance from gray. 13 degrees
		//      of hue at comparable chroma on a 10px glyph is one colour
		//      saying three things.
		//
		// SO THE HUE IS HELD AND THE CHROMA COMES BACK UP. 2026-08-27, from
		// the human: *"I think green on newest badge is too faint."*
		//
		// "TOO FAINT" HAS A NUMBER, AND IT IS NOT ONLY CHROMA. `#56766f` was
		// C 0.0384 at L 0.539 — only 1.12x the chroma of the neutral gray in
		// the `.chip-value` half ONE PIXEL to its right, and LIGHTER than it.
		// A word that is barely more chromatic and visibly weaker than the
		// identifier it labels reads as faded, not as coloured.
		//
		// THE FIX IS SOLVED ON THREE AXES AND DRIFTS ON NONE:
		//   HUE  held at the shipped 179.4 / 182.7. Non-negotiable, and it is
		//        the axis the first attempt at this got wrong: raising chroma
		//        along the `gray-500 -> green-700` MIX LINE pulls the hue
		//        greenward, and `#53796a` landed at 168.0 — 4.8 degrees from
		//        the `emerald-600` this same comment rejects above, and 18.5
		//        from DEV's identity ink. On `/rollouts` a `[DEV]` chip and a
		//        `[newest 9a1f4c2]` badge sit on the SAME ROW. Mix amount is
		//        the wrong control; solve the three channels directly.
		//   L    0.539 -> 0.500 light. That is `red-700`'s own lightness
		//        (0.5095), so `newest` and `−N` are PEERS in weight and differ
		//        only in chroma — which is the hierarchy this chip is supposed
		//        to express. Darker than that and the norm would out-weigh the
		//        deviation on an axis chroma cannot answer for.
		//   C    0.0384 -> 0.0503 light, 0.0351 -> 0.0495 dark (+31% / +41%).
		//
		// `#426d64` / `#83b0a8`. ONE budget slot, restated — the same single
		// "quiet mint" entry, still shared character for character with
		// `CoverageBar`'s `live` segment and `ExposureBar`'s newest segment.
		// Measured, before -> after:
		//
		//   · Ink ratio `−N : newest` = characters x chroma, both halves being
		//     text-only in one face, size and weight, so the glyph constant
		//     cancels and `NEWEST` is 6 characters against `−4`'s 2:
		//     1.81x -> 1.38x light, 1.80x -> 1.27x dark. THE DEVIATION IS STILL
		//     DOMINANT, which is the constraint that made this quiet in the
		//     first place — it is louder, not promoted. (DESIGN.md publishes
		//     1.66x / 1.58x for the old value; re-measured on the rendered
		//     sRGB, it was 1.81x / 1.80x. The file understates the headroom.)
		//   · dOKLab from the plain gray it replaces: 0.046 -> 0.075 light,
		//     0.041 -> 0.053 dark. The light value was AT the detection
		//     threshold and is now well past it.
		//   · Hue separation from the green family is UNCHANGED at 29.9 degrees
		//     light / 31.1 dark, against DEV's identity ink and `green-400`.
		//     dOKLab 0.114 / 0.182. A green chip beside a green circle beside
		//     this chip still reads as one green, one green, and a hint.
		//   · 4.98:1 -> 5.83:1 on white; 6.07:1 -> 6.11:1 on `gray-800`.
		//   · Against `alarm` (fill 1140px^2 x 0.1151 + border + glyph ~= 159
		//     ink units) this is ~2.5. The alarm is still ~45x louder and is
		//     still the only chip with a FILL.
		//   · Inside `CoverageBar`, FIELD CEILING §1 still holds: `live` 0.0503
		//     against `notYet` 0.1728 (3.4x) and `failing` 0.2086 (4.1x) light;
		//     0.0495 against 0.1712 (3.5x) and 0.2373 (4.8x) dark. The loudest
		//     PIXEL of a nine-tenths-live bar is still in the adverse segment.
		newest: MINT_QUIET,
		// `−N` IS the deviation, so it is the half that carries the hue.
		//
		// IT IS RED, AND IT USED TO BE AMBER. The move was forced by the env
		// palette being restored to the human's original on 2026-08-25:
		// production is `#d97706` again, whose chip ink is `#b26205` — OKLCH
		// hue 58.3, chroma 0.135. `amber-700` is hue 45.4, chroma 0.158. On an
		// `/apps` row those two render as ADJACENT HALVES OF ONE BOX:
		// `PROD` on a cream fill, then `−4` on white, 1px apart, 12.9 deg of
		// hue between them. At 11px that is one colour saying two things, one
		// of which is an identity and the other a state.
		//
		// The rule moved, not the colour — which is the whole instruction:
		// stop re-solving the palette. `red-700` / `red-400` is 29.8 deg from
		// prod's ink and 1.5x its chroma, and it is a hue the budget already
		// owns, so this costs ZERO new colour values.
		//
		// WHAT IT COSTS. `diverged` prints in the same red, so hue no longer
		// separates "N behind" from "off the release line". That is accepted:
		// the two words share nothing lexically (`−4` is a signed number,
		// `diverged` is a word), and the hue was never what told them apart —
		// it was carrying "adverse" for both. One hue for the whole adverse
		// half of the rank vocabulary is FEWER colours, which is the bar.
		//
		// Deliberately TEXT-ONLY. `alarm` keeps the fill AND the coloured
		// border, so a stuck environment still outranks a merely trailing one
		// when both sit on the same row.
		rank: ADVERSE,
		// `failing` IS THE WORD THE RED DOT CANNOT SAY. It exists because
		// `/apps` was stating an attention row's fact twice — a lede sentence
		// `STAGING is failing` beside a joined box `[●][STAGING]` — and the two
		// halves were not redundant by accident: the box carried the identity
		// colour and the status hue, and the sentence carried the only copy of
		// the VERB. Cutting either lost something real. Giving the box the verb
		// makes it self-sufficient, so the sentence can go and the fact is
		// stated once. Same ADVERSE tone as `rank` and `diverged` — text-only,
		// ZERO new colour values — so `alarm` (the only FILL) stays the loudest
		// mark on the row, which is right: `stuck` has lasted, a failed deploy
		// has just happened and the row's own status circle is already red.
		failing: ADVERSE,
		// `diverged` is the third member of the rank vocabulary — `newest`,
		// `−N`, and the case where a rank is not a distance at all. It takes
		// the product's ONE red (red-700 / dark red-400), the hue already
		// owned by `Failed`, because both mean "adverse and it will not clear
		// on its own"; the closed budget has no spare hue and this needs no
		// new one. It is deliberately TEXT-ONLY, the same geometry as `rank`:
		// `alarm` stays the only chip with a FILL, so amber remains the
		// loudest thing on the page and `stuck` is not out-shouted by a state
		// one row above it.
		diverged: ADVERSE,
		// `blocked` IS THE WORD A CONTRACT GATE CANNOT SAY ANY OTHER WAY, and it
		// is the `failing` precedent applied a second time: a role name exists so
		// a grep tells you what a chip MEANS, and adding one costs nothing when it
		// spends no new value.
		//
		// It marks a release candidate that a `RolloutDependency` is holding back —
		// the consumer declared `com.kuberik.rollout.requires.<contract>` and the
		// provider has not deployed a contract version that satisfies it. On
		// `/rollouts/<cluster>/<ns>/<name>/dependencies` that is the one fact on
		// the page that needs a person, and there was no honest existing role for
		// it: `unranked` is gray and means "no rank is sayable"; `rank` is a signed
		// distance; `failing` is a deploy that failed; `diverged` is off the
		// release line. A blocked build is none of those — it is a build that is
		// fine and may not ship.
		//
		// SAME ADVERSE TONE AS `rank`, `diverged` AND `failing` — `red-700` /
		// `red-400`, TEXT-ONLY. ZERO new colour values, and `alarm` keeps the only
		// FILL, so a `stuck` chip anywhere on the same screen still outranks it.
		// It is deliberately NOT `alarm`: amber means `stuck` and nothing else for
		// state (DESIGN.md, "Colour — closed"), and a gate correctly refusing a
		// candidate is not a stoppage.
		blocked: ADVERSE,
		count: NEUTRAL,
		// `unranked` FILLS THE RANK SLOT WITH THE REASON THERE IS NO RANK —
		// `held`, `pending`, `unknown`. It exists because on a page where the
		// ABSENCE of a rank half is the encoding for "on head", three different
		// states were rendering as that same absence or borrowing the `rank`
		// role, and DESIGN.md forbids rendering an unresolvable comparison as a
		// definite claim.
		//
		// Deliberately GRAY, and that matters more now than it did an hour ago.
		// `rank` just took amber because `−N` is the deviation; none of these
		// three is one. `held` is a pin someone chose, `pending` has never
		// deployed, `unknown` is the case where the ladder cannot answer.
		// Amber on any of them would be an alarm raised on an absence of
		// evidence — the exact failure "never name a cause you cannot evidence"
		// is written against. Same gray pair as `count`/`head`: no new value.
		unranked: NEUTRAL,
		// `head` NAMES the build in the value half; it is not a verdict about
		// anything. It exists because `/apps` was using `newest` — a RANK word —
		// as a label, so the same badge geometry carried a rank on `/`,
		// `/rollouts` and `/versions` and a caption on `/apps`, and a row whose
		// production was four builds behind and stuck printed the product's
		// good-news word as its loudest right-hand token. Deliberately the same
		// gray as `rank`/`count`: it spends NO new colour value, and a caption
		// must not out-rank the deviations it is the anchor for.
		head: NEUTRAL,
		// THE ALARM: A FILL AND A WORD. NO GLYPH. (2026-08-27, from the human:
		// *"we have stuck which has its own dot which is also useless"*.)
		//
		// It was right. The dot was amber, the word beside it was `STUCK`, and
		// they sat 4px apart inside one 57px box — the same fact encoded twice,
		// in a product whose own rule is that a page which states something
		// twice has one encoding too many. This retires the long-standing
		// *"`alarm` is the only chip with a fill AND a glyph"* rule, which
		// existed to guarantee the alarm was the loudest mark on any row. That
		// guarantee now rests on the FILL alone, and it still holds — measured
		// with DESIGN.md's own formula
		// (`area x fillC + area x 0.28 x inkC + perimeter x borderC + dot`) on
		// `/apps` at 1440:
		//
		//     with glyph, amber-200/950   57.1 x 20   204.2 light / 155.5 dark
		//     no glyph,   amber-200/950   48.1 x 20   169.4 light / 128.4 dark
		//     no glyph,   amber-400/900   48.1 x 20   218.6 light / 162.3 dark
		//
		// The middle row is what the glyph alone cost, and it was NOT
		// survivable: 169.4 against `prod-ap-northeast-1`'s 167.7 on
		// `/rollouts` is 1.01x, and 128.4 against `staging`'s 134.9 in dark is
		// 0.95x — the alarm would have stopped being the loudest mark on the
		// page. So the fill paid for it in the same pass; see the note on the
		// `alarm` value below. The rule is intact and the ratios are BETTER
		// than before the glyph came off.
		//
		// THE FILL PAID FOR THE GLYPH, IN THE SAME PASS. Removing the dot cost
		// 9px of width and its own ink: presence fell 204.2 -> 169.4 light and
		// 155.5 -> 128.4 dark, which put the alarm at 1.01x the loudest identity
		// chip on `/` and `/rollouts` and BELOW it in dark (0.95x). The
		// clipping pass had already spent most of the headroom (DESIGN.md:
		// *"widening a chip multiplies its presence by its width, so `wide` is
		// the fastest way in this product to spend the alarm's headroom"*), so
		// there was nothing left to absorb it. Bought back on the FILL, which
		// is the channel the rule now rests on:
		//
		//     light   bg amber-200 -> amber-400,  border amber-400 -> amber-500
		//     dark    bg amber-950 -> amber-900,  border amber-700 unchanged
		//
		// ZERO NEW COLOUR VALUES — amber-400, amber-500 and amber-900 are all
		// already spent in this file and in `CoverageBar` / `EnvHealthStrip`.
		// Measured after, at 1440: presence 218.6 light / 162.3 dark, i.e.
		// **1.30x / 1.20x** the loudest identity mark on `/` and `/rollouts`
		// (167.7 / 134.9) and 1.62x / 1.22x on `/apps` (135.2 / 132.8). Better
		// than the 1.22x / 1.15x it held before the glyph came off.
		//
		// Contrast holds on both: amber-900 on amber-400 is 5.26:1, amber-200
		// on amber-900 is 7.28:1, both past the 4.5:1 small-text floor. The
		// border stays visible against its own fill — dL 0.057 light, 0.142
		// dark — so the chip is still a bordered box and not a slab.
		//
		// The old note, still true and still the reason the fill is where the
		// presence lives: amber-100 (#fef3c6) measures 1.11:1 against white, so
		// the mechanism the spec names as "what makes it loudest" was
		// contributing essentially zero luminance mass and the chip was really
		// an outline chip with a warm tint.
		alarm:
			'border-amber-500 bg-amber-400 text-amber-900 dark:border-amber-700 dark:bg-amber-900 dark:text-amber-200'
	};
</script>

{#snippet body()}
	<!-- NO GLYPH, ON ANY ROLE. `alarm` carried an amber dot next to the word
	     `STUCK` until 2026-08-27, when the human called it *"useless"* — and it
	     was: the dot said `stuck` and the word 4px to its right said `stuck`,
	     one fact in two encodings inside one 57px box. The fill and the word
	     keep the alarm the loudest mark on any row it is on; see `TONE.alarm`
	     for the re-measurement. -->
	<span class="min-w-0 truncate">{label}</span>
{/snippet}

{#snippet valueHalf(solo: boolean)}
	<!-- `solo` also takes the `class` prop, because in the identifier-only form
	     this element IS the chip — the same place `class` lands in the lone
	     form. In the joined form it lands on the `.chip-joined` wrapper and
	     must not be repeated here. -->
	{#if valueHref}
		<a
			class="chip-value {solo ? `chip-value--solo ${className}` : ''} {valueDim
				? 'chip-value--dim'
				: ''}"
			href={valueHref}
			title={valueTitle ?? value}
		>
			<span class="min-w-0 truncate">{value}</span>
		</a>
	{:else}
		<span
			class="chip-value {solo ? `chip-value--solo ${className}` : ''} {valueDim
				? 'chip-value--dim'
				: ''}"
			title={valueTitle ?? value}
		>
			<span class="min-w-0 truncate">{value}</span>
		</span>
	{/if}
{/snippet}

{#if valueOnly}
	<!-- THE IDENTIFIER ALONE. The value half with all four corners at the
	     chip's 4px — the same 20px box, the same 6px padding, the same
	     hairline. It exists because `/versions` used to pair its sha with a
	     WORDLESS status half, which is the sub-badge the human rejected; the
	     state is printed in words by the row's own `Live` column, so the box
	     needs no half to hold it. -->
	{@render valueHalf(true)}
{:else if joined}
	<!-- One object, TWO halves — never three. The border between them is drawn
	     once (the chip drops its right edge), so the pair reads as a single box
	     and not as a chip that happens to sit next to a sha. -->
	<span class="chip-joined {className}" bind:this={el}>
		<span
			class="chip {TONE[role]} {wide ? 'chip-wide' : ''}"
			style={role === 'env' && theme ? getEnvironmentThemeStyle(theme) : undefined}
			title={title ?? label}
		>
			{@render body()}
		</span>
		{@render valueHalf(false)}
	</span>
{:else}
	<span
		class="chip {TONE[role]} {wide ? 'chip-wide' : ''} {className}"
		style={role === 'env' && theme ? getEnvironmentThemeStyle(theme) : undefined}
		title={title ?? label}
		bind:this={el}
	>
		{@render body()}
	</span>
{/if}
