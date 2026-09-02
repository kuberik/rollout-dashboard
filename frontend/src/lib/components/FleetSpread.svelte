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
			<ul class="fs-runs">
				{#each runs(bucket) as run (run.appName)}
					<li class="fs-run">
						{#if !oneService}
							<span class="fs-svc">{run.appName}</span>
						{/if}
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

	.fs-runs {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
		min-width: 0;
	}

	/* The service name leads, its environments wrap after it. A 13-region
	   service is one wrapped line here, never thirteen rows. */
	.fs-run {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 6px;
		min-width: 0;
	}

	.fs-svc {
		font-size: 11px;
		line-height: 16px;
		color: var(--color-gray-500);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(.dark) .fs-svc {
		color: var(--color-gray-400);
	}
</style>
