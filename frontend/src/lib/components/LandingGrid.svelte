<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE COMPACT FORM'S "LINE 2" — per service, its app name and its
	 * family-collapsed marks. CHANGES-2026-09-10.md §2b, redesigned in the
	 * 2026-09-10 fix pass (item 4) into a REAL GRID.
	 *
	 * ── WHY A REAL GRID, NOT A WRAPPING ROW ───────────────────────────────
	 *
	 * The shipped version was `flex-wrap` groups — each service free to lay
	 * its marks out at whatever x its own name width pushed them to, so a
	 * `DEV` mark on one service row never lined up under a `DEV` mark on the
	 * next. Measured: no shared column x across rows, so "read down a
	 * column" was not actually possible despite every mark naming its own
	 * family in words. This version is `display: grid` with ONE shared
	 * `grid-template-columns` for the whole component — the app-name column,
	 * then one column per environment FAMILY, union'd across every service
	 * and ordered DEV → STG → PRD → TEST (any unrecognised family appended
	 * in first-seen order) — plus a small header row naming each column, so
	 * the x-position of "DEV" is identical on every row.
	 *
	 * Column order reads `mark.familyOrder` — `landing-grid.ts`'s own
	 * canonical dev → test → staging → prod tier position (ruling 6),
	 * union'd across every service so a family present on only one service
	 * still gets a column. An unmatched/fallback family sorts last.
	 *
	 * ── THE FOLD IS THIS COMPONENT'S OWN JOB; ORDER IS THE CALLER'S ───────
	 *
	 * The shipped version took a pre-capped `visible` (≤3, worst-first) plus
	 * a static "+N services" `Chip` the caller rendered beside it — dead
	 * text, no way to see the rest without leaving the row, and a page vs.
	 * preview that could show a different top-3 if a caller ever capped
	 * differently. `landing-grid.ts`'s `buildLandingGrid` now returns
	 * `visible` as the FULL list, adverse-first then alphabetical
	 * (`orderByVerdict`, ruling 6) — this component trusts that order as
	 * given (no re-sorting here) and owns only the FOLD:
	 *
	 *   - the first `fold` services render; the rest are behind a real
	 *     "+N services" BUTTON that expands them in place, at every width.
	 *     Never a dead span — pressing it does something.
	 *
	 * ⛔ DELIBERATELY NOT RESPONSIVE (2026-09-10, same fix pass, re-measured).
	 * The first cut auto-revealed every service at `≥1024px` viewport width
	 * on the theory that a wide screen has room — measured live, this is a
	 * VIEWPORT check on a component that also renders inside a narrow CARD
	 * at a wide viewport (`YourChangesCard` on Home, this file's own dense
	 * caller): at 1440 the "Your changes" card's own column is nowhere near
	 * 1024px wide, so the auto-reveal fired anyway and a 5-row card with one
	 * 5-service change measured 992px tall. A flat, unconditional `fold` —
	 * the CALLER picks the number for its own context (`dense` ones pass a
	 * smaller one) — has no container-vs-viewport mismatch to have.
	 *
	 * ── GEOMETRY ───────────────────────────────────────────────────────────
	 *
	 * Every row (grid row 2+) is `min-height: 44px` (28px in `dense`, which
	 * also drops the header — a rail card's own budget, not the primary
	 * interactive surface a full-width grid is). The name column wraps full
	 * names instead of truncating them ("the one that matters" — a 30-char
	 * app name still reads, across two lines, rather than losing the tail
	 * that would have disambiguated it); narrower at ≤640px, same columns.
	 */
	import LandingMark from './LandingMark.svelte';
	import type { LandingServiceVM } from '$lib/view-models/landing-grid';

	let {
		services,
		dense = false,
		fold = 6,
		class: className = ''
	}: {
		/** Already ordered by the caller — `landing-grid.ts`'s `visible`
		 *  (adverse-first, then alphabetical). This component draws it as
		 *  given; re-sorting here would risk a second order disagreeing
		 *  with the caller's. */
		services: LandingServiceVM[];
		/** Tighter rows, no header, for embedding inside an already-dense card
		 *  (e.g. a 5-row Home card). */
		dense?: boolean;
		/** How many services render before the rest fold behind a
		 *  "+N services" button, at every width — see the module doc for why
		 *  this is not viewport-responsive. `ChangeRow` passes a smaller
		 *  number in `dense` mode. */
		fold?: number;
		class?: string;
	} = $props();

	// Union of every family present, ordered by `familyOrder` (dev → test →
	// staging → prod, unmatched last) — `landing-grid.ts`'s own canonical
	// tier position, so a column layout aligns DEV/STG/PRD across rows even
	// when one service's own family list has a gap.
	const columns = $derived.by(() => {
		const byFamily = new Map<string, number>();
		for (const s of services) {
			for (const m of s.marks) {
				if (!byFamily.has(m.family)) byFamily.set(m.family, m.familyOrder);
			}
		}
		return [...byFamily.entries()].sort((a, b) => a[1] - b[1]).map(([family]) => family);
	});

	let expanded = $state(false);
	const hiddenCount = $derived(Math.max(0, services.length - fold));

	function isFolded(i: number): boolean {
		return !expanded && i >= fold;
	}

	// ⭐ ROUND 2, R2.5(a) (2026-09-10) — CONTENT-SIZED COLUMNS, NO `auto`/`1fr`.
	// `minmax(44px, auto)`'s `auto` MAX track absorbs every pixel of free
	// space under this element's own `justify-content: normal` default — in
	// a full-width card body that pinned DEV/STG/PRD at x = 485/975/1470 on
	// a 1440 screen (measured: three 18px marks spread over 1000px). Every
	// column is `max-content` now (the mark's own natural width, nothing
	// more) and the wrapping `.lg-grid` rule below sets
	// `justify-content: start`, so the grid is exactly as wide as its
	// content and left-aligned inside whatever card body holds it, at every
	// width and every service count.
	const gridStyle = $derived(
		`grid-template-columns: minmax(56px, var(--lg-name-w)) repeat(${columns.length || 1}, max-content);`
	);
