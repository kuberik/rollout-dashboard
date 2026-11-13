<svelte:options runes={true} />

<script lang="ts">
	/**
	 * AVATAR: who did it. One component for every actor on every page.
	 *
	 * ROLE: identity before reading (CRAFT-STUDY P5). A deploy, a rollback, a
	 * change, an activity line names its actor with a face, the way Vercel,
	 * Linear and Railway put an avatar on every action. Nothing in the
	 * language drew an actor before (2026-10-09), and three squads (rollout,
	 * fleet, changes) needed one, so it is one shared contract.
	 *
	 * Kinds:
	 * - `person`: the picture when `src` is known (GitHub avatar, or the demo's
	 *   embedded data URI; never a remote URL in the demo build), otherwise a
	 *   NEUTRAL disc (raised surface, muted 11/600 initials; r34 r2-shared: the
	 *   hashed identity colour was decoration that competed with state hue).
	 *   A 2px outer ring in the host's ground keeps overlapping avatars legible.
	 * - `controller`: the system acting on its own (an automatic deploy, a
	 *   promotion): the kuberik mark, so "who" is never the word "System".
	 * - `ci`: a CI pipeline (a build, a check run): a neutral workflow glyph on
	 *   the same neutral ground, never a vendor logo.
	 *
	 * Sizes on the icon grid: 16 (a row's meta line), 20 (a row lead), 24
	 * (a header), 32 (a tile). Round, 1px `line` ring so a dark photo keeps
	 * its edge on the dark surface.
	 */
	let {
		name,
		src = null,
		kind = 'person',
		size = 16,
		class: className = ''
	}: {
		/** The login or display name; the accessible label and the monogram. */
		name: string;
		src?: string | null;
		kind?: 'person' | 'controller' | 'ci';
		size?: 16 | 20 | 24 | 32;
		class?: string;
	} = $props();

	import { monogramOf } from '$lib/app-identity';
	import LogoDark from '$lib/assets/logo-rotate-dark.svg?url';
	import LogoLight from '$lib/assets/logo-rotate-light.svg?url';

	// The fallback-disc branch below: a person with no picture to show. r34 r2-shared (AD round 2): NEUTRAL, a raised surface with
	// muted initials; the hashed identity colour was decoration that competed with state hue on every row.
	const isFallback = $derived(kind === 'person' && !src);

	// One monogram rule with AppGlyph (`monogramOf`): two letters from 20px up,
	// so "danielreed" and "dana-hill" are not both "D" in a mixed list.
	// 16px is a meta-line mark with room for one letter only.
	const initial = $derived(size <= 16 ? (name.trim()[0] ?? '?').toUpperCase() : monogramOf(name));
	const label = $derived(kind === 'controller' ? 'kuberik (automatic)' : kind === 'ci' ? `${name} (CI)` : name);
	// The monogram is a MARK inside a 16/20px circle, not running text, so the
	// two smallest sizes are the documented exception to the 11px type floor:
	// 16 draws one letter at 9px, 20 two letters at 10px (11px overflows the
	// circle). From 24px the monogram takes a type-scale step: 24 draws the
	// `t-label` size (11px), 32 the `t-ui-sm` size (12px) — no off-scale size
	// (History AD r9: 13px was not on the scale).
	// r34 r2-shared: 11/600 from 24px up; the 16px one-letter mark keeps 10 so it sits in the disc with air.
	// Visual audit #8 (2026-11-13): 20px now uses the 10px the 16px mark already draws (a glyph inside a disc, not a
	// text role, so the 11px type floor does not apply). At 11 two letters ran 13-17px wide in a
	// 20px disc, so in an overlapping AvatarStack `PS AW MC` collided into one smeared word.
	const fontPx = $derived(size <= 20 ? 10 : 11);
</script>

<span
	class="avatar inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full {isFallback
		? 'avatar-fallback'
		: 'bg-subtle'} {className}"
	style="width:{size}px;height:{size}px"
	role="img"
	aria-label={label}
	title={label}
>
	{#if kind === 'controller'}
		<img src={LogoLight} alt="" class="h-[70%] w-[70%] dark:hidden" />
		<img src={LogoDark} alt="" class="hidden h-[70%] w-[70%] dark:block" />
	{:else if kind === 'ci'}
		<svg viewBox="0 0 16 16" class="h-[62%] w-[62%] text-fg-muted" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
			><circle cx="4" cy="4" r="1.75" /><circle cx="4" cy="12" r="1.75" /><circle cx="12" cy="8" r="1.75" /><path d="M4 5.75v4.5M5.6 4.6 10.4 7.3M5.6 11.4l4.8-2.7" /></svg
		>
	{:else if src}
		<img {src} alt="" class="h-full w-full object-cover" loading="lazy" />
	{:else}
		<span class="avatar-initial" style="font-size:{fontPx}px" aria-hidden="true">{initial}</span>
	{/if}
</span>

<style>
	/* 1px inset edge keeps a dark photo's rim; the 2px OUTER ring in the host's ground separates overlapping avatars so no letter is clipped by its neighbour */
	.avatar { box-shadow: inset 0 0 0 1px var(--k-line), 0 0 0 2px var(--av-ring, var(--k-surface)); }
	.avatar-fallback { background: var(--k-raised); }
	.avatar-initial {
		color: var(--k-fg-muted);
		font-family: var(--font-sans);
		font-weight: 600;
		line-height: 1;
		letter-spacing: -0.04em;
	}
</style>
