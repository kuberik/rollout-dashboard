<svelte:options runes={true} />

<script lang="ts">
	/**
	 * DEPENDENCY LANES, PHONE (< 640px container) — the /dependencies map's phone form (take B): blocker trees + line map.
	 * Picked over a rank/gutter-graph form (deps-b-phone option A, shots/b-phone/option-a-*) because it answers the
	 * operator's first three questions in the first viewport, drawn.
	 *
	 * ROLE: the phone tells the blocker story first, drawn: one block per blocker (ranked by how many it frees), the
	 * blocker and every deploy it holds as an indented tree with elbows, each held relationship said once on its
	 * branch ("needs payments ~2.9.0 · has 2.4.1"), regions folded into one branch with an unfold. Under it the full
	 * map, quiet: one promotion line per service across columns that line up with the environment heads, so the
	 * phone keeps the desktop matrix's columns at 80px each.
	 *
	 * PROPORTIONS: GitHub Actions' phone job list and its matrix fold (REFS §1, §3, §10), the tree elbows of its
	 * nested jobs; the line map is the desktop lanes' columns with the cell reduced to its mark + build. A stop opens
	 * `DependencyCellSheet` (needs / serves / path / regions / Open), so a clear link's contract is one tap away too.
	 * The page hides its "Unblocks the most" rail card below 640: this form draws that card's content as trees.
	 */
	import { ChevronDownOutline, ChevronUpOutline } from 'flowbite-svelte-icons';
	import StatusMark from './StatusMark.svelte';
	import HeldGlyph from './HeldGlyph.svelte';
	import Chip from './Chip.svelte';
	import DependencyCellSheet from './DependencyCellSheet.svelte';	import ShareNodesSolid from 'flowbite-svelte-icons/ShareNodesSolid.svelte';
	import { href } from '$lib/paths';
	import { getRolloutEnvironmentTheme } from '$lib/environment-theme';
	import { NO_ENV, ageOf, regionShare, holdWord, type LaneCell, type LaneLink, type LaneModel } from '$lib/view-models/dependency-lanes';
	import { blockerTree, needPhrase, promotionPath, type TreeNode } from '$lib/view-models/dependency-lanes-phone';

	let {
		model,
		focus = null,
		parts = 'all'
	}: {
		model: LaneModel;
		focus?: Set<string> | null;
		/** 'all' = phone (trees over the line map). On a laptop wrap (R3-DES-B-1) the page splits them: 'map' in the main card,
		 *  'trees' in the ~300px rail card, which brings its own Card header (so the trees drop theirs). */
		parts?: 'all' | 'trees' | 'map';
	} = $props();

	let now = $state(new Date());
	let sheet = $state<LaneCell | null>(null);
	const colLabel = (c: string) => (c === NO_ENV ? 'no environment' : c);
	const rolloutHref = (c: LaneCell) =>
		c.nodes.length === 1
			? href(`/rollouts/${c.nodes[0].cluster}/${c.nodes[0].namespace}/${c.nodes[0].name}`)
			: href(`/apps/${c.service}`);
	const lit = (c: LaneCell) => !focus || c.nodes.some((n) => focus!.has(n.id));
	const trees = $derived(model.blockers.map((b) => ({ b, t: blockerTree(model, b) })));

	let unfolded = $state(new Set<string>());
	function toggle(k: string) {
		const n = new Set(unfolded);
		if (n.has(k)) n.delete(k);
		else n.add(k);
		unfolded = n;
	}

	let mapW = $state(0);
	const n = $derived(model.columns.length);
	const colX = (i: number) => ((i + 0.5) * mapW) / Math.max(1, n);
</script>

