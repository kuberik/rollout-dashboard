<svelte:options runes={true} />

<script lang="ts">
	import type { Snippet, Component } from 'svelte';
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
		 */
		footnoteLabel?: string;
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
		footnoteLabel = 'Details',
		icon,
		pulse = false,
		actions,
		extra,
		class: className = 'mb-4'
	}: Props = $props();

	/**
	 * ⛔ THE ALPHA LADDER IS GONE FROM THE MESSAGE AND THE FOOTNOTE IN LIGHT,
	 * AND IT IS NOT COMING BACK. Measured pixel-wise off a screenshot (the
	 * container is a GRADIENT, so `getComputedStyle` on an ancestor reports
	 * `transparent` and every earlier number computed against the page ground
	 * was wrong), all four severities, 1440:
	 *
	 *   light   icon 2.57-3.69 | message 3.34-4.20 | footnote 2.35-3.11
	 *   dark    icon 6.17-6.78 | message 5.68-6.08 | footnote 3.58-3.83
	 *
	 * There is NO alpha that works in light: `<hue>-700` at 95% over the
	 * `<hue>-50/100` gradient is still only 4.46:1, under the 4.5 floor. So
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
	 */
	const palette = $derived.by(() => {
		switch (severity) {
			case 'error':
				return {
					container:
						'bg-gradient-to-r from-red-100 via-red-50 to-red-100 shadow-2xl shadow-red-200/60 ring-1 ring-red-300/60 dark:from-red-950 dark:via-red-900 dark:to-red-950 dark:shadow-red-950/50 dark:ring-red-800/60',
					glowA: 'bg-red-400/8 dark:bg-red-500/10',
					glowB: 'bg-red-300/10 dark:bg-red-400/8',
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
						'bg-gradient-to-r from-amber-100 via-amber-50 to-amber-100 shadow-2xl shadow-amber-200/60 ring-1 ring-amber-300/60 dark:from-amber-950 dark:via-amber-900 dark:to-amber-950 dark:shadow-amber-950/50 dark:ring-amber-800/60',
					glowA: 'bg-amber-400/8 dark:bg-amber-500/10',
					glowB: 'bg-amber-300/10 dark:bg-amber-400/8',
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
						'bg-gradient-to-r from-orange-100 via-orange-50 to-orange-100 shadow-2xl shadow-orange-200/60 ring-1 ring-orange-300/60 dark:from-orange-950 dark:via-orange-900 dark:to-orange-950 dark:shadow-orange-950/50 dark:ring-orange-800/60',
					glowA: 'bg-orange-400/8 dark:bg-orange-500/10',
					glowB: 'bg-orange-300/10 dark:bg-orange-400/8',
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
						'bg-gradient-to-r from-blue-100 via-blue-50 to-blue-100 shadow-2xl shadow-blue-200/60 ring-1 ring-blue-300/60 dark:from-blue-950 dark:via-blue-900 dark:to-blue-950 dark:shadow-blue-950/50 dark:ring-blue-800/60',
					glowA: 'bg-blue-400/8 dark:bg-blue-500/10',
					glowB: 'bg-blue-300/10 dark:bg-blue-400/8',
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
</script>

<div class={className}>
	<div class="relative overflow-hidden rounded-xl {palette.container}">
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			<div class="absolute -top-10 -right-10 h-48 w-48 rounded-full {palette.glowA} blur-3xl"></div>
			<div
				class="absolute -bottom-6 left-1/4 h-32 w-32 rounded-full {palette.glowB} blur-2xl"
			></div>
		</div>

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
			<div class="grid min-w-0 flex-1 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4">
				<!--
					⭐ `min-h-12 sm:min-h-10` IS THE ROOM THE FULL-SIZE HALO NEEDS, AND IT
					IS SPENT ONLY WHEN THERE IS A HALO. From the human, rejecting a
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
					class="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-2 {pulse
						? 'min-h-12 sm:min-h-10'
						: ''}"
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
						<p class="text-base font-bold tracking-tight {palette.title}">{title}</p>
					</div>
					{#if extra}{@render extra()}{/if}
				</div>
				{#if message || messageBody || footnote}
					<div class="col-start-2 row-start-2 min-w-0">
						{#if messageBody}
							<div class="mt-0.5 text-sm break-words {palette.message}">
								{@render messageBody()}
							</div>
						{:else if message}
							<p class="mt-0.5 text-sm break-words {palette.message}">{message}</p>
						{/if}
						{#if footnote}
							<!--
								⭐ THE DISCLOSURE. See the `footnote` prop's note for the
								measurement that produced it.

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
							-->
							<!--
								⚠️ `flex flex-col items-start` IS LOAD-BEARING, NOT TIDINESS.
								A block `<details>` puts its `inline-flex` summary in an
								anonymous LINE BOX, and that box inherits the banner's 16px
								strut — so the 16px control measured **24px**, and at 1440,
								where the footnote had been a single line, the disclosure
								made the banner 10px TALLER than the prose it replaced
								(106px → 116px). As a flex column the summary is a flex item
								with no strut, and `mt-1` is the exact spacing the printed
								footnote used, so desktop is a strict improvement instead of
								a wash.
							-->
							<details class="group mt-1 flex flex-col items-start">
								<summary
									class="inline-flex cursor-pointer list-none items-center gap-1 rounded text-xs font-medium {palette.footnote} hover:underline focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none [&::-webkit-details-marker]:hidden"
								>
									<ChevronRightOutline
										class="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
										aria-hidden="true"
									/>
									{footnoteLabel}
								</summary>
								<p class="mt-1 text-xs break-words {palette.footnote}">{footnote}</p>
							</details>
						{/if}
					</div>
				{/if}
			</div>

			<!-- ⭐ THE ACTIONS ROW CARRIES THE SEVERITY'S INK, FOR THE LINKS IN IT.
			     (2026-09-02) `.btn` states its own colours, so this row never
			     needed one — but a `.nav-link` (`app.css`) takes its ink from
			     `--nav-link-ink`, and without this it fell back to the neutral
			     body ink and spoke in a different voice from the `Details`
			     disclosure directly above it. `palette.title` is the panel's
			     strongest step and the one already measured for this ground;
			     `--nav-link-ink: inherit` hands it down without touching any
			     button. -->
			{#if actions}
				<div
					class="flex items-center gap-3 sm:shrink-0 {palette.title}"
					style="--nav-link-ink: currentColor"
				>
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
</div>
