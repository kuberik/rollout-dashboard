<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE VIEWER'S APPROVAL ASK AT ONE ROLLOUT PAGE (the rollout detail's held banner and the Gates tab's holding card).
	 * Role: hand the page the same `ApprovalTarget` Home, /apps and /envs offer for this place (data.ts `approvalAskAt`: `actionFor` +
	 * `approvalTarget`, the one predicate), or null while the fleet source loads and whenever the viewer cannot give the approval.
	 * Why no existing component fits: FleetGate installs the source but draws a page skeleton; these two pages own their loading
	 * states, so it is mounted `bare`. Reference regions: Home's ask card (word "Needs your approval", `.btn-primary`/`ApproveButton`).
	 */
	import type { Snippet } from 'svelte';
	import FleetGate from './FleetGate.svelte';
	import { approvalAskAt, type ApprovalTarget } from './data';

	let { href, children: page }: { href: string; children: Snippet<[ApprovalTarget | null]> } = $props();
</script>

<FleetGate bare>
	{#snippet children(ready: boolean)}
		{@render page(ready ? approvalAskAt(href) : null)}
	{/snippet}
</FleetGate>
