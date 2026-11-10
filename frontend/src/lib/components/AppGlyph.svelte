<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE APP GLYPH — which app, before you read its name. (Home v2,
	 * CRAFT-STUDY P5.)
	 *
	 * ROLE: the leading identity mark of an APP wherever apps are listed or
	 * named as subjects: Home's fleet rows and Needs-you rows, activity
	 * sentences ("… promoted [CA] checkout-api …"), the Promotion Map's
	 * packets. A lettered rounded square in the app's own hue
	 * (`app-identity.ts` has the hue rule: six hues clear of every status and
	 * environment hue, and a chroma cap below every status colour).
	 *
	 * WHY NOTHING EXISTING FITS: `StatusMark` is a STATE (a disc, a hue that
	 * means something), `Avatar` is a PERSON (round, neutral), `Chip
	 * role="env"` is an ENVIRONMENT (outlined name + dot). An app needed a
	 * fourth shape that cannot be mistaken for any of them: SQUARE (radius 6
	 * at 20, 4 at 16 — the button/input radius, a child of the 8px card),
	 * lettered, never a dot.
	 *
	 * Proportions: the 20px row lead is `Avatar`'s 20; 24 a header; 32 a tile
	 * (Linear's initiative glyph, Vercel's project mark). It is decoration in
	 * the a11y sense (`aria-hidden`): the app's NAME is always printed beside it.
	 */
	import { appIdentity, appHueIndex } from '$lib/app-identity';
	import { monogramFor } from '$lib/components/app-monogram.svelte';

	type Size = 16 | 20 | 24 | 32;
	let { name, size = 20, class: className = '' }: { name: string; size?: Size; class?: string } = $props();

	const id = $derived(appIdentity(name));
	const monogram = $derived(monogramFor(name));
	const hueIdx = $derived(appHueIndex(name));
	// r39 (owner 2026-11-08): coloured monograms again, 8 calm hues (language.css .app-glyph.id0-7); supersedes r34's neutral.
	// 12/600 at 32 and 24, 10/600 at 20 and 16 (two letters at 11 leave under 2px clearance on "MW").
	const FONT: Record<Size, number> = { 16: 9, 20: 10, 24: 12, 32: 12 };
	const TRACK: Record<Size, string> = { 16: '-0.04em', 20: '-0.04em', 24: '0', 32: '0' };
	const RADIUS: Record<Size, number> = { 16: 4, 20: 6, 24: 6, 32: 8 };
</script>

<span
	class="app-glyph id{hueIdx} inline-flex shrink-0 items-center justify-center select-none {className}"
	style="width: {size}px; height: {size}px; border-radius: {RADIUS[size]}px; font-size: {FONT[size]}px; letter-spacing: {TRACK[size]}"
	aria-hidden="true"
	data-app-hue={id.hue}
	data-pending={monogram === null ? '' : undefined}>{monogram ?? ''}</span
>

<style>
	.app-glyph {
		font-family: var(--font-sans);
		font-weight: 600;
		line-height: 1;
		background: linear-gradient(180deg, var(--id-field-top), var(--id-field));
		color: var(--id-ink);
		box-shadow: inset 0 0 0 1px var(--id-edge);
	}
</style>
