<svelte:options runes={true} />

<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { createQuery } from '@tanstack/svelte-query';
	import { rolloutsListQueryOptions } from '$lib/api/rollouts';
	import { fetchGithubStatus, githubStatusQueryKey } from '$lib/api/github';
	import { repoBody, revisionPath } from '$lib/version-utils';
	import {
		buildRevisionLedger,
		rankSentence,
		resolveRevision,
		type RepoLedger,
		type RevisionRow,
		type RevisionService,
		type RevisionSlot
	} from '$lib/view-models/revision-ledger';
	import {
		revisionCoverage,
		coverageSegments,
		coverageSwatch,
		type CoverageSlotVM
	} from '$lib/view-models/revision-coverage';
	import { formatTimeAgo } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import { Spinner } from 'flowbite-svelte';
	import { ArrowLeftOutline, TagOutline } from 'flowbite-svelte-icons';
	import CommitSummary from '$lib/components/CommitSummary.svelte';
	import ChangeVersionModal from '$lib/components/ChangeVersionModal.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import CoverageBar from '$lib/components/CoverageBar.svelte';
	import type { Rollout, Environment } from '../../../types';

	/**
	 * ONE REVISION — RELEASE COVERAGE.
	 *
	 * The page's three questions, from `.agents-context/design/REVISION-PAGES.md`:
	 *
	 *   1. How far has this build reached across the fleet? → the hero count and
	 *      the coverage bar, which is `fleet-explore.js` concept 07 verbatim:
	 *      *"a single coverage bar segments every environment into live / ahead /
	 *      behind — the release wavefront in one glance."*
	 *   2. What is each service running it as? → the bucket chips carry the
	 *      service beside the environment, and `What each service ships it as`
	 *      gives each service ONE rank against ITS OWN denominator. `newest of 4`
	 *      beside `newest of 37` is the whole point: those two services share a
	 *      source repo and ship independent streams.
	 *   3. What is stopping it going further? → the `Not yet` bucket names the
	 *      gate when there IS a gate list, states the observable when there is
	 *      not, and carries `Promote` wherever one is legal.
	 *
	 * WHAT THIS PAGE DELIBERATELY DOES NOT DO. No version ladder and no Gantt —
	 * both rejected, repeatedly, and the Gantt's tombstone is in `DESIGN.md`. No
	 * `heat(rank)` ramp and no stable colour per sha: the prototype has both and
	 * both are recorded as measured-failed. The bar's segments are BUCKETS, four
	 * status hues the budget already owns, not ranks.
	 */

	// The route is /versions/[...slug]; the slug is "<repo path>/<key>" where
	// the repo path is real path segments and the key is the final one. The key
	// is a REVISION now, but every historical link put a display label there, so
	// the resolver below takes either and rewrites the URL.
	function safeDecode(s: string): string {
		try {
			return decodeURIComponent(s);
		} catch {
			return s;
		}
	}
	const parsed = $derived.by<{ repoPath: string; key: string }>(() => {
		const raw = (page.params.slug as string) || '';
		const parts = raw.split('/').filter((s) => s.length > 0);
		const keyRaw = parts.pop() ?? '';
		return { repoPath: parts.map(safeDecode).join('/'), key: safeDecode(keyRaw) };
	});
	const repoPath = $derived(parsed.repoPath);
	const urlKey = $derived(parsed.key);

	const query = createQuery(() =>
		rolloutsListQueryOptions({ options: { staleTime: 10000, refetchInterval: 10000 } })
	);
	const rollouts = $derived<Rollout[]>(query.data?.rollouts?.items || []);
	const environments = $derived<Environment[]>(query.data?.environments?.items || []);

	const ledgers = $derived(buildRevisionLedger(rollouts, environments));
	const ledger = $derived.by<RepoLedger | null>(
		() => ledgers.find((l) => repoBody(l.repoKey) === repoPath) ?? null
	);

	/**
	 * RESOLUTION: REVISION FIRST, THEN LABEL.
	 *
	 * A 12-char slug, a 7-char sha pasted from a terminal and a full 40-char
	 * revision all resolve as prefixes of the same string; a pre-migration link
	 * (`…/1.66.0-66`) resolves through the label map. Revision is tried first
	 * because a label can only ever be one build, while a short prefix is the
	 * form the product itself generates — the ambiguous case is the one we
	 * control, so it gets the first look.
	 */
	const revision = $derived(resolveRevision(ledger, urlKey));
	const row = $derived.by<RevisionRow | null>(
		() => ledger?.rows.find((r) => r.revision === revision) ?? null
	);
	const rowIndex = $derived(ledger && row ? ledger.rows.indexOf(row) : -1);
	const prev = $derived(ledger && rowIndex >= 0 ? (ledger.rows[rowIndex + 1] ?? null) : null);

	/**
	 * Canonicalise the URL once the revision is known, so an old label link and
	 * a short-sha link both settle on one address. `replaceState` rather than
	 * `goto`: this is the same page, and a redirect that pushes history makes
	 * the back button walk the resolution instead of leaving the page.
	 */
	$effect(() => {
		if (!ledger || !revision) return;
		const canonical = revisionPath(ledger.repoKey, revision);
		if (page.url.pathname !== canonical) replaceState(canonical, page.state);
	});

	const githubStatus = createQuery(() => ({
		queryKey: githubStatusQueryKey,
		queryFn: fetchGithubStatus,
		staleTime: 300_000
	}));
	const githubConnected = $derived(githubStatus.data?.connected ?? false);

	/**
	 * A COARSE CLOCK, DELIBERATELY — not `$now`.
	 *
	 * Bucketing calls `detectStuck`, so it is a function of elapsed time and has
	 * to be re-run on a clock. But `$now` ticks every 100ms and the stuck
	 * thresholds are 1h and 24h, so binding the buckets to it would rebuild
	 * every slot ten times a second to answer a question whose answer changes
	 * once an hour. 30s is three orders of magnitude inside the shortest
	 * threshold and costs nothing.
	 */
	let coarse = $state(new Date());
	$effect(() => {
		const id = setInterval(() => (coarse = new Date()), 30_000);
		return () => clearInterval(id);
	});

	// THE COVERAGE.
	const coverage = $derived(row ? revisionCoverage(row, coarse) : null);
	const segments = $derived(coverage ? coverageSegments(coverage) : []);
	const barLabel = $derived(
		coverage
			? `${coverage.liveCount} of ${coverage.totalCount} places live · ` +
					coverage.buckets.map((b) => `${b.slots.length} ${b.title.toLowerCase()}`).join(' · ')
			: ''
	);

	const rep = $derived.by(() => {
		const cell = row?.services[0]?.slots[0]?.cell;
		if (!cell) return null;
		return {
			ns: cell.rollout.metadata?.namespace ?? '',
			name: cell.rollout.metadata?.name ?? '',
			cluster: cell.sourceCluster ?? ''
		};
	});

	// THE ONE MUTATING CONTROL, and the same wiring the list page used to have:
	// preselect `ChangeVersionModal` on a tag `isDeployable` has already
	// cleared. No new mutation path, no one-click promote.
	let modalOpen = $state(false);
	let modalRollout = $state<Rollout | null>(null);
	let modalVersion = $state<string | null>(null);
	let modalCluster = $state<string | undefined>(undefined);

	function openPromote(slot: RevisionSlot, tag: string) {
		modalRollout = slot.cell.rollout;
		modalVersion = tag;
		modalCluster = slot.cell.sourceCluster || undefined;
		modalOpen = true;
	}

	/**
	 * `View commit` is the page's ONE filled primary. It is a READ-ONLY link,
	 * which is the point: `primary` is loud by contrast and the loudest thing on
	 * a deploy surface must not be the control that changes what production is
	 * running. Every `Promote` on this page is `default`.
	 */
	const commitUrl = $derived.by<string | null>(() => {
		if (!ledger || !revision) return null;
		if (!ledger.repoKey.startsWith('repo:')) return null;
		const body = repoBody(ledger.repoKey);
		if (!body.includes('/')) return null;
		return `https://${body}/commit/${revision}`;
	});

	const BTN_PRIMARY =
		'inline-flex h-9 items-center justify-center rounded bg-gray-900 px-3 text-[12px] font-semibold text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200 lg:h-7';
	const BTN_DEFAULT =
		'inline-flex h-9 items-center justify-center rounded border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 lg:h-7';

	/**
	 * NAME A CAUSE ONLY FROM THE FIELD THAT ESTABLISHED IT.
	 *
	 * `blockingGates` is non-empty only when `promotionBlock` found real gates
	 * refusing every candidate. With no gate evidence this describes the
	 * OBSERVABLE and stops. `DESIGN.md`: *"`waiting on a gate` is a lie with
	 * better grammar."*
	 */
	function blockedBecause(s: CoverageSlotVM): string {
		if (s.blockingGates.length > 0) {
			return `waiting on ${s.blockingGates.join(', ')}`;
		}
		// NO SECOND NUMBER. The chip beside this sentence already carries the
		// product-wide rank (`−4`, distance from the head, the ONE derivation
		// `env-rank.ts` exists to keep single). A distance from THIS build would
		// be a different, equally true number printed 20px away — two
		// denominators on one row, which is the defect that round closed. So the
		// no-gate case states the observable instead: what it is running now.
		if (s.runs) return `still on ${s.runs}`;
		return 'has not taken this build';
	}

	/**
	 * A BUCKET'S SLOTS, GROUPED TWICE — BY SERVICE, THEN BY WHAT EACH PLACE IS
	 * ACTUALLY RUNNING.
	 *
	 * One row per place printed the same two strings once per place, and the
	 * live cluster shows both failures on one screen: `Live here` printed
	 * `hello-api-app` and `1.66.0-66` four times each over 14 rows, and
	 * `Moved ahead` printed `now on 9f10e49` EIGHT times — the page's largest
	 * information-free repeat, and a fact that is true of the whole bucket.
	 *
	 * Grouping by SERVICE makes criterion 2 structural: the service and what it
	 * calls this build ARE the group heading, stated once. Grouping again by
	 * RUNNING BUILD is what lets `Moved ahead` say `now on 9f10e49` once per
	 * service instead of once per environment — and it degrades correctly, since
	 * a service whose three environments moved to three different builds simply
	 * renders three sub-groups.
	 *
	 * It also fixes the growth curve. Environments become CHIPS THAT WRAP rather
	 * than rows that stack, so `edge-mesh` costs one wrapped line per service at
	 * 13 regions where it used to cost thirteen rows.
	 */
	type RunsGroup = { runs: string | null; slots: CoverageSlotVM[] };
	/* The bucket cards answer WHERE, so a group here is a service and the builds
	   its places are on — no `label`, no `labelDiffers`. Both were dropped when
	   the conditional-label rule was deleted; `What each service ships it as`
	   below is the one place on this page that answers "under what name", and it
	   answers it for every service without an exception. */
	type ServiceGroup = { appName: string; runs: RunsGroup[] };

	function groupSlots(slots: CoverageSlotVM[]): ServiceGroup[] {
		const out: ServiceGroup[] = [];
		for (const s of slots) {
			let g = out.find((o) => o.appName === s.appName);
			if (!g) {
				g = { appName: s.appName, runs: [] };
				out.push(g);
			}
			let r = g.runs.find((o) => o.runs === s.runs);
			if (!r) {
				r = { runs: s.runs, slots: [] };
				g.runs.push(r);
			}
			r.slots.push(s);
		}
		return out;
	}

	function rankChipFor(svc: RevisionService): {
		role: 'newest' | 'rank' | 'diverged';
		label: string;
	} | null {
		const r = rankSentence(svc);
		if (!r) return null;
		if (svc.diverged) return { role: 'diverged', label: 'diverged' };
		return { role: svc.rank === 0 ? 'newest' : 'rank', label: r.rank };
	}
