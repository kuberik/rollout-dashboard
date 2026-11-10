<svelte:options runes={true} />

<script lang="ts">
	import EmptyGlyph from './EmptyGlyph.svelte';
	import { UserOutline } from 'flowbite-svelte-icons';
	/**
	 * THE STATUS MARK — one family for a leading status column. (Design
	 * language, Home redesign 2; art direction round 2.)
	 *
	 * ROLE: the 16px mark at the start of a row that says the row's state, so
	 * a column of them scans in one vertical pass. Every state that needs a
	 * person or is in flight is the SAME object: a 16px circle in its status
	 * tint with a 1px status line, holding a 10px stroke glyph in its ink —
	 * failed / stuck "!", held a thin pause, deploying a turning arc, checking a
	 * clock hand. Healthy is quieter on purpose: the 6px rest dot (RestGlyph's size) in the same
	 * 16px slot. Nothing yet: a dashed ring.
	 *
	 * WHY: the column mixed filled 16px "!" discs, a 16px spinner ring, 8px
	 * dots and a bare outline gate — four treatments for one job. Proportions:
	 * the 16px glyph slot and 1px line of the Overview's health rows, the
	 * tint/line pair of a status chip.
	 */
	import type { NodeState } from '$lib/view-models/promotion-lanes';

	let {
		state,
		label = undefined,
		resolved = false,
		tone = undefined,
		progress = null
	}: {
		/**
		 * r42 atom "Progress mark" (opt-in, /design/atoms; nothing passes it yet): 0..1 of the act in flight, drawn INSIDE
		 * the checking / deploying mark as a pie in the state's solid (the clock hand / turning arc it replaces). Checking =
		 * bake elapsed / bake time; deploying = steps done / steps. Reference: Linear's in-progress status glyph (ring + pie)
		 * and its assignee progress ring (16px, 1.5px stroke, figure beside). Ignored for every other state.
		 */
		progress?: number | null;
		/** r34 build-r4 (additive, /changes AD r1 #2): `held` draws the approval glyph in held ink ("waits for YOU"); default = the fg ink. */
		tone?: 'held' | 'neutral';
		/**
		 * `approval`: held on a PERSON (an approval only someone can give), not
		 * the orange pause of a rule hold that clears by itself. An unfilled
		 * 16px circle, a 1.5px line in the strongest ink (`--k-fg`) and the
		 * outline person glyph: home-map's `.pm-ask-mark` (9f80a88c) — a
		 * request, not a running state, so no tint. No new tokens.
		 */
		state: NodeState | 'approval';
		label?: string;
		/** A failed state that is no longer the rollout's current one: history,
		 *  not alarm. Keeps the "!" glyph (it WAS a failure) but drops every
		 *  hue — neutral ring, neutral fill, same ink the row's own resolved
		 *  verb uses (coordinator ruling 2026-10-10: red only while a failure
		 *  is the current state). Only meaningful for `state: 'failed'`. */
		resolved?: boolean;
	} = $props();

	const RING: Partial<Record<NodeState, string>> = {
		// Failed is the ONE solid disc (palette AD r3): the tint read as a pale
		// pink 10px mark in light, the faintest red on screen for the loudest
		// state. White "!" on danger-solid: 4.33:1 light, 3.40:1 dark (≥3:1 for
		// a graphic); the disc against its ground 4.16 / 4.87.
		failed: 'bg-danger-solid ring-danger-solid text-white',
		stuck: 'bg-warning-tint ring-warning-line text-warning',
		held: 'bg-held-tint ring-held-line text-held',
		deploying: 'bg-active-tint ring-active-line text-active',
		// Checking: the line in the solid so the mark doesn't read olive in dark.
		checking: 'bg-progress-tint ring-progress-solid text-progress'
	};
	const RESOLVED_RING = 'bg-subtle ring-line text-fg-subtle';
	const pie = $derived(progress != null && (state === 'checking' || state === 'deploying') ? Math.max(0, Math.min(1, progress)) : null);
	/** the pie's path in a 16-unit box: centre (8,8), r 4.25, clockwise from 12 o'clock */
	const piePath = $derived.by(() => {
		if (pie == null || pie <= 0) return '';
		if (pie >= 1) return 'M8 3.75a4.25 4.25 0 1 1 0 8.5a4.25 4.25 0 1 1 0-8.5Z';
		const a = pie * 2 * Math.PI, r = 4.25;
		const x = 8 + r * Math.sin(a), y = 8 - r * Math.cos(a);
		return `M8 8V3.75A${r} ${r} 0 ${pie > 0.5 ? 1 : 0} 1 ${x.toFixed(3)} ${y.toFixed(3)}Z`;
	});
	const ring = $derived(state === 'approval' ? undefined : resolved ? RESOLVED_RING : RING[state]);
