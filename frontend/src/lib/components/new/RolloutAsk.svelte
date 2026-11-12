<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE VIEWER'S APPROVAL ASK AT ONE ROLLOUT PAGE (the rollout detail's held banner and the Gates tab's holding card).
	 * Role: hand the page the same `ApprovalTarget` Home, /apps and /envs offer for this place (data.ts `approvalAskAt`: `actionFor` +
	 * `approvalTarget`, the one predicate), `ASK_LOADING` while the fleet source loads (the page reserves the button's slot, see `askView`), null whenever the viewer cannot give the approval.
	 * Why no existing component fits: FleetGate installs the source but draws a page skeleton; these two pages own their loading
	 * states, so it is mounted `bare`. Reference regions: Home's ask card (word "Needs your approval", `.btn-primary`/`ApproveButton`).
	 */
	import type { Snippet } from 'svelte';
	import FleetGate from './FleetGate.svelte';
	import { approvalAskAt, type ApprovalTarget } from './data';
	import { createQuery } from '@tanstack/svelte-query';
	import { ASK_LOADING } from './state-words';
	import { rolloutPermissionsQueryOptions } from '$lib/api/rollouts';
	import { rolloutOfHref } from '$lib/api/approvals';

	let { href, children: page }: { href: string; children: Snippet<[ApprovalTarget | typeof ASK_LOADING | null]> } = $props();
	/** PERMISSION: `permissions.approve === false` (SelfSubjectAccessReview `create rolloutapprovals`) means the viewer cannot give the approval: no ask, the page prints its plain hold words. Unknown (loading, an older backend without the field) keeps the ask; the server still answers 403. */
	const at = $derived(rolloutOfHref(href.replace(/^\/?/, '/')));
	const permissions = createQuery(() => ({ ...rolloutPermissionsQueryOptions({ namespace: at?.namespace ?? '', name: at?.name ?? '', cluster: at?.cluster }), enabled: !!at }));
	const cannotApprove = $derived(permissions.data?.permissions?.approve === false);
</script>

<FleetGate bare>
	{#snippet children(ready: boolean)}
		{@render page(ready ? (cannotApprove ? null : approvalAskAt(href)) : ASK_LOADING)}
	{/snippet}
</FleetGate>
