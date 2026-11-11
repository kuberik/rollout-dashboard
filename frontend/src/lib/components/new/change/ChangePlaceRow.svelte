<script lang="ts">
	/**
	 * A PLACE OF THE CHANGE (r34 r4, "Where it runs" card) — ONE row anatomy for every place the change touches, keyed by the PLACE,
	 * drawn UNDER ITS BUILD's subheader (ChangeDetail groups the rows by build, so the row carries no build of its own any more).
	 * REFERENCE: the premium-changes mock's place row (mark 16 · env badge · state word in its ink · "· detail" meta · age 48 · chevron 28)
	 * and RolloutRow (the same mark column, the same `Roll back` / `Approve` controls, the Slipway hung under the open lead).
	 * WHY NOT RolloutRow ITSELF: it leads with the APP name and has no at-rest / not-affected state.
	 * STATE WORDS: "Deployed" (+ "· 5 builds behind" / "· Up to date"), "Checking · 1 of 2 steps" / "Deploying · 2 of 6 steps", "Failed · Check",
	 * "Waiting for approval" / "Held" (the cause is the banner's and the pane's, AD r5 N3), "Not reached · 1 build behind" (an older build of the same line), "Not affected" (a custom / pinned build) (its build is the subheader's; no age: a build that is not the change's is no fact about it).
	 * MARKS: healthy spends no hue (the 6px rest dot /rollouts' at-rest rows wear); failed / held / moving keep StatusMark (state hue). The state word
	 * is 14/500 in the state's ink (failed red, deploying blue, checking amber), neutral otherwise.
	 * `also`: the other places that wait for the SAME build for the same reason: ONE approval row (the Needs-you pattern) naming the first region and "+N"
	 * (one tap shows every badge; the row then takes two lines), so the state word keeps its column. PHONE: line 1 = mark · chip · age · chevron, line 2 = the state (at most two lines collapsed).
	 */
	import ApproveButton from '../ApproveButton.svelte';
	import { approvalTarget } from '../data';
	import { approvalWord } from '../state-words';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import { UndoOutline, ChevronDownOutline } from 'flowbite-svelte-icons';
	import ChangeSlipway from './ChangeSlipway.svelte';
	import { ago, noSourceOf, type HomeState } from '../data';
	import { envTheme, markOf, rowAction, actionHref } from '../rollout-view';
	import { actionWords } from '../change-view';
	import { behindWords, restSteps, envFull, notReached, type Place } from './detail-model';

	let { place: p, scenario = 'incident', open = false, canOpen = false, landed = false, multiApp = false, reserve = false, also = [], inStatement = false, changeCommit = null, omitTitle = null }: { place: Place; scenario?: HomeState; open?: boolean; canOpen?: boolean; landed?: boolean; multiApp?: boolean; /** the list has action buttons: every row keeps the action track so ages share one x */ reserve?: boolean; /** the other places folded into this approval row */ also?: Place[]; /** the statement above already carries this place's actions */ inStatement?: boolean; /** the change's own commit, for the opened pane */ changeCommit?: { title: string; author: string | null } | null; /** the page title, which the pane's Commit row must not repeat */ omitTitle?: string | null } = $props();
	let shut = $state<boolean | null>(null);
	const row = $derived(p.row);
	const na = $derived(p.kind === 'unaffected');
	const isOpen = $derived(canOpen && !na && (shut ?? open));
	const action = $derived(row ? rowAction(row) : null);
	const steps = $derived(row?.steps ?? restSteps(p.app, scenario, p.href));
	const doneN = $derived(steps.filter((s) => s.state === 'done').length);
	const behind = $derived(p.newerFails ? '' : behindWords(p.app, p.href, scenario));
	const failStep = $derived(steps.find((s) => s.state === 'fail')?.name ?? 'Check');
	const moving = $derived(p.kind === 'running' && !!row && (row.state === 'deploying' || row.state === 'checking'));
	const age = $derived(ago(p.at ?? p.since));
	const newerFail = $derived(p.kind === 'running' && !!p.newerFails);
	const mark = $derived(na ? 'none' : newerFail ? 'failed' : p.kind === 'waiting' ? 'held' : p.kind === 'running' && !moving ? 'rest' : row ? markOf(row) : 'rest');
	const newerFailStep = $derived(p.tabRow?.steps.find((s) => s.state === 'fail')?.name ?? 'Check');
	/* no release source: no lag words at all (not "Up to date", not "N behind") */
	const cur = $derived(newerFail || moving || noSourceOf(p.href) ? '' : behind === 'on the newest' ? 'Up to date' : behind);
	const reach = $derived(notReached(p, scenario));
	const all = $derived([p, ...also]);
	const grouped = $derived(also.length > 0);
		let allChips = $state(false);
	const label = $derived(action ? (action.kind === 'approve' ? 'Approve' : actionWords(action, row)) : '');
	/* the state word's ink = the state's hue (one meaning per hue); healthy and not-affected spend none */
	const ink = $derived(newerFail || p.kind === 'failed' ? 'text-danger' : p.kind === 'waiting' ? 'text-held' : moving ? (row?.state === 'checking' ? 'text-progress' : 'text-active') : na ? 'text-fg-muted' : 'text-fg');
	/* AD r1 (2, 4, 7): the STATE WORD is the tab's one word for the state (Deployed / Checking / Deploying / Failed / Waiting for approval / Held / Not affected);
	   everything else is the 12px muted detail: the failed step, the step count, the currency, the hold's cause (holdWord) */
	const word = $derived(newerFail || p.kind === 'failed' ? 'Failed' : p.kind === 'waiting' ? (row?.group === 'approval' ? approvalWord(!!row?.needsYou) : 'Held') : na ? (p.replacedFrom ? 'Replaced' : reach !== null ? 'Not reached' : 'Not affected') : moving ? (row?.state === 'checking' ? 'Checking' : 'Deploying') : 'Deployed');
	const detail = $derived(newerFail ? `at ${newerFailStep} · newer than this change's ${p.carried}` : p.kind === 'failed' ? `at ${failStep}` : p.kind === 'waiting' ? '' : na ? (p.replacedFrom ? `by ${p.current}` : (reach ?? '')) : moving ? `${doneN} of ${steps.length} steps` : cur);
