<script lang="ts">
	/**
	 * A KIND MARK (changedetail-10 CF8) — what KIND of thing a History / Commits row is, drawn at the product's 16px mark size: a ring in the neutral
	 * ink around a 12px outline glyph (the Merged mark's drawing). Healthy rows spend no hue (the state marks keep it: failed, held, checking, deploying).
	 * ROLE: calm and quiet changes have no adverse state, so the spine and the builds would be a column of 6px dots (a log); a kind glyph gives each row
	 * its meaning at a glance (merged / went live / deployed / rolled back / a build). REFERENCE: the tab's History rows lead with an icon per kind.
	 * `ok` = a place that runs the change: the Places rows' "Live" (a check in the ring; the tab's pipeline draws a finished step the same way). WHY NOT StatusMark: it is the state of a place (its healthy form is the rest dot); this is the kind of event, which has no state.
	 */
	import { CheckOutline, CodeMergeOutline, UndoOutline, FlagOutline, ArrowUpFromBracketOutline, CubesStackedOutline, FileCodeOutline } from 'flowbite-svelte-icons';
	let { kind, label = '' }: { kind: 'ok' | 'merge' | 'live' | 'deploy' | 'rollback' | 'build' | 'commit'; label?: string } = $props();
</script>

<span class="ck inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface text-fg-muted" role="img" aria-label={label || kind} data-kind-mark={kind}>
	{#if kind === 'merge'}<CodeMergeOutline class="h-3 w-3" aria-hidden="true" />
	{:else if kind === 'rollback'}<UndoOutline class="h-3 w-3" aria-hidden="true" />
	{:else if kind === 'live'}<FlagOutline class="h-3 w-3" aria-hidden="true" />
	{:else if kind === 'ok'}<CheckOutline class="h-3 w-3" aria-hidden="true" />
	{:else if kind === 'commit'}<FileCodeOutline class="h-3 w-3" aria-hidden="true" />
	{:else if kind === 'build'}<CubesStackedOutline class="h-3 w-3" aria-hidden="true" />
	{:else}<ArrowUpFromBracketOutline class="h-3 w-3" aria-hidden="true" />{/if}
</span>

<style>
	.ck { box-shadow: inset 0 0 0 1.5px var(--k-fg-subtle), 0 0 0 3px var(--k-surface) !important; }
	.ck :global(svg) { box-shadow: none !important; }
</style>
