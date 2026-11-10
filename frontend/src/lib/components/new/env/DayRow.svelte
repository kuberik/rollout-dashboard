<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A DAY ROW (r39, owner-approved: concept A's deploy list inside body B): one deploy that reached this environment today.
	 * ROLE: "what changed here today". No existing row fits: StrandRow is one rollout's CURRENT state with a strand; this is an event.
	 * Borrows StrandRow's quiet geometry (the list card's 16px gutter, 1px hairline between rows, status track 16 · name · sentence · age at
	 * the same x in every row) and the rollout tab's History ledger vocabulary (what, who, when). A failed deploy is the one red row.
	 * PHONE (< 600px of the card): app · age on line 1, the change on line 2, the person on line 3.
	 */
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import DeployMark from '$lib/components/DeployMark.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import type { DayRow } from './env-page';

	let { row }: { row: DayRow } = $props();
</script>

<li class="dr tap-zone" data-day-row data-kind={row.kind}>
	<div class="dr-in">
		<span class="dr-mk">{#if row.kind === 'failed'}<StatusMark state="failed" />{:else}<span class="dr-dot" aria-hidden="true"></span>{/if}</span>
		<div class="dr-id">
			<AppGlyph name={row.app} size={20} />
			<a href={row.href} class="tap-link dr-nm">{row.app}</a>
			{#if row.place}<span class="dr-pl t-meta">{row.place}</span>{/if}
		</div>
		<p class="dr-what">
			{#if row.kind === 'failed'}<span class="dr-w text-danger">Failed</span>{:else if row.kind === 'rolledBack'}<span class="dr-w">Rolled back</span>{/if}
			{#if row.title}{row.title}<span class="dr-ref t-code-sm">{row.build}</span>{:else}{#if row.kind === 'deploy'}<span class="dr-w">Build</span>{/if}<span class="dr-ref first t-code-sm">{row.build}</span>{/if}{#if row.mark}<span class="dr-man"><DeployMark mark={row.mark} /></span>{/if}
		</p>
		<span class="dr-who t-meta">{row.who}</span>
		{#if row.reason}<p class="dr-reason t-meta" data-deploy-reason><span class="text-fg-subtle">Reason</span> {row.reason}</p>{/if}
		<span class="dr-age t-meta">{row.age}</span>
	</div>
</li>

<style>
	.dr { position: relative; padding: 0 16px; min-width: 0; }
	.dr:hover { background: var(--k-hover); }
	.dr-in { display: grid; grid-template-columns: 16px minmax(10rem, 14rem) minmax(0, 1fr) minmax(5rem, 9rem) 2.5rem; column-gap: 16px; align-items: center; min-height: 48px; padding: 8px 0; border-top: 1px solid var(--k-line-subtle); box-sizing: border-box; }
	:global(.lc-rows > .dr:first-child) .dr-in { border-top: 0; }
	.dr-mk { display: grid; place-items: center; width: 16px; }
	.dr-dot { width: 6px; height: 6px; border-radius: 9999px; background: var(--k-fg-disabled); }
	.dr-id { display: flex; align-items: center; gap: 8px; min-width: 0; }
	.dr-nm { font-size: 14px; line-height: 20px; font-weight: 600; letter-spacing: -0.004em; color: var(--k-fg); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.dr-nm:hover { text-decoration: underline; }
	.dr-pl { color: var(--k-fg-subtle); white-space: nowrap; }
	.dr-what { font-size: 14px; line-height: 20px; color: var(--k-fg-muted); margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.dr-w { font-weight: 500; margin-right: 8px; }
	.dr-ref { color: var(--k-fg-subtle); margin-left: 8px; }
	.dr-ref.first { margin-left: 0; }
	.dr-who { color: var(--k-fg-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.dr-man { color: var(--k-fg-subtle); margin-left: 8px; }
	.dr-reason { grid-column: 3; grid-row: 2; margin: 0; color: var(--k-fg-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.dr-who { grid-column: 4; grid-row: 1; }
	.dr-age { grid-column: 5; grid-row: 1; color: var(--k-fg-subtle); text-align: right; font-variant-numeric: tabular-nums; }
	@container (max-width: 700px) {
		.dr-in { grid-template-columns: 16px minmax(0, 1fr) auto; row-gap: 2px; padding: 12px 0; }
		.dr-mk { align-self: start; margin-top: 2px; }
		.dr-id { grid-column: 2; }
		.dr-age { grid-column: 3; grid-row: 1; }
		.dr-what { grid-column: 2 / 4; grid-row: 2; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
		.dr-who { grid-column: 2 / 4; grid-row: 3; }
		.dr-reason { grid-column: 2 / 4; grid-row: 4; white-space: normal; }
	}
</style>
