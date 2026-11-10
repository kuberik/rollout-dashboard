<script lang="ts">
	/**
	 * r34 builds-lag (B) — ONE PLACE inside the Sounding ledger (AppBuilds): the line that stands under the build the place runs.
	 * ROLE: where this app runs and in what state. It is no longer a card of its own (the old "Places" card repeated the build, the
	 * age and the currency that Builds said again; the merge is explained in AppBuilds). WHY NOT RolloutRow: its second line is one
	 * free-text cause; here the state word, the hold and the time sit in aligned tracks (owner §7). Everything else is RolloutRow's:
	 * mark rule, env chip (a link to the place's tab), the Slipway pipeline opened under the row, truth attributes.
	 * Slots >= 560 container: mark 16 | chip 168 | state word 168 | note 1fr | time in state 64 (container >= 640, the 1440 main column) | Approve btn-xs | chevron.
	 * Phone (owner §5): mark | chip + state word (wrap, never clipped) | chevron: build, age, title and the rest sit on the build row above.
	 * The build row owns the lag; `note` only exists when this place's own tab disagrees with the stop (placeNote).
	 */
	import ApproveButton from '../ApproveButton.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import HeldGlyph from '$lib/components/HeldGlyph.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { ChevronDownOutline, CheckOutline } from 'flowbite-svelte-icons';
	import Slipway from '../Slipway.svelte';
	import { ago, approvalTarget, deployedBuild, truthAttrs, type TRow, type HomeState, type PlaceHold } from '../data';
	import { markOf, envTheme, tabEnv, actionHref } from '../rollout-view';
	import { placeWord } from './app-model';

	let { row, place, pinned = false, note = null, approve = null, open = false, nested = false, toggle = null, hs = 'incident', slipAction = null }: { row: TRow; place: PlaceHold; pinned?: boolean; note?: string | null; /** the Approve this place owns (>= 640 only; the phone's lives in the banner) */ approve?: TRow['action']; open?: boolean; nested?: boolean; toggle?: (() => void) | null; hs?: HomeState; slipAction?: TRow['action'] } = $props();

	const age = $derived(ago(deployedBuild(row)?.at ?? row.since));
	const word = $derived(placeWord(place, pinned, !!row.needsYou));
	const label = $derived(tabEnv(row) === 'production' ? 'prod' : tabEnv(row));
	/** "wave 2" / "wave 1 · leader" / "follows eu-west-1": only where the tier has several waves (or a follower), so a one-wave tier prints nothing. */
	const waveFact = $derived.by(() => {
		const w = place.wave;
		if (!w || w.site === '') return null;
		if (!w.leader) return `follows ${w.follows ?? 'its leader'}`;
		return w.multi ? `wave ${w.wave}` : null;
	});
	const adverse = $derived(row.group === 'failed' || row.group === 'approval');
</script>

<li class="min-w-0" {...truthAttrs(row)} data-truth-kind="rollout" data-truth-group={row.group} data-truth-app={row.app} data-truth-href={row.href} data-open={open ? '' : undefined}>
	<div class="pl tap-zone px-4 transition-colors hover:bg-hover" data-place-row>
		<span class="pl-mark flex h-5 items-center">{#if pinned}<HeldGlyph size={16} class="text-fg-muted" title="Held by the pin" />{:else if row.group === 'rest'}<span class="flex h-5 w-4 items-center justify-center"><span class="h-1.5 w-1.5 rounded-full bg-fg-disabled"></span></span>{:else if markOf(row) === 'held'}<HeldGlyph size={16} class="text-fg-muted" title="Held" />{:else}<StatusMark state={markOf(row)} />{/if}</span>
		<span class="pl-mid">
			<a href={row.href} class="tap-link pl-chip flex min-w-0 items-center" aria-label="{row.app} in {label}"><Chip role="env" theme={envTheme(row.tier)} {label} wide /></a>
			<span class="pl-word t-ui-sm min-w-0 truncate {adverse ? 'text-fg' : 'text-fg-muted'}" data-place-word>{word}{#if waveFact}<span class="t-meta ml-1 text-fg-subtle" data-place-wave>· {waveFact}</span>{/if}</span>
			<span class="pl-note t-meta min-w-0 truncate text-fg-subtle" data-place-currency={note ? '' : undefined}>{note ?? ''}</span>
			<span class="pl-since t-meta whitespace-nowrap text-right tabular-nums text-fg-subtle">{age}</span>
		</span>
		<span class="pl-act">{#if approve}<ApproveButton target={approvalTarget(row, hs)} fallbackHref={actionHref(approve)} icon class="btn btn-secondary btn-xs gap-2 max-sm:hidden" />{/if}</span>
		{#if toggle}<button type="button" class="pl-tog relative z-[1] flex h-7 w-7 items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg max-sm:h-11" aria-expanded={open} aria-label="{open ? 'Hide' : 'Show'} the deployment pipeline of {row.app} in {label}" onclick={toggle}><ChevronDownOutline class="h-4 w-4 transition-transform {open ? 'rotate-180' : ''}" aria-hidden="true" /></button>{:else}<span class="pl-tog"></span>{/if}
	</div>
	{#if open}<!-- r2 apps fix 8: the opened pipeline HANGS as an inset panel (the Slipway's bounded nested card, 16px in from the ledger's edges and level with the place's text), a surface step below its row, never a full-width card header glued to the ledger -->
		<div class="relative z-[1] bg-subtle"><div class="py-3 pr-4 pl-12"><Slipway {row} {hs} nested compact action={slipAction} /></div></div>{/if}
</li>

<style>
	/* phone: mark | chip + word (wrap) | chevron; text starts at the build row's text x (48) */
	.pl { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto 28px; column-gap: 12px; align-items: center; min-height: 36px; padding-block: 4px; padding-left: 48px; }
	/* round 2 B6: the chip has a fixed track so every row's state word starts at the same x (DEV and STAGING are different widths) */
	.pl-mid { display: grid; grid-template-columns: 88px minmax(0, 1fr); align-items: center; column-gap: 8px; row-gap: 2px; min-width: 0; }
	/* phone: the word may wrap inside its track ("Waiting for approval" is never cut to "Waiting for app…") */
	.pl-word { white-space: normal; overflow: visible; text-overflow: clip; }
	.pl-note, .pl-since { display: none; }
	.pl-note:empty { display: none; }
	.pl-mark { grid-column: 1; } .pl-mid { grid-column: 2; } .pl-act { grid-column: 3; display: flex; justify-content: flex-end; } .pl-tog { grid-column: 4; justify-self: end; margin-block: -8px; margin-right: -6px; }
	@container (min-width: 560px) {
		.pl-word { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.pl { grid-template-columns: 16px minmax(0, 1fr) auto 28px; padding-block: 2px; min-height: 32px; }
		.pl-mid { display: grid; grid-template-columns: 168px 144px minmax(0, 1fr); column-gap: 8px; }
		.pl-note { display: block; }
		.pl-note:empty { display: block; }
		.pl-tog { margin-block: 0; margin-right: -6px; }
	}
	/* the time in state is a 1440-only column: it needs a main column of ~700px (the rail takes the rest at 1280+) */
	@container (min-width: 640px) {
		.pl-mid { grid-template-columns: 168px 144px minmax(0, 1fr) 64px; } /* QA #19: the state word needs ~140px; the note column gets the rest, never a squeezed "U…" */
		.pl-since { display: block; }
	}
</style>