</script>

<svelte:head>
	<title>kuberik | {row ? row.short : urlKey}</title>
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 sm:px-6">
	<a
		href="/versions"
		class="t-micro mb-4 inline-flex items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
	>
		<ArrowLeftOutline class="h-3 w-3" /> All revisions
	</a>

	{#if query.isLoading}
		<div class="flex items-center justify-center py-20"><Spinner size="6" /></div>
	{:else if query.isError}
		<div class="t-body rounded-xl border border-gray-200 p-4 text-red-700 dark:border-gray-700 dark:text-red-400">
			Failed to load: {(query.error as Error).message}
		</div>
	{:else if !row || !ledger || !coverage}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<TagOutline class="mb-3 h-8 w-8 text-gray-500 dark:text-gray-400" />
			<h1 class="t-body font-semibold text-gray-900 dark:text-white">Revision not found</h1>
			<!--
				THE REPO CLAUSE ONLY PRINTS WHEN THERE IS A REPO. A one-segment slug
				(`/versions/9f10e494d560`) leaves `repoPath` empty, and the sentence
				rendered as `Nothing in  has deployed 9f10e494d560` — an empty
				interpolation with two spaces where the scope should be. Naming a
				scope you do not have is the same defect as naming a cause you cannot
				evidence: the unscoped case is a DIFFERENT statement, so it gets its
				own sentence rather than the same one with a hole in it.
			-->
			<p class="t-body mt-1 max-w-md text-gray-500 dark:text-gray-400">
				{#if repoPath}
					Nothing in <span class="t-code">{repoPath}</span> has deployed
					<span class="t-code">{urlKey}</span>.
				{:else}
					No deployed revision matches <span class="t-code">{urlKey}</span>.
				{/if} This page lists commits that have been deployed at least once; a build that has never left
				the registry has no deployments to describe.
			</p>
		</div>
	{:else}
		<!--
			THE HERO — identity on the left, the measurement on the right, baselines
			aligned. Concept 07's anatomy. The eyebrow supplies the noun so the
			heading is only the sha, and the count is the page's one number: how far
			this build has reached, and out of what.
		-->
		<div class="rev-hero">
			<div class="min-w-0">
				<div class="t-label text-gray-500 dark:text-gray-400">Tracking revision</div>
				<div class="mt-1 flex flex-wrap items-baseline gap-3">
					<h1 class="t-display-id text-gray-900 dark:text-white">{row.short}</h1>
					<span class="t-code-sm min-w-0 truncate text-gray-500 dark:text-gray-400"
						>{ledger.repoLabel}</span
					>
				</div>
			</div>

			<!--
				THE COUNT. `t-display` is the declared 24/300 light face and it is the
				only large light role the type scale has — concept 07 draws this
				numeral bigger, and a bigger numeral would be a TENTH type role
				against a scale `DESIGN.md` closed at nine. The reading survives the
				substitution because the object carrying "how far" on this page is the
				bar directly beneath, not the digit.
				A PLACE IS A (SERVICE, ENVIRONMENT) SLOT AND THE LABEL SAYS SO.
				`/api/rollouts` carries no pod counts, so a pod ratio here would be
				invented; `places` is the honest unit and the caption names it.
			-->
			<div class="rev-count">
				<span class="t-display text-gray-900 dark:text-white">{coverage.liveCount}</span>
				<span class="t-body text-gray-500 dark:text-gray-400">/{coverage.totalCount}</span>
				<div class="t-label text-gray-500 dark:text-gray-400">places live</div>
			</div>
		</div>

		<!--
			SECOND LINE OF THE HERO, AND IT DEGRADES HONESTLY.
			Concept 07 puts the commit message and author here. GitHub is not
			connected on this cluster — that is the SHIPPED STATE, not an edge case —
			so the line says which fact is missing and why, in one muted sentence,
			and takes no data row and no second button. `DESIGN.md`: *"An unavailable
			integration never takes a data row"*, and the navbar already carries the
			one `Connect GitHub` control, permanently, 40px above.
		-->
		{#if githubConnected && rep && prev}
			<div class="mt-2">
				<CommitSummary
					namespace={rep.ns}
					name={rep.name}
					cluster={rep.cluster}
					base={prev.revision}
					head={row.revision}
					verb={`in this build · since ${prev.short}`}
					showMessages
					showAvatars
				/>
			</div>
		{:else}
			<p class="t-micro mt-2 text-gray-500 dark:text-gray-400">
				Commit message and author need GitHub, which is not connected.
			</p>
		{/if}

		<p class="t-micro mt-1 text-gray-500 dark:text-gray-400">
			{row.services.length} service{row.services.length === 1 ? '' : 's'} · {coverage.totalCount} place{coverage.totalCount ===
			1
				? ''
				: 's'}
			{#if row.lastDeployMs}
				· last deployed {formatTimeAgo(new Date(row.lastDeployMs).toISOString(), $now)}
			{/if}
		</p>

		{#if commitUrl}
			<div class="mt-3">
				<a class={BTN_PRIMARY} href={commitUrl} target="_blank" rel="noopener noreferrer"
					>View commit</a
				>
			</div>
		{/if}

		<!--
			THE COVERAGE BAR. Full width, proportional, one segment per non-empty
			bucket. This is the object that answers criterion 1 with no reading at
			all, and it is the SAME component the list rows carry at 8px, so the two
			pages are one idea at two scales.
		-->
		<div class="mt-6">
			<CoverageBar {segments} label={barLabel} />
		</div>

		<!--
			THE BUCKETS. `repeat(auto-fit, minmax(210px, 1fr))` — concept 07's grid.
			One card per NON-EMPTY bucket, so a fully-converged revision renders one
			card and a mid-promotion head renders three. The card lists its places,
			which is what makes the design hold at 4 prod regions and at 13: the bar
			is proportional and the buckets are LISTS, so N environments cost rows
			inside one card rather than columns across the page.
		-->
		<div class="rev-buckets mt-4">
			{#each coverage.buckets as bucket (bucket.key)}
				<section
					class="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800"
				>
					<header class="flex items-center gap-2">
						<span class="cov-swatch {coverageSwatch(bucket.key, coverage.reachable)}"></span>
						<h2 class="t-dense min-w-0 truncate font-semibold text-gray-900 dark:text-white">
							{bucket.title}
						</h2>
						<span class="t-code-sm ml-auto text-gray-500 dark:text-gray-400"
							>{bucket.slots.length}</span
						>
					</header>

					{#if bucket.key === 'notYet'}
						<!--
							ONE ROW PER PLACE, AND ONLY HERE. `Not yet` is the bucket whose
							places each have their OWN story — a different gate holding them,
							a different action — so a group heading cannot carry it, and this
							is the bucket that must stay actionable.
						-->
						<ul class="mt-3 flex flex-col gap-3">
							{#each bucket.slots as s (s.appName + '/' + s.envName)}
								<li class="min-w-0">
									<div class="flex flex-wrap items-center gap-4">
										<!-- THE FOUR-SECTION BOX IS GONE, AND SO IS THE DOT
										     (2026-08-27). From the human: *"I also don't like that
										     we split the badge in up to 4 sections"*, then *"I also
										     don't like dots outside of badge, especially when we
										     have stuck which has its own dot which is also
										     useless"*. This row rendered `[●][PROD][−19][● STUCK]`
										     — a wordless status half, an identity, a rank, and an
										     alarm carrying a dot of its own 4px from the amber word
										     that says the same thing.
										     It is now a `.chip-mark` GROUP: the badge is
										     `[ENV][−N]` and nothing more, and `STUCK` — fill and
										     word, no glyph — sits loose 4px beside it, which is the
										     form `StuckBadge` already ships on `/`, `/rollouts`,
										     `/namespaces/<ns>` and the rollout detail page. The
										     group is 16px from the app name, so 4px against 16px
										     says which environment the alarm is about.
										     THE DEPLOY-STATUS WORD SURVIVES AS THE BADGE'S TOOLTIP —
										     it is the only thing the dot said that this row does not
										     otherwise print, and the bucket's second line already
										     states the blocking reason in full. -->
										<span class="chip-mark">
											{#if s.currentRank !== null && s.currentRank > 0}
												<span class="chip-joined">
													<Chip
														role="env"
														theme={s.slot.cell.theme}
														label={s.envLabel}
														wide
														title="{s.envLabel.toUpperCase()} — {s.statusWord}"
													/>
													<Chip role="rank" label={`−${s.currentRank}`} />
												</span>
											{:else}
												<Chip
													role="env"
													theme={s.slot.cell.theme}
													label={s.envLabel}
													wide
													title="{s.envLabel.toUpperCase()} — {s.statusWord}"
												/>
											{/if}
											{#if s.stuck}
												<Chip
													role="alarm"
													label="stuck"
													title="{s.envLabel.toUpperCase()} is stuck"
												/>
											{/if}
										</span>
										<a
											href="/apps/{encodeURIComponent(s.appName)}"
											class="t-dense min-w-0 truncate text-gray-700 hover:underline dark:text-gray-200"
											>{s.appName}</a
										>
									</div>
									<!-- CRITERION 3, ON THE ROW THAT STATES THE PROBLEM. -->
									<div class="mt-1 flex flex-wrap items-center gap-2">
										<span class="t-micro text-gray-500 dark:text-gray-400">{blockedBecause(s)}</span
										>
										{#if s.promoteTag}
											<!-- `default`, never `primary`: the loudest control on a deploy
											     surface must not be the one that changes production. The
											     label names the environment, because two buttons reading
											     `Promote` eight pixels apart have a target the reader has
											     to infer from position. -->
											<button
												type="button"
												class={BTN_DEFAULT}
												onclick={() => openPromote(s.slot, s.promoteTag!)}
												title={`Deploy ${row.short} to ${s.appName} in ${s.envName}`}
											>
												Promote to {s.envLabel}
											</button>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					{:else}
						<ul class="mt-3 flex flex-col gap-3">
							{#each groupSlots(bucket.slots) as g (g.appName)}
								<li class="min-w-0">
									<div class="flex flex-wrap items-baseline gap-2">
										<a
											href="/apps/{encodeURIComponent(g.appName)}"
											class="t-dense min-w-0 truncate text-gray-700 hover:underline dark:text-gray-200"
											>{g.appName}</a
										>
										<!-- NO LABEL HERE AT ALL, AND THAT IS THE SECOND HALF OF
										     DELETING A RULE.
										     This span used to print the service's label *only when it
										     differed from the revision's own sha* — the same exception
										     rule `/versions` carried, and the reason both pages needed
										     a caption. The human has rejected legends twice; a caption
										     in prose is a legend.
										     The rule is not moved, it is gone: a bucket card's question
										     is WHERE this build is running, not what it is called. The
										     name belongs to `What each service ships it as` below,
										     which prints it for EVERY service, always, in full. One
										     question per object, and the only page in this pair that
										     answers "under what name" answers it without exceptions. -->
									</div>
									{#each g.runs as rg (rg.runs ?? '—')}
										<div class="mt-1 flex flex-wrap items-center gap-4">
											{#each rg.slots as s (s.envName)}
												<!--
													`/apps`'s unit, character for character: the environment's
													badge, and nothing beside it unless the environment is
													stuck. THERE IS NO DEPLOY-STATUS DOT — it was a half of
													this box until 2026-08-27, the human rejected it there,
													and rejected it outside the box too. Its word is the
													badge's tooltip now.
													The `wide` prop IS THE ONE LAYOUT OVERRIDE ON THIS PAGE AND IT
													IS LOAD-BEARING. `.chip` caps at 12ch, which is right in a
													fixed table track and wrong here: `prod-ap-south`,
													`prod-us-east` and `prod-us-west` are 13 characters and all
													ellipsise to `PROD-AP…` / `PROD-US…` / `PROD-US…` — two
													different regions rendered as the same string, the exact
													defect that killed the `/apps` convergence bar.
												-->
												<span class="chip-mark">
													<Chip
														role="env"
														theme={s.slot.cell.theme}
														label={s.envLabel}
														wide
														title="{s.envLabel.toUpperCase()} — {s.statusWord}"
													/>
													{#if s.stuck}
														<Chip
															role="alarm"
															label="stuck"
															title="{s.envLabel.toUpperCase()} is stuck"
														/>
													{/if}
												</span>
											{/each}
											<!-- WHAT TOOK ITS PLACE — once per (service, build), not once
											     per environment. On the live cluster that is the difference
											     between `now on 9f10e49` printed eight times and printed
											     three. -->
											{#if bucket.key !== 'live' && bucket.key !== 'failing' && rg.runs}
												<span class="t-micro text-gray-500 dark:text-gray-400"
													>now on <span class="t-code-sm">{rg.runs}</span></span
												>
											{/if}
										</div>
									{/each}
								</li>
							{/each}
						</ul>
					{/if}

					<p class="t-micro mt-3 text-gray-500 dark:text-gray-400">{bucket.description}</p>
				</section>
			{/each}
		</div>

		<!--
			CRITERION 2. One rank per service, against that service's OWN
			denominator, with the denominator named. `newest of 4` beside
			`newest of 37` is the page's whole point — those two services share a
			source repo and nothing else, and collapsing them onto one ladder is the
			defect the revision keying was built to close, one level down.
			It does NOT restate the buckets: the buckets say WHERE, this says WHAT
			EACH SERVICE CALLS IT and how far down its own ladder it now sits.
		-->
		<div class="t-label mt-6 mb-2 text-gray-500 dark:text-gray-400">
			What each service ships it as
		</div>
		<div
			class="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800"
		>
			{#each row.services as svc (svc.appName)}
				{@const rank = rankSentence(svc)}
				{@const chip = rankChipFor(svc)}
				<!--
					ONE INK FOR A SERVICE NAME, ON BOTH REVISION PAGES. This link was
					`gray-900 / white` while the SAME name eleven pixels above it, in
					the bucket cards, was `gray-700 / gray-200`, and the `/versions`
					row is `gray-700` too. A service is never the subject of either of
					these pages — the revision is — so it takes the secondary ink
					everywhere, and the three places that print it stop disagreeing
					about how important it is.
				-->
				<div class="rev-svc-row">
					<a
						href="/apps/{encodeURIComponent(svc.appName)}"
						class="t-dense min-w-0 truncate text-gray-700 hover:underline dark:text-gray-200"
						>{svc.appName}</a
					>
					<span class="rev-svc-build">
						{#if chip && rank}
							<Chip
								role={chip.role}
								label={chip.label}
								title={svc.diverged
									? 'On no environment’s release list — promotion does not arrive at it'
									: `${chip.label} ${rank.of} builds on this service’s own ladder`}
								value={svc.label}
								valueTitle={svc.label}
								class="min-w-0"
							/>
							<span class="t-micro text-gray-500 dark:text-gray-400">{rank.of}</span>
						{:else}
							<!-- No number at all. A `0` here would read as "newest". -->
							<Chip
								role="unranked"
								label="unknown"
								title="This service’s ladder does not resolve a rank for this build"
								value={svc.label}
								class="min-w-0"
							/>
						{/if}
					</span>
				</div>
			{/each}
		</div>
		<!--
			THE CAPTION IS DELETED, AND SO IS THE RULE IT EXISTED TO EXPLAIN.
			It read: *"A dim label is this revision's own sha, restated — that
			service has no separate name for the build."* That is a legend written
			as a sentence, and the human has now rejected legends twice.
			Deleting a caption and leaving the object unexplained is how the fleet
			ruler failed three rounds running, so the OBJECT changed instead. The
			table used to have two states for one field — print the label, or print
			it dimmed — and a reader cannot tell a dim label from a light one
			without being told which is which. Now there is one state: **a name is
			always printed, always at full strength, on both revision pages.** A
			service whose name for the build is `9f10e49` prints `9f10e49`, and the
			fact that this is also the revision's own sha is legible because the sha
			is 24px tall at the top of the page. Nothing to decode, nothing to say.
			The service × environment unit is named where it is used — the hero's
			`places live` and each bucket card's own count — rather than in a
			footnote under a table that does not report it.
		-->
	{/if}

	<ChangeVersionModal
		bind:open={modalOpen}
		rollout={modalRollout}
		initialSelectedVersion={modalVersion}
		cluster={modalCluster}
	/>
</div>

<style>
	/*
	 * GEOMETRY ONLY — colour and visibility stay in utilities, per the `app.css`
	 * layering note: a Svelte-scoped rule outranks a Tailwind utility, so
	 * anything declared here is un-overridable from the markup.
	 */

	/* Two columns, baselines aligned — concept 07's hero. At phone width the
	   count drops under the identity rather than shrinking beside it: a 24px
	   numeral squeezed next to a 24px sha at 358px of content is two headings
	   fighting for one line. */
	.rev-hero {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 16px;
		align-items: baseline;
	}

	.rev-count {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 4px;
		text-align: right;
		justify-content: flex-end;
	}

	.rev-count :global(.t-label) {
		width: 100%;
	}

	/* Concept 07's card grid, unchanged. `auto-fit` is what makes the design
	   hold at any bucket count: one bucket fills the row, four sit in a row of
	   four at 1440 and stack at 390 with no breakpoint of their own. */
	.rev-buckets {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
		gap: 12px;
		align-items: start;
	}

	/* `.cov-swatch` is a shared atom in `app.css` — one legend swatch for the
	   coverage bar and the exposure bar alike. */

	/*
	 * NAME LEFT, BUILD RIGHT — the `/` Steady row at full width.
	 *
	 * It was `180px minmax(0,1fr)`, which pinned both cells to the left and
	 * left 630px of measured dead space trailing every row at 1440 under a
	 * bucket grid that uses the full width. Right-aligning the build cell
	 * distributes that space instead of parking it, and it buys an alignment:
	 * five badges of different widths now share a right edge, so `of 4` and
	 * `of 37` read as one column.
	 *
	 * The `/apps` proximity rule does NOT bite here and the difference is
	 * countable. That row broke because it carried 3-13 environments and a
	 * floating `−4` was closer to the environment it was not about; this row
	 * has exactly ONE name and ONE badge inside one divided region, so the
	 * badge has one possible referent no matter how wide the gap. It is the
	 * same reason `/rollouts` may draw a loose status disc and `/apps` may not.
	 */
	.rev-svc-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 12px;
		padding: 12px 16px;
		align-items: baseline;
	}

	/* The DENOMINATOR gets a fixed track, so the badges right-align to one x
	   instead of to `of 4` / `of 35` / `of 37` — three different string widths,
	   which would have left the five boxes ragged by 12px while claiming to be
	   a column. 40px holds `of 37` at 11px with room. */
	.rev-svc-build {
		display: grid;
		grid-template-columns: auto 40px;
		align-items: baseline;
		justify-self: end;
		gap: 4px;
		min-width: 0;
	}

	/*
	 * PHONE WIDTH IS A DESIGN, NOT A FALLBACK.
	 *
	 * The hero becomes one column with the count on its own line; the service
	 * rows become a two-line stack, because a 180px name track plus a joined
	 * badge plus a denominator cannot share 358px without the badge
	 * ellipsising — and the badge is the one thing on the row that carries
	 * information the reader came for.
	 */
	@media (max-width: 639px) {
		/*
		 * THE HERO KEEPS ITS TWO COLUMNS AT 390, and that is a fold decision
		 * rather than a taste one. Stacked, the count and the degraded GitHub
		 * line cost ~90px above the buckets, which at 390x844 pushed the `Not
		 * yet` card — the one card on the page that can want a person — from
		 * just above the fold to just below it. `9b7e410` is 105px of 24px mono
		 * and `4/9` is ~45px, so the two fit one line with room; what wraps is
		 * the repo label, which is the least urgent string in the hero.
		 */
		.rev-hero {
			gap: 8px;
		}

		.rev-svc-row {
			grid-template-columns: minmax(0, 1fr);
			gap: 4px;
		}

		/* The right edge is the NAME's edge once the row is stacked, so hanging
		   the badge there would put it under nothing and 200px from the name it
		   belongs to. Stacked, the binding is the line break; the badge goes
		   back under the name it describes. */
		.rev-svc-build {
			display: flex;
			justify-self: start;
		}
	}
</style>
