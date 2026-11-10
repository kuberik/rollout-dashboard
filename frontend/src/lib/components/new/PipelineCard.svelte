<svelte:options runes={true} />

<script lang="ts" module>
	/** the state of the build whose pipeline this is; it picks the header's one mark */
	export type PipelineState = 'failed' | 'deploying' | 'checking' | 'done' | 'held' | 'idle';
</script>

<script lang="ts">
	/**
	 * THE DEPLOYMENT-PIPELINE CARD SHELL (r34 shared lane S1b).
	 *
	 * ROLE: the one frame of "the steps of a deploy and what is true of it" — the rollout tab's Deployment-pipeline card
	 * (the page the owner calls best). It owns what four hand-rolled copies drew four ways (AUDIT §8: Slipway 100-186,
	 * ChangeSlipway 43-91 with a copied `.sw` stylesheet, Docket's open body 143-216, Folio's DEPLOY sub-card):
	 *   - the shell: a hung variant (`hung`: a hairline above, no box, for a pane that opens UNDER a row, which owns the
	 *     outline) or a boxed variant (`card`: 1px line, radius 8, the card surface);
	 *   - the 47px header: state mark · title · right rollup ("2/3 steps"). The mark is ONE function of `state`
	 *     (failed = red exclamation, deploying/checking = the spinner in the tone of what is in flight, done = green
	 *     check, held = the held mark, idle = the pull-request glyph), so no host draws its own;
	 *   - the split: `rail` (the step list / strand) beside the pane (`children`) from a container width `at`
	 *     (520 / 560 / 600 / 640 px of the CARD, never the viewport), stacked below it; `foot` spans both columns
	 *     (the facts + actions under the steps and their detail). Rail width is `railWidth`.
	 * WHAT STAYS WITH THE HOST: the content of the pane, the order phones want (a host may re-order the three areas with
	 * `:global(.pc-rail|.pc-pane|.pc-foot)` rules scoped under its own root class) and the facts it prints
	 * (see PipelineFacts for the label/value list).
	 * WHY CARD.svelte IS NOT USED: a Card is always boxed and its icon is a Component, not a live mark; the lead's pane hangs
	 * under a row with no box of its own, and its mark is a spinner or a held glyph.
	 * PROPORTIONS: the Overview's Deployment-pipeline card (header 47px / 12px 16px, title t-card-title, count t-ui-sm).
	 * One shell, four hosts: Slipway (/rollouts lead, /apps, /envs), ChangeSlipway (/changes/<slug> places), Docket's open
	 * failure (/needs-you), Folio (/changes lead).
	 */
	import { ExclamationCircleSolid, CheckCircleSolid, CodePullRequestSolid, ChevronDoubleRightOutline } from 'flowbite-svelte-icons';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import type { Snippet } from 'svelte';

	let {
		state: st = 'idle',
		title = 'Deployment pipeline',
		rollup = null,
		rollupAdverse = false,
		shell = 'card',
		at = 560,
		railWidth = '300px',
		label,
		rail,
		foot,
		children,
		class: className = '',
		bodyClass = '',
		railLabel = 'Pipeline steps',
		mute = false,
		...rest
	}: {
		state?: PipelineState;
		title?: string;
		/** the right-hand rollup: "2/3 steps", "7b3c9f1 · 2/2 steps" */
		rollup?: string | null;
		rollupAdverse?: boolean;
		/** `hung`: under a row (hairline above, no box); `card`: its own boxed card */
		shell?: 'hung' | 'card';
		/** container width of the CARD from which the rail sits beside the pane */
		at?: 520 | 560 | 600 | 640;
		railWidth?: string;
		/** aria-label of the region */
		label?: string;
		rail?: Snippet;
		foot?: Snippet;
		children?: Snippet;
		class?: string;
		bodyClass?: string;
		railLabel?: string;
		/** build-r4 /needs-you (additive): the header carries the pipeline's neutral role icon instead of a state mark, where the host states the failure once at full weight above the card (AD r2 #3, r3 N6) */
		mute?: boolean;
		[k: string]: unknown;
	} = $props();
</script>