</script>

<li class="min-w-0" data-truth-kind="place" data-truth-href={p.href} data-truth-place={p.label} data-truth-carry={p.kind} data-open={open ? '' : undefined}>
	<div class="pr {reserve ? 'pr-act' : ''} {allChips ? 'pr-group' : ''} tap-zone px-4 py-3 transition-colors hover:bg-hover">
		<span class="pr-mark flex h-5 items-center justify-center">{#if mark === 'rest'}<span class="h-1.5 w-1.5 rounded-full bg-fg-disabled" role="img" aria-label="Deployed"></span>{:else}<StatusMark state={mark as never} />{/if}</span>
		<span class="pr-chip flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{#each all as q, i (q.href)}<a href={q.href} class="tap-link max-sm:-my-3 max-sm:py-3 {i > 0 && !allChips ? 'hidden' : ''}"><Chip role="env" theme={envTheme(q.tier)} label={envFull(q.tier, q.label)} /></a>{/each}{#if all.length > 1 && !allChips}<!-- AD r2 (3): the other regions fold into "+N" so the state word stays on its column; one tap shows them all --><button type="button" class="t-meta relative z-[1] inline-flex min-h-11 min-w-11 items-center justify-center px-1 text-fg-muted hover:text-fg sm:min-h-0 sm:min-w-0" aria-label="Show all {all.length} regions" onclick={() => (allChips = true)}>+{all.length - 1}</button>{/if}{#if multiApp}<span class="t-meta inline-flex min-w-0 items-center gap-1 text-fg-muted"><AppGlyph name={p.app} size={16} class="shrink-0" /><span class="truncate">{p.app}</span></span>{/if}</span>
		<span class="pr-word dot-list min-h-5 min-w-0"><span class="dot-list-row flex min-w-0 items-baseline">
			<span class="t-ui whitespace-nowrap {ink}" data-place-word>{word}</span>
			{#if detail}<span class="t-meta min-w-0 truncate text-fg-subtle" data-place-detail>{detail}</span>{/if}
		</span></span>
		<span class="pr-age t-meta flex h-5 items-center justify-end whitespace-nowrap tabular-nums text-fg-subtle" title="the age of this place's current deploy, as its tab prints it">{na ? '' : age}</span>
		{#if action && !isOpen}<span class="pr-go flex items-center justify-end">{#if action.kind === 'approve' && row}<ApproveButton target={approvalTarget(row, scenario)} fallbackHref={actionHref(action)} />{:else}<a href={actionHref(action)} class="btn btn-secondary btn-xs relative z-[1]">{#if action.kind === 'rollback'}<UndoOutline class="h-4 w-4" aria-hidden="true" />{/if}{label}</a>{/if}</span>{/if}
		<span class="pr-tog flex items-center justify-end">{#if canOpen && !na}<button type="button" class="relative z-[1] inline-flex h-7 w-7 items-center justify-center rounded text-fg-subtle hover:bg-hover hover:text-fg max-sm:-mr-2 max-sm:h-11 max-sm:w-11 max-sm:shrink-0" aria-expanded={isOpen} aria-label={isOpen ? 'Hide pipeline' : 'Show pipeline'} data-pipeline-toggle onclick={() => (shut = isOpen ? false : true)}><ChevronDownOutline class="h-4 w-4 transition-transform {isOpen ? 'rotate-180' : ''}" aria-hidden="true" /></button>{/if}</span>
	</div>

	{#if isOpen}
		<ChangeSlipway place={p} {scenario} {landed} {inStatement} {changeCommit} {omitTitle} />
	{/if}
</li>

<style>
	/* tracks: mark | place | state | age | (action) | chevron. Below 480 (and for a folded multi-region row) the state takes line 2 at the chip's x. */
	.pr { display: grid; column-gap: 8px; row-gap: 2px; align-items: center; text-align: left; grid-template-columns: 16px minmax(0, 1fr) auto 28px; grid-template-areas: 'mark chip age tog' '. word word tog'; }
	.pr-mark { grid-area: mark; width: 16px; } .pr-chip { grid-area: chip; } .pr-word { grid-area: word; margin-bottom: 0; padding-bottom: 0; } .pr-age { grid-area: age; } .pr-go { grid-area: go; justify-self: end; } .pr-tog { grid-area: tog; align-self: center; }
	.pr-act { grid-template-areas: 'mark chip age tog' '. word word tog' '. go go tog'; }
	.pr-act .pr-go { margin-top: 4px; }
	@media (max-width: 639px) { .pr-go a { min-height: 44px; height: 44px; padding: 0 14px; font-size: 14px; line-height: 20px; } .pr { padding-block: 8px; } }
	@container (min-width: 480px) {
		.pr { grid-template-columns: 16px auto minmax(0, 1fr) 48px 28px; column-gap: 12px; grid-template-areas: 'mark chip word age tog'; min-height: 28px; }
		.pr-act { grid-template-columns: 16px auto minmax(0, 1fr) 48px 148px 28px; grid-template-areas: 'mark chip word age go tog'; }
		.pr-act .pr-go { margin-top: 0; }
		.pr-group { grid-template-columns: 16px minmax(0, 1fr) 48px 28px; grid-template-areas: 'mark chip age tog' '. word word tog'; }
		.pr-group.pr-act { grid-template-columns: 16px minmax(0, 1fr) 48px 148px 28px; grid-template-areas: 'mark chip age go tog' '. word word word tog'; }
	}
	/* from 600px of card width the badge column is a fixed track (160px: the widest badge, "PROD eu-central", is 121px, plus a folded row's "+N"), so every state word starts at one x (AD r1 8, r3 3); below it the column hugs the badge (AD r2 5); from 900 it is the tab's 176px */
	@container (min-width: 600px) {
		.pr { grid-template-columns: 16px 160px minmax(0, 1fr) 48px 28px; }
		.pr-act { grid-template-columns: 16px 160px minmax(0, 1fr) 48px 148px 28px; }
	}
	@container (min-width: 900px) {
		.pr { grid-template-columns: 16px 176px minmax(0, 1fr) 48px 28px; }
		.pr-act { grid-template-columns: 16px 176px minmax(0, 1fr) 48px 148px 28px; }
	}
</style>
