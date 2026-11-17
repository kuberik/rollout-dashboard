<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A PENDING CHECK WITH NO OBSERVATION, in a History row's evidence column: the same block `FailureSourceRow` forms for a check that has
	 * observations. Role: name, state word in state ink, `· HH:MM`, then the provider's own message as the evidence line (13px, the class
	 * glyph in state ink). Why not `FailureSourceRow`: it names the observation, and a check that cannot evaluate has none, only a message.
	 * Proportions borrowed from the History check block beside it (14px name, `t-meta` fact line, 14px glyph column).
	 */
	import CheckGlyph from './CheckGlyph.svelte';

	let { name, cls, message, time }: { name: string; cls?: string; message?: string; time?: string | null } = $props();
</script>

<div data-testid="hist-check" data-state="pending">
	<div class="mb-1.5 flex flex-wrap items-baseline gap-x-2">
		<span class="t-body text-fg">{name}</span>
		<span class="t-meta"><span class="text-progress">pending</span>{#if time}<span class="text-fg-muted tabular-nums">{' · '}{time}</span>{/if}</span>
	</div>
	{#if message}
		<ul class="flex flex-col gap-3">
			<li class="grid grid-cols-[14px_minmax(0,1fr)] items-baseline gap-x-2" data-testid="failure-source" data-state="pending">
				<CheckGlyph {cls} class="text-progress h-3.5 w-3.5 translate-y-0.5" />
				<span class="t-meta text-fg-muted [overflow-wrap:anywhere]">{message}</span>
			</li>
		</ul>
	{/if}
</div>
