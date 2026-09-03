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
	import HowItsGoing from '$lib/components/HowItsGoing.svelte';
	import { leadTime, median } from '$lib/view-models/lead-time';
	import type { LeadEnv } from '$lib/view-models/lead-time';
	import { getEnvironmentRank } from '$lib/env-order';
	import { shortEnvLabel } from '$lib/environment-theme';
	import { getDisplayVersion } from '$lib/utils';
	import { now } from '$lib/stores/time';
	import type { RolloutCard } from '$lib/rollout-cards';
	import type { Rollout, Environment } from '../../types';
	import { ClockOutline, ChevronRightOutline } from 'flowbite-svelte-icons';

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

	/** The same window the two sibling cards use. */
	const SPARK_DAYS = 7;
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

	/**
	 * ⭐ THE CARD'S OWN ROLLUP — "HOW MUCH HISTORY IS THERE", not the 7-day
	 * `volume.deploys` two rows up. (2026-09-03) `/apps/[name]`'s own
	 * `Recent activity` card already answers this (`deployEvents`, unbounded
	 * — every `status.history` entry with a timestamp, across the rollouts
	 * fed to the rail) and reads `5 deploys · View all activity ›`; this
	 * card, `/apps`' and `/envs/<name>`'s all printed the bare link, so the
	 * one page that answers "how much" sat beside three that only offered
	 * "go look". Same field, same guard, same unbounded count — deliberately
	 * NOT `volume.deploys`, which is a 7-day window already spent on
	 * `How it's going` two rows up and would restate that card's own number
	 * under a different label.
	 */
	const activityDeployCount = $derived.by<number>(() => {
		let n = 0;
		for (const r of rollouts) {
			for (const h of r.status?.history ?? []) if (h.timestamp) n++;
		}
		return n;
	});

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
			// ⛔ `inFlight` MARKS A DEPLOY THAT HAS NOT SETTLED YET, SO `leadTime`
			// CAN LEAVE IT OUT OF BOTH ENDS OF THE HOP. (2026-09-03, operator-walk
			// finding 18) `status.history[].timestamp` is written the instant a
			// deploy STARTS, not once it succeeds — see `lead-time.ts`'s module
			// doc for the live flip this caused (`Typical to prod` going
			// `11m → — no full trip yet → 11m` across one deploy). `bakeStatus`
			// is already read straight off the same history entry.
			const deploys: { version: string; ms: number; inFlight: boolean }[] = [];
			for (const h of c.rollout.status?.history ?? []) {
				const v = getDisplayVersion(h.version);
				if (!v || !h.timestamp) continue;
				const ms = new Date(h.timestamp).getTime();
				if (Number.isFinite(ms)) {
					deploys.push({
						version: v,
						ms,
						inFlight: h.bakeStatus === 'InProgress' || h.bakeStatus === 'Deploying'
					});
				}
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

	const fleetLeadMs = $derived(median(leadPerApp));

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
	<HowItsGoing
		scope="fleet"
		verdict="{onNewest} of {rankable.length} newest"
		verdictTone={rankable.length > 0 && onNewest === rankable.length ? 'good' : 'neutral'}
		verdictTitle="Rollouts running the newest build their own release list offers them, across {appCount} app{appCount ===
		1
			? ''
			: 's'}"
		windowLabel="{SPARK_DAYS}d"
		population="{rollouts.length} rollout{rollouts.length === 1 ? '' : 's'}"
		deploys={volume.deploys}
		deploysTitle="{volume.deploys} deploy{volume.deploys === 1
			? ''
			: 's'} across every rollout in the last {SPARK_DAYS} days"
		sparklineRollouts={rollouts}
		sparklineDays={SPARK_DAYS}
		typicalToProd={{
			ms: fleetLeadMs,
			title:
				fleetLeadMs === null
					? 'No app has had a version go all the way from its first environment to production inside the deploy history kept for it'
					: `The middle app's own median trip from its first environment to its first production region, measured across ${leadPerApp.length} of ${appCount} apps — the rest have not had a version make the whole trip inside the history kept for them`
		}}
		failed={{
			count: volume.failed,
			title: `Deploys that ended in a failure in the last ${SPARK_DAYS} days, across every rollout`
		}}
	/>

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
			<!--
				⛔ ONE OF THREE "SEE MORE" GRAMMARS ON THIS PAGE, AND THE ONLY ONE
				WITH A GLYPH INSTEAD OF AN SVG CHEVRON. (2026-09-02) This was
				`view all ›` at `text-xs` (12px/400, lowercase) — `ActivityRail`'s
				own default header treatment, hand-copied here because
				`chrome={false}` hands its frame to `Card`. The Steady section 20px
				below carries a DIFFERENT "go look at more of this" control at
				14px/500 with `ChevronRightOutline`. Same page, same JOB (leave this
				card for its full list), two spellings. `.nav-link` — this page's
				existing grammar for "a control that only changes what you are
				looking at" — is the fix on THIS card; `ActivityRail`'s own default
				header (used verbatim by `/apps`, `/apps/<name>`, `/envs/<name>`,
				`/namespaces/<name>`) is a different component this pass does not
				own and is untouched.

				⭐ F7, 2026-09-03 re-check: IN THE RAIL THE ROLLUP IS THE LINK. This
				card lives in a ~320px rail column, so `{n} deploys` and `View all
				activity ›` as two separate flex children (the shape a wide
				"Recent activity" card also uses, e.g. `/apps/[name]`'s own
				main-column card) wrapped onto two lines and measured 65px against
				every other header's 47px — the header's own `min-h-[47px]` floor
				only ever raises a SHORT header, it cannot stop a WRAPPED one from
				growing past it. A rail this narrow never has room for both; two
				elements racing for one line was the wrong shape for it, not a
				wrapping bug to patch.

				So the rail renders ONE control, `.ra-narrow` — the count folded
				into the link's own text, `{n} deploys ›`, with `aria-label="View
				all activity"` supplying the verb the visible text leaves out (a
				bare "5 deploys" does not say the link navigates). `.ra-wide` is
				the old two-piece form, kept for a card wide enough to afford it —
				none of THIS page's rail is, so it never shows here, but the
				`@container` toggle below matches `Card.svelte`'s own 640px number
				rather than inventing a second one. `display: none` on whichever
				form loses, not a second query duplicating markup with different
				props: the count is computed once and both forms share it.
			-->
			<div class="rail-activity-rollup flex shrink-0 items-center gap-1.5">
				<a href="/activity" class="nav-link ra-narrow" aria-label="View all activity">
					{activityDeployCount} deploy{activityDeployCount === 1 ? '' : 's'}
					<ChevronRightOutline class="h-3.5 w-3.5" />
				</a>
				<span class="ra-wide t-code-sm text-gray-500 dark:text-gray-400">
					{activityDeployCount} deploy{activityDeployCount === 1 ? '' : 's'}
				</span>
				<span class="ra-wide t-code-sm text-gray-500 dark:text-gray-400" aria-hidden="true"
					>·</span
				>
				<a href="/activity" class="nav-link ra-wide" aria-label="View all activity">
					View all activity <ChevronRightOutline class="h-3.5 w-3.5" />
				</a>
			</div>
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

<style>
	/*
	 * ⭐ F7, 2026-09-03 re-check. `.ra-wide` starts hidden; the `Card`-scale
	 * threshold (`Card.svelte`'s own `.card-cq`, `min-width: 640px` of the
	 * CARD, not the viewport) is the ancestor container this rule queries —
	 * this component never declares its own `container-type`, it rides the
	 * one `Card.svelte` already sets on the `<section>` this snippet renders
	 * inside. `display: revert` on the winning side, not a hand-picked
	 * value, so the anchor gets `.nav-link`'s own `inline-flex` back and the
	 * plain `<span>`s get their default `inline` — one rule instead of two
	 * element-specific ones.
	 */
	.ra-wide {
		display: none;
	}
	@container (min-width: 640px) {
		.ra-narrow {
			display: none;
		}
		.ra-wide {
			display: revert;
		}
	}
</style>
