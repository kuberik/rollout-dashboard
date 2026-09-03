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
	import { TagOutline } from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';

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
		| 'unranked'
		| 'held';

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
		icon,
		valueIsBuild = true,
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
		 * A GLYPH FOR THE LABEL HALF, when the ROLE cannot supply one.
		 *
		 * The rank vocabulary supplies its own — see `GLYPH` below — so nothing
		 * in the rank family passes this. It exists for `JoinedBadge`, the last
		 * surviving second badge implementation, whose label half carries a
		 * `BakeStatusIcon`. That was the ONE capability `Chip` did not have and
		 * the only reason two components were drawing one idea; adding it here
		 * is what lets `JoinedBadge` become a shim over this file instead of a
		 * parallel geometry. See that file's header.
		 *
		 * ⛔ It is NOT a general decoration slot. A glyph that repeats the word
		 * beside it is a second encoding, which is why `alarm`'s dot was deleted
		 * on 2026-08-27 and why the `[●][ENV]` status half went with it. Pass one
		 * only when it says something the label does not.
		 */
		icon?: Snippet;
		/**
		 * SET IT FALSE WHEN THE VALUE HALF IS NOT A BUILD ID. Suppresses the tag.
		 *
		 * The rank vocabulary states a POSITION ON THE RELEASE LINE, and at every
		 * call site but one the thing it is positioning is the build printed
		 * beside it — so the tag is true by default. THE EXCEPTION IS
		 * `/versions/<rev>`, whose service list inverts the pair: the ROLE is the
		 * rank (`newest`, `N behind`) but the VALUE is the SERVICE NAME
		 * (`hello-world-app`), because the build is the page. A tag on a service
		 * name claims that name is a version, which is exactly the kind of false
		 * claim `DESIGN.md` forbids ("never render an unresolvable comparison as
		 * a definite claim"), so that call site — and only that one — passes
		 * `valueIsBuild={false}`.
		 *
		 * It is a NEGATIVE opt-out and not a positive `valueKind="build"` because
		 * the default must be the true case: 30-odd call sites hold a build and
		 * one does not, and a prop that every correct caller has to remember is a
		 * prop that will be forgotten on the next page.
		 */
		valueIsBuild?: boolean;
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

	// ── THE CLOSED-VOCABULARY CAP, ASSERTED. See `capClass`.
	// A non-`env` chip's label comes from a closed set whose longest member is
	// `NEVER DEPLOYED`, and the cap is sized to exactly that. If a call site ever
	// passes something longer, the chip would truncate SILENTLY — which is the
	// failure mode that produced `6 BEH…`, `15 BEHI…` and three separate `wide`
	// patches. Name it at the first render instead. `env` is exempt: its labels
	// ARE unbounded and truncating them is the cap's whole job.
	$effect(() => {
		if (!import.meta.env.DEV) return;
		if (role === 'env' || wide || label.length <= 14) return;
		console.error(
			`Chip role="${role}" was given a ${label.length}-character label ("${label}"). ` +
				'Non-`env` labels come from a CLOSED vocabulary and the width cap is sized to its ' +
				'longest member (`NEVER DEPLOYED`, 14). This one will truncate. Either shorten the ' +
				'word or pass `wide` — see the note above `capClass`.'
		);
	});

	// ── THE GROUND IS A CHANNEL NOW. (2026-09-02) ────────────────────────────
	//
	// From the human, a third time on this pair: *"newest / behind badges
	// coloring / styling i still don't like. what do you think about using fully
	// colored left part of the badge and then use the proper colors for newest /
	// behind."*
	//
	// THE COMPLAINT IS ABOUT STRUCTURE, NOT ABOUT HUE, AND THE SCREENSHOT SHOWS
	// IT. Measured on `/rollouts` at 1440, `[NEWEST][1.66.0-66]` and
	// `[1 BEHIND][2.66.0-66]` are two WHITE boxes on a WHITE card, 130.2px and
	// 143.9px wide, whose only internal edge is a 1px `gray-200` hairline and
	// whose only difference is 10px of ink. Two rulings had already been spent
	// re-solving that ink — mint, then loud gray — and neither could work,
	// because the thing that is wrong is that **the mark and the identifier are
	// drawn on the same ground**, so there is no mark, only a longer string.
	//
	// THE MECHANISM ALREADY SHIPS IN THIS FILE, ON THE ROLE NEXT TO IT.
	// `.chip-env` is a tinted fill + a matching border + full-chroma ink — every
	// `DEV` / `STAGING` / `PROD` chip in the product is already a "fully coloured
	// left part", and `environment-theme.ts` states the reason in its own words:
	// *"what separates an identity chip from the alarm is the FILL"*. The rank
	// vocabulary is the ONE chip family that never got a ground. So this is not a
	// new device; it is the device this component already owns, extended to the
	// family the human is looking at.
	//
	// ── THE RULE FOR WHO GETS HOW MUCH ──────────────────────────────────────
	//
	// A fill is AREA, and area is the most expensive channel a repeated mark can
	// spend. Counted on the running product, chips per viewport at 1440:
	//
	//     /              newest  8   N behind  3
	//     /rollouts      newest 12   N behind  3
	//
	// `newest` IS the repeated mark, 3.2 : 1 across the product, so filling both
	// halves to the same strength would hand the norm three times the new ink and
	// re-invert the pair for the third time. The strength of the ground is
	// therefore the DEVIATION CHANNEL:
	//
	//   · WASH  — a `-50` (light) / `-950` at alpha (dark) tint of the role's own
	//             hue. `newest`/`head` take this.
	//   · BLOCK — one ramp step deeper. `rank` and the three ADVERSE roles take
	//             this.
	//   · FILL  — saturated, `alarm` alone, untouched by this pass.
	//
	// ⛔ THE GROUND IS NO LONGER THE ONLY DEVIATION CHANNEL, BECAUSE A NEUTRAL
	// GROUND IS NOT A COLOUR. (2026-09-02, second ruling of the day, from the
	// human: *"i thought about newest / behind badges to use more prominent
	// colors, not these faint / no colors."* That is the FOURTH time in one
	// direction — *"we probably want to mark it with some color just not to be so
	// prominent"*, *"I generally think we're undercoloring now a bit"*, *"I think
	// green on newest badge is too faint"*, and now this.)
	//
	// THE COMPLAINT IS MEASURABLE AND THE NUMBER IS DAMNING. On `DESIGN.md`'s own
	// presence formula — `area × fillC + area × 0.28 × inkC + perimeter ×
	// borderC` — the pair the wash/block pass shipped scored, canvas-resolved
	// against the composited card on `/rollouts` at 1440:
	//
	//              newest   N behind   ratio
	//     light      24.8      26.3    1.06×
	//     dark       66.8      65.6    0.98×
	//
	// **The deviation was not louder than the norm on the product's own colour
	// instrument at all.** It led only on LIGHTNESS — which is the channel a
	// browser spends on `:disabled`, on a skeleton and on a dimmed row, and which
	// this same file already rejected once for the neutral row band (*"a gray
	// band on a white list reads as THIS ONE IS BROKEN, not as LOOK HERE"*). For
	// scale: the quietest identity chip on the same row, `DEV`, scores 54.9 —
	// more than double either half of the badge. The most repeated object in the
	// product was its least coloured one.
	//
	// ── SO THE FIX IS A GROUND, AND THE TWO HALVES SPEND DIFFERENT CHANNELS.
	// `newest` is PLAIN GREEN (`green-800`, C 0.119) in a `green-50` wash.
	// `N behind` is a DEEP, DESATURATED ORANGE (`orange-950` ink, C 0.079) in an
	// `orange-100` block, five times less chromatic than the `alarm` fill it must
	// not be mistaken for. The rule that decides both is one line:
	//
	//        HUE answers "DOES THIS NEED A PERSON". WEIGHT answers "HOW LOUD".
	//
	// Read `TRAILING` before touching either — it records the FOUR spellings the
	// human rejected in one day and closes the hue space by elimination.
	//
	// ⛔ EACH REJECTION IS A RULE, NOT A PREFERENCE:
	//   1. teal + `blue-800` — *"why is behind purple? and why is newest this
	//      weird tint and not plain green?"* `teal-700` is h 186.4° against plain
	//      green's 150.1°, 36° toward cyan; Tailwind's `blue` is violet-leaning
	//      at h 265.6°. **A hue nobody can name cannot carry a meaning**, and
	//      both had been reached by dodging an adjacency instead of designing
	//      one. → solve adjacency by TREATMENT and LIGHTNESS, never by walking
	//      the hue.
	//   2. green + `sky-800` — *"i think it shouldn't be blue. behind is not
	//      necessarily a problem, but could be if it's also marked as stuck."*
	//      → a MEASUREMENT may not wear a VERDICT's channel at all.
	//   3. the pale gray block that started this — faint because it was
	//      unfilled text on the card ground, NOT because it lacked hue.
	//      → the cure for faint is a FILL, and only sometimes a hue.
	//   4. a filled slate SLAB — *"white/black fill for behind is an eye-sore."*
	//      It measured better than everything else (3.84× the norm on weight) and
	//      was still wrong. → **measuring well is not being right; look at it.**
	//
	// ZERO NEW HUES. The budget is six status + four identity and it is still
	// exactly that. What moves is WHICH SURFACE a hue may appear on, which the
	// file already treats as separable — *"two of the identity hues are also
	// status hues, deliberately, and are separated by SHAPE rather than by hue"*:
	//
	//   · mint keeps `newest` and is plain green now (`green-800` / `green-300`).
	//     Its adjacency to the `Succeeded` disc and the `DEV` identity chip is
	//     solved by TREATMENT and LIGHTNESS, not by hue. See `MINT`.
	//   · blue takes `N behind`. Blue is `Deploying`'s hue on the status GLYPH;
	//     on a chip it is the same separation-by-shape the identity hues already
	//     use, and it is the semantically right one — a build that is behind is a
	//     build with a promotion still to come. It is NOT adverse, which is the
	//     whole reason it may not be red, and NOT `stuck`, which is why it may
	//     not be amber. See `TRAILING`.
	//
	// ⛔ `count` AND `unranked` STAY UNGROUNDED, AND THAT IS THE POINT. A ground
	// says "this half is a mark". `count` is a caption and `unranked` is the
	// ABSENCE of a rank (`held`, `pending`, `unknown`); grounding either would
	// raise an alarm on an absence of evidence, which is the failure
	// "never name a cause you cannot evidence" is written against.
	//
	// THE TONES A CHIP CAN TAKE, named once so they cannot drift apart.
	// Before these constants existed the same six strings were written out six
	// times, which is how `newest` spent eight months a different gray from
	// `count`.
	//
	// NEUTRAL — the norm, or a caption. Spends no colour at all, and no ground.
	const NEUTRAL = 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400';
	// ⛔ THE BORDER STAYS NEUTRAL ON EVERY ROLE BELOW, AND THAT IS THE ONE THING
	// THAT KEEPS A RANK CHIP FROM BEING AN IDENTITY CHIP. `.chip-env` is the only
	// family with a COLOURED EDGE; the rank family is a COLOURED FIELD inside the
	// same `gray-200` / `gray-700` hairline `.chip-value` draws one pixel to its
	// right. Rendered with matching teal/blue borders instead (candidate B), the
	// joined badge reads as two glued boxes — the coloured edge stops at the seam
	// and the value half's gray one carries on — and `[NEWEST 1.66.0-66]` becomes
	// indistinguishable in KIND from `[DEV]` at a glance. Screenshotted both;
	// this is the difference.
	//
	// MINT — the word `newest`, WHEREVER IT IS SPELLED. `newest` and `head` both
	// resolve here and that is deliberate; see the note on `TONE.head` for the
	// measurement that collapsed them.
	//
	// ⛔ IT IS PLAIN GREEN, AND THE TEAL THAT SHIPPED FOR ONE HOUR IS THE LESSON.
	// (2026-09-02, from the human on the teal/blue pair: *"why is behind purple?
	// and why is newest this weird tint and not plain green?"*)
	//
	// BOTH HALVES OF THAT COMPLAINT ARE A HUE MEASUREMENT AND BOTH ARE CORRECT.
	// `teal-700` is OKLCH **h 186.4°** and plain `green-700` is **h 150.1°** — the
	// word was sitting **36° toward cyan**, which is far enough that a reader who
	// did not choose it reads neither green nor blue, only *a tint*. Tailwind's
	// `blue` ramp is violet-leaning (`blue-800` h **265.6°** at C 0.199), and at
	// that chroma it reads purple; `sky-800` is h **242.8°** and reads as plain
	// blue. Naming a colour is a design requirement, not a nicety: a hue nobody can
	// name cannot carry a meaning.
	//
	// ── WHY IT WAS TEAL, AND WHY THAT REASONING WAS WRONG ───────────────────
	//
	// The one open risk on record is that `newest` lands on rows that already
	// carry green: a `Succeeded` status disc at hue ~150 and, on DEV rows, a green
	// identity chip. The teal pass answered that by MOVING THE HUE AWAY, and
	// congratulated itself for widening the gap 30° → 37°. **That is solving an
	// adjacency by abandoning the meaning.** The two objects already differ in
	// KIND — one is an identity, one is a rank; one is a `.chip-env` with a
	// COLOURED EDGE, one is a rank chip with a NEUTRAL edge — and a reader
	// separates them on that, on lightness, and on the words, not on 36° of hue.
	//
	// ── SO IT IS GREEN, SEPARATED ON LIGHTNESS. MEASURED, canvas-resolved on the
	// composited card at 1440, against the `DEV` chip's ink and the `Succeeded`
	// disc (the two greens it can sit beside):
	//
	//                    L      C       h        CR     dE00 vs DEV / Succeeded
	//   green-700     0.530  0.149  149.0°    4.72:1     **0.0 / 0.0**  ⛔
	//   green-800     0.447  0.119  151.4°    6.81:1       9.9 / 9.9    ✅
	//   green-900     0.393  0.096  152.3°    8.65:1      15.9 / 15.9
	//   emerald-700   0.513  0.110  163.6°    5.09:1       9.0 / 9.0
	//
	// **`green-700` IS DEV'S INK.** `PRESET_RAMPS.dev.textColor` is `#008236` and
	// `green-700` resolves to `#008236` — dE00 **0.0**, the same value, and the
	// same value again as the `Succeeded` glyph. Using it would print one colour
	// for an identity, a state and a rank. **`green-800` is the step that is
	// plainly green and not that value**: 1.4° of hue from DEV, but 0.083 of
	// LIGHTNESS below it, which is the axis this file already settles states on
	// (*"`STATUS_DOT_CLASS` splits the settled states on LIGHTNESS instead of
	// hue"*). dE00 9.9 is ~4× the 2.3 JND. It also carries 1.33× the chroma of the
	// teal it replaces and 2.4× the hand-picked hex before that, and its contrast
	// goes 5.14 → **6.81:1**.
	//
	// `emerald-700` was measured as the fallback the brief asked for and is worse
	// on every axis that matters — same dE00 to DEV (9.0 vs 9.9), 2.4pp less
	// contrast, lower chroma, and it is 13.6° off green, i.e. the same "not quite
	// green" the human just rejected. Plain green wins on the numbers.
	//
	// ⚠️ HONEST RESIDUE: `newest`'s FILL (`green-50`) is dE00 **1.5** from the
	// `DEV` chip's surface. They share a ground. What separates the two chips is
	// the BORDER (`gray-200` hairline vs `green-300` ring), the ink's lightness,
	// and the word. That is thinner than teal's separation was, and it is the
	// price of a nameable colour — paid deliberately, not overlooked. Do not
	// "fix" it by deepening this fill: `green-100` measures presence 106 against
	// `N behind`'s 154, which collapses the deviation ratio to 1.37×.
	//
	// ⚠️ ONE CALL SITE OUTSIDE THIS FILE STILL SPELLS THE OLD MINT AS A HEX:
	// `ExposureBar.svelte:115` (`bg-[#426d64] dark:bg-[#83b0a8]`, the newest
	// segment, drawn only on `/apps/<name>`). MUST move to
	// `bg-green-800 dark:bg-green-300` when that file is next opened, or the slot
	// ships two spellings — the defect the `head` → `newest` collapse ended.
	//
	// The ground is a WASH — `green-50`, ΔL 0.018 from the card — so the norm's
	// half is an OBJECT rather than the first six characters of a string, at a
	// third of `TRAILING`'s step, because `newest` outnumbers `N behind` 3.2 : 1
	// and area is the channel a repeated mark must not spend. Dark takes
	// `green-950` at 30% for the same reason `ADVERSE` takes an alpha there.
	const MINT =
		'border-gray-200 bg-green-50 text-green-800 dark:border-gray-700 dark:bg-green-950/30 dark:text-green-300';
	// TRAILING — `−N` / `N behind`. THE DEVIATION. IT IS A **DEEP, DESATURATED
	// ORANGE GROUND WITH A DARK INK**, and it is the fifth spelling of this pair.
	//
	// ⭐ THE RULE THAT SURVIVED ALL FIVE, AND THE ONE TO READ FIRST:
	//
	//        HUE answers "DOES THIS NEED A PERSON". WEIGHT answers "HOW LOUD".
	//
	// Being behind is a MEASUREMENT, not a verdict. This file's own standing rule
	// is that *drift is the normal state of a promotion pipeline*, so most
	// rollouts are behind most of the time; what makes it matter is WHY — stuck,
	// blocked, or merely waiting. So `behind` may be PRESENT but must never look
	// like it is ASKING for something, and it must never be mistaken for `stuck`.
	//
	// ── ⛔ THE OPTION SPACE IS CLOSED BY ELIMINATION. DO NOT REOPEN IT. ──────
	// Four spellings were rejected by the human in one day, each for a different
	// and recorded reason:
	//   1. LOUD NEUTRAL GRAY TEXT — *"faint / no colors."* It was unfilled text on
	//      the card ground; on `area × chroma` the pair scored 1.06× light and
	//      0.98× dark, i.e. the deviation was not louder than the norm at all.
	//   2. `blue-800` — *"why is behind purple?"* Tailwind's `blue` is
	//      violet-leaning, h 265.6° at C 0.199. **A hue nobody can name cannot
	//      carry a meaning.**
	//   3. `sky-800` — *"i think it shouldn't be blue. behind is not necessarily a
	//      problem, but could be if it's also marked as stuck."* Blue out entirely.
	//   4. A FILLED SLATE SLAB (`gray-700` under `gray-50`) — *"white/black fill
	//      for behind is an eye-sore."* It measured beautifully (3.84× the norm on
	//      weight, 3.43× alarm lead on chroma) and was still wrong. **Measuring
	//      well is not the same as being right; look at it.**
	//
	// What remains: green belongs to `newest` and is settled; red is adverse and
	// behind is not adverse; amber IS `stuck`; violet is STAGING and cyan is TEST
	// identity; a neutral fill is an eye-sore. **Orange at h ~70° is the only
	// thing left**, and it is what the human proposed unprompted.
	//
	// ── THE TWO WARM NEIGHBOURS, AND HOW THIS IS HELD APART FROM THEM ───────
	// Both can sit on the same row as `behind`: the `alarm` fill is `#ffb900`
	// (amber-400, h 84.4°, C 0.189) and the `PROD` identity seed is `#d97706`
	// (amber-600, h 58.3°). This is separated on **treatment and saturation**, the
	// way `green-800` was separated from the DEV green — never by walking the hue,
	// which is what produced the teal nobody could name. Measured canvas-resolved
	// on `/rollouts` at 1440, dE00 from this chip's GROUND:
	//
	//                          → `#ffb900`   → `#d97706`   → PROD chip fill   ink → PROD ink
	//     light `orange-100`      **23.6**      **32.5**         7.7             **15.6**
	//     dark  `orange-950/70`   **70.3**      **44.9**        12.9             **19.5**
	//
	// Nothing lands under 5; the tightest figure anywhere is 7.7 (this chip's pale
	// ground against `PROD`'s paler one in light), and the two chips differ in
	// TREATMENT there anyway — `PROD` is outlined in `amber-200` with an
	// `amber-900` ink, this is a neutral hairline with a near-black orange ink.
	//
	// ⛔ TWO WARM CANDIDATES WERE REJECTED ON EXACTLY THIS AXIS, and they are why
	// the shipped value is a `-100` and not a `-200`:
	//   · `orange-900` ink is dE00 **4.5** from `PROD`'s `amber-900` ink. On
	//     `/apps` those two render as ADJACENT HALVES OF ONE BOX — the collision
	//     that moved `rank` off amber in the first place. `orange-950` is 15.6.
	//   · `orange-300` as a light GROUND is dE00 **10.7** from `#ffb900` and
	//     scores 242.2 on `area × chroma`, i.e. **louder than `alarm` itself**
	//     (218.6). `orange-200` (16.7 / 180.2) reads as amber-that-is-not-stuck
	//     when screenshotted beside a real `STUCK` chip. `orange-100` does not.
	//
	// ── THE ORDERING, WHICH IS THE HARD PART, AND IT HOLDS ──────────────────
	// `area × chroma`, DESIGN.md's formula, the instrument on which "loudest"
	// means "most alarming". Light raw; dark corrected for the chromatic card
	// ground (every chip on `gray-800` scores its own area × 0.0335 for free, and
	// these boxes differ in area by 1.7×, so the raw dark figure is size-biased):
	//
	//     light   alarm 218.6  >  adverse 117.6  >  **behind 99.7**  >  newest 70.7
	//     dark    alarm 130.0  >  adverse 108.9  >  **behind  91.9**  >  newest 54.2
	//
	// `alarm` leads by **2.19× / 1.41×** and keeps the only SATURATED fill
	// (C 0.189 against this ground's 0.038 — five times less chromatic).
	//
	// ⚠️ AND THE PRESENCE RATIO IS CAPPED BY THAT ORDERING — THIS IS ARITHMETIC,
	// NOT A TUNING FAILURE. `newest` is 70.7 and `adverse` is 117.6, so a `behind`
	// that stays under `adverse` can be at most **1.66×** the norm on chroma. The
	// 2.05× the blue pair reached was only available because that pair OUT-INKED
	// `diverged`, which is worse. Shipped: **1.41× light / 1.70× dark** on chroma
	// and **1.65× / 1.28×** on `area × (chroma + |ΔL|)`. If a future pass wants a
	// bigger ratio it must move `newest` down or `adverse` up — not this chip.
	//
	// Contrast is where the headroom went instead: **13.65:1 light, 9.28:1 dark**,
	// the highest of any rank tone. (`sky-700` on `sky-200` failed the 4.5 floor
	// by 0.10 two spellings ago; measure before falling in love with a candidate.)
	//
	// THE GROUND IS A BLOCK — `orange-100`, ΔL 0.046 from the card, ~2.6× `MINT`'s
	// `green-50` wash — so the wash/block structure holds, and the BORDER stays
	// the neutral hairline like every other non-`env` role.
	const TRAILING =
		'border-gray-200 bg-orange-100 text-orange-950 dark:border-gray-700 dark:bg-orange-950/70 dark:text-orange-300';
	// ADVERSE — `failing`, `diverged`, `blocked`. ONE hue for all three; the WORD
	// says which kind. `alarm` keeps the only SATURATED fill and stays the
	// loudest mark on a row.
	//
	// ⛔ IT STEPPED `red-50` → `red-100` FOR ONE HOUR AND IS BACK AT `red-50`.
	// The step was contingent: while `N behind` was a chromatic block it scored
	// 143.3 on `area × chroma` against adverse's 117.6, i.e. a merely-trailing
	// chip out-inking a diverged one, and `red-100` was the cheapest way to
	// restore the order. **`behind` carries no hue now** (see `TRAILING`), so it
	// scores 63.8 and the cause is gone — light ordering on chroma is
	// `alarm 218.6 > adverse 117.6 > newest 70.7 > behind 63.8` with the settled
	// value. A change whose reason has expired is reverted, not kept.
	//
	// ⛔ AND ITS GROUND IS A CHOSEN STEP, NOT AN ALPHA WASH OF ITS OWN INK.
	// This is the one place the wash derivation fails, and it fails on the floor:
	// `red-400` measures only **5.08:1** on `gray-800` to begin with — the
	// thinnest headroom of any ink in this file — and washing the ground with the
	// ink SPENDS that headroom instead of buying any. Measured, canvas-resolved
	// against the composited card:
	//
	//     dark, red-400 ink        ungrounded  5.08:1
	//       · ground red-400/5     #292c3b     4.79:1
	//       · ground red-400/10    #352f3e     4.47:1   ⛔ UNDER THE 4.5 FLOOR
	//       · ground red-950/50    #321921     5.61:1   ✅ ABOVE the ungrounded
	//
	// A DARK ground under a light ink adds contrast; a wash of the ink itself
	// only ever removes it. So adverse takes a CHOSEN step in both themes —
	// `red-100` / `red-950/50`, both already spent in `src` (`DependencyNode`,
	// `/history`, `ControlCenter` all draw `bg-red-50`/`bg-red-100` /
	// `dark:bg-red-950/…`), zero new values — and this is the same argument
	// `environment-theme.ts` makes for COMPUTED → CHOSEN: a ramp ships designed
	// contrast relationships and a derived point on a line does not. `MINT` now
	// makes that argument too; the "mint has no ramp" exemption is retired.
	const ADVERSE =
		'border-gray-200 bg-red-50 text-red-700 dark:border-gray-700 dark:bg-red-950/50 dark:text-red-400';

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
		//
		// ⛔ SUPERSEDED 2026-09-02 (second ruling of the day). Everything above is
		// the record of solving this word's ink INSIDE a white box, and it ended
		// with the human calling the result faint for the fourth time. The value
		// is `green-800` / `green-300` on a `green-50` / `green-950-at-30%` ground
		// now; see `MINT`, including the hour it spent as TEAL, which the human
		// named on sight (*"why is newest this weird tint and not plain green?"*).
		// The argument above that still holds and was carried forward is §1,
		// FULL-CHROMA MINT INVERTS THE PAIR — which is why this is `green-800`
		// and not `green-700`, and why the deviation leads on the GROUND.
		// ⛔ §2 IS THE ONE THAT WENT WRONG: *"it must not become a third green"*
		// was read as *"it must not BE green"*, and dodging the hue is what
		// produced the teal. The real constraint is that it must not be the SAME
		// GREEN — and `green-700` literally is (dE00 **0.0** against both DEV's
		// ink and the `Succeeded` glyph). `green-800` is 9.9 from both, ~4× the
		// JND, separated on lightness. The other thing NO LONGER TRUE is the
		// closing sentence of §1: mint is not a hand-picked hex any more, and the
		// `CoverageBar` co-tenancy it cites ended when that bar's `live` segment
		// moved to the health green.
		newest: MINT,
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
		//
		// ⛔ AND IT IS NOT RED ANY MORE EITHER. (2026-08-30) `−N` IS NEUTRAL GRAY.
		//
		// From a live UX critique of the running product: *"`−N` chips render RED
		// across the product, so normal pipeline drift reads as failure while a
		// pinned prod rollout gets a calm gray-amber chip. Fix the semantics: red
		// must mean adverse."* That is the whole charge and it is correct. On
		// `/apps/hello-world-app` the STATE rail printed `−19 −19 −24` in the same
		// `red-700` as `Failed`, on an app whose three environments had all
		// deployed successfully.
		//
		// `DESIGN-INTENT.md` already said so and had been overridden by two rounds
		// of local colour reasoning: *"Rank chips are mint for `newest` and
		// NEUTRAL GRAY for `−N from newest` — never amber."* It is not amber and it
		// is not red; it is gray.
		//
		// THE PREDICATE THE RED VIOLATED. *"Drift is the normal state of a
		// promotion pipeline. The only adverse state is stuck"* — so `−N` is not a
		// deviation at all, and painting the pipeline's steady state in the failure
		// hue is the loudest possible way to say nothing. The product's own enforced
		// rule is one line above it in DESIGN.md: *"'Drift' is not a valid status."*
		//
		// WHAT ABOUT THE INK HIERARCHY THIS BREAKS? DESIGN.md holds `−N` above
		// `newest` in ink so *"the deviation stays dominant"*. That argument
		// assumed `newest` is the NORM and `−N` the deviation, and on the live
		// cluster the opposite is true: most environments trail and reaching head
		// is the rare, informative event. `COMPOSITION-GRAMMAR.md` scopes the rule
		// to *"repeated marks in a list"* — in a fleet list the repeated mark IS
		// `−N`. So quiet mint on the rarer state and no colour at all on the
		// repeated one is the rule applied correctly, not abandoned.
		//
		// RED STILL MEANS ADVERSE, and it keeps all three genuinely adverse roles:
		// `diverged` (off every release line), `failing` (the deploy failed), and
		// `blocked` (a contract gate refuses it). Those are states that will not
		// clear on their own. Being four builds behind clears itself on the next
		// promotion. ZERO colour values change — `rank` moves onto the gray
		// `count`/`head`/`unranked` already spend.
		//
		// ⛔ AND THE GRAY IS THE LOUD ONE, NOT THE QUIET ONE. (2026-09-01)
		//
		// From the human, on a screenshot of `NEWEST 1.66.0-66` beside
		// `1 BEHIND 2.66.0-66`: *"not sure i like coloring for newest/behind in
		// these badges."* Measured on the running dark page at 1440, canvas-
		// resolved and composited against the card ground (never regexed out of
		// the `oklch()` source, which produced a badly wrong number earlier on
		// this branch):
		//
		//              light #hex   L       C        contrast   dark #hex   L       C        contrast
		//   newest     #426d64      0.5004  0.0503   5.83:1     #83b0a8     0.7225  0.0495   6.11:1
		//   N behind   #6a7282      0.5510  0.0267   4.84:1     #99a1af     0.7071  0.0224   5.64:1
		//
		// So `newest` was 1.88x the chroma of `N behind` in light and 2.21x in
		// dark, AND darker (L 0.500 vs 0.551). On `characters × chroma` — both
		// halves text-only in one face, size and weight, so the glyph constant
		// cancels — `NEWEST` printed 1.61x the ink of `1 BEHIND` in light and
		// 1.89x in dark. THE NORM WAS SHOUTING AND THE DEVIATION WAS WHISPERING,
		// which is the exact inversion the human's first ruling banned:
		// *"NEWEST doesn't need attention and shouldn't be colored. '-4' does
		// need attention and should be colored."*
		//
		// ── THE PREMISE THAT PUT IT THERE IS FALSE, AND IT IS COUNTABLE ──────
		//
		// DESIGN.md defends the pair with: *"On the live cluster ... most
		// environments trail and reaching head is the rare, informative event."*
		// Counted on the running product, chips per viewport at 1440:
		//
		//     /              newest  8   N behind  3
		//     /environments  newest  9   N behind  3
		//     /rollouts      newest 12   N behind  3
		//     TOTAL          newest 29   N behind  9      — 3.2 : 1
		//
		// `newest` IS the repeated mark. `COMPOSITION-GRAMMAR.md` scopes
		// "mark the deviation, never the norm" to *"repeated marks in a list"*,
		// and in every list this product has, the repeated mark is `newest`. The
		// rule was applied to the wrong member.
		//
		// Worse, the mint lands on rows that are ALREADY green: a `Succeeded`
		// status circle at hue ~150, and on DEV rows a green identity chip too.
		// A third green at 31 degrees' separation on a 10px six-letter word is
		// the failure this same file rejects `emerald-600` for, arriving at
		// lower chroma.
		//
		// ── WHAT CHANGES, AND WHY IT IS NOT A COLOUR ────────────────────────
		//
		// `newest` is UNTOUCHED — the human asked for it *"marked with some
		// color just not to be so prominent"* and quiet mint is that, once it is
		// no longer the loudest of the two. Its value is one budget slot shared
		// character for character with `CoverageBar`'s `live` segment and
		// `ExposureBar`'s newest segment; moving it would move those.
		//
		// `rank` takes the LOUD neutral instead. There is no hue available and
		// there must not be one: red means adverse (three roles hold it), amber
		// means `stuck` and nothing else, green/blue/yellow are states, mint is
		// "on the build in question". So the deviation is marked on the axis
		// this file already settles states on — *"`STATUS_DOT_CLASS` now splits
		// the settled states on LIGHTNESS instead of hue"* — using the gray the
		// value half is already printing:
		//
		//   light  #6a7282 → #364153   L 0.551  → 0.373   4.84:1 → 10.3:1
		//   dark   #99a1af → #e5e7eb   L 0.707  → 0.928   5.64:1 → 11.85:1
		//
		// Presence as `characters × ΔL from the ground`, which is what actually
		// carries a 10px uppercase word when chroma is ~0 on one side:
		//
		//   light  newest 3.00  ·  N behind 3.14 → 4.39   (0.96x → 1.46x newest)
		//   dark   newest 2.66  ·  N behind 3.00 → 4.54   (1.13x → 1.71x newest)
		//
		// ZERO NEW COLOUR VALUES: `gray-700` / `gray-200` is `.chip-value`'s own
		// ink, one pixel to the right inside the same box. ZERO ink-ceiling cost:
		// `area × chroma` scores a neutral at ~0, so `alarm`'s fill is still the
		// loudest mark on any row it appears on, and `failing` / `diverged` /
		// `blocked` still own the only red.
		//
		// ⛔ AND THAT LAST SENTENCE IS THE BUG, READ AS A FEATURE. (2026-09-02,
		// second ruling.) *"`area × chroma` scores a neutral at ~0"* was offered
		// as proof that the loud gray was FREE. It is equally proof that it was
		// INVISIBLE as colour: on the product's own instrument the pair scored
		// 24.8 / 26.3 light and 66.8 / 65.6 dark — **1.06× and 0.98×** — i.e. the
		// deviation was not louder than the norm at all, it was only DARKER. The
		// human's answer to seeing it: *"i thought about newest / behind badges to
		// use more prominent colors, not these faint / no colors."*
		//
		// `rank` IS A DEEP DESATURATED ORANGE NOW — see `TRAILING`, which records
		// the four spellings the human rejected in one day (loud gray, `blue-800`,
		// `sky-800`, and a filled slate slab) and closes the hue space by
		// elimination. Everything this comment argues survives: it is NOT red
		// (drift is the pipeline's normal state) and — the part that took the
		// longest to get right — it is NOT the `alarm`'s amber either, at dE00
		// 23.6 light / 70.3 dark from `#ffb900` and one fifth of its chroma.
		// `alarm` is still the loudest mark on any row on the instrument where
		// "loudest" means "most alarming" — `area × chroma`, light: alarm 218.6 >
		// adverse 117.6 > `N behind` 99.7 > `newest` 70.7; dark, card-floor
		// corrected: 130.0 > 108.9 > 91.9 > 54.2. **The ordering this file has
		// been chasing for five spellings holds in both themes for the first
		// time.**
		rank: TRAILING,
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
		// `held` IS NOT ADVERSE. (2026-09-03) A gate correctly refusing a
		// candidate — the exact predicate `blocked`'s own note above states —
		// is what `held` names, so it may not wear the adverse red either. The
		// rollout Overview's `Available Version Upgrades` list printed
		// `Chip role="blocked" label="held"`, 30px under an orange banner
		// stating the same fact, in `red-50`/`red-700` — the ink this file
		// reserves for `failing`/`diverged`/`blocked`, none of which is true
		// here. Every status DISC in the product already resolves `held` to
		// orange (`getStatusCircleClass`, `bake-status.ts`); this is the same
		// call for the chip. ALIAS, not a new tone — `held` is `TRAILING`
		// verbatim, the same deep desaturated orange `N behind` already
		// spends, because both say "present, and normal, but needs a look".
		held: TRAILING,
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
		// ⛔ `head` IS `newest`. ONE FACT, ONE SPELLING. (2026-09-01)
		//
		// From the human: *"i don't like that we have"* — the same complaint that
		// produced the four earlier ink collapses on this branch. This one is the
		// clearest instance of it in the product: the word `newest`, in the same
		// 20px box, joined to the same sha, reached from the same `rank === 0`
		// branch, was printed in TWO DIFFERENT HUES depending on which file drew
		// it. `/` and `/rollouts` went through `rankRole()` → `newest` (mint);
		// `/environments`, `/envs/[name]`, `/apps/[name]` and `PromotionPipeline`
		// hard-coded `role="head"` (gray). All five say `label="newest"`; there
		// is no call site where `head` means anything else. It was never a second
		// fact, only a second spelling.
		//
		// ── MEASURED, ON THE RUNNING PRODUCT ────────────────────────────────
		// Canvas-resolved and composited against each chip's own opaque ground
		// (never regexed out of the `oklch()` source — that produced a badly
		// wrong number earlier on this branch), 1440, both themes:
		//
		//                     light hex   L       C       h       ΔL     ratio
		//   newest (mint)     #426d64   0.5004  0.0503  179.4°  0.4996  5.83:1
		//   newest (gray)     #6a7282   0.5510  0.0267  264.3°  0.4490  4.84:1
		//   N behind (rank)   #364153   0.3731  0.0343  260.2°  0.6269  10.3:1
		//
		//                     dark hex    L       C       h       ΔL     ratio
		//   newest (mint)     #83b0a8   0.7225  0.0495  182.7°  0.4442  6.11:1
		//   newest (gray)     #99a1af   0.7071  0.0224  261.7°  0.4287  5.64:1
		//   N behind (rank)   #e5e7eb   0.9276  0.0058  264.5°  0.6492  11.85:1
		//
		// THE GRAY SPELLING COLLIDES WITH THE THING IT IS SUPPOSED TO CONTRAST
		// WITH. `newest`-as-gray sits **4.1° of hue** from `N behind` in light and
		// **2.8°** in dark. They are the same hue; the only channel separating
		// the two members of the rank vocabulary was lightness, two steps of gray
		// on a 10px uppercase word. The mint spelling separates them by **80.8°**
		// (light) / **81.8°** (dark) AND by lightness. On `/envs/prod` today a
		// reader has to compare two grays to tell "on the newest build" from
		// "one build behind"; on `/rollouts`, 250ms away, the same pair is
		// unmistakable. That is the cost of the second spelling, in degrees.
		//
		// AND MINT NO LONGER OUT-SHOUTS THE DEVIATION, which is the only reason
		// this role was ever gray. `rank` took `.chip-value`'s own loud gray one
		// commit ago (`efcf8ad`), so on `characters × (ΔL + C)` — both halves
		// text-only in one face, size and weight, so the glyph constant cancels;
		// `NEWEST` is 6 characters against `1 BEHIND`'s 7:
		//
		//   light   newest 3.30  ·  N behind 4.63   deviation 1.40× dominant
		//   dark    newest 2.96  ·  N behind 4.59   deviation 1.55× dominant
		//
		// Against the gray spelling the deviation led 1.62× / 1.70×, so unifying
		// on mint spends 14% of that headroom and the deviation still leads on
		// every channel. `alarm` is untouched and still the only chip with a FILL
		// (218.6 / 162.3 presence units against mint's ~2.5).
		//
		// THE HUMAN'S OWN RULINGS, IN ORDER, ALL POINT HERE. *"NEWEST doesn't
		// need attention and shouldn't be colored"* → *"changed my mind on newest
		// chip, mark it with some color just not to be so prominent"* → *"I
		// generally think we're undercoloring now a bit."* The gray spelling is
		// the FIRST ruling, still shipping on three surfaces eight days after it
		// was reversed. Going gray everywhere would re-apply a reversed ruling,
		// remove colour from three pages while the human asks for more, and leave
		// mint's one budget slot held only by `CoverageBar`'s `live` segment and
		// `ExposureBar`'s newest segment with no chip left to anchor what it
		// means. Going mint everywhere costs ZERO new colour values — `#426d64` /
		// `#83b0a8` is already on screen 20 times per viewport — and takes the
		// product from two spellings to one.
		//
		// ⚠️ `head` SURVIVES AS A NAME, NOT AS A TONE. Four of the five call
		// sites are in files this pass does not own, so the role string stays and
		// resolves to the same constant `newest` does. Do not give it a value of
		// its own again: the two roles are ONE spelling by decision, and if they
		// ever differ the product is back where it started. When the remaining
		// call sites are next opened, migrate them to `role="newest"` and delete
		// this entry.
		head: MINT,
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

	// THE ROLES THAT STATE A POSITION ON THE RELEASE LINE — i.e. the roles whose
	// joined box is ABOUT A BUILD. They and only they draw the tag; see the note
	// in `body()`. `env` is an identity and `alarm`/`failing`/`blocked` are
	// states whose value half is not a build (`[STUCK][3d 4h]` holds a duration),
	// so a tag on any of them would be a false claim about the string beside it.
	const GLYPH = new Set<ChipRole>(['newest', 'head', 'rank', 'diverged', 'unranked']);

	/** Does this render draw the tag? Both the glyph and the cap depend on it. */
	const hasGlyph = $derived(!icon && joined && valueIsBuild && GLYPH.has(role));

	// ── THE 12ch CAP IS A BUDGET FOR THE WORD, NOT FOR THE BOX. ──────────────
	// (2026-09-02, caught within the hour by the pass on `/versions/<rev>`: that
	// page's rank chip does NOT take `wide`, and `6 BEHIND` — which fit at 12ch
	// with 4.6px to spare — rendered `6 BEH…` the moment the glyph appeared.)
	//
	// `app.css` caps `.chip` at `12ch` so ONE LONG ENVIRONMENT NAME CANNOT EAT A
	// ROW. That is a contract about the LABEL: twelve characters of word. The tag
	// is not word — it is 11px of glyph plus a 3px gap, a fixed 14px that carries
	// no characters — so charging it to the word's budget silently shortens every
	// label in the product by two characters, and two characters is the whole
	// difference between `6 BEHIND` and `6 BEH…`.
	//
	// So the box grows by EXACTLY the glyph's own box and the word keeps all
	// twelve of its characters. Measured, `newest` 53.9 → 67.9px: +14.0, the
	// glyph and nothing else.
	//
	// THE CONTRACT IS UNCHANGED, WHICH IS THE TEST. Every spelling that fit
	// before still fits and every spelling that needed `wide` before still needs
	// it — measured at 10px/0.08em on the running product:
	//
	//     NEWEST        6 ch   53.9 → 67.9   fits at 12ch either way
	//     6 BEHIND      8 ch   67.6 → 81.6   fit before; fits now ONLY via this
	//     UNKNOWN       7 ch   60.6 → 74.6   fit before; fits now ONLY via this
	//     19 BEHIND     9 ch   74.6 → 88.6   needed `wide` before, still does
	//     UNRELEASED   10 ch   81.5 → 95.5   needed `wide` before, still does
	//     ROLLED BACK  11 ch   88.5 → …      not a chip label since 2026-08-31 —
	//                                        the word moved to the status disc and
	//                                        the chip kept the rank (`cardVerdict`)
	//
	// IT IS A UTILITY AND NOT AN INLINE STYLE ON PURPOSE. `.chip.chip-wide` lives
	// in `@layer components`; an inline `max-width` would outrank it and silently
	// re-cap every `wide` chip in the product. A `@layer utilities` class beats
	// `.chip` and loses to nothing it needs to beat, and it is only emitted when
	// `wide` is off, so the two opt-outs can never both apply. It lands on the
	// `.chip` ELEMENT in both forms — the same place `chip-wide` lands, for the
	// same reason (see the `wide` prop).
	//
	// ── ⛔ AND `12ch` WAS NEVER TWELVE CHARACTERS. (2026-09-02, third report on
	// this cap in one day: `/versions/<rev>`'s bucket cards render
	// `STAGING 15 BEHI…` under a multi-bucket fixture.) MEASURED, on the running
	// product at 10px / 0.08em:
	//
	//     `max-width: 12ch` resolves to  72.25px
	//     padding + border               13.8px   (6px + 6px + 1px + 1px)
	//     one character                   6.85px  (1ch 6.02 + 0.8 letter-spacing)
	//     → the word's real budget is (72.25 − 13.8) / 6.85 = **8.5 characters**
	//
	// So `12ch` is an EIGHT-AND-A-HALF-character cap, because `ch` measures a
	// glyph and the box also has to hold the tracking and the padding. Every
	// nine-character label in the product has therefore always clipped —
	// `15 BEHIND` needs 75.4px bare and 89.4px with the tag, against 72.25 and
	// 86.25 — and the fix has been applied THREE TIMES as a per-call-site `wide`,
	// which is a contract every future caller can and does forget.
	//
	// ── THE CAP IS PER KIND OF LABEL NOW, NOT PER CALL SITE ─────────────────
	//
	// There are exactly two kinds of label in this component and they need two
	// different caps:
	//
	//   · `env` — an ENVIRONMENT, SERVICE or REGION NAME. Unbounded, and the
	//     reason the cap exists at all: `prod-ap-northeast-1` must not eat a row.
	//     UNCHANGED at 12ch, so every deliberate "NOT `wide`" decision in
	//     `Navbar`, `CommandPalette` and `/environments` still renders exactly
	//     what it was measured to render. Zero pixels move.
	//   · everything else — a CLOSED VOCABULARY. `newest`, `N behind`,
	//     `diverged`, `unknown`, `held`, `pending`, `pinned`, `unreleased`,
	//     `never deployed`, `rolled back`, `stuck`, `failing`, `blocked`. A
	//     closed set has a longest member, so the cap is that member's WIDTH
	//     rather than a character count that cannot express it.
	//
	// Measured natural widths (`chip-wide`, i.e. uncapped) of the whole
	// vocabulary, bare → with the tag:
	//
	//     HELD            41.3 →  55.3      UNRELEASED      82.2 →  96.2
	//     STUCK           48.1 →  62.1      199 BEHIND      82.2 →  96.2
	//     NEWEST          54.9 →  68.9      ROLLED BACK     89.0 → 103.0
	//     UNKNOWN         61.8 →  75.8      NEVER DEPLOYED 109.5 → 123.5
	//     1 BEHIND        68.6 →  82.6
	//     15 BEHIND       75.4 →  89.4   ⛔ the report
	//
	// `calc(14ch + 26px)` = **110.3px** covers the longest of them (109.5) and
	// `calc(14ch + 40px)` = 124.3px covers it with the tag. Three digits of
	// `N behind` fit with 14px to spare, so the cap does not become the next
	// thing to forget.
	//
	// ⚠️ IT IS STRICTLY TIGHTER THAN `wide`, WHICH IS WHAT MAKES IT SAFE TO SHIP
	// ACROSS PAGES THIS PASS DOES NOT OWN. `wide` removes the cap entirely; this
	// caps at the vocabulary's own maximum. So no call site can render WIDER than
	// an already-shipped `wide` chip on the same row, and every call site that
	// passes `wide` today is byte-identical. The three `wide`s added for this bug
	// (`/versions/<rev>`'s two service chips and the bucket cards) are now
	// redundant rather than wrong — leave them or delete them when those files
	// are next opened; the result is the same either way.
	const capClass = $derived(
		wide
			? 'chip-wide'
			: role === 'env'
				? ''
				: hasGlyph
					? 'max-w-[calc(14ch+40px)]'
					: 'max-w-[calc(14ch+26px)]'
	);