<section class="pc pc-{shell} pc-at{at} {children && rail ? '' : 'pc-solo'} {mute ? 'pc-mute' : ''} {className}" style:--pc-rail={railWidth} aria-label={label ?? title} data-pipeline-card data-pc-state={st} {...rest}>
	<header class="pc-head flex min-h-[47px] items-center gap-2 border-b border-line px-4 py-3">
		{#if mute}<ChevronDoubleRightOutline class="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />
		{:else if st === 'failed'}<ExclamationCircleSolid class="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
		{:else if st === 'deploying' || st === 'checking'}<span aria-hidden="true" class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 {st === 'checking' ? 'border-progress-solid/40 border-t-progress-solid' : 'border-active-solid/40 border-t-active-solid'}"></span>
		{:else if st === 'done'}<CheckCircleSolid class="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
		{:else if st === 'held'}<StatusMark state={'held' as never} />
		{:else}<CodePullRequestSolid class="h-4 w-4 shrink-0 text-fg-subtle" aria-hidden="true" />{/if}
		<h3 class="t-card-title min-w-0 flex-1 text-fg">{title}</h3>
		{#if rollup}<span class="t-ui-sm shrink-0 whitespace-nowrap tabular-nums {rollupAdverse ? 'text-fg' : 'text-fg-subtle'}" data-pc-rollup>{rollup}</span>{/if}
	</header>
	<div class="pc-body {bodyClass}">
		{#if rail}<nav class="pc-rail" aria-label={railLabel}>{@render rail()}</nav>{/if}
		<div class="pc-pane min-w-0">{#if children}{@render children()}{/if}</div>
		{#if foot}<div class="pc-foot min-w-0">{@render foot()}</div>{/if}
	</div>
</section>

<style>
	.pc { container-type: inline-size; display: block; }
	.pc-card { overflow: hidden; border: 1px solid var(--k-line); border-radius: 8px; background: var(--k-surface); }
	.pc-hung { border-top: 1px solid var(--k-line-subtle); }
	.pc-head { background: var(--k-surface); }
	.pc-mute .pc-head > :global(svg) { color: var(--k-fg-subtle); }
	.pc-hung .pc-head { background: transparent; }
	/* r34 r2-shared: the BASE is zero-specificity (:where) so the container-query split below (0,1,0) and any host override win; a scoped `.pc-body` was (0,2,0) and beat them */
	:global(:where(.pc-body)) { display: flex; flex-direction: column; }
	.pc-rail { background: var(--k-surface); border-bottom: 1px solid var(--k-line-subtle); }
	.pc-pane:empty { display: none; }
	.pc-solo .pc-rail { border-bottom: 0; }
	/* the split from a container width. Written as ONE zero-specificity-on-the-root rule per breakpoint (:where) so a host's own grid
	   (Slipway's 'rail info / facts / act' areas, written as :global(.sw...) .pc-body) always wins by specificity, not by stylesheet order. */
	@container (min-width: 520px) { :global(:where(.pc-at520:not(.pc-solo)) .pc-body) { display: grid; grid-template-columns: var(--pc-rail) minmax(0, 1fr); grid-template-areas: 'rail pane' 'foot foot'; } :global(:where(.pc-at520:not(.pc-solo)) .pc-rail) { grid-area: rail; border-bottom: 0; border-right: 1px solid var(--k-line-subtle); } :global(:where(.pc-at520:not(.pc-solo)) .pc-pane) { grid-area: pane; } :global(:where(.pc-at520:not(.pc-solo)) .pc-foot) { grid-area: foot; } }
	@container (min-width: 560px) { :global(:where(.pc-at560:not(.pc-solo)) .pc-body) { display: grid; grid-template-columns: var(--pc-rail) minmax(0, 1fr); grid-template-areas: 'rail pane' 'foot foot'; } :global(:where(.pc-at560:not(.pc-solo)) .pc-rail) { grid-area: rail; border-bottom: 0; border-right: 1px solid var(--k-line-subtle); } :global(:where(.pc-at560:not(.pc-solo)) .pc-pane) { grid-area: pane; } :global(:where(.pc-at560:not(.pc-solo)) .pc-foot) { grid-area: foot; } }
	@container (min-width: 600px) { :global(:where(.pc-at600:not(.pc-solo)) .pc-body) { display: grid; grid-template-columns: var(--pc-rail) minmax(0, 1fr); grid-template-areas: 'rail pane' 'foot foot'; } :global(:where(.pc-at600:not(.pc-solo)) .pc-rail) { grid-area: rail; border-bottom: 0; border-right: 1px solid var(--k-line-subtle); } :global(:where(.pc-at600:not(.pc-solo)) .pc-pane) { grid-area: pane; } :global(:where(.pc-at600:not(.pc-solo)) .pc-foot) { grid-area: foot; } }
	@container (min-width: 640px) { :global(:where(.pc-at640:not(.pc-solo)) .pc-body) { display: grid; grid-template-columns: var(--pc-rail) minmax(0, 1fr); grid-template-areas: 'rail pane' 'foot foot'; } :global(:where(.pc-at640:not(.pc-solo)) .pc-rail) { grid-area: rail; border-bottom: 0; border-right: 1px solid var(--k-line-subtle); } :global(:where(.pc-at640:not(.pc-solo)) .pc-pane) { grid-area: pane; } :global(:where(.pc-at640:not(.pc-solo)) .pc-foot) { grid-area: foot; } }
</style>
