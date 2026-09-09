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
	 * `.rev-cols` + THE THREE BUILD LISTS — extracted from `/revisions`
	 * (round 11, lane 2). Main column: "Also still running" and "No longer
	 * running anywhere"; 340px rail: "Never deployed". For the repository
	 * page (lane 3) — the index (this lane's own route) renders none of
	 * this (B.2.5).
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
	import { revisionCoverage } from '$lib/view-models/revision-coverage';
	import { historyAtLimit } from '$lib/history-marks';
	import { revisionPath } from '$lib/version-utils';
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

	function livePercent(live: number, total: number): number {
		return total > 0 ? Math.round((live / total) * 100) : 0;
	}

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
		for (const row of [...repo.rows, ...repo.pending]) {
			for (const s of row.services) {
				for (const slot of s.slots) {
					if (historyAtLimit(slot.cell.rollout)) {
						return { atLimit: true, limit: slot.cell.rollout?.spec?.versionHistoryLimit ?? 10 };
					}
				}
			}
		}
		return { atLimit: false, limit: 10 };
	});

	const pendingTitle = $derived(historyLimit.atLimit ? 'No deploy on record' : 'Never deployed');
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
		<button type="button" class="btn btn-secondary w-full" aria-expanded={expandState[key]} onclick={() => toggle(key)}>
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

