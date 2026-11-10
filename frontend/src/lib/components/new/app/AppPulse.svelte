<script lang="ts">
	/**
	 * r2 apps fix 4 — "How it's going" of /apps/<name> IS the History tab's Summary card (HistorySummaryCard, reused, not copied): a rollup
	 * ("last 7 days") plus the stat figures (Failed in its own ink while a place's newest deploy is the failure, Rolled back, Median to healthy)
	 * and the Last failure fact. It replaces the flat seven-bar chart, which drew the deploy count the Activity card's header already prints.
	 * With fewer than two days holding a deploy a bar row or a figure grid says nothing, so the card collapses to its short list of facts (compact).
	 * Figures: app-model weekSummary over the app's place histories; rolled back = history-marks' deployActs, the tab's own definition.
	 */
	import HistorySummaryCard from '$lib/components/HistorySummaryCard.svelte';
	import { now } from '$lib/stores/time';
	import { deployActs } from '$lib/history-marks';
	import { formatTimeAgoCompact } from '$lib/utils';
	import { weekSummary } from './app-model';
	import type { Rollout } from '../../../../types';
	let { days, rollouts }: { deploys?: number; days: number; rollouts: Rollout[] } = $props();

	const sum = $derived(weekSummary(rollouts.map((r) => ({ history: (r.status?.history ?? []) as never, rolledBack: deployActs(r).map((a) => a?.kind === 'rollback') })), days, $now.getTime()));
	const lastFailureAgo = $derived(sum.lastFailureMs === null ? null : `${formatTimeAgoCompact(new Date(sum.lastFailureMs).toISOString(), $now)} ago`);
</script>

<HistorySummaryCard
	rangeLabel="last {days} days"
	failed={sum.failed}
	failedOpen={sum.openFailure}
	rolledBack={sum.rolledBack}
	medianHealthyMs={sum.medianHealthyMs}
	{lastFailureAgo}
	kept={null}
	compact={sum.daysWithData < 2}
/>
