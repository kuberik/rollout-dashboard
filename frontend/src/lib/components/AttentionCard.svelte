<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ATTENTION CARD (r39). ONE card for "this needs a person" on Home, Changes and Rollouts (it plays the roles
	 * NeedsYouCard rows and new/HoldingCard's approvals used to play; those stay for the pages not yet moved).
	 * Reference: the r39 kit `attentionCard()` (home-a9 `.icard` for the figure-led form, rail-d `.ac` for the title-led form).
	 *
	 * ANATOMY, top to bottom: status line (mark · word · "for 9h" · tier chip right) → the lead → the one fact → [identity row
	 * · drawing · change line] → actions. NEUTRAL finish: no tint, no gradient; state is the mark and the state word's ink.
	 *
	 *   figure-led  (a measured fact exists: `model.figure`)  8.2 % error rate / 5 of 6 prod regions, then a check line
	 *   title-led   (no measurement)                          the change title 18/600 + the check name: message (`checkFact`)
	 *   compact     status · lead · fact · actions only (Rollouts' band; the strand lives on the row below)
	 *
	 * Actions: Roll back is the outline, Approve the one blue (ApproveButton), the secondary an outlined "Open rollout ›".
	 * The whole card is a cover link; buttons sit above it. What the lead IS lives in view-models/attention.ts (unit-tested).
	 * Bands: `AttentionBand` below in this file's sibling `AttentionBand.svelte`.
	 */
	import { ExclamationCircleSolid, UndoOutline, ChartLineUpOutline, UsersGroupOutline, CodeBranchOutline } from 'flowbite-svelte-icons';
	import type { Snippet } from 'svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import ApproveButton from '$lib/components/new/ApproveButton.svelte';
	import { envTheme } from '$lib/components/new/rollout-view';
	import type { ApprovalTarget } from '$lib/components/new/data';
	import type { AttentionModel } from '$lib/view-models/attention';
	import { atoms } from '$lib/components/atoms/atoms-context';
	import RegionMeter from '$lib/components/atoms/RegionMeter.svelte';

	type Identity = { name: string; ref?: string; title?: string; person?: string; you?: boolean };
	let {
		model,
		href,
		id,
		lead = false,
		compact = false,
		drawing,
		meter,
		approve = null,
		approveFallbackHref,
		rollbackHref,
		openHref,
		openLabel = 'Open rollout',
		note,
		class: className = ''
	}: {
		model: AttentionModel;
		/** the cover link (the rollout / change the card is about) */
		href: string;
		id: Identity;
		/** the band's lead card: figure at the large step */
		lead?: boolean;
		compact?: boolean;
		/** the object's environment row (PromotionLane, neutral) */
		drawing?: Snippet;
		/** a drawing under the figure in place of the threshold gauge */
		meter?: Snippet;
		/** Needs your approval: what Approve releases (acts in place) */
		approve?: ApprovalTarget | null;
		approveFallbackHref?: string;
		/** Failing: where Roll back goes (the tab's rollback entry) */
		rollbackHref?: string;
		/** the outlined secondary "Open rollout ›" */
		openHref?: string;
		openLabel?: string;
		/** one quiet line under the fact: what else is true of this app here (a Failing card's newer build waiting upstream) */
		note?: string;
		class?: string;
	} = $props();

	const failed = $derived(model.state === 'failed');
	/* r42 atom: the approval's ratio figure ("5 of 6 prod regions") counted as a region meter */
	const AT = atoms();
	const ratio = $derived(AT.regions && model.figure?.kind === 'ratio' ? { k: Number(model.figure.value), n: Number(/of (\d+)/.exec(model.figure.unit)?.[1] ?? 0) } : null);
	const fig = $derived(model.figure);
	const hasActions = $derived(failed ? !!rollbackHref || !!openHref : !!approve || !!approveFallbackHref || !!openHref);
	const label = $derived(id.title || id.name);
	/* the tier chip names its place the way every env chip does: "prod-eu-west", a folded set "5 prod regions" (Chip splits it into the tinted tier + neutral place halves) */
	const tierLabel = $derived(!model.place ? model.tier : /^\d+ regions?$/.test(model.place) ? model.place.replace(/ (regions?)$/, ` ${model.tier} $1`) : `${model.tier}-${model.place}`);
</script>

{#snippet status()}
	<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
		<span class="inline-grid shrink-0"><StatusMark state={failed ? 'failed' : 'approval'} /></span>
		<span class="t-meta font-semibold {failed ? 'text-danger' : 'text-held'}" data-word>{model.word}</span>
		{#if model.forAge}<span class="t-meta tabular-nums text-fg-subtle">· {model.forAge}</span>{/if}
		{#if model.tier}<span class="ml-auto shrink-0"><Chip role="env" theme={envTheme(model.tier)} label={tierLabel} wide /></span>{/if}
	</div>
{/snippet}

{#snippet factLine(cls: string)}
	{#if model.fact}
		<p class="{cls} min-w-0">
			{#if fig}<span class="inline-flex shrink-0 text-fg-subtle">{#if failed}<ChartLineUpOutline class="h-3.5 w-3.5" aria-hidden="true" />{:else}<UsersGroupOutline class="h-3.5 w-3.5" aria-hidden="true" />{/if}</span>{/if}
			<span class="min-w-0 {compact ? 'line-clamp-2' : fig ? 'truncate' : ''}" title="{model.fact.name ? model.fact.name + ': ' : ''}{model.fact.message}">{#if model.fact.name}<b class="font-medium text-fg">{model.fact.name}{model.fact.message ? ':' : ''}</b>{/if}{#if model.fact.message}{model.fact.name ? ' ' : ''}{model.fact.message}{/if}</span>
		</p>
	{/if}
{/snippet}

{#snippet noteLine()}
	{#if note}<p class="t-meta min-w-0 text-fg-subtle" data-note>{note}</p>{/if}
{/snippet}

{#snippet actions()}
	{#if hasActions}
		<div class="ac-act relative z-[1] mt-auto flex shrink-0 flex-wrap items-center gap-2">
			{#if failed}
				{#if rollbackHref}<a href={rollbackHref} class="btn btn-secondary" data-action="rollback"><UndoOutline class="h-4 w-4" aria-hidden="true" />Roll back</a>{/if}
			{:else}
				<ApproveButton target={approve} fallbackHref={approveFallbackHref} class="btn btn-primary" icon />
			{/if}
			{#if openHref}<a href={openHref} class="btn btn-secondary">{openLabel} ›</a>{/if}
		</div>
	{/if}
{/snippet}

{#snippet figure()}
	{#if fig}
		<div class="min-w-0">
			<div class="flex min-w-0 items-baseline gap-2.5 whitespace-nowrap" data-lead={fig.kind}>
				<span class="ac-fig font-semibold tabular-nums tracking-[-0.025em] text-fg {lead ? 'ac-fig--lead' : ''}">{fig.value}{#if fig.unit}<small class="ml-0.5 whitespace-pre font-normal text-fg-muted {lead ? 'text-lg' : 'text-base'}">{fig.unit.startsWith('of ') ? ' ' : ''}{fig.unit}</small>{/if}</span>
				<span class="t-body min-w-0 truncate text-fg-muted">{fig.label}</span>
			</div>
			{#if meter}
				<div class="mt-2" data-meter>{@render meter()}</div>
			{:else if ratio && ratio.n > 1}
				<div class="mt-2.5 flex" data-meter><RegionMeter class="flex-1" k={ratio.k} n={ratio.n} ink={failed ? 'danger' : 'held'} label="{ratio.k} of {ratio.n} {fig.label}" /></div>
			{:else if fig.gauge}
				<div class="relative mt-2 h-1 rounded-full bg-subtle" role="img" aria-label="{fig.value}{fig.unit} against the limit" data-gauge>
					<span class="absolute inset-y-0 left-0 rounded-full {fig.gauge.over ? 'bg-danger' : 'bg-fg-disabled'}" style:width="{Math.round(fig.gauge.fill * 100)}%"></span>
					<span class="absolute -inset-y-0.5 w-px bg-fg-muted" style:left="{fig.gauge.limitAt * 100}%"></span>
				</div>
			{/if}
		</div>
	{/if}
{/snippet}

{#snippet identity()}
	<div class="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-3">
		<AppGlyph name={id.name} size={24} class="shrink-0" />
		<span class="t-card-title min-w-0 truncate text-fg">{id.name}</span>
		{#if drawing}<div class="min-w-0 flex-[1_1_240px]">{@render drawing()}</div>{/if}
	</div>
{/snippet}

{#snippet changeLine()}
	{#if id.title || id.ref}
		<p class="t-meta flex min-w-0 flex-1 items-center gap-2 text-fg-muted">
			{#if id.person && !id.you}<Avatar name={id.person} size={16} /><span class="whitespace-nowrap font-medium text-fg">{id.person}</span>{:else}<CodeBranchOutline class="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-hidden="true" /><b class="whitespace-nowrap font-medium text-fg">{id.you ? 'Your change' : 'Change'}</b>{/if}
			{#if id.ref}<span class="t-code shrink-0 text-fg-subtle">{id.ref}</span>{/if}
			{#if id.title}<span class="min-w-0 truncate">{id.title}</span>{/if}
		</p>
	{/if}
{/snippet}

<article class="ac relative flex min-w-0 flex-col rounded-lg border border-line bg-surface {className}" class:ac-lead={lead} data-item data-state={model.state} data-variant={fig ? (compact ? 'figure-compact' : 'figure') : compact ? 'compact' : 'title'}>
	<a {href} class="absolute inset-0 z-0 rounded-lg" aria-label={label}></a>
	{#if fig}
		<div class="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5">
			{@render status()}
			{@render figure()}
			{@render factLine('t-meta flex items-center gap-2 text-fg-subtle')}
			{@render noteLine()}
			{#if compact}{@render actions()}{/if}
		</div>
		{#if !compact}
			<div class="flex flex-col gap-3 border-t border-line px-4 py-3 sm:px-5 sm:py-4">
				{@render identity()}
				<div class="ac-foot flex min-w-0 items-center gap-3">
					{@render changeLine()}
					{#if hasActions}{@render actions()}{/if}
				</div>
			</div>
		{/if}
	{:else}
		<div class="flex flex-1 flex-col {compact ? 'gap-2.5 p-4' : 'gap-3.5 p-4 sm:p-5'}">
			{@render status()}
			{#if model.title}<h3 class="ac-title text-fg">{model.title}</h3>{/if}
			{#if !compact}
				<div class="t-meta flex min-w-0 items-center gap-2 text-fg-subtle">
					<AppGlyph name={id.name} size={20} class="shrink-0" /><b class="truncate font-medium text-fg-muted">{id.name}</b>{#if id.ref}<span class="t-code shrink-0">{id.ref}</span>{/if}{#if id.person && !id.you}<span aria-hidden="true">·</span><span class="inline-flex min-w-0 items-center gap-1.5"><Avatar name={id.person} size={16} /><span class="truncate">{id.person}</span></span>{/if}
				</div>
			{/if}
			{@render factLine('t-body flex items-baseline gap-2 text-fg-muted')}
			{@render noteLine()}
			{#if drawing && !compact}<div class="min-w-0">{@render drawing()}</div>{/if}
			{@render actions()}
		</div>
	{/if}
</article>

<style>
	.ac { container-type: inline-size; }
	.ac :global(.btn) { position: relative; z-index: 1; }
	@container (max-width: 520px) {
		.ac-foot { flex-direction: column; align-items: stretch; }
		.ac-foot .ac-act { width: 100%; }
		.ac-foot .ac-act :global(.btn) { flex: 1; }
	}
	.ac-fig { font-size: 32px; line-height: 40px; }
	.ac-fig--lead { font-size: 40px; line-height: 48px; }
	.ac-title { font-size: 18px; line-height: 26px; font-weight: 600; letter-spacing: -0.012em; }
	@media (max-width: 639px) {
		.ac-title { font-size: 17px; line-height: 24px; }
		.ac-fig, .ac-fig--lead { font-size: 32px; line-height: 36px; }
		.ac-act { width: 100%; }
		.ac-act :global(.btn) { flex: 1; height: 44px; }
	}
</style>
