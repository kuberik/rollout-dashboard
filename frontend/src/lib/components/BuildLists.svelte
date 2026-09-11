<svelte:options runes={true} />

<script module lang="ts">
	/**
	 * ⭐ FINDING 5 (operator sweep, 2026-09-09) — "SHOW N MORE BUILDS" SURVIVES
	 * BACK. Today, pressing Back re-collapses "No longer running anywhere" /
	 * "Never deployed" before scroll restoration runs, so the row the reader
	 * came from is gone and the browser's own scroll offset clamps against a
	 * now-shorter page.
	 *
	 * DECISION (mine to make, per the brief): `sessionStorage`, keyed by a
	 * caller-supplied `storageKey` (the repository page's own pathname, e.g.
	 * `/revisions/github.com/littlechimera/kuberik-testing`) — NOT the URL's
	 * `?q=`. Reasons: (1) the repository page already has one stable
	 * identity per repo, so one key covers both lists without inventing a
	 * second query param; (2) `routes/+layout.svelte`'s own scroll memory
	 * (read-only to this lane) already keys ITS OWN `sessionStorage` entries
	 * by pathname, so this reuses a pattern already proven to survive
	 * Back/forward on this product rather than adding a THIRD persistence
	 * mechanism (the URL) beside two that already exist. A URL param would
	 * also make every "Show more" a `pushState`/`replaceState` decision this
	 * component does not otherwise need to make.
	 */
	const STORE_PREFIX = 'revisions:expand:';

	export function readExpand(storageKey: string): { past: boolean; pending: boolean } {
		if (typeof sessionStorage === 'undefined') return { past: false, pending: false };
		try {
			const raw = sessionStorage.getItem(STORE_PREFIX + storageKey);
			if (!raw) return { past: false, pending: false };
			const parsed = JSON.parse(raw);
			return { past: !!parsed.past, pending: !!parsed.pending };
		} catch {
			return { past: false, pending: false };
		}
	}

	export function writeExpand(storageKey: string, state: { past: boolean; pending: boolean }) {
		if (typeof sessionStorage === 'undefined') return;
		try {
			sessionStorage.setItem(STORE_PREFIX + storageKey, JSON.stringify(state));
		} catch {
			/* storage full or disabled — expand state just does not persist */
		}
	}
</script>

