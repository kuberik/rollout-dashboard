<script lang="ts">
	/**
	 * r34 v2 CD r2 — THE CHANGE DETAIL PAGE (/changes/<slug>), built from the objects the Changes list and the rollout tabs draw.
	 *
	 * "Where has my change got to, where is it failing or waiting, and what happened to it on the way?"
	 * ONE MODEL (S1): strip, statement, Places, counts and History read data.ts' placesOfChange / historyOfChange / regionStates /
	 * runsIn / heldBehind / changeCommits and change-view's facts — the same helpers the Folio on /changes reads.
	 * REFERENCES: header = the tabs' PageHeader (crumb · 24 title · meta with the merge facts · 36px buttons beside the H1);
	 * strip = PromotionLane's tiles one size up (ChangeStrip); statement = the Overview's failure banner (AlertPanel unwrapped, the
	 * check by FailedCheckLine, ONE primary "Roll back to <build>", Open rollout); Places = Rollouts' rows keyed by place with the
	 * Slipway hung under the lead (open in EVERY state); Commits = the Overview's commit rows; rail = HoldingCard + the PR's life
	 * on History's spine + How it's going.
	 * NEW BY DESIGN: the crumb row (no shell crumb exists for a change yet), the at-rest open panel, the spine's event rows.
	 * v2 r3: counts are the CHANGE's (`changeProd`, shared with the Folio), the opened object is ChangeSlipway (the change's own build
	 * and the tab's commit of it), the spine is scenario-masked and keeps every later deploy of a place that was rolled back, waiting
	 * events of one build collapse to one, the header actions drop under the title below lg (`data-desktop-only`).
	 * v2 r4: ONE count with a unit (`countLine`, in the header; Places and History carry no second denominator), every place row is the
	 * tab's current deploy, a place the change does not reach is listed "Not affected", the waits of one build fold into ONE approval row
	 * (chips per region, one Approve), a wait's statement is the tab's held banner with its action, the strip is the tab's 28px chips,
	 * and below 640 every item is its short form (owner 2026-11-02 §5). NEW BY DESIGN: the folded approval row (the Needs-you pattern
	 * with chips, drawn on the Places row's tracks) and the not-affected row.
	 * v2 r5 (AD r4 not signed): the wait banner is the TAB's held banner (held hue: AlertPanel `pinned` + HeldGlyph) with ONE button, and a
	 * button that only navigates says so ("Review approval ↗", never "Approve"); the statement on a phone is title + one cause line + ONE button
	 * row (everything else behind "Details", `data-statement-details`); the count sits in the strip row (states only below 640); Open PR / CI checks
	 * are header-row links below lg; the header carries the lead row's facts (20 mono build, diffstat, commit author); counts read the rows'
	 * states ("2 live · 1 checking"); one `reserve` for the card's rows from the VISIBLE actions (ages share one right track).
	 * Words are the tab's only. The viewer's own face never sits on their own change ("yours").
	 */
	import { approveAct } from '../approvals.svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import StatementBanner from '$lib/components/StatementBanner.svelte';
	import Card from '$lib/components/Card.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import { MapPinAltOutline, ChartLineUpOutline, UndoOutline, GithubSolid, PlaySolid, CheckOutline } from 'flowbite-svelte-icons';
	import Group from '../Group.svelte';
	import ChangePlaceRow from './ChangePlaceRow.svelte';
	import HoldingCard from '../HoldingCard.svelte';
	import ChangeStrip from './ChangeStrip.svelte';
	import ChangeCard from './ChangeCard.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import ChangeHistory from './ChangeHistory.svelte';
	import { heldCauses, changeTruth, approvalTarget, ago, avatarSrc, type TChange, type HomeState, noReleasesApp } from '../data';
	import { actionHref, rowAction, holdWord } from '../rollout-view';
	import { isViewer, plural } from '../change-view';
	import { classified, stripOf, statementOf, rollbackTo, commitsOf, spineOf, howFacts, countsOf, headFacts, buildGroups, changeProd, notReached, type Place } from './detail-model';

	let { change: c, scenario = 'incident', checks = null }: { change: TChange; scenario?: HomeState; checks?: { text: string; href: string | null } | null } = $props();
	/** the change's apps have no releases (no source, or an empty catalogue): nothing will carry it to production */
	const noReleases = $derived(c.apps.length > 0 && c.apps.every((a) => !!noReleasesApp(a)) ? noReleasesApp(c.apps[0]) : undefined);

	const causes = $derived(heldCauses(scenario));
	const cl = $derived(classified(c, scenario));
	const places = $derived(cl.places);
	const tiles = $derived(stripOf(c, scenario));
	const st = $derived(statementOf(c, places, cl.all));
	const lead = $derived(st.lead ?? places[0] ?? null);
	const cm = $derived(commitsOf(c, scenario, lead));
	const events = $derived(spineOf(c, scenario, places));
	const how = $derived(howFacts(c, places, cl.all, events));
	const failed = $derived(places.filter((p) => p.kind === 'failed'));
	const holds = $derived(causes.filter((h) => h.cause !== 'Waiting for approval').map((h) => ({ ...h, rows: h.rows.filter((r) => places.some((p) => p.kind === 'waiting' && p.href === r.href)) })).filter((h) => h.rows.length));
	const slugParts = $derived((c.changeHref ?? '').split('/').filter(Boolean));
	const ref = $derived(c.prNumber != null ? `#${c.prNumber}` : (c.refLabel ?? ''));
	const ext = $derived(c.prHref ?? c.commitHref);
	const mine = $derived(isViewer(c.author));
	const multiApp = $derived(c.apps.length > 1);
	const fr = $derived(st.kind === 'failed' ? lead?.row?.failure ?? null : null);
	const check = $derived(fr ? { name: fr.check ?? fr.line, message: fr.check ? (fr.message?.split(/;\s/)[0] ?? undefined) : undefined } : null);
	/* changedetail-8 CD3: the banner is the tab's one cause line + age; the ids and the PR live in the pane's dl (Build / Last healthy / Newer builds) */
	const failTitle = $derived(st.kind === 'failed' && lead?.row ? `Deployment failed in ${st.title.replace(/^Failing in /, '').replace(/-/g, '\u2011')}\u00a0·\u00a0${ago(lead.at ?? lead.row.since)}` : st.title);
	const cn = $derived(countsOf(cl.all, places));
	const head = $derived(headFacts(c, lead, scenario));
	/* ONE approval row per build and cause: the places that wait for the same build (five regions of one app) fold into the first, with a chip each (CE12) */
	const rows = $derived.by(() => {
		const out: { p: Place; also: Place[] }[] = [];
		for (const p of places) {
			const k = p.kind === 'waiting' ? out.find((r) => r.p.kind === 'waiting' && r.p.build === p.build && r.p.row?.group === p.row?.group && r.p.app === p.app) : null;
			if (k) k.also.push(p); else out.push({ p, also: [] });
		}
		return out;
	});
	const approve = $derived(st.kind === 'waiting' && lead?.row ? rowAction(lead.row) : null);
	/* the action track exists only when a row SHOWS an action: the open lead's lives in the statement, a folded row's is its first row's (ages end at one x, CF6) */
	const leadOpen = $derived(st.kind === 'failed' || st.kind === 'waiting' || st.kind === 'held');
	const reserve = $derived(rows.some((r, i) => (i > 0 || !leadOpen) && !!r.p.row && !!rowAction(r.p.row)));
	/* CE5: people with roles. The commit in focus names its author; the change's author merged it. A build's "Release commit" is no person's PR. */
	const commitBy = $derived(cm.commits[0] && !/^Release commit for build/.test(cm.commits[0].title) ? cm.commits[0].author : null);
	const mergedBy = $derived(!mine && !!commitBy && !!c.author && commitBy !== c.author);
	const people = $derived(mine ? 'yours' : commitBy && c.author && commitBy !== c.author ? `by ${commitBy} · merged by ${c.author}` : c.author ? `by ${c.author}` : '');
	const byWho = $derived(mine ? null : commitBy && c.author && commitBy !== c.author ? commitBy : (c.author ?? null));
	const back = $derived(rollbackTo(st.kind === 'failed' ? lead : null));
	const backHref = $derived(lead?.row?.action?.kind === 'rollback' ? actionHref(lead.row.action) : lead ? `${lead.href}?action=rollback` : null);
	/* a check line that says "passing" while the change fails in production would be a lie: only the link survives a failure */
	const checkText = $derived(checks && !checks.href && !failed.length ? checks.text : null);
	/* r4 (BUILD-R4): "Where it runs" groups the place rows BY BUILD (own build first); the rollup counts places and the builds that carry the change */
	const groups = $derived(buildGroups(c, scenario, rows, cl.unaffected));
	const carrying = $derived(groups.filter((g) => g.carries).length);
	const whereRollup = $derived([plural(cl.all.length, 'place'), carrying ? `${carrying} build${carrying === 1 ? '' : 's'} carr${carrying === 1 ? 'ies' : 'y'} it` : ''].filter(Boolean).join(' · '));
	const whereAdverse = $derived(cn.failing ? `${cn.failing} failing` : null);
	const whereHeld = $derived([cn.waiting ? `${cn.waiting} waiting` : '', cn.held ? `${cn.held} held` : ''].filter(Boolean).join(' · ') || null);
	const prod = $derived(changeProd(c, scenario));
	/* AD r1 (3): a waiting place does not RUN the build: the subheader counts the places that run it and, apart, the places that wait for it */
	/* AD r3 (1): the subheader counts as the header does: the adverse count first, in its ink, then the group's total ("1 failing · 1 place", "5 waiting · 6 places") */
	const countOf = (g: (typeof groups)[number]): { text: string; ink: string }[] => { const cnt = (f: (p: Place) => boolean) => g.rows.filter((r) => f(r.p)).reduce((n, r) => n + 1 + r.also.length, 0); const w = cnt((p) => p.kind === 'waiting' && p.group !== 'held'), h = cnt((p) => p.kind === 'waiting' && p.group === 'held'), f = cnt((p) => p.kind === 'failed' || !!p.newerFails); return [...(f ? [{ text: `${f} failing`, ink: 'text-danger' }] : []), ...(w ? [{ text: `${w} waiting`, ink: 'text-held' }] : []), ...(h ? [{ text: `${h} held`, ink: 'text-held' }] : []), { text: plural(cnt(() => true), 'place'), ink: 'text-fg-subtle' }]; };
	/* the relation is the subheader's one fact that never truncates (AD r2 4); on a phone it is its short form */
	const relOf = (g: (typeof groups)[number], short = false) => g.own ? (short ? 'own build' : 'this change\u2019s own build') : !g.carries ? (g.rows.some((r) => notReached(r.p, scenario) !== null) ? 'does not carry it yet' : 'does not carry it') : !g.newer ? 'carries it' : short ? `+${g.newer} newer` : `carries it · +${g.newer} newer change${g.newer === 1 ? '' : 's'}`;
