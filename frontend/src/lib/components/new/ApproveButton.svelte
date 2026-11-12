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
	/** `scope`: on a single place's own page (banner, Gates tile) the one click approves every folded region, so the button says so: "Approve all 5 regions" (a list row's folded label already names the count). */
	const label = $derived(scope && target && target.count > 1 ? `Approve all ${target.count} regions` : 'Approve');
</script>

{#if target}
	<button type="button" class="{cls} relative z-[1]" data-action="approve" data-approve-open data-href="{target.href.replace(/\/$/, '')}/gates" {title} aria-label="Approve {target.build} in {target.where}" onclick={(e) => askApprove(target, e)}>{#if icon}<CheckOutline class="h-4 w-4 shrink-0" aria-hidden="true" />{/if}{label}</button>
{:else if fallbackHref}
	<a href={fallbackHref} class="{cls} relative z-[1]" data-action="approve" {title}>{#if icon}<CheckOutline class="h-4 w-4 shrink-0" aria-hidden="true" />{/if}Approve</a>
{/if}