</script>

<span class="relative inline-flex h-4 w-4 shrink-0 items-center justify-center" title={label}>
	{#if state === 'approval'}
		<span class="sm-ask inline-flex h-4 w-4 items-center justify-center rounded-full {tone === 'held' ? 'sm-ask-held text-held' : tone === 'neutral' ? 'sm-ask-neutral text-fg-muted' : 'text-fg'}">
			<UserOutline class="h-3 w-3" aria-hidden="true" />
		</span>
	{:else if pie != null}
		<!-- r42 progress mark: the state's tint disc + 1px solid line (as the plain mark), the pie in the solid -->
		<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" class="sm-pm {state === 'deploying' ? 'sm-pm-active' : 'sm-pm-progress'}">
			<circle cx="8" cy="8" r="7.5" class="sm-pm-disc" />
			<path d={piePath} class="sm-pm-pie" />
		</svg>
	{:else if ring}
		<span class="inline-flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-inset {ring}">
			{#if state === 'held'}
				<!-- Held, a thin pause at the "!"'s optical weight (AD held v3): bars
				     ~8px of the 16px circle, 3px apart, 1.5px stroke. -->
				<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
					<path d="M9 5.5v13M15 5.5v13" />
				</svg>
			{:else}
			<svg
				width="10"
				height="10"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
				stroke-linejoin="round"
				class={state === 'deploying' ? 'sm-spin' : ''}
				aria-hidden="true"
			>
				{#if state === 'failed' || state === 'stuck'}
					<path d="M12 6v7M12 18h.01" />
				{:else if state === 'deploying'}
					<path d="M12 4a8 8 0 1 1-8 8" />
				{:else}
					<path d="M12 7v5l3 2" />
				{/if}
			</svg>
			{/if}
		</span>
	{:else if state === 'none'}
		<EmptyGlyph />
	{:else if state === 'behind'}
		<!-- Behind: a hollow neutral ring, never the green of "on the newest"
		     (home-map r5: the two read as one state on a phone Fleet list). -->
		<span class="h-2 w-2 rounded-full ring-[1.5px] ring-inset ring-fg-subtle"></span>
	{:else}
		<span class="h-1.5 w-1.5 rounded-full bg-success-solid"></span>
	{/if}
	{#if label}<span class="sr-only">{label}</span>{/if}
</span>

<style>
	.sm-ask {
		box-shadow: inset 0 0 0 1.5px var(--k-fg);
	}
	/* r34 build-r4 (/changes AD r2 F, additive): the approval glyph gets a wash so it reads at 12-15px: held tint + held ring for YOUR approval, a neutral wash for one someone else gives */
	.sm-ask-held { background-color: var(--k-held-tint); box-shadow: inset 0 0 0 1px var(--k-held-line); }
	.sm-ask-neutral { background-color: var(--k-subtle); box-shadow: inset 0 0 0 1px var(--k-line-strong); }
	.sm-pm-progress { --pm-tint: var(--k-progress-tint); --pm-solid: var(--k-progress-solid); }
	.sm-pm-active { --pm-tint: var(--k-active-tint); --pm-solid: var(--k-active-solid); }
	.sm-pm-disc { fill: var(--pm-tint); stroke: var(--pm-solid); stroke-width: 1; }
	.sm-pm-pie { fill: var(--pm-solid); }
	/* light: the yellow solid on its pale tint is too faint for a 16px pie; the darker ink carries it (dark keeps the solid) */
	:global(html:not(.dark)) .sm-pm-progress .sm-pm-pie { fill: var(--k-progress-fg); }
	.sm-spin {
		animation: sm-spin 1.2s linear infinite;
	}
	@keyframes sm-spin {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sm-spin {
			animation: none;
		}
	}
</style>
