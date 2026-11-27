<script lang="ts">
	/**
	 * Role: the action row of the rollout Overview's blocked banner: the Gates link and the viewer's Approve slot (batch4 b4-49).
	 * No existing component fits: it is the one place a button slot is RESERVED while the ask loads and COLLAPSES when the
	 * viewer cannot approve. The slot is therefore LAST in the DOM, after the Gates link: in the stacked (phone) shape the row
	 * is start-justified, so a collapse removes only empty trailing space and Gates stays put. From 640px of the banner the
	 * actions are `Banner`'s right-hand column, where the primary is the rightmost control on every banner (banners system,
	 * 2026-11-27): Approve (or its reserved 104px slot while the ask loads) ends the row, Gates sits left of it.
	 * Proportions borrowed from the Home lead row (`btn-sm` + `nav-link`).
	 */
	import { fade } from 'svelte/transition';
	import { ChevronRightOutline } from 'flowbite-svelte-icons';
	import ApproveButton from './ApproveButton.svelte';
	import type { ApprovalTarget } from './data';

	let { state: slotState, ask, gatesHref }: { state: 'approve' | 'reserved' | 'none'; ask: ApprovalTarget | null | unknown; gatesHref: string } = $props();
</script>

<a href={gatesHref} class="nav-link" data-gates-link>
	Gates
	<ChevronRightOutline class="h-3 w-3" />
</a>
{#if slotState === 'approve' && typeof ask === 'object' && ask}
	<span in:fade={{ duration: 150 }}><ApproveButton target={ask as ApprovalTarget} class="btn btn-primary btn-sm" icon scope /></span>
{:else if slotState === 'reserved'}
	<span class="inline-block h-8 w-[104px]" aria-hidden="true" data-approve-slot></span>
{/if}
