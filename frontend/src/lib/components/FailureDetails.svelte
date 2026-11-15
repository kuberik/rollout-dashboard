<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE BANNER'S DETAILS, evidence form: the checks a failed deploy is about, one block each (name, then one row per failing or
	 * recovered observation). One component for every failure banner (the rollout Overview, the list pages' hero, /apps/<app>) so
	 * the same facts open under the same word. Each check leads with the Health checks card's own state mark (`CheckStateMark`) and the checks
	 * run in the card's order (failing, pending, recovered), so "2 failing, 1 pending" matches the rows. The rows are `FailureSourceRow`; this file words nothing.
	 */
	import FailureSourceRow from './FailureSourceRow.svelte';
	import CheckStateMark from './CheckStateMark.svelte';
	import { byVerdict, type CheckView } from '$lib/view-models/health-failures';

	let { pool }: { pool: CheckView[] } = $props();
</script>

<div class="flex flex-col gap-3">
	{#each byVerdict(pool) as c (c.key)}
		{@const rs = c.rows.length ? c.rows : (c.recovery?.rows ?? [])}
		{#if rs.length > 0}
			<div>
				<div class="mb-1.5 flex items-center gap-2">
					<CheckStateMark verdict={c.verdict} />
					<span class="t-label text-fg-subtle">{c.name}</span>
				</div>
				<ul class="flex flex-col gap-2">
					{#each rs as r (r.key)}<FailureSourceRow row={r} />{/each}
				</ul>
			</div>
		{/if}
	{/each}
</div>
