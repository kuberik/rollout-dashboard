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
	 *
	 * `alert` is a THIRD tone, not a replacement for `banner`: `ChangeVersion
	 * Modal`'s override list sits inside a flowbite `Alert` — a flat tint, not
	 * a gradient — where a neutral value clears contrast easily. (F10, design
	 * pass 2 re-check) With `banner`, the label, the value AND the prose
	 * above them were all one undifferentiated red — "four inks at equal
	 * emphasis". Here only the LABEL stays in the alert's own ink (still
	 * `currentColor`, so it moves with `red`/`yellow`); the value takes the
	 * `card` tone's neutral ink, so the record reads as a record rather than
	 * as more of the same red sentence.
	 */
	type Tone = 'card' | 'banner' | 'alert';

	const TONES: Record<Tone, { label: string; value: string; handle: string }> = {
		card: {
			label: 'text-gray-500 dark:text-gray-400',
			value: 'text-gray-900 dark:text-white',
			handle: 'text-gray-500 dark:text-gray-400'
		},
		banner: { label: '', value: '', handle: '' },
		alert: {
			label: '',
			value: 'text-gray-700 dark:text-gray-300',
			handle: 'text-gray-700 dark:text-gray-300'
		}
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

	/**
	 * ⛔ `break-all` WAS CHARACTER-LEVEL WRAP, AND IT SHIPPED
	 * `dependenc / y-hello-f / rontend-n / eeds-api`. (F17, 2026-09-03,
	 * `/envs/prod` at 390.) A generated k8s name is a run of short tokens
	 * joined by `-` and `/`; the reader can follow a wrap at one of those
	 * joints and cannot follow one mid-word. `.ident` (`app.css`,
	 * `overflow-wrap: normal; word-break: keep-all; hyphens: none` —
	 * generalised design pass 7, finding #14, for every identifier renderer
	 * in the product) on the `<dd>` below refuses to break anywhere else,
	 * and this only offers the boundaries that already mean something — the
	 * delimiter stays attached to the chunk it ends, so a `<wbr>` between
	 * chunks is a wrap opportunity, never a mid-character split.
	 */
	function handleParts(value: string): string[] {
		return value.split(/(?<=[-/])/);
	}

	/**
	 * ⭐ THE LABEL COLUMN COLLAPSES WHEN THE RECORD IS NARROW — MEASURED WITH
	 * A `ResizeObserver`, NOT `container-type`. (F17, 2026-09-03)
	 *
	 * `grid-cols-[auto_1fr]` sizes the label column to the widest `<dt>`
	 * across every row — fine at the popover's own 22rem, and a defect the
	 * moment the same `<dl>` renders inside a 390 banner: `RULE` took ~90px
	 * of a ~300px record, leaving the identifier a column too narrow to hold
	 * one token. That called for a size query, and `container-type:
	 * inline-size` was the first attempt — and it broke the host it landed
	 * in. `RulePopover`'s mobile panel is `self-stretch` inside a
	 * `<details class="flex flex-col items-start">` (load-bearing: see that
	 * component's own note on why `items-start` is there at all) —
	 * `align-self: stretch` fills the flex container's cross size, but
	 * `container-type: inline-size` implies containment, and a contained
	 * descendant reports NO intrinsic size to the sizing pass that resolves
	 * `stretch`. Measured live on `/envs/prod`: the panel — with `<details>`
	 * sitting right next to it at 227px — collapsed to **26px**, its own
	 * padding and border and nothing else. Deleting `container-type` and
	 * nothing else on the same DOM restored 227px immediately; that is the
	 * whole diagnosis, not a guess.
	 *
	 * A `ResizeObserver` measures without containing: it does not change
	 * what this element reports upward, so the ancestor's `stretch` still
	 * resolves against the real flex container width, and `narrow` reflects
	 * the width `stretch` actually produced.
	 */
	let wrapperEl: HTMLDivElement | undefined = $state();
	let narrow = $state(false);

	$effect(() => {
		if (!wrapperEl) return;
		const el = wrapperEl;
		const ro = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width;
			if (width !== undefined) narrow = width > 0 && width < 260;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});
</script>

{#if facts.length > 0}
	<!-- See `narrow`'s note above for why this is a `ResizeObserver`, not a
	     `@container` query. -->
	<div bind:this={wrapperEl} class={className}>
		<dl
			class="grid gap-x-3 gap-y-1 {narrow ? 'grid-cols-1' : 'grid-cols-[auto_1fr]'}"
			class:gap-y-0.5={narrow}
		>
			{#each facts as f, i (`${f.label}-${i}`)}
				<dt class="t-label {ink.label}">{f.label}</dt>
				{#if f.handle}
					<!-- A HANDLE IS DRESSED AS ONE: mono, and wrapped only at its own
					     `-`/`/` joints (see `handleParts` above) so a name wider than
					     the column wraps AT A TOKEN, not through one. -->
					<dd class="ident t-code-sm min-w-0 {ink.handle}">
						{#each handleParts(f.value) as part, pi (pi)}{part}{#if pi < handleParts(f.value).length - 1}<wbr
								/>{/if}{/each}
					</dd>
				{:else}
					<dd class="t-micro min-w-0 break-words {ink.value}">{f.value}</dd>
				{/if}
			{/each}
		</dl>
	</div>
{/if}
