<svelte:options runes={true} />

<script lang="ts">
	/**
	 * WHICH FAILURES ROLL A ROLLOUT BACK, ONE ROW EACH (auto-rollback preview).
	 * Role: the controller's verdict on every source that failed a bake (`failedHealthChecks[].failures[]`): the test, alert
	 * or resource that failed, whether that failure rolls back, and why. Drawn in the "Rolled back automatically" panel, the
	 * failed-deploy banner and the failed History entry, so the same fact reads the same everywhere.
	 * Why new: `FailureSourceRow` draws a MEASURED observation (a figure against a budget); a verdict has no figure, it has a
	 * consequence and a reason, and the two must not be mistaken for each other in one list. No existing component lists
	 * "this failed, and it does / does not roll back".
	 * Proportions borrowed from: `FailureSourceRow` (14px glyph column, 8px gap, `t-ui-sm` name over a `t-meta` line) so the
	 * two sit in one banner without a seam. Ink is state only: a failure that rolls back is danger, one that does not is
	 * muted (it failed, and it did not count). The identifier is code, wraps after a "/" and never truncates.
	 */
	import CheckGlyph from './CheckGlyph.svelte';
	import { shortRef, type VerdictRow } from '$lib/view-models/auto-rollback';

	/** `would`: the rollback did not run (a build deployed by hand, no target): a failure that rolls back reads "would roll back" */
	let { rows, would = false }: { rows: VerdictRow[]; would?: boolean } = $props();
</script>

<ul class="flex min-w-0 flex-col gap-2" data-testid="verdict-rows">
	{#each rows as r (r.key)}
		<li class="grid grid-cols-[14px_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5" data-testid="verdict-row" data-rolls-back={r.rollsBack}>
			<CheckGlyph cls={r.cls} class="{r.rollsBack ? 'text-danger' : 'text-fg-subtle'} h-3.5 w-3.5 translate-y-0.5" />
			<span class="flex min-w-0 flex-wrap items-baseline gap-x-2" title={r.type ? `${r.type} ${r.ref}` : r.ref}>
				<span class="t-code-sm min-w-0 text-fg [overflow-wrap:anywhere]">{shortRef(r.ref)}</span>
				<span class="t-meta whitespace-nowrap {r.rollsBack ? 'text-danger' : 'text-fg-muted'}" data-testid="verdict-word">{would && r.rollsBack ? 'would roll back' : r.word}</span>
			</span>
			<span class="col-start-2 t-meta text-fg-muted [overflow-wrap:anywhere]">{r.why}</span>
			{#if r.message}<span class="col-start-2 t-meta text-fg-subtle [overflow-wrap:anywhere]">{r.message}</span>{/if}
		</li>
	{/each}
</ul>
