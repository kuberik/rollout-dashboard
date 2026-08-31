<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE SAME LIE AS THE ETERNAL SKELETON, IN MINIATURE.
	 *
	 * The hub fans out to its spokes and **fails soft**: `/api/rollouts` answers
	 * `200` with the clusters that replied in `rollouts` and the ones that did
	 * not in `clusterErrors`. So a page can be *partly* true — every count,
	 * every "4/4 healthy", every "nothing needs you" on it is computed over a
	 * subset — and until now only `/` and `/rollouts` mentioned it at all, as a
	 * 12px amber aside. Eight other pages read the identical payload and said
	 * nothing.
	 *
	 * A rollout on an unreachable spoke is **absent, not healthy**, and an
	 * absent record is not an observation. That is the whole reason this
	 * component exists and it is why it is an `AlertPanel` — the product's one
	 * filled banner, `COMPOSITION-GRAMMAR.md` §4 — rather than a third error
	 * idiom. `warning`, not `error`: what is on the page IS true, it is just
	 * not all of it.
	 *
	 * It carries the SERVER'S OWN sentence per cluster, verbatim, and never
	 * invents a cause.
	 */
	import AlertPanel from './AlertPanel.svelte';
	import type { ClusterError } from '$lib/api/rollouts';
	import { RefreshOutline, ExclamationCircleSolid } from 'flowbite-svelte-icons';

	let {
		errors,
		/** What this page is a list of, for the "counts below cover only…" line. */
		subject = 'this page',
		onRetry = null,
		isRetrying = false,
		class: className = 'mb-4'
	}: {
		errors: ClusterError[];
		subject?: string;
		onRetry?: (() => void) | null;
		isRetrying?: boolean;
		class?: string;
	} = $props();

	const names = $derived(errors.map((e) => e.name).filter(Boolean));
	const title = $derived(
		names.length === 1
			? `${names[0]} did not answer — this page is incomplete`
			: `${names.length} clusters did not answer — this page is incomplete`
	);
</script>

{#if errors.length > 0}
	<AlertPanel
		severity="warning"
		icon={ExclamationCircleSolid}
		{title}
		class={className}
	>
		{#snippet messageBody()}
			<p>
				Everything on {subject} covers only the clusters that replied. A rollout that lives on
				{names.length === 1 ? names[0] : 'one of these'} is <strong class="font-semibold"
					>missing from these counts, not healthy in them</strong
				>.
			</p>
			<ul class="mt-1.5 space-y-1">
				{#each errors as ce (ce.name)}
					<li class="text-xs break-words">
						<span class="font-semibold">{ce.name}</span> — {ce.error ||
							'the hub gave no reason.'}
					</li>
				{/each}
			</ul>
		{/snippet}
		{#snippet actions()}
			{#if onRetry}
				<button
					type="button"
					class="btn btn-secondary"
					onclick={() => onRetry?.()}
					disabled={isRetrying}
				>
					<RefreshOutline
						class="h-4 w-4 shrink-0 {isRetrying ? 'animate-spin' : ''}"
						aria-hidden="true"
					/>
					{isRetrying ? 'Checking…' : 'Try again'}
				</button>
			{/if}
		{/snippet}
	</AlertPanel>
{/if}
