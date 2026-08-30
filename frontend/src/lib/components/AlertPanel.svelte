<svelte:options runes={true} />

<script lang="ts">
	import type { Snippet, Component } from 'svelte';
	import {
		ExclamationCircleSolid,
		InfoCircleSolid,
		PauseSolid,
		HeartSolid
	} from 'flowbite-svelte-icons';

	type Severity = 'error' | 'warning' | 'info' | 'pinned';

	/**
	 * ⭐ THIS IS THE PRODUCT'S FILLED BANNER. Do not build a second one.
	 *
	 * It is the object rollout detail renders its schedule gate in — a
	 * full-width amber field, a 40px circular icon, a bold headline
	 * (*"Deployments currently blocked"*), a second line carrying the concrete
	 * consequence (*"Will be allowed in 1d 3h (8/31/2026, 1:00:00 PM)"*) and a
	 * chip on the right. `COMPOSITION-GRAMMAR.md` §4 names it as what
	 * *"attention pulled by design, not text"* actually looks like, against
	 * the neutral gray row-band that shipped on `/apps` and `/environments`
	 * and that the human said *"feels like a bug"*.
	 *
	 * A FILL AT BANNER SCALE IS LEGITIMATE. The `area x chroma` ink ceiling
	 * was derived for MARKS COMPETING ON A ROW and does not govern a
	 * page-level banner. It still governs chips: `alarm` remains the only
	 * chip with a fill.
	 *
	 * USE IT FOR THE PAGE'S ONE BLOCKING FACT, and only that. A page with
	 * three banners has no banner.
	 */
	interface Props {
		severity?: Severity;
		title: string;
		message?: string;
		footnote?: string;
		quoted?: boolean;
		icon?: Component;
		pulse?: boolean;
		actions?: Snippet;
		extra?: Snippet;
		/**
		 * LAYOUT ONLY — the outer margin. Defaults to `mb-4`, which is right
		 * when the banner sits inside a card stack and wrong when a page needs
		 * its own rhythm above the first card. Never pass colour: the severity
		 * palette is the whole point of the component.
		 */
		class?: string;
	}

	let {
		severity = 'info',
		title,
		message,
		footnote,
		quoted = false,
		icon,
		pulse = false,
		actions,
		extra,
		class: className = 'mb-4'
	}: Props = $props();

	/**
	 * ⛔ THE ALPHA LADDER IS GONE FROM THE MESSAGE AND THE FOOTNOTE IN LIGHT,
	 * AND IT IS NOT COMING BACK. Measured pixel-wise off a screenshot (the
	 * container is a GRADIENT, so `getComputedStyle` on an ancestor reports
	 * `transparent` and every earlier number computed against the page ground
	 * was wrong), all four severities, 1440:
	 *
	 *   light   icon 2.57-3.69 | message 3.34-4.20 | footnote 2.35-3.11
	 *   dark    icon 6.17-6.78 | message 5.68-6.08 | footnote 3.58-3.83
	 *
	 * There is NO alpha that works in light: `<hue>-700` at 95% over the
	 * `<hue>-50/100` gradient is still only 4.46:1, under the 4.5 floor. So
	 * the message and the footnote are the FULL 700 step in light and the
	 * ladder is carried by SIZE (16px/700 bold title, 14px message, 12px
	 * footnote), which is the ladder the reference page's own cards use.
	 * In dark the alpha still has headroom and is kept, raised 55% -> 70% on
	 * the footnote (3.58 -> ~5.8).
	 *
	 * The ICON is the 700 step in light too: `<hue>-600` on the `<hue>-200`
	 * disc measured 2.57 (warning) and 2.65 (pinned), under the 3:1 non-text
	 * floor — the disc is a FILL, so the glyph is competing with a mid-ramp
	 * ground, not with white. Dark (`<hue>-300` on the `<hue>-500/20` disc)
	 * was already 6.2-6.8 and is untouched.
	 *
	 * ZERO NEW COLOUR VALUES: every step used here is one the product already
	 * spends.
	 */
	const palette = $derived.by(() => {
		switch (severity) {
			case 'error':
				return {
					container:
						'bg-gradient-to-r from-red-100 via-red-50 to-red-100 shadow-2xl shadow-red-200/60 ring-1 ring-red-300/60 dark:from-red-950 dark:via-red-900 dark:to-red-950 dark:shadow-red-950/50 dark:ring-red-800/60',
					glowA: 'bg-red-400/8 dark:bg-red-500/10',
					glowB: 'bg-red-300/10 dark:bg-red-400/8',
					ping: 'bg-red-500/30 dark:bg-red-500/40',
					iconWrap: 'bg-red-200 ring-2 ring-red-400/60 dark:bg-red-500/20 dark:ring-red-500/50',
					iconColor: 'text-red-700 dark:text-red-300',
					title: 'text-red-900 dark:text-white',
					message: 'text-red-900 dark:text-red-200/75',
					footnote: 'text-red-900 dark:text-red-200/70',
					quoteBorder: 'border-red-400/60 dark:border-red-500/40',
					defaultIcon: ExclamationCircleSolid
				};
			case 'warning':
				return {
					container:
						'bg-gradient-to-r from-amber-100 via-amber-50 to-amber-100 shadow-2xl shadow-amber-200/60 ring-1 ring-amber-300/60 dark:from-amber-950 dark:via-amber-900 dark:to-amber-950 dark:shadow-amber-950/50 dark:ring-amber-800/60',
					glowA: 'bg-amber-400/8 dark:bg-amber-500/10',
					glowB: 'bg-amber-300/10 dark:bg-amber-400/8',
					ping: 'bg-amber-500/25 dark:bg-amber-500/30',
					iconWrap:
						'bg-amber-200 ring-2 ring-amber-400/60 dark:bg-amber-500/20 dark:ring-amber-500/50',
					iconColor: 'text-amber-700 dark:text-amber-300',
					title: 'text-amber-900 dark:text-white',
					message: 'text-amber-900 dark:text-amber-200/75',
					footnote: 'text-amber-900 dark:text-amber-200/70',
					quoteBorder: 'border-amber-400/60 dark:border-amber-500/40',
					defaultIcon: ExclamationCircleSolid
				};
			case 'pinned':
				return {
					container:
						'bg-gradient-to-r from-orange-100 via-orange-50 to-orange-100 shadow-2xl shadow-orange-200/60 ring-1 ring-orange-300/60 dark:from-orange-950 dark:via-orange-900 dark:to-orange-950 dark:shadow-orange-950/50 dark:ring-orange-800/60',
					glowA: 'bg-orange-400/8 dark:bg-orange-500/10',
					glowB: 'bg-orange-300/10 dark:bg-orange-400/8',
					ping: 'bg-orange-500/25 dark:bg-orange-500/30',
					iconWrap:
						'bg-orange-200 ring-2 ring-orange-400/60 dark:bg-orange-500/20 dark:ring-orange-500/50',
					iconColor: 'text-orange-700 dark:text-orange-300',
					title: 'text-orange-900 dark:text-white',
					message: 'text-orange-900 dark:text-orange-200/75',
					footnote: 'text-orange-900 dark:text-orange-200/70',
					quoteBorder: 'border-orange-400/60 dark:border-orange-500/40',
					defaultIcon: PauseSolid
				};
			case 'info':
			default:
				return {
					container:
						'bg-gradient-to-r from-blue-100 via-blue-50 to-blue-100 shadow-2xl shadow-blue-200/60 ring-1 ring-blue-300/60 dark:from-blue-950 dark:via-blue-900 dark:to-blue-950 dark:shadow-blue-950/50 dark:ring-blue-800/60',
					glowA: 'bg-blue-400/8 dark:bg-blue-500/10',
					glowB: 'bg-blue-300/10 dark:bg-blue-400/8',
					ping: 'bg-blue-500/25 dark:bg-blue-500/30',
					iconWrap: 'bg-blue-200 ring-2 ring-blue-400/60 dark:bg-blue-500/20 dark:ring-blue-500/50',
					iconColor: 'text-blue-700 dark:text-blue-300',
					title: 'text-blue-900 dark:text-white',
					message: 'text-blue-900 dark:text-blue-200/75',
					footnote: 'text-blue-900 dark:text-blue-200/70',
					quoteBorder: 'border-blue-400/60 dark:border-blue-500/40',
					defaultIcon: InfoCircleSolid
				};
		}
	});

	const Icon = $derived(icon ?? palette.defaultIcon);
