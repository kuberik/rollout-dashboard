<script lang="ts">
	/**
	 * THE CHANGE'S OPENED OBJECT (r34 v2 CD r4) — the Slipway's two panes (the tab's Deployment-pipeline card: step rail │ the step's
	 * detail) hung under the lead place of a CHANGE, showing the CHANGE's build, not the place's.
	 * REFERENCE: new/Slipway.svelte (same header, TraySteps rail, p-4/p-6 pane, t-heading state title, t-code-lg build, commit title +
	 * Avatar login, secondary actions) and its proportions; the tab's card for the words and the ~150px rail.
	 * WHY NOT Slipway ITSELF: it takes a TRow and derives the build, the commit and the age from the place's DEPLOYED build, so on #90
	 * it printed 9b7e410 under a waiting f4a2c19. The page's subject is the change's build in that place: the failed build, the build
	 * that waits, or the build it runs, with the tab's commit of THAT build. Proposed Slipway prop that would retire this file:
	 * `build?: { build; relation; commit; since; title; facts }` (everything `openedOf` returns).
	 * ORDER (CE9/CE11): steps first, then ONE column of state → check → the change's build (the 20 mono) → commit → one facts line →
	 * actions; two columns only past 960px (state, check, build │ commit, facts). Nothing nests: the failed check is the FailedCheckLine
	 * in a subtle box, not a third card, and the tab's Health-checks / Check-timer inset is NOT repeated (the tab owns it, one click away).
	 * `inStatement`: the page's statement above already carries Open rollout / Approve for this place, so the pane does not repeat them.
	 */
	import { approveAct } from '../approvals.svelte';
	import { approvalTarget } from '../data';
	import { UndoOutline, ChevronDownOutline } from 'flowbite-svelte-icons';
	import FailedCheckLine from '$lib/components/FailedCheckLine.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import TraySteps from '../TraySteps.svelte';
	import ActRow, { type Act } from '$lib/components/ActRow.svelte';
	import PipelineCard from '../PipelineCard.svelte';
	import { avatarSrc, type HomeState } from '../data';
	import { actionHref, actionLabel, rowAction, VIEWER } from '../rollout-view';
	import { openedOf, type Place } from './detail-model';

	let { place: p, scenario = 'incident', landed = false, inStatement = false, changeCommit = null, omitTitle = null, class: className = '' }: { place: Place; scenario?: HomeState; landed?: boolean; inStatement?: boolean; /** changedetail-10 CF2: THIS change's commit (its first build's head), the pane's "Commit" while a NEWER build waits */ changeCommit?: { title: string; author: string | null } | null; /** AD r1 (13): the page's title; a Commit row that would only repeat it (and its author, whom the header names) is not drawn */ omitTitle?: string | null; class?: string } = $props();
	const o = $derived(openedOf(p, scenario, landed));
	const row = $derived(p.row);
	const failing = $derived(o.state === 'failed');
	const compact = $derived(o.state === 'rest');
	const action = $derived(row && !failing ? rowAction(row) : null);
	const fr = $derived(failing ? row?.failure ?? null : null);
	const check = $derived(fr ? { name: fr.check ?? fr.line, message: fr.check ? (fr.message ?? undefined) : undefined } : null);
	const done = $derived(o.steps.filter((s) => s.state === 'done').length);
	/* CF2: a waiting build's head is the NEXT build's commit, not this change's: the pane's Commit is the change's own (as on #37 / #14) */
	const commit = $derived(o.state === 'waiting' ? changeCommit : o.commit);
	const own = $derived(commit?.author === VIEWER);
	/* changedetail-8 CD7: nothing but the toggle sits under "Show details" when the pane has no actions and the details are shut */
	const showActions = $derived(!inStatement);
	/* owner 2026-11-02 §5: below 640 the pane is the state title and its age; the check, the build, the commit and the facts are one tap away */
	let more = $state(false);
	const hide = $derived(more ? '' : 'max-sm:hidden');
	/* the pane's actions (content only; ActRow lays them out): the decision leads on a phone, the rollout link is the side */
	const acts = $derived<Act[]>([
		...(showActions ? [{ label: 'Open rollout', href: p.href, key: 'cs-open' } as Act] : []),
		...(action && showActions ? [action.kind === 'approve' ? (approveAct(row ? approvalTarget(row, scenario) : null, { lead: true, key: 'cs-action' }) ?? { label: 'Approve', href: actionHref(action), lead: true, key: 'cs-action' }) : { label: actionLabel(action), href: actionHref(action), icon: action.kind === 'rollback' ? UndoOutline : undefined, lead: true, key: 'cs-action' } as Act] : [])
	]);