</script>

{#snippet body()}
	<!-- ── THE ONE GLYPH, AND WHY IT IS NOT THE DOT COMING BACK ──────────────
	     (2026-09-02, from the human: *"and then also add an icon for version"*.)

	     `alarm` carried an amber dot next to the word `STUCK` until 2026-08-27,
	     when the human called it *"useless"* — and it was: the dot said `stuck`
	     and the word 4px to its right said `stuck`, one fact in two encodings
	     inside one 57px box. THAT RULE IS INTACT AND THIS DOES NOT BREAK IT.
	     A tag beside `NEWEST` does not say `newest`; it says what KIND of fact
	     the badge is, which is the job `COMPOSITION-GRAMMAR.md` §3 gives every
	     icon on the reference page (*"if a card has a title, it has an icon"*)
	     and which the rank badge — the most repeated object in the product — was
	     the only one doing without.

	     IT IS A TAG AND NOT A COMMIT, AND THE DIFFERENCE IS REAL HERE. `/versions`
	     is keyed on COMMITS (`revisionPath` → `<repo>/commit/<sha>`); the string
	     in the value half is a BUILD — `getDisplayVersion`'s `version`
	     annotation, `1.66.0-66` — and a build is a RELEASE OF a commit, not the
	     commit. So a git-commit glyph would be false. `TagSolid` is already the
	     card-header icon for a revision's services on `/versions/<rev>` and
	     `TagOutline` is already the nav mark for that section, so the tag family
	     already means "a released build" in this product and this spends no new
	     vocabulary. It does NOT collide with `CodeBranchOutline` /
	     `CodeMergeSolid`, which carry DISTANCE (`Furthest behind`) and
	     CONVERGENCE (`/apps`' fleet column) — neither of which is identity.

	     ⛔ ONLY IN THE JOINED FORM. The glyph types the badge as being ABOUT a
	     build, so it may only appear when a build is actually named beside it. A
	     lone `[NEVER DEPLOYED]` chip names none, and a tag on it would claim one.

	     ⛔ AND IT IS NOT CHARGED AGAINST THE WORD'S BUDGET. See `capClass`. -->
	{#if icon}
		{@render icon()}
	{:else if hasGlyph}
		<TagOutline class="mr-[3px] h-[11px] w-[11px] shrink-0" aria-hidden="true" />
	{/if}
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
			class="chip {TONE[role]} {capClass}"
			style={role === 'env' && theme ? getEnvironmentThemeStyle(theme) : undefined}
			title={title ?? label}
		>
			{@render body()}
		</span>
		{@render valueHalf(false)}
	</span>
{:else}
	<span
		class="chip {TONE[role]} {capClass} {className}"
		style={role === 'env' && theme ? getEnvironmentThemeStyle(theme) : undefined}
		title={title ?? label}
		bind:this={el}
	>
		{@render body()}
	</span>
{/if}
