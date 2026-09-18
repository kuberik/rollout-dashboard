<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE GATE LINES, COMPOSED — EXTRACTED SO A SECOND SURFACE CAN DRAW THEM
	 * INSTEAD OF RE-NARRATING THEM. (2026-09-18)
	 *
	 * This markup was inside `BlockingStoryLines`, reachable only by passing a
	 * whole `BlockingStory`. The rollout detail page's per-release-candidate
	 * "held" popover has GATES but no story, so it had grown its own list —
	 * first a paragraph, then a `GateRecord` — and the human's verdict on the
	 * second attempt was the one that matters:
	 *
	 * > *"you have to show it visually, what you did here is just created a
	 * > table-like interface for each one with different values. in the end,
	 * > they look the same again"*
	 *
	 * Correct, and `BlockingStoryLines`'s own header had already answered it for
	 * the other surface: a record is an aligned block of labelled facts, so five
	 * gates render as five identical tables. The LINE is where the kinds stop
	 * looking alike, because the line draws what the kind actually is:
	 *
	 *   ⇄  caffeine-db        [db|1.262.0] → [1.263]     a contract, drawn
	 *   »  dev                 dev has to deploy first    a promotion order
	 *   🗓  Business Hours Only reopens in 2h 59m          a window, with its clock
	 *   👤 Waiting on a person to approve it              no shape → the sentence
	 *
	 * ⛔ AND ONLY WHERE THERE IS A SHAPE. `check`, `approval` and `unknown` name
	 * no second party, so they keep their prose — unchanged, and deliberately.
	 * *"Prose is what you use when you have no shape."* The difference between
	 * the kinds is not decoration applied evenly; it is that some kinds HAVE a
	 * second object to draw and some do not.
	 *
	 * ⚠️ NO CONTROL LIVES HERE. `BlockingStoryLines` puts a `RulePopover` under
	 * these lines; the held popover is ITSELF a popover and must not nest a
	 * second one. So the control stays with each host and only the lines move.
	 */
	import { ArrowRightOutline } from 'flowbite-svelte-icons';
	import { formatTimeUntil } from '$lib/api/schedules';
	import { now } from '$lib/stores/time';
	import Chip from './Chip.svelte';
	import { gateMark } from './GateRecord.svelte';
	import { type ClassifiedGate } from '$lib/view-models/blocking-story';

	let {
		gates,
		subjectHref = null,
		subjectLabel = null
	}: {
		gates: ClassifiedGate[];
		subjectHref?: string | null;
		subjectLabel?: string | null;
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
	 * ⭐ THE ROW'S OWN MARK, NOT `gateMark()` UNTOUCHED. (2026-09-03, design
	 * pass 7, finding #1) `gateMark({kind:'promotion'})` is `ChevronDoubleRightOutline`
	 * — the SAME svg `PromotionPipeline`'s own card header wears on
	 * `/apps/<name>` (`GateRecord.svelte`'s own comment names it: *"a
	 * promotion order takes `ChevronDoubleRightOutline` (the `Promotion
	 * pipeline` card header's)"*). That is correct where `gateMark` is used
	 * as a RECORD field (`GateRecord`'s own popover rows, one scale down,
	 * where the icon sits beside the rule's NAME) — it is wrong here, where
	 * it sits as a bare bullet in front of a whole clause (`dev deploys it
	 * first`). An icon that NAMES A CARD elsewhere in the product is not a
	 * bullet; a reader who has seen the `Promotion pipeline` card reads this
	 * row as "this is that card", which it is not. `gateMark` itself is
	 * unchanged — `GateRecord.svelte`'s popover and its own test still pin
	 * `ChevronDoubleRightOutline` for `kind: 'promotion'` — this only
	 * overrides what THIS LIST draws, for this one kind, to the product's
	 * plain directional glyph instead.
	 */
	function lineMark(g: ClassifiedGate) {
		if (g.kind === 'promotion') return ArrowRightOutline;
		return gateMark(g);
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

	<ul class="flex min-w-0 flex-col gap-1">
		{#each gates as g (g.id)}
			{@const Icon = lineMark(g)}
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