</script>

{#snippet links()}
	{#if ext}<a href={ext} target="_blank" rel="noopener noreferrer" class="btn btn-secondary" data-link="pr"><GithubSolid class="h-4 w-4" aria-hidden="true" />{c.prHref ? 'Open PR' : 'Open commit'}<span aria-hidden="true">↗</span></a>{/if}
	{#if checks?.href}<a href={checks.href} target="_blank" rel="noopener noreferrer" class="btn btn-secondary" data-link="checks">CI checks<span aria-hidden="true">↗</span></a>{/if}
{/snippet}

<div class="w-full px-4 py-6 tabular-nums sm:px-6" data-change-detail data-truth-kind="change-detail" data-truth-state={st.kind} data-truth-ref={c.refLabel} data-truth-author={c.author ?? ''} {...changeTruth(c, scenario)}>
	<PageHeader title={c.title}>
		{#snippet titleAfter()}
			<!-- r4: the state beside the title, only when adverse (the strip and the banner say the rest); one coloured chip -->
			{#if st.kind === 'failed'}<Chip role="issue" label="Failing" />{:else if st.kind === 'waiting' || st.kind === 'held'}<Chip role="held" label={st.kind === 'held' ? 'Held' : 'Waiting'} />{/if}
		{/snippet}
		{#snippet meta()}
			<!-- the lead row's facts (CF8): merged ago · people with roles · the 20 mono build the change is in · diffstat · commits; below 640 the people are the author only and the header-row links follow -->
			<!-- changedetail-8 CD8: a two-slot row: "Merged 5h ago" left, the author's face and login right; "merged by X" (only when the merger is not the author) and the links on the second line below lg -->
			<!-- r34 r2: at most THREE facts, one .dot-list (never typed "·"): merged ago | people | the build; the diffstat and the files live in the Commits card, the links drop under the meta below lg -->
			<div class="flex min-w-0 flex-col gap-1" data-meta-block>
				<div class="dot-list min-w-0"><div class="dot-list-row flex items-center gap-y-1 max-sm:flex-nowrap sm:flex-wrap">
					<span class="whitespace-nowrap" data-meta>{c.prNumber != null ? 'Merged' : 'Committed'} {ago(c.mergedAt)} ago</span>
					{#if mine}<span data-people>yours</span>{:else if byWho}<span class="inline-flex min-w-0 items-center gap-2" data-people><Avatar name={byWho} src={avatarSrc(byWho)} size={24} /><span class="min-w-0 truncate">{byWho}{#if mergedBy}<span class="text-fg-subtle max-sm:hidden" data-merged-by>{' '}(merged by {c.author})</span>{/if}</span></span>{/if}
					{#if head.build && head.build !== ref}<span class="t-code whitespace-nowrap text-fg" data-head-build>{head.build}</span>{/if}
				</div></div>
				<span class="flex flex-wrap items-center gap-x-4 lg:hidden" data-header-links>
					{#if ext}<a href={ext} target="_blank" rel="noopener noreferrer" class="nav-link inline-flex min-h-11 items-center max-sm:-my-1" data-link="pr-phone"><GithubSolid class="mr-1.5 h-4 w-4" aria-hidden="true" />{c.prHref ? 'Open PR' : 'Open commit'}<span aria-hidden="true" class="ml-1">↗</span></a>{/if}
					{#if checks?.href}<a href={checks.href} target="_blank" rel="noopener noreferrer" class="nav-link inline-flex min-h-11 items-center whitespace-nowrap max-sm:-my-1" data-link="checks-phone">CI checks<span aria-hidden="true" class="ml-1">↗</span></a>{/if}
				</span>
			</div>
		{/snippet}
		{#snippet actions()}
			<span data-desktop-only class="contents">{@render links()}</span>
		{/snippet}
		{#snippet below()}
			<div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
				{#if tiles.length}<ChangeStrip {tiles} change={c} {scenario} />{/if}
			</div>
		{/snippet}
	</PageHeader>

	<div class="mt-6 max-sm:mt-4 empty:hidden" data-statement>
		{#if st.kind === 'failed' && check}
			<!-- changedetail-9 CE8: the tab's set and order for a failed deploy: [Retry] [Roll back] + the quiet "Open rollout ›"; r34 S1a: the shared StatementBanner owns the shell and the phone action row -->
			<StatementBanner severity="failed" title={failTitle} {check}
				phoneMax={1}
				primary={backHref ? { label: 'Roll back', title: back ? `Roll back to ${back}` : undefined, href: backHref, icon: UndoOutline, key: 'rollback' } : undefined}
				secondary={lead ? [{ label: 'Retry', href: lead.href, icon: PlaySolid, iconClass: 'h-5 w-5', key: 'retry' }, { label: 'Open rollout', href: lead.href, quiet: true, key: 'open-rollout' }] : []} />
		{:else if (st.kind === 'waiting' || st.kind === 'held') && lead}
			<!-- the tab's held banner: the held hue with the pause disc; ONE button, and it says what it does: it navigates (CF1) -->
			<StatementBanner severity="held" title={st.title} message={st.line ?? (st.kind === 'held' && lead.row ? (holdWord(lead.row, scenario) ?? undefined) : undefined)} messageDesktopOnly={st.kind !== 'held'}
				primary={approve ? (approveAct(lead.row ? approvalTarget(lead.row, scenario) : null, { icon: CheckOutline }) ?? { label: 'Approve', href: actionHref(approve), icon: CheckOutline, key: 'approve' }) : undefined}
				secondary={[{ label: 'Open rollout', href: lead.href, ...(approve ? { quiet: true } : {}), key: 'open-rollout' }]} />
		{:else if st.kind === 'landed' || st.kind === 'healthy'}
			<!-- CG10: no "Live in 3 prod regions" band: the strip's marks and the Places' rollup say it; a band that restates them costs a card -->
		{:else}
			<div class="flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3">
				<span class="flex h-6 items-center"><StatusMark state={'newest' as never} /></span>
				<div class="min-w-0"><p class="t-heading text-fg" data-statement-title>{st.title}</p></div>
			</div>
		{/if}
	</div>

	<!-- the tab's main/rail split (BUILD-R4): 3fr / minmax(22rem, 2fr), 16px gap; past 2300 the four cards are composed by height: Where it runs | History | Summary over Change (AD r2 6); past 3400 the first column caps at the 1150px row width -->
	<div class="cd-split mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-[3fr_minmax(22rem,2fr)] lg:items-start">
		<div class="cd-main flex min-w-0 flex-col gap-4">
			<!-- WHERE IT RUNS (r4, the centrepiece): the places that run a build carrying this change, grouped by build; a 36px subheader says what the build is to the change -->
			<Group icon={MapPinAltOutline} title="Where it runs" rollup={whereRollup} adverse={whereAdverse} held={whereHeld} class="cd-focal" id="where-it-runs">
				{#each groups as g (g.key)}
					<li class="cd-bld" data-build-group={g.build} data-build-carries={g.carries ? '' : undefined}>
						<div class="cd-bh flex h-9 items-center gap-3 bg-subtle px-4"><span class="w-4 shrink-0" aria-hidden="true"></span><span class="dot-list min-w-0 flex-1"><span class="dot-list-row flex min-w-0 items-baseline">{#if multiApp}<span class="t-meta inline-flex shrink-0 items-center gap-1 text-fg-muted"><AppGlyph name={g.app} size={16} class="shrink-0" />{g.app}</span>{/if}<span class="t-code-sm shrink-0 text-fg" data-build-id>{g.build}</span><span class="t-meta whitespace-nowrap text-fg-subtle {multiApp ? 'min-w-0 truncate sm:shrink-0' : 'shrink-0'}"><span class="sm:hidden">{relOf(g, true)}</span><span class="max-sm:hidden">{relOf(g, false)}</span></span>{#if g.newest && !noReleases}<span class="t-meta shrink-0 text-fg-subtle max-sm:hidden">newest</span>{/if}</span></span><span class="dot-list shrink-0"><span class="dot-list-row flex items-baseline whitespace-nowrap">{#each countOf(g) as k (k.text)}<span class="t-meta tabular-nums {k.ink}" data-build-count>{k.text}</span>{/each}</span></span></div>
						<ul class="divide-y divide-line-subtle">
							{#each g.rows as r (r.p.href)}{@const i = rows.indexOf(r)}<ChangePlaceRow place={r.p} also={r.also} {scenario} open={i === 0 && leadOpen} canOpen={g.carries} landed={c.group === 'landed'} {reserve} inStatement={i === 0 && (st.kind === 'failed' || st.kind === 'waiting' || st.kind === 'held')} changeCommit={cm.commits[0] ? { title: cm.commits[0].title, author: cm.commits[0].author } : null} omitTitle={c.title} />{/each}
						</ul>
					</li>
				{/each}
				{#if !places.length && !cl.unaffected.length}
					<li class="flex items-start gap-3 px-4 py-3"><MapPinAltOutline class="h-5 w-5 shrink-0 text-fg-disabled" aria-hidden="true" /><div><p class="t-ui text-fg">Not running anywhere yet</p><p class="t-meta mt-0.5 text-fg-subtle">A place shows here once a build that carries this change reaches it.</p></div></li>
				{/if}
			</Group>
			<ChangeCard commits={cm.commits} stat={head.stat} checkText={checkText} class="cd-change" />
		</div>
		<aside class="cd-rail grid min-w-0 gap-4 lg:sticky lg:top-6 lg:flex lg:flex-col" aria-label="What holds this change and what happened to it">
			{#if holds.some((h) => h.rows.length > 1 || h.rows[0]?.href !== lead?.href)}<HoldingCard {holds} class="cd-hold" />{/if}
			<ChangeHistory {events} {multiApp} class="cd-history" />
			<Card icon={ChartLineUpOutline} title="Summary" verdict="{ago(c.mergedAt)} since {c.prNumber != null ? 'merge' : 'commit'}" padded={false} class="cd-summary">
				<dl class="divide-y divide-line-subtle">
					{#each [[`${c.prNumber != null ? 'Merged' : 'Committed'} to first deploy`, how.toFirst ?? 'not deployed yet'], ...(how.toProd || prod.of <= 1 ? [[`${c.prNumber != null ? 'Merged' : 'Committed'} to production`, how.toProd ?? (noReleases ? `won't reach production: ${noReleases.label.toLowerCase()}` : 'not in production yet')]] : []), ...(prod.of > 1 ? [[multiApp ? 'Production places running it' : 'Production regions running it', `${prod.healthy} of ${prod.of}`]] : []), ...(how.failed ? [['Failed deploys', String(how.failed)]] : [])] as [k, v] (k)}
						<div class="flex items-baseline justify-between gap-3 px-4 py-3"><dt class="t-meta text-fg-subtle">{k}</dt><dd class="t-ui tabular-nums {k === 'Failed deploys' && how.failed ? 'text-danger' : 'text-fg'}">{v}</dd></div>
					{/each}
				</dl>
			</Card>
		</aside>
	</div>
</div>

<style>
	.cd-main { container: cdm / inline-size; }
	/* the build subheader: 36px, the rows' text x (16 pad + 16 mark + 12 gap), a hairline under it; the next group gets 4px of air above */
	.cd-bh { border-bottom: 1px solid var(--k-line-subtle); }
	.cd-bld + .cd-bld .cd-bh { margin-top: 4px; }
	/* the 4K rule (mock NOTES): the row is the cap, not the page. >= 2300 the main is 2-up (Where it runs | Change, each under the ~1150px row cap) and the rail 2-up (History | Summary); AD r1 (6): no lone card, no 2100px row */
	@media (min-width: 2300px) {
		/* the four cards become items of ONE grid, placed by height: Where it runs | History | Summary over Change (and Holding above them when it exists); no lone card, no 2100px row */
		.cd-main, .cd-rail { display: contents !important; }
		.cd-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(22rem, 2fr) minmax(22rem, 2fr); grid-template-areas: 'where history summary' 'where history change' 'where history hold' 'where history .'; grid-template-rows: max-content max-content max-content 1fr; align-items: start; }
		/* the spanning cards (where, history) size the 1fr row, so the third column's cards stack from the top (max-content rows take only their own card) */
		.cd-split :global(.cd-focal) { grid-area: where; }
		.cd-split :global(.cd-history) { grid-area: history; }
		.cd-split :global(.cd-hold) { grid-area: hold; }
		.cd-split :global(.cd-summary) { grid-area: summary; }
		.cd-split :global(.cd-change) { grid-area: change; }
	}
	@media (min-width: 3400px) { .cd-split { grid-template-columns: minmax(0, 1fr) minmax(22rem, 760px) minmax(22rem, 760px); } }
</style>
