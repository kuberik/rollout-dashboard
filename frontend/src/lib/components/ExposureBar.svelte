<svelte:options runes={true} />

<script lang="ts">
	/**
	 * EXPOSURE — Direction B's state half, object 3.
	 *
	 * "How much of what is actually SERVING is on the newest build." The
	 * chain answers it per environment; this answers it per POD, which is a
	 * different number whenever one environment holds forty replicas and
	 * another holds two. That difference is the whole reason the object
	 * exists, and it is why this is built from ready pods and not from a
	 * count of environments — an environment-weighted bar would restate the
	 * chain, and Direction B's thesis is that nothing appears twice.
	 *
	 * ⚠️ `/api/rollouts` DOES NOT CARRY READY-POD COUNTS. They sit behind a
	 * per-rollout managed-resources call. The page fetches them per
	 * environment (option (a) of the three the spec offers — this is a detail
	 * page with a bounded environment count) and passes the result here.
	 * When nothing resolves, this renders one honest sentence and NO bar.
	 * A ratio is never fabricated, and the denominator always names what it
	 * actually counted.
	 *
	 * COLOUR. The study ramps segment colour by rank. That ramp is the
	 * Ember/Gantt encoding `DESIGN.md` records as measured-failed and
	 * deleted, so it is not ported. The newest segment takes the quiet mint
	 * `newest` already owns (`#426d64` / `#83b0a8`); everything older is
	 * gray, alternating between the two passive steps the product already
	 * uses so adjacent segments stay separable. Rank is carried by ORDER
	 * (newest first) and by the printed sha in the key, never by hue. Zero
	 * new colour values.
	 *
	 * THAT MINT IS NOW SHARED WITH `CoverageBar`'s `live` SEGMENT, and it is
	 * the same sentence in both places: *the part of this whole that is on the
	 * build in question*. The two objects had drifted — one painted that
	 * segment mint and the other painted it `gray-500` — which is one idea
	 * rendered two ways on two pages, the cross-page inconsistency that reads
	 * as "assembled, not designed". They agree now.
	 *
	 * GEOMETRY IS `.prop-bar` IN `app.css`, also shared with `CoverageBar`:
	 * 1px gutters, 4px radius, 6px segment floor. This component supplies only
	 * its own 8px height, which is the coverage miniature's height, because
	 * both sit in a narrow column beside 11px mono.
	 */

	type Segment = {
		version: string;
		pods: number;
		/** 0-100, already rounded for display. */
		percent: number;
		newest: boolean;
	};

	let {
		segments,
		totalPods,
		newestPercent,
		unknownEnvironments = 0,
		loading = false
	}: {
		segments: Segment[];
		totalPods: number;
		/** null when no environment reported a pod count. */
		newestPercent: number | null;
		/** Environments whose pod count could not be established. */
		unknownEnvironments?: number;
		loading?: boolean;
	} = $props();

	// Two passive grays, alternating, so two adjacent trailing builds do not
	// merge into one bar. Both values are already in the product.
	const OLD = ['bg-gray-400 dark:bg-gray-500', 'bg-gray-300 dark:bg-gray-600'];
	function fill(s: Segment, i: number): string {
		return s.newest ? 'bg-[#426d64] dark:bg-[#83b0a8]' : OLD[i % 2];
	}
</script>

{#if loading}
	<div class="h-2 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" aria-hidden="true"></div>
{:else if newestPercent === null || segments.length === 0}
	<!-- NEVER A FABRICATED RATIO — and never a SENTENCE about the absence
	     either (2026-08-27). `Ready-pod counts are not available for this app.`
	     was a 47-character explanation standing in for a number, in a 340px
	     column, on a page the human has just told us is over-written:
	     *"Text doesn't cut it and just pollutes."*

	     The em dash is the product's own idiom for a metric that has nothing
	     to measure — `/envs/[name]`'s `Median bake` tile prints exactly this
	     when no bake window resolved — so an unmeasurable exposure now reads
	     the same way as every other unmeasurable metric in the dashboard, at
	     the size a measured one would have had. The sentence survives in the
	     `title`, which is where a reason belongs. -->
	<p
		class="t-headline text-gray-500 dark:text-gray-400"
		title="Ready-pod counts are not available for this app"
	>
		—
	</p>
{:else}
	<p class="flex items-baseline gap-2">
		<span class="t-headline text-gray-900 dark:text-white">{newestPercent}%</span>
		<span class="t-micro text-gray-500 dark:text-gray-400">
			of {totalPods} ready pod{totalPods === 1 ? '' : 's'} on newest
		</span>
	</p>

	<!-- The bar. One segment per distinct build, width = its ready pods. The
	     1px gutter is the same sub-scale hairline `DeployVolumeSparkline` and
	     `FleetStrip` already use, reused rather than invented. -->
	<div class="prop-bar mt-2 h-2" role="img" aria-label="{newestPercent}% of ready pods on the newest build">
		{#each segments as s, i (s.version)}
			<span
				class="block h-full {fill(s, i)}"
				style="flex: {s.pods} 1 0%"
				title="{s.version} — {s.pods} ready pod{s.pods === 1 ? '' : 's'} ({s.percent}%)"
			></span>
		{/each}
	</div>

	<ul class="mt-2 flex flex-col gap-1">
		{#each segments as s, i (s.version)}
			<li class="flex items-center gap-2">
				<span class="cov-swatch border-transparent {fill(s, i)}" aria-hidden="true"></span>
				<span class="t-code-sm min-w-0 truncate text-gray-600 dark:text-gray-300">{s.version}</span>
				<span class="t-code-sm ms-auto shrink-0 text-gray-500 dark:text-gray-400">{s.percent}%</span>
			</li>
		{/each}
	</ul>

	{#if unknownEnvironments > 0}
		<!-- The denominator says what it counted. An environment that could not
		     be measured is stated, never silently folded into "the rest". -->
		<p class="t-micro mt-1 text-gray-500 dark:text-gray-400">
			{unknownEnvironments} environment{unknownEnvironments === 1 ? '' : 's'} not counted
		</p>
	{/if}
{/if}
