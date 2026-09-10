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
	import { repoTitle } from '$lib/repo-title';
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
		//
		// ⛔ ⭐ LANE 9, ROUND 11 QA, ITEM 9 — `matchServiceNames: false` ON
		// BOTH CALLS. This runs from INSIDE `visibleGroupsOf`'s per-service
		// loop, once the group's own `appName` has already failed to match
		// — so a `true` result here has to come from THIS row's own sha or
		// label, never from a SIBLING service sharing the row (the shape
		// `matchesRevisionText`'s default services-clause exists for at the
		// ROW level, and exactly what leaked `hello-frontend-app`'s own line
		// into a `?q=hello-api` filtered ledger before this fix — the two
		// services share one revision, and the row-level predicate does not
		// know which service's LINE is asking).
		const rows = lookup.get(line.revision);
		if (rows && rows.length > 0) {
			return rows.some((row) => matchesRevisionText(row, needle, false));
		}
		return matchesRevisionText(line as never, needle, false);
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
	<!--
		⭐ LANE 9, ROUND 11 QA, ITEM 7 — THE CHEVRON IS A FIXED TRAILING
		COLUMN NOW, NOT PART OF THE WRAPPING ROLLUP. Measured live at 390:
		repo A (title + rollup sharing one line) put the chevron at x=326;
		repo B (a longer title forced the rollup — chip AND chevron — onto
		its OWN line, flush left per `Card`'s own documented single-item
		rule) put it at x=223, immediately after the words. Same control,
		two different positions, because it travelled inside whatever box
		`Card`'s `rollup` snippet became.

		`Card`'s header already carries `position: relative` whenever
		`titleHref` is set (`.tap-zone`, `app.css`) — true on every index
		card, since `titleHref` is always set here — so an absolutely
		positioned child of THIS snippet resolves against the HEADER
		itself, not against whatever box the rollup words end up in. Pinned
		`top`/`right`, it sits in the same physical spot at every width,
		independent of whether the words share the title's line or wrap
		alone beneath it — a real fixed column, not a flex item that only
		looks like one when nothing wraps. `pointer-events: none` because
		it is decorative (`aria-hidden`): the `.tap-zone` overlay under it
		still gets the click. The `pr-6` on the text/chip wrapper reserves
		the room so the shared-line case never lets the chevron overlap the
		last few pixels of the words.
	-->
	<span class="ledger-index-rollup-text flex min-w-0 items-center gap-2 pr-6">
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
	</span>
	<!--
		A plain wrapping `<span>`, not the class on `ChevronRightOutline`
		directly — Svelte's scoped-CSS analysis cannot see through a child
		COMPONENT's own template to confirm `.ledger-index-chevron` lands on
		a real element, so it flags the selector unused even though the
		prop does forward correctly. A literal element here is unambiguous.
	-->
	<span class="ledger-index-chevron">
		<ChevronRightOutline class="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
	</span>
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
				<!--
					⭐ LANE 9, ROUND 11 QA, ITEM 6 — `gi > 0` GUARDS THE FIRST ROW.
					`prevLi` was `null` on the very first group, and `li !== null`
					is `true` for any real line index (`0 !== null`) — so this drew
					a stray divider under the card header, 7px below it, on EVERY
					multi-line repository, before the first group's own boundary
					could ever legitimately fire. A card with `n` release lines
					needs `n − 1` dividers, between groups, never leading one.
				-->
				{#if gi > 0 && multiLine && li !== prevLi}
					<div class="svc-line-gap" aria-hidden="true"></div>
				{/if}
				{#each group.lines.length ? group.lines : [null] as line, idx (line ? `${group.appName}/${line.rowKey}` : `${group.appName}/none`)}
					{@const state = line ? lineState(line, now) : null}
					{@const selected = filterable && isAppSelected(group.appName)}
					<div class="svc-line">
						<span class="svc-header">
							{#if idx === 0}
								{#if filterable}
									<!--
										⛔ SUPERSEDED (r11d) — round 11c's `.svc-name-toggle` drew
										a 1px border AND a fill at rest on every row, so the
										repository page's whole ledger read as a form (a bordered
										button beside every plain name). Rest is plain text now —
										byte-identical to the index's own non-filterable name —
										and the button only picks up a border on hover/focus-visible;
										the pressed gray-900/white fill (Lane 7's standing toggle
										rule) is unchanged. `border-transparent` at rest (not "no
										border utility at all") matters: `.svc-name-toggle`'s own
										`border-width: 1px` never changes, so gaining a colour on
										hover never shifts layout.
									-->
									<button
										type="button"
										onclick={() => toggleAppSelected(group.appName)}
										aria-pressed={selected}
										title={`Show only ${group.appName}`}
										class="svc-name svc-name-toggle hit-32 t-body min-w-0 text-left transition-colors {selected
											? 'border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900'
											: 'border-transparent text-gray-700 hover:border-gray-300 focus-visible:border-gray-300 dark:text-gray-200 dark:hover:border-gray-600 dark:focus-visible:border-gray-600'}"
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
								⭐ THE GRID'S LAST TWO CELLS, AND WHY NEITHER MAY BE
								OMITTED. `.svc-ledger` is ONE grid container shared by
								every `.svc-line` (`display: contents`, so each line's
								own children are auto-placed directly into it). CSS
								grid auto-flow fills a row's remaining tracks with the
								NEXT item when a row is short one, so a line emitting
								too few cells lets the FOLLOWING line's own cells slide
								into THIS row's remaining columns instead of starting
								their own row — exactly what a live screenshot at 1440
								once showed: two services sharing one visual row. Every
								deployed line emits exactly 5 cells now, always:
								name / build / envs / this bare spacer / age.
								⛔ THE SPACER IS A REAL ELEMENT, NOT `.svc-age` GIVEN
								`grid-column: -1`. That was tried (r11d, first cut) and
								measured broken: with `display: contents` flattening
								every line into ONE flat item list, CSS Grid places
								EVERY explicitly-positioned item first, in document
								order, before any auto-placed item is placed at all —
								so every row's `.svc-age` (present on nearly every
								row) claimed the grid's last column, row after row,
								BEFORE any row's own name/build/envs got a chance to
								auto-place, scrambling which row's chips sat beside
								which row's name. An explicit position is only safe
								here on an element that appears RARELY (`.svc-empty`,
								below, already relies on this and is unaffected — it
								renders for at most a few "not deployed" lines per
								repo). A bare spacer with no explicit placement lets
								ordinary DOM-order auto-flow put it in column 4 and
								age in column 5, on every row, with no scrambling.
							-->
							<span class="svc-fill" aria-hidden="true"></span>
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
	 * ⭐ LANE 9, ROUND 11 QA, ITEM 7 — THE CHEVRON'S FIXED COLUMN. See
	 * `indexRollup`'s own comment for why this positions against the
	 * HEADER (via `Card`'s `.tap-zone`, `position: relative` whenever
	 * `titleHref` is set — always true here) rather than against whatever
	 * box the wrapping rollup words become. `top`/`right` match the
	 * header's own `px-4 py-3` inset and a 16px icon vertically centred in
	 * a 47px single-line header ((47 − 16) / 2 = 15.5); pinning to a fixed
	 * offset from the TOP (not `top: 50%` of the header's own, possibly
	 * taller, box) keeps it aligned with the title's row even when the
	 * rollup wraps to a second line beneath it, rather than drifting to
	 * the vertical centre of both lines combined.
	 */
	.ledger-index-chevron {
		position: absolute;
		top: 15.5px;
		right: 16px;
		pointer-events: none;
	}

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
		 * ⭐ REVISIONS-PASS-6, ITEM 1 (r11d) — THE CHIPS SIT RIGHT AFTER THE
		 * NAME, LIKE A TABLE. The previous spelling (`minmax(150px, 1fr)` on
		 * the name column) put the ONLY flexible track on column 1, so the
		 * name swallowed every pixel of slack the other three tracks did not
		 * need — measured live at 1440, column 2 (the build+held chip pair)
		 * landed at x≈845 on one card and x≈968 on its sibling, because each
		 * card's own grid sizes its own `max-content` name column from its
		 * own longest name and nothing forces the two to agree.
		 *
		 * FIVE TRACKS NOW: name / chips / envs / a spacer / age.
		 *   1. `minmax(170px, max-content)` (170: above this fleet's longest name column, 163px, so sibling cards on the index share one chip x) — the name. No longer flexible;
		 *      it grows only as far as its own longest visible name needs,
		 *      and never past that to soak up leftover row width.
		 *      ⚠️ COORDINATOR CORRECTION (r11d, second pass) — an EARLIER cut
		 *      of this rule raised this floor to 220px so a 22–23 char name
		 *      never wraps (Chromium's own quirk: `<wbr/>`, the identifier's
		 *      hyphen-boundary break points from `identParts`, makes its
		 *      `max-content` GROWTH LIMIT resolve to the width of the
		 *      longest un-wrapped SEGMENT, not the full single-line width —
		 *      `hello-world-manifests` measured its column at 163px and
		 *      STILL wrapped there). That 220px floor, combined with the
		 *      chip column's own 270px floor, pushed this grid's true
		 *      minimum width to ~840px — WIDER than a 1024px-viewport
		 *      laptop's own card (measured 783px), so raising the
		 *      `@container` fallback to clear it made a 1024 laptop render
		 *      the PHONE-STACKED ledger, which is the wrong trade: the
		 *      single-line grid holding at 1024/1140 outranks any one name
		 *      never wrapping. 150px is back; a 24-character name MAY wrap
		 *      at 1024 now, and that is an accepted, deliberate trade —
		 *      verified live, not a regression nobody noticed.
		 *   2. `minmax(270px, max-content)` — the build chip + the optional
		 *      `HELD` chip beside it.
		 *      ⭐ LANE 9, ROUND 11 QA, ITEM 8 — 270, NOT 200. Measured live
		 *      (floor temporarily dropped to 50px to read the TRUE unclamped
		 *      width): the widest pair on the live fleet — `1 BEHIND
		 *      9f10e49` + `HELD 2.67.0-67` — renders at 266px. `max-content`
		 *      is what actually sizes THIS column for that row, but a
		 *      `minmax()` floor is a per-card minimum, not a fleet-wide one:
		 *      a SIBLING card whose own widest pair is narrower still got
		 *      its OWN, smaller `max-content` width at 200 — measured live,
		 *      the dev chip started at x 684 on one card and x 618 on its
		 *      neighbour, because each card's grid answers "how wide does
		 *      THIS card's content need" independently and 200 was below
		 *      what the widest row on the fleet needs. 270 (just past 266)
		 *      is now ABOVE every pair this fleet renders, so `max-content`
		 *      never wins the sizing argument for any card and every card's
		 *      column starts at the identical 270px — which is what makes
		 *      the environment column after it start at one x on every
		 *      card, the actual bug this row was filed against. (This is
		 *      NOT the earlier, reverted 220/270 pair above — that one also
		 *      raised the NAME floor to 220, which is what pushed the grid's
		 *      true minimum past 1024's own card width; leaving the name
		 *      floor at 170 keeps this fix inside that budget — see the
		 *      height-budget comment below for the arithmetic.)
		 *   3. `max-content` — the environment chips.
		 *   4. `minmax(0, 1fr)` — the ONE flexible track, a bare spacer. It
		 *      absorbs whatever the first three columns do not need, so nothing
		 *      upstream of it can be pulled wide by leftover space.
		 *   5. `min-content` — the age column, pinned flush to the row's own
		 *      16px right inset. A bare `.svc-fill` element (template) fills
		 *      column 4 so ordinary DOM-order auto-placement lands age in
		 *      column 5 on every row — see that element's own comment for why
		 *      this is a real element and not `.svc-age` given an explicit
		 *      `grid-column`. `min-content` with `.svc-age`'s own
		 *      `white-space: nowrap` is exactly that column's full
		 *      un-wrapped text width — never smaller, so never clipped.
		 * Below ~1140px the name and chip columns narrow toward their own
		 * floors before anything clips — nothing downstream of column 1 is
		 * flexible, so nothing downstream can be squeezed by a neighbour's
		 * growth.
		 */
		grid-template-columns:
			minmax(170px, max-content)
			minmax(270px, max-content)
			max-content
			minmax(0, 1fr)
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
	/* ⛔ ROUND 6, LANE 10 — EXACTLY THE CARD-BORDER TOKEN, NO ALPHA, BOTH
	   THEMES. Light already matched (`gray-200`, the same token `Card`'s own
	   `border-gray-200` uses); dark did not — `color-mix(in oklab,
	   var(--color-gray-600) 70%, transparent)` resolves to `oklab(0.446 …
	   / 0.7)`, LIGHTER than `Card`'s actual dark border (`gray-700`, `oklch
	   (0.373 …)`) even before the 70% alpha is considered, so the boundary
	   this divider draws was louder than the card outline it sits inside.
	   `var(--color-gray-700)` at full alpha is the same value `Card`'s
	   `dark:border-gray-700` already resolves to — one token, no mix, no
	   transparency, in both themes. */
	.svc-line-gap {
		grid-column: 1 / -1;
		height: 1px;
		margin: 7px 0;
		background-color: var(--color-gray-200);
	}

	:global(.dark) .svc-line-gap {
		background-color: var(--color-gray-700);
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

	/*
	 * ⭐ ITEM 1 (r11d) — A REAL, EMPTY GRID ITEM, NOT AN EXPLICIT PLACEMENT.
	 * The desktop grid is 5 columns now (name / chips / envs / spacer /
	 * age). The first cut gave `.svc-age` an explicit `grid-column: -1`
	 * instead of rendering this element, reasoning that a 4-cell row would
	 * auto-place into columns 1–4 and the explicit rule would relocate age
	 * to 5. Measured broken: `.svc-line` is `display: contents`, so every
	 * line's children are ONE flat item list for CSS Grid's own placement
	 * algorithm, and the spec places EVERY explicitly-positioned item
	 * first, in document order, before ANY auto-placed item — so every
	 * row's `.svc-age` (nearly every row has one) claimed column 5 in turn
	 * BEFORE any row's own name/build/envs got a chance to auto-place,
	 * scrambling which row's chips sat beside which row's name. Rendering
	 * an actual (empty, `aria-hidden`) element in column 4 needs no
	 * explicit placement at all — ordinary DOM-order auto-flow puts it
	 * there and age after it, on every row, with no scrambling. Hidden on
	 * the mobile flex layout below, where it has no job.
	 */
	.svc-fill {
		display: block;
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
	 *
	 * ⭐ ITEM 1 (r11d, SECOND PASS) — 720px, NOT 840, NOT 560. A first cut of
	 * this fix raised the floor to 220px (name) / 270px (chips) so a 22–23
	 * char name never wrapped, then had to raise THIS threshold to 840px to
	 * stop that wider grid from clipping its own age column. Coordinator
	 * correction: an 840px threshold means a 1024px-viewport laptop (card
	 * measured 783px) got the PHONE-STACKED ledger, not the table — the
	 * single-line grid holding at 1024 and 1140 outranks any one name never
	 * wrapping. The name floor is 170px, not 220 — see the earlier
	 * correction above for why that number stays put.
	 *
	 * ⭐ LANE 9, ROUND 11 QA, ITEM 8 — THE CHIP FLOOR IS 270px NOW (item 8's
	 * OWN fix, above), and this is the re-check that it still fits the same
	 * budget the reverted 220/270 pair could not: 16px padding + 170 name +
	 * 270 chips + 149 envs (this fleet's real 3-chip width) + a 0px spacer +
	 * ~95px age + 4×12px gaps + 16px padding ≈ 764px. That is the TRUE
	 * minimum now — narrower than the earlier rejected attempt's ~840
	 * because only the CHIP floor moved, not the name floor too — and it
	 * still clears 768: a 1024-viewport laptop's 783px card (783 > 764) and
	 * 1140's 899px card both render the grid, verified live.
	 * ⚠️ Still a COMMON-CASE number: a repository with more than 3
	 * environments per service needs a wider `envs` column than this
	 * fleet's 149px and could push the true minimum back past 764px,
	 * reopening a clip right at the boundary. Re-measure before trusting it
	 * for a much wider fleet.
	 */
	@container (max-width: 768px) {
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
			 * `.svc-line-gap`'s `gray-200`/solid `gray-700` (round 6 lane 10
			 * — the card-border token, no alpha; see that rule's own note).
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
		/* ⭐ ITEM 1 (r11d) — the desktop grid's bare spacer has no job in the
		   mobile flex layout (`.svc-age`'s own `margin-left: auto` does that
		   layout's version of "push right" instead). */
		.svc-fill {
			display: none;
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
