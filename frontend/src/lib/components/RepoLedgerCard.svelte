<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE INDEX CARD — one per repository on `/revisions`, extracted from
	 * that route (round 11, lane 2 — `.agents-context/design/
	 * REVISIONS-2026-09-05.md`, "B.2 — The index card").
	 *
	 * Answers "is anything held or behind here" without opening the card:
	 * header (icon, name, verdict, chevron — the WHOLE bar is the one link
	 * to the repository page), the per-service ledger (§7a's grammar,
	 * capped at 6 rows unless this is the fleet's only repository), and a
	 * footer (the three lifetime counts, `View repository` external).
	 *
	 * ⛔ NO TOGGLE. Round 7.6 ("the repository header is the toggle") is
	 * overruled by this round's own B.2: there is nothing on the index to
	 * disclose — the hero, the build lists and the held banner all moved to
	 * the repository page (lane 3). The chevron means "open the repository
	 * page", nothing else.
	 *
	 * ⭐ FINDING 1 (operator sweep, 2026-09-09, BLOCKING) — a query that
	 * matches a release LABEL (`2.67.0-67`) must match the ledger LINE
	 * carrying that label, not just the `RevisionRow` the head band counts.
	 * `matchesRevisionText` + `revisionLookup` (`revision-ledger.ts`) are the
	 * fix: both the row-level match count and the line-level ledger filter
	 * go through the same predicate now.
	 */
	import {
		deployedRevisionCount,
		leadRowsFor,
		matchesRevisionText,
		orderServiceGroups,
		releaseLines,
		revisionLookup,
		serviceLedger,
		lineState,
		type RepoLedger,
		type RevisionSlot,
		type ServiceLedgerGroup,
		type ServiceLedgerLine,
		type LineStateChip
	} from '$lib/view-models/revision-ledger';
	import { revisionCoverage, heldBehind, slotBakeStatus } from '$lib/view-models/revision-coverage';
	import { rankLabel, rankRole, type RankVerdict } from '$lib/view-models/env-rank';
	import { shortEnvLabel } from '$lib/environment-theme';
	import { bakeWord, bakeTitle } from '$lib/bake-status';
	import { revisionPath, repoSlug, repoLabel as repoLabelOf } from '$lib/version-utils';
	import { formatTimeAgoCompact, formatDate } from '$lib/utils';
	import { rolloutPath } from '$lib/source-dashboard';
	import { repoTitle } from '../../routes/revisions/repo-title';
	import { countLabel } from '$lib/disclosure';
	import {
		CodeBranchOutline,
		ChevronRightOutline,
		ChevronDownOutline,
		ArrowUpRightFromSquareOutline
	} from 'flowbite-svelte-icons';
	import Chip from './Chip.svelte';
	import BakeStatusIcon from './BakeStatusIcon.svelte';

	const FOLD = 6;

	let {
		repo,
		now,
		query = '',
		uncapped = false,
		repoUrl = null
	}: {
		repo: RepoLedger;
		now: Date;
		/** Trimmed search text; `''` means no filter active. */
		query?: string;
		/** B.7 — the fleet's only repository draws every ledger row. */
		uncapped?: boolean;
		repoUrl?: string | null;
	} = $props();

	const active = $derived(query.trim().length > 0);
	const needle = $derived(query.trim().toLowerCase());

	const href = $derived(`/revisions/${repoSlug(repo.repoKey)}${active ? `?q=${encodeURIComponent(query.trim())}` : ''}`);

	let expanded = $state(false);

	const lines = $derived(releaseLines(repo));
	const multiLine = $derived(lines.length > 1);
	const serviceLineIndex = $derived(
		new Map(lines.flatMap((l, li) => l.services.map((s) => [s, li] as const)))
	);

	const lookup = $derived(revisionLookup(repo));

	function lineMatches(line: Pick<ServiceLedgerLine, 'revision' | 'short'>): boolean {
		if (!active) return true;
		// ⛔ CHECK EVERY ROW SHARING THIS REVISION, NOT JUST ONE — see
		// `revisionLookup`'s own doc comment. A held commit can resolve to
		// two rows (the running release and the held sibling); the line's
		// own label lives on WHICHEVER row it belongs to, and a lookup that
		// only kept one would go blind on the other exactly the way the
		// blocking finding described.
		const rows = lookup.get(line.revision);
		if (rows && rows.length > 0) return rows.some((row) => matchesRevisionText(row, needle));
		return matchesRevisionText(line as never, needle);
	}

	function visibleGroupsOf(groups: ServiceLedgerGroup[]): ServiceLedgerGroup[] {
		if (!active) return groups;
		const out: ServiceLedgerGroup[] = [];
		for (const g of groups) {
			if (g.appName.toLowerCase().includes(needle)) {
				out.push(g);
				continue;
			}
			const matchedLines = g.lines.filter(lineMatches);
			if (matchedLines.length > 0) out.push({ appName: g.appName, lines: matchedLines });
		}
		return out;
	}

	const groups = $derived(serviceLedger(repo));
	const ordered = $derived(
		orderServiceGroups(visibleGroupsOf(groups), {
			lineIndexOf: multiLine ? (appName) => serviceLineIndex.get(appName) ?? 0 : undefined,
			now
		})
	);
	const shown = $derived(uncapped || expanded ? ordered : ordered.slice(0, FOLD));

	/**
	 * `repoKnownMatchCount` — how many DISTINCT revisions (deployed or
	 * pending) this repo's own known set matches, deduped the same way
	 * `deployedRevisionCount` dedupes a held commit's split rows. Used only
	 * under an active search; B.5's `{n} of {m} builds` rollup.
	 */
	const matchCount = $derived.by(() => {
		if (!active) return 0;
		const matched = new Set<string>();
		for (const row of [...repo.rows, ...repo.pending]) {
			if (matchesRevisionText(row, needle)) matched.add(row.revision);
		}
		return matched.size;
	});

	const noMatch = $derived(active && ordered.length === 0);

	/**
	 * ⭐ B.2's VERDICT ROLLUP — "held" and "behind" here are PLACE counts (one
	 * service in one environment), across every release line's own lead
	 * (deployed) row — the same shape the old fleet-wide head band summed
	 * per repo, scoped to just this one now that the head band no longer
	 * carries it.
	 */
	const verdict = $derived.by(() => {
		let held = 0;
		let behind = 0;
		for (const leadRow of leadRowsFor(repo, lines)) {
			const cov = revisionCoverage(leadRow, now);
			held += heldBehind(cov).filter((s) => s.blockingGates.length > 0).length;
			const notYet = cov.buckets.find((b) => b.key === 'notYet')?.slots ?? [];
			behind += notYet.filter((s) => !s.slot.onRevision).length;
		}
		const headCreated = repo.rows[0]?.createdMs ?? 0;
		const newer = headCreated > 0 ? repo.pending.filter((p) => p.createdMs > headCreated).length : 0;
		if (held > 0) {
			return {
				chip: { role: 'alarm' as const, label: `${held} held` },
				text: `${countLabel(held, 'place')} held`
			};
		}
		if (behind > 0) {
			return { chip: null, text: `${countLabel(behind, 'place')} behind` };
		}
		if (newer > 0) {
			return { chip: null, text: `${newer} newer build${newer === 1 ? '' : 's'}` };
		}
		return { chip: null, text: 'Everything on its newest build' };
	});

	function rankVerdictFor(rank: number): RankVerdict {
		return rank === 0 ? { kind: 'newest' } : { kind: 'behind', by: rank };
	}

	function identParts(name: string): string[] {
		return name.split(/(?<=-)/);
	}

	function placeHref(slot: Pick<RevisionSlot, 'cell'>): string {
		return rolloutPath(
			slot.cell.sourceCluster,
			slot.cell.rollout.metadata?.namespace ?? '',
			slot.cell.rollout.metadata?.name ?? ''
		);
	}

	/**
	 * ⭐ ROUND SIX §3 — THE LEDGER'S OWN AGE COLUMN, ported from the route.
	 * The newest deploy timestamp across this line's own live slots. Also
	 * what keeps the ledger grid's 4th cell occupied on every deployed line
	 * — see the template's own comment beside `.svc-age`.
	 */
	function lineAgeMs(line: Pick<ServiceLedgerLine, 'slots'>): number | null {
		let latest = 0;
		for (const slot of line.slots) {
			const t = slot.cell.rollout.status?.history?.[0]?.timestamp;
			if (!t) continue;
			const ms = new Date(t).getTime();
			if (Number.isFinite(ms) && ms > latest) latest = ms;
		}
		return latest > 0 ? latest : null;
	}

	function lineAge(line: Pick<ServiceLedgerLine, 'slots'>): string | null {
		const ms = lineAgeMs(line);
		return ms ? `Deployed ${formatTimeAgoCompact(new Date(ms).toISOString(), now)} ago` : null;
	}

	function lineAgeIso(line: Pick<ServiceLedgerLine, 'slots'>): string | undefined {
		const ms = lineAgeMs(line);
		return ms ? new Date(ms).toISOString() : undefined;
	}

	function lineAgeTitle(line: Pick<ServiceLedgerLine, 'slots'>): string {
		const ms = lineAgeMs(line);
		return ms ? formatDate(new Date(ms).toISOString()) : '';
	}
</script>

<!--
	⭐ ROUND 11 REVISIONS-PASS-6, ITEM 6 — THE ROW'S SECOND CHIP, SHARED BY
	THE RANKED AND UNRANKED BRANCHES. A `held` state names the BLOCKED
	CANDIDATE (`state.holdOf`) rather than repeating this row's own running
	sha under an alarm fill — see the rank-chip branch's own comment below
	for why that used to name the wrong build. Every other state keeps the
	plain wide chip it always had; `deploying`/`checking` render nothing
	here (that in-flight glyph is the rank chip's own icon slot elsewhere on
	this row).
-->
{#snippet secondaryChip(state: LineStateChip | null)}
	{#if state?.role === 'held'}
		<Chip
			role="alarm"
			label="HELD"
			value={state.holdOf?.label ?? state.holdOf?.short}
			valueTitle={state.holdOf?.label ? state.holdOf.short : undefined}
			title={state.title}
			wide
		/>
	{:else if state && state.role !== 'deploying' && state.role !== 'checking'}
		<Chip role={state.role} label={state.label} title={state.title} wide />
	{/if}
{/snippet}

<!--
	⭐ THE WHOLE HEADER IS THE ONE `<a>` — `lib/CLAUDE.md`'s own rule: "a
	region that reads as a destination must BE one." The chevron is
	decorative; the header itself is the tap target.
-->
<div
	class="repo-ledger-card flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
>
	<a
		{href}
		class="tap-zone flex min-h-[47px] w-full flex-wrap items-center justify-between gap-x-2.5 gap-y-1 border-b border-gray-200 bg-gray-50 px-4 py-3 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800/60 dark:hover:bg-gray-700/50"
	>
		<span class="flex min-w-0 items-center gap-2.5">
			<CodeBranchOutline class="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
			<h2 class="t-card-title min-w-0 break-words text-gray-900 dark:text-white">
				{repoTitle(repo.repoLabel)}
			</h2>
		</span>
		<span class="flex shrink-0 items-center gap-2">
			{#if noMatch}
				<span class="t-card-rollup whitespace-nowrap text-gray-500 dark:text-gray-400">no match</span>
			{:else if active}
				<span class="t-card-rollup whitespace-nowrap text-gray-500 dark:text-gray-400">
					{matchCount} of {repo.knownRevisions} build{repo.knownRevisions === 1 ? '' : 's'}
				</span>
			{:else if verdict.chip}
				<!--
					⭐ ROUND 11 REVISIONS-PASS-6, ITEM 6 — CHIP OR WORDS, NEVER BOTH.
					`3 HELD · 3 places held ›` said the identical fact twice — the
					chip already carries the count (`3 held`) and the full sentence
					lives in its own `title`. The chevron stays; the words go.
				-->
				<Chip role={verdict.chip.role} label={verdict.chip.label} wide title={verdict.text} />
			{:else}
				<span class="t-card-rollup whitespace-nowrap text-gray-500 dark:text-gray-400">{verdict.text}</span
				>
			{/if}
			<ChevronRightOutline class="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
		</span>
	</a>

	{#if noMatch}
		<p class="emptyListText t-body px-4 py-6 text-gray-500 dark:text-gray-400">
			No build matches “{query.trim()}”.
		</p>
	{:else}
		<div class="svc-ledger py-1">
			{#each shown as group, gi (group.appName)}
				{@const li = serviceLineIndex.get(group.appName) ?? 0}
				{@const prevLi = gi > 0 ? (serviceLineIndex.get(shown[gi - 1].appName) ?? 0) : null}
				{#if multiLine && li !== prevLi}
					<div class="svc-line-gap" aria-hidden="true"></div>
				{/if}
				{#each group.lines.length ? group.lines : [null] as line, idx (line ? `${group.appName}/${line.revision}` : `${group.appName}/none`)}
					{@const state = line ? lineState(line, now) : null}
					<div class="svc-line">
						<span class="svc-header">
							{#if idx === 0}
								<a
									href={`/apps/${encodeURIComponent(group.appName)}`}
									aria-label={group.appName}
									class="svc-name tap-link t-body text-gray-700 hover:underline dark:text-gray-200"
								>
									{#each identParts(group.appName) as part, pi (pi)}{part}{#if pi < identParts(group.appName).length - 1}<wbr
											/>{/if}{/each}
								</a>
							{:else}
								<span
									class="svc-name svc-name-continuation t-body text-gray-700 dark:text-gray-200"
									aria-hidden="true"
								>
									{#each identParts(group.appName) as part, pi (pi)}{part}{#if pi < identParts(group.appName).length - 1}<wbr
											/>{/if}{/each}
								</span>
							{/if}
						</span>
						{#if line}
							{#if line.rank !== null}
								{@const verdict2 = rankVerdictFor(line.rank)}
								<span class="svc-build">
									<!--
										⭐ ROUND 11 REVISIONS-PASS-6, ITEM 6 — THE ROW IS ABOUT
										WHAT RUNS. A `held` line means THIS release cannot
										advance to a newer one — it is still the thing running,
										so the rank chip naming it draws FIRST, exactly as an
										unheld line's does. The `HELD` chip follows, naming the
										blocked CANDIDATE (`state.holdOf`) rather than repeating
										this row's own running sha under an alarm fill — the old
										single joined `HELD <running sha>` chip named the wrong
										build.
									-->
									<span class="svc-build-id">
										<Chip
											role={rankRole(verdict2)}
											label={rankLabel(verdict2)}
											value={line.short}
											valueHref={revisionPath(repo.repoKey, line.revision)}
											valueTitle={line.revision}
										/>
									</span>
									{@render secondaryChip(state)}
								</span>
							{:else}
								<span class="svc-build">
									<a
										class="svc-sha rev-sha ident tap-link t-code text-gray-900 hover:underline dark:text-white"
										href={revisionPath(repo.repoKey, line.revision)}
										title={line.revision}>{line.short}</a
									>
									{@render secondaryChip(state)}
								</span>
							{/if}
							<span class="svc-envs">
								{#each line.slots as slot (slot.envName)}
									{@const envDisplay = shortEnvLabel(slot.cell.theme) || slot.envName}
									{@const inFlightBake = slotBakeStatus(slot)}
									{@const inFlight = inFlightBake === 'Deploying' || inFlightBake === 'InProgress'}
									<a
										class="hit-32 shrink-0"
										href={placeHref(slot)}
										aria-label={`Open the ${envDisplay.toUpperCase()} rollout for ${group.appName}${inFlight ? ` — ${bakeWord(inFlightBake)}` : ''}`}
									>
										{#if inFlight}
											{#snippet inFlightGlyph()}
												<span class="mr-[3px] inline-flex shrink-0 items-center">
													<BakeStatusIcon bakeStatus={inFlightBake} size="small" decorative />
												</span>
											{/snippet}
											<Chip
												role="env"
												theme={slot.cell.theme}
												label={envDisplay}
												wide
												icon={inFlightGlyph}
												title="{group.appName} in {envDisplay.toUpperCase()} — {bakeTitle(inFlightBake)}"
											/>
										{:else}
											<Chip role="env" theme={slot.cell.theme} label={envDisplay} wide title="{group.appName} in {envDisplay.toUpperCase()}" />
										{/if}
									</a>
								{/each}
							</span>
							<!--
								⭐ THE GRID'S 4TH CELL, AND WHY IT MAY NOT BE OMITTED.
								`.svc-ledger` is ONE grid container shared by every
								`.svc-line` (`display: contents`, so each line's own
								children are auto-placed directly into it). CSS grid
								auto-flow fills a row's remaining tracks with the NEXT
								item when a row is short one, so a line emitting only 3
								cells (name/build/envs, no age) let the FOLLOWING line's
								name cell slide into THIS row's 4th column instead of
								starting its own row — exactly what a live screenshot at
								1440 showed: two services sharing one visual row. Every
								deployed line emits exactly 4 cells now, always.
							-->
							<span class="svc-age t-micro text-gray-500 dark:text-gray-400">
								{#if lineAge(line)}
									<time datetime={lineAgeIso(line)} title={lineAgeTitle(line)}>{lineAge(line)}</time>
								{/if}
							</span>
						{:else}
							<span class="svc-empty t-micro text-gray-500 dark:text-gray-400">Not deployed</span>
						{/if}
					</div>
				{/each}
			{/each}
		</div>
		{#if !uncapped && ordered.length > FOLD}
			<!--
				⭐ CRAFT REVIEW (c) — THE ONE SECONDARY BUTTON SHAPE. `Show N older
				builds` measured h37, 12px/400, `padding 10px 16px`, radius 0, no
				border — not a button shape at all. `.btn.btn-secondary` (`app.css`)
				is the product's one secondary button (14px/500, 8px/16px padding,
				radius 8, 1px border); this is now every "Show more" in the
				repository card's own ledger.
			-->
			<div class="border-t border-gray-100 p-2 dark:border-gray-700/60">
				<button
					type="button"
					class="btn btn-secondary w-full"
					aria-expanded={expanded}
					onclick={() => (expanded = !expanded)}
				>
					{#if expanded}
						<ChevronDownOutline class="h-3.5 w-3.5" aria-hidden="true" />
						Hide {ordered.length - FOLD} more service{ordered.length - FOLD === 1 ? '' : 's'}
					{:else}
						<ChevronRightOutline class="h-3.5 w-3.5" aria-hidden="true" />
						Show {ordered.length - FOLD} more service{ordered.length - FOLD === 1 ? '' : 's'}
					{/if}
				</button>
			</div>
		{/if}
	{/if}

	{#if !noMatch && !active}
		{@const deployedRevisions = deployedRevisionCount(repo)}
		<div
			class="repo-meta flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-2 dark:border-gray-700/60"
		>
			<span
				class="repo-meta-text t-micro min-w-0 truncate text-gray-500 dark:text-gray-400"
				title="A place is one service in one environment. 'Deployed at least once' counts distinct commits that have run somewhere, ever."
			>
				{repo.knownRevisions} build{repo.knownRevisions === 1 ? '' : 's'} · {deployedRevisions} deployed
				at least once · {repo.slotCount} place{repo.slotCount === 1 ? '' : 's'} to deploy to{multiLine
					? ` · across ${lines.length} release lines`
					: ''}
			</span>
			{#if repoUrl}
				<a
					class="nav-link shrink-0"
					href={repoUrl}
					target="_blank"
					rel="noopener noreferrer"
					title={repoLabelOf(repo.repoKey)}
				>
					View repository
					<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
				</a>
			{/if}
		</div>
	{/if}
</div>

<style>
	.repo-ledger-card {
		container-type: inline-size;
	}

	/*
	 * ⭐ CRAFT REVIEW (a) — THE STATUS-CHIP COLUMN IS MIN-CONTENT, NOT A FIXED
	 * 190px. Measured on today's page: `[1 BEHIND][2.66.0-66]` wrapped
	 * `[HELD]` to a second line at 1024–1680 while 800–940px of the card
	 * stood empty — a fixed track sized for the wrong content. `minmax(150px,
	 * max-content)` lets the joined chip and any state chip beside it sit on
	 * one line, and never lets the track collapse below the joined chip's
	 * own floor.
	 */
	.svc-ledger {
		display: grid;
		grid-template-columns: 180px minmax(150px, max-content) 220px minmax(0, 1fr);
		align-items: center;
		column-gap: 12px;
		row-gap: 6px;
	}

	.svc-line {
		display: contents;
	}

	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 7 — THE GAP BETWEEN RELEASE-LINE
	 * GROUPS READS AS A GLITCH WITHOUT A MARK. 8px of bare ground between
	 * `hello-api-app` and `hello-multi-app` (this repo's two release lines)
	 * looked identical to a rendering bug — nothing on the row said "new
	 * group starts here". A centred hairline draws the separation the
	 * blank row was already reserving space for; the rhythm otherwise stays
	 * exactly what it was (same 8px, same column span).
	 */
	.svc-line-gap {
		grid-column: 1 / -1;
		height: 8px;
		display: flex;
		align-items: center;
	}

	.svc-line-gap::after {
		content: '';
		display: block;
		width: 100%;
		height: 1px;
		margin: 0 16px;
		background-color: var(--color-gray-100);
	}

	:global(.dark) .svc-line-gap::after {
		background-color: color-mix(in oklab, var(--color-gray-700) 60%, transparent);
	}

	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 7 — THE WRAP MUST ALIGN WITH THE
	 * FIRST LINE. `<a class="svc-name">`/`<span class="svc-name-
	 * continuation">` are inline by default, and CSS's own rule for inline
	 * padding is that LEFT padding applies only before the FIRST line box —
	 * a second, wrapped line starts at the box's outer edge with none of
	 * it, which reads as a negative indent (measured live: the wrapped
	 * line landed 17px left of the column edge the first line started at).
	 * `display: block` makes the padding apply to the BOX, so every
	 * wrapped line starts at the same content edge as the first.
	 */
	.svc-name,
	.svc-name-continuation {
		display: block;
		padding: 6px 16px 6px 16px;
		overflow-wrap: break-word;
	}

	.svc-build {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		padding: 6px 0;
	}

	.svc-build-id {
		display: inline-flex;
	}

	.svc-envs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 6px 0;
	}

	.svc-empty {
		padding: 6px 16px;
		grid-column: 2 / -1;
	}

	.svc-age {
		text-align: right;
		white-space: nowrap;
		padding: 6px 0;
	}

	/*
	 * ⭐ HEIGHT BUDGET (B.3: "~700px at 390 with two repos"). Four fully
	 * stacked lines per service (name / build / envs / age, each on its own
	 * row) measured ~120px per row — 7 services across two repos alone blew
	 * past 1600px. The reference row is TWO lines: name flush left, age
	 * flush right, ON ONE LINE; build chip + env chips wrap together on the
	 * line under it. `order` on a `flex-wrap` container gets there without
	 * reordering the DOM (the desktop grid needs the SAME 4 children in
	 * their existing order for its own auto-placement — see `.svc-age`'s
	 * own comment above): `svc-build`'s `flex-basis: 100%` forces a wrap
	 * BEFORE it, so `svc-header`/`svc-age` (before it, order 1/2) share the
	 * line above and `svc-build`/`svc-envs` (order 3/4) share the line
	 * below.
	 */
	@container (max-width: 560px) {
		.svc-ledger {
			grid-template-columns: minmax(0, 1fr);
		}
		.svc-line {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			column-gap: 8px;
			row-gap: 4px;
			padding: 8px 16px;
			border-bottom: 1px solid var(--color-gray-100);
		}
		:global(.dark) .svc-line {
			border-bottom-color: color-mix(in oklab, var(--color-gray-700) 60%, transparent);
		}
		.svc-header {
			order: 1;
			min-width: 0;
		}
		.svc-age {
			order: 2;
			margin-left: auto;
			padding: 0;
		}
		.svc-build {
			order: 3;
			flex-basis: 100%;
			padding: 0;
		}
		.svc-envs {
			order: 4;
			padding: 0;
		}
		.svc-empty {
			order: 3;
			flex-basis: 100%;
			padding: 0;
		}

		/*
		 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 11 — THE META LINE NEVER
		 * ELLIPSISES A COUNT. `.repo-meta-text`'s `truncate` (markup) is
		 * right at `sm`+, where the row has `View repository` to its right
		 * and not enough of the card's own width to wrap into — but below
		 * 560px the two stacked and the SAME class clipped `36 builds · 12
		 * deployed at le…`, mid-count, with `View repository` sharing the
		 * line it had already run out of room for. Unlayered, this
		 * Svelte-scoped rule outranks `truncate`'s own utility layer
		 * (`lib/CLAUDE.md`'s note) — no markup change needed. `flex-col` +
		 * `items-start` lets the sentence wrap in full above, and `View
		 * repository` moves to its own line, right-aligned via its own
		 * `align-self`.
		 */
		.repo-meta {
			flex-direction: column;
			align-items: flex-start;
		}
		.repo-meta-text {
			white-space: normal;
			overflow: visible;
			text-overflow: unset;
		}
		.repo-meta > .nav-link {
			align-self: flex-end;
		}
	}
</style>