<script lang="ts">
	/**
	 * THE THREE BUILD LISTS — extracted from `/revisions` (round 11, lane
	 * 2): "Also still running", "No longer running anywhere", "No deploy
	 * on record" (né "Never deployed"). For the repository page (lane 3) —
	 * the index (this lane's own route) renders none of this (B.2.5).
	 *
	 * ⛔ FIX PASS ITEM 1, 2026-09-11 (round 2) — ONE FLEX COLUMN, NOT A
	 * SECOND MAIN/RAIL GRID. This used to run its own `.rev-cols` grid (a
	 * 320px rail for "No deploy on record", the SAME width as every rail
	 * on the product but at a different SEAM — 16px here, 32px on the
	 * page's own `.rail-grid`), which made the repository page carry two
	 * main/rail systems stacked on top of each other. All three lists are
	 * equal siblings in one column now, rendered inside the page's own
	 * `.rail-main` — see `routes/changes/[...slug]/+page.svelte`'s own
	 * fix-pass comment above the section this component sits in.
	 */
	import { untrack } from 'svelte';
	import {
		leadRowsFor,
		matchesRevisionText,
		pastRows,
		releaseLines,
		restRows,
		rowNamesBuild,
		type RepoLedger,
		type RevisionRow,
		type RevisionSlot
	} from '$lib/view-models/revision-ledger';
	import {
		revisionCoverage,
		coverageBarSegments,
		coverageBarLabel,
		coverageCounts,
		coverageCells
	} from '$lib/view-models/revision-coverage';
	import { historyAtLimit } from '$lib/history-marks';
	import { changeBuildPath } from '$lib/version-utils';
	import { rolloutPath } from '$lib/source-dashboard';
	import { shortEnvLabel } from '$lib/environment-theme';
	import { formatTimeAgoCompact, formatDate } from '$lib/utils';
	import {
		ArchiveSolid,
		CheckCircleSolid,
		ChevronDownOutline,
		ChevronRightOutline,
		HourglassOutline
	} from 'flowbite-svelte-icons';
	import Card from './Card.svelte';
	import Chip from './Chip.svelte';
	import BuildRow from './BuildRow.svelte';
	import BuildStateMark from './BuildStateMark.svelte';
	import CoverageBar from './CoverageBar.svelte';

	const FOLD = 6;

	let {
		repo,
		now,
		query = '',
		storageKey
	}: {
		repo: RepoLedger;
		now: Date;
		query?: string;
		/** See the module-level note above `readExpand`. */
		storageKey: string;
	} = $props();

	const active = $derived(query.trim().length > 0);
	const needle = $derived(query.trim().toLowerCase());

	function passes(row: RevisionRow): boolean {
		return matchesRevisionText(row, needle);
	}

	const lines = $derived(releaseLines(repo));
	const leadRows = $derived(leadRowsFor(repo, lines));
	const leadHeads = $derived(new Set(leadRows.map((r) => r.revision)));
	const hasLeadRow = $derived(leadRows.length > 0);

	const liveAll = $derived(restRows(repo, leadHeads));
	const pastAll = $derived(pastRows(repo, leadHeads));
	const liveVisible = $derived(active ? liveAll.filter(passes) : liveAll);
	const pastVisible = $derived(active ? pastAll.filter(passes) : pastAll);
	const pendingVisible = $derived(active ? repo.pending.filter(passes) : repo.pending);

	const namedLive = $derived(liveVisible.some(rowNamesBuild));
	const namedPast = $derived(pastVisible.some(rowNamesBuild));

	const coverageOf = (row: RevisionRow) => revisionCoverage(row, now);

	function liveEnvSlots(row: RevisionRow): RevisionSlot[] {
		const seen = new Set<string>();
		const out: RevisionSlot[] = [];
		for (const service of row.services) {
			for (const slot of service.slots) {
				if (!slot.onIt) continue;
				const label = (shortEnvLabel(slot.cell.theme) || slot.envName).toLowerCase();
				if (seen.has(label)) continue;
				seen.add(label);
				out.push(slot);
			}
		}
		return out;
	}

	function placeHref(slot: Pick<RevisionSlot, 'cell'>): string {
		return rolloutPath(
			slot.cell.sourceCluster,
			slot.cell.rollout.metadata?.namespace ?? '',
			slot.cell.rollout.metadata?.name ?? ''
		);
	}

	function ageOf(row: RevisionRow, kind: 'live' | 'past' | 'pending'): string {
		const ms = kind === 'pending' ? row.createdMs : row.lastDeployMs || row.createdMs;
		if (!ms) return '';
		const t = `${formatTimeAgoCompact(new Date(ms).toISOString(), now)} ago`;
		if (kind === 'pending' || !row.lastDeployMs) return `Built ${t}`;
		return kind === 'past' ? `Last deployed ${t}` : `Deployed ${t}`;
	}

	function ageTitle(row: RevisionRow, kind: 'live' | 'past' | 'pending'): string {
		const ms = kind === 'pending' ? row.createdMs : row.lastDeployMs || row.createdMs;
		return ms ? formatDate(new Date(ms).toISOString()) : '';
	}

	function ageIso(row: RevisionRow, kind: 'live' | 'past' | 'pending'): string | undefined {
		const ms = kind === 'pending' ? row.createdMs : row.lastDeployMs || row.createdMs;
		return ms ? new Date(ms).toISOString() : undefined;
	}

	function matchedServiceNames(row: RevisionRow): string[] {
		const all = row.services.map((s) => s.appName);
		if (!active) return all;
		const matched = all.filter((n) => n.toLowerCase().includes(needle));
		return matched.length > 0 ? matched : all;
	}

	/**
	 * ⭐ FINDING 2 (operator sweep, 2026-09-09) — "NEVER DEPLOYED · 24 BUILDS"
	 * CONTRADICTED ITS OWN FOOTNOTE. History keeps only the last N deploys
	 * per service (`historyAtLimit`); once a service is AT that cap, some of
	 * these "never deployed" builds may simply predate what the API can
	 * still see — they may have run once and been evicted. Renamed to what
	 * the retained history actually supports, with the footnote restating
	 * the SAME reason rather than a second, disagreeing one.
	 */
	const historyLimit = $derived.by(() => {
		let checked = false;
		for (const row of [...repo.rows, ...repo.pending]) {
			for (const s of row.services) {
				for (const slot of s.slots) {
					checked = true;
					if (historyAtLimit(slot.cell.rollout)) {
						return { atLimit: true, limit: slot.cell.rollout?.spec?.versionHistoryLimit ?? 10 };
					}
				}
			}
		}
		/**
		 * ⭐ REVISIONS-PASS-6, ITEM 8 — NO SLOT CHECKED IS NOT A CLEAN BILL.
		 * `atLimit: false` is the claim "every service's own retention has
		 * room to spare, verified" — but that verification needs at least
		 * ONE real rollout to look at. A repo whose rows/pending carry no
		 * slot at all (a small or newly-added repository, live at
		 * `kuberik-testing-second`) fell through this loop having checked
		 * nothing and got the CONFIDENT grammar ("Never deployed") by
		 * default — a guess wearing certainty. The honest default when there
		 * is no evidence either way is the CAUTIOUS grammar, the same one a
		 * genuinely truncated history gets: `atLimit: !checked`.
		 */
		return { atLimit: !checked, limit: 10 };
	});

	/**
	 * ⭐ LANE 9, ROUND 11 QA, ITEM 13 — ONE HEADING, ALWAYS. The title used
	 * to flip between "No deploy on record" and "Never deployed" on
	 * `historyLimit.atLimit`, so the SAME rail read a different landmark
	 * name on different repositories — one titled `24 builds`, the sibling
	 * `0 builds`, under two different headings for the identical concept.
	 * The heading is now fixed; only the body (below) still tells the
	 * cautious/confident story, which is where a claim about EVIDENCE
	 * belongs — a heading is a label, not a hedge.
	 */
	const pendingTitle = 'No deploy on record';
	const PENDING_FOOTNOTE = (n: number) =>
		`History keeps the last ${n} deploys per service, so a build with no deploy on record may simply predate that window — it is not necessarily one nobody has ever run.`;

	// ⚠️ DELIBERATELY READ ONCE, AT MOUNT — `untrack` says so explicitly
	// (silences Svelte's "captures the initial value" warning, which is
	// right to flag this and wrong here: this component is not expected to
	// be re-keyed to a different repo without remounting).
	let expandState = $state(untrack(() => readExpand(storageKey)));
	$effect(() => writeExpand(storageKey, expandState));

	function toggle(key: 'past' | 'pending') {
		expandState = { ...expandState, [key]: !expandState[key] };
	}
