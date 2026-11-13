<svelte:options runes={true} />

<script lang="ts">
	/**
	 * r34 r3-approve — THE APPROVE BUTTON of every list, row and card that used to link "Review approval ›" to the rollout's Gates tab.
	 * It acts in place: press -> the shared confirm (`ApprovalLayer`) -> optimistic grant. `class` is the surface's own `.btn` recipe
	 * (a row's `btn btn-secondary btn-xs`, a lead's `btn btn-primary btn-sm`); the label is always "Approve". With no target (nothing on
	 * the model waits there) it falls back to the old link to the Gates tab, so the control never vanishes. Banners and slipways, which
	 * take an `Act`, use `approveAct()` from approvals.svelte.ts instead.
	 */
	import { CheckOutline } from 'flowbite-svelte-icons';
	import { askApprove } from './approvals.svelte';
	import type { ApprovalTarget } from './data';

	let { target, fallbackHref, class: cls = 'btn btn-secondary btn-xs', icon = false, title, scope = false }: { target: ApprovalTarget | null; fallbackHref?: string; class?: string; icon?: boolean; title?: string; scope?: boolean } = $props();
	/** `scope`: on a single place's own page (banner, Gates tile) the one click approves every folded region, so the button says so: "Approve all" (a list row's folded label already names the count). The count lives in the title and aria-label: "Approve c0d3e88 in all 5 regions". */
	const folded = $derived(scope && !!target && target.count > 1);
	const label = $derived(folded ? 'Approve all' : 'Approve');
</script>

{#if target}
	<button type="button" class="{cls} relative z-[1]" data-action="approve" data-approve-open data-href="{target.href.replace(/\/$/, '')}/gates" title={title ?? (folded ? `Approve ${target.build} in all ${target.count} regions` : undefined)} aria-label={folded ? `Approve ${target.build} in all ${target.count} regions` : `Approve ${target.build} in ${target.where}`} onclick={(e) => askApprove(target, e)}>{#if icon}<CheckOutline class="h-4 w-4 shrink-0" aria-hidden="true" />{/if}{label}</button>
{:else if fallbackHref}
	<a href={fallbackHref} class="{cls} relative z-[1]" data-action="approve" {title}>{#if icon}<CheckOutline class="h-4 w-4 shrink-0" aria-hidden="true" />{/if}Approve</a>
{/if}
