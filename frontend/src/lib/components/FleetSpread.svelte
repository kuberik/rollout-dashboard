<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ WHERE THIS BUILD ACTUALLY IS — the coverage bar, said in words.
	 *
	 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
	 *
	 * `/versions` asked the reader to decode a two-tone proportional bar and
	 * then click through to find out WHICH environments those tones stood for.
	 * A proportional bar is the right object for comparing revisions against
	 * each other — that is criterion 2 and it is why the bar is the same object
	 * at both scales — but it cannot answer *"is it in prod?"*, which is the
	 * question anyone who has never used kuberik actually arrives with.
	 *
	 * This is that answer, and it doubles as the bar's explanation. Each group
	 * carries THE BAR'S OWN FILL as a 10px swatch beside a plain-English name
	 * and a count, so the segment above and the group below are bound by colour
	 * without a key row anywhere on the page.
	 *
	 * ⛔ IT IS NOT A LEGEND. The human has rejected a legend twice, and both
	 * times it was **a key built from a dummy graphic** — swatches next to
	 * definitions, drawn from nothing. Every swatch here sits on a group that
	 * lists REAL environments with real names; delete the data and the group
	 * disappears with it. The explanation is the object, which is the same move
	 * the detail page's bucket cards make.
	 *
	 * ── IT HOLDS AT 4 REGIONS AND AT 40 ─────────────────────────────────────
	 *
	 * Groups are LISTS and environments are CHIPS THAT WRAP, so a 13-region
	 * fan-out costs a wrapped line inside one group rather than thirteen rows.
	 * The service name leads its own run of chips, because with three services
	 * the word `dev` appears three times and a bare chip list would be
	 * ambiguous — and it is suppressed entirely when the revision has only one
	 * service, where it would be the same word on every line.
	 */
	import Chip from '$lib/components/Chip.svelte';
	import {
		coverageSwatch,
		type CoverageBucket,
		type CoverageSlotVM,
		type RevisionCoverage
	} from '$lib/view-models/revision-coverage';

	let {
		coverage,
		class: className = ''
	}: {
		coverage: RevisionCoverage;
		/** LAYOUT ONLY — margin. Never colour. */
		class?: string;
	} = $props();

	/** One line per service inside a group, its environments running off it. */
	type Run = { appName: string; slots: CoverageSlotVM[] };

	function runs(bucket: CoverageBucket): Run[] {
		const out: Run[] = [];
		for (const s of bucket.slots) {
			let r = out.find((o) => o.appName === s.appName);
			if (!r) {
				r = { appName: s.appName, slots: [] };
				out.push(r);
			}
			r.slots.push(s);
		}
		return out;
	}

	/** One service across the whole build: the name is the same word every
	    line, so it stops being information and is dropped. */
	const oneService = $derived(
		new Set(coverage.buckets.flatMap((b) => b.slots.map((s) => s.appName))).size <= 1
	);
</script>