{#snippet sites(c: LaneCell)}
	<ul class="mt-1 mb-2 divide-y divide-line-subtle rounded-md border border-line-subtle">
		{#each c.sites as s (s.node.id)}
			<li>
				<a href={href(`/rollouts/${s.node.cluster}/${s.node.namespace}/${s.node.name}`)} class="flex min-h-10 items-center gap-2 px-3">
					<span class="t-meta min-w-0 truncate text-fg">{s.site}</span>
					<span class="t-code-sm ml-auto shrink-0 text-fg-muted">{s.node.build ?? '—'}</span>
					<span class="w-3 shrink-0">{#if s.held}<HeldGlyph size={12} class="text-held" title={s.reason ?? 'Held'} />{/if}</span>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet branch(node: TreeNode, parent: LaneCell)}
	{@const c = node.cell}
	{@const multi = c.sites.length > 1}
	{@const open = unfolded.has(c.key)}
	{@const age = node.via?.since ? ageOf(node.via.since, now) : null}
	<li class="branch" class:dim={!lit(c)} data-branch={c.key}>
		<div class="tap-zone node-row relative flex min-h-10 min-w-0 items-center gap-2" class:has-kids={node.children.length > 0}>
			<StatusMark state={c.held ? 'held' : 'newest'} />
			<a href={rolloutHref(c)} class="tap-link t-ui min-w-0 truncate font-medium text-fg">{c.service}</a>
			{#if c.col !== parent.col || c.service === parent.service}<span class="t-meta shrink-0 text-fg-subtle">{colLabel(c.col)}</span>{/if}
			{#if multi}
				<button type="button" class="unfold t-ui-sm ml-auto flex min-h-10 shrink-0 items-center gap-1 text-held" aria-expanded={open} onclick={() => toggle(c.key)} data-unfold={c.key}>
					{node.via ? regionShare(node.via.heldCount, c.sites.length) : `${c.sites.length} regions`}
					{#if open}<ChevronUpOutline class="h-3.5 w-3.5" />{:else}<ChevronDownOutline class="h-3.5 w-3.5" />{/if}
				</button>
			{/if}
		</div>
		<div class="stem" class:stem--line={node.children.length > 0}>
			{#if node.via}
				{@const p = node.via.kind === 'contract' ? needPhrase(node.via) : null}
				<p class="fact t-meta -mt-2 flex min-w-0 items-baseline gap-3 pb-1 text-held">
					<span class="min-w-0">
						{#if p}
							<span class="unit">{p.need}</span>{#if p.minority}{' '}<span class="unit">({p.minority})</span>{/if}{#if p.has}{' '}<span class="unit">· {p.has}</span>{/if}
						{:else}
							<span class="unit">waits for {colLabel(parent.col)}</span>
						{/if}
					</span>
					<span class="age ml-auto shrink-0 tabular-nums text-fg-subtle">{age ?? ''}</span>
				</p>
			{/if}
			{#if multi && open}{@render sites(c)}{/if}
		</div>
		{#if node.children.length}
			<ul class="tree">
				{#each node.children as k (k.cell.key)}{@render branch(k, c)}{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<div class={parts === 'trees' ? '' : '-mx-4 -mb-4'} data-lanes-phone="b">
	{#if trees.length && parts !== 'map'}
		<section data-phone-blockers>
			{#if parts !== 'trees'}<header class="flex h-10 items-center gap-2 px-4">
				<HeldGlyph size={16} class="text-held" />
				<span class="t-ui-sm font-semibold text-fg">Unblocks the most</span>
				<span class="t-meta ml-auto tabular-nums text-held">{trees.length} blocker{trees.length === 1 ? '' : 's'}</span>
			</header>{/if}
			{#each trees as { b, t }, i (b.node.id)}
				{@const age = ageOf(b.since, now)}
				<div class="border-line-subtle px-4 pt-2 pb-3" class:border-t={parts !== 'trees' || i > 0} class:dim={!lit(b.cell)} data-blocker={b.node.name}>
					<div class="node-row relative flex min-h-10 min-w-0 items-center gap-2" class:has-kids={t.children.length > 0}>
						<StatusMark state={b.node.blocked ? 'held' : 'newest'} />
						<span class="t-card-title min-w-0 truncate text-fg">{b.node.name}</span>
						<span class="t-meta shrink-0 text-fg-subtle">{colLabel(b.cell.col)}</span>
						<a href={href(`/rollouts/${b.node.cluster}/${b.node.namespace}/${b.node.name}`)} class="nav-link ml-auto min-h-10 shrink-0 !py-0">Open ›</a>
					</div>
					<div class="stem" class:stem--line={t.children.length > 0}>
						<p class="fact t-meta -mt-2 flex min-w-0 items-baseline gap-3 pb-1 text-fg-muted">
							<span class="min-w-0"><span class="unit">{b.why}</span>{' '}<span class="unit tabular-nums text-held">· frees {b.frees.length}</span></span>
							<span class="age ml-auto shrink-0 tabular-nums text-fg-subtle">{age ?? ''}</span>
						</p>
					</div>
					<ul class="tree">
						{#each t.children as k (k.cell.key)}{@render branch(k, b.cell)}{/each}
					</ul>
				</div>
			{/each}
		</section>
	{/if}

	{#if parts !== 'trees'}
	<section class="border-t border-line" class:border-t-0={!trees.length || parts === 'map'} data-phone-map>
		<header class="flex h-10 items-center gap-2 px-4">
			<ShareNodesSolid class="h-4 w-4 text-fg-subtle" />
			<span class="t-ui-sm font-semibold text-fg">Every service</span>
			<span class="t-meta ml-auto tabular-nums text-fg-subtle">{model.rows.length} services</span>
		</header>
		<div class="px-4">
			<div class="relative h-8" bind:clientWidth={mapW}>
				{#each model.columns as col, i (col.key)}
					<div class="absolute top-1 flex -translate-x-1/2 justify-center" style="left: {colX(i)}px">
						{#if col.key !== NO_ENV}
							<Chip role="env" theme={getRolloutEnvironmentTheme(null, col.key)} label={col.key} />
						{:else}
							<span class="t-label text-fg-muted">none</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
		<ul>
			{#each model.rows as row, ri (row.service)}
				{@const path = promotionPath(model, row.service)}
				{@const anyHeld = path.some((s) => s.cell.held)}
				{@const worded = path.some((s) => s.cell.held && holdWord(s.cell.reason))}
				{@const uses = [...new Set(model.links.filter((l) => l.kind === 'contract' && path.some((s) => s.cell.key === l.to)).map((l) => model.cells.get(l.from)?.service ?? ''))]}
				<li class="px-4 py-2" class:border-t={ri > 0} class:border-line-subtle={ri > 0} class:group-start={ri > 0 && row.group !== model.rows[ri - 1].group} class:dim={focus && !path.some((s) => lit(s.cell))} data-map-row={row.service}>
					<div class="flex min-w-0 items-baseline gap-2">
						<a href={href(`/apps/${row.service}`)} class="t-ui max-w-[70%] shrink-0 truncate font-medium text-fg">{row.service}</a>
						{#if row.provides.length}<span class="t-meta ml-auto min-w-0 truncate text-fg-subtle">serves {row.provides.join(', ')}</span>{:else if uses.length}<span class="t-meta ml-auto min-w-0 truncate text-fg-subtle">uses {uses.join(', ')}</span>{/if}
					</div>
					<div class="relative mt-1" class:h-10={!worded} class:h-14={worded}>
						<svg class="absolute inset-x-0 top-0 overflow-visible" width={mapW} height="16" aria-hidden="true">
							{#each path as s, i (s.cell.key)}
								{#if i > 0}
									{@const a = model.columns.findIndex((c) => c.key === path[i - 1].col)}
									{@const z = model.columns.findIndex((c) => c.key === s.col)}
									<path d="M{colX(a) + 10},8 H{colX(z) - 10}" class="seg" class:seg--held={!!s.link?.held} />
								{/if}
							{/each}
						</svg>
						{#each path as s (s.cell.key)}
							{@const z = model.columns.findIndex((c) => c.key === s.col)}
							<button
								type="button"
								class="stop absolute top-0 flex -translate-x-1/2 flex-col items-center" class:h-10={!worded} class:h-14={worded}
								style="left: {colX(z)}px; width: {mapW / Math.max(1, n) - 4}px"
								aria-haspopup="dialog"
								aria-label="{row.service} in {colLabel(s.col)}{s.cell.reason ? `, held: ${s.cell.reason}` : ''}"
								onclick={() => { now = new Date(); sheet = s.cell; }}
								data-stop={s.cell.key}
							>
								<StatusMark state={s.cell.held ? 'held' : 'newest'} />
								<span class="t-code-sm mt-0.5 max-w-full truncate {s.cell.held ? 'text-held' : 'text-fg-muted'}">
									{s.cell.sites.length > 1 ? `${s.cell.sites.length} regions` : (s.cell.build ?? 'no build')}
								</span>
								<!-- a hold that is not another deploy says its word (R2-DES-B-5): the orange mark alone read as a dependency hold
								     under a header saying none is. The word, not a new mark: "approval" / "pinned" is what the desktop cell says. -->
								{#if s.cell.held && holdWord(s.cell.reason)}
									<span class="t-meta leading-4 text-fg-subtle" data-hold-word>{holdWord(s.cell.reason)}</span>
								{/if}
							</button>
						{/each}
					</div>
				</li>
			{/each}
		</ul>
	</section>
	{/if}
</div>

<DependencyCellSheet {model} cell={sheet} {now} onclose={() => (sheet = null)} />

<style>
	.dim {
		opacity: 0.22;
	}
	/* tree: elbows from the parent's mark down to each child's mark (held links only, so held ink) */
	.tree {
		position: relative;
		margin-left: 7px;
	}
	.branch {
		position: relative;
		padding-left: 16px;
	}
	.branch::before {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		width: 12px;
		height: 20px;
		border-left: 1.5px solid var(--color-held);
		border-bottom: 1.5px solid var(--color-held);
		border-bottom-left-radius: 6px;
	}
	.branch:not(:last-child)::after {
		content: '';
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		border-left: 1.5px solid var(--color-held);
	}
	.node-row.has-kids::after {
		content: '';
		position: absolute;
		left: 7px;
		top: 28px;
		bottom: 0;
		border-left: 1.5px solid var(--color-held);
	}
	.stem {
		margin-left: 7px;
		padding-left: 15.5px;
		border-left: 1.5px solid transparent;
	}
	.stem--line {
		border-left-color: var(--color-held);
	}
	.unit {
		white-space: nowrap;
	}
	/* every age in a tree on one right track: same width, right-aligned, first-line baseline */
	.age {
		min-width: 2.5rem;
		text-align: right;
	}
	.unfold {
		position: relative;
		z-index: 1;
	}
	.seg {
		fill: none;
		stroke: var(--k-wire);
		stroke-width: 1;
	}
	.seg--held {
		stroke: var(--color-held);
		stroke-width: 1.5;
	}
	.group-start {
		border-top-width: 6px !important;
		border-top-color: var(--k-ground) !important;
	}
</style>
