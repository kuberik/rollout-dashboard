<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE `stuck` ALARM. This component owns ONE thing now: turning a
	 * `StuckReason` into the sentence that explains it. The MARK is the shared
	 * `Chip role="alarm"`, exactly as on `/apps`, `/apps/[name]`,
	 * `/envs/[name]` and `/versions/[...slug]`.
	 *
	 * WHY IT CHANGED (2026-08-26). It used to draw its own pill —
	 * `rounded-full`, `text-[9px]`, `px-1.5 py-0.5`, `bg-amber-100`,
	 * `ring-1 ring-amber-200` — and that pill was the alarm on `/`,
	 * `/rollouts`, `/namespaces/[name]`, the rollout detail page and
	 * `PromotionNode`. Five of the product's pages were therefore drawing the
	 * loudest mark in the system in a SECOND, WEAKER geometry than the one
	 * DESIGN.md specifies, and nobody had measured it because it is not a
	 * `.chip` and every census selects `.chip`.
	 *
	 * Measured at 1440 light, `area*fillC + area*0.28*inkC + perimeter*borderC
	 * + dotArea*dotC` (the DESIGN.md formula):
	 *
	 *   old pill   fill 0.0592 · ink 0.1358 · ring 0.0053 → presence 116.1
	 *   alarm Chip fill 0.1203 · ink 0.1126 · border 0.1712 → presence 204.2
	 *
	 * The old pill was 0.57x the alarm it was supposed to BE. DESIGN.md had
	 * already written down why, for the Chip: *"amber-100 (#fef3c6) is 1.11:1
	 * against white — the mechanism the spec names as what makes it loudest was
	 * contributing essentially zero luminance mass, and the chip was really an
	 * outline chip with a warm tint."* That fix landed on `Chip` and never
	 * reached here.
	 *
	 * It mattered the moment the region chips were un-clipped: a `wide`
	 * `prod-ap-southeast-2` measures 167.7, so on `/` and `/rollouts` the alarm
	 * fell to 0.69x the loudest identity — inverted, the one ceiling that may
	 * never be crossed. Converging on the Chip puts it back at 1.22x.
	 *
	 * ZERO new colour values, and it DELETES five budget violations: a
	 * `rounded-full` outside the two survivors the radius rule allows, a 9px
	 * type role that is not one of the nine, `px-1.5` / `py-0.5` off the
	 * 4/8/12/16/24 scale, and `amber-100` / `ring-amber-200`.
	 *
	 * NO `size` PROP. `Chip` deliberately has none — *"a chip that can be small
	 * or smaller is a chip that will be both on the same row"* — and this
	 * component must not reintroduce one behind its back.
	 */
	import type { StuckReason } from '$lib/utils';
	import type { PromotionStuckReason } from '$lib/view-models/promotion';
	import { formatTimeAgoCompact } from '$lib/utils';
	import { BAKE_WORD } from '$lib/bake-status';
	import Chip from '$lib/components/Chip.svelte';

	let {
		reason
	}: {
		reason: StuckReason | PromotionStuckReason;
	} = $props();

	const titleText = $derived.by(() => {
		// THE VERB IS `bake-status.ts`'S ONE WORD (2026-08-30). This title was
		// the SEVENTH copy of `baking` and the only one on `/`, `/rollouts`,
		// `/namespaces/*` and rollout detail — a tooltip, so no pixel moves,
		// but a tooltip is where a reader goes when the mark is not enough and
		// it may not answer in a vocabulary no other surface still uses.
		if (reason.kind === 'baking') return `Stuck — ${BAKE_WORD.InProgress} for ${formatTimeAgoCompact(new Date(Date.now() - reason.durationMs).toISOString())}`;
		if (reason.kind === 'deploying') return `Stuck — ${BAKE_WORD.Deploying} for ${formatTimeAgoCompact(new Date(Date.now() - reason.durationMs).toISOString())}`;
		if (reason.kind === 'promotion') {
			const waitingAgo = formatTimeAgoCompact(new Date(Date.now() - reason.waitingMs).toISOString());
			const n = reason.candidateCount;
			const blockedBy = reason.blockingGates.length > 0 ? `, held by ${reason.blockingGates.join(', ')}` : '';
			return `Stuck — ${n} release${n === 1 ? '' : 's'} waiting for ${waitingAgo}${blockedBy}`;
		}
		const peerAgo = formatTimeAgoCompact(new Date(Date.now() - reason.peerAdvancedMs).toISOString());
		const by = reason.behindBy != null ? `${reason.behindBy} version${reason.behindBy === 1 ? '' : 's'} ` : '';
		return `Stuck — ${by}behind ${reason.peerEnv} (advanced ${peerAgo} ago)`;
	});
</script>

<Chip role="alarm" label="stuck" title={titleText} class="shrink-0" />
