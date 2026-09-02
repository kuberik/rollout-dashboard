<svelte:options runes={true} />

<script module lang="ts">
	/**
	 * One row of a record: the field's NAME and the field's VALUE.
	 *
	 * ⛔ `label` IS A NOUN AND `value` IS A VALUE. A row whose value is a
	 * sentence is not a field — it is prose that has been given a label to look
	 * structured, which is the failure this object exists to prevent. If the
	 * thing you have is a sentence, print it as a sentence (see `foot` on
	 * `GateRecord`, or `AlertPanel`'s own `footnote`); if it is a fact with a
	 * name, it belongs here.
	 */
	export type Fact = {
		label: string;
		value: string;
		/**
		 * A HANDLE — a Kubernetes object name, a URL path, an HTTP status. Mono,
		 * `break-all`, and muted where the tone has a muted step: it is a string
		 * you paste after `kubectl`, not a string you read.
		 */
		handle?: boolean;
	};

	/**
	 * ⭐ TWO TONES, AND THE ONLY DIFFERENCE IS WHOSE INK IT SPEAKS IN.
	 *
	 * `card`   a white card or the `RulePopover` panel — the neutral pair every
	 *          caption in the product uses.
	 * `banner` inside `AlertPanel`'s disclosure. It inherits the SEVERITY's own
	 *          ink via `currentColor`, the same way the `Details` summary above
	 *          it and a `.nav-link` in the actions row beside it already do.
	 *
	 * ⚠️ `banner` GIVES THE LABEL AND THE VALUE THE SAME INK, DELIBERATELY.
	 * `AlertPanel`'s palette note records the measurement: over its gradient
	 * ground there is NO alpha in light that clears 4.5:1 (`<hue>-700` at 95%
	 * lands on 4.46), so the ladder there is carried by SIZE and CASE — and
	 * `t-label` is 10px/600 uppercase at 0.16em against `t-micro`'s 11px
	 * sentence case, which is a wider gap than any tint would have bought.
	 */
	type Tone = 'card' | 'banner';

	const TONES: Record<Tone, { label: string; value: string; handle: string }> = {
		card: {
			label: 'text-gray-500 dark:text-gray-400',
			value: 'text-gray-900 dark:text-white',
			handle: 'text-gray-500 dark:text-gray-400'
		},
		banner: { label: '', value: '', handle: '' }
	};
</script>

<script lang="ts">
	/**
	 * ⭐ THE PRODUCT'S ONE RECORD. An aligned two-column `<dl>`, 10px uppercase
	 * label against an 11px value, `auto 1fr` so every value in a block starts
	 * on one line whatever the labels are.
	 *
	 * ── WHY IT IS A SHARED OBJECT AND NOT A `<dl>` PER CALL SITE ─────────────
	 *
	 * (2026-09-02) `RulePopover`'s two call sites each spelled their own grid,
	 * and the moment a THIRD scale needed one — `AlertPanel`'s disclosure, on
	 * ten surfaces — the product was one copy away from the failure `DESIGN.md`
	 * already names in as many words: *"a shared object copied into a second
	 * file will not receive the shared object's next fix."* That is exactly how
	 * `FailurePanel` missed `AlertPanel`'s alpha-ladder correction.
	 *
	 * ── WHAT GOES IN IT ─────────────────────────────────────────────────────
	 *
	 * FIELDS. A path, a status, an object name, an actor, a timestamp — the
	 * things that have a name and a value. Not sentences: see `Fact`.
	 *
	 * ⛔ AND ONLY WHAT THE PRINTED TIER DOES NOT ALREADY SAY. A record that
	 * repeats the line above it makes the reward for opening a control a fact
	 * already on screen, which is the complaint that produced the whole
	 * disclosure pass. THE RECORD HOLDS WHAT THE BANNER DOES NOT.
	 */
	let {
		facts,
		tone = 'card',
		class: className = ''
	}: { facts: Fact[]; tone?: Tone; class?: string } = $props();

	const ink = $derived(TONES[tone]);
</script>

{#if facts.length > 0}
	<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 {className}">
		{#each facts as f, i (`${f.label}-${i}`)}
			<dt class="t-label {ink.label}">{f.label}</dt>
			{#if f.handle}
				<!-- A HANDLE IS DRESSED AS ONE: mono, and `break-all` so a generated
				     name wider than the column wraps inside the record rather than
				     widening it. It only ever fires on a name that genuinely does
				     not fit. -->
				<dd class="t-code-sm min-w-0 break-all {ink.handle}">{f.value}</dd>
			{:else}
				<dd class="t-micro min-w-0 break-words {ink.value}">{f.value}</dd>
			{/if}
		{/each}
	</dl>
{/if}
