<svelte:options runes={true} />

<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import { countLabel } from '$lib/disclosure';
	import {
		ExclamationCircleSolid,
		InfoCircleSolid,
		PauseSolid,
		HeartSolid,
		ChevronRightOutline
	} from 'flowbite-svelte-icons';

	type Severity = 'error' | 'warning' | 'info' | 'pinned';

	/**
	 * ⭐ THIS IS THE PRODUCT'S FILLED BANNER. Do not build a second one.
	 *
	 * It is the object rollout detail renders its schedule gate in — a
	 * full-width amber field, a 40px circular icon, a bold headline
	 * (*"Deployments currently blocked"*), a second line carrying the concrete
	 * consequence (*"Will be allowed in 1d 3h (8/31/2026, 1:00:00 PM)"*) and a
	 * chip on the right. `COMPOSITION-GRAMMAR.md` §4 names it as what
	 * *"attention pulled by design, not text"* actually looks like, against
	 * the neutral gray row-band that shipped on `/apps` and `/environments`
	 * and that the human said *"feels like a bug"*.
	 *
	 * A FILL AT BANNER SCALE IS LEGITIMATE. The `area x chroma` ink ceiling
	 * was derived for MARKS COMPETING ON A ROW and does not govern a
	 * page-level banner. It still governs chips: `alarm` remains the only
	 * chip with a fill.
	 *
	 * USE IT FOR THE PAGE'S ONE BLOCKING FACT, and only that. A page with
	 * three banners has no banner.
	 *
	 * ⭐ AND IT HAS THREE TIERS, NOT THREE PARAGRAPHS. (2026-08-31) The
	 * headline and one consequence line are PRINTED; the footnote is
	 * DISCLOSED. See the `footnote` prop for the measurement — two of these
	 * blocks were eating 456px of an 844px phone viewport before the reader
	 * reached the card that says what is deployed. Reduce the prose, never the
	 * presence: the fill, the 40px disc and the bold headline are the whole
	 * point and are untouched.
	 *
	 * ⛔ THERE IS NO `quoted` PROP AND THERE MUST NOT BE ONE AGAIN.
	 * (2026-08-31) It rendered `message` as a `border-l-2` blockquote — a
	 * coloured edge stripe inside a `rounded-xl` field, which is the shape the
	 * human has banned twice: *"no rounded box with a single coloured edge
	 * stripe — dots, badges, or the text itself carry status"*, and side accent
	 * bars are legal only on SQUARE, non-rounded elements. Its one caller (the
	 * pinned banner on rollout detail) was also using it to echo the last
	 * deploy's audit string under a heading that already said the same thing.
	 * If a message needs a different voice from the headline, change the
	 * WORDS; the banner's fill is already the emphasis.
	 */
	interface Props {
		severity?: Severity;
		/**
		 * ⭐ RENDERED AT `t-headline` (17px/600), NOT A HAND-SPELLED SIZE.
		 * (2026-09-02) It was `text-base font-bold` — 16px/700 — which is not
		 * a role in `app.css`'s declared type scale (`t-display` 24,
		 * `t-headline` 17/600, `t-body` 14, `t-dense` 12.5, `t-label` 10,
		 * `t-micro` 11, `t-code` 13, `t-code-sm` 11.5, `t-button` 12) despite
		 * this being the loudest object in the product. `t-headline` is the
		 * role that exists for exactly this — a bold, page-level lead — so it
		 * moves onto it rather than earning a tenth role for one component.
		 */
		title: string;
		message?: string;
		/**
		 * ⭐ THE ONLY REASON THIS EXISTS: `FailurePanel` WAS A COPY OF THIS
		 * COMPONENT because its message is a LIST, not a sentence. A rollout can
		 * fail on six health checks at once, and a `message: string` could only
		 * render that as one run-on line. So the copy was made, and then
		 * `AlertPanel`'s alpha-ladder contrast fix never reached it — the exact
		 * failure mode `DESIGN.md` records: *"a shared object copied into a
		 * second file will not receive the shared object's next fix."*
		 *
		 * It renders inside the SAME `{palette.message}` wrapper `message` uses,
		 * at the same 14px, so a snippet cannot smuggle in a second ink ladder.
		 * Pass one or the other, never both. Do not use it to escape the
		 * severity palette — that is what the palette is for.
		 */
		messageBody?: Snippet;
		/**
		 * ⭐ THE FOOTNOTE IS NO LONGER PRINTED. IT IS DISCLOSED. (2026-08-31)
		 *
		 * ── WHAT WAS MEASURED ────────────────────────────────────────────────
		 *
		 * At 390 on `/rollouts/dev/hello-dep-dev/hello-frontend-app`, each
		 * banner was **226px tall, 314 characters, 50 words**, and two of them
		 * stacked: **456px of an 844px viewport spent before the status card
		 * that says what is actually deployed.** On a phone the page opened on
		 * prose. The human, who has said *"attention is pulled by design, text
		 * just pollutes"* and *"I don't like this descriptive text"*, said it
		 * again: *"we're rendering too much text by default for these alert
		 * style blocks."*
		 *
		 * ── WHY THE FOOTNOTE AND NOT THE MESSAGE ─────────────────────────────
		 *
		 * Every sentence in these blocks was written to fix a real defect — a
		 * false claim, a missing subject, an unstated consequence — and
		 * `lib/messages/` pins most of them. So this is a DISCLOSURE problem,
		 * not a deletion problem. The tier is decided by what a reader needs in
		 * the first second:
		 *
		 *   `title`     the fact and its subject      ALWAYS PRINTED
		 *   `message`   the concrete consequence      ALWAYS PRINTED
		 *   `footnote`  the mechanism, the verdict,
		 *               the rule handle, the actor,
		 *               the manual-deploy clause     AVAILABLE, NOT PRINTED
		 *
		 * Read the eight call sites and the footnote is ONE role everywhere:
		 * `· rule: dependency-hello-frontend-needs-api`, `Rolled back by
		 * admin@example.com.`, `The server answered for ns/name and returned no
		 * release.`, `Automated deployments are paused until this is resolved.`
		 * Each is the thing you want AFTER you have decided the banner is about
		 * you — never the thing that makes you decide.
		 *
		 * ── AND IT IS A `<details>`, NOT A CONDITIONAL ───────────────────────
		 *
		 * The content stays in the DOM, keyboard-reachable and announced, so
		 * `subject.svelte.test.ts` (which walks `textContent`) still proves the
		 * axis is named and `truth.test.ts` still proves the sentence is
		 * produced. A fix that quietly dropped a fact would pass neither, and
		 * correctly. Nothing here is allowed to become unreachable — if you are
		 * tempted to delete a footnote instead of disclosing it, that is a
		 * judgement call for the human, not a licence to trim.
		 */
		footnote?: string;
		/**
		 * The disclosure's own label, at 12px beside a chevron — the
		 * `Show 8 ready resources ›` idiom `COMPOSITION-GRAMMAR.md` §8 names,
		 * which this product already spends on the `Resources` card.
		 *
		 * ⛔ IT IS A LABEL, NEVER A CLAIM. It says what KIND of thing is behind
		 * the control; it may not state a fact of its own, because a fact
		 * nobody expands is a fact nobody reads.
		 *
		 * ⛔ AND IT IS A NOUN. NO INTERROGATIVES, NO SENTENCE FRAGMENTS.
		 * (2026-09-01) From the human: *"i'm not sure i particularly like that
		 * format 'what clears this'."*
		 *
		 * WHAT WAS MEASURED. `/environments` at 1440 rendered **four
		 * disclosures in one viewport, all four labelled `What clears this`,
		 * and three of the four opening onto the identical sentence.** Across
		 * the product the label had grown five different grammars for one
		 * control — `What clears this`, `What happens next`, `Can I still
		 * deploy`, `What this stops`, `Which rules` — so a reader met a
		 * different question shape at every banner and the page read as if it
		 * were interrogating itself. That is the *"text just pollutes"*
		 * failure arriving through a control instead of through prose.
		 *
		 * A repeated IDENTICAL noun is furniture — the reader stops seeing it
		 * after the first one, which is what you want from an affordance. Four
		 * repeated QUESTIONS are chatter. So the permitted range narrows to:
		 *
		 *   `Details`      the default, and the right answer nearly always
		 *   `2 rules`      a COUNT and its kind, where one exists — the
		 *                  `Show 8 ready resources ›` shape `COMPOSITION-
		 *                  GRAMMAR.md` §8 names and this product already spends
		 *
		 * Nothing else. If you find yourself writing a verb, the thing you want
		 * to say belongs in `message`, where it is printed.
		 *
		 * ⭐ AND CHOOSING BETWEEN THE TWO IS NOT A JUDGEMENT CALL ANY MORE.
		 * (2026-09-02) `lib/disclosure.ts` states the rule: a SET you can count
		 * takes `footnoteCount`; ONE RECORD and a GENUINE SENTENCE both keep
		 * `Details`. Do not hand-spell a count here — `footnoteCount` exists so
		 * that six call sites cannot grow six pluralisation rules, which is how
		 * `Which rule` / `Which rules` survived on `/envs/<name>` through the very
		 * pass that was banning interrogatives.
		 */
		footnoteLabel?: string;
		/**
		 * ⭐ THE SET FORM OF THE LABEL. Pass the number of things behind the
		 * control and the label becomes `1 rule` / `3 rules` — `lib/disclosure.ts`
		 * owns the grammar, and `RulePopover` (the CARD-scale control over the
		 * identical content) derives its label from the same function, which is
		 * what makes the banner and the card one affordance rather than two.
		 *
		 * ⛔ ONLY FOR A SET. A count of one over a thing there can only ever be
		 * one of — a request, an address — reads as pedantry and teaches nothing.
		 */
		footnoteCount?: number;
		/** The kind of thing `footnoteCount` counts. Singular; the plural is `-s`. */
		footnoteNoun?: string;
		/**
		 * ⭐ THE FOOTNOTE AS A RECORD RATHER THAN AS A PARAGRAPH. (2026-09-02)
		 *
		 * > *"i think i also don't like 'details' expansion. it's formatted just
		 * > as text when in some cases it could be more richly formatted."*
		 *
		 * Read the ten call sites and the footnote was never ONE kind of thing:
		 *
		 *   A SET OF RECORDS   every gate holding a rollout, every contract a
		 *                      build is waiting on. `GateRecord` / `FactList`.
		 *   A MACHINE FACT     an address, an HTTP status, the server's own
		 *   WITH FIELDS        sentence, the actor who pinned it. `FactList`.
		 *   A SENTENCE         and only here is `footnote` still the right slot.
		 *
		 * The first two want an aligned `<dl>`, which is what this slot is for. It
		 * renders inside the SAME `<details>`, at the same 12px, in the severity's
		 * own ink — so a snippet cannot smuggle in a second ink ladder any more
		 * than `messageBody` can. Pass one or the other, never both.
		 *
		 * ⛔ IT IS STILL A NATIVE `<details>` AND THE SUBTREE IS STILL IN THE DOM
		 * WHEN CLOSED. `lib/messages/` walks `textContent`; a record that unmounted
		 * would make every fact in it unreachable to the census WHILE THE SUITE
		 * STAYED GREEN. That is the failure this component's own test file exists
		 * to catch, and it governs the record exactly as it governed the
		 * paragraph.
		 */
		footnoteBody?: Snippet;
		icon?: Component;
		pulse?: boolean;
		actions?: Snippet;
		extra?: Snippet;
		/**
		 * LAYOUT ONLY — the outer margin. Defaults to `mb-4`, which is right
		 * when the banner sits inside a card stack and wrong when a page needs
		 * its own rhythm above the first card. Never pass colour: the severity
		 * palette is the whole point of the component.
		 */
		class?: string;
	}

	let {
		severity = 'info',
		title,
		message,
		messageBody,
		footnote,
		footnoteBody,
		footnoteLabel = 'Details',
		footnoteCount,
		footnoteNoun = 'rule',
		icon,
		pulse = false,
		actions,
		extra,
		class: className = 'mb-4'
	}: Props = $props();

	/**
	 * ⛔ THE ALPHA LADDER IS GONE FROM THE MESSAGE AND THE FOOTNOTE IN LIGHT,
	 * AND IT IS NOT COMING BACK. Measured pixel-wise off a screenshot (at the
	 * time this was measured the container was a GRADIENT, so
	 * `getComputedStyle` on an ancestor reported `transparent` and every
	 * earlier number computed against the page ground was wrong), all four
	 * severities, 1440:
	 *
	 *   light   icon 2.57-3.69 | message 3.34-4.20 | footnote 2.35-3.11
	 *   dark    icon 6.17-6.78 | message 5.68-6.08 | footnote 3.58-3.83
	 *
	 * There was NO alpha that worked in light: `<hue>-700` at 95% over the
	 * `<hue>-50/100` gradient still measured 4.46:1, under the 4.5 floor. So
	 * the message and the footnote are the FULL 700 step in light and the
	 * ladder is carried by SIZE (16px/700 bold title, 14px message, 12px
	 * footnote), which is the ladder the reference page's own cards use.
	 * In dark the alpha still has headroom and is kept, raised 55% -> 70% on
	 * the footnote (3.58 -> ~5.8).
	 *
	 * The ICON is the 700 step in light too: `<hue>-600` on the `<hue>-200`
	 * disc measured 2.57 (warning) and 2.65 (pinned), under the 3:1 non-text
	 * floor — the disc is a FILL, so the glyph is competing with a mid-ramp
	 * ground, not with white. Dark (`<hue>-300` on the `<hue>-500/20` disc)
	 * was already 6.2-6.8 and is untouched.
	 *
	 * ZERO NEW COLOUR VALUES: every step used here is one the product already
	 * spends.
	 *
	 * ⛔ THE CONTAINER IS FLAT NOW, NOT A GRADIENT. (2026-09-02) `HANDOFF.md`'s
	 * hard rule is *"no status-driven background gradients"* and this was the
	 * one shipped object it did not hold on — `bg-gradient-to-r from-<hue>-100
	 * via-<hue>-50 to-<hue>-100` (dark: solid `<hue>-950`/`900`/`950` stops),
	 * kept from the panel's first commit as "FailurePanel's visual language"
	 * and never covered by a human ruling either way. No recorded approval was
	 * found for the exception, so it is gone: `bg-<hue>-50 dark:bg-<hue>-950/40`,
	 * a flat wash matching the tone every wash/block chip in the product
	 * already spends (`Chip`'s `newest` is `green-50` / `green-950/30`). The
	 * numbers above still describe the ladder correctly — a flat, LIGHTER
	 * ground than the gradient's own midpoint only helps light-mode contrast,
	 * never hurts it, so the FULL 700 step stays the floor rather than being
	 * re-measured down. The ring is untouched; it was never the gradient.
	 *
	 * ⛔ THE SHADOW WAS THE LAST DECORATIVE THING, AND IT IS GONE. (2026-09-02,
	 * design re-check) `shadow-2xl shadow-<hue>-200/60` was a 50px-blur, 60%
	 * amber `shadow-2xl` — measured on `/environments` painting 45px past the
	 * banner's OWN bottom edge, into the next row (banner bottom 247, next row
	 * 265). `COMPOSITION-GRAMMAR.md` §2: "shadow is near-zero; separation
	 * comes from the border and the ground" — every `Card` on the reference
	 * page measures `box-shadow: none` and this was the one shipped object
	 * still spending a glow. The 1px `ring` is the whole separation now, same
	 * as every other panel in the product.
	 *
	 * ⛔ AND THE RADIAL BLOB BEHIND ALL OF IT WAS THE SAME DEFECT, MISSED BY
	 * THE FLAT-WASH PASS ABOVE. (F12, 2026-09-03) `palette.glowA`/`glowB` —
	 * `h-48 w-48 rounded-full bg-<hue>-400/8 blur-3xl` at `-top-10 -right-10`,
	 * plus a second smaller one bottom-left — was a leftover radial wash
	 * painted UNDER the flat tint in a `pointer-events-none absolute inset-0
	 * overflow-hidden` layer. The 2026-09-02 note above only ever measured
	 * and replaced the CONTAINER's own `background`; it never looked inside
	 * that layer, so the gradient it declared dead kept rendering one level
	 * down. Gone, both discs, both fields. **This is not the same element as
	 * `pulse`'s `animate-alert-halo` ping** — that one sits ON the 40px icon
	 * disc, is a rendered ring the human explicitly asked to keep ("Icon is
	 * not positioned the same on both of these" — a request about placement,
	 * never about removing the halo), and is untouched.
	 */
	const palette = $derived.by(() => {
		switch (severity) {
			case 'error':
				return {
					container:
						'bg-red-50 dark:bg-red-950/40 ring-1 ring-red-300/60 dark:ring-red-800/60',
					ping: 'bg-red-500/30 dark:bg-red-500/40',
					iconWrap: 'bg-red-200 ring-2 ring-red-400/60 dark:bg-red-500/20 dark:ring-red-500/50',
					iconColor: 'text-red-700 dark:text-red-300',
					title: 'text-red-900 dark:text-white',
					message: 'text-red-900 dark:text-red-200/75',
					footnote: 'text-red-900 dark:text-red-200/70',
					defaultIcon: ExclamationCircleSolid
				};
			case 'warning':
				return {
					container:
						'bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-300/60 dark:ring-amber-800/60',
					ping: 'bg-amber-500/25 dark:bg-amber-500/30',
					iconWrap:
						'bg-amber-200 ring-2 ring-amber-400/60 dark:bg-amber-500/20 dark:ring-amber-500/50',
					iconColor: 'text-amber-700 dark:text-amber-300',
					title: 'text-amber-900 dark:text-white',
					message: 'text-amber-900 dark:text-amber-200/75',
					footnote: 'text-amber-900 dark:text-amber-200/70',
					defaultIcon: ExclamationCircleSolid
				};
			case 'pinned':
				return {
					container:
						'bg-orange-50 dark:bg-orange-950/40 ring-1 ring-orange-300/60 dark:ring-orange-800/60',
					ping: 'bg-orange-500/25 dark:bg-orange-500/30',
					iconWrap:
						'bg-orange-200 ring-2 ring-orange-400/60 dark:bg-orange-500/20 dark:ring-orange-500/50',
					iconColor: 'text-orange-700 dark:text-orange-300',
					title: 'text-orange-900 dark:text-white',
					message: 'text-orange-900 dark:text-orange-200/75',
					footnote: 'text-orange-900 dark:text-orange-200/70',
					defaultIcon: PauseSolid
				};
			case 'info':
			default:
				return {
					container:
						'bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-300/60 dark:ring-blue-800/60',
					ping: 'bg-blue-500/25 dark:bg-blue-500/30',
					iconWrap: 'bg-blue-200 ring-2 ring-blue-400/60 dark:bg-blue-500/20 dark:ring-blue-500/50',
					iconColor: 'text-blue-700 dark:text-blue-300',
					title: 'text-blue-900 dark:text-white',
					message: 'text-blue-900 dark:text-blue-200/75',
					footnote: 'text-blue-900 dark:text-blue-200/70',
					defaultIcon: InfoCircleSolid
				};
		}
	});

	const Icon = $derived(icon ?? palette.defaultIcon);

	/**
	 * THE SET FORM WINS WHERE A CALLER SUPPLIED A COUNT, so a caller cannot
	 * pass a count AND a hand-written noun and have the two disagree on screen.
	 */
	const disclosureLabel = $derived(
		footnoteCount === undefined ? footnoteLabel : countLabel(footnoteCount, footnoteNoun)
	);
