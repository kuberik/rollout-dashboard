<svelte:options runes={true} />

<script module lang="ts">
	/**
	 * ⭐ THE MARK IS EXPORTED, SO IT CAN BE ARGUED WITH IN A TEST.
	 *
	 * From the human, on the gate row: *"still don't like these details when we
	 * have this nonsense icon."* A mark chosen inside a component's markup is a
	 * mark nobody can assert on, and two of the five here had drifted into
	 * decoration — see `BlockingStoryLines.svelte` for the argument on each
	 * kind.
	 *
	 * ⭐ IT IS A FUNCTION OF `kind` FIRST AND `clears` SECOND, because `clears`
	 * is the REMEDY and `kind` is the OBJECT — and an icon names an object. Two
	 * `upstream` gates clear the same way and are not the same thing: one is a
	 * cross-service contract, one is a promotion order.
	 *
	 * ⚠️ THEY LIVE HERE, NOT IN `BlockingStoryLines`, BECAUSE THE RECORD MOVED
	 * HERE. (2026-09-02) This component is imported BY `BlockingStoryLines`, so
	 * exporting the mark from there and importing it back would be a cycle. The
	 * record is the thing that draws a gate at two scales; the mark belongs to
	 * the same object.
	 */
	import {
		UserCircleSolid,
		CalendarWeekSolid,
		ShieldCheckSolid,
		ShareNodesSolid,
		ChevronDoubleRightOutline,
		QuestionCircleSolid
	} from 'flowbite-svelte-icons';
	import type { ClassifiedGate } from '$lib/view-models/blocking-story';

	export function gateMark(g: Pick<ClassifiedGate, 'kind' | 'clears'>) {
		// A CONTRACT WITH ANOTHER SERVICE. `contractBlockReason` and the
		// `/dependencies` graph already spend this mark on this object.
		if (g.kind === 'dependency') return ShareNodesSolid;
		// PROMOTION ORDER. The `Promotion pipeline` card header's own mark.
		if (g.kind === 'promotion') return ChevronDoubleRightOutline;
		// A TIME WINDOW. True of the kind, and unchanged.
		if (g.clears === 'clock') return CalendarWeekSolid;
		// SOMEONE HAS TO ACT. True of the kind, and unchanged.
		if (g.clears === 'person') return UserCircleSolid;
		// WE CANNOT TELL. True of the kind, and unchanged.
		if (g.clears === 'unknown') return QuestionCircleSolid;
		// ⛔ NOT AN HOURGLASS. An hourglass means *time will fix this*, which is
		// `clock`'s meaning — and `check` is precisely the kind that is NOT on a
		// clock. A guard that has not cleared.
		return ShieldCheckSolid;
	}

	/** What kind of object the rule is, for the record. A NOUN, never a remedy. */
	export function gateKindWord(g: Pick<ClassifiedGate, 'kind'>): string {
		if (g.kind === 'schedule') return 'deploy window';
		if (g.kind === 'check') return 'check';
		if (g.kind === 'promotion') return 'promotion order';
		if (g.kind === 'dependency') return 'service contract';
		if (g.kind === 'approval') return 'manual approval';
		return 'not attributed';
	}
</script>

