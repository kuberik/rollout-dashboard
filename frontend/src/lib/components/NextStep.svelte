<svelte:options runes={true} />

<script module lang="ts">
	export type Step =
		/** A rule refuses every available version. Only a person moves it. */
		| 'approve'
		/** A newer version is allowed and nobody has pressed the button. */
		| 'promote'
		/** Something broke. There is no decision here, only a look. */
		| 'investigate'
		/** The last version was bad and the previous one was not. */
		| 'rollback'
		/** Blocked, but by something that will clear itself — go read it. */
		| 'unblock'
		/** Someone pinned it. Undoing that is the step. */
		| 'unpin'
		/** Nothing is wrong; this is navigation, not an action. */
		| 'open';
</script>

<script lang="ts">
	/**
	 * THE ONE THING TO DO, NAMED AS A VERB.
	 *
	 * ── WHY THIS EARNS ITS EXISTENCE ────────────────────────────────────────
	 *
	 * `DESIGN-INTENT.md`'s own rule: *"Be actionable. Showing a problem without
	 * offering the action is an unfinished design."* A live UX critique caught
	 * the product breaking it in the most expensive possible place:
	 *
	 * > *"`NEEDS A DECISION — 3 items` offers no decisions — every card gives
	 * > only `Investigate` and `View on GitHub`."*
	 *
	 * The mechanical cause was that FIVE different states all fell down one
	 * branch and that branch's action row was hard-coded. The verb was chosen
	 * per call site, so nothing could keep the verbs honest.
	 *
	 * **This component owns the verb vocabulary.** A caller passes the STATE it
	 * is in; the label, the icon and the emphasis come from one table. That is
	 * the reuse that matters — not markup, but the guarantee that the same
	 * problem offers the same step on `/apps`, `/apps/[name]`, `/environments`
	 * and `/envs/[name]`, and that `Investigate` can never appear where a
	 * decision is what is wanted.
	 *
	 * ── THE LABELS PASS THE NOVICE TEST ─────────────────────────────────────
	 *
	 * Every one names the OUTCOME rather than the mechanism, because a reader
	 * who has never seen this tool has to be able to predict what the button
	 * does before pressing it. `Review gates` became `See what's blocking`;
	 * `Promote` became `Deploy newest` — "promote" is a word this product uses
	 * for a concept it has not yet taught, and it is also the word a reader is
	 * least able to undo if they guess wrong.
	 *
	 * ── SIZE, AND WHY IT IS NOT `.t-button` ─────────────────────────────────
	 *
	 * `.btn` — 14px/500, `padding: 8px 16px`, radius 8 — measured off the
	 * reference page's own `View on GitHub` / `Change Version` / `Rollback`.
	 * `.t-button` is 12px and is THE REJECTED PAGES' SIZE; it may not be used
	 * for anything a reader is meant to press.
	 *
	 * ⛔ ONE FILLED PRIMARY PER LIST. `primary` is the caller's assertion that
	 * this is the single most urgent step on the page, and `/envs/[name]`
	 * already ships exactly this rule (`row.primary ? 'btn-primary' :
	 * 'btn-secondary'`). A row of buttons where every one is filled has no
	 * primary at all.
	 *
	 * ── ⭐ `href` AND `onclick` ARE NOT TWO WAYS TO WRITE THE SAME CONTROL ──
	 *
	 * (2026-09-02, from the human: *"i also don't like this investigate button
	 * / choose version that act as if they're doing something smart but are
	 * just navigating to a page. i think there's more like that."*)
	 *
	 * This component used to render both branches with the identical `.btn`
	 * class, so `Deploy newest` — which changes what is running — and `Choose
	 * a version` — which opens `/apps/<name>` — were the same mark, and the
	 * second one was the one wearing `.btn-primary`. A filled blue control
	 * promises consequence and delivered a page.
	 *
	 * The branch IS the classification, and nothing else needs to be passed:
	 *
	 * · `href` → NAVIGATION → `.nav-link`. A text link with the step's mark
	 *   and a chevron. `primary` is IGNORED here, deliberately: a destination
	 *   cannot be the page's primary action because it is not an action.
	 * · `onclick` → ACTION → `.btn`, and `primary` picks the fill.
	 *
	 * ⛔ DO NOT ADD A PROP TO OPT AN `href` BACK INTO BUTTON CHROME. If a
	 * destination feels like it needs a button to be found, the row or card
	 * around it is not reading as a destination — fix that with `.tap-zone`.
	 *
	 * ⛔ AND CHECK REDUNDANCY BEFORE REACHING FOR THIS AT ALL. Two call sites
	 * passed an `href` equal to the `.tap-link` of the row or card header they
	 * sat inside (`/environments` footers, `/envs/[name]` app rows) — a second
	 * tab stop to a destination the reader could already reach by pressing the
	 * row. Both were deleted rather than restyled.
	 */
	import {
		SearchOutline,
		RocketSolid,
		UndoOutline,
		LockOutline,
		LockOpenOutline,
		ChevronRightOutline,
		BadgeCheckOutline
	} from 'flowbite-svelte-icons';


	const STEP: Record<Step, { label: string; icon: typeof SearchOutline }> = {
		approve: { label: 'Choose a version', icon: BadgeCheckOutline },
		promote: { label: 'Deploy newest', icon: RocketSolid },
		investigate: { label: 'Investigate', icon: SearchOutline },
		rollback: { label: 'Go back a version', icon: UndoOutline },
		unblock: { label: "See what's blocking", icon: LockOutline },
		unpin: { label: 'Release the hold', icon: LockOpenOutline },
		open: { label: 'Open', icon: ChevronRightOutline }
	};

	let {
		step,
		href = null,
		onclick = null,
		primary = false,
		/** Overrides the table's label. For naming the thing: `Deploy 4.45.0-45`. */
		label = null,
		/**
		 * ⭐ WHAT THE VERB ACTS ON, FOR THE ACCESSIBLE NAME ONLY.
		 *
		 * The visible labels are deliberately short — `Open`, `Investigate`,
		 * `Choose a version` — because the row around them names the subject.
		 * A screen-reader user gets the links list and no row: dumping the
		 * accessibility tree of `/environments` on 2026-08-30 produced three
		 * links called `Open`, `Open prod` and `Choose a version` with no way to
		 * tell which environment any of them belonged to. `subject` is appended
		 * to `aria-label` and to nothing else, so not one pixel moves.
		 */
		subject = null,
		title,
		class: className = ''
	}: {
		step: Step;
		href?: string | null;
		onclick?: (() => void) | null;
		primary?: boolean;
		label?: string | null;
		subject?: string | null;
		title?: string;
		class?: string;
	} = $props();

	const spec = $derived(STEP[step]);
	const text = $derived(label ?? spec.label);
	const ariaLabel = $derived(subject ? `${text} — ${subject}` : undefined);
	const actionCls = $derived(`btn ${primary ? 'btn-primary' : 'btn-secondary'} ${className}`);
</script>

{#if href}
	<!-- NAVIGATION. No fill, no border, no `primary` — see the block above. The
	     chevron trails the words because that is which way the reader is going;
	     the step's own mark leads, so the verb still carries its icon. -->
	<a {href} class="nav-link {className}" {title} aria-label={ariaLabel}>
		{#if step !== 'open'}
			<spec.icon class="shrink-0" aria-hidden="true" />
		{/if}
		{text}
		<ChevronRightOutline class="shrink-0" aria-hidden="true" />
	</a>
{:else}
	<button
		type="button"
		class={actionCls}
		{title}
		aria-label={ariaLabel}
		onclick={() => onclick?.()}
	>
		<spec.icon class="h-4 w-4 shrink-0" aria-hidden="true" />
		{text}
	</button>
{/if}