</script>

<div class={className}>
	<div class="ap-cq relative overflow-hidden rounded-xl {palette.container}">
		<div
			class="relative flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:gap-x-8 sm:px-6 sm:py-5"
		>
			<!--
				⭐ THE ICON IS ALIGNED TO THE HEADLINE'S LINE BOX, NOT TO THE TEXT
				BLOCK'S CENTRE. This is a two-row grid, not a flex row, and that is
				the whole fix.

				THE DEFECT, MEASURED AT 390 ON `/versions`: the icon's centre sat
				**87px below the headline's centre** (icon 294, headline 207). A
				`flex items-center` row centres a 40px glyph against WHATEVER the text
				column happens to be — one line on desktop, five lines on a phone — so
				the icon floated beside the middle of the paragraph, pointing at a
				sentence it does not belong to. It reads as broken because it is.

				THIS IS A RECURRENCE. The identical defect was fixed days earlier on
				`/apps/[name]`'s `!` glyph — a glyph centred against a multi-line
				sentence — and it came back here because the fix was made on the PAGE
				and not on the SHARED OBJECT. It is fixed in the component now, so
				every page that renders a banner (`/`, `/apps`, `/apps/[name]`,
				`/environments`, `/envs/[name]`, `/versions`, `/versions/<rev>`,
				rollout detail via `ScheduleStatus`) gets it and none can lose it.

				HOW: column 1 row 1 is an empty stretched cell — the grid row's own
				height, which IS the headline's line box (or taller, if `extra` chips
				wrap into it). The 40px disc is absolutely positioned at that cell's
				`top: 50%`, so it centres on the HEADLINE whether the message below is
				zero lines or five. The disc contributes no height, so it can never
				push the headline off its own baseline; it overflows symmetrically
				into the 16-20px of banner padding, which is where the reference page
				puts it too.
			-->
			<div class="ap-grid grid min-w-0 flex-1 grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-x-4">
				<!--
					⭐ `min-h-12 sm:min-h-10` IS THE ROOM THE FULL-SIZE HALO NEEDS, AND IT
					IS SPENT ON EVERY SEVERITY, NOT ONLY THE PULSING ONE.

					⛔ IT WAS CONDITIONAL ON `pulse` FOR ONE COMMIT, AND THAT WAS WRONG.
					From the human, looking at rollout detail where the amber gate banner
					and the blue rolled-back panel stack: *"Icon is not positioned the
					same on both of these. We moved the icon on the first one to fit the
					pulse effect. Second one needs to be the same."* With a one-line
					headline the pulsing row is 40/48 and the plain row is 24, so the two
					discs sat 8px apart in a vertical stack — the panels differ in
					severity, and a reader reads that difference as meaning. The halo is
					the REASON for the number; it is not a reason to spend it selectively. From the human, rejecting a
					smaller pulse: *"I didn't want pulse to be smaller but that you move
					the icon appropriately."*

					THE REQUIREMENT IS ONE NUMBER: the disc's centre must sit at least
					**40px** from the panel's top and left edges, because `ping` doubles a
					40px element to a peak radius of 40. The corner does NOT raise that
					bar — the arc is always further away than the flat edges — and the
					proof, sampled off the rendered box, is in `app.css` beside the
					keyframes.

					WHY A `min-height` ON THE ROW AND NOT PADDING ON THE BANNER. The disc
					centres on this row, so the row's own height is the lever, and using
					it costs NOTHING in the case that already fits:

					  390   pad-top 16, row >= 48 puts the centre at 16 + 24 = 40
					        one-line headline   row 24 -> 48   banner +24px
					        two-line headline   row 48 -> 48   banner +0px  <-- the
					        common phone case: the headline already wraps, so the row is
					        already 48 and the full halo already fits
					  1440  pad-top 20, row >= 40 puts the centre at 20 + 20 = 40
					        one-line headline   row 24 -> 40   banner +16px
					        two-line headline   row 48 -> 48   banner +0px

					Bumping `py` instead would have charged every pulsing banner the
					worst case — +24px at 390 even where nothing was clipping — and an
					asymmetric `pt` would have left 28px above the headline against 16px
					below the disclosure, which reads as a layout bug.

					THE TEXT COLUMN IS NOT NARROWED. `px-5`/`sm:px-6` are untouched, so
					the headline wraps in exactly the same places; the left inset is
					already 40 at 390 and 44 at 1440 and needed nothing.

					⚠️ IT IS `min-h`, NOT `h`. A three-line headline or a wrapped row of
					`extra` chips must still be able to make this row taller; the floor
					only ever raises the disc, never caps the content.
				-->
				<div
					class="ap-headline-row col-start-2 col-end-4 row-start-1 flex min-h-12 min-w-0 flex-wrap items-center gap-2"
				>
					<!--
						⭐ THE DISC IS A ZERO-HEIGHT FLEX ITEM ON THE HEADLINE'S OWN
						NON-WRAPPING LINE, REACHING BACK INTO THE GRID'S FIRST COLUMN.
						It is not laid out in column 1 any more, and that is the second
						half of the pulse fix.

						WHAT `top-3` GOT WRONG. The previous form put the disc in column 1
						and pinned it 12px down — the half-leading of ONE 24px line box —
						so it centred on the FIRST LINE of the headline whatever the
						headline did. At 1440, where the headline is one line, that is
						correct and unchanged. At 390 the headline wraps: `DEV is waiting
						on another deploy` is two lines, 48px, and the disc stayed level
						with line one, **24px above the headline's own centre and 8px from
						the panel's top edge**. The human: *"icon feels positioned too
						high. this is specially the case on mobile."*

						HOW IT WORKS. `h-0` means the disc contributes NO height, so it can
						never push the headline off its own baseline — the invariant the
						old absolute form was protecting, kept. `-ml-14 mr-4` makes its net
						advance exactly zero (−56 + 40 + 16), so the headline still begins
						on the grid's column-2 edge and the message below it stays aligned,
						while the box itself spans −56..−16, which IS column 1. Then
						`items-center` centres a zero-height item on the cross-size of its
						flex line — the headline's box. One line: centre at 12px,
						byte-identical to `top-3`. Two lines: 24px, the headline's actual
						middle.

						⚠️ THE INNER `flex` WRAPPER IS LOAD-BEARING AND THE FIRST ATTEMPT
						WITHOUT IT WAS WRONG. Putting the disc directly in this
						`flex-wrap` row made it wrap onto a line of its OWN: flex breaks
						lines on HYPOTHETICAL main sizes, and the headline's max-content
						(~300px) exceeds the 262px column at 390 whatever the disc's
						negative margins net to. Measured: the disc landed at the row's top
						again (16px) while the headline sat at 24px, and the 8px row-gap
						`gap-2` also sets made the banner 8px TALLER. The disc and the
						headline therefore share a nowrap group; `extra` stays a sibling of
						that group, so the chips still wrap onto a second line at 390
						exactly as before.

						AND IT STILL IGNORES THE CHIPS. When `extra` wraps, the disc's line
						holds the headline alone, so the disc keeps measuring itself against
						the headline and nothing else. That was the whole reason `top-1/2`
						was rejected, and it is still rejected.

						THIS IS A RECURRENCE OF A DEFECT WITH A NUMBER. The original was
						`flex items-center` centring the 40px glyph against the whole text
						COLUMN — measured at 390 on `/versions`, the icon's centre sat
						**87px below the headline's centre**. That was fixed on the PAGE
						first (`/apps/[name]`'s `!` glyph) and came back here because the
						fix had not been made on the SHARED OBJECT. It is fixed in the
						component now, so every page that renders a banner (`/`, `/apps`,
						`/apps/[name]`, `/environments`, `/envs/[name]`, `/versions`,
						`/versions/<rev>`, rollout detail via `ScheduleStatus`) gets it and
						none can lose it.
					-->
					<!-- NO `min-w-0` HERE, DELIBERATELY. The headline used to be a direct
					     flex item of the wrapping row, so its `min-width: auto` floor was
					     its own min-content — one unbreakable word. Giving the group
					     `min-w-0` would move that floor to zero and let a long
					     `hello-frontend-app` spill out of the panel on a page where it
					     used to wrap. The disc contributes 0 to the group's min-content
					     (−56 + 40 + 16), so the floor is byte-identical to the old one. -->
					<div class="flex items-center">
						<div class="relative mr-4 -ml-14 h-0 w-10 shrink-0">
							<div class="absolute top-0 left-0 h-10 w-10 -translate-y-1/2">
								{#if pulse}
									<!-- `animate-alert-halo` IS `ping`, VALUE FOR VALUE — scale(1)
									     -> scale(2), 1s, same easing. It is a named class only so
									     the `prefers-reduced-motion` guard can be scoped to this
									     halo. THE SIZE WAS NEVER THE BUG; the placement was, and the
									     row above now reserves the 40px the halo needs. The full
									     arithmetic is in `app.css` beside the keyframes. -->
									<div
										class="animate-alert-halo absolute inset-0 rounded-full {palette.ping}"
									></div>
								{/if}
								<div
									class="relative flex h-10 w-10 items-center justify-center rounded-full {palette.iconWrap}"
								>
									<Icon class="h-6 w-6 {palette.iconColor}" />
								</div>
							</div>
						</div>
						<p class="t-headline {palette.title}">{title}</p>
					</div>
					{#if extra}{@render extra()}{/if}
				</div>
				{#if message || messageBody}
					<!--
						⭐ ROW 2, ITS OWN GRID ITEM NOW. (defect #2, third pass) It used
						to be the shared wrapper that ALSO held the disclosure and the
						CTA nested inside it (two different flow decisions living in one
						box). Splitting it into three siblings of this same grid — this
						row, the disclosure row, and `actions` — is what lets `actions`
						be placed independently per breakpoint below, with no DOM change
						between them.

						`col-start-2 col-end-4 sm:col-end-3`: at `sm`+, `actions` spans column 3
						across every row (see its own note), so this row must NOT reach
						into that column there or the two would overlap. Below `sm`,
						`actions` only occupies column 3 on the disclosure row, so this
						row is free to span into it and keep the full width it always
						had — the span costs nothing on the flexible track (`minmax(0,
						1fr)` still absorbs whatever column 3 doesn't need on THIS row).

						⛔ `col-end-4`, NOT `col-span-2`. First attempt used `col-start-2
						col-span-2 sm:col-span-1` and it rendered the headline in COLUMN
						1 at 40px wide, wrapping "hello-frontend-app" one word per line.
						Tailwind's `col-span-*` compiles to the SHORTHAND `grid-column:
						span N / span N`, which — because it is a shorthand — resets
						BOTH `grid-column-start` and `grid-column-end` wherever its rule
						wins the cascade, discarding the LONGHAND `grid-column-start: 2`
						that `col-start-2` had set on the same element. The element then
						had no explicit start at all, and grid auto-placement slotted it
						into the first open cell — column 1, the icon gutter. `col-end-*`
						is the longhand `grid-column-end` and never touches
						`grid-column-start`, so it composes safely with `col-start-2`.
					-->
					<div class="ap-message-row col-start-2 col-end-4 row-start-2 min-w-0">
						{#if messageBody}
							<div class="mt-0.5 text-sm break-words {palette.message}">
								{@render messageBody()}
							</div>
						{:else if message}
							<!--
								⭐ THE FULL SENTENCE, NEVER CLAMPED. (defect #2, redone) A
								`line-clamp-1` with the rest parked behind a `title`
								attribute was a truncation wearing a design — a phone
								cannot hover, so that text was simply gone for a touch
								reader. The height budget is reached honestly now: the
								headline steps down a size below `sm` (the scoped
								`<style>` block at the end of this file) so it wraps to
								two lines instead of three — that was where the 390
								measurement actually overspent, not this sentence, which
								stays printed in full at every width, as `message`'s own
								doc comment has always promised ("ALWAYS PRINTED").
							-->
							<p class="mt-0.5 text-sm break-words {palette.message}">{message}</p>
						{/if}
					</div>
				{/if}
				{#if footnote || footnoteBody}
					<!--
						⭐ THE DISCLOSURE. See the `footnote` prop's note for the
						measurement that produced it. Its own grid cell,
						`col-start-2 row-start-3` — and NOW SPANNING TO `col-end-4`
						BELOW 700px OF THE BANNER'S OWN WIDTH (P5, 2026-09-03,
						operator walk).

						⛔ THIS USED TO SAY THE OPPOSITE, ON PURPOSE, AND IT WAS
						WRONG AT PHONE WIDTH. `col-end-4` was withheld at every
						width because column 3 "belongs to `actions` on this row" —
						true at `sm`+, where `actions` really does share this row
						(column 3, see its own note below), but at 390 `actions` sits
						on ITS OWN row underneath (see `.ap-actions-cell`'s base
						placement, row 4 now) precisely BECAUSE column 3 was too
						narrow to hold a real control there. Leaving the disclosure
						pinned to column 2 anyway meant it inherited that same
						narrow column with nothing left in column 3 to justify it:
						measured on `hello-frontend-app`'s open `› 1 rule` disclosure
						at 390, the record rendered in a **50px-wide, 491px-tall**
						column — thirteen one-word lines — beside 196px of dead grid
						track where the CTA used to sit before it moved to its own
						row. `col-end-4` reclaims that track the moment nothing else
						is using it; the `@container (min-width: 700px)` block
						below narrows it back to `col-end-3` once `actions` returns
						to column 3 and needs it back.

						THE CONTROL IS NOT QUIET GRAY TEXT AND MUST NOT BECOME IT.
						It is 12px/500 in the severity's OWN ink — the same full
						`<hue>-700` step the footnote itself uses in light, which is
						the step the alpha-ladder work landed on after measuring that
						no alpha clears 4.5:1 over the gradient. A `text-gray-500`
						summary here would be the flat gray row the human has
						rejected six times, arriving through the back door.

						`list-none` + the webkit marker rule remove the native
						triangle so the chevron is the only affordance, and it rotates
						90° on open — the same motion the `Resources` card's
						`Show 8 ready resources ›` uses. One idiom, learned once.

						⛔ `whitespace-nowrap` IS LOAD-BEARING TOO. (F10, 2026-09-03)
						`1 rule` broke across two lines on `/apps` and `/environments`
						at 390 (39px wide, 32px tall) while `2 rules` fit fine on
						`/envs/prod` — same control, same two words, different row.
						The difference is `actions` sharing this flex row: on the
						pages that broke, the CTA squeezed this cell down until the
						label itself had less width than "1 rule" needs, so the
						words split onto their own lines instead of the row wrapping.
						`whitespace-nowrap` on the label makes the CTA give way and
						wrap to its own line first, which is the row's `flex-wrap`
						already promises everywhere else on this banner.
					-->
					<!--
						⚠️ `flex flex-col items-start` IS LOAD-BEARING, NOT TIDINESS.
						A block `<details>` puts its `inline-flex` summary in an
						anonymous LINE BOX, and that box inherits the banner's 16px
						strut — so the 16px control measured **24px**. As a flex
						column the summary is a flex item with no strut.
					-->
					<div class="ap-disclosure-cell col-start-2 col-end-4 row-start-3 mt-1 min-w-0 self-start">
						<details class="group flex flex-col items-start">
							<summary
								class="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs font-medium whitespace-nowrap {palette.footnote} hover:underline focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
							>
								<ChevronRightOutline
									class="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
									aria-hidden="true"
								/>
								{disclosureLabel}
							</summary>
							<!-- ⭐ THE RECORD AND THE PARAGRAPH SHARE ONE WRAPPER, so the
							     severity's ink and the 12px are stated once and a caller
							     cannot spell either itself. `FactList tone="banner"` reads
							     its inks off `currentColor`, which is this class and nothing
							     else — the same mechanism `--nav-link-ink` uses for a link in
							     the actions cell. -->
							{#if footnoteBody}
								<div class="mt-1 min-w-0 text-xs {palette.footnote}">
									{@render footnoteBody()}
								</div>
							{:else if footnote}
								<p class="mt-1 text-xs break-words {palette.footnote}">{footnote}</p>
							{/if}
						</details>
					</div>
				{/if}
				{#if actions}
					<!--
						⭐ ONE DOM NODE, PLACED BY BREAKPOINT, NOT DUPLICATED. (defect #2,
						third pass, from the coordinator: *"the CTA now sits on the
						disclosure row under the message instead of at the banner's
						right edge — that is the family's recorded shape."*)

						Two things were tried and rejected before this:
						  1. Rendering `actions` twice (`sm:hidden` / `hidden sm:flex`)
						     kept the exact desktop position but duplicated an
						     accessible control — jsdom doesn't load `app.css`, so
						     `getByRole('button', { name: /try again/ })` found the
						     SAME "Try again" twice and `outage-states.svelte.test.ts`
						     correctly failed. A real duplicate node, not a test
						     artifact.
						  2. A single node inside the disclosure's own flex row
						     (`sm:ml-auto`) fixed the duplication but moved the CTA's
						     DESKTOP position from "vertically centred at the banner's
						     right edge" to "beside the disclosure, at the bottom" —
						     1440's `/apps` banner grew 122px → 142px because the CTA
						     no longer freed up the row it used to occupy.

						THIS IS THE THIRD SHAPE: `actions` is its own grid item, a
						sibling of the headline/message/disclosure cells above —
						column 3 at `sm`+ (`grid-cols-[2.5rem_minmax(0,1fr)_auto]` on
						the shared grid) — the SAME single DOM node at every width.

						  below `sm`  ⛔ WAS `row-start-3`, SAME ROW AS THE
						              DISCLOSURE, DIFFERENT COLUMN. (P5, 2026-09-03,
						              operator walk) Column 3's width there is
						              `auto` — sized to THIS control's own
						              max-content — so a real CTA (`Open
						              hello-frontend-app ›`, ~196px) squeezed the
						              disclosure's column down to 50px on the SAME
						              row, and an opened `› N rules` record rendered
						              as a 13-line, 491px-tall column of one-word
						              lines. `actions` now gets `row-start-4`, ITS
						              OWN row, spanning `col-start-2 col-end-4` —
						              the full banner width the headline and
						              message rows already use below `sm` — with the
						              disclosure directly above it at its own full
						              width (see `.ap-disclosure-cell`'s own note).
						              "Flows into the disclosure row" is retired:
						              stacking under it, not squeezing beside it, is
						              what a narrow banner needs.
						  `sm`+       `row-start-1` / `row-end-4` spans all three
						              explicit rows (headline, message, disclosure
						              — `-4` is the line after row 3, not a magic
						              number: this grid's items always claim rows
						              1–3 by their own `row-start-N`, empty ones
						              collapse to 0 height, so the span target is
						              fixed regardless of which optional rows
						              actually render) with `self-center`, i.e.
						              vertically centred against the WHOLE banner —
						              `sm:items-center` on the old outer flex row,
						              reproduced without a second sibling to centre
						              against. Column reclaimed back to 3 in the
						              same query (see `.ap-actions-cell`'s override
						              below), since `row-start-4`/`col-end-4` are the
						              MOBILE placement only.

						The right edge itself needed no new rule at `sm`+: this cell
						is the grid's own last column there, and the grid still
						sits inside the same `px-5 sm:px-6` padded row every other
						cell does, so its edge is the banner's padding edge exactly
						as it was when `actions` was a flex sibling this morning.
					-->
					<div
						class="ap-actions-cell col-start-2 col-end-4 row-start-4 mt-1 flex shrink-0 items-center gap-3 self-start {palette.title}"
						style="--nav-link-ink: currentColor"
					>
						{@render actions()}
					</div>
				{/if}
			</div>

		</div>
	</div>
</div>

<style>
	/*
	 * ⭐ `t-headline` STEPS DOWN, SCOPED TO THIS COMPONENT ONLY. (defect #2,
	 * redone) `.t-headline` (17px/600) is UNLAYERED in `app.css` — deliberate,
	 * per its own note, so it outranks every Tailwind utility including
	 * `text-sm`. Overriding it with a plain utility class on the element
	 * would lose that cascade fight silently. This scoped rule is Svelte's
	 * own mechanism: the compiler appends this component's scope attribute
	 * to both the selector here and the `.t-headline` element in the markup
	 * above, so it wins on SPECIFICITY rather than fighting the layer, and
	 * it touches only THIS component's headline — `.t-headline` is shared by
	 * other pages (`/apps/[name]`'s own headline, per `app.css`'s note) and
	 * they are not asked to shrink.
	 *
	 * WHY: at 390, a long generated headline ("hello-frontend-app is waiting
	 * on another deploy in all 3 environments") wrapped to three lines at
	 * 17px, the single largest contributor to the banner's height (68.8px of
	 * a 234.8px banner on `/apps`). Two lines at 14px reaches the height
	 * budget honestly — by giving the loudest object on the page one less
	 * point size on the narrowest viewport, not by hiding the sentence
	 * below it behind a clamp. Weight (600) is untouched; only size steps
	 * down, and only below `sm`, where the reference banner already fits.
	 */
	@container (max-width: 699px) {
		.t-headline {
			font-size: 14px;
		}
	}

	/*
	 * ⭐ F-BREAKPOINTS: THE `Open <app> →` COLUMN WAS DECIDED BY VIEWPORT,
	 * NOT BY THE BANNER'S OWN RENDERED WIDTH — AND THE TWO ARE NOT THE SAME
	 * NUMBER. (2026-09-03, breakpoints pass)
	 *
	 * The sidebar is 175px wide from `sm` (640px) on. So content width is
	 * NOT monotonic in viewport width: a 639px viewport gives this banner
	 * ~624px, a 640px viewport gives it ~449px — an 175px CLIFF at the exact
	 * pixel the old `sm:` classes flipped the layout to "actions own a full-
	 * height right column, text gets column 2 only". Measured on `/apps` at
	 * 640: banner 443px tall, headline 7 lines, message 11 lines at ~1.5
	 * words/line, text:action width ratio 85:196 — the layout SM asked for
	 * but the container never had room to give.
	 *
	 * `.ap-cq` makes the banner itself the query subject. Below 700px of its
	 * OWN width the text spans the full row (mobile shape: `col-end-4`,
	 * actions drops into the disclosure row) regardless of what the
	 * viewport happens to be; at 700px+ of banner width there is
	 * comfortably enough room for a 30ch prose column AND a ~200px action
	 * column side by side (2.5rem + 30ch + auto + 2 gaps ≈ 490px, well
	 * under 700), so the two-column shape returns.
	 *
	 * ⚠️ THE COLUMN GRID ITSELF STAYS `minmax(0,1fr)` BELOW 700px, ON
	 * PURPOSE. Adding a 30ch floor there too would let a wide `actions`
	 * snippet (a button plus a link, real content on some call sites) force
	 * the row past the container's edge — grid tracks don't shrink a floor
	 * away, they overflow it. `minmax(0,1fr)` is the safety valve that lets
	 * the text column go narrow (more LINES, never more WIDTH than it has)
	 * in the stacked shape; the 30ch floor is spent only where the layout
	 * has already proven there is room for it.
	 */
	.ap-cq {
		container-type: inline-size;
	}

	@container (min-width: 700px) {
		.ap-grid {
			grid-template-columns: 2.5rem minmax(30ch, 1fr) auto;
		}
		.ap-headline-row {
			grid-column-end: 3;
			min-height: 2.5rem;
		}
		.ap-message-row {
			grid-column-end: 3;
		}
		/*
		 * ⭐ P5, 2026-09-03: BOTH RECLAIM COLUMN 3 FOR `actions` AT `sm`+.
		 * Base (mobile) placement spans the disclosure and the actions row
		 * across the full `col-end-4` width because at that size `actions`
		 * sits BELOW the disclosure, not beside it — see both cells' own
		 * markup notes. Once the banner clears 700px of its own width,
		 * `actions` moves back into column 3 as a right-hand rail spanning
		 * every row, so the disclosure narrows back to column 2 only, same
		 * as `.ap-headline-row`/`.ap-message-row` above.
		 */
		.ap-disclosure-cell {
			grid-column-end: 3;
		}
		.ap-actions-cell {
			grid-column-start: 3;
			grid-column-end: 4;
			grid-row-start: 1;
			grid-row-end: 4;
			margin-top: 0;
			align-self: center;
		}
	}
</style>
