<svelte:options runes={true} />

<script lang="ts">
	/**
	 * WHAT AN AUTOMATIC ROLLBACK DID, READ AT A GLANCE (auto-rollback preview).
	 * Role: the body of every rollback banner, laid out by `GlanceSplit` so every glance banner splits at the same width.
	 * Main: chip row drawing the shaped fact (`failed build → running build`), at most one short line, then the banner's
	 * own action. Record: one compact row per check or test (glyph, name, verdict chip), at most 3, then "+N more" to
	 * History; beside the main column on a wide banner, behind an `N failures` toggle on a narrow one. No sentences.
	 * Owner rule (2026-11-26, glanceable UI): headline + one line of 12 words or fewer, facts drawn as chips and arrows,
	 * one word per state, each fact once. No "Held" chip: the owner ruled it says nothing; the line says what the hold does.
	 * Shared with the rollback-dependency banners: any rows go in the record.
	 * Built from: `GlanceSplit`, `Chip` (`issue` = failed, `ready` = running, `unranked` = neutral) and `CheckGlyph`.
	 */
	import type { Snippet } from 'svelte';
	import { ArrowRightOutline } from 'flowbite-svelte-icons';
	import Chip from './Chip.svelte';
	import CheckGlyph from './CheckGlyph.svelte';
	import GlanceSplit from './GlanceSplit.svelte';
	import { countLabel } from '$lib/disclosure';
	import type { GlanceRow } from '$lib/view-models/auto-rollback';

	type State = { role: 'issue' | 'unranked' | 'ready'; label: string; title?: string };

	let {
		from = null,
		to = null,
		states = [],
		line = '',
		rows = [],
		noun = 'failure',
		moreHref = null,
		actions
	}: {
		/** the build that failed (drawn `Failed · <build>`) */
		from?: string | null;
		/** the build running now (drawn `Running · <build>` after an arrow) */
		to?: string | null;
		/** one word each, only where the word says what is happening */
		states?: State[];
		/** at most one short line (12 words or fewer) */
		line?: string;
		/** the record's rows, any source (verdicts here, dependency breaks for #207) */
		rows?: GlanceRow[];
		/** what one row is, for the narrow toggle's count (`2 failures`) */
		noun?: string;
		/** where "+N more" goes */
		moreHref?: string | null;
		/** the banner's own action, under the line */
		actions?: Snippet;
	} = $props();

	const MAX = 3;
	const TONE = { danger: 'text-danger', muted: 'text-fg-subtle', neutral: 'text-fg-muted' } as const;
</script>

{#snippet main()}
	<div class="flex min-w-0 flex-col gap-1.5" data-rollback-glance>
		{#if from || to || states.length > 0}
			<div class="flex min-w-0 flex-wrap items-center gap-1.5" data-glance-chips>
				{#if from}<Chip role="issue" label="Failed" value={from} valueIsBuild={false} />{/if}
				{#if from && to}<ArrowRightOutline class="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-label="replaced by" />{/if}
				{#if to}<Chip role="ready" label="Running" value={to} valueIsBuild={false} />{/if}
				{#each states as s (s.label)}<Chip role={s.role} label={s.label} title={s.title} wide />{/each}
			</div>
		{/if}
		{#if line}<p class="min-w-0 text-fg [overflow-wrap:anywhere]" data-glance-line>{line}</p>{/if}
		{#if actions}<div class="mt-1.5">{@render actions()}</div>{/if}
	</div>
{/snippet}

{#snippet record()}
	<ul class="flex min-w-0 flex-col gap-1.5" data-glance-rows>
		{#each rows.slice(0, MAX) as r (r.key)}
			<li class="grid grid-cols-[14px_minmax(0,max-content)_auto] items-center justify-start gap-x-2" title={r.title}>
				<CheckGlyph cls={r.cls} class="{TONE[r.tone]} h-3.5 w-3.5" />
				<span class="t-code-sm min-w-0 truncate text-fg">{r.name}</span>
				<Chip role={r.tone === 'danger' ? 'issue' : 'unranked'} label={r.verdict} />
			</li>
		{/each}
		{#if rows.length > MAX}
			<li class="pl-[22px]">
				{#if moreHref}<a class="nav-link t-meta" href={moreHref}>+{rows.length - MAX} more</a>{:else}<span class="t-meta text-fg-muted">+{rows.length - MAX} more</span>{/if}
			</li>
		{/if}
	</ul>
{/snippet}

<GlanceSplit {main} aside={rows.length > 0 ? record : undefined} toggleLabel={countLabel(rows.length, noun)} />
