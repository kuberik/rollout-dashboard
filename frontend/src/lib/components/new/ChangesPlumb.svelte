<svelte:options runes={true} />

<script lang="ts">
	/**
	 * CHANGES · "Plumb line, with services" (gallery candidate 10b, design/visuals-r42 226ffc78, built on the product's own placement).
	 * ROLE: the Changes page's main object. Question: "where are my changes, and is anything wrong?" The stage order is drawn ONCE as a vertical
	 * line (merged -> dev -> test -> staging -> prod); each change hangs off its stop as a two-line row (title / repo #ref, age / state word).
	 * A change that ships as several services is ONE row at its least advanced service's stop (PChange.col, service-spread.ts), the state word
	 * is the worst service's with that service named; line 3 is the spread (stage + service monograms) and opens one row per service.
	 * No buttons on rows: Attention above carries Roll back / Approve for the same changes (one action, once).
	 * WHY NEW: no reference region answers "where along the pipeline is each change" as a list (RepoCards are per-repo; Rollouts is per-place).
	 * It borrows its proportions from: Card + 47px header + rollup (Home / rollout tab), the 3fr / minmax(22rem,2fr) main + side of the rollout
	 * tab, the state-words vocabulary, FilterChip for the repo filter (multi-select, no "All" chip, selection in ?repo=).
	 * "Landed" (side) = landed today + the at-rest repos, one list.
	 */
	import { RocketOutline, CheckOutline, ChevronDownOutline } from 'flowbite-svelte-icons';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Card from '$lib/components/Card.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import FilterChip from '$lib/components/FilterChip.svelte';
	import { stateWord } from './state-words';
	import { ago, type HomeState } from './data';
	import { plumbOf, serviceWord, servicesByUrgency, spreadStages, reposFromQuery, toggleRepo, type PlumbRow } from './changes-plumb';
	import type { Svc } from './change/service-spread';

	let { state: hs }: { state: HomeState } = $props();
	const known = $derived(plumbOf(hs).chips.map((c) => c.repo));
	const sel = $derived(reposFromQuery(page.url.searchParams, known));
	const P = $derived(plumbOf(hs, sel));
	const chips = $derived(plumbOf(hs).chips);

	function pick(repo: string) {
		const next = toggleRepo(sel, repo);
		const u = new URL(page.url);
		u.searchParams.delete('repo');
		for (const r of next) u.searchParams.append('repo', r);
		goto(u.pathname + u.search + u.hash, { replaceState: true, noScroll: true, keepFocus: true });
	}

	let opened = $state<Record<string, boolean>>({});
	/** ?open=<repo #ref> (or a change key) opens that change's services on load */
	$effect.pre(() => {
		const o = page.url.searchParams.get('open');
		if (!o) return;
		for (const s of P.stops) for (const r of s.rows) if ((r.key === o || `${r.repo} ${r.ref}` === o) && opened[r.key] === undefined) opened[r.key] = true;
	});

	const word = (r: PlumbRow): [string, string] => {
		if (r.col === 'merged' && r.state !== 'failed') return ['Not deployed yet', 'text-fg-muted'];
		const w = stateWord(r.state === 'approval-yours' ? 'approval' : r.state, { yours: r.state === 'approval-yours' });
		return [w ?? 'In ' + r.col, r.state === 'failed' ? 'text-danger' : r.state === 'approval-yours' || r.state === 'held' ? 'text-held' : 'text-fg-muted'];
	};
	const mark = (state: string, col?: string): { state: 'failed' | 'held' | 'deploying' | 'checking' | 'approval' | 'none'; tone?: 'held' | 'neutral' } =>
		col === 'merged' && state !== 'failed' ? { state: 'none' } : state === 'approval-yours' ? { state: 'approval', tone: 'held' } : state === 'approval' ? { state: 'approval', tone: 'neutral' } : { state: (['failed', 'held', 'deploying', 'checking'].includes(state) ? state : 'checking') as 'failed' };
	const svcMark = (s: Svc) => (s.done ? { state: 'newest' as const } : mark(s.state, s.tier));
	const INK: Record<string, string> = { failed: 'text-danger', 'approval-yours': 'text-held', held: 'text-held' };
	const sage = (t: number | null) => (t ? ago(new Date(t).toISOString()) : '');
</script>

