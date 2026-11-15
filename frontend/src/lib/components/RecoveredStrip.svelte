<svelte:options runes={true} />

<script lang="ts">
	/**
	 * WHEN A RECOVERED CHECK FAILED, DRAWN ONCE: the one place the dashboard draws time.
	 * Role: for a check that failed during the bake and is Healthy now (flapped, or recovered mid-bake), a single compact
	 * lane: axis from the check's start ("check 14:00": the bake start, not the deploy) to a `now` label at the right end, one span [failed, OK]
	 * in the danger solid at its recovered depth, a 1px mark at the failed instant labelled `failed 14:03`, the word `OK 14:05` in success
	 * (the one green word) and the clean stretch from OK to now as a success hairline. The strip is capped at the evidence row's width.
	 * Why new: the Overview has no time-axis object for a single check; the recovered fact is otherwise only a clock time,
	 * and "it failed for three minutes of a thirty-eight minute bake" is a position, not a sentence.
	 * Proportions borrowed from: take B's BakeLanes (2px mark, 6px span radius 4, 1px hairline axis, t-micro tick labels);
	 * one lane per recovered check only: failing checks never draw a strip (their rows already say what failed).
	 * Labels never collide: the failed label ends at its mark (or starts at it when the mark is near the left edge), the start
	 * tick hides when it would touch the failed label, and OK is always right-aligned.
	 */
	import { windowStrip, type Recovery } from '$lib/view-models/health-failures';
	import { now } from '$lib/stores/time';

	let { recovery, axisStart }: { recovery: Recovery; axisStart: Date | null } = $props();

	const s = $derived(windowStrip(recovery, axisStart, $now));
	let w = $state(280);
	/* label widths at t-micro (measured, tabular): a label never overlaps another; the geometry is decided in px */
	const FAILED_W = 66, OK_W = 48, START_W = 76, NOW_W = 26, GAP = 6;
	const fx = $derived((s?.failedPct ?? 0) * w);
	const ox = $derived((s?.okPct ?? 0) * w);
	/* the failed label ends at its mark; near the left edge it starts at the mark instead */
	const failedRight = $derived(fx >= FAILED_W);
	const failedLeft = $derived(failedRight ? fx - FAILED_W : fx);
	const failedEnd = $derived(failedLeft + FAILED_W);
	/* the OK label sits at the span's right end (the OK moment); it clears the failed label, and never runs past the axis */
	const okLeft = $derived(Math.min(Math.max(ox, failedRight ? ox : failedEnd + GAP), w - OK_W));
	/* `now` ends the axis. When OK is too close to now for two labels, they become one right-aligned label ("OK 09:34 · now") */
	const merged = $derived(okLeft + OK_W + 16 > w - NOW_W);
	const mergedLeft = $derived(Math.max(failedEnd + GAP, w - OK_W - NOW_W - 14));
	/* the start label shares the label row when it clears the failed label; otherwise it takes its own row above the axis, so it is never dropped */
	const startAbove = $derived(failedLeft < START_W + GAP);
</script>

{#if s}
	<div class="mt-2 max-w-[420px] select-none" data-testid="recovered-strip" bind:clientWidth={w}>
		{#if startAbove}<div class="t-micro text-fg-subtle mb-0.5 whitespace-nowrap tabular-nums" data-testid="strip-start">{s.startLabel}</div>{/if}
		<div class="relative h-4" title="Failed {s.failedLabel.replace('failed ', '')}, OK {s.okLabel.replace('OK ', '')}">
			<span class="bg-line-strong absolute inset-x-0 top-1/2 h-px" aria-hidden="true"></span>
			<span
				class="bg-danger-solid absolute top-1/2 h-1.5 -translate-y-1/2 rounded-[4px] opacity-70"
				style="left:{s.failedPct * 100}%;width:max(6px,{(s.okPct - s.failedPct) * 100}%)"
				aria-hidden="true"
			></span>
			<span class="bg-danger-solid absolute inset-y-0 w-px" style="left:{s.failedPct * 100}%" aria-hidden="true"></span>
			<!-- clean since OK: a success hairline from the OK moment to now -->
			<span class="bg-success-solid absolute top-1/2 h-px" style="left:{s.okPct * 100}%;right:0" aria-hidden="true" data-testid="strip-clean"></span>
		</div>
		<div class="t-micro relative mt-0.5 h-4 tabular-nums">
			{#if !startAbove}<span class="text-fg-subtle absolute left-0 top-0 whitespace-nowrap" data-testid="strip-start">{s.startLabel}</span>{/if}
			<span class="text-danger absolute top-0 whitespace-nowrap" style="left:{failedLeft}px" data-testid="strip-failed">{s.failedLabel}</span>
			{#if merged}
				<span class="text-success absolute top-0 whitespace-nowrap" style="left:{mergedLeft}px" data-testid="strip-ok">{s.okLabel}<span class="text-fg-subtle">{' · '}now</span></span>
			{:else}
				<span class="text-success absolute top-0 whitespace-nowrap" style="left:{okLeft}px" data-testid="strip-ok">{s.okLabel}</span>
				<span class="text-fg-subtle absolute right-0 top-0 whitespace-nowrap" data-testid="strip-now">now</span>
			{/if}
		</div>
	</div>
{/if}