{#snippet names(row: RevisionRow, named: boolean)}
	<span class="rev-names {named ? '' : 'rev-names--unnamed'}">
		{#each row.labelGroups as g (g.label)}
			<span class="rev-name-row">
				{#if named && rowNamesBuild(row)}<span class="rev-name t-code-sm text-gray-900 dark:text-white">{g.label}</span
					>{/if}
				<span class="rev-name-svcs">
					{#each g.services as svc, i (svc.appName)}<span class="t-body text-gray-700 dark:text-gray-200"
							>{svc.appName}{#if i < g.services.length - 1}<span class="mx-1 text-gray-500" aria-hidden="true">·</span
								>{/if}</span
						>{/each}
				</span>
			</span>
		{/each}
	</span>
{/snippet}

<div class="rev-cols mt-4">
	<div class="flex min-w-0 flex-col gap-4">
		<!-- CARD 1 — THE QUIET PATH. -->
		{#if !(active && liveVisible.length === 0)}
			{#if liveAll.length === 0}
				<!--
					⭐ FINDING 7 (operator sweep, 2026-09-09) — AN EMPTY LIST IS A
					NOTE, NOT A CARD. A bordered, headered `Card` reading "Also
					still running · 0 builds" sat ABOVE "No longer running
					anywhere"'s own 10 real rows — the empty object outranked the
					full one by sheer position and chrome. A one-line, unbordered
					note carries the same fact at a fraction of the ink.
				-->
				{#if !active}
					<p class="t-body text-gray-500 dark:text-gray-400">
						{#if hasLeadRow}
							Nothing older is still running — every place is on a build above.
						{:else}
							Nothing this repo has deployed is still running. Every place has moved on.
						{/if}
					</p>
				{/if}
			{:else}
				<Card
					icon={CheckCircleSolid}
					title={hasLeadRow ? 'Also still running' : 'Still running'}
					verdict={liveVisible.length === liveAll.length
						? `${liveAll.length} build${liveAll.length === 1 ? '' : 's'}`
						: `${liveVisible.length} of ${liveAll.length} build${liveAll.length === 1 ? '' : 's'}`}
					verdictTitle="Older builds that some service is still running"
					padded={false}
				>
					{#if liveVisible.length > 0}
						<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
							{#each liveVisible as row (row.revision)}
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
												href={revisionPath(repo.repoKey, row.revision)}
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
										<span class="t-dense text-gray-700 dark:text-gray-200">
											Running in {row.liveSlots} of {row.totalSlots}
											<span class="text-gray-500 dark:text-gray-400">places</span>
										</span>
										{#if cov.liveCount < cov.totalCount}
											<div
												class="bld-fill-track"
												role="img"
												aria-label="running in {cov.liveCount} of {cov.totalCount} places"
											>
												<div class="bld-fill" style="width: {livePercent(cov.liveCount, cov.totalCount)}%"></div>
											</div>
										{/if}
										<time
											class="t-micro mt-1 block text-gray-500 dark:text-gray-400"
											datetime={ageIso(row, 'live')}
											title={ageTitle(row, 'live')}>{ageOf(row, 'live')}</time
										>
									{/snippet}
								</BuildRow>
							{/each}
						</ul>
					{/if}
				</Card>
			{/if}
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
											href={revisionPath(repo.repoKey, row.revision)}
											title={row.revision}>{row.short}</a
										>
										{@render names(row, namedPast)}
									</div>
								{/snippet}
								{#snippet roll()}
									<time
										class="t-micro block text-gray-500 dark:text-gray-400"
										datetime={ageIso(row, 'past')}
										title={ageTitle(row, 'past')}>{ageOf(row, 'past')}</time
									>
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
	</div>

	<div class="flex min-w-0 flex-col gap-4">
		<!-- THE RAIL — builds nobody has taken. -->
		{#if !(active && pendingVisible.length === 0 && repo.pending.length > 0)}
			<Card
				icon={HourglassOutline}
				title={pendingTitle}
				verdict={pendingVisible.length === repo.pending.length
					? `${repo.pending.length} build${repo.pending.length === 1 ? '' : 's'} · newest first`
					: `${pendingVisible.length} of ${repo.pending.length} build${repo.pending.length === 1 ? '' : 's'}`}
				padded={false}
			>
				{#if historyLimit.atLimit}
					<p class="t-micro border-b border-gray-100 px-4 py-2 text-gray-500 dark:border-gray-700/60 dark:text-gray-400">
						{PENDING_FOOTNOTE(historyLimit.limit)}
					</p>
				{/if}
				{#if repo.pending.length === 0}
					<p class="emptyListText t-body px-4 py-6 text-gray-500 dark:text-gray-400">
						Every build your services can deploy has run somewhere.
					</p>
				{:else if pendingVisible.length > 0}
					<ul class="divide-y divide-gray-100 dark:divide-gray-700/60">
						{#each expandState.pending ? pendingVisible : pendingVisible.slice(0, FOLD) as row (row.revision)}
							<BuildRow>
								{#snippet mark()}
									<HourglassOutline class="h-4 w-4 text-gray-400 dark:text-gray-500" aria-hidden="true" />
								{/snippet}
								{#snippet identity()}
									<a
										class="ident rev-sha tap-link t-code min-w-0 text-gray-700 hover:underline dark:text-gray-200"
										href={revisionPath(repo.repoKey, row.revision)}
										title={row.revision}>{row.short}</a
									>
								{/snippet}
								{#snippet roll()}
									<span class="bld-svc-names t-dense block text-gray-700 dark:text-gray-200"
										>{matchedServiceNames(row).join(' · ')}</span
									>
									<time
										class="t-micro block text-gray-500 dark:text-gray-400"
										datetime={ageIso(row, 'pending')}
										title={ageTitle(row, 'pending')}>{ageOf(row, 'pending')}</time
									>
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
</div>

<style>
	.rev-cols {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 16px;
	}

	@container (min-width: 860px) {
		.rev-cols {
			grid-template-columns: minmax(0, 1fr) 340px;
		}
	}

	.bld-fill-track {
		margin-top: 4px;
		height: 4px;
		width: 100%;
		border-radius: 2px;
		background-color: var(--color-gray-200);
	}

	:global(.dark) .bld-fill-track {
		background-color: var(--color-gray-700);
	}

	.bld-fill {
		height: 100%;
		border-radius: 2px;
		background-color: var(--color-green-700);
	}

	:global(.dark) .bld-fill {
		background-color: var(--color-green-600);
	}
</style>