</script>

<PipelineCard shell="hung" at={560} railWidth="208px" class="sw {compact ? 'sw-compact' : ''} {className}" state={failing ? 'failed' : o.state === 'waiting' ? 'held' : o.state === 'moving' ? (row?.state === 'checking' ? 'checking' : 'deploying') : 'done'} rollup="{done}/{o.steps.length} steps" label="Deployment pipeline of {p.app} in {p.label}" data-slipway="" data-change-slipway="" data-state={o.state}>
	{#snippet rail()}<TraySteps steps={o.steps} selected={o.selected} noHoldChip />{/snippet}
		<div class="sw-pane min-w-0 sm:p-6">
			{#if o.state !== 'waiting'}<div class="sw-info min-w-0 space-y-3 max-sm:px-4 max-sm:pt-4 {inStatement && !more ? 'max-sm:hidden' : ''}">
				<!-- changedetail-9 CE7: a place at rest says "Live in eu-west" in its ROW above; the pane does not repeat it as a heading -->
				{#if !compact}<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 {inStatement && !more ? 'max-sm:hidden' : ''}">
					<h4 class="t-heading text-fg" data-slipway-title>{o.title}</h4>
					<span class="t-meta tabular-nums text-fg-subtle" data-since>{o.since}{#if o.took}&nbsp;· {o.took}{/if}</span>
				</div>{/if}
				{#if failing && check && !inStatement}
					<div class="rounded bg-subtle px-3 py-2 {hide}" data-slipway-check>
						<FailedCheckLine {check} danger />
						{#if fr?.phrase}<p class="t-meta mt-1 text-fg-muted">{fr.phrase}</p>{/if}
					</div>
				{/if}
			</div>{/if}
			<!-- changedetail-10 CF5: below 640 "Show details" is a 44px row with the same chevron the place row wears (no 12px text link floating in a band of padding) -->
			<button type="button" class="sw-more sm:hidden flex h-11 w-full items-center justify-between pl-4 pr-[23px] text-left hover:bg-hover" style="grid-area: more" aria-expanded={more} onclick={() => (more = !more)}><span class="t-ui text-fg-muted">{more ? 'Hide details' : 'Show details'}</span><ChevronDownOutline class="h-4 w-4 text-fg-subtle transition-transform {more ? 'rotate-180' : ''}" aria-hidden="true" /></button>
			<div class="sw-build min-w-0 max-sm:px-4 max-sm:pt-3 {hide}">
				<!-- P5 (owner §7): label (96px, muted) / value; the build in mono, then what to compare it with, then the build's commit -->
				<dl class="sw-dl t-ui" data-slipway-facts>
					<dt class="t-meta text-fg-subtle">Build</dt><dd class="t-code tabular-nums text-fg" data-slipway-build>{o.build}</dd>
					{#if o.relation}<dt class="t-meta text-fg-subtle">{o.relation.word === 'last healthy' ? 'Last healthy' : 'Running'}</dt><dd class="flex min-w-0 flex-wrap items-baseline"><!-- r11 CH5: a running build is labelled with its place ("Running in prod-us-east · 9b7e410 · 20h") -->{#if o.relation.word !== 'last healthy'}<span class="t-meta text-fg-subtle">in {o.relation.word.replace(/ runs$/, '')}&nbsp;·&nbsp;</span>{/if}<span class="t-code text-fg-muted">{o.relation.build}</span>{#if o.relation.age}<span class="t-meta tabular-nums text-fg-subtle">&nbsp;·&nbsp;{o.relation.age}</span>{/if}</dd>{/if}
					{#if o.rule}<dt class="t-meta text-fg-subtle">Rule</dt><dd class="t-ui flex flex-wrap items-baseline gap-x-2 text-fg" data-slipway-rule><span>{o.rule.text}</span><a href={o.rule.href} class="nav-link relative z-[1] inline-flex min-h-11 items-center sm:min-h-0">Gates<span aria-hidden="true" class="ml-1">›</span></a></dd>{/if}
					{#if o.newerBuild}<dt class="t-meta text-fg-subtle">Newer build</dt><dd class="flex min-w-0 flex-wrap items-baseline" data-slipway-newerbuild><span class="t-code text-fg-muted">{o.newerBuild.build}</span><span class="t-meta tabular-nums text-fg-subtle">&nbsp;·&nbsp;{o.newerBuild.age}</span></dd>{/if}
					{#if commit && commit.title !== omitTitle}<dt class="t-meta text-fg-subtle">Commit</dt><dd class="min-w-0" data-slipway-commit><span class="t-body block text-fg">{commit.title}</span>{#if commit.author && !own}<span class="t-meta mt-1 flex min-w-0 items-center gap-1.5 text-fg-muted"><Avatar name={commit.author} src={avatarSrc(commit.author)} size={24} /><span class="min-w-0 break-words">{commit.author}</span></span>{/if}</dd>{/if}
						{#if o.newer}<dt class="t-meta text-fg-subtle">Newer builds</dt><dd class="t-ui text-fg-muted" data-slipway-newer><span class="flex flex-wrap items-baseline gap-x-2"><span><span class="tabular-nums text-fg">{o.newer.count}</span> wait behind this</span>{#if o.newer.mine}<span class="text-fg-subtle">incl. {o.newer.mine}</span>{/if}</span></dd>{/if}
				</dl>
			</div>
			{#if showActions || action}
				<div class="sw-actions max-sm:px-4 max-sm:py-3 {hide}" data-slipway-actions><ActRow align="end" secondary={acts} /></div>
			{/if}
		</div>
</PipelineCard>

<style>
	/* the shell, header, rail|pane split and its container are PipelineCard's (.pc-*); this is the pane */
	/* phone: a plain column, so a hidden block leaves no empty grid track (and no 12px gap) behind it */
	.sw-pane { display: flex; flex-direction: column; gap: 12px; }
	@media (max-width: 639px) { .sw-pane { gap: 0; } .sw-info { padding-bottom: 8px; } }
	.sw-dl { display: grid; grid-template-columns: 96px minmax(0, 1fr); column-gap: 12px; row-gap: 12px; align-items: baseline; }
	.sw-dl dd { margin: 0; }
	.sw-info { grid-area: info; }
	.sw-build { grid-area: build; }
	.sw-actions { grid-area: act; }
	@container (min-width: 560px) { .sw-pane { display: grid; grid-template-areas: 'info' 'build' 'act'; } }
	/* changedetail-8 CD5: the facts stay UNDER the state heading at every width (no second column of blank); the actions take the right edge */
	@container (min-width: 960px) {
		.sw-pane { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'info act' 'build act'; column-gap: 32px; row-gap: 12px; align-items: start; }
		.sw-actions { justify-content: flex-end; align-self: start; }
	}
	/* compact: the rail is as tall as its steps and the pane owns the divider */
	@container (min-width: 560px) {
		:global(.sw-compact .pc-body) { align-items: start; }
		:global(.sw-compact .pc-rail) { align-self: start; border-right: 0 !important; }
		:global(.sw-compact .pc-pane) { align-self: stretch; border-left: 1px solid var(--k-line-subtle); }
	}
	:global(.sw .pc-rail li > div) { padding-left: 12px; padding-right: 8px; gap: 8px; }
	:global(.sw .pc-rail li > span[aria-hidden]) { left: 23px; }
	[data-slipway-check] :global(.check-line) { font-size: 14px; line-height: 20px; }
</style>
