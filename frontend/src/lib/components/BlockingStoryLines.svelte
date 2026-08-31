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
	 * ⛔ NO STRINGS HERE EITHER. `short` and the clock come off the story.
	 *
	 * ── ⭐ AND IT HAS THE BANNER'S THREE TIERS NOW. (2026-08-31) ────────────
	 *
	 * `AlertPanel` split into printed fact / printed consequence / DISCLOSED
	 * mechanism in 05281bc, and the human's next sentence was *"also too much
	 * raw text in some other places."* This is the worst of the other places,
	 * and the reason is REPETITION rather than length:
	 *
	 * Measured at 1440 on the live cluster, in ONE viewport, printed:
	 *
	 *   `/environments`             `rule: dependency-hello-frontend-needs-api`
	 *                               3×, plus `rule: ghd-9qcnj` and
	 *                               `rule: ghd-5b2wn`  → FIVE handle lines
	 *                               *"Nobody has to approve anything — this
	 *                               clears when the deploy in front of it
	 *                               lands."*  3×
	 *   `/apps/<name>`              the same five handles and the same verdict
	 *                               3×, inside ONE card
	 *
	 * One fact printed N times in one viewport is worse than one long sentence,
	 * and neither of those two is a fact a reader takes in the first second:
	 *
	 *   · the `rule:` handle is a GENERATED KUBERNETES NAME. It is a lookup key
	 *     for correlating with `kubectl`, which is the definition of the
	 *     disclosure tier — `AlertPanel`'s `footnote` prop says exactly this
	 *     about the same string.
	 *   · the VERDICT restates the clause above it for four of five gate kinds.
	 *     `clock`/`upstream`/`check` clauses already name what clears them
	 *     (*"Waiting for dev to deploy it first"*), and on `/apps/<name>` the
	 *     card this renders in is TITLED *"Waiting, nothing to do"* — so
	 *     *"Nobody has to approve anything"* was the card's own title, restated
	 *     once per row, which is an object drawing the norm.
	 *
	 * ⛔ NEITHER IS DELETED, AND THAT IS NOT A DETAIL. Both are still produced
	 * by `blocking-story.ts`, still pinned by `truth.test.ts`, and both are in
	 * this component's DOM inside a native `<details>` — keyboard-reachable,
	 * announced, selectable, and still walked by `subject.svelte.test.ts`'s
	 * `textContent`. A tooltip would have made `ghd-5b2wn` unreachable on a
	 * phone, which is a deletion with better manners.
	 *
	 * ⛔ ONE CONTROL PER INSTANCE, NOT ONE PER LINE. Porting the banner's
	 * disclosure per GATE would have put four controls in one `/environments`
	 * viewport, which is its own kind of noise. The verdict and every handle
	 * share the one control, and the per-gate association survives as a `title`
	 * on each clause — the handle for THAT line, where the line is.
	 *
	 * ⛔ AND NOTHING BECAME GRAY. This component was already `gray-500` prose
	 * on a white card by design (`BlockReason`: *"no colour on the prose, and
	 * no fill"* — the page's one fill belongs to the banner). What changed is
	 * that there is LESS of it. If a region gets shorter it must get sharper,
	 * never quieter, and the sharpening here is that the clause — the only line
	 * that says what is actually holding this rollout — is no longer the third
	 * gray line of five.
	 */
	import {
		UserCircleSolid,
		CalendarWeekSolid,
		HourglassSolid,
		ArrowRightAltSolid,
		QuestionCircleSolid,
		ChevronRightOutline
	} from 'flowbite-svelte-icons';
	import { formatTimeUntil } from '$lib/api/schedules';
	import { now } from '$lib/stores/time';
	import {
		ruleHandle,
		type BlockingStory,
		type ClassifiedGate
	} from '$lib/view-models/blocking-story';

	let { story, class: className = '' }: { story: BlockingStory; class?: string } = $props();

	function iconFor(g: ClassifiedGate) {
		if (g.clears === 'person') return UserCircleSolid;
		if (g.clears === 'unknown') return QuestionCircleSolid;
		if (g.clears === 'upstream') return ArrowRightAltSolid;
		if (g.clears === 'clock') return CalendarWeekSolid;
		return HourglassSolid;
	}

	// The clock's arithmetic is `api/schedules.ts`'s, the same function the
	// banner and `/versions` call, so two objects on one screen cannot print
	// two different times for one window.
	function whenFor(g: ClassifiedGate): string | null {
		if (!g.clearsAt) return null;
		const until = formatTimeUntil(g.clearsAt, $now);
		return until ? `reopens in ${until} (${new Date(g.clearsAt).toLocaleString()})` : null;
	}

	// ⛔ `verdict`, NOT `resolution`. The manual-deploy clause is a PAGE-level
	// promise and the banner carries it; repeated under every row it was the
	// same sentence three times in one viewport. Same string, same order, as
	// `BlockingStoryPanel`'s footnote — one idiom, learned once.
	const rules = $derived(ruleHandle(story));
</script>

{#if story.blocked && story.gates.length > 0}
	<div class="mt-1.5 flex min-w-0 flex-col gap-1 {className}">
		<ul class="flex min-w-0 flex-col gap-1">
			{#each story.gates as g (g.id)}
				{@const Icon = iconFor(g)}
				{@const when = whenFor(g)}
				<!-- THE HANDLE FOR THIS LINE, ON THIS LINE. The joined list in the
				     disclosure below cannot say WHICH gate produced WHICH clause;
				     this can, and it costs no pixels. It is an ADDITION to the
				     disclosure, never a substitute for it — a `title` is not
				     reachable on a phone. -->
				<li
					class="t-micro flex min-w-0 items-start gap-1.5 text-gray-500 dark:text-gray-400"
					title="The rule holding this: {g.id}"
				>
					<Icon class="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
					<!-- ONE EXPRESSION, NOT AN `{#if}`. The block form ate the
					     leading space and rendered `deploy window— reopens in 12h`. -->
					<span class="min-w-0">{when ? `${g.short} — ${when}` : g.short}</span>
				</li>
			{/each}
		</ul>
		<!--
			⭐ THE DISCLOSURE — `AlertPanel`'s, at card scale. See the component
			note above for the five-handles-in-one-viewport measurement.

			⚠️ `flex flex-col items-start` IS LOAD-BEARING, NOT TIDINESS, and it
			is the same trap `AlertPanel` records: a block `<details>` puts its
			`inline-flex` summary in an anonymous LINE BOX which inherits the
			surround's strut, and the control then measures TALLER than the line
			of prose it replaced. As a flex column the summary is a flex item
			with no strut.

			THE CONTROL IS THE `Show 8 ready resources ›` IDIOM — 11px, the
			card's own gray, a chevron that rotates 90° on open. `list-none`
			plus the webkit marker rule remove the native triangle so the
			chevron is the only affordance.
		-->
		<details class="group flex flex-col items-start">
			<summary
				class="t-micro inline-flex cursor-pointer list-none items-center gap-1 rounded text-gray-500 hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-current/40 focus-visible:outline-none dark:text-gray-400 dark:hover:text-white [&::-webkit-details-marker]:hidden"
			>
				<ChevronRightOutline
					class="h-3 w-3 shrink-0 transition-transform group-open:rotate-90"
					aria-hidden="true"
				/>
				What clears this
			</summary>
			<p class="t-micro mt-1 break-words text-gray-500 dark:text-gray-400">{story.verdict}</p>
			{#if rules}
				<!-- THE IDENTIFIER IS A HANDLE AND IS DRESSED AS ONE: mono, muted,
				     on its own line, labelled with the word that says what it is.
				     Inline it inherited the sentence's wrap point and a 300px card
				     split `schedule-gate-fk44d` into `fk` / `44d`, which reads as
				     two identifiers. -->
				<p class="t-code-sm mt-0.5 break-all text-gray-500 dark:text-gray-400">rule: {rules}</p>
			{/if}
		</details>
	</div>
{/if}
