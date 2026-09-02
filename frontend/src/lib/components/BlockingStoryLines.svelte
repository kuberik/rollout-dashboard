<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ EVERY GATE HOLDING ONE ROLLOUT, ONE LINE EACH, INSIDE A CARD.
	 *
	 * `BlockingStoryPanel` is the page-level object — a filled banner, one per
	 * page, `COMPOSITION-GRAMMAR.md` §4. This is the same story at CARD scale,
	 * and the difference is deliberate: a second fill inside a card would
	 * flatten the one object on the page that is allowed one.
	 *
	 * ⛔ IT LISTS THEM ALL. The component this replaces printed the FIRST
	 * matching branch — one gate, chosen by whether it published an allow-list
	 * — so a rollout held by an approval, an upstream deploy and a closed
	 * window rendered as a single line about the approval. Three surfaces did
	 * that with three different first-matches, which is how one product came to
	 * name three different culprits for one rollout.
	 *
	 * ⛔ NO STRINGS HERE EITHER. Every word on the row comes off the story.
	 *
	 * ── ⭐ THE LINE IS COMPOSED NOW, NOT NARRATED. (2026-09-02) ──────────────
	 *
	 * From the human, looking at this row on `/environments`:
	 *
	 * > *"still don't like these details when we have this nonsense icon. i feel
	 * > like you could better visualize this rather than just putting ascii
	 * > icons in there"*
	 *
	 * Both halves were right, and they are one defect.
	 *
	 * ── (1) THE MARK SAID NOTHING, SO IT SAID SOMETHING FALSE ────────────────
	 *
	 * `COMPOSITION-GRAMMAR.md` §3 is that icons on this product are STRUCTURAL —
	 * *"if a card has a title, it has an icon"*, 115 of them on the page the
	 * human calls beautiful, every one naming its object. Measured against that,
	 * two of the five marks here were decoration and one of those was a lie:
	 *
	 *   · `upstream` drew `ArrowRightAltSolid` — a bare direction, no object,
	 *     and at 14px a solid smudge. Worse, ONE mark stood for TWO mechanisms:
	 *     a cross-service contract and a promotion order. It is split, and each
	 *     half takes a mark this product already spends on that exact object —
	 *     `ShareNodesSolid` is `contractBlockReason`'s and the `/dependencies`
	 *     graph's, `ChevronDoubleRightOutline` is the `Promotion pipeline` card
	 *     header's on `/apps/<name>`.
	 *   · `check` drew `HourglassSolid`, and an hourglass means *time will fix
	 *     this* — which is the meaning of `clock`, THE VERY KIND `check` EXISTS
	 *     TO BE DISTINGUISHED FROM (`check` is "not passing and nothing
	 *     published a window", i.e. self-clearing but unschedulable). Two kinds
	 *     may not share one meaning. It is `ShieldCheckSolid`: a guard that has
	 *     not cleared.
	 *
	 * The other three were already true of their kind and are UNCHANGED — a
	 * calendar genuinely means a time window, a person genuinely means someone
	 * must act, a question mark genuinely means we cannot tell.
	 *
	 * ── (2) THREE FACTS WERE FLATTENED INTO ONE SENTENCE ─────────────────────
	 *
	 * *"Waiting for hello-api-app to ship a newer api — it is on 1.66.0"* is a
	 * PROVIDER, a CONTRACT with a required range, and the VERSION IT SERVES,
	 * narrated at 11px gray and wrapping to two lines in a 300px card. The
	 * product has the vocabulary to show that: `Chip`'s joined form pairs a
	 * caption with an identifier, and `/dependencies` draws provider → consumer.
	 * So the row draws it:
	 *
	 *     ⇄  hello-api-app   [API|1.66.0] → [^1.67.0]
	 *
	 * The required range comes from `RolloutDependency.status.blockedReleases[]
	 * .requiredVersion`, which has been in the `/api/rollouts` payload all along
	 * and which no surface has ever drawn.
	 *
	 * ⛔ AND THE SENTENCE IS GONE, NOT DOUBLED. The failure to avoid here is one
	 * fact drawn twice — a handle printed five times on `/environments`, a
	 * rollback panel restating the banner above it. Where the drawing carries
	 * the fact, `short` is not printed beside it; it moves into the record
	 * behind the control, where it stays in the DOM, reachable and testable.
	 *
	 * ⛔ AND ONLY WHERE THERE IS A SHAPE. `check`, `approval` and `unknown` name
	 * no second party — their only concrete object is the gate's generated id,
	 * which this product deliberately took OUT of the printed tier. Those rows
	 * print `short`, unchanged. Prose is what you use when you have no shape.
	 * `blocking-story.ts` decides which is which by setting `subject`.
	 *
	 * ── ⭐ THE CONTROL IS A POPOVER, AND WHAT IS BEHIND IT IS A RECORD ────────
	 *
	 * > *"i think i also don't like 'details' expansion. it's formatted just as
	 * > text when in some cases it could be more richly formatted. i think maybe
	 * > a popover would be better?"*
	 *
	 * See `RulePopover.svelte` for the mechanism and for why it is a `<details>`
	 * rather than flowbite's `<Popover>` (which renders `{#if isOpen}` and would
	 * have made every one of these facts unreachable to `lib/messages/` while
	 * the suite stayed green). What it holds is no longer a paragraph: it is one
	 * aligned block PER GATE — the rule's own name, what kind of gate it is,
	 * what clears it, when it clears where that is knowable, and the raw object
	 * name to paste after `kubectl` — then the story's verdict once at the foot.
	 *
	 * ⛔ ONE CONTROL PER INSTANCE, NOT ONE PER LINE. Porting the banner's
	 * disclosure per GATE would have put four controls in one `/environments`
	 * viewport, which is its own kind of noise. Every gate's record is behind
	 * the one control, and the per-gate association survives as a `title` on
	 * each clause — the handle for THAT line, where the line is.
	 *
	 * ⛔ AND NOTHING BECAME GRAY. This component was already `gray-500` prose on
	 * a white card by design (`BlockReason`: *"no colour on the prose, and no
	 * fill"* — the page's one fill belongs to the banner). What changed is that
	 * the BLOCKING OBJECT — the provider, the environment, the window — is now
	 * full ink at `t-code-sm`/`t-micro` instead of the fourth word of a gray
	 * sentence, and the versions are chips. Less text, more hierarchy.
	 */
	import { ArrowRightOutline } from 'flowbite-svelte-icons';
	import { formatTimeUntil } from '$lib/api/schedules';
	import { now } from '$lib/stores/time';
	import Chip from './Chip.svelte';
	import RulePopover from './RulePopover.svelte';
	import GateRecord, { gateMark } from './GateRecord.svelte';
	import { type BlockingStory, type ClassifiedGate } from '$lib/view-models/blocking-story';

	let {
		story,
		/**
		 * ⭐ THE PROVIDER NAME BECOMES THE `.tap-link`, WHEN THE CALLER HAS ONE TO
		 * OFFER. (2026-09-02, follow-up)
		 *
		 * `PromotionPipeline`'s hop used to draw this clause and then repeat the
		 * destination as its own `Open hello-api-app ›` line 8px below it — two
		 * controls spelling one URL in one edge, which is the redundant-tab-stop
		 * rule (`CLAUDE.md`, applied on `/apps` this week) one level down. This
		 * component has always known WHICH object the reader would go and look
		 * at (`g.subject`, drawn at full ink already); it just never had
		 * anywhere to send them. `subjectHref` is that anywhere.
		 *
		 * Matched by `subjectLabel`, not "the first drawn row" — a hop's story
		 * can carry more than one gate (a schedule window beside a dependency
		 * contract), and only the row whose subject IS the destination may
		 * become its `.tap-link`. No match, no link: the row still prints its
		 * subject as plain text, byte-identical to every other caller.
		 */
		subjectHref = null,
		subjectLabel = null,
		class: className = ''
	}: {
		story: BlockingStory;
		subjectHref?: string | null;
		subjectLabel?: string | null;
		class?: string;
	} = $props();

	// The clock's arithmetic is `api/schedules.ts`'s, the same function the
	// banner and `/versions` call, so two objects on one screen cannot print
	// two different times for one window.
	function untilFor(g: ClassifiedGate): string | null {
		return g.clearsAt ? formatTimeUntil(g.clearsAt, $now) : null;
	}

	/** The version relation is drawable only when BOTH ends are known. */
	function drawsVersions(g: ClassifiedGate): boolean {
		return !!(g.contract && g.have && g.need);
	}

	/**
	 * ⭐ THE STATE OF `subject`, IN THE ROW'S RIGHT-HAND SLOT — the card-header
	 * grammar (`COMPOSITION-GRAMMAR.md` §1: icon + title left, rolled-up verdict
	 * right) brought down to row scale.
	 *
	 * ⛔ A CLOCK GATE WITH NO USABLE COUNTDOWN RETURNS NULL, and that is what
	 * makes the row fall back to the whole sentence: `Business Hours Only` on its
	 * own is a NAME, not a state, and `reopens in` with nothing after it is a
	 * broken one. `short` is complete by itself and is the honest fallback.
	 */
	function rowState(g: ClassifiedGate, until: string | null): string | null {
		if (g.clearsAt) return until && g.predicate ? `${g.predicate} ${until}` : null;
		return g.predicate;
	}
</script>

{#if story.blocked && story.gates.length > 0}
	<div class="mt-1.5 flex min-w-0 flex-col gap-1 {className}">
		<ul class="flex min-w-0 flex-col gap-1">
			{#each story.gates as g (g.id)}
				{@const Icon = gateMark(g)}
				{@const until = untilFor(g)}
				{@const state = rowState(g, until)}
				{@const drawn = !!g.subject && (drawsVersions(g) || state !== null)}
				<!-- THE HANDLE FOR THIS LINE, ON THIS LINE. The record in the popover
				     below names every gate, but the ROW is where the reader is
				     looking; this says which object produced this line and costs no
				     pixels. It is an ADDITION to the popover, never a substitute for
				     it — a `title` is not reachable on a phone. -->
				<li
					class="t-micro flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-gray-500 dark:text-gray-400"
					title="The rule holding this: {g.id}"
				>
					<span class="flex min-w-0 items-center gap-1.5">
						<Icon class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
						{#if drawn && subjectHref && g.subject === subjectLabel}
							<!-- THE OBJECT THAT HAS TO MOVE, AT FULL INK — AND NOW THE
							     ZONE'S ONE `.tap-link` TOO. Same classes, same ink, the
							     only addition is the anchor itself; a reader who does
							     not notice it is a link loses nothing they had before. -->
							<a
								href={subjectHref}
								class="{g.subjectKind === 'schedule'
									? 't-micro font-medium'
									: 't-code-sm'} tap-link min-w-0 truncate text-gray-900 dark:text-white">{g.subject}</a
							>
						{:else if drawn}
							<!-- THE OBJECT THAT HAS TO MOVE, AT FULL INK. It was the
							     fourth word of a gray sentence; it is the thing the
							     reader is looking for. Mono for a Kubernetes object
							     name (a service, an environment), sans for a
							     human-authored window label. -->
							<span
								class="{g.subjectKind === 'schedule'
									? 't-micro font-medium'
									: 't-code-sm'} min-w-0 truncate text-gray-900 dark:text-white">{g.subject}</span
							>
						{:else}
							<!-- NO SHAPE, SO THE SENTENCE STAYS. See the header. -->
							<span class="min-w-0">{g.short}</span>
						{/if}
					</span>
					{#if drawn && drawsVersions(g)}
						<!-- ⭐ THE CONTRACT, DRAWN. `[API|1.66.0]` is `Chip`'s joined
						     form — a caption and the identifier it captions, the
						     product's one badge geometry — and `[^1.67.0]` is its
						     identifier-only form. The arrow is between two operands,
						     which is the difference between a structural mark and the
						     decorative one this row used to lead with.
						     `valueIsBuild={false}`: a CONTRACT version is not a build,
						     and the tag glyph claims it is. -->
						<span class="flex min-w-0 items-center gap-1">
							<Chip
								role="count"
								label={g.contract ?? ''}
								value={g.have}
								valueIsBuild={false}
								wide={(g.contract ?? '').length > 14}
								title="{g.subject} serves {g.contract} {g.have}"
							/>
							<ArrowRightOutline
								class="h-3.5 w-3.5 shrink-0 text-gray-500 dark:text-gray-400"
								aria-hidden="true"
							/>
							<Chip
								role="count"
								label=""
								value={g.need}
								valueIsBuild={false}
								valueTitle="The held build needs {g.contract} {g.need}"
							/>
						</span>
					{:else if drawn && state}
						<span class="min-w-0">{state}</span>
					{/if}
				</li>
			{/each}
		</ul>
		<!--
			⭐ THE POPOVER, AND ITS CONTENT IS A RECORD. See the component note
			above, and `RulePopover.svelte` for why the mechanism is still a native
			`<details>`: the whole record is in the DOM when the panel is closed,
			which is what keeps `truth.test.ts` and `subject.svelte.test.ts` — both
			of which walk `textContent` — reading facts that are genuinely
			reachable rather than facts that merely exist in a source file.
		-->
		<RulePopover count={story.gates.length}>
			<!-- ⭐ THE RECORD IS `GateRecord`, AND IT IS THE SAME OBJECT THE BANNER
			     DRAWS. (2026-09-02) It was spelled here, and `BlockingStoryPanel` —
			     the same story one viewport above this on `/environments` — still
			     had a PARAGRAPH behind a control labelled `Details`. One affordance,
			     two shapes, two grammars, on one screen. The `<dl>` is one component
			     now, so the next fix to it reaches both scales.

			     `clearsFor` is PER GATE here: a row that DREW its clause has `short`
			     nowhere on screen and wants it in the record; a row that printed
			     `short` already shows it, and opening a control to read a sentence
			     you can already see is the complaint that produced this pass.

			     ⛔ `verdict`, NOT `resolution`. The manual-deploy clause is a
			     PAGE-level promise and the banner carries it; repeated under every
			     row it was the same sentence three times in one viewport. -->
			<GateRecord
				gates={story.gates}
				foot={story.verdict}
				clearsFor={(g) =>
					!!g.subject && (drawsVersions(g) || rowState(g, untilFor(g)) !== null) ? g.short : null}
			/>
		</RulePopover>
	</div>
{/if}