</script>

<div class="lg-wrap {className}">
	<div class="lg-grid {dense ? 'lg-grid--dense' : ''}" style={gridStyle}>
		{#if !dense}
			<span class="lg-head" aria-hidden="true"></span>
			{#each columns as col (col)}
				<span class="lg-head lg-head-fam">{col}</span>
			{/each}
		{/if}
		{#each services as service, i (service.appName)}
			<span
				class="lg-name"
				class:lg-hidden-below-lg={isFolded(i)}
				title={service.appName}>{service.appName}</span
			>
			{#each columns as col (col)}
				{@const mark = service.marks.find((m) => m.family === col)}
				<span class="lg-cell" class:lg-hidden-below-lg={isFolded(i)}>
					{#if mark}
						<LandingMark
							family={mark.family}
							count={mark.count}
							state={mark.state}
							sentence={mark.sentence}
							href={mark.href}
							theme={mark.theme}
						/>
					{:else}
						<span class="lg-empty" aria-hidden="true">–</span>
					{/if}
				</span>
			{/each}
		{/each}
	</div>
	{#if hiddenCount > 0 && !expanded}
		<button type="button" class="lg-more" onclick={() => (expanded = true)}>
			+{hiddenCount} service{hiddenCount === 1 ? '' : 's'}
		</button>
	{/if}
</div>

<style>
	.lg-wrap {
		--lg-name-w: 140px;
	}

	@media (max-width: 640px) {
		.lg-wrap {
			--lg-name-w: 90px;
		}
	}

	.lg-grid {
		display: grid;
		grid-template-rows: auto;
		grid-auto-rows: minmax(44px, auto);
		column-gap: 8px;
		row-gap: 2px;
		align-items: center;
		/* R2.5(a) — the grid is exactly as wide as its `max-content` columns;
		   `start` stops the browser stretching that width to fill the
		   parent, which is the other half of the same fix (`gridStyle`'s own
		   comment, above). */
		justify-content: start;
	}

	@media (max-width: 640px) {
		.lg-grid {
			column-gap: 6px;
		}
	}

	.lg-grid--dense {
		grid-template-rows: none;
		grid-auto-rows: minmax(28px, auto);
		row-gap: 1px;
	}

	.lg-head {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--color-gray-400);
		padding-bottom: 2px;
		border-bottom: 1px solid var(--color-gray-200);
	}

	:global(.dark) .lg-head {
		color: var(--color-gray-500);
		border-bottom-color: var(--color-gray-700);
	}

	.lg-head-fam {
		text-align: left;
	}

	.lg-name {
		font-size: 11px;
		line-height: 1.3;
		color: var(--color-gray-500);
		overflow-wrap: anywhere;
		word-break: break-word;
	}

	:global(.dark) .lg-name {
		color: var(--color-gray-400);
	}

	.lg-cell {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.lg-empty {
		font-size: 12px;
		color: var(--color-gray-300);
	}

	:global(.dark) .lg-empty {
		color: var(--color-gray-600);
	}

	/* THE FOLD — flat and unconditional, at every width. `isFolded` (script)
	   decides which rows carry this class; pressing "+N services" clears it
	   for every folded row at once by flipping `expanded`. */
	.lg-hidden-below-lg {
		display: none;
	}

	.lg-more {
		margin-top: 4px;
		font-size: 11px;
		font-weight: 500;
		color: var(--color-gray-600);
		border: 1px solid var(--color-gray-300);
		border-radius: 4px;
		padding: 2px 8px;
		background: transparent;
		cursor: pointer;
	}

	.lg-more:hover {
		border-color: var(--color-gray-400);
		background: var(--color-gray-50);
	}

	:global(.dark) .lg-more {
		color: var(--color-gray-300);
		border-color: var(--color-gray-600);
	}

	:global(.dark) .lg-more:hover {
		border-color: var(--color-gray-500);
		background: rgb(255 255 255 / 0.04);
	}
</style>