<div class="plb-all" data-plumb>
	{#if chips.length > 1}
		<div class="plb-filter" role="group" aria-label="Filter by repo" data-repo-filter>
			{#each chips as c (c.repo)}
				<FilterChip label={c.repo} count={c.count} selected={sel.includes(c.repo)} onclick={() => pick(c.repo)} />
			{/each}
		</div>
	{/if}
	<div class="plb-wrap"><div class="plb">
		<div class="plb-main" id="in-flight" data-group="In flight">
			<Card icon={RocketOutline} title="In flight" padded={false}>
				{#snippet rollup()}<span class="t-card-rollup tabular-nums text-fg-subtle">{P.total} {P.total === 1 ? 'change' : 'changes'}{sel.length ? ` · ${sel.length} ${sel.length === 1 ? 'repo' : 'repos'}` : ''}</span>{/snippet}
				<div class="plb-cq">
					<ol class="plb-route">
						{#each P.stops as s (s.col)}
							<li class="plb-stop" class:empty={!s.rows.length} data-stop={s.col}>
								<div class="plb-head">
									<span class="plb-node" aria-hidden="true"></span>
									{#if s.rows.length}
										<span class="t-card-title text-fg">{s.col === 'merged' ? 'released' : s.col}</span>
										<span class="t-meta tabular-nums text-fg-subtle">{s.rows.length}</span>
									{:else}
										<span class="t-ui-sm text-fg-subtle">{s.col === 'merged' ? 'released' : s.col}</span>
										<span class="t-meta text-fg-disabled">· none</span>
									{/if}
								</div>
								{#each s.rows as it (it.key)}
									{@const w = word(it)}
									{@const sv = it.services}
									<div class="plb-row tap-zone" data-state={it.state} data-key={it.key}>
										<span class="plb-mark"><StatusMark {...mark(it.state, it.col)} /></span>
										<span class="plb-glyph"><AppGlyph name={it.repo} size={20} /></span>
										<a href={it.href} class="plb-title tap-link t-ui text-fg" title={it.title}>{it.title}</a>
										<span class="plb-age t-meta tabular-nums text-fg-subtle" title="at this stop">{it.age}</span>
										<span class="plb-line2">
											<span class="plb-sub t-meta text-fg-subtle"><span class="text-fg-muted">{it.repo}</span> <span class="t-code-sm">{it.ref}</span></span>
											<span class="plb-word">{#if it.worst}<span class="t-meta text-fg-subtle">{it.worst}</span> {/if}<span class="t-ui-sm {w[1]}">{w[0]}</span></span>
										</span>
										{#if sv}
											<button type="button" class="plb-spread" aria-expanded={!!opened[it.key]} onclick={() => (opened[it.key] = !opened[it.key])}
												title="{sv.length} services: {servicesByUrgency(sv).map((x) => `${x.app} ${serviceWord(x).toLowerCase()}`).join(', ')}">
												{#each spreadStages(sv) as g, gi (g.tier)}
													{#if gi}<span class="plb-sep" aria-hidden="true"></span>{/if}
													<span class="plb-tier t-meta text-fg-subtle">{g.tier}</span>
													<span class="plb-apps">{#each g.apps as a (a.app)}<AppGlyph name={a.app} size={16} />{/each}</span>
												{/each}
												<span class="plb-count t-meta text-fg-subtle tabular-nums">{sv.length} services<ChevronDownOutline class="plb-chev h-3.5 w-3.5 text-fg-subtle" aria-hidden="true" /></span>
											</button>
										{/if}
									</div>
									{#if sv && opened[it.key]}
										<ul class="plb-svcs" data-services={it.key}>
											{#each servicesByUrgency(sv) as x (x.app)}
												<li class="plb-svc">
													<span class="plb-mark"><StatusMark {...svcMark(x)} /></span>
													<AppGlyph name={x.app} size={16} />
													{#if x.href}<a href={x.href} class="tap-link t-ui-sm truncate text-fg">{x.app}</a>{:else}<span class="t-ui-sm truncate text-fg">{x.app}</span>{/if}
													<span class="plb-svc-word t-meta {INK[x.state] ?? 'text-fg-muted'}">{serviceWord(x)}</span>
													<span class="plb-age t-meta tabular-nums text-fg-subtle">{sage(x.since)}</span>
												</li>
											{/each}
										</ul>
									{/if}
								{/each}
							</li>
						{/each}
					</ol>
				</div>
			</Card>
		</div>
		<aside class="plb-side" id="landed" data-group="Landed">
			<Card icon={CheckOutline} title="Landed" padded={false}>
				{#snippet rollup()}<span class="t-card-rollup tabular-nums text-fg-subtle">{P.landed.length} {P.landed.length === 1 ? 'change' : 'changes'}</span>{/snippet}
				{#if P.landed.length}
					<ul class="plb-landed">
						{#each P.landed as l (l.key)}
							<li class="plb-l tap-zone">
								<AppGlyph name={l.repo} size={20} />
								<a href={l.href} class="tap-link t-ui truncate text-fg" title={l.title}>{l.title}</a>
								<span class="plb-l-sub t-meta text-fg-subtle"><span class="text-fg-muted">{l.repo}</span> <span class="t-code-sm">{l.ref}</span></span>
								<span class="plb-l-age t-meta tabular-nums text-fg-subtle">{l.age}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="t-meta px-4 py-4 text-fg-subtle">Nothing has landed{sel.length ? ' in this selection' : ''} yet.</p>
				{/if}
			</Card>
		</aside>
	</div></div>
</div>

<style>
	.plb-all { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
	.plb-filter { display: flex; flex-wrap: wrap; gap: 8px; }
	/* main + side column once the body can hold both: the rollout tab's 3fr / minmax(22rem, 2fr); below that the side follows the main card */
	.plb-wrap { container-type: inline-size; min-width: 0; }
	.plb { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
	@container (min-width: 960px) { .plb { grid-template-columns: minmax(0, 3fr) minmax(22rem, 2fr); } .plb-side { position: sticky; top: 16px; } }
	.plb-cq { container-type: inline-size; min-width: 0; }
	.plb-route { list-style: none; margin: 0; padding: 4px 0 8px; position: relative; }
	.plb-route::before { content: ''; position: absolute; left: 23.5px; top: 26px; bottom: 30px; width: 1px; background: var(--k-line); }
	.plb-stop + .plb-stop { margin-top: 4px; }
	.plb-head { position: relative; display: flex; align-items: baseline; gap: 8px; min-height: 40px; padding: 12px 16px 4px 44px; }
	.plb-node { position: absolute; left: 20px; top: 18px; width: 8px; height: 8px; border-radius: 50%; background: var(--k-fg-muted); box-shadow: 0 0 0 4px var(--k-surface); }
	.plb-stop.empty .plb-head { min-height: 32px; padding-top: 8px; }
	.plb-stop.empty .plb-node { top: 14px; background: var(--k-surface); box-shadow: inset 0 0 0 1.5px var(--k-fg-disabled), 0 0 0 4px var(--k-surface); }
	.plb-row { position: relative; display: grid; grid-template-columns: 16px 20px minmax(0, 1fr) auto; column-gap: 12px; row-gap: 2px; align-items: center; padding: 8px 16px 8px 44px; min-height: 56px; }
	.plb-row:hover { background: var(--k-hover); }
	.plb-mark { display: inline-flex; }
	.plb-row > .plb-mark, .plb-glyph { grid-row: 1 / span 2; display: inline-flex; }
	.plb-title { grid-column: 3; grid-row: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.plb-age { grid-column: 4; grid-row: 1; text-align: right; }
	.plb-line2 { grid-column: 3 / span 2; grid-row: 2; display: flex; align-items: center; line-height: 16px; justify-content: space-between; gap: 16px; min-width: 0; }
	.plb-sub { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.plb-word { flex: none; display: inline-flex; align-items: baseline; gap: 6px; white-space: nowrap; }
	/* the spread is a button (hover is not required: it is a visible control at rest on every width) */
	.plb-spread { grid-column: 3 / span 2; grid-row: 3; justify-self: start; display: inline-flex; align-items: center; gap: 6px; margin: 6px 0 0 -6px; padding: 2px 6px; min-height: 24px; border-radius: 6px; position: relative; z-index: 2; }
	.plb-spread:hover { background: var(--k-hover); }
	.plb-spread:focus-visible { outline: 2px solid var(--k-active); outline-offset: 1px; }
	.plb-apps { display: inline-flex; gap: 2px; }
	.plb-sep { width: 12px; height: 1px; background: var(--k-line-strong); margin: 0 2px; }
	.plb-count { margin-left: 6px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
	.plb-spread :global(.plb-chev) { transition: transform 120ms ease; }
	.plb-spread[aria-expanded='true'] :global(.plb-chev) { transform: rotate(180deg); }
	.plb-svcs { list-style: none; margin: 0 0 8px; padding: 0; }
	.plb-svc { display: grid; grid-template-columns: 16px 16px minmax(0, 11rem) minmax(0, 1fr) auto; column-gap: 10px; align-items: center; min-height: 36px; padding: 0 16px 0 76px; }
	.plb-svc-word { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.plb-svc .plb-age { grid-column: 5; grid-row: auto; }
	.plb-landed { list-style: none; margin: 0; padding: 4px 0; }
	.plb-l { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: 12px; row-gap: 2px; align-items: center; padding: 8px 16px; min-height: 56px; }
	.plb-l:hover { background: var(--k-hover); }
	.plb-l > :global(.app-glyph) { grid-row: 1 / span 2; }
	.plb-l > a { grid-column: 2; grid-row: 1; }
	.plb-l-sub { grid-column: 2; grid-row: 2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.plb-l-age { grid-column: 3; grid-row: 1; text-align: right; }
	@container (max-width: 560px) {
		.plb-route::before { left: 19.5px; }
		.plb-node { left: 16px; }
		.plb-head { padding-left: 36px; padding-right: 12px; }
		.plb-row { grid-template-columns: 16px minmax(0, 1fr) auto; padding: 10px 12px 10px 36px; row-gap: 4px; }
		.plb-glyph { display: none !important; }
		.plb-row > .plb-mark { grid-row: 1; align-self: start; padding-top: 2px; }
		.plb-title { grid-column: 2; white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; }
		.plb-age { grid-column: 3; align-self: start; padding-top: 2px; }
		.plb-line2 { grid-column: 2 / span 2; flex-wrap: wrap; row-gap: 2px; }
		.plb-spread { grid-column: 2 / span 2; flex-wrap: wrap; min-height: 44px; margin-top: 0; }
		.plb-svc { padding: 4px 12px 4px 36px; grid-template-columns: 16px 16px minmax(0, 1fr) auto; row-gap: 0; min-height: 44px; }
		.plb-svc-word { grid-column: 3; grid-row: 2; }
		.plb-svc .plb-age { grid-column: 4; grid-row: 1; }
	}
</style>
