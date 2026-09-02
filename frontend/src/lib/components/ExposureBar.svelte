<svelte:options runes={true} />

<script module lang="ts">
	export type ExposureSegment = {
		version: string;
		pods: number;
		/** 0-100, already rounded for display. */
		percent: number;
		newest: boolean;
	};

	/**
	 * ⛔ WHETHER THERE IS ANYTHING TO DRAW — AND THE HEADING ASKS THIS TOO.
	 * (2026-08-30)
	 *
	 * `/api/rollouts` carries no ready-pod counts, so on a cluster whose
	 * managed-resources call answers nothing this object has NO NUMBER. It used
	 * to render an em dash for that, under the heading `How much is on the
	 * newest` — a header and a slot spent to say "no data", which is the same
	 * defect that had just removed the `Needs you` card from a healthy app one
	 * card over.
	 *
	 * The em dash's argument was that it is *"the product's own idiom for a
	 * metric that has nothing to measure"* — and that argument holds for a TILE
	 * in a fixed grid of tiles, where the neighbours keep the row's shape and
	 * the dash reads as "this one, unlike those, has no value". This is not a
	 * tile. It is the third and last section of a card, with its own 16px glyph
	 * and its own heading, and a section is not a slot in a row: nothing next to
	 * it makes the dash mean anything.
	 *
	 * ⚠️ AND THE ABSENCE IS NOT ACTIONABLE. `Ready-pod counts are not available
	 * for this app` names an API gap, not something the reader can change, and
	 * this file's rule is that an object which mostly draws the norm — or here,
	 * the nothing — is cut. So the SECTION does not render. The predicate lives
	 * here rather than in the page because the heading and the bar must appear
	 * and disappear together, and a page re-deriving "did this resolve?" is how
	 * the two come to disagree.
	 *
	 * ⛔ NEVER A FABRICATED RATIO. Unchanged: `newestPercent === null` is the
	 * honest answer whenever no environment reported a pod count, and it now
	 * costs the reader nothing to read.
	 */
	export function hasExposure(
		newestPercent: number | null,
		segments: readonly ExposureSegment[]
	): boolean {
		return newestPercent !== null && segments.length > 0;
	}
</script>

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
	 * `newest` already owns (`green-800` / `green-300`); everything older is
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

	type Segment = ExposureSegment;

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
		// ⛔ SPELLED FROM THE RAMP, like `Chip`'s `newest`. This was the last
		//    holder of the hand-picked `#426d64` / `#83b0a8` pair; two spellings
		//    of one budget slot is the defect the `head` -> `newest` collapse
		//    was written to end.
		return s.newest ? 'bg-green-800 dark:bg-green-300' : OLD[i % 2];
	}
</script>

{#if loading}
	<div class="h-2 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" aria-hidden="true"></div>
{:else if !hasExposure(newestPercent, segments)}
	<!-- NOTHING. The em dash that stood here is gone, and so is the heading
	     above it — the page guards BOTH on `hasExposure`. See the note in the
	     module block: a header and a slot spent to say "no data" is the same
	     object this file's own rules cut everywhere else.

	     This branch survives as a GUARD, not as a rendering: a caller that
	     forgets `hasExposure` gets an empty section rather than a fabricated
	     ratio or a NaN. -->
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
