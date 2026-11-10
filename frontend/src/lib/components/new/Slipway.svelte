<script lang="ts">
	/**
	 * r34 v2 — THE SLIPWAY. Role: the opened lead row of /rollouts, drawn as the rollout tab's own Deployment-pipeline card
	 * (two panes: the step rail │ the step's detail) so the page's one focal object has the tab's presence — not a tinted row
	 * holding a miniature. Failing lead: the failed step selected, "Deployment failed", the failing check in an inset, the
	 * build in focus, its commit and author, the one primary Roll back. Calm lead (a moving place): the live step selected,
	 * "Stage 2 running", the build and the build it replaces, never a Roll back.
	 * Why no existing component fits: DeploymentPipelineCard is 1,600 lines bound to a live Rollout object, and TrayDecision is
	 * the Needs-you page's whole decision frame; this composes the same parts (TraySteps rail, t-heading state title, inset
	 * surface, FailedCheckLine, t-code-lg build, Avatar login, icon buttons) from a TRow so it can sit under a row.
	 * Proportions borrowed from: the Overview's Deployment pipeline card (rail 300px, 44px step rows, detail pane p-4 with
	 * space-y-3) and the History tab's opened entry (commit title + Avatar + login, icon buttons).
	 * Lineage: the opened lead row of r3–r6 (Runway panel), rebuilt in v2 from the tab's card. Phone: the panes stack (rail,
	 * then the detail), the actions are content-width 14px buttons right-aligned.
	 * v2 r2: the card has the tab's own header (icon · "Deployment pipeline" · "1/2 steps", 47px) so the opened region reads as
	 * the tab's card hung under its row; the pane is 24px-padded and fills the card (two columns from 960px: state + check line +
	 * facts │ build + commit); the actions end on the card's right padding, the same x as a row's Roll back.
	 */
	import { stateWord } from './state-words';
	import { UndoOutline, ExclamationCircleSolid, ChevronDownOutline } from 'flowbite-svelte-icons';
	import FailedCheckLine from '$lib/components/FailedCheckLine.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import TraySteps from './TraySteps.svelte';
	import PipelineCard from './PipelineCard.svelte';
	import ActRow, { type Act } from '$lib/components/ActRow.svelte';
	import { ago, avatarSrc, deployedCommit, deployedBuild, buildTitle, lastHealthy, newestBuild, pathPosition, stepDetail, healthChecks, healthTally, checkClock, waitingBuild, approvalScope, approvalTarget, bakeDuration, holdSince, type TRow, type HomeState } from './data';
	import { approveAct } from './approvals.svelte';
	import { slipwayTitle, actionHref, actionLabel, approvalFact, envTheme, VIEWER } from './rollout-view';

	let { row, hs = 'incident', action = null, compact = false, nested = false, class: className = '' }: { row: TRow; hs?: HomeState; action?: TRow['action']; /** r5 R20: drawn as a bounded nested card (border, radius 8, the card's surface) that closes before the next row; the caller owns the margin around it */ nested?: boolean; /** r34 v2 r4 (Y8): embedded in another page's list (/apps/<name>, /envs/<name>): the build is 14px mono, the rail is as tall as its steps (the pane owns the divider), and the check line is not drawn (the page's own statement carries it) */ compact?: boolean; class?: string } = $props();

	const failing = $derived(row.group === 'failed');
	const fr = $derived(row.failure);
	const check = $derived(fr ? { name: fr.check ?? fr.line, message: fr.check ? (fr.message ?? undefined) : undefined } : null);
	const sel = $derived((row.steps.find((s) => s.state === 'fail') ?? row.steps.find((s) => s.state === 'active' || s.state === 'hold') ?? row.steps[row.steps.length - 1])?.name ?? null);
	/* gated rows (awaiting approval / held by rule) run their current build; lastHealthy(row) would return it (from=0) and print
	   "X replaces X". Walk back one entry so the line reads the tab's "Roll back to <previous>". */
	const gatedRow = $derived(row.state === 'awaiting-approval' || row.state === 'held-by-rule');
	const wb = $derived(gatedRow ? waitingBuild(row) : null);
	/* r6 T12/T6: ONE age per item, the same source as the row. A moving/failing place: the row's own since. An approval: the waiting build's age (the tab's Newer-builds age = the row's). A held place:
	   since the waiting build ARRIVED at this gate (holdSince), blank when the mock cannot tell — never the deployed build's age. */
	const sinceAge = $derived(ago(gatedRow ? (row.group === 'held' ? holdSince(row, hs) : (wb?.since ?? row.since)) : row.since));
	const since = $derived(row.group === 'approval' && row.stillChecking && checkClock(row) ? `Checking · ${checkClock(row)}` : sinceAge);
	/* a gated lead puts the build that WAITS in focus (the one Approve releases, held here per the Gates tab); the build it replaces is the line beside it */
	const build = $derived(wb ? wb.build : buildTitle(row));
	const healthy = $derived(lastHealthy(gatedRow ? { state: 'healthy', href: row.href } : row));
	const commit = $derived(wb ? { title: wb.title ?? '', author: wb.author } : deployedCommit(row));
	const own = $derived(commit?.author === VIEWER);
	const runsIn = $derived(pathPosition(row, hs));
	/* compact (embedded in /apps/<name>, /envs/<name>): the page's rows already say the position; the facts line is the tab header's newest-build sentence */
	const compactFacts = $derived(compact && !failing ? (newestBuild(row)?.sentence ?? null) : null);
	/* r5 R21: one facts line, the tab's Runs-in rollup (no step-by-step narration: the rail and the title already say it); a gated lead adds what its Approve acts on */
	/* r6 T16: the row above already says the approval's scope; the pane's facts line is the Runs-in rollup only */
	const facts = $derived(compact ? compactFacts : runsIn);
	/* S1: nothing runs (every step done: a gated or finished place) -> the tab's green check, not a spinner */
	const running = $derived(row.steps.some((s) => s.state === 'active'));
	/* S8: in a host page's compact pane the title is the TAB's own step title and time ("Checked 19h · 1m 0s", "Final check 9h", "Final check · Checking 5 min left"); the host's statement carries the state */
	const tabTitle = $derived(running ? (checkClock(row) ? `Final check · Checking` : 'Final check') : failing ? 'Final check' : 'Checked');
	const tabTime = $derived(running ? (checkClock(row) ?? since) : failing ? since : [ago(row.deployedAt), bakeDuration(row)].filter(Boolean).join(' · '));
	/* the calm pane's inset: the tab's "Health checks" / "Check timer" sub-rows (rounded-md border, px-4 py-3, 12px dot, title, state word) */
	const sd = $derived(stepDetail(row));
	const hcFailing = $derived(healthChecks(row).filter((c) => c.state === 'failing').length);
	type Sub = { title: string; label: string; tone: 'ok' | 'bad' | 'wait' | 'pending' };
	/* r5 R1/R16: the tab's words, with its tally ("Waiting · 1 pending · 0 passing") and the bake clock ("Checking · 5 min left") */
	const clock = $derived(checkClock(row));
	const checkingGate = $derived(row.group === 'approval' && row.stillChecking && !!clock);
	const subs = $derived<Sub[]>([
		{ title: 'Health checks', label: hcFailing || sd.healthChecks === 'Failed' ? 'Failed' : sd.healthChecks === 'Healthy' ? 'Healthy' : (sd.healthChecks === 'Pending' ? healthTally(row) : `${sd.healthChecks} · ${healthTally(row)}`), tone: hcFailing || sd.healthChecks === 'Failed' ? 'bad' : sd.healthChecks === 'Healthy' ? 'ok' : 'wait' },
		{ title: 'Check timer', label: sd.checkTimer === 'Checking' && clock ? (checkingGate ? clock : `Checking · ${clock}`) : sd.checkTimer, tone: sd.checkTimer === 'Done' ? 'ok' : sd.checkTimer === 'Checking' ? 'wait' : 'pending' }
	]);
	const DOT = { ok: 'bg-success-solid', bad: 'bg-danger-solid', wait: 'bg-progress-solid animate-pulse', pending: 'bg-line-strong' } as const;
	/* U9: the dl's rows. prev = the build this one replaces / the last healthy one; reach = the tab's Runs-in rollup (compact: the tab header's newer-builds sentence) split into label + value */
	const prev = $derived(wb ? { label: 'Replaces', build: buildTitle(row), age: `${ago(row.deployedAt)} ago` } : healthy ? { label: failing ? 'Last healthy' : 'Replaces', build: healthy.build, age: `${failing ? 'deployed ' : ''}${ago(healthy.at)} ago` } : null);
	const reach = $derived.by(() => {
		if (compact) { const n = newestBuild(row); if (!n || failing) return null; return { label: 'Newer builds', build: null as string | null, value: n.sentence.replace(/^(\d+) newer builds?/, '$1') }; /* lead r9: the tab's own sentence, count first ('2 · held: waiting for approval'), never 'N, held:' */ }
		if (!facts) return null;
		const m = /^(\d+) of (\d+) places? on the newest build$/.exec(facts), all = /^All (\d+) places? on the newest build$/.exec(facts);
		/* rollouts-8 V10: the newest build is NAMED (mono) and the fraction carries its unit */
		const nb = newestBuild(row)?.newest ?? null;
		return { label: 'Newest build', build: nb, value: m ? `reached ${m[1]} of ${m[2]} place${m[2] === '1' ? '' : 's'}` : all ? `reached all ${all[1]} places` : facts };
	});
	/* r7 U3: ONE state per item. An approval whose own deploy is still baking is "Checking" on its row and on the tab's pill; the pane says the same word with the clock ("Checking 5 min left"),
	   and the waiting build the Approve acts on is named as such in the list */
	/* rollouts-12 W32 (ruling d): the heading never repeats the row's state word. A gated place's heading is the WAITING build (the row says "Your approval" / "Waits on payments-svc");
	   an approval whose own deploy still bakes and a moving place say the tab's step title ("Final check", "Stage 2"), the row says "Checking" / "Deploying". */
	const activeStep = $derived(row.steps.find((s) => s.state === 'active') ?? null);
	const stepTitle = $derived(activeStep ? (activeStep.name === 'Check' ? 'Final check' : activeStep.name) : null);
	const gatedHead = $derived(!checkingGate && wb && (row.group === 'approval' || row.group === 'held') ? wb.build : null);
	const paneTitle = $derived(gatedHead ?? (checkingGate ? 'Final check' : (row.group === 'moving' ? stepTitle : null)) ?? slipwayTitle(row, hs));
	/* rollouts-11 W21: while the deploy still bakes the clock is said ONCE, in the Check timer row; the heading says "Checking" and the age of the waiting build */
	const paneTime = $derived(checkingGate ? sinceAge : since);
	const approval = $derived(compact ? null : approvalFact(row, hs));
	/* rollouts-11 W24: the approval is THREE label/value rows (Approval -> Your approval | Place -> chip | Scope -> 1 of 5 regions), never one dot-run sentence */
	const ap = $derived(!compact && row.group === 'approval' ? approvalScope(row, hs) : null);
	const apWord = $derived(row.needsYou ? 'Your approval' : stateWord('approval'));
	/* the waiting build and "the newest build" are ONE row when they are the same build ("f4a2c19 · reached 2 of 9 places") */
	const sameBuild = $derived(!!wb && !!reach && reach.build === build);
	/* rollouts-9 W9: on a phone the opened row is SHORT first (check line, steps, the action); the facts list waits behind one tap, in place. sm+ always shows it. */
	let more = $state(false);
	const done = $derived(row.steps.filter((s) => s.state === 'done').length);
	/* the lead's actions (content only; ActRow lays them out: a phone gets Details + the one action on one row, Open rollout is the row above's link) */
	const lead = $derived<Act | null>(action ? (action.kind === 'approve' ? (approveAct(approvalTarget(row, hs), { key: 'slipway-action' }) ?? { label: 'Approve', href: actionHref(action), key: 'slipway-action' }) : { label: actionLabel(action), href: actionHref(action), icon: UndoOutline, key: 'slipway-action' }) : null);
	const detailsAct = $derived<Act>({ label: more ? 'Hide details' : 'Details', onclick: () => (more = !more), icon: ChevronDownOutline, iconAfter: true, iconTurn: more, phoneOnly: true, key: 'slipway-details', data: { 'aria-expanded': String(more) } });
	const openAct = $derived<Act>({ label: 'Open rollout', href: row.href, desktopOnly: true, key: 'slipway-open' });