<div class="fs {className}">
	{#each coverage.buckets as bucket (bucket.key)}
		<div class="fs-group">
			<div class="fs-head">
				<span
					class="cov-swatch {coverageSwatch(bucket.key, coverage.reachable)}"
					aria-hidden="true"
				></span>
				<!-- ⛔ THE COUNT USED TO BE HERE AND IT IS NOT COMING BACK.
				     (2026-09-02. The quantity was being stated three times in words —
				     `6 of 6` in the rollup, `6` here, `6 places` on the bucket card —
				     beside a graphic that carried none of it. The first fix moved the
				     numeral ONTO the fill; the human's next look asked *"why is this
				     number on the bar?"* and it came off again — see the tombstone in
				     `CoverageBar.svelte`.) What actually closed the defect is that
				     `CoverageBar` now draws ONE CELL PER PLACE, so the bar 30px above
				     this line carries the count structurally and this group carries
				     the NAMES: a swatch that binds it to its segment, the bucket's
				     title, and every real place as a chip. Identity, not arithmetic.
				     A numeral here would be the same fact a third time. -->
				<span class="fs-title">{bucket.title}</span>
			</div>
			<!--
				⭐ THE NAME GETS A FIXED TRACK, THE CHIPS HANG OFF IT. (2026-09-03,
				design pass 7, finding #4) `.fs-run` used to be one `flex-wrap` row
				per app, with the app name as its first, VARIABLE-WIDTH child — so
				`hello-api-app`'s env chips started at a different x than
				`hello-frontend-app`'s one row down. Measured live at 1440:
				`hello-api-app`'s first chip at x=295, `hello-frontend-app`'s at
				x=325, a ragged left edge the reader has to re-parse per row.
				`/versions`' own `.rev-name-row` (this file's sibling, in
				`versions/+page.svelte`) already solved the identical shape for the
				labels above this list — a fixed name column so the thing beside it
				starts at one x — but that fix only holds WITHIN one revision's own
				internal grid; it does not reach across ROWS. This one has to,
				because the alignment complaint is exactly "hello-api-app's row vs
				hello-frontend-app's row", i.e. across `<li>`s. A `display: grid` on
				each `<li>` would size its own name column from its OWN content and
				land right back at two different x's — CSS Grid tracks are scoped to
				one grid CONTAINER, not shared by sibling containers that merely use
				the same template. So `.fs-runs` (the `<ul>`) is the ONE grid now,
				and each `<li>` is `display: contents` — no box of its own, so its
				`.fs-svc`/`.fs-chips` children flatten straight into the list's
				shared two-column grid and every row's chips start at the SAME x.
			-->
			<ul class="fs-runs {oneService ? 'fs-runs--unnamed' : ''}">
				{#each runs(bucket) as run (run.appName)}
					<li class="fs-run">
						{#if !oneService}
							<span class="fs-svc">{run.appName}</span>
						{/if}
						<span class="fs-chips">
							{#each run.slots as s (s.envName)}
								<!-- `[ENV]` and nothing beside it unless the place is stuck, in
								     the loose `.chip-mark` group `/apps` and `/rollouts` already
								     ship. `wide` is load-bearing: `.chip`'s 12ch cap renders
								     `prod-us-east` and `prod-us-west` as the same eight
								     characters, which is the defect that killed the `/apps`
								     convergence bar. -->
								<span class="chip-mark">
									<Chip
										role="env"
										theme={s.slot.cell.theme}
										label={s.envLabel}
										wide
										title="{s.appName} in {s.envLabel.toUpperCase()} — {s.statusWord}"
									/>
									{#if s.stuck}
										<Chip
											role="alarm"
											label="stuck"
											title="{s.appName} in {s.envLabel.toUpperCase()} is stuck"
										/>
									{/if}
								</span>
							{/each}
						</span>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</div>

<style>
	/*
	 * GEOMETRY ONLY. The swatch fill comes from `coverageSwatch()` as a utility
	 * class and `.cov-swatch`'s box lives in `app.css`, shared with
	 * `ExposureBar` — a Svelte-scoped rule outranks a Tailwind utility, so
	 * nothing here may own colour.
	 *
	 * `auto-fit` and not a breakpoint: one group fills the row, four sit in a
	 * row of four at 1440 and stack at 390, and a build with two buckets does
	 * not leave two empty columns.
	 */
	.fs {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 12px 24px;
		align-items: start;
	}

	.fs-head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--color-gray-200);
	}

	:global(.dark) .fs-head {
		border-bottom-color: color-mix(in oklab, var(--color-gray-700) 100%, transparent);
	}

	/* The group's NAME is the loudest thing in it — 13px/600 against the 11px
	   service names under it. A group heading that matched its own body was
	   what made the old page read as one undifferentiated block. */
	.fs-title {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 13px;
		line-height: 18px;
		font-weight: 600;
		color: var(--color-gray-900);
	}

	:global(.dark) .fs-title {
		color: #fff;
	}

	/*
	 * THE SHARED GRID. (2026-09-03, design pass 7, finding #4) THE LIST is
	 * the grid container now, not each row — see the markup comment above
	 * for why a per-`<li>` grid cannot align across `<li>`s. `minmax(64px,
	 * max-content)`, not a hard 64px: a longer app name pushes the WHOLE
	 * list's name column wider rather than ellipsising into a neighbour's
	 * alignment (the same trade `.rev-name-row` makes one screen up, at a
	 * smaller floor — `fs-svc` is an 11px service name, not a card's own
	 * label). `column-gap`, never a flex `gap`, is what makes the chip
	 * column start at the SAME x on every row regardless of how long the
	 * name beside it is.
	 */
	.fs-runs {
		display: grid;
		grid-template-columns: minmax(64px, max-content) minmax(0, 1fr);
		column-gap: 8px;
		row-gap: 6px;
		align-items: center;
		margin-top: 8px;
		min-width: 0;
	}

	/* NO SERVICE NAME ANYWHERE IN THIS GROUP (`oneService`) — SO NO NAME
	   TRACK EITHER. Holding a 64px column open on every row of a build that
	   never prints a name in it is 64px of nothing; the chips take the whole
	   row instead of auto-placing into track 1 and starting one column left
	   of where a named build's chips would sit. */
	.fs-runs--unnamed {
		grid-template-columns: minmax(0, 1fr);
		column-gap: 0;
	}

	/* NOT A BOX. `<li>` carries no layout of its own — its children flatten
	   straight into `.fs-runs`'s grid, which is what lets the grid's own
	   auto-flow place one app's `.fs-svc` + `.fs-chips` pair as one "row" of
	   the shared template. List semantics (and `role`/keyboard behaviour, if
	   this ever grows either) are unaffected: `display: contents` removes
	   the element's OWN box, never the element. */
	.fs-run {
		display: contents;
	}

	.fs-svc {
		grid-column: 1;
		font-size: 11px;
		line-height: 16px;
		color: var(--color-gray-500);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* PINNED TO TRACK 2 (TRACK 1 ON AN UNNAMED LIST), NOT AUTO-PLACED — a run
	   with no `.fs-svc` sibling would otherwise auto-place into track 1 and
	   start one column left of every run that does print a name. The
	   environments still wrap inside this one fixed-x column exactly as they
	   did in the old flex row. */
	.fs-chips {
		grid-column: 2;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 6px;
		min-width: 0;
	}

	.fs-runs--unnamed .fs-chips {
		grid-column: 1;
	}

	:global(.dark) .fs-svc {
		color: var(--color-gray-400);
	}
</style>
