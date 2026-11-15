<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE BANNER'S DETAILS, evidence form: the checks a failed deploy is about, one block each (name, then one row per failing or
	 * recovered observation). One component for every failure banner (the rollout Overview, the list pages' hero, /apps/<app>) so
	 * the same facts open under the same word. The rows are `FailureSourceRow`; this file words nothing.
	 */
	import FailureSourceRow from './FailureSourceRow.svelte';
	import type { CheckView } from '$lib/view-models/health-failures';

	let { pool }: { pool: CheckView[] } = $props();
</script>

<div class="flex flex-col gap-3">
	{#each pool as c (c.key)}
		{@const rs = c.rows.length ? c.rows : (c.recovery?.rows ?? [])}
		{#if rs.length > 0}
			<div>
				<div class="t-label mb-1.5 text-fg-subtle">{c.name}</div>
				<ul class="flex flex-col gap-2">
					{#each rs as r (r.key)}<FailureSourceRow row={r} />{/each}
				</ul>
			</div>
		{/if}
	{/each}
</div>