</script>

{#snippet more(key: 'past' | 'pending', label: string)}
	<div class="border-t border-gray-100 p-2 dark:border-gray-700/60">
		<button
			type="button"
			class="btn btn-secondary w-full"
			aria-expanded={expandState[key]}
			onclick={() => toggle(key)}
		>
			{#if expandState[key]}
				<ChevronDownOutline class="h-3.5 w-3.5" aria-hidden="true" />
				Hide {label}
			{:else}
				<ChevronRightOutline class="h-3.5 w-3.5" aria-hidden="true" />
				Show {label}
			{/if}
		</button>
	</div>
{/snippet}

<!--
	⭐ ROUND 11 REVISIONS-PASS-6, ITEM 11 (+ THE UNDERLYING A.6.1 GAP THIS
	FIXES) — EVERY `.bld-row` DRAWS ITS BAR NOW, NOT JUST "ALSO STILL
	RUNNING"'S. `coverageRoll` is the ONE row-scale rollup, shared by all
	three lists: `coverageBarSegments`/`coverageBarLabel`/`coverageCounts`
	are the same round-11 functions the hero and the head band already draw
	from, so a never-deployed row's bar reads all-track ("nowhere yet, and
	it is still a candidate") and a no-longer-running row's reads all-tint
	("every place is already past it") — never a hand-rolled percentage.

	⭐ REVISIONS-PASS-6, ITEM 7 — AND THE SENTENCE STOPPED RESTATING THE BAR
	IT SITS BESIDE. A.6.1 asked for THREE lines (a rollup sentence, the bar,
	the age); once the bar actually draws (item 11, above), the sentence's
	`{here} of {total} running · {movedOn} moved on` says in words exactly
	what the cells already say in shape and colour — verbatim, on every row
	of "No longer running anywhere" ("0 of 9 running · 9 moved on", nine
	times down one card). `here`/`movedOn`/`notReached` are struck from this
	line; ONLY `deploying` survives, because A.2/A.3 deliberately fold a
	`deploying` place into the bar's `here` weight ("blue never enters the
	bar … the word carries it") — the one count on this line the bar's own
	shape genuinely cannot say. What is left is what the bar cannot say:
	`N deploying` (an in-flight fact) and, below it, the age (an event in
	time) — the release itself is already named in the `identity` cell this
	snippet sits beside (`names()`'s per-service label run), so it is not
	repeated here a second time.
-->
{#snippet coverageRoll(
	row: RevisionRow,
	cov: ReturnType<typeof revisionCoverage>,
	kind: 'live' | 'past' | 'pending'
)}
	{@const c = coverageCounts(cov)}
	{@const neverDeployed = kind === 'pending'}
	{#if c.deploying > 0}
		<span class="t-dense text-gray-700 dark:text-gray-200">{c.deploying} deploying</span>
	{/if}
	<!--
		⭐ LANE 9, ROUND 11 QA, ITEM 5 — COMPACT BARS NOW CARRY `cells` TOO.
		Every `.bld-row` bar rendered with `title=null` on each cell before
		this: the only `CoverageBar` caller passing `cells` was the default
		(16px) scale. `coverageCells` is the same per-place identity
		`RevisionLead` and the build-page head band already compute; this is
		the one call site that was skipping it.

		⭐ ITEM 4 — `neverDeployed`, ONLY FOR THE "No deploy on record" LIST.
		A.6.1's own promise: a build nobody has ever run draws ALL TRACK, not
		"moved past" — see `coverageBarSegments`'s doc comment for why this
		module cannot derive that fact on its own and needs it from the
		caller that actually knows the row is `repo.pending`.
	-->
	<CoverageBar
		compact
		segments={coverageBarSegments(cov, neverDeployed)}
		cells={coverageCells(cov, neverDeployed)}
		label={coverageBarLabel(cov, row.short)}
		class="mt-1 w-full"
	/>
	<time
		class="t-micro mt-1 block text-gray-500 dark:text-gray-400"
		datetime={ageIso(row, kind)}
		title={ageTitle(row, kind)}>{ageOf(row, kind)}</time
	>
{/snippet}

{#snippet names(row: RevisionRow, named: boolean)}
	<span class="rev-names {named ? '' : 'rev-names--unnamed'}">
		{#each row.labelGroups as g (g.label)}
			<span class="rev-name-row">
				{#if named && rowNamesBuild(row)}<span
						class="rev-name t-code-sm text-gray-900 dark:text-white">{g.label}</span
					>{/if}
				<span class="rev-name-svcs">
					{#each g.services as svc, i (svc.appName)}<span
							class="t-body text-gray-700 dark:text-gray-200"
							>{svc.appName}{#if i < g.services.length - 1}<span
									class="mx-1 text-gray-500"
									aria-hidden="true">·</span
								>{/if}</span
						>{/each}
				</span>
			</span>
		{/each}
	</span>
{/snippet}

<!--
	⭐ FIX PASS ITEM 1, 2026-09-11 — ONE COLUMN, STACKED, NOT A SECOND
	MAIN/RAIL GRID. `.rev-cols` used to run its own `@container` grid here
	(320px rail below `sm`, a 16px seam) — the SECOND main/rail system on
	the repository page, at a different width and a different seam than
	the page's own `.rail-grid` (849/320, 32px) one screen up. The brief
	names both options as legitimate ("become part of the page rail or
	stack under"); this is the stack-under half — all three lists
	(`Also still running`, `No longer running anywhere`, `No deploy on
	record`) are now equal siblings in one flex column, inside the page's
	own `.rail-main`, so there is exactly one main/rail seam on this page,
	not two. -->
<div class="mt-4 flex min-w-0 flex-col gap-4">
	<!-- CARD 1 — THE QUIET PATH. -->
	{#if !(active && liveVisible.length === 0)}
		<!--
				⭐ REVISIONS-PASS-6, ITEM 5 — THE EMPTY STATE IS A `Card` AGAIN,
				MATCHING THE RAIL'S "Never deployed". Finding 7 (2026-09-09) had
				dropped this to a bare, unbordered `<p>` on the theory that an
				empty headered card "outranks a full one by sheer position and
				chrome" — measured against the RAIL two hundred pixels away,
				that produced the opposite defect: the rail's own empty state
				("Never deployed", `repo.pending.length === 0` below) is a full
				titled `Card` with an icon and a `0 builds` rollup, and this
				section's landmark (`Also still running` / `Still running`)
				disappeared from the page's heading structure entirely whenever
				there was nothing to show. One `Card`, always, so the section
				NAME survives being empty and both empty states in this
				component read as the same kind of fact.
			-->
		<Card
			icon={CheckCircleSolid}
			title={hasLeadRow ? 'Also still running' : 'Still running'}
			verdict={liveAll.length === 0
				? '0 builds'
				: liveVisible.length === liveAll.length
					? `${liveAll.length} build${liveAll.length === 1 ? '' : 's'}`
					: `${liveVisible.length} of ${liveAll.length} build${liveAll.length === 1 ? '' : 's'}`}
			verdictTitle="Older builds that some service is still running"
			padded={false}
		>
			{#if liveAll.length === 0}
				<p class="emptyListText t-body px-4 py-6 text-gray-500 dark:text-gray-400">
					{#if hasLeadRow}
						Nothing older is still running — every place is on a build above.
					{:else}
						Nothing this repo has deployed is still running. Every place has moved on.
					{/if}
				</p>
			{:else if liveVisible.length > 0}
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each liveVisible as row (row.key)}
						{@const cov = coverageOf(row)}
						{@const envSlots = liveEnvSlots(row)}
						<BuildRow>
							{#snippet mark()}
								<BuildStateMark coverage={cov} showWord={false} />
							{/snippet}
							{#snippet identity()}
								<div class="min-w-0">
									<a
										class="ident rev-sha tap-link t-code text-gray-900 hover:underline dark:text-white"
										href={changeBuildPath(repo.repoKey, row.revision, row.revision)}
										title={row.revision}>{row.short}</a
									>
									{@render names(row, namedLive)}
									{#if envSlots.length > 0}
										<div class="bld-envs flex flex-wrap gap-1.5 pt-1">
											{#each envSlots as slot (slot.envName)}
												{@const envDisplay = shortEnvLabel(slot.cell.theme) || slot.envName}
												<a
													class="hit-32 shrink-0"
													href={placeHref(slot)}
													aria-label={`Open the ${envDisplay.toUpperCase()} rollout for ${slot.appName}`}
												>
													<Chip role="env" theme={slot.cell.theme} label={envDisplay} wide />
												</a>
											{/each}
										</div>
									{/if}
								</div>
							{/snippet}
							{#snippet roll()}
								{@render coverageRoll(row, cov, 'live')}
							{/snippet}
						</BuildRow>
					{/each}
				</ul>
			{/if}
		</Card>
	{/if}

	<!-- CARD 2 — HISTORY. -->
	{#if pastAll.length > 0 && !(active && pastVisible.length === 0)}
		<Card
			icon={ArchiveSolid}
			title="No longer running anywhere"
			verdict={pastVisible.length === pastAll.length
				? `${pastAll.length} build${pastAll.length === 1 ? '' : 's'}`
				: `${pastVisible.length} of ${pastAll.length} build${pastAll.length === 1 ? '' : 's'}`}
			verdictTitle="Deployed at least once; every place that ran them has since moved on"
			padded={false}
		>
			{#if pastVisible.length > 0}
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each expandState.past ? pastVisible : pastVisible.slice(0, FOLD) as row (row.revision)}
						{@const cov = coverageOf(row)}
						<BuildRow>
							{#snippet mark()}
								<BuildStateMark coverage={cov} showWord={false} />
							{/snippet}
							{#snippet identity()}
								<div class="min-w-0">
									<a
										class="ident rev-sha tap-link t-code text-gray-700 hover:underline dark:text-gray-200"
										href={changeBuildPath(repo.repoKey, row.revision, row.revision)}
										title={row.revision}>{row.short}</a
									>
									{@render names(row, namedPast)}
								</div>
							{/snippet}
							{#snippet roll()}
								{@render coverageRoll(row, cov, 'past')}
							{/snippet}
						</BuildRow>
					{/each}
				</ul>
				{#if pastVisible.length > FOLD}
					{@render more(
						'past',
						`${pastVisible.length - FOLD} older build${pastVisible.length - FOLD === 1 ? '' : 's'}`
					)}
				{/if}
			{/if}
		</Card>
	{/if}

	<!-- CARD 3 — builds nobody has taken. -->
	{#if !(active && pendingVisible.length === 0 && repo.pending.length > 0)}
		<!--
				⭐ REVISIONS-PASS-6, ITEM 5 (second half) — THE HEADER STAYS ONE
				LINE. The verdict used to carry `· newest first` beside the
				count, and at ≥1280 that made `Card`'s header wrap to 65px
				against every other header's 47 — a `justify-between` row with
				a long right-hand rollup has nowhere left to go but a second
				line. The count alone always fits one line; "newest first" is
				not a COUNT, it is a fact about the body below it, so it moves
				there — the body's first line, alongside the retention
				footnote when one applies, rather than a second first line.
			-->
		<Card
			icon={HourglassOutline}
			title={pendingTitle}
			verdict={pendingVisible.length === repo.pending.length
				? `${repo.pending.length} build${repo.pending.length === 1 ? '' : 's'}`
				: `${pendingVisible.length} of ${repo.pending.length} build${repo.pending.length === 1 ? '' : 's'}`}
			padded={false}
		>
			{#if repo.pending.length > 0}
				<p
					class="t-micro border-b border-gray-100 px-4 py-2 text-gray-500 dark:border-gray-700/60 dark:text-gray-400"
				>
					{historyLimit.atLimit
						? `Newest first. ${PENDING_FOOTNOTE(historyLimit.limit)}`
						: 'Newest first.'}
				</p>
			{/if}
			{#if repo.pending.length === 0}
				<!--
						⭐ REVISIONS-PASS-6, ITEM 8 (second half) — THE SENTENCE CARRIES
						THE CONFIDENCE THE FIXED TITLE NO LONGER DOES (round 11 QA,
						item 13 — `pendingTitle` is one string now, "No deploy on
						record", always). "Has run somewhere" is the confident claim;
						under the cautious branch (retained history may not reach far
						enough back) the body says the hedge instead — the ONLY place
						left that distinguishes the two, since the heading above it no
						longer does.
					-->
				<p class="emptyListText t-body px-4 py-6 text-gray-500 dark:text-gray-400">
					{#if historyLimit.atLimit}
						No deploy is on record for any build your services can run — retained history may not go
						back far enough to be sure none of them ever has.
					{:else}
						Every build your services can deploy has run somewhere.
					{/if}
				</p>
			{:else if pendingVisible.length > 0}
				<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
					{#each expandState.pending ? pendingVisible : pendingVisible.slice(0, FOLD) as row (row.revision)}
						{@const cov = coverageOf(row)}
						<BuildRow>
							{#snippet mark()}
								<HourglassOutline
									class="h-4 w-4 text-gray-400 dark:text-gray-500"
									aria-hidden="true"
								/>
							{/snippet}
							{#snippet identity()}
								<a
									class="ident rev-sha tap-link t-code min-w-0 text-gray-700 hover:underline dark:text-gray-200"
									href={changeBuildPath(repo.repoKey, row.revision, row.revision)}
									title={row.revision}>{row.short}</a
								>
							{/snippet}
							{#snippet roll()}
								<span class="bld-svc-names t-dense block text-gray-700 dark:text-gray-200"
									>{matchedServiceNames(row).join(' · ')}</span
								>
								{@render coverageRoll(row, cov, 'pending')}
							{/snippet}
						</BuildRow>
					{/each}
				</ul>
				{#if pendingVisible.length > FOLD}
					{@render more(
						'pending',
						`${pendingVisible.length - FOLD} more build${pendingVisible.length - FOLD === 1 ? '' : 's'}`
					)}
				{/if}
			{/if}
		</Card>
	{/if}
</div>

<style>
	/*
	 * ⛔ `.rev-cols`'S GRID IS GONE, ROUND 2 OF FIX PASS ITEM 1, 2026-09-11.
	 * It was the page's SECOND main/rail system — a 320px rail at a 16px
	 * seam, one screen below the page's own `.rail-grid` (849/320, 32px
	 * seam) — so the three lists this component renders are a single flex
	 * column now (see the markup comment above it) and this class has no
	 * caller left.
	 */

	/*
	 * ⛔ `.bld-fill-track`/`.bld-fill` ARE GONE, ROUND 11 REVISIONS-PASS-6,
	 * ITEM 11. The hand-rolled two-tone painted track — gated on
	 * `liveCount < totalCount`, so it drew nothing on a 100%-live row and
	 * nothing at all on the other two lists — is replaced by `CoverageBar`
	 * (compact scale) via the shared `coverageRoll` snippet above, which
	 * draws on every row in all three lists, always. See that snippet's
	 * own comment.
	 */
</style>