</script>

<PipelineCard shell={nested ? 'card' : 'hung'} at={compact ? 640 : 560} railWidth="min(300px, 40%)" class="sw {nested ? 'sw-nested' : ''} {compact ? 'sw-compact' : ''} {className}" state={failing ? 'failed' : !running ? 'done' : row.state === 'checking' ? 'checking' : 'deploying'} rollup="{done}/{row.steps.length} steps" label="Deployment pipeline of {row.app}" data-more={more ? 'open' : 'closed'} data-slipway="" data-state={failing ? 'failed' : 'moving'}>
	{#snippet rail()}<TraySteps steps={row.steps} selected={sel} noActiveChip={checkingGate} checkWord={row.state === 'deploying' ? 'Deploying' : 'Checking'} />{/snippet}
		<div class="sw-pane min-w-0 p-4 sm:p-6">
				<div class="sw-info min-w-0 space-y-3">
					<div class="sw-title flex flex-wrap items-baseline gap-x-3 gap-y-1">
						<h4 class="{gatedHead && !compact && !failing ? 't-code-lg tabular-nums' : 't-heading'} text-fg" data-slipway-title>{compact || failing ? tabTitle : paneTitle}</h4>
						<span class="t-meta tabular-nums text-fg-subtle">{compact || failing ? tabTime : paneTime}</span>
					</div>
					<!-- r7 U4: in a host page's compact pane the tab's own sentence for the step (the history entry's bake message) sits under the step title -->
					{#if compact && failing && sd.message}<p class="t-meta text-fg-muted" data-slipway-sentence>{sd.message}</p>{/if}
					{#if failing && check && !compact}
						<!-- rollouts-12 W27: the phone's check is TWO lines: the check's name (one line, ellipsis) and its message (the one fact) -->
						<div class="sw-check-m rounded bg-subtle px-3 py-2 sm:hidden" data-slipway-check-m>
							<p class="t-ui flex min-w-0 items-center gap-2 text-fg"><ExclamationCircleSolid class="h-4 w-4 shrink-0 text-danger" aria-hidden="true" /><span class="min-w-0 truncate">{check.name}</span></p>
							{#if check.message}<p class="t-meta mt-0.5 text-fg-muted">{check.message}</p>{/if}
						</div>
						<div class="rounded bg-subtle px-3 py-2 max-sm:hidden" data-slipway-check>
							<FailedCheckLine {check} danger />
							{#if fr?.phrase}<p class="t-meta mt-1 text-fg-muted">{fr.phrase}</p>{/if}
						</div>
					{/if}
					<!-- r6 T16: a failing place states its failure ONCE (the check line above); Health checks / Check timer sub-rows are the in-flight pane's -->
					{#if !failing}
					<ul class="divide-y divide-line overflow-hidden rounded-md border border-line" data-slipway-inset>
							{#each subs as c (c.title)}
								<li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
									<span aria-hidden="true" class="h-3 w-3 shrink-0 rounded-full {DOT[c.tone]}"></span>
									<span class="t-card-title min-w-0 flex-1 text-fg">{c.title}</span>
									<!-- the tab's sub-row: a pending state is its neutral chip (DeploymentPipelineCard pillClasses.pending), every other state a plain word -->
									{#if c.tone === 'pending'}<span class="chip t-label chip-wide shrink-0 border-line text-fg-subtle">{c.label}</span>{:else}<span class="t-meta shrink-0 text-fg-subtle">{c.label}</span>{/if}
								</li>
							{/each}
					</ul>
					{/if}
				</div>
				{#if !compact}<div class="sw-strand sm:hidden" aria-hidden="true" style:max-width="{Math.max(2, row.steps.length) * 96}px"><TraySteps steps={row.steps} layout="strand" dup /></div>{/if}
					<!-- r7 U9 (owner §7, TYPO P5): the pane's facts are ONE two-column list, the label (t-meta muted) in a 96px track and the value (t-ui ink, builds in mono) in one value column at every width;
					     no "a11c202 last healthy a11c101 · deployed 9h ago" runs. Reference: the Overview's rail `dl` cards and the History tab's CHANGE pane. -->
					<!-- rollouts-8 V5: two lists, so the 960+ pane fills both columns: the builds sit under the check line (left), the change, reach and the actions in the right column -->
					<!-- rollouts-11 W23/W24: the facts sit under BOTH the step rail and the step's detail (full width of the card) in two columns from 960px, so neither column has a void beside the other.
					     An approval says its three facts as label/value rows; its waiting build and the newest build are one row when they are the same build. -->
					<div class="sw-facts">
					<dl class="sw-b1 sw-dl min-w-0" data-slipway-dl>
						{#if ap}
							<div class="sw-r" data-slipway-approval><dt class="t-meta text-fg-muted">Approval</dt><dd class="t-ui text-fg">{apWord}</dd></div>
							<div class="sw-r"><dt class="t-meta text-fg-muted">Place</dt><dd class="flex min-w-0 items-center"><Chip role="env" theme={envTheme(row.tier)} label={ap.acts} wide /></dd></div>
							{#if ap.of > 1}<div class="sw-r"><dt class="t-meta text-fg-muted">Scope</dt><dd class="t-ui text-fg">1 of {ap.of} regions</dd></div>{/if}
						{:else}
							{#if approval}<div class="sw-r" data-slipway-approval><dt class="t-meta text-fg-muted">Approval</dt><dd class="t-ui text-fg">{approval}</dd></div>{/if}
							<div class="sw-r"><dt class="t-meta text-fg-muted">{wb ? 'Next build' : 'Build'}</dt><dd><span class="t-code tabular-nums text-fg" data-slipway-build>{build}</span></dd></div>
							{#if prev}<div class="sw-r"><dt class="t-meta text-fg-muted">{prev.label}</dt><dd class="flex min-w-0 flex-wrap items-baseline gap-x-2"><span class="t-code tabular-nums text-fg-muted">{prev.build}</span><span class="t-meta tabular-nums text-fg-subtle">{prev.age}</span></dd></div>{/if}
						{/if}
					</dl>
					<dl class="sw-b2 sw-dl min-w-0" data-slipway-dl2>
						{#if ap}
							<div class="sw-r" data-slipway-facts={sameBuild ? '' : undefined}><dt class="t-meta text-fg-muted">Next build</dt><dd class="min-w-0"><span class="t-code tabular-nums text-fg" data-slipway-build>{build}</span>{#if sameBuild && reach}<span class="t-ui text-fg">{' · '}{reach.value}</span>{/if}</dd></div>
							{#if prev}<div class="sw-r"><dt class="t-meta text-fg-muted">{prev.label}</dt><dd class="flex min-w-0 flex-wrap items-baseline gap-x-2"><span class="t-code tabular-nums text-fg-muted">{prev.build}</span><span class="t-meta tabular-nums text-fg-subtle">{prev.age}</span></dd></div>{/if}
						{/if}
						{#if commit}
							<div class="sw-r"><dt class="t-meta text-fg-muted">Change</dt>
								<dd class="min-w-0" data-slipway-commit>
									{#if wb ? wb.title : (deployedBuild(row)?.title ?? commit.title)}<p class="t-ui text-fg">{wb ? wb.title : (deployedBuild(row)?.title ?? commit.title)}</p>{/if}
									{#if commit.author && !own}
										<p class="t-meta mt-1 flex min-w-0 items-center gap-1.5 text-fg-subtle"><Avatar name={commit.author} src={avatarSrc(commit.author)} size={20} /><span class="min-w-0 break-words">{commit.author}</span></p>
									{:else if own}
										<p class="t-meta mt-1 text-fg-subtle">Your change</p>
									{/if}
								</dd>
							</div>
						{/if}
						{#if reach && !(ap && sameBuild)}<div class="sw-r" data-slipway-facts><dt class="t-meta text-fg-muted">{reach.label}</dt><dd class="t-ui text-fg">{#if reach.build}<span class="t-code tabular-nums">{reach.build}</span>{' '}{/if}{reach.value}</dd></div>{/if}
					</dl>
					</div>
			<div class="sw-actions" data-slipway-actions><ActRow align="end" primary={failing ? (lead ?? undefined) : undefined} secondary={[...(!compact ? [detailsAct, openAct] : []), ...(!failing && lead ? [{ ...lead, lead: true }] : [])]} /></div>
		</div>
</PipelineCard>

<style>
/* shell, header, container and the rail | pane split are PipelineCard's (.pc-*); the non-compact lead re-flows its own pieces as the body's direct children */
:global(.sw:not(.sw-compact) .pc-pane) { display: contents; }
	/* phone: the pane comes first (info, then the actions straight after the check line, then the build and commit), the step rail last */
	.sw-pane { order: 1; display: grid; gap: 12px; grid-template-areas: 'info' 'act' 'b1' 'b2'; }
	:global(.pc-rail) { order: 2; border-bottom: 0; border-top: 1px solid var(--k-line-subtle); }
	.sw-info { grid-area: info; }
	.sw-info > .sw-check-m { margin-block-end: 0; }
	.sw-dl { display: grid; gap: 12px; align-content: start; }
	.sw-r { display: grid; grid-template-columns: 96px minmax(0, 1fr); column-gap: 12px; align-items: baseline; }
	.sw-facts { display: contents; }
	.sw-b1 { grid-area: b1; }
	.sw-b2 { grid-area: b2; }
	.sw-actions { grid-area: act; margin-right: 0; }
	/* r4 Y4: sm+ has no bottom nav and no thumb to serve: a narrow Slipway on a tablet reads like the tab's card (the steps, then the step's
	   detail: state, check, build and commit, then the actions), never the phone's order (the actions straight under the check line) */
	@media (min-width: 640px) {
:global(.pc-rail) { order: 0; border-top: 0; border-bottom: 1px solid var(--k-line-subtle); }
		.sw-pane { order: 1; grid-template-areas: 'info' 'b1' 'b2' 'act'; }
	}
	/* rollouts-8 V5: the two panes need ~800px; a half-width card (650px at 1440) stacks the steps above the pane instead of leaving a 300x300 void under them */
	@container (min-width: 800px) {
:global(.pc-body) { display: grid; grid-template-columns: 300px minmax(0, 1fr); }
		.sw-pane { order: 0; grid-template-areas: 'info' 'b1' 'b2' 'act'; }
		:global(.pc-rail) { order: 0; border-top: 0; border-bottom: 0; border-right: 1px solid var(--k-line-subtle); }
		.sw-actions { margin-right: -8px; } /* the pane pads 24; Roll back ends on the card's 16 like a row's */
	}
	@container (min-width: 960px) {
.sw-pane { grid-template-columns: minmax(0, 1.7fr) 1px minmax(0, 1fr); grid-template-areas: 'info div b2' 'b1 div b2' '. div act'; grid-template-rows: auto auto 1fr; column-gap: 24px; row-gap: 16px; align-content: start; }
		.sw-pane::before { content: ''; grid-area: div; background: var(--k-line-subtle); }
		/* r6 T17: the actions sit under the commit (right column), not in a full-width row that leaves a hole under it */
.sw-actions { align-self: end; }
		.sw-b2 { align-content: start; }
		/* rollouts-8 V5: the step column is as tall as its steps; the divider belongs to the pane */
:global(.sw:not(.sw-compact)) :global(.pc-rail) { align-self: start; border-right: 0; }
		:global(.sw:not(.sw-compact)) .sw-pane { border-left: 1px solid var(--k-line-subtle); }
	}
	/* compact (Y8): the rail is as tall as its steps, the divider belongs to the pane, the build is 14px mono */
:global(.sw-compact) [data-slipway-build] { font-size: 14px; line-height: 20px; }
	/* rollouts-9 W2 (lead ruling: match the tab): a compact pane (embedded in /apps/<name>, /envs/<name>) draws rail | pane SIDE BY SIDE from a 640px container, as the Overview's pipeline card does
	   (rail 300px, 40% below it); the pane takes the rest of the width and its height follows its content; the rail is as tall as the pane. Under 640px it stacks (rail first, full width). */
	/* r2-cleanup: the compact rail | pane split (at=640, rail min(300px, 40%)) and its stacked order are PipelineCard's own; only the pane's inner grid is the host's */
	@container (min-width: 640px) {
		:global(.sw-compact) .sw-pane { grid-template-areas: 'info' 'b1' 'b2' 'act'; grid-template-columns: minmax(0, 1fr); }
	}
	/* the check line is 14px at every width (the shared line steps down to 12 below 1024) */
	/* step labels at the tab's x (its rail sits 4px in from the card edge) */
:global(.pc-rail) :global(li > div) { padding-left: 20px; }
	:global(.pc-rail) :global(li > span[aria-hidden]) { left: 31px; }
	[data-slipway-check] :global(.check-line) { font-size: 14px; line-height: 20px; text-wrap: balance; }
	/* rollouts-11 W23: from 640px the check line is ONE line: the check NAME shrinks first (ellipsis, never a mid-word break), the message stays whole; a phone wraps it (the full text is the one thing the lead says) */
	@media (min-width: 640px) {
[data-slipway-check] :global(.check-line) { text-wrap: nowrap; }
		[data-slipway-check] :global(.check-line > span) { display: flex; min-width: 0; flex: 1 1 auto; gap: 0.3em; }
		[data-slipway-check] :global(.check-line > span > span:first-child) { flex: 0 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		[data-slipway-check] :global(.check-line > span > span:last-child) { flex: 0 0 auto; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	}
	/* rollouts-11 W23/W24: from a 560px card the steps sit BESIDE the step's detail (rail | state + check / health inset), and the facts hang under both, full width, in two columns from 960px;
	   the actions end the card. Nothing is stacked beside a shorter neighbour: the only surface under the steps is the tab's own rail surface (the divider runs to the facts). */
	@container (min-width: 560px) {
:global(.sw:not(.sw-compact)) :global(.pc-body) { display: grid; grid-template-columns: min(300px, 40%) minmax(0, 1fr); grid-template-areas: 'rail info' 'facts facts' 'act act'; }
		:global(.sw:not(.sw-compact)) .sw-pane { display: contents; }
		:global(.sw:not(.sw-compact)) .sw-pane::before { content: none; }
		:global(.sw:not(.sw-compact)) .sw-pane { border-left: 0; }
		:global(.sw:not(.sw-compact)) :global(.pc-rail) { grid-area: rail; order: 0; align-self: stretch; border-top: 0; border-bottom: 0; border-right: 1px solid var(--k-line-subtle); }
		:global(.sw:not(.sw-compact)) .sw-info { grid-area: info; padding: 24px; }
		:global(.sw:not(.sw-compact)) .sw-facts { grid-area: facts; display: grid; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--k-line-subtle); }
		:global(.sw:not(.sw-compact)) :is(.sw-b1, .sw-b2) { grid-area: auto; }
		:global(.sw:not(.sw-compact)) .sw-actions { grid-area: act; margin: 0; padding: 0 24px 16px; align-self: auto; }
	}
	@container (min-width: 960px) {
		/* rollouts-12 W33: the two lists are capped and left-aligned, so at 1920 their columns are never ~500px apart */
:global(.sw:not(.sw-compact)) .sw-facts { grid-template-columns: minmax(0, 420px) minmax(0, 520px); column-gap: 48px; justify-content: start; }
	}
	/* 2026-11-10 (landing audit): a compact pane (/apps/<name>, /envs/<name>) put its facts INSIDE the pane beside the rail, so the pane out-grew the 2-3 steps and left a tall empty rail under them.
	   From the same 640px the compact card now hangs its facts under BOTH columns, as the lead and the Overview's card do: rail | step detail, then the facts full width, then the actions. */
	@container (min-width: 640px) {
:global(.sw-compact) :global(.pc-body) { display: grid; grid-template-columns: min(300px, 40%) minmax(0, 1fr); grid-template-areas: 'rail info' 'facts facts' 'act act'; }
		:global(.sw-compact) :global(.pc-pane), :global(.sw-compact) .sw-pane { display: contents; }
		:global(.sw-compact) .sw-pane::before { content: none; }
		:global(.sw-compact) :global(.pc-rail) { grid-area: rail; order: 0; align-self: stretch; border-top: 0; border-bottom: 0; border-right: 1px solid var(--k-line-subtle); }
		:global(.sw-compact) .sw-info { grid-area: info; padding: 24px; }
		:global(.sw-compact) .sw-facts { grid-area: facts; display: grid; gap: 12px; padding: 16px 24px; border-top: 1px solid var(--k-line-subtle); }
		:global(.sw-compact) :is(.sw-b1, .sw-b2) { grid-area: auto; }
		:global(.sw-compact) .sw-actions { grid-area: act; margin: 0; padding: 0 24px 16px; align-self: auto; }
		:global(.sw-compact) .sw-actions:not(:has(*)) { display: none; }
	}
	@container (min-width: 960px) {
:global(.sw-compact) .sw-facts { grid-template-columns: minmax(0, 420px) minmax(0, 520px); column-gap: 48px; justify-content: start; }
	}
	/* rollouts-8 V4: on a phone the lead's STEPS come straight after the check line (the page's drawn object is in the first screen), then the actions, then the facts */
	@media (max-width: 639px) {
		/* rollouts-9 W9: the opened lead is SHORT on a phone: no card header (the row above names the place, the pane title names the step), tighter gaps, so the next failing rows are in the first screen */
:global(.sw:not(.sw-compact)) :global(.pc-head) { display: none; }
		/* rollouts-11 W22: the failing lead is SHORT: the row above carries the age and the state, the pane opens on the check line (no "Final check 9h" title) */
:global(.sw[data-state='failed']:not(.sw-compact)) .sw-title { display: none; }
		:global(.sw:not(.sw-compact)) .sw-facts { display: contents; }
		:global(.sw:not(.sw-compact)) :global(.pc-body) { gap: 8px; padding-block: 8px; }
		/* the lead is the row's own card on a phone: no second bordered card inside it (the lead is <= 250px, W27) */
:global(.sw.sw-nested.pc.pc-card) { border: 0; border-radius: 0; background: transparent; }
		:global(.sw:not(.sw-compact)) .sw-pane { display: contents; }
		:global(.sw:not(.sw-compact)) :is(.sw-info, .sw-actions, .sw-b1, .sw-b2) { margin-inline: 16px; }
		:global(.sw:not(.sw-compact)) .sw-info { order: 1; }
		:global(.sw:not(.sw-compact)) :global(.pc-rail) { display: none; }
		:global(.sw:not(.sw-compact)) .sw-strand { order: 2; margin-inline: 16px; }
		:global(.sw:not(.sw-compact)) .sw-actions { order: 3; }
		:global(.sw:not(.sw-compact)) .sw-b1 { order: 4; margin-bottom: -4px; }
		:global(.sw:not(.sw-compact)) .sw-b2 { order: 5; }
		:global(.sw[data-more='closed']:not(.sw-compact)) :is(.sw-b1, .sw-b2) { display: none; }
	}
</style>
