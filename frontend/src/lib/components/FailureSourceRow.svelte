<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ONE FAILING OBSERVATION AS EVIDENCE: what was measured, the figure that failed, and the provider's own line about it.
	 * Role: a health check's failing (or still-pending, or recovered) `status.observations[]` entry, drawn identically on the
	 * rollout Overview card, in the failure banner's details and in History.
	 * Why new: `FailedCheckLine` is a `name: message` sentence with no tracks; `FactList` is a record, too tall for a list
	 * of several. Nothing on Home, /rollouts or rollout detail lists measured things with a figure.
	 * Proportions borrowed from: HealthChecksCard's own row (14px glyph column, 12px gap, `t-body`/`t-meta` pair) and
	 * AttentionCard's figure + budget line. Glyph = the check's CLASS (kustomization, datadog, prometheus, incidents),
	 * ink = state. No right column: time lives once, on the check's fact line.
	 * Never parses `name` or `message`; the message wraps and never truncates identity.
	 */
	import CheckGlyph from './CheckGlyph.svelte';
	import type { ObsRow } from '$lib/view-models/health-failures';
	import { checkNameSegments } from '$lib/view-models/health-failures';

	let { row }: { row: ObsRow } = $props();

	const ink = $derived(row.state === 'failing' ? 'text-danger' : row.state === 'pending' ? 'text-progress' : 'text-fg-subtle');
	/* identifiers (a resource, an alertname) are code; a datadog monitor's name is a sentence */
	const code = $derived(row.cls === 'kustomization' || row.cls === 'prometheus');
	/* a resource name ("orders/orders-worker") breaks only after a "/", never at a hyphen; one segment never wraps (it ellipsises, the title has the whole name) */
	const segments = $derived(code ? checkNameSegments(row.name) : null);
</script>

<!-- one shape at every width: name, the figure on its own line under it, the message under that -->
<li class="grid grid-cols-[14px_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5" data-testid="failure-source" data-state={row.state}>
	<CheckGlyph cls={row.cls} class="{ink} h-3.5 w-3.5 translate-y-0.5" />
	<span class="min-w-0 [overflow-wrap:anywhere] {code ? 't-code-sm text-fg' : 't-ui-sm font-medium text-fg'}" title={row.name}>{#if segments}{#each segments as seg, i (i)}{#if i > 0}<wbr />{/if}<span class="inline-block max-w-full overflow-hidden text-ellipsis whitespace-nowrap align-bottom" data-name-segment>{seg}</span>{/each}{:else}{row.name}{/if}</span>
	{#if row.figure}
		<span class="col-start-2 whitespace-nowrap" data-testid="failure-figure">
			<b class="t-ui-sm font-semibold tabular-nums {row.state === 'recovered' ? 'text-fg-muted' : 'text-fg'}">{row.figure.value}</b>
			{#if row.figure.note}<span class="t-meta text-fg-muted">&nbsp;{row.figure.note}</span>{/if}
		</span>
	{/if}
	{#if row.message}
		<span class="col-start-2 t-meta text-fg-muted [overflow-wrap:anywhere]">{row.message}</span>
	{/if}
</li>
