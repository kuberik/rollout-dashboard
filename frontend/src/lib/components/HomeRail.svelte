<svelte:options runes={true} />

<script lang="ts">
	/**
	 * `/`'s RIGHT RAIL — a stack of small complete answers.
	 *
	 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
	 *
	 * `/` is the most-seen page in the product and, in the healthy state, it was
	 * a flat grid of fifteen small cards followed by 60% empty viewport at 1440.
	 * Its own criteria are *is anything on fire · what needs me, in what order ·
	 * what can I resolve right now*, and it answered all three with "nothing"
	 * correctly — and then stopped composing.
	 *
	 * That is the same defect the app detail page had: a rule ("no card spent on
	 * absence") applied to the PAGE instead of to a card. The fix is the one
	 * `COMPOSITION-GRAMMAR.md` §7 names — *"main column plus a rail of
	 * INDEPENDENT cards … not a sidebar of scraps; it is a stack of small
	 * complete answers"* — and this product already ships exactly that rail,
	 * twice, with exactly these two cards: `/apps` and `/envs/<name>`. `/` is
	 * the third. Nothing here is a new object, a new measurement or a new colour.
	 *
	 * ── WHAT LEADS AND WHAT RAILS ───────────────────────────────────────────
	 *
	 * The four severity groups LEAD, in the main column, unchanged. They are
	 * criteria 2 and 3 (*what needs me, in what order* / *what can I resolve
	 * right now*) and the human names them as this page's structure.
	 *
	 * The rail carries the two dimensions the groups structurally cannot:
	 *
	 *   WHEN      `Recent activity` — what moved, from what, how long ago. A
	 *             group card is a state at one instant; the rail is the only
	 *             thing on `/` with a time axis.
	 *   HOW MUCH  `How it's going` — throughput over a window. The groups
	 *             partition the fleet NOW and can say nothing about the week.
	 *
	 * ── THE THIRD ROW IS `Failed · 7d`, NOT `Furthest behind` ───────────────
	 *
	 * ⛔ AND THAT IS THE ONE DELIBERATE DEVIATION FROM THE TWO SIBLING CARDS.
	 * `/apps` and `/envs/<name>` both spend their third row on `Furthest behind
	 * <app> <N>`, because on those pages no row prints the lag DEPTH. On `/` the
	 * Trailing group is 200px to the left and every card in it draws `N BEHIND`
	 * in a chip — so that row would restate a mark already on screen, in the
	 * same viewport, with the same number and the same app name. One fact drawn
	 * twice is the defect this branch has paid for repeatedly.
	 *
	 * `Failed · 7d` is the reading `/` has no other way to make: the groups
	 * answer *is anything on fire NOW*, and an all-green page cannot say whether
	 * it has been green all week or recovered twenty minutes ago. It takes the
	 * same 7-day window as `Deploys`, so the two are a numerator and a
	 * denominator over one period rather than two unrelated figures.
	 *
	 * ⚠️ AND IT IS THE THIRD ROW, NOT THE SECOND. All three cards run *volume,
	 * then duration, then the page's own reading* — `/apps` and `/envs/<name>`
	 * both put their time measure second (`Typical to prod` / `Typical deploy`)
	 * and their page-specific figure last. Only the last row may differ between
	 * the three, or the object stops being one object taught once.
	 */
	import Card from '$lib/components/Card.svelte';
	import ActivityRail from '$lib/components/ActivityRail.svelte';
	import DeployVolumeSparkline from '$lib/components/DeployVolumeSparkline.svelte';
	import { leadTime, compactSpan } from '$lib/view-models/lead-time';
	import type { LeadEnv } from '$lib/view-models/lead-time';
	import { getEnvironmentRank } from '$lib/env-order';
	import { shortEnvLabel } from '$lib/environment-theme';
	import { getDisplayVersion } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import type { RolloutCard } from '$lib/rollout-cards';
	import type { Rollout, Environment } from '../../types';
	import {
		ChartMixedOutline,
		RocketSolid,
		ClockOutline,
		CloseCircleSolid
	} from 'flowbite-svelte-icons';

	let {
		cards,
		rollouts,
		environments,
		localClusterName = ''
	}: {
		cards: RolloutCard[];
		rollouts: Rollout[];
		environments: Environment[];
		localClusterName?: string;
	} = $props();

	/** The same window and the same minimum the two sibling cards use. */
	const SPARK_DAYS = 7;
	const SPARK_MIN = 3;
	const ACTIVITY_SHOWN = 8;

	/**
	 * ⛔ `unknown` IS EXCLUDED FROM BOTH HALVES OF THE ROLLUP, not counted as
	 * behind. `env-rank.ts`: *"nothing deployed, or the comparison cannot be
	 * resolved — callers must print NO NUMBER"*. A rollout whose rank cannot be
	 * resolved is not evidence that the fleet is behind, and `DESIGN.md` forbids
	 * rendering an unresolvable comparison as a definite claim. It drops out of
	 * the denominator, which is what `/envs/<name>`'s `rankableCount` already
	 * does with the same verdict object.
	 */
	const rankable = $derived(cards.filter((c) => c.rank.kind !== 'unknown'));
	const onNewest = $derived(rankable.filter((c) => c.rank.kind === 'newest').length);

	const windowStartMs = $derived($now.getTime() - SPARK_DAYS * 24 * 60 * 60 * 1000);

	/**
	 * Deploys and failed deploys in the window, over the whole fleet. Counted
	 * off `status.history` exactly as `/apps` counts its own — same field, same
	 * window, same guard on a missing timestamp — so the two pages cannot
	 * disagree about how many times the fleet moved this week.
	 */
	const volume = $derived.by(() => {
		const endMs = $now.getTime();
		let deploys = 0;
		let failed = 0;
		for (const r of rollouts) {
			for (const h of r.status?.history ?? []) {
				if (!h.timestamp) continue;
				const t = new Date(h.timestamp).getTime();
				if (!(t >= windowStartMs && t <= endMs)) continue;
				deploys++;
				if (h.bakeStatus === 'Failed') failed++;
			}
		}
		return { deploys, failed };
	});

	/**
	 * ⚠️ A MEDIAN OF MEDIANS, AND IT SAYS SO — the same construction, over the
	 * same `leadTime` view-model, that `/apps` uses. Each app's own median is
	 * taken over that app's trips; the fleet figure is the MIDDLE APP, not the
	 * middle trip, so a 15-deploy app does not drown a 3-deploy one and the
	 * number stays about time-to-production rather than about churn. Apps with
	 * no observed full trip are EXCLUDED rather than counted as zero, and the
	 * denominator rides in the tooltip so a reader can see how thin it is.
	 *
	 * The grouping key is the ROLLOUT NAME, which on `/` is the app: this page's
	 * cards are one app in one environment, and `rollout-cards.ts` keys its own
	 * per-app index off exactly that field.
	 */
	const leadPerApp = $derived.by<number[]>(() => {
		const byApp = new Map<string, LeadEnv[]>();
		for (const c of cards) {
			if (!c.name || !c.envName) continue;
			const deploys: { version: string; ms: number }[] = [];
			for (const h of c.rollout.status?.history ?? []) {
				const v = getDisplayVersion(h.version);
				if (!v || !h.timestamp) continue;
				const ms = new Date(h.timestamp).getTime();
				if (Number.isFinite(ms)) deploys.push({ version: v, ms });
			}
			const list = byApp.get(c.name) ?? [];
			list.push({
				label: shortEnvLabel(c.envName) || c.envName,
				order: getEnvironmentRank(c.envName),
				// The same production predicate `/apps` uses, from the same table.
				prod: getEnvironmentRank(c.envName) >= 7,
				deploys
			});
			byApp.set(c.name, list);
		}
		const out: number[] = [];
		for (const envs of byApp.values()) {
			const vm = leadTime(envs);
			if (vm) out.push(vm.medianMs);
		}
		return out;
	});

	const fleetLeadMs = $derived.by<number | null>(() => {
		const xs = [...leadPerApp].sort((a, b) => a - b);
		if (xs.length === 0) return null;
		const mid = Math.floor(xs.length / 2);
		return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
	});

	const appCount = $derived(new Set(cards.map((c) => c.name)).size);
