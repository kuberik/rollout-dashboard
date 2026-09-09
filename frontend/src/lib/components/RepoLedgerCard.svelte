<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE SERVICE LEDGER CARD — one per repository. Round 11, lane 2
	 * extracted this from `/revisions` for the index (B.2); ROUND 11
	 * REVISIONS-PASS-6 ITEM 1 (r11c) finishes the consolidation the extraction
	 * left half-done: the repository page (`routes/revisions/[...slug]/
	 * +page.svelte`) had grown its OWN second copy of this exact grammar
	 * (`.svc-name-btn` toggles, its own `.svc-ledger` grid) instead of
	 * importing this component, so the two pages could — and did — drift
	 * (item 2's grid-inset defects existed in one copy and not the other).
	 * ONE LEDGER now: both pages render this component, and the two former
	 * copies converge on `filterable` — the one axis they actually differ on.
	 *
	 * ⭐ THE SHELL IS `Card`, THE PRODUCT'S ONE TITLED PANEL — not a hand-rolled
	 * `rounded-xl` div with its own header markup (which is what this file
	 * used to be, and what the route's second copy still was: `radius 8, a
	 * 47px <header> with icon, title and the rollup` is `Card`'s own
	 * geometry, re-derived a second time instead of reused). The two modes:
	 *
	 *   `filterable={false}` (the INDEX, B.2) — the WHOLE header is a link to
	 *   the repository page (`Card`'s own `titleHref`), title is
	 *   `repoTitle(repo.repoLabel)`, the rollup is the held/behind verdict (a
	 *   `Chip` or plain words) plus a trailing chevron — no toggle, nothing to
	 *   disclose here; opening the card is the only affordance.
	 *
	 *   `filterable={true}` (the REPOSITORY PAGE, B.4 item 4) — the header is
	 *   plain (no link — the page IS this object already), title is `What
	 *   each service runs`, the rollup is a bare `N services` count that
	 *   recounts under the ledger's OWN multi-select filter. Row names become
	 *   `aria-pressed` toggle buttons (gray-900/gray-100 pressed fill, per
	 *   `lib/CLAUDE.md`'s standing toggle rule) instead of links — B.2's own
	 *   closing rule ("the ledger rows are NOT filter toggles on the index")
	 *   means this behaviour never reaches the index, because the index never
	 *   passes `filterable`.
	 *
	 * ⛔ NO TOGGLE ON THE INDEX. Round 7.6 ("the repository header is the
	 * toggle") stays overruled by B.2: there is nothing on the index to
	 * disclose — the hero, the build lists and the held banner all live on
	 * the repository page. The chevron means "open the repository page",
	 * nothing else.
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
	import Card from './Card.svelte';
	import Chip from './Chip.svelte';
	import BakeStatusIcon from './BakeStatusIcon.svelte';

	const FOLD = 6;

	let {
		repo,
		now,
		query = '',
		uncapped = false,
		repoUrl = null,
		filterable = false,
		class: className = ''
	}: {
		repo: RepoLedger;
		now: Date;
		/** Trimmed search text; `''` means no filter active. */
		query?: string;
		/** B.7 — the fleet's only repository draws every ledger row. */
		uncapped?: boolean;
		repoUrl?: string | null;
		/**
		 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — THE ONE AXIS THE TWO
		 * PAGES DIFFER ON. `false` (default) is the index (B.2): the header
		 * links out, row names are `/apps/<name>` links, nothing here filters
		 * anything. `true` is the repository page (B.4 item 4): the header
		 * is plain (this page already names the repository), row names
		 * become a multi-select toggle, and the header rollup recounts under
		 * it — the SAME `?q=` + selection recount the repository page's own
		 * `repoLedgerServiceCount` used to compute by hand.
		 */
		filterable?: boolean;
		/** LAYOUT ONLY — margin. Passed straight to `Card`. */
		class?: string;
	} = $props();

	const active = $derived(query.trim().length > 0);
	const needle = $derived(query.trim().toLowerCase());

	const href = $derived(`/revisions/${repoSlug(repo.repoKey)}${active ? `?q=${encodeURIComponent(query.trim())}` : ''}`);

	let expanded = $state(false);

	/**
	 * ⭐ THE MULTI-SELECT FILTER — `filterable` mode only. Self-contained:
	 * nothing else on the repository page reads which services are selected
	 * (the hero cards, the held banner and the build lists all filter on
	 * `?q=` alone), so this needs no prop to lift it to the route — the same
	 * shape the route's own `selectedApps` state had before this component
	 * absorbed it.
	 */
	let selectedApps = $state<string[]>([]);
	function isAppSelected(appName: string): boolean {
		return selectedApps.includes(appName);
	}
	function toggleAppSelected(appName: string) {
		selectedApps = selectedApps.includes(appName)
			? selectedApps.filter((a) => a !== appName)
			: [...selectedApps, appName];
	}

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
		let out = groups;
		if (filterable && selectedApps.length > 0) {
			out = out.filter((g) => selectedApps.includes(g.appName));
		}
		if (!active) return out;
		const filtered: ServiceLedgerGroup[] = [];
		for (const g of out) {
			if (g.appName.toLowerCase().includes(needle)) {
				filtered.push(g);
				continue;
			}
			const matchedLines = g.lines.filter(lineMatches);
			if (matchedLines.length > 0) filtered.push({ appName: g.appName, lines: matchedLines });
		}
		return filtered;
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
	 * under an active search; B.5's `{n} of {m} builds` rollup — the INDEX's
	 * own header rollup shape.
	 */
	const matchCount = $derived.by(() => {
		if (!active) return 0;
		const matched = new Set<string>();
		for (const row of [...repo.rows, ...repo.pending]) {
			if (matchesRevisionText(row, needle)) matched.add(row.revision);
		}
		return matched.size;
	});

	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — ONE "IS THIS VIEW
	 * FILTERED" PREDICATE, BOTH MODES. On the index `filterable` is false
	 * and `selectedApps` never grows past `[]` (nothing renders a toggle to
	 * populate it), so this reduces to the old `active`-only rule byte for
	 * byte. On the repository page a selection alone (no search text) also
	 * counts — the same condition the route's own `repoLedgerFilterActive`
	 * used, ported here so the footer/rollup recount rules stay one
	 * function instead of two copies that could disagree.
	 */
	const filterActive = $derived(active || (filterable && selectedApps.length > 0));
	const noMatch = $derived(filterActive && ordered.length === 0);

	/**
	 * ⭐ B.2's VERDICT ROLLUP — "held" and "behind" here are PLACE counts (one
	 * service in one environment), across every release line's own lead
	 * (deployed) row — the same shape the old fleet-wide head band summed
	 * per repo, scoped to just this one now that the head band no longer
	 * carries it. INDEX mode only.
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

	/**
	 * ⭐ THE REPOSITORY PAGE'S OWN ROLLUP — a bare service count that
	 * recounts under `filterActive`, ported from the route's
	 * `repoLedgerServiceCount`.
	 */
	const serviceCount = $derived(filterActive ? ordered.length : groups.length);

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
	 * what keeps the ledger grid's last cell occupied on every deployed line
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
<!--
	⭐ SECOND OPERATOR WALK, ITEM 9 — SAY THE SHA RELATIONSHIP ONCE, ON THE
	ROW. Adjacent rows read `1 BEHIND 9f10e49` and `NEWEST 9f10e49` — the
	SAME sha, twice, with nothing on either row explaining why one is
	"behind" a build it shares a commit with — and the `HELD` chip's own
	value (`2.67.0-67`) is that identical commit under a newer release
	label, which is not obvious from a bare version string either. When the
	held candidate's sha (`state.holdOf.short`) equals THIS row's own
	(`lineShort`), the chip's title states the relation directly instead of
	the generic "a newer build exists" sentence.
-->
{#snippet secondaryChip(state: LineStateChip | null, lineShort?: string)}
	{#if state?.role === 'held'}
		{@const sameCommit = !!lineShort && state.holdOf?.short === lineShort}
		<Chip
			role="alarm"
			label="HELD"
			value={state.holdOf?.label ?? state.holdOf?.short}
			valueTitle={state.holdOf?.label ? state.holdOf.short : undefined}
			title={sameCommit
				? `${state.holdOf?.label} is this same build (${lineShort}) under a newer label.`
				: state.title}
			wide
		/>
	{:else if state && state.role !== 'deploying' && state.role !== 'checking'}
		<Chip role={state.role} label={state.label} title={state.title} wide />
	{/if}
{/snippet}

{#snippet indexRollup()}
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
		<span class="t-card-rollup whitespace-nowrap text-gray-500 dark:text-gray-400">{verdict.text}</span>
	{/if}
	<ChevronRightOutline class="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
{/snippet}

<Card
	icon={CodeBranchOutline}
	title={filterable ? 'What each service runs' : repoTitle(repo.repoLabel)}
	titleHref={filterable ? undefined : href}
	verdict={filterable ? `${serviceCount} service${serviceCount === 1 ? '' : 's'}` : undefined}
	rollup={filterable ? undefined : indexRollup}
	padded={false}
	class={className}
>
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
					{@const selected = filterable && isAppSelected(group.appName)}
					<div class="svc-line">
						<span class="svc-header">
							{#if idx === 0}
								{#if filterable}
									<!--
										⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — A VISIBLE
										CONTROL, NOT AN INVISIBLE ONE. The route's own
										`.svc-name-btn` had no border and no fill at rest —
										indistinguishable from the plain, non-interactive
										label beside it, which is exactly why it read as
										invisible. `.svc-name-toggle` adds a 1px border and a
										chip-like inline shape at rest in BOTH themes; the
										pressed fill (`gray-900`/`gray-100`) is the product's
										one standing toggle rule, unchanged.
									-->
									<button
										type="button"
										onclick={() => toggleAppSelected(group.appName)}
										aria-pressed={selected}
										aria-label={`Show only ${group.appName}`}
										class="svc-name svc-name-toggle hit-32 t-body min-w-0 text-left transition-colors {selected
											? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
											: 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700/60'}"
									>
										{#each identParts(group.appName) as part, pi (pi)}{part}{#if pi < identParts(group.appName).length - 1}<wbr
												/>{/if}{/each}
									</button>
								{:else}
									<a
										href={`/apps/${encodeURIComponent(group.appName)}`}
										aria-label={group.appName}
										class="svc-name tap-link t-body text-gray-700 hover:underline dark:text-gray-200"
									>
										{#each identParts(group.appName) as part, pi (pi)}{part}{#if pi < identParts(group.appName).length - 1}<wbr
												/>{/if}{/each}
									</a>
								{/if}
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
									{@render secondaryChip(state, line.short)}
								</span>
							{:else}
								<span class="svc-build">
									<a
										class="svc-sha rev-sha ident tap-link t-code text-gray-900 hover:underline dark:text-white"
										href={revisionPath(repo.repoKey, line.revision)}
										title={line.revision}>{line.short}</a
									>
									{@render secondaryChip(state, line.short)}
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
								⭐ THE GRID'S LAST CELL, AND WHY IT MAY NOT BE OMITTED.
								`.svc-ledger` is ONE grid container shared by every
								`.svc-line` (`display: contents`, so each line's own
								children are auto-placed directly into it). CSS grid
								auto-flow fills a row's remaining tracks with the NEXT
								item when a row is short one, so a line emitting only 3
								cells (name/build/envs, no age) let the FOLLOWING line's
								name cell slide into THIS row's last column instead of
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

	{#if !noMatch && !filterActive}
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
					Open on GitHub
					<ArrowUpRightFromSquareOutline class="h-4 w-4" aria-hidden="true" />
				</a>
			{/if}
		</div>
	{/if}
</Card>

<style>
	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 2 (r11c) — 16px INSETS, BOTH SIDES,
	 * AT EVERY WIDTH. Measured live: the LEFT edge was already close (17px,
	 * one column's own `.svc-name` padding away from the card border) but
	 * the RIGHT edge measured 1px — `.svc-age`'s track (`minmax(0, 1fr)`)
	 * ran flush to the grid's own right edge, which WAS the card's inner
	 * edge, because nothing on this container supplied a right inset at
	 * all. `padding: 0 16px` on the grid container is the ONE inset now;
	 * `.svc-name`'s own horizontal padding (below) drops to 0 so the two
	 * mechanisms cannot double up the left side the way they used to (17px
	 * measured = 16px container + 1px rounding, alone).
	 */
	.svc-ledger {
		display: grid;
		padding: 0 16px;
		align-items: center;
		column-gap: 12px;
		row-gap: 6px;
		/*
		 * ⭐ ITEM 2 — THE NAME COLUMN TAKES THE SLACK; CHIPS ARE `max-content`;
		 * AGE IS `min-content` AND NEVER CLIPPED. Measured live at 1440:
		 * column 1 was a rigid `180px` (wrapped `hello-world-manifests`)
		 * while column 4 was `minmax(0, 1fr)` and grew to 497px around a
		 * 92px-wide age string — the FLEXIBLE track was on the wrong column.
		 * `minmax(150px, 1fr)` on the name column moves the growth there
		 * instead: with only one flexible track in the row, it absorbs
		 * exactly the space the other three tracks do not need, which is
		 * also what pins the age column flush to the row's own right inset
		 * — the same mechanism that used to belong to column 4, now serving
		 * the column the slack was supposed to help. `max-content` (chips,
		 * envs) never grows past its own content; `min-content` (age) is,
		 * with `.svc-age`'s own `white-space: nowrap`, exactly that column's
		 * full un-wrapped text width — never smaller, so never clipped.
		 * Below ~1140px this NARROWS the name column toward its 150px floor
		 * before it touches the chip column's own floor (below), which is
		 * the fix for "column 4 collapses to 57–81px and clips" — nothing
		 * downstream of the name column is flexible any more, so nothing
		 * downstream can be squeezed by a neighbour's growth.
		 */
		grid-template-columns:
			minmax(150px, 1fr)
			minmax(150px, max-content)
			max-content
			min-content;
	}

	.svc-line {
		display: contents;
	}

	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 2 (r11c) — THE GROUP BOUNDARY MUST
	 * OUTRANK THE PER-ROW HAIRLINE, AT EVERY WIDTH. Measured live: at ≥1024
	 * this drew as an 8px BLANK band (its own `::after` hairline existed but
	 * read as "an empty row", not as a boundary, next to rows that have no
	 * hairline of their own at that width); at 390 every row already carries
	 * its own 1px `border-bottom` (`.svc-line`'s mobile rule, below) at the
	 * SAME weight, so the group's own hairline was indistinguishable from an
	 * ordinary row separator. `border-top` + extra vertical padding (instead
	 * of a bare `::after` line) makes the boundary read as "a hairline PLUS
	 * space", heavier than any row separator can be by construction; the
	 * mobile `@container` block below also lightens the ORDINARY per-row
	 * hairline so the two are never the same weight in the same screenshot.
	 */
	.svc-line-gap {
		grid-column: 1 / -1;
		height: 1px;
		margin: 7px 0;
		background-color: var(--color-gray-200);
	}

	:global(.dark) .svc-line-gap {
		background-color: color-mix(in oklab, var(--color-gray-600) 70%, transparent);
	}

	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 7 — THE WRAP MUST ALIGN WITH THE
	 * FIRST LINE. `<a class="svc-name">`/`<span class="svc-name-
	 * continuation">` are inline by default, and CSS's own rule for inline
	 * padding is that LEFT padding applies only before the FIRST line box —
	 * a second, wrapped line starts at the box's outer edge with none of
	 * it, which reads as a negative indent. `display: block` makes the
	 * padding apply to the BOX, so every wrapped line starts at the same
	 * content edge as the first.
	 *
	 * ⛔ ITEM 2 (r11c) — NO HORIZONTAL PADDING HERE ANY MORE. It used to be
	 * `16px` a side, which is where the LEFT inset actually lived (the
	 * container itself had none) — doubling it once the container gained
	 * its own `padding: 0 16px` (above) would have made the left edge 32px.
	 * Vertical padding is unchanged; the inset is the container's job now,
	 * uniformly, for every column, not just this one.
	 */
	.svc-name,
	.svc-name-continuation {
		display: block;
		padding: 6px 0;
		overflow-wrap: break-word;
	}

	/*
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 (r11c) — THE TOGGLE'S OWN CHIP
	 * SHAPE. Applied AFTER `.svc-name` in this stylesheet so its padding
	 * wins the tie (same specificity, later rule) without needing `!important`
	 * — a real border needs room to sit inside the row without crowding the
	 * text, which `.svc-name`'s bare vertical padding does not give it.
	 * `border-radius` matches `Chip`'s own 4px so a toggle sitting beside a
	 * rank chip on the next column reads as the same family of control.
	 */
	.svc-name-toggle {
		padding: 4px 10px;
		border-width: 1px;
		border-style: solid;
		border-radius: 4px;
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
		padding: 6px 0;
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
			padding: 0;
		}
		/*
		 * ⭐ ITEM 2 (r11c) — THE GROUP BOUNDARY KEEPS ITS OWN 16px INSET HERE.
		 * The container's own `padding` is 0 at this width (`.svc-line`
		 * below supplies each ROW's inset instead), so the divider needs an
		 * explicit horizontal margin or it would render edge to edge —
		 * unlike every other cell here, it is not itself a grid ITEM with a
		 * per-row padding to fall back on.
		 */
		.svc-line-gap {
			margin-left: 16px;
			margin-right: 16px;
		}
		.svc-line {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			column-gap: 8px;
			row-gap: 4px;
			padding: 8px 16px;
			/*
			 * ⭐ ITEM 2 (r11c) — LIGHTER THAN THE GROUP BOUNDARY, ON PURPOSE.
			 * At 390 every row already carries this hairline, which is
			 * exactly why the group boundary above needed its OWN, heavier
			 * mark (a hairline plus 8px of clear space) rather than another
			 * line at this same weight. `gray-100`/a lower dark alpha keeps
			 * it present (rows are still separated) but visibly quieter than
			 * `.svc-line-gap`'s `gray-200`/heavier dark mix.
			 */
			border-bottom: 1px solid var(--color-gray-100);
		}
		:global(.dark) .svc-line {
			border-bottom-color: color-mix(in oklab, var(--color-gray-700) 45%, transparent);
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
		 * right at `sm`+, where the row has `Open on GitHub` to its right
		 * and not enough of the card's own width to wrap into — but below
		 * 560px the two stacked and the SAME class clipped `36 builds · 12
		 * deployed at le…`, mid-count, with `Open on GitHub` sharing the
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
