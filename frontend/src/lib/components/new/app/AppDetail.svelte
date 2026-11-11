<script lang="ts">
	/**
	 * r34 v2 AD — APP DETAIL (/apps/<name>): "Where does this app run, which build is where, what is failing or waiting, and
	 * what is the next build to arrive?" The list's object (the Apps lead Facia) reappears at page scale; the tabs' grammar
	 * carries it: header (24 name · 20 mono build · the tab's pill · star · meta with Avatar + commit title) → the tab's env
	 * strip at full width → the statement (AlertPanel) when a place fails → main + rail.
	 *
	 * REFERENCE REGIONS (named, then reused): the rollout Overview header (name / build + pill, meta line, PromotionLane strip),
	 * its banner (AlertPanel unwrapped), Rollouts' card of RolloutRow rows with the lead opened as the Slipway, the Overview's
	 * Newer-builds rows (AppBuilds), Rollouts' rail (HoldingCard) and the product's How it's going / Recent activity cards.
	 * NEW BY DESIGN: only the composition — the header is the Facia's lead head at page scale. The Facia itself is a list tile
	 * (an <li> with its own frame and state panel), so the header is built from the SAME parts (laneOf + PromotionLane, the
	 * data.ts deployedBuild / newestBuild / stateWord, the Facia's one-place-in-focus rule), not by importing the tile.
	 * Lineage: the Apps lead tile (r34 v2). Proportions: the Overview header at y121–243.
	 *
	 * RETIRED ON THIS BRANCH: the old live-query page body (a 4,000-line Direction-B page: Needs-you task blocks, Promotion
	 * pipeline, exposure bar). Facts come from new/data.ts keyed by the route param, so the page agrees with the Apps tile and the
	 * tabs. The live /api/rollouts query survives ONLY to hand ChangeVersionModal a real Rollout and to feed the rail's
	 * How it's going / Recent activity cards, which read rollout histories.
	 * v2 r2 (AD): the statement is the Apps tile's own (AlertPanel + FailedCheckLine + Retry · Roll back · Open rollout), the strip is the
	 * tab's at 156px tiles with "All environments ›", Places = ONE row per place (RolloutRow subject="app", healthy ones closed) under a
	 * band of production region cells (RegionBand), Builds says where a build runs and offers ONE Deploy per place, the rail's Holding lists
	 * this app's own gates incl. approvals (AppGates). Every hold sentence comes from app-model.ts over data.ts placeHolds/gatesOf.
	 * r34 builds-lag (B): Places + Builds are ONE card, the Sounding ledger (AppBuilds): the app's build sequence with every place standing once on the build it runs; the lag is the place's position in it. Approve is the statement's on the phone and a btn-xs on the place row from sm up.
	 * ONE PRIMARY: Roll back, in the statement; the opened row keeps Open rollout only.
	 */
	import { siteCount, regionsPhrase } from '$lib/view-models/regions';
	import { approveAct } from '../approvals.svelte';
	import { page } from '$app/state';
	import { createQuery, createQueries } from '@tanstack/svelte-query';
	import { publishHeldHere, heldKeyOfHref } from '$lib/view-models/held-here.svelte';
	import { heldHereOfDetail } from '$lib/view-models/held-here';
	import { publishGatePretty } from '$lib/view-models/gate-pretty.svelte';
	import { prettyMapOf } from '$lib/view-models/gate-pretty';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Card from '$lib/components/Card.svelte';
	import StatementBanner from '$lib/components/StatementBanner.svelte';
	import StarToggle from '$lib/components/StarToggle.svelte';
	import PromotionLane from '$lib/components/PromotionLane.svelte';
	import ChangeVersionFlow from '$lib/components/ChangeVersionFlow.svelte';
	import NotFound from '$lib/components/NotFound.svelte';
	import { CodeBranchOutline, ClockOutline, ChevronRightOutline, UndoOutline, CheckOutline, PlaySolid } from 'flowbite-svelte-icons';
	import { rolloutsListQueryOptions, clusterInfoQueryOptions, rolloutQueryOptions } from '$lib/api/rollouts';
	import { apiPath } from '$lib/api/urls';
	import { now } from '$lib/stores/time';
	import { href } from '$lib/paths';
	import type { Rollout } from '../../../../types';
	import { lagFit } from './lag-fit';
	import AppBuilds, { type PlaceView } from './AppBuilds.svelte';
	import AppGates from './AppGates.svelte';
	import AppPulse from './AppPulse.svelte';
	import AppActivity from './AppActivity.svelte';
	import { laneOf, approvalOf } from '../Footprint.svelte';
	import { apps, heldHere, ago, approvalTarget, appHolds, avatarSrc, deployedBuild, tabPill, heldCauses, shortBuild, urgencyClass, checkClock, placeHolds, gatesOf, rowsOf, stepsOf, type HomeState, type TRow, type PlaceHold } from '../data';
	import { rowAction, plural, actionHref, VIEWER, tabEnv, envTheme } from '../rollout-view';
	import { approvalIn, rowPlaceName } from '../state-words';
	import { rolloutStateChip } from '$lib/view-models/rollout-state-chip';
	import { approvalMessage, pillOf, buildsOf, holdRows, ledgerOf, pinnedPlaces, newerThan, placesInPillState, placesPhrase, tierRank } from './app-model';

	let { state: scenario, name }: { state: HomeState; name: string } = $props();

	const A = $derived(apps(scenario));
	const item = $derived(A.items.find((a) => a.app === name) ?? null);
	const built = $derived(item ? laneOf(item, A.R.c.m as never, A.R.c.events as never) : null);
	const approvals = $derived((A.R.groups.find((g) => g.key === 'approval')?.rows ?? []) as TRow[]);

	/* ── one row per PLACE: the model's row where the place has one (unfolded per region), else a closed healthy place ── */
	const places = $derived(placeHolds(name, scenario));
	/* round 2 B4: the held places' gate objects (the Gates tab's own source, same query key) give the pretty names the fleet list lacks */
	const heldPlaces = $derived(places.filter((p) => p.holdReason === 'approval' || p.holdReason === 'rule'));
	const gateQueries = createQueries(() => ({
		queries: heldPlaces.map((p) => { const [, , cluster, ns, nm] = p.href.split('/'); return rolloutQueryOptions({ namespace: ns, name: nm, cluster, options: { staleTime: 15000, retry: false } }); })
	}));
	$effect(() => { gateQueries.forEach((q, i) => { const h = heldPlaces[i]?.href; const key = h ? heldKeyOfHref(h) : null; if (!q.data || !key) return; const [, , cluster, ns] = (h as string).split('/'); publishGatePretty(cluster, ns, prettyMapOf(q.data.rolloutGates)); publishHeldHere(key, heldHereOfDetail(q.data as never)); }); });
	const gates = $derived(gatesOf(name, scenario));
	const rowFor = (p: PlaceHold): TRow => {
		const un = rowsOf(scenario, p.tier, p.label).find((r) => r.app === name);
		if (un) {
			/* an unfolded region only carries the action that targets ITS rollout (Approve acts on the first of a folded row's regions) */
			const own = un.action && un.action.href === p.href ? un.action : null;
			return own === un.action ? un : { ...un, action: own, needsYou: un.needsYou && !!own };
		}
		const dep = deployedBuild({ app: name, href: p.href, version: p.runs });
		return {
			key: `${name}@${p.env}`, app: name, tier: p.tier, where: p.place, regions: p.tier === 'prod' ? [p.label] : [], state: p.state, group: 'rest', glyph: 'rest', word: '', change: null,
			version: p.runs, since: dep.at, href: p.href, needsYou: false, lead: false, action: null, cause: null, pipeline: null,
			steps: stepsOf({ state: 'healthy', pipeline: null }).map((s) => ({ ...s, state: 'done' as const })), failure: null, place: p.place, deployedAt: dep.at, regionsOf: null, stillChecking: false
		} as unknown as TRow;
	};
	/* apps-12 AT6: nothing adverse (every place at rest) = the PIPELINE's order (dev → test → staging → prod); otherwise production first, then the most urgent */
	const placeRows = $derived.by(() => {
		const all = places.map((p) => ({ p, r: rowFor(p) }));
		const quiet = all.every((x) => urgencyClass(x.r) >= 4);
		return all
			.sort((a, b) => quiet
				? tierRank(a.p.tier) - tierRank(b.p.tier) || a.p.label.localeCompare(b.p.label)
				: Number(b.p.tier === 'prod') - Number(a.p.tier === 'prod') || urgencyClass(a.r) - urgencyClass(b.r) || (urgencyClass(a.r) < 5 ? (b.r.since ?? '').localeCompare(a.r.since ?? '') : 0) || tierRank(a.p.tier) - tierRank(b.p.tier) || a.p.label.localeCompare(b.p.label))
			.map((x) => x.r);
	});
	/* AA4 + builds-lag: the statement owns Roll back (a failing app) once; Approve is the statement's at every width (owner 2026-11-08: one Approve, like the change page); a place row carries none unless a failure owns the banner */
	const ownedByStatement = (r: TRow): TRow => ((r.group === 'approval' && !failRow) || (failRow && r.key === failRow.key) ? { ...r, action: null } : r);
	const rows = $derived(placeRows.filter((r) => r.group !== 'rest'));
	const failing = $derived(placeRows.filter((r) => r.group === 'failed'));
	/* AA4: the statement (a waiting app) owns Approve, once; a row of an approval place carries no second one */
	const calm = $derived(scenario !== 'incident' && !failing.length);
	/* the open thing is the first row in every state (a fully healthy app opens nothing) */
	const leadKey = $derived(rows[0]?.key ?? null);
	/* owner §5: on the phone the lead place shows its short version (state line + next build) and the step pane waits behind its chevron; from sm up the lead's pane is open. One open at a time. */
	let phone = $state(typeof matchMedia !== 'undefined' && matchMedia('(max-width: 639px)').matches);
	$effect(() => { const mq = matchMedia('(max-width: 639px)'); phone = mq.matches; const f = () => (phone = mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); });
	let picked = $state<string | null | undefined>(undefined);
	const openKey = $derived(picked !== undefined ? picked : phone ? null : leadKey);
	const flip = (k: string) => (picked = openKey === k ? null : k);
	/* AP1: the strip is the tab's: each node's lag is the tab's "N newer builds" of THAT place (staging "2 builds behind", prod "19 builds behind"), never the app-wide history's count */
	const lane = $derived.by(() => {
		if (!built) return null;
		const L = built.lane;
		const swap = new Map<unknown, typeof L.stages[number]>();
		const fix = (n: typeof L.stages[number]) => {
			const k = places.find((x) => x.href === hrefFor(n))?.heldBuilds.length ?? 0;
			const m = k ? { ...n, behind: k } : n;
			swap.set(n, m);
			return m;
		};
		const byTier = Object.fromEntries(Object.entries(L.byTier).map(([t, ns]) => [t, (ns ?? []).map(fix)])) as typeof L.byTier;
		return { ...L, byTier, stages: L.stages.map((n) => swap.get(n) ?? n), prod: L.prod.map((n) => swap.get(n) ?? n), lead: L.lead ? swap.get(L.lead) ?? L.lead : null };
	});

	/* the Facia's one-place-in-focus rule: an approval row for an app outside the needs band, else the app's worst row, else its first production place */
	const attention = $derived(!!item && (item.group === 'needs' || !!approvalOf(item, approvals)));
	const appr = $derived(item && attention && item.group !== 'needs' ? approvalOf(item, approvals) : null);
	const stateRow = $derived(appr?.row ?? item?.row ?? null);
	/* AP5: ONE header subject in every scenario: what PRODUCTION runs (the most urgent prod place), never the dev/test place a routine deploy is moving through; an app with no prod place falls back to the Facia's focus */
	/* apps-12 AT1: the headline place is app-model's pillOf (the Facia reads the same function) */
	const headPill = $derived(pillOf(places, scenario));
	const prodFocus = $derived(headPill ? placeRows.find((r) => r.href === headPill.place.href) ?? null : null);
	const focus = $derived.by(() => {
		if (!item) return null;
		if (prodFocus) return { app: item.app, href: prodFocus.href, version: prodFocus.version, state: prodFocus.state, word: prodFocus.word };
		if (stateRow) return { app: item.app, href: stateRow.href, version: stateRow.version, state: stateRow.state, word: stateRow.word };
		const p = item.placeList.find((x) => x.tier === 'prod') ?? item.placeList[0];
		return p ? { app: item.app, href: p.href, version: p.version, state: p.state, word: '' } : null;
	});
	const dep = $derived(focus ? deployedBuild(focus as never) : null);
	const build = $derived(dep?.build || focus?.version || '');
	const commit = $derived(dep?.title ? { title: dep.title, who: dep.author } : null);
	/* AA2: the header describes the PRINTED build, as the tab does: the tab's pill (the deployed entry's own bake word, so a build held in prod still reads DEPLOYED), the tab's age (when it deployed),
	   and the builds newer than IT at the focus place — a newest build says no "N newer builds" */
	const pill = $derived(headPill ? { word: headPill.word, role: headPill.role } : null);
	const age = $derived(ago(dep?.at));
	const focusPlace = $derived(places.find((p) => p.href === focus?.href) ?? null);
	const newer = $derived(focusPlace?.heldBuilds.length ?? 0);
	/* AP2: "in <places>" lists only the places that run this build IN THE PILL'S STATE (FAILED in production, not in every place the build also runs healthy) */
	const runsAt = $derived(build ? placesInPillState(places, build, pill?.word ?? '') : []);
	/** r2 apps fix 8: where the pill's build runs, as JOINED env badges ([PROD | eu-west]; several prod regions fold to [PROD | 3 regions]) */
	const runsBadges = $derived.by(() => {
		const out: { label: string; theme: ReturnType<typeof envTheme> }[] = [];
		const prod = runsAt.filter((x) => x.tier === 'prod');
		const prodRegions = regionsPhrase(siteCount(prod.map((x) => x.label)), 'prod');
		if (prodRegions) out.push({ label: prodRegions, theme: envTheme('prod') });
		const seen = new Set<string>();
		for (const x of runsAt) {
			if (x.tier === 'prod' && prodRegions) continue;
			const lab = tabEnv({ tier: x.tier, label: x.label }).replace(/^production$/, 'prod');
			if (seen.has(lab)) continue;
			seen.add(lab);
			out.push({ label: tabEnv({ tier: x.tier, label: x.label }).replace(/^production$/, 'prod'), theme: envTheme(x.tier) });
		}
		return out;
	});
	const runsPhrase = $derived(placesPhrase(runsAt.map((x) => { const n = tabEnv({ tier: x.tier, label: x.label }); return n === 'production' ? 'prod' : n; }), runsAt.map((x) => x.tier)));
	/* AP3: ONE baseline for every count: the builds the focus place still lacks (the tab's "N newer builds") */
	const only = $derived(newerThan(focusPlace, places));
	const builds = $derived(buildsOf(places, only));
	const stops = $derived(ledgerOf(places));
	const pins = $derived(pinnedPlaces(item?.holds ?? []));
	/* how the ledger draws each place: the model's row (Roll back stays the statement's), the Approve it owns from sm up, its pipeline toggle */
	const view = (p: PlaceHold): PlaceView => {
		const r = ownedByStatement(placeRows.find((x) => x.href === p.href) ?? rowFor(p));
		const approve = !phone && r.action?.kind === 'approve' ? r.action : null;
		const act = rowAction(r);
		return { row: r, pinned: pins.has(p.place), approve, slipAction: r.group === 'failed' || act?.kind === 'approve' ? null : act, toggle: r.group === 'rest' ? null : () => flip(r.key), open: r.key === openKey };
	};
	const gateRows = $derived(holdRows(gates, places, only, name).filter((r) => r.holding && r.held.length > 0));
	const current = $derived.by(() => { const h = (focus?.href ?? '').split('/').filter(Boolean); return h[0] === 'rollouts' ? { ns: h[2], name: h[3] } : null; });

	/* the wait line (a waiting or held app): the Facia lead's words, from the same helpers */
	const holds = $derived(item ? appHolds(item, scenario) : []);
	const factLine = $derived(item && item.approval && holds.some((h) => h.approval) ? [] : item ? [item.fact] : []);
	const outcomeText = $derived([...factLine, ...holds.map((h) => h.text).filter((h) => !item?.fact.includes(h))].join(' · '));
	const apprText = $derived(appr?.text ?? holds.find((h) => h.approval)?.text ?? '');
	const parts = $derived(appr ? [apprText, ...(item?.approval ? [] : item ? [item.fact] : [])] : item?.group === 'quiet' ? [item.fact] : outcomeText.split(' · '));
	const cause = $derived(parts.slice(1).join(' · ') || null);
	const waitsOnApproval = $derived(!!stateRow && stateRow.group === 'approval');
	const waitAct = $derived(waitsOnApproval && stateRow ? rowAction(stateRow) : null);
	/* AP13: the statement says what waits and who can release it, once; "Nothing promotes itself until someone approves it" is the tab banner's sentence and is not repeated here */
	/* apps-10 AR3: ONE short sentence for every waiting app, whoever can approve (checkout-edge and payments-core say the same) */
	/* apps-10 AR5: a Checking focus place says Checking (+ the tab's clock), as the pill and the strip do */
	const checkingNow = $derived(waitsOnApproval && !!stateRow && tabPill({ href: stateRow.href }).word === 'CHECKING');
	const checkLeft = $derived(checkingNow && stateRow ? checkClock({ href: stateRow.href, state: 'checking', group: 'rest' } as never) : null);
	/* round 2 B5: the count is what the place's hold refuses HERE (heldHere), not every candidate queued for it */
	const heldN = $derived(stateRow ? (heldHere(stateRow.href)?.count ?? null) : null);
	const waitMessage = $derived(checkingNow ? (checkLeft ?? 'The health checks are running.') : waitsOnApproval ? approvalMessage(heldN, places.find((p) => p.href === stateRow?.href) ?? null, places) : cause);

	/* the statement = the Apps tile's own: the failing place (the lead, else the first), its check line, Roll back (+ Retry, as the tab offers) + Open rollout */
	const failRow = $derived(failing.find((r) => r.lead) ?? failing[0] ?? null);
	const failCheck = $derived(failRow?.failure ? { name: failRow.failure.check ?? failRow.failure.line, message: failRow.failure.check ? (failRow.failure.message ?? undefined) : undefined } : null);
	const failAct = $derived(failRow ? rowAction(failRow) : null);
	let retry = $state<'idle' | 'busy' | 'done' | 'error'>('idle');
	async function retryDeploy(r: TRow) {
		const p = r.href.split('/').filter(Boolean);
		retry = 'busy';
		try {
			const res = await fetch(apiPath(p[1], `/rollouts/${p[2]}/${p[3]}/retry`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kruiseRolloutName: '', testAction: '' }) });
			retry = res.ok ? 'done' : 'error';
		} catch { retry = 'error'; }
		setTimeout(() => (retry = 'idle'), 3000);
	}
	const hrefFor = (n: { card: unknown }) => (n.card as { href?: string }).href ?? '';

	/* ── the live rollouts: ONLY for the rail's histories and the Deploy dialog ── */
	const query = createQuery(() => rolloutsListQueryOptions({ options: { staleTime: 10_000, refetchInterval: 15_000 } }));
	const clusterQuery = createQuery(() => clusterInfoQueryOptions());
	const keyOf = (h: string) => { const p = h.split('/').filter(Boolean); return `${p[2]}/${p[3]}`; };
	const live = $derived.by<Rollout[]>(() => {
		const keys = new Set((item?.placeList ?? []).map((p) => keyOf(p.href)));
		return (query.data?.rollouts?.items ?? []).filter((r) => keys.has(`${r.metadata?.namespace}/${r.metadata?.name}`));
	});
	const environments = $derived(query.data?.environments?.items ?? []);
	const SPARK_DAYS = 7;
	const deploys7d = $derived.by(() => {
		const end = $now.getTime(), start = end - SPARK_DAYS * 86_400_000;
		let n = 0;
		for (const r of live) for (const h of r.status?.history ?? []) { const t = h.timestamp ? new Date(h.timestamp).getTime() : NaN; if (t >= start && t <= end) n++; }
		return n;
	});

	/* ── Deploy (ChangeVersionModal, as the product offers it) ── */
	let modalOpen = $state(false);
	let modalRollout = $state<Rollout | null>(null);
	let modalVersion = $state<string | null>(null);
	let modalExplanation = $state('');
	let modalCluster = $state<string | undefined>(undefined);
	function openDeploy(pl: PlaceHold, buildId: string) {
		const key = keyOf(pl.href);
		const r = live.find((x) => `${x.metadata?.namespace}/${x.metadata?.name}` === key);
		if (!r) return;
		const cand = (r.status?.releaseCandidates ?? []).find((c) => c.tag === buildId || shortBuild(c.version ?? c.tag ?? '') === buildId);
		modalRollout = r;
		modalVersion = cand?.tag ?? null;
		modalExplanation = `Deploy ${buildId} to ${pl.place}.`;
		modalCluster = pl.href.split('/').filter(Boolean)[1] || clusterQuery.data?.name || undefined;
		modalOpen = true;
	}