</script>

<div class={className}>
	<div class="relative overflow-hidden rounded-xl {palette.container}">
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			<div class="absolute -top-10 -right-10 h-48 w-48 rounded-full {palette.glowA} blur-3xl"></div>
			<div
				class="absolute -bottom-6 left-1/4 h-32 w-32 rounded-full {palette.glowB} blur-2xl"
			></div>
		</div>

		<div
			class="relative flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:gap-x-8 sm:px-6 sm:py-5"
		>
			<!--
				⭐ THE ICON IS ALIGNED TO THE HEADLINE'S LINE BOX, NOT TO THE TEXT
				BLOCK'S CENTRE. This is a two-row grid, not a flex row, and that is
				the whole fix.

				THE DEFECT, MEASURED AT 390 ON `/versions`: the icon's centre sat
				**87px below the headline's centre** (icon 294, headline 207). A
				`flex items-center` row centres a 40px glyph against WHATEVER the text
				column happens to be — one line on desktop, five lines on a phone — so
				the icon floated beside the middle of the paragraph, pointing at a
				sentence it does not belong to. It reads as broken because it is.

				THIS IS A RECURRENCE. The identical defect was fixed days earlier on
				`/apps/[name]`'s `!` glyph — a glyph centred against a multi-line
				sentence — and it came back here because the fix was made on the PAGE
				and not on the SHARED OBJECT. It is fixed in the component now, so
				every page that renders a banner (`/`, `/apps`, `/apps/[name]`,
				`/environments`, `/envs/[name]`, `/versions`, `/versions/<rev>`,
				rollout detail via `ScheduleStatus`) gets it and none can lose it.

				HOW: column 1 row 1 is an empty stretched cell — the grid row's own
				height, which IS the headline's line box (or taller, if `extra` chips
				wrap into it). The 40px disc is absolutely positioned at that cell's
				`top: 50%`, so it centres on the HEADLINE whether the message below is
				zero lines or five. The disc contributes no height, so it can never
				push the headline off its own baseline; it overflows symmetrically
				into the 16-20px of banner padding, which is where the reference page
				puts it too.
			-->
			<div class="grid min-w-0 flex-1 grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4">
				<div class="relative col-start-1 row-start-1 w-10">
					<!-- `top-3` IS THE HEADLINE'S HALF-LEADING, NOT A NUDGE. The title is
					     always `text-base` — 16px on a 24px line box — so 12px is the
					     centre of its FIRST LINE, and the disc is translated back by its
					     own half-height onto exactly that point. Deliberately not
					     `top-1/2`: this row also holds the `extra` chips, which wrap onto
					     a second line at 390, and half of a wrapped row is not the
					     headline either. -->
					<div class="absolute top-3 left-0 h-10 w-10 -translate-y-1/2">
						{#if pulse}
							<div class="absolute inset-0 animate-ping rounded-full {palette.ping}"></div>
						{/if}
						<div
							class="relative flex h-10 w-10 items-center justify-center rounded-full {palette.iconWrap}"
						>
							<Icon class="h-6 w-6 {palette.iconColor}" />
						</div>
					</div>
				</div>
				<div class="col-start-2 row-start-1 flex min-w-0 flex-wrap items-center gap-2">
					<p class="text-base font-bold tracking-tight {palette.title}">{title}</p>
					{#if extra}{@render extra()}{/if}
				</div>
				{#if message || footnote}
					<div class="col-start-2 row-start-2 min-w-0">
						{#if message}
							{#if quoted}
								<blockquote
									class="mt-1.5 border-l-2 pl-3 text-sm break-words italic {palette.message} {palette.quoteBorder}"
								>
									{message}
								</blockquote>
							{:else}
								<p class="mt-0.5 text-sm break-words {palette.message}">{message}</p>
							{/if}
						{/if}
						{#if footnote}
							<p class="mt-1 text-xs break-words {palette.footnote}">{footnote}</p>
						{/if}
					</div>
				{/if}
			</div>

			{#if actions}
				<div class="flex items-center gap-3 sm:shrink-0">
					{@render actions()}
				</div>
			{/if}
		</div>
	</div>
</div>
