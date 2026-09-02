<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⛔ DEPRECATED SHIM. `Chip` IS THE JOINED BADGE. DO NOT ADD A CALLER.
	 * (2026-09-02)
	 *
	 * This file used to be a SECOND implementation of the joined `[label][value]`
	 * badge, built on Flowbite `Badge` — 12px text, `px-2.5 py-0.5`, `rounded-lg`
	 * — i.e. one of the eight badge geometries `Chip` was written to replace,
	 * still shipping inside the reference page. Two components drew one idea.
	 * That is the duplicate-mechanism class this branch has now collapsed five
	 * times, most recently `AppPromotionFlowCanvas` into `GraphCanvas`.
	 *
	 * ── WHAT IT DID THAT `Chip` COULD NOT, AND WHAT HAPPENED TO EACH ─────────
	 *
	 *  1. A GLYPH IN THE LABEL HALF (`BakeStatusIcon`). Real, and the only real
	 *     one. `Chip` now takes an `icon` snippet, which is what makes this file
	 *     collapsible; the glyph renders in the same 20px box at the same 6px
	 *     padding as every other chip in the product.
	 *
	 *  2. A COLOURED VALUE HALF (`valueColor`, keyed on bake status). NOT kept,
	 *     and it was never load-bearing: the label half already carries
	 *     `BakeStatusIcon`, which IS the coloured status disc, so the hue was
	 *     printed twice inside one box, 40px apart. That is the exact defect that
	 *     deleted `.chip-dot` on 2026-08-27 (*"we have stuck which has its own dot
	 *     which is also useless"*). `Chip`'s standing invariant is that the value
	 *     half is the IDENTIFIER and the label half is the STATE; this component
	 *     had them the wrong way round.
	 *
	 *  3. `large`, `href` + an `ArrowUpRightFromSquareOutline` tail, `labelBorder`,
	 *     `labelPlainBorder`, `labelClass`, `valueClass`. EIGHT OF TWELVE PROPS
	 *     WERE UNUSED at the only call site. `href` is the one with a behaviour
	 *     difference — it opened a new tab and drew an external-link arrow; `Chip`
	 *     links the value half in place. Nothing passes it.
	 *
	 * ── THE ONE CALL SITE, AND HOW TO DELETE THIS FILE ──────────────────────
	 *
	 * `routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte` ~line 2058, the
	 * release-candidate rows. Replace with:
	 *
	 *     <Chip
	 *       role="count"
	 *       label="{depInfo.env} env"
	 *       value={bakeWord(depInfo.bakeStatus)}
	 *       valueTitle={bakeTitle(depInfo.bakeStatus)}
	 *       title={bakeTitle(depInfo.bakeStatus)}
	 *       wide
	 *     >
	 *       {#snippet icon()}
	 *         <BakeStatusIcon bakeStatus={depInfo.bakeStatus} size="small" />
	 *       {/snippet}
	 *     </Chip>
	 *
	 * — then delete this file and its import. It is pure mechanics; it is left
	 * undone only because that route is owned by another pass right now.
	 *
	 * ⚠️ IT RENDERS ON NOTHING. Probed on the running cluster, all 15 rollouts
	 * across both clusters at 1440: **zero** occurrences. Its call site is gated
	 * on `releaseCandidates` AND an Environment whose `relationship.type` is
	 * `After`, which no rollout in the dev fleet currently satisfies. So the
	 * pixel risk of this change is zero and the deletion above is safe to do
	 * blind — but it also means nobody has LOOKED at this badge in a long time,
	 * which is how it survived five geometry passes.
	 */
	import type { Snippet } from 'svelte';
	import Chip from './Chip.svelte';

	interface Props {
		label: string;
		value: string;
		icon?: Snippet;
		/** ⛔ IGNORED — see (2) above. The glyph already carries the hue. */
		valueColor?: 'green' | 'red' | 'yellow' | 'blue' | 'gray' | 'purple' | 'pink' | 'indigo';
		/** ⛔ IGNORED — `.chip` has one size, deliberately. */
		large?: boolean;
		/** ⛔ IGNORED — nothing passes it. Use `Chip`'s `valueHref` directly. */
		href?: string;
		containerClass?: string;
		containerStyle?: string;
		/** ⛔ IGNORED — colour belongs to the role, not to the call site. */
		labelClass?: string;
		/** ⛔ IGNORED — `.chip` always draws its hairline. */
		labelBorder?: boolean;
		/** ⛔ IGNORED — `.chip` always draws its hairline. */
		labelPlainBorder?: boolean;
		/** ⛔ IGNORED — colour belongs to the role, not to the call site. */
		valueClass?: string;
		/** Hover/AT text for the whole pair — e.g. the sentence behind a one-word state. */
		title?: string;
	}

	let {
		label,
		value,
		icon,
		valueColor: _valueColor = 'gray',
		large: _large = false,
		href: _href,
		containerClass = '',
		containerStyle,
		labelClass: _labelClass = '',
		labelBorder: _labelBorder = false,
		labelPlainBorder: _labelPlainBorder = false,
		valueClass: _valueClass = '',
		title
	}: Props = $props();
</script>

<span class="inline-flex items-center {containerClass}" style={containerStyle}>
	<Chip role="count" {label} {value} valueTitle={title} {title} {icon} wide />
</span>
