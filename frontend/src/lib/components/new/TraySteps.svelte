<script lang="ts">
	/**
	 * r34 r5 — the Deployment pipeline's STEP LIST drawn exactly as the rollout tab draws it (DeploymentPipelineCard's
	 * nav column): 44px rows (py-2 around the disc), a 24px tinted disc carrying a 16px glyph (done = success check,
	 * failed = danger exclamation, live = spinner, todo = clock), joined by a 2px connector, the node's own name
	 * ("Started", "Stage 1", "Check"), a chip only for a step that is neither done nor failed, the selected row washed
	 * `bg-selected` with a 2px accent bar (square row, so a side bar is allowed). Used by the decision pane (at ≥600px
	 * of pane width) and by the phone cards, so a step reads the same at every size.
	 * Why no existing component fits: the tab's list is inline in a 1,600-line card bound to a live Rollout object.
	 * STRAND MODE (S2): `layout="strand"` is a one-line adapter over MiniPipeline.svelte (the one strand drawing). The vertical LIST mode stays here: it is a different job (a selectable nav with chips and a detail pane), not a strand, and its 44px rows have no pitch to equalise.
	 */
	import { CheckCircleSolid, ExclamationCircleSolid, ClockSolid } from 'flowbite-svelte-icons';
	import type { Step } from './data';
	import { stepTone } from './rollout-view';
	import MiniPipeline from './MiniPipeline.svelte';
	import { nodesOfSteps } from './mini-pipeline';

	let { steps, selected = null, layout = 'list', node = 'md', checkWord = 'Checking', noActiveChip = false, noHoldChip = false, dup = false, class: className = '' }: {
		/** rollouts-12 (additive): a decorative second drawing of the same steps (the phone lead's one-line strand beside the list that sm+ shows); carries no data-step, no label, hidden from AT, so a page counts every step once */ dup?: boolean;
		/** changedetail-10 (additive): a waiting gate wears no chip where the banner and the place's row already say the wait once */ noHoldChip?: boolean;
		/** rollouts-9 (additive): the active step wears no chip when the pane's own heading already says that word once */ noActiveChip?: boolean;
		steps: Step[]; /** the step whose detail is open (name) */ selected?: string | null;
		/** inbox-6 (additive): 'strand' = the same nodes in one row, each named under its node (the calm lead row's drawing at main width; 6 nodes fit 314px) */ layout?: 'list' | 'strand'; /** r6 T4 (additive): the word of the ACTIVE Check step: 'Checking' (default) while the check runs, 'Deploying' while the deploy runs (the tab's pill word for a fallback pipeline's Check step; its disc is then the deploy's blue, not the check's yellow) */ checkWord?: 'Checking' | 'Deploying'; /** inbox-7 (additive; strand only): 'lg' = the tab's own 28px disc, names at 14 (the active/failed one 600), pitch capped at the tab's ('md' stays 24px / 12px for Slipway) */ node?: 'md' | 'lg'; class?: string;
	} = $props();

	const WORD: Record<Step['state'], string> = { done: 'done', active: 'running', fail: 'failed', todo: 'not started', hold: 'waiting' };
	/* the tab: a deploying stage is IN PROGRESS (blue), the final check is CHECKING (progress yellow) */
	const chk = (s: Step) => stepTone(s, checkWord === 'Deploying' ? 'deploying' : 'checking') === 'checking';
	const chipOf = (s: Step) => (s.state === 'active' && noActiveChip ? '' : s.state === 'active' ? (s.name === 'Check' ? checkWord : 'In progress') : s.state === 'todo' ? 'Pending' : s.state === 'hold' ? (noHoldChip ? '' : 'Waiting') : '');
	const accent = (s: Step) => (s.state === 'fail' ? 'bg-danger-solid' : s.state === 'done' ? 'bg-success-solid' : chk(s) ? 'bg-progress-solid' : 'bg-active-solid');
	/* inbox-14 (N85, additive): the tab's own spinner colours (DeploymentPipelineCard): the -solid hue ring, never currentColor at 30%, which vanished in light */
	const spin = (s: Step) => (chk(s) ? 'border-progress-solid/40 border-t-progress-solid' : 'border-active-solid/40 border-t-active-solid');
	const disc = (s: Step) => (s.state === 'done' ? 'bg-success-tint text-success' : s.state === 'fail' ? 'bg-danger-tint text-danger' : chk(s) ? 'bg-progress-tint text-progress' : s.state === 'active' ? 'bg-active-tint text-active' : 'bg-subtle text-fg-disabled'); /* inbox-8 (N27): a pending clock is the faintest mark in light, so the running ring is the strongest */
	const chipTone = (s: Step) => (chk(s) ? 'border-progress-line text-progress' : s.state === 'active' ? 'border-active-line text-active' : 'border-line text-fg-subtle');
</script>

{#if layout === 'strand'}
	<!-- S2: the horizontal strand is MiniPipeline's job (equal pitch, never stretched, see its doc comment); `node='lg'` (the tab's 28px disc) folded into its one labelled size (the tab's own 24px disc), so a panel and a phone card draw the same strand -->
	<MiniPipeline nodes={nodesOfSteps(steps, checkWord === 'Deploying' ? 'deploying' : 'checking', true)} size="sm" decorative={dup} kind={dup ? 'strand-dup' : 'strand'} label="Pipeline steps" class={className} />
{:else}
<ol class="min-w-0 py-2 {className}" data-pipeline="list" aria-label="Pipeline steps">
	{#each steps as s, i (i)}
		{@const on = selected === s.name}
		<li class="relative" data-step={s.name} data-state={s.state} aria-current={on ? 'step' : undefined}>
			{#if i > 0}<span aria-hidden="true" class="absolute left-[27px] top-0 h-[10px] w-0.5 bg-line-strong"></span>{/if}
			{#if i < steps.length - 1}<span aria-hidden="true" class="absolute bottom-0 left-[27px] top-[34px] w-0.5 bg-line-strong"></span>{/if}
			<div class="relative flex h-11 items-center gap-3 pl-4 pr-3 {on ? 'bg-selected' : ''}">
				{#if on}<span aria-hidden="true" class="absolute inset-y-0 left-0 w-0.5 {accent(s)}"></span>{/if}
				<span class="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full {disc(s)}" data-node>
					{#if s.state === 'done'}
						<CheckCircleSolid class="h-4 w-4" aria-hidden="true" />
					{:else if s.state === 'fail'}
						<ExclamationCircleSolid class="h-4 w-4" aria-hidden="true" />
					{:else if s.state === 'active'}
						<span class="h-4 w-4 animate-spin rounded-full border-2 {spin(s)}" aria-hidden="true"></span>
					{:else}
						<ClockSolid class="h-4 w-4" aria-hidden="true" />
					{/if}
				</span>
				<span class="min-w-0 flex-1 truncate {s.state === 'fail' ? 't-card-title text-danger' : on ? 't-card-title text-fg' : 't-body text-fg-muted'}">{s.name}</span>
				{#if chipOf(s)}<span class="chip t-label chip-wide shrink-0 {chipTone(s)}">{chipOf(s)}</span>{/if}
				<span class="sr-only">{WORD[s.state]}</span>
			</div>
		</li>
	{/each}
</ol>
{/if}

