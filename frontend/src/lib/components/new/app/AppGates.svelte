<script lang="ts">
	import SkeletonBar from '$lib/components/skeleton/SkeletonBar.svelte';
	/**
	 * r34 v2 r2 AD — THE HOLDING CARD OF AN APP ("Holding", rail of /apps/<name>): this app's OWN gates, approvals included,
	 * each once: its places, the builds it holds, who or what releases it. ROLE: answers "what is holding this app's builds and
	 * who clears it". WHY NOT HoldingCard: that card lists one cause per FLEET and by rule excludes approvals (an approval is a
	 * row with an Approve action on the list pages); an app's page is the one place a person asks about THIS app's approval gate,
	 * and HoldingCard's rows cannot carry held builds or the releaser. PROPORTIONS borrowed from HoldingCard (mark · linked title ·
	 * t-meta lines, py-3 rows on divide-line-subtle, 47px header with the rollup) and the Gates tab ("1 of 5 gates holding").
	 * The health hold (a failing check holds the newer builds behind a failed place) is the last row, so the header's
	 * "held by health checks in eu-west" and this card agree. Lineage: HoldingCard (r34), forked for the detail page.
	 */
	import { LockOutline, ArrowUpRightFromSquareOutline, ChevronDownOutline } from 'flowbite-svelte-icons';
	import Card from '$lib/components/Card.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import HeldGlyph from '$lib/components/HeldGlyph.svelte';
	import { plural } from '../rollout-view';
	import type { HoldRow } from './app-model';

	let { rows }: { rows: HoldRow[] } = $props();
	/* AA7: the card lists what HOLDS (a passing gate is the Gates tab's row, not this card's), so "N holding" is its row count; the held builds are counted ("holds 2 builds"), never listed: the Builds card lists them (AP13) */
	const holding = $derived(rows.filter((r) => r.holding));
	let shown = $state(new Set<string>());
	const flip = (k: string) => { const n = new Set(shown); if (n.has(k)) n.delete(k); else n.add(k); shown = n; };
	const DOCS = 'https://docs.kuberik.com/concepts/gates#approvals';
</script>

<Card icon={LockOutline} title="Holding" padded={false}>
	{#snippet rollup()}<span class="t-ui-sm tabular-nums text-fg-subtle">{holding.length ? `${holding.length} holding` : 'Nothing held'}</span>{/snippet}
	{#if holding.length}
		<ul class="divide-y divide-line-subtle">
			{#each holding as r (r.key)}
				{@const isOpen = shown.has(r.key)}
				<li class="tap-zone px-4 py-3 hover:bg-hover" data-truth-kind="hold" data-truth-gate={r.name} data-truth-holding={r.holding} data-truth-places={r.places.join(',')} data-truth-held={r.held.join(',')}>
					<!-- owner §5: ONE entry = cause · where · what it holds (2 lines); the sentence and the way to approve are behind the chevron -->
					<div class="flex items-start gap-3">
						<span class="flex h-5 w-4 shrink-0 items-center justify-center">
							{#if r.kind === 'approval'}<StatusMark state="approval" />{:else if r.kind === 'health'}<StatusMark state="failed" />{:else}<HeldGlyph size={16} class="text-fg-muted" title="Held" />{/if}
						</span>
						<div class="min-w-0 flex-1">
							<a href={r.href} class="tap-link t-ui break-words text-fg hover:underline">{r.name}</a>
							<!-- apps-9 AQ9: places are a dot strip (one dot per place, state-tinted: P8 anchor), the builds it holds the figure at the right; names wait behind the chevron -->
							<p class="t-meta flex items-center gap-2 text-fg-subtle">
								<span class="h-1.5 w-1.5 shrink-0 rounded-full {r.kind === 'approval' ? 'bg-held-solid' : r.kind === 'health' ? 'bg-danger-solid' : 'bg-fg-subtle'}" aria-hidden="true"></span>
								<span class="whitespace-nowrap">{plural(r.places.length, 'place')}</span>
								{#if r.pending}<span class="ml-auto shrink-0" data-held-pending aria-hidden="true"><SkeletonBar width="w-14" height="h-3.5" /></span>{:else if r.held.length}<span class="ml-auto shrink-0 whitespace-nowrap tabular-nums text-fg-muted">{plural(r.held.length, 'build')}</span>{/if}
							</p>
						</div>
						<button type="button" class="relative z-[1] flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-subtle hover:bg-hover hover:text-fg max-sm:h-11" aria-expanded={isOpen} aria-label="{isOpen ? 'Hide' : 'Show'} details of {r.name}" onclick={() => flip(r.key)}><ChevronDownOutline class="h-4 w-4 transition-transform {isOpen ? 'rotate-180' : ''}" aria-hidden="true" /></button>
					</div>
					{#if isOpen}
						<div class="mt-1 pl-7">
							<p class="t-meta text-fg-subtle">{r.places.join(', ')}</p>
							<p class="t-meta mt-1 text-fg-subtle">{r.sentence}</p>
							{#if r.kind === 'approval'}<a href={DOCS} target="_blank" rel="noreferrer" class="btn btn-xs btn-secondary relative z-[1] mt-2 max-sm:min-h-11">How to approve<ArrowUpRightFromSquareOutline /></a>{/if}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</Card>
