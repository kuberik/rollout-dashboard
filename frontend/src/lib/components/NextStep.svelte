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
		title,
		class: className = ''
	}: {
		step: Step;
		href?: string | null;
		onclick?: (() => void) | null;
		primary?: boolean;
		label?: string | null;
		title?: string;
		class?: string;
	} = $props();

	const spec = $derived(STEP[step]);
	const text = $derived(label ?? spec.label);
	const cls = $derived(`btn ${primary ? 'btn-primary' : 'btn-secondary'} ${className}`);
</script>

{#if href}
	<a {href} class={cls} {title}>
		{#if step === 'open'}
			{text}
			<spec.icon class="h-4 w-4 shrink-0" aria-hidden="true" />
		{:else}
			<spec.icon class="h-4 w-4 shrink-0" aria-hidden="true" />
			{text}
		{/if}
	</a>
{:else}
	<button type="button" class={cls} {title} onclick={() => onclick?.()}>
		<spec.icon class="h-4 w-4 shrink-0" aria-hidden="true" />
		{text}
	</button>
{/if}