<script lang="ts">
	/**
	 * ⭐ EVERY GATE HOLDING ONE ROLLOUT, AS A RECORD — AT BOTH SCALES.
	 *
	 * ── WHY IT IS ONE OBJECT (2026-09-02) ───────────────────────────────────
	 *
	 * The card scale got this record on 2026-09-02 (`BlockingStoryLines` →
	 * `RulePopover`). The BANNER — `BlockingStoryPanel`, the same story, one
	 * viewport above it on `/environments` — kept a PARAGRAPH behind a control
	 * labelled `Details`, so the identical content had two shapes and two
	 * grammars on one screen. That is the defect the disclosure pass was
	 * supposed to close and it closed only half of it.
	 *
	 * Rather than port the `<dl>` into a second file — *"a shared object copied
	 * into a second file will not receive the shared object's next fix"* — the
	 * record is this component and both scales render it.
	 *
	 * ── ⛔ THE RECORD HOLDS WHAT THE HOST DOES NOT PRINT ─────────────────────
	 *
	 * `clearsFor` is the whole of that rule and it is why it is a callback
	 * rather than a boolean:
	 *
	 *   · CARD SCALE (`BlockingStoryLines`). The row DRAWS the gate — a mark, a
	 *     provider at full ink, `[API|1.66.0] → [^1.67.0]` — instead of
	 *     narrating it, so `short` is nowhere on screen and belongs in the
	 *     record. But a gate with no `subject` prints `short` on its own row,
	 *     and repeating it here would make the reward for opening the control a
	 *     sentence already visible. So it is PER GATE.
	 *   · BANNER SCALE (`BlockingStoryPanel`). `story.consequence` is printed
	 *     and it already carries EVERY gate's clause — that is what it is for.
	 *     So no gate gets a `Clears` row, and the callback returns null.
	 *
	 * Opening a control to read a sentence already on screen is the complaint
	 * that produced this whole pass. It must stay impossible at both scales.
	 */
	import { formatTimeUntil } from '$lib/api/schedules';
	import { now } from '$lib/stores/time';
	import FactList, { type Fact } from './FactList.svelte';

	let {
		gates,
		/**
		 * The story's own last word — `verdict` at card scale, `resolution` at
		 * banner scale. It is a SENTENCE, so it is printed as one under a rule
		 * rather than given a label and dressed as a field.
		 */
		foot = null,
		/** See the note above. Null means "the host already printed it". */
		clearsFor = () => null,
		tone = 'card'
	}: {
		gates: ClassifiedGate[];
		foot?: string | null;
		clearsFor?: (g: ClassifiedGate) => string | null;
		tone?: 'card' | 'banner';
	} = $props();

	// The clock's arithmetic is `api/schedules.ts`'s, the same function the
	// banner and `/versions` call, so two objects on one screen cannot print
	// two different times for one window.
	function untilFor(g: ClassifiedGate): string | null {
		return g.clearsAt ? formatTimeUntil(g.clearsAt, $now) : null;
	}

	function factsFor(g: ClassifiedGate): Fact[] {
		const facts: Fact[] = [{ label: 'Kind', value: gateKindWord(g) }];
		const clears = clearsFor(g);
		if (clears) facts.push({ label: 'Clears', value: clears });
		if (g.clearsAt) {
			// ⚠️ NOT A NESTED TEMPLATE LITERAL. `lib/messages/scan.ts` reads string
			// literals with a regex and a backtick inside a `${}` inside a
			// backtick comes back to it as the fragment `…${until ?` — a census
			// entry nobody can read, for a message that does not exist.
			const stamp = new Date(g.clearsAt).toLocaleString();
			const until = untilFor(g);
			facts.push({ label: 'When', value: until ? `${stamp} · ${until}` : stamp });
		}
		// THE IDENTIFIER IS A HANDLE AND IS DRESSED AS ONE — mono, on its own
		// line, labelled with the word that says what it is. Inside the record it
		// has the panel's full measure rather than the remainder of a sentence.
		facts.push({ label: 'Rule', value: g.id, handle: true });
		return facts;
	}

	const divide = $derived(
		tone === 'banner' ? 'divide-current/15' : 'divide-gray-100 dark:divide-gray-700/60'
	);
</script>

<div class="flex min-w-0 flex-col">
	<div class="{gates.length > 1 ? `divide-y ${divide}` : ''} min-w-0">
		{#each gates as g (g.id)}
			{@const Icon = gateMark(g)}
			<div class="flex min-w-0 flex-col gap-1 py-2 first:pt-0 last:pb-0">
				<!-- THE RULE'S OWN NAME leads its block, with the SAME mark the row or
				     the banner glyph drew, so a reader with two gates can tell which
				     entry belongs to which line. -->
				<p class="flex min-w-0 items-center gap-1.5">
					<Icon
						class="h-3.5 w-3.5 shrink-0 {tone === 'card' ? 'text-gray-500 dark:text-gray-400' : ''}"
						aria-hidden="true"
					/>
					<!--
						⭐ PLAIN `t-dense`, NOT `t-dense font-medium`. (2026-09-03, design
						pass 7, finding #3) COMPOSITION-GRAMMAR names no inline-emphasis
						exception for a declared role, and this label is not a WORD
						picked out of a sentence — it is the whole line, the rule's own
						name, so there is no surrounding non-bold text for a heavier
						weight to emphasise AGAINST. `font-medium` here only turned
						`t-dense` (12.5px/400) into a fourth, undeclared 12.5px/500
						pairing the census had no name for. The role's own weight already
						reads as the line's lead — `Icon` and colour (full ink vs the
						record's gray-500) carry the hierarchy this line needs.
					-->
					<span
						class="t-dense min-w-0 break-words {tone === 'card'
							? 'text-gray-900 dark:text-white'
							: ''}">{g.label}</span
					>
				</p>
				<FactList facts={factsFor(g)} {tone} />
			</div>
		{/each}
	</div>
	{#if foot}
		<!-- ⛔ A SENTENCE, NOT A FIELD. `verdict` / `resolution` answers *"do I get
		     up?"*; it has no name and giving it one would be prose wearing a
		     label. It sits under a rule, which is what separates it from the
		     record above. -->
		<p
			class="t-micro mt-2 border-t pt-2 break-words {tone === 'banner'
				? 'border-current/15'
				: 'border-gray-100 text-gray-500 dark:border-gray-700/60 dark:text-gray-400'}"
		>
			{foot}
		</p>
	{/if}
</div>
