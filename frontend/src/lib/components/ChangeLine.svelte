<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ONE-LINE CHANGE ROW. CHANGES-2026-09-10.md ROUND 2, §R2.1
	 * ("the row is ONE LINE"). Replaces `ChangeRow.svelte`'s two-line,
	 * grid-bearing row — not a wrapper around it. Shared by Home's
	 * `YourChangesCard` and `/changes`' own "Live everywhere" section (the
	 * repo name slot is the one difference between the two call sites, see
	 * `showRepo` below).
	 *
	 * ```
	 * [glyph] #4  fix(frontend): retry on 502    [●●●]   held in dev   5h
	 *   14px  mono         t-body / tap-link      meter    t-dense    t-micro
	 * ```
	 *
	 * ⛔ NO LANDING GRID HERE. §R2.1's own cut list: five services × three
	 * marks, five times over, is the norm drawn seventy-five times inside a
	 * 320px rail — the grid belongs where a reader asked a question (the
	 * change card, R2.2; the change page, R2.3), never in a summary row.
	 * ⛔ NO `by @who`, NO repo name on Home (both are the norm printed once
	 * per row — see the same section's cut list).
	 *
	 * ── ROUND 2 FIX PASS (2026-09-10, TWO DEFECTS FOUND ON HOME) ──────────
	 *
	 * The "Home feedback pass" (round 2's immediate follow-up, see the git
	 * history on this file) swapped the standing slot to print
	 * `row.verdictWord` — the FULL fused sentence ("hello-frontend-app held
	 * in dev on hello-api-app") — for every non-live row. That sentence has
	 * no upper bound on length, and `.cl-standing` had no `flex-shrink`/
	 * `max-width` of its own: in a flex row where `.cl-line1`'s title has
	 * `flex: 1 1 0%` (a DEFINITE zero basis) and `.cl-standing` has the
	 * browser's default `flex: 0 1 auto` (a CONTENT basis), the shrink
	 * algorithm assigns a flex-basis-0 item ZERO weight in the negative-space
	 * distribution — so when the row overflows, 100% of the deficit lands on
	 * the sibling with a real basis (`.cl-standing`) and the title is
	 * resolved to a literal 0px. The result, live: every row's TITLE slot
	 * showed the verdict sentence instead, and a developer could not tell
	 * PR #1 from PR #4. Two fixes, together:
	 *
	 * 1. **The standing slot is ≤4 words again, always** (`standingWords`,
	 *    not `row.verdictWord`) — "held in dev", "live everywhere", "2 of 5
	 *    live", never a service name or a gate clause (those stay on the
	 *    change card/page, which have the room).
	 * 2. **`.cl-standing` (and the meter) are `shrink-0`**, moved into their
	 *    own group AFTER `.cl-line1` (which now holds only the glyph/number/
	 *    title) so the title is the row's ONLY flexible/growing slot — every
	 *    other slot has a small, bounded footprint that never competes with
	 *    it for space. `familyProgress` is ALSO now frontier-aware (see that
	 *    function's own doc in `changes.ts`) — a change held in `dev` no
	 *    longer paints `STG`/`PRD` amber too just because a DIFFERENT service
	 *    happens to be independently held there; only the frontier family
	 *    gets the loud colour, everything after it goes quiet/dashed.
	 *
	 * ── READING ORDER: TITLE · METER · STANDING · TIME ────────────────────
	 *
	 * `.cl-line1` (glyph, `#n`, title) is the row's one FLEXIBLE item —
	 * `flex: 1 1 0%`, so it grows to fill whatever the fixed-width siblings
	 * leave and truncates in place when there isn't enough. `.cl-status`
	 * (meter, then the standing word, then the age) is a SECOND, fixed-width
	 * item — always inline with the title at ≥640px of this row's own
	 * container width. Below 640, `.cl-status` gets `flex-basis: 100%` and
	 * drops to its own second line — "the standing line may drop under the
	 * title with the meter". ⭐ ROUND 3, ITEM 3 (2026-09-10): the AGE always
	 * renders now, at every width — it is the one fact a reader cannot get
	 * anywhere else, and the previous 640px breakpoint hid it on every rail
	 * card and every phone. The meter's per-family WORD LABELS
	 * (`.cl-meter-label`) give way instead, below the same breakpoint —
	 * the coloured dot still carries the family's state without the text.
	 *
	 * ── THE CONTAINER QUERY IS THIS COMPONENT'S OWN ───────────────────────
	 *
	 * Home nests this inside `Card`'s own `.card-cq` (`container-type:
	 * inline-size`); `/changes`' "Live everywhere" section does not — no
	 * card there at all (§R2.2: "no box, no card"). So every width threshold
	 * here cannot depend on an ancestor container existing; the `<li>`
	 * establishes its OWN containment context and every `@container` query
	 * resolves against that (the nearest container ancestor always wins,
	 * whether that is this element or a `Card` two levels up makes no
	 * difference — this one is always nearer).
	 *
	 * ── CALLER CONTRACT: THE DIVIDER IS THE LIST'S, NOT THE ROW'S ─────────
	 *
	 * §R2.1: rows are "separated by `divide-y divide-gray-100
	 * dark:divide-gray-700/60`" — that class belongs on the wrapping
	 * `<ul>`/`<ol>` both call sites already render, not duplicated onto every
	 * `<li>` here.
	 */
	import {
		CheckCircleSolid,
		PauseSolid,
		ExclamationCircleSolid,
		RefreshOutline,
		ClockSolid,
		MinusOutline
	} from 'flowbite-svelte-icons';
	import type { ChangeRowVM } from '$lib/view-models/changes';
	import { standingWords, familyProgress, familyMeterAriaLabel } from '$lib/view-models/changes';
	import { formatTimeAgoCompact } from '$lib/utils';

	let {
		row,
		/** `/changes` spans repos, so its own rows print the repo after `#n`;
		 *  Home's rows are all the viewer's own commits on repos already
		 *  named by the card's filters, so it stays off by default. */
		showRepo = false,
		now = new Date()
	}: {
		row: ChangeRowVM;
		showRepo?: boolean;
		now?: Date;
	} = $props();

	// ── THE GLYPH — §2a's OWN STATE TABLE, ONE CHANNEL OF IT. Six icons,
	// not twelve: this row's job is "where does it stand", not the full
	// per-cell vocabulary the landing grid draws. `verdictTone` alone
	// separates five of the six; `active` still covers deploying, baking,
	// retrying, promoting, queued and cancelled/rolled-back alike, so the
	// leading word of `standingWords` (which always starts with the verb
	// for every one of those) is the same tie-break `ChangeRow.svelte`
	// already used to pick yellow over blue for a baking/retrying cell.
	const STATE_ICON = {
		live: CheckCircleSolid,
		held: PauseSolid,
		failed: ExclamationCircleSolid,
		'not-built': MinusOutline,
		activeBlue: RefreshOutline,
		activeYellow: ClockSolid
	} as const;

	const STATIC_TONE_CLASS = {
		live: 'tone-live',
		failed: 'tone-bad',
		'not-built': 'text-gray-400 dark:text-gray-500',
		held: 'text-orange-950 dark:text-orange-300'
	} as const;

	// ⭐ FIX PASS — the standing slot is ALWAYS the ≤4-word phrase now (never
	// `row.verdictWord`, which has no length bound and was crushing the
	// title — see the module doc above).
	const standingDisplay = $derived(standingWords(row));
	const isBaking = $derived(standingDisplay.startsWith('baking') || standingDisplay.startsWith('retrying'));

	const Icon = $derived(
		row.verdictTone === 'active'
			? isBaking
				? STATE_ICON.activeYellow
				: STATE_ICON.activeBlue
			: STATE_ICON[row.verdictTone]
	);

	const toneClass = $derived(
		row.verdictTone === 'active'
			? isBaking
				? 'text-yellow-700 dark:text-yellow-400'
				: 'tone-active'
			: STATIC_TONE_CLASS[row.verdictTone]
	);

	const numberLabel = $derived(row.kind === 'pr' && row.number != null ? `#${row.number}` : row.shortSha);

	// "How long has it been stuck here", off the frontier FAMILY's own most
	// recent `since` (`changes.ts`'s `frontierFamilySince` — recomputed at
	// `buildChangeRow` time, so this component reads it, never re-derives
	// it); falls back to the merge age for the live case AND for the rare
	// non-live row with no resolvable frontier instant (nothing built
	// anywhere yet).
	const ageInstant = $derived(row.verdictTone !== 'live' && row.frontierSince ? row.frontierSince : row.mergedAt);
	const age = $derived(formatTimeAgoCompact(ageInstant, now));
	const ageLabel = $derived(
		row.verdictTone !== 'live' && row.frontierSince ? `in this state for ${age}` : age
	);

	// The per-family meter — frontier-aware (`familyProgress`, `changes.ts`):
	// a family reads amber ONLY when it is the frontier itself; every family
	// after it reads dashed/neutral regardless of its own cells, because the
	// change cannot have moved further than its own frontier.
	const steps = $derived(familyProgress(row));
	const meterAriaLabel = $derived(familyMeterAriaLabel(steps));
</script>

<li class="cl-item">
	<div
		class="tap-zone cl-row flex flex-wrap items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
	>
		<div class="cl-line1 flex min-w-0 flex-1 items-center gap-2">
			<Icon class="h-3.5 w-3.5 shrink-0 {toneClass}" aria-hidden="true" />
			<span class="t-code-sm shrink-0 text-gray-500 dark:text-gray-400">{numberLabel}</span>
			{#if showRepo}
				<span class="t-code-sm shrink-0 text-gray-500 dark:text-gray-400">{row.repo}</span>
			{/if}
			<a
				href={row.href}
				class="tap-link t-body min-w-0 flex-1 truncate text-gray-900 dark:text-white"
				title={row.title}>{row.title}</a
			>
		</div>
		<div class="cl-status flex shrink-0 items-center gap-2">
			{#if steps.length > 0}
				<div class="cl-meter" role="img" aria-label={meterAriaLabel}>
					{#each steps as step (step.family)}
						<span class="cl-step" title="{step.family}: {step.sentence}">
							{#if step.tone === 'live'}
								{#if step.liveCount < step.builtCount}
									<span class="cl-dot cl-dot--live-ring" aria-hidden="true"></span>
								{:else}
									<CheckCircleSolid class="cl-step-icon tone-live" aria-hidden="true" />
								{/if}
							{:else if step.tone === 'queued'}
								<ClockSolid class="cl-step-icon tone-mute" aria-hidden="true" />
							{:else if step.tone === 'none'}
								<span class="cl-dot cl-dot--dashed" aria-hidden="true"></span>
							{:else if step.tone === 'failed'}
								<span class="cl-dot bg-red-600 dark:bg-red-500" aria-hidden="true"></span>
							{:else if step.tone === 'stuck'}
								<span class="cl-dot bg-orange-500 dark:bg-orange-400" aria-hidden="true"></span>
							{:else}
								<!-- `active` — `deploying` (blue) vs `baking`/`retrying` (yellow),
								     the same two-way split this row's own leading icon makes,
								     restated here off the real state. A subtle pulse: something
								     is genuinely moving right now. -->
								<span
									class="cl-dot animate-pulse {step.state === 'deploying'
										? 'bg-blue-600 dark:bg-blue-400'
										: 'bg-yellow-500 dark:bg-yellow-400'}"
									aria-hidden="true"
								></span>
							{/if}
							<span class="cl-meter-label t-micro text-gray-500 dark:text-gray-400">{step.family}</span>
						</span>
					{/each}
				</div>
			{/if}
			{#if standingDisplay !== 'live everywhere'}
				<span class="t-dense cl-standing shrink-0 truncate {toneClass}">{standingDisplay}</span>
			{/if}
			<span class="t-micro cl-age shrink-0 text-gray-500 dark:text-gray-400" title={ageLabel}
				>{ageLabel}</span
			>
		</div>
	</div>
</li>

<style>
	/* Own containment context — see the module doc's "THE CONTAINER QUERY
	   IS THIS COMPONENT'S OWN" note. */
	.cl-item {
		container-type: inline-size;
	}

	/* Defensive: without this, the whitespace TEXT NODES the template's own
	   indentation leaves between flex children can become anonymous flex
	   items sized by the container's inherited font metrics rather than by
	   any real child. Harmless here either way (every real child sets its
	   own line-height via its `.t-*` type role class, so the inherited 0
	   only ever reaches a descendant that already overrides it) but kept
	   as a floor against future template reformatting. */
	.cl-row {
		line-height: 0;
	}

	/* ⚠️ FLAGGED, NOT SILENTLY RECONCILED — MEASURED, 2026-09-10. This
	   row's accept criterion asks for `getBoundingClientRect().height ≤ 30`
	   at every width. Verified live: **29px** at 1440/800/desktop widths
	   (no `.tap-zone` floor applies there). At a real phone width (390,
	   `.cl-item` content 341px) it measures **32px** — 2px over — because
	   `app.css`'s own `.tap-zone { min-height: 32px }` sits inside
	   `@media (pointer: coarse), (max-width: 639px)` (the 2026-09-05 "32px
	   hit-slop floor" rule) and this row IS a `.tap-zone` (it is the whole
	   row's own tap target, per this file's own module doc). That floor is
	   a deliberate, cross-product accessibility guarantee — every tappable
	   row on a real phone gets it — and is not something this component
	   should fight to hit a pixel target: shrinking the row's OWN touch
	   target back under 32px on mobile would trade an accessibility
	   guarantee for a design-doc number. The "one line" property this
	   accept criterion is actually protecting — no reordering within a
	   line, no clipped content — holds at every width; only the numeric
	   ceiling does not, and only on the one axis (mobile touch target) that
	   has a standing, written reason to be taller.
	   ⚠️ "no second line ever appears" is no longer true below 640px of
	   container width — `.cl-status` (meter + standing + age) drops to its
	   own line there, by explicit request (see the module doc). The 30px
	   ceiling above was always about ONE width-independent line count; it
	   now holds only at ≥640, and the row is a fixed TWO lines below that
	   (never three — the age hides at the same breakpoint the status group
	   wraps at, see `.cl-age` below). */

	/* `flex: 1 1 0%` — a DEFINITE flex-basis (`0%`, not `auto`) is what lets
	   this item's title shrink/truncate in place instead of reporting its
	   full un-truncated content width to `.cl-row`'s line-wrap decision.
	   Every sibling in `.cl-status` is `shrink-0` (a fixed, bounded
	   footprint) so this is the row's ONE flexible/growing slot — nothing
	   else competes with it for space, which is the fix for the "standing
	   sentence crushes the title to 0px" defect this file's module doc
	   describes. */
	.cl-line1 {
		flex: 1 1 0%;
	}

	.cl-status {
		gap: 8px;
	}

	/* Bounded — even the longest `standingWords` phrase in the closed
	   vocabulary ("rolled back in staging") is well under this, so it is a
	   defensive floor, not the primary mechanism (that is `shrink-0` on
	   `.cl-status` itself, which keeps this whole group out of the title's
	   negative-space distribution in the first place). */
	.cl-standing {
		max-width: 22ch;
	}

	/* ── THE PER-FAMILY METER ──────────────────────────────────────────── */
	.cl-meter {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}

	.cl-step {
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}

	:global(.cl-step-icon) {
		height: 12px;
		width: 12px;
		flex-shrink: 0;
	}

	.cl-dot {
		display: inline-block;
		height: 12px;
		width: 12px;
		border-radius: 9999px;
		flex-shrink: 0;
	}

	/* `not-built`, or a family the change cannot have reached yet (past the
	   frontier) — no field, no ring colour (state-only, never identity —
	   the same rule `LandingMark`'s own `.lm--dashed` states). */
	.cl-dot--dashed {
		border: 1.5px dashed var(--color-gray-400);
		background: transparent;
	}

	:global(.dark) .cl-dot--dashed {
		border-color: var(--color-gray-500);
	}

	/* Partial-live — some services in this family are live, none are stuck;
	   a green RING (not a filled disc) says "getting there", never a second
	   hue for a state that is still, honestly, green. */
	.cl-dot--live-ring {
		border: 1.5px solid var(--color-green-600);
		background: transparent;
	}

	:global(.dark) .cl-dot--live-ring {
		border-color: var(--color-green-400);
	}

	/* Family words show only once there is room to read them AND the row
	   is not fighting them for the same line — ≥640px of THIS component's
	   own container width. */
	@container (max-width: 639.98px) {
		.cl-meter-label {
			display: none;
		}

		/* The status group (meter, standing, age) drops to its own second
		   line: `flex-basis: 100%` alone forces it to be wider than any
		   remaining space on `.cl-line1`'s line, so it starts a fresh one —
		   no `order` needed, `.cl-status` is already the LAST child of
		   `.cl-row` in DOM order. `padding-left` aligns it under the title,
		   past the leading glyph + number's own width. */
		.cl-status {
			flex-basis: 100%;
			padding-left: 22px;
			margin-top: 2px;
		}

		/* ⭐ ROUND 3, ITEM 3 (2026-09-10) — THE AGE ALWAYS RENDERS NOW. It used
		   to hide at this same breakpoint — the one fact a reader cannot get
		   any other way ("how long has this been in this state"), dropped on
		   every rail card and every phone. The meter's FAMILY WORDS
		   (`.cl-meter-label`, above) are what gives way instead: the coloured
		   dot still says which family without the label, and the row stays
		   at most two lines either way. */
	}
</style>