</script>

{#if !item}
	<div class="w-full px-4 py-6 sm:px-6">
		<NotFound eyebrow="App" title={name} headline="This app does not exist" nextStep="No rollout references it. Pick one from the list of apps." backHref={href('/apps')} backLabel="Back to apps" />
	</div>
{:else}
	<div class="w-full px-4 py-6 sm:px-6" data-app-detail data-truth-kind="app-detail" data-truth-app={item.app} data-truth-build={build} data-truth-pill={pill?.word ?? ''} data-truth-fact={item.fact}>
		<!-- HEADER = the Facia's lead head at page scale: 24 name · 20 mono build · the tab's pill · star; meta: Avatar + commit title · newer builds, held per place · age; then the tab's strip -->
		<header class="flex min-w-0 flex-col gap-3">
			<div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
				<AppGlyph name={item.app} size={24} />
				<h1 class="t-title min-w-0 break-words text-fg">{item.app}</h1>
				<StarToggle app={item.app} class="max-sm:!h-11 max-sm:!w-11 max-sm:-mx-2 max-sm:-my-3.5" />
				<span class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 max-lg:basis-full">
					{#if build}<span class="t-meta text-fg-disabled max-lg:hidden" aria-hidden="true">/</span><span class="t-code-lg shrink-0 text-fg" data-ad-build>{build}</span>{/if}
					{#if pill}<Chip role={pill.role as never} label={pill.word.toLowerCase()} class="shrink-0" />{/if}
					{#if build && runsBadges.length}<span class="t-meta text-fg-subtle">in</span><span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" data-ad-runs title={runsPhrase}>{#each runsBadges as b (b.label)}<Chip role="env" theme={b.theme} label={b.label} wide />{/each}</span>{/if}
				</span>
				<a href={href('/environments')} class="nav-link t-ui-sm ml-auto shrink-0 !py-0 max-sm:hidden xl:hidden">All environments<ChevronRightOutline class="h-3 w-3" aria-hidden="true" /></a>
			</div>
			{#if commit || newer || age}
				<!-- r2 apps fix 8: at most THREE facts, all on the left, in one reading order: the commit (who, title; the title gives way), when it deployed, how many builds are newer -->
				<div class="t-meta flex min-w-0 items-center gap-x-3 text-fg-muted" data-ad-meta>
					{#if commit}
						<span class="flex min-w-0 items-center gap-2">
							{#if commit.who && commit.who !== VIEWER}<Avatar name={commit.who} src={avatarSrc(commit.who)} size={16} class="shrink-0 max-sm:hidden" />{/if}
							{#if commit.who}<span class="shrink-0 whitespace-nowrap max-sm:sr-only">{commit.who === VIEWER ? 'you' : commit.who}</span>{/if}
							<CodeBranchOutline class="h-3.5 w-3.5 shrink-0 text-fg-disabled max-sm:hidden" aria-hidden="true" /><span class="min-w-0 truncate text-fg-subtle max-sm:hidden" title={commit.title}>{commit.title}</span>
						</span>
					{/if}
					{#if age}<span class="inline-flex shrink-0 items-center gap-2 whitespace-nowrap tabular-nums text-fg-subtle"><ClockOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />deployed {age} ago</span>{/if}
					{#if newer}<span class="shrink-0 whitespace-nowrap text-fg-subtle" data-ad-newer>{plural(newer, 'newer build')}</span>{/if}
				</div>
			{/if}
			{#if built && lane}
				<div class="ad-strip flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1" data-ad-strip>
					<div class="min-w-0 basis-full sm:flex-1 sm:basis-0" use:lagFit><PromotionLane {lane} showApp={false} {calm} words yours={!!stateRow?.needsYou} mutedRest {hrefFor} {current} /></div>
					<a href={href('/environments')} class="nav-link t-ui-sm shrink-0 !py-0 max-sm:min-h-11 max-sm:items-center sm:max-xl:hidden">All environments<ChevronRightOutline class="h-3 w-3" aria-hidden="true" /></a>
				</div>
			{/if}
		</header>

		<div class="mt-6 flex flex-col gap-4">
			{#if !failRow && item.group !== 'quiet' && parts[0] && (waitsOnApproval || /^(Waits|Pinned|Held)/.test(parts[0]))}
				<!-- AA4: the wait is a statement in the tab's own box: the gate sentence, the one Approve the viewer can give (the tab's destination), Open rollout -->
				<div data-ad-statement data-ad-wait>
					<StatementBanner severity={checkingNow ? 'checking' : waitsOnApproval ? 'approval' : 'info'} title={checkingNow ? 'Checking' : waitsOnApproval ? approvalIn(!!stateRow?.needsYou, stateRow ? rowPlaceName(stateRow) : null) : parts[0]} message={waitMessage ?? undefined}
						primary={waitAct ? (approveAct(stateRow ? approvalTarget(stateRow, scenario) : null, { icon: CheckOutline }) ?? { label: 'Approve', href: actionHref(waitAct), icon: CheckOutline, key: 'approve' }) : undefined}
						secondary={stateRow ? [{ label: 'Open rollout', href: stateRow.href, key: 'open-rollout' }] : []} />
				</div>
			{/if}
			{#if failRow}
				<div data-ad-statement>
					<StatementBanner severity="failed" title="Deployment failed" check={failCheck ?? undefined} observations={failRow.failure?.observations}
						primary={failAct ? { label: 'Roll back', href: actionHref(failAct), icon: UndoOutline, key: 'rollback' } : undefined}
						secondary={[
							{ label: retry === 'done' ? 'Retry started' : retry === 'error' ? 'Retry failed' : 'Retry', onclick: () => retryDeploy(failRow), busy: retry === 'busy', icon: PlaySolid, key: 'retry' },
							{ label: 'Open rollout', href: failRow.href, after: true, key: 'open-rollout' }
						]} />
				</div>
			{/if}

			<div class="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start xl:grid-cols-[minmax(0,1fr)_452px]">
				<div class="flex min-w-0 flex-col gap-4">
					<div id="regions" class="ad-places scroll-mt-16" class:ad-owned={!!failRow}>
						<AppBuilds {stops} {places} {view} {phone} nested hs={scenario} onDeploy={openDeploy} />
					</div>
				</div>

				<aside class="flex min-w-0 flex-col gap-4 lg:sticky lg:top-6 lg:self-start" aria-label="{item.app} context">
					<AppGates rows={gateRows} />
					{#if deploys7d > 0}
						<AppPulse deploys={deploys7d} days={SPARK_DAYS} rollouts={live} />
					{/if}
					<AppActivity rollouts={live} {environments} limit={builds.length ? 6 : 4} />
				</aside>
			</div>
		</div>
	</div>

	<ChangeVersionFlow bind:open={modalOpen} rollout={modalRollout} isPinVersionMode={false} initialSelectedVersion={modalVersion} initialExplanation={modalExplanation} cluster={modalCluster ?? ''} />
{/if}

<style>
	/* the strip is the page's drawing: it takes the row (the bare lane keeps natural width on the Overview; here it stretches) */
	@media (min-width: 640px) { .ad-strip :global(.lane--bare .lane-chain) { width: 100%; } }
	/* apps-11 AS7: the opened place's facts span the pane — a wide pane (the 1920 Places card is ~1150px) lays the two fact lists side by side (the tab's facts grid), never a 400px column in a 800px void */
	@container (min-width: 1000px) {
		.ad-places :global(.sw-compact .sw-pane) { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: 'info info' 'b1 b2' 'act act'; column-gap: 32px; align-content: start; }
	}
</style>
