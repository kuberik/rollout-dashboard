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
	 * [glyph] #4  fix(frontend): retry on 502    [●●●]        held in dev on hello-api-app   5h
	 *   14px  mono         t-body / tap-link      meter              t-dense                t-micro
	 * ```
	 *
	 * ⛔ NO LANDING GRID HERE. §R2.1's own cut list: five services × three
	 * marks, five times over, is the norm drawn seventy-five times inside a
	 * 320px rail — the grid belongs where a reader asked a question (the
	 * change card, R2.2; the change page, R2.3), never in a summary row.
	 * ⛔ NO `by @who`, NO repo name on Home (both are the norm printed once
	 * per row — see the same section's cut list).
	 *
	 * ── HOME FEEDBACK PASS (2026-09-10, AFTER ROUND 2 SHIPPED) ────────────
	 *
	 * The human, on `YourChangesCard`: *"the PRs on homepage don't display
	 * enough information. I'd want to see at a glance whether they're
	 * progressing, how far, and whatnot. without showing every single
	 * environment."* Three changes, all gated on `row.verdictTone !== 'live'`
	 * (a live-everywhere row already answers every one of these):
	 *
	 * 1. **A compact per-family progress METER** (`familyProgress`,
	 *    `changes.ts`) — one 12px step per environment FAMILY (`DEV`/`STG`/
	 *    `PRD`), the worst mark across every service, NOT one mark per
	 *    service/env cell (that is the landing grid this row still refuses).
	 * 2. **The standing slot reads `row.verdictWord`**, the fused
	 *    subject-first sentence (`buildChangeVerdict`, RULING 3 — "the
	 *    change page, the index row and the Home card all read this"), not
	 *    the ≤4-word `standingWords` — "held in dev" named WHERE; "held in
	 *    dev on hello-api-app" names WHICH SERVICE too.
	 * 3. **The age answers "how long has it been stuck here"**
	 *    (`row.frontierSince`, `PrCell.since` for the frontier cell) instead
	 *    of "how long ago did this merge" — a fact the row's own history
	 *    already carries once there is a frontier to blame.
	 *
	 * ── THE ROW IS STILL ONE LINE AT ≥640, TWO BELOW IT ───────────────────
	 *
	 * The meter sits between the title and the standing slot in DOM/reading
	 * order — inline with everything else at ≥640 container width (`.cl-row`
	 * now `flex-wrap`s, but nothing forces a wrap above that width: the
	 * title's own `truncate` absorbs the squeeze the same way it always
	 * has). Below 640 the meter alone drops to its own second line (a
	 * container-query `order` + `flex-basis: 100%` swap, not a DOM change —
	 * see the style block) and its family WORDS hide (dots only); every
	 * other slot stays on line 1 exactly as before.
	 *
	 * ── THE STANDING WORD IS ≤4 WORDS, ONLY WHEN LIVE ─────────────────────
	 *
	 * `standingWords` (`changes.ts`) still backs the LIVE case ("live
	 * everywhere") and `ChangeCard`'s header (a separate call site, its own
	 * container-width fold) — this row's own non-live case now prefers the
	 * fuller sentence per the feedback pass above.
	 *
	 * ── THE CONTAINER QUERY IS THIS COMPONENT'S OWN ───────────────────────
	 *
	 * Home nests this inside `Card`'s own `.card-cq` (`container-type:
	 * inline-size`); `/changes`' "Live everywhere" section does not — no
	 * card there at all (§R2.2: "no box, no card"). So every width threshold
	 * here (the age drop, the meter's own line-break) cannot depend on an
	 * ancestor container existing; the `<li>` establishes its OWN
	 * containment context and every `@container` query resolves against
	 * that (the nearest container ancestor always wins, whether that is
	 * this element or a `Card` two levels up makes no difference — this one
	 * is always nearer).
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
	import { standingWords, familyProgress } from '$lib/view-models/changes';
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

	const standingShort = $derived(standingWords(row));
	const isBaking = $derived(standingShort.startsWith('baking') || standingShort.startsWith('retrying'));

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

	// ⭐ HOME FEEDBACK PASS, ITEM 2 — the fused subject-first sentence when
	// there is a frontier to name; `standingShort` only for the settled
	// live-everywhere case (unchanged from round 2).
	const standingDisplay = $derived(row.verdictTone === 'live' ? standingShort : row.verdictWord);

	// ⭐ ITEM 3 — "how long has it been stuck here", off the frontier cell's
	// own `since` where one exists; falls back to the merge age (round 2's
	// original behaviour) for the live case AND for the rare non-live row
	// with no resolvable frontier instant (nothing built anywhere yet).
	const ageInstant = $derived(row.verdictTone !== 'live' && row.frontierSince ? row.frontierSince : row.mergedAt);
	const age = $derived(formatTimeAgoCompact(ageInstant, now));
	const ageLabel = $derived(
		row.verdictTone !== 'live' && row.frontierSince ? `in this state for ${age}` : age
	);

	// ⭐ ITEM 1 — the per-family meter. `familyProgress` reads
	// `row.grid.services` (already computed once at `buildChangeRow` time),
	// so this can never disagree with the same row's own `ChangeCard`
	// landing grid two sections down.
	const steps = $derived(familyProgress(row));
	const stagesLive = $derived(steps.filter((s) => s.tone === 'live').length);
	const meterLabel = $derived(`${stagesLive} of ${steps.length} stages`);
</script>

<li class="cl-item">
	<div
		class="tap-zone cl-row flex flex-wrap items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
	>
		<!-- ⭐ HOME FEEDBACK PASS — `.cl-line1` IS ITS OWN `flex: 1 1 0%` ITEM,
		     NOT LOOSE CHILDREN OF THE WRAPPING ROW. A flex item with an
		     `auto` flex-basis (every child below WOULD be one, individually,
		     if left direct children of `.cl-row`) reports its CONTENT size —
		     for `.cl-standing`/`.tap-link`, that is the full UN-truncated
		     text width, hundreds of px — to the outer row's line-breaking
		     decision, which uses that HYPOTHETICAL size regardless of how
		     much the item can later shrink. Measured live: with those spans
		     as direct children of a `flex-wrap` row, `.cl-standing` wrapped
		     to its OWN line even though it visually had room once shrunk,
		     because the un-shrunk sentence didn't "fit" for the wrap
		     algorithm's own purposes. Grouping them into one `flex-1`
		     (flex-basis `0%`) item makes THIS item's hypothetical size 0 —
		     the wrap decision no longer sees the long sentence at all — and
		     `min-w-0` lets it actually shrink to whatever the meter (the
		     only item that may force a line break, via its own
		     `flex-basis: 100%` below 640px) leaves it. -->
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
			<span class="t-dense cl-standing min-w-0 truncate {toneClass}">{standingDisplay}</span>
			<span class="t-micro cl-age shrink-0 text-gray-500 dark:text-gray-400" title={ageLabel}
				>{ageLabel}</span
			>
		</div>
		{#if steps.length > 0}
			<div class="cl-meter" role="img" aria-label={meterLabel}>
				{#each steps as step (step.family)}
					<span class="cl-step" title="{step.family}: {step.sentence}">
						{#if step.tone === 'live'}
							<CheckCircleSolid class="cl-step-icon tone-live" aria-hidden="true" />
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
	   ⚠️ SUPERSEDED IN PART, HOME FEEDBACK PASS (2026-09-10): "no second
	   line ever appears" is no longer true below 640px of container width —
	   the meter now drops to its own line there, by explicit request (see
	   the module doc). The 30px ceiling above was always about ONE
	   width-independent line count; it now holds only at ≥640. */

	/* R2.1: "Below 420px of card width the age drops (kept in `title`);
	   nothing else moves, nothing reorders." Still true independent of the
	   meter's own breakpoint below. */
	@container (max-width: 419.98px) {
		.cl-age {
			display: none;
		}
	}

	/* `flex: 1 1 0%` — see the template's own comment on `.cl-line1`: a
	   DEFINITE flex-basis (`0%`, not `auto`) is what keeps this item's
	   hypothetical size out of `.cl-row`'s line-wrap decision, so a long
	   `.cl-standing` sentence inside it can shrink/truncate in place
	   instead of forcing the whole group onto its own line. */
	.cl-line1 {
		flex: 1 1 0%;
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

	/* `not-built` — no field, no ring colour (state-only, never identity —
	   the same rule `LandingMark`'s own `.lm--dashed` states). */
	.cl-dot--dashed {
		border: 1.5px dashed var(--color-gray-400);
		background: transparent;
	}

	:global(.dark) .cl-dot--dashed {
		border-color: var(--color-gray-500);
	}

	/* Family words show only once there is room to read them AND the row
	   is not fighting them for the same line — ≥640px of THIS component's
	   own container width. */
	@container (max-width: 639.98px) {
		.cl-meter-label {
			display: none;
		}

		/* The meter drops to its own second line: `flex-basis: 100%` alone
		   forces it to be wider than any remaining space on `.cl-line1`'s
		   line, so it starts a fresh one — no `order` needed, `.cl-meter` is
		   already the LAST child of `.cl-row` in DOM order. `padding-left`
		   aligns the dots under the title, past the leading glyph +
		   number's own width. */
		.cl-meter {
			flex-basis: 100%;
			padding-left: 22px;
			margin-top: 2px;
		}
	}
</style>