</script>

<!--
	⚠️ `min-w-0` ON THE RAIL COLUMN, not here — this component is the STACK, and
	the grid cell that holds it is `ControlCenter`'s. `space-y-4` is the gap the
	two sibling rails already use between their two cards.
-->
<div class="min-w-0 space-y-4">
	<!--
		⛔ THE ROLLUP IS `N of M newest`, NOT `N of M up to date`, AND THE WORD IS
		FORCED FROM BOTH SIDES.

		SUBJECT: `messages/axis.ts` pins `N of M up to date` as the `up-to-date
		headline` claim, whose rule requires the APP to be resolvable above it.
		On `/apps` a card header fixes the app; `/` fixes NOTHING — that is the
		whole reason it has its own line in the registry. The `card rollup` claim
		(`N of M <word>`) aggregates app and environment by construction, which is
		exactly what a fleet-wide denominator does.

		WIDTH: measured at 1440 in a 320px rail, `12 of 15 on the newest` took
		143px of a 140px budget and clipped the card's own TITLE to `How it's
		goin…`. `/apps`'s note already records that a titled card which cannot
		print its title is not one. `newest` is not a shortening for its own sake:
		it is the word the rank chip prints twelve times in the column beside it,
		so the rollup speaks the page's own vocabulary rather than a synonym of
		it. The full sentence, with its denominator, is in `verdictTitle`.
	-->
	<Card
		icon={ChartMixedOutline}
		title="How it’s going"
		verdict="{onNewest} of {rankable.length} newest"
		verdictTone={rankable.length > 0 && onNewest === rankable.length ? 'good' : 'neutral'}
		verdictTitle="Rollouts running the newest build their own release list offers them, across {appCount} app{appCount ===
		1
			? ''
			: 's'}"
	>
		<dl class="space-y-3">
			<div class="flex items-baseline justify-between gap-3">
				<dt class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
					<RocketSolid class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Deploys · 7d
				</dt>
				<dd class="flex items-center gap-2">
					<!-- Below three points a sparkline is two bars and a gap — it draws
					     a trend nobody can read. The count stands alone, exactly as it
					     does on the two sibling cards. -->
					{#if volume.deploys >= SPARK_MIN}
						<DeployVolumeSparkline {rollouts} days={SPARK_DAYS} />
					{/if}
					<span class="text-base font-semibold text-gray-900 tabular-nums dark:text-white"
						>{volume.deploys}</span
					>
				</dd>
			</div>
			<div class="flex items-baseline justify-between gap-3">
				<dt class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
					<ClockOutline class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Typical to prod
				</dt>
				<dd
					class="text-base font-semibold text-gray-900 tabular-nums dark:text-white"
					title={fleetLeadMs === null
						? 'No app has had a version go all the way from its first environment to production inside the deploy history kept for it'
						: `The middle app's own median trip from its first environment to its first production region, measured across ${leadPerApp.length} of ${appCount} apps — the rest have not had a version make the whole trip inside the history kept for them`}
				>
					{fleetLeadMs === null ? '—' : compactSpan(fleetLeadMs)}
				</dd>
			</div>
			<div class="flex items-baseline justify-between gap-3">
				<dt class="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
					<CloseCircleSolid class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Failed · 7d
				</dt>
				<!-- ⛔ THE INK MARKS THE DEVIATION AND NOTHING ELSE. A zero here is
				     the norm and takes the same near-black every other figure on this
				     card takes; a non-zero is the one number on the card that wants a
				     person, and it takes the product's `Failed` red — the same value
				     `ActivityRail` and `BakeStatusIcon` already spend on that word.
				     No new hue, and no green for the zero: green would be a second
				     mark for "everything is fine", which the whole page already is. -->
				<dd
					class="text-base font-semibold tabular-nums {volume.failed > 0
						? 'text-red-700 dark:text-red-400'
						: 'text-gray-900 dark:text-white'}"
					title="Deploys that ended in a failure in the last 7 days, across every rollout"
				>
					{volume.failed}
				</dd>
			</div>
		</dl>
	</Card>

	<!--
		THE SHARED RAIL, NOT A NEW OBJECT. `/apps`, `/apps/<name>`,
		`/envs/<name>` and `/namespaces/<name>` all render this component; the
		call here is byte-for-byte `/apps`', because `/` has the same scope — many
		apps, many environments — so both `showAppName` and `showEnv` are on and a
		row is self-identifying.

		`chrome={false}` HANDS THE FRAME TO `Card`. Left to itself the rail draws
		a `t-label` caption floating above its own `rounded-xl` box, which is the
		shape `COMPOSITION-GRAMMAR.md` names as what every rejected page is built
		from — and it would be the only 12px radius on this page.
	-->
	<Card icon={ClockOutline} title="Recent activity" padded={false}>
		{#snippet rollup()}
			<a
				href="/activity"
				class="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
				aria-label="View all deploy activity">view all ›</a
			>
		{/snippet}
		<ActivityRail
			{rollouts}
			{environments}
			limit={ACTIVITY_SHOWN}
			showEnv={true}
			showAppName={true}
			chrome={false}
			{localClusterName}
		/>
	</Card>
</div>
