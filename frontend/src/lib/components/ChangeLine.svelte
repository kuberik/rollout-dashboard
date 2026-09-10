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
	 * [glyph] #4  fix(frontend): retry on 502            held in prod   5h
	 *   14px  mono         t-body / tap-link              t-dense       t-micro
	 * ```
	 *
	 * ⛔ NO LANDING GRID HERE. §R2.1's own cut list: five services × three
	 * marks, five times over, is the norm drawn seventy-five times inside a
	 * 320px rail — the grid belongs where a reader asked a question (the
	 * change card, R2.2; the change page, R2.3), never in a summary row.
	 * ⛔ NO `by @who`, NO repo name on Home (both are the norm printed once
	 * per row — see the same section's cut list), NO "ago" on the age.
	 *
	 * ── THE STANDING WORD IS ≤4 WORDS, ALWAYS ─────────────────────────────
	 *
	 * `standingWords` (`changes.ts`) is the one function this slot and
	 * `ChangeCard`'s header both read — never `changeVerdict`'s own longer,
	 * subject-first sentence (which can run to a dozen words with its
	 * "will not move on its own" tail). Two different questions: the full
	 * sentence answers "which service, why, since when"; this slot answers
	 * only "where does it stand" — the reader is here for the verdict, not
	 * the story.
	 *
	 * ── THE CONTAINER QUERY IS THIS COMPONENT'S OWN ───────────────────────
	 *
	 * Home nests this inside `Card`'s own `.card-cq` (`container-type:
	 * inline-size`); `/changes`' "Live everywhere" section does not — no
	 * card there at all (§R2.2: "no box, no card"). So the age-drop
	 * threshold cannot depend on an ancestor container existing; the `<li>`
	 * establishes its OWN containment context and its `@container` query
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
	import { CheckCircleSolid, PauseSolid, ExclamationCircleSolid, RefreshOutline, ClockSolid, MinusOutline } from 'flowbite-svelte-icons';
	import type { ChangeRowVM } from '$lib/view-models/changes';
	import { standingWords } from '$lib/view-models/changes';
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

	const standing = $derived(standingWords(row));
	const isBaking = $derived(standing.startsWith('baking') || standing.startsWith('retrying'));

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
	const age = $derived(formatTimeAgoCompact(row.mergedAt, now));
</script>

<li class="cl-item">
	<div
		class="tap-zone cl-row flex items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40"
	>
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
		<span class="t-dense cl-standing shrink-0 {toneClass}">{standing}</span>
		<span class="t-micro cl-age shrink-0 text-gray-500 dark:text-gray-400" title={age}>{age}</span>
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
	   accept criterion is actually protecting — no second line, no
	   reordering, no wrap — holds at every width; only the numeric ceiling
	   does not, and only on the one axis (mobile touch target) that has a
	   standing, written reason to be taller. */

	/* R2.1: "Below 420px of card width the age drops (kept in `title`);
	   nothing else moves, nothing reorders, no second line ever appears." */
	@container (max-width: 419.98px) {
		.cl-age {
			display: none;
		}
	}
</style>
