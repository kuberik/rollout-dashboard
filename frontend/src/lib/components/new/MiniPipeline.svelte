<script lang="ts">
	/**
	 * THE MINI PIPELINE (r34 shared lane S2) — the ONE drawing of a strand: a short left-to-right sequence of nodes
	 * (a rollout's steps, a change's tiers) joined by connectors. Replaces the five hand-rolled strands (Pipeline, the
	 * TraySteps strand, Tidemark's row strand, and the Slipway/Docket/Inbox strand calls that go through TraySteps).
	 *
	 * ROLE: "how far along is this sequence, and where is it stuck?" at row scale (xs) and in an opened panel (sm).
	 * WHY NOTHING EXISTING FITS: the tab's step list (TraySteps list mode) is a vertical nav with chips and a selected
	 * state; StatusMark is one 16px mark; PromotionLane is a strip of squares for environments. A strand is neither.
	 * LINEAGE: the rollout tab's Deployment-pipeline discs and its 2px connector, turned horizontal (owner 2026-10-28:
	 * node · ~32–40px connector · node, never stretched).
	 *
	 * EQUAL PITCH (owner 2026-11-02 "uneven spacing between steps") — the geometry is the contract:
	 *   - every node sits in a slot `d` wide; slot i starts at `i × pitch`; the node is centred in its slot, so a ring
	 *     and a dot (same `d`) never change the gap;
	 *   - every connector is exactly `pitch − d` long (edge to edge), the same in every row, state, width and page;
	 *   - the strand's width is `(n − 1) × pitch + d` (+ 2×14px of label air when labelled, data-lead), left-aligned, never stretched to a track (leftover space is
	 *     after the last node, owned by the host). Nothing in here uses flex-grow, `1fr` or percentages.
	 *   Two pitches only:  xs = 10px node · 22px pitch (12px connector, 1px) — a list row, no labels;
	 *                      sm = 24px disc · 56px pitch (32px connector, 2px) — an opened panel, labels under the nodes.
	 * OVERFLOW: a strand never shrinks its pitch. More than `max` nodes (default xs 6 = the row's 120px track; sm 5 =
	 *   276px, fits a 292px phone card at 360) fold a contiguous run into ONE "+N" node (title lists what it hides). The
	 *   run never contains the first node, the last node or the frontier (current/checking/held/approval/failed): the
	 *   earliest run long enough wins, else the longest; a run of one is not folded. Hosts needing another window pass `max`.
	 * LABELS (sm only): centred under the node, one line, `t-meta`, truncated to the pitch (the title carries the full
	 *   text); the frontier node's label is one step louder (`lit`, default on). `dim` quiets the whole strand (a
	 *   closed or superseded row). `decorative` = aria-hidden twin of a strand drawn elsewhere (no data-step/data-state, so a page counts every step once).
	 *
	 * MEASURED BY tools/strand-pitch.mjs: root `[data-strand]` with data-pitch / data-d / data-n, every node
	 * `[data-node]`; node-centre deltas must equal pitch ± 1px and the root no wider than (n−1)×pitch+d + 1.
	 */
	import { CheckCircleSolid, ExclamationCircleSolid, ClockSolid, UserOutline } from 'flowbite-svelte-icons';

	import { GEO, type MiniNode, type MiniState } from './mini-pipeline';

	let { nodes, size = 'xs', lit = true, dim = false, neutral = false, max = undefined, decorative = false, label = undefined, kind = 'strand', class: className = '' }: {
		nodes: MiniNode[];
		size?: 'xs' | 'sm';
		/** the frontier node (current / checking / held / approval / failed) is louder (label ink; xs: the live halo on `current`) */
		lit?: boolean;
		dim?: boolean;
		/** r39 (xs): drop the frontier hue (list rows: the row's own mark carries the state colour) */
		neutral?: boolean;
		/** fold the middle when there are more nodes than this (default: xs 10, sm 6) */
		max?: number;
		decorative?: boolean;
		/** the aria-label of the whole drawing */
		label?: string;
		/** `data-pipeline` value hosts have always read ('strand' | 'sm' | …) */
		kind?: string;
		class?: string;
	} = $props();

	const geo = $derived(GEO[size]);
	const limit = $derived(Math.max(3, max ?? (size === 'sm' ? 5 : 6)));
	type Slot = { fold: false; n: MiniNode } | { fold: true; hidden: MiniNode[] };
	const FRONTIER = new Set<MiniState>(['current', 'checking', 'held', 'approval', 'failed']);
	/* the fold hides a contiguous run of nodes that are neither the first, the last nor the frontier (the step that needs reading is never folded away); the earliest run long enough wins, else the longest run */
	const slots = $derived.by<Slot[]>(() => {
		const all = nodes.map((n): Slot => ({ fold: false, n }));
		if (nodes.length <= limit) return all;
		const k = nodes.length - limit + 1; // the fold node takes one slot itself
		const ok = (i: number) => i > 0 && i < nodes.length - 1 && !FRONTIER.has(nodes[i].state);
		let best: [number, number] | null = null;
		for (let i = 1; i < nodes.length - 1; ) {
			if (!ok(i)) { i++; continue; }
			let j = i; while (j < nodes.length - 1 && ok(j)) j++;
			if (j - i >= k) { best = [i, i + k]; break; }
			if (!best || j - i > best[1] - best[0]) best = [i, j];
			i = j;
		}
		if (!best || best[1] - best[0] < 2) return all; // a fold of one node saves nothing
		return [...all.slice(0, best[0]), { fold: true, hidden: nodes.slice(best[0], best[1]) }, ...all.slice(best[1])];
	});
	/* the StagePath line: 1px solid line-strong up to the frontier (the last node that is not still to come), then 1px dashed line-subtle */
	const frontierAt = $derived(slots.reduce((f, s, i) => ((s.fold ? s.hidden.some((h) => h.state !== 'pending') : s.n.state !== 'pending') ? i : f), -1));
	const hasLabels = $derived(size === 'sm' && nodes.some((n) => n.label));
	/* labelled strands: a label box is (pitch − 4) wide and centred on its node, so it overhangs the first/last node by (pitch − 4 − d)/2 = 14px; that air is INSIDE the root (lead), never outside it, so no label is clipped or sticks out of the card's text edge. Node centres keep the pitch. */
	const lead = $derived(hasLabels ? (geo.pitch - 4 - geo.d) / 2 : 0);
	const width = $derived((slots.length - 1) * geo.pitch + geo.d + 2 * lead);
	const WORD: Record<MiniState, string> = { done: 'done', current: 'running', pending: 'not started', failed: 'failed', held: 'waiting', approval: 'waiting for approval', checking: 'checking', rest: 'healthy' };
	const aria = $derived(label ?? 'Steps: ' + nodes.map((n) => `${n.label ?? n.step ?? ''} ${WORD[n.state]}`.trim()).join(', '));
	const xsCls = (s: MiniState) => (s === 'done' ? 'mp-done' : s === 'failed' ? 'st-fail' : s === 'held' ? 'st-hold' : s === 'approval' ? 'mp-ask' : s === 'checking' ? 'st-check' : s === 'current' ? 'st-active ' + (lit ? 'st-live' : '') : s === 'rest' ? 'mp-rest' : 'mp-ring mp-ring-off');
	/* sm discs: the tab's own tint + glyph per state (TraySteps' disc, same tokens) */
	const smCls = (s: MiniState) => (s === 'done' ? 'bg-success-tint text-success' : s === 'failed' ? 'bg-danger-tint text-danger' : s === 'checking' ? 'bg-progress-tint text-progress' : s === 'current' ? 'bg-active-tint text-active' : s === 'held' ? 'bg-held-tint text-held' : s === 'approval' ? 'mp-ask text-fg' : s === 'rest' ? 'bg-subtle' : 'bg-subtle text-fg-disabled');
	const spin = (s: MiniState) => (s === 'checking' ? 'border-progress-solid/40 border-t-progress-solid' : 'border-active-solid/40 border-t-active-solid');
	const nodeTitle = (n: MiniNode) => n.title ?? `${n.label ?? n.step ?? ''}${n.label || n.step ? ' · ' : ''}${WORD[n.state]}`;
</script>

<ol
	class="mp mp-{size} {dim ? 'mp-dim' : ''} {neutral ? 'mp-nu' : ''} {className}"
	style:width="{width}px"
	style:height="{hasLabels ? geo.d + 28 : geo.d}px"
	style:--d="{geo.d}px"
	style:--pitch="{geo.pitch}px"
	style:--line="{geo.line}px"
	style:--lead="{lead}px"
	role={decorative ? undefined : 'img'}
	aria-label={decorative ? undefined : aria}
	aria-hidden={decorative ? 'true' : undefined}
	data-strand
	data-pipeline={kind}
	data-size={size}
	data-pitch={geo.pitch}
	data-d={geo.d}
	data-n={slots.length}
	data-lead={lead}
>
	{#each slots as s, i (i)}
		{#if i > 0}<span class="mp-seg" class:mp-solid={i <= frontierAt} style:left="{(i - 1) * geo.pitch + geo.d + lead}px" aria-hidden="true"></span>{/if}
		{#if s.fold}
			<li class="mp-slot" style:left="{i * geo.pitch + lead}px" data-fold data-node="fold" title="{s.hidden.length} more: {s.hidden.map((h) => h.label ?? h.step ?? WORD[h.state]).join(', ')}">
				<span class="mp-fold t-meta tabular-nums" aria-hidden="true">+{s.hidden.length}</span>
			</li>
		{:else}
			{@const n = s.n}
			<li
				class="mp-slot"
				style:left="{i * geo.pitch + lead}px"
				data-node={n.state}
				data-step={decorative ? undefined : (n.step ?? n.label)}
				data-state={decorative ? undefined : (n.stepState ?? n.state)}
				title={decorative ? undefined : size === 'xs' ? nodeTitle(n) : n.title}
			>
				{#if size === 'xs'}
					<span class="st-node mp-dot {xsCls(n.state)}" aria-hidden="true"></span>
				{:else}
					<span class="mp-disc {smCls(n.state)}" aria-hidden="true">
						{#if n.state === 'done'}<CheckCircleSolid class="h-4 w-4" />
						{:else if n.state === 'failed'}<ExclamationCircleSolid class="h-4 w-4" />
						{:else if n.state === 'current' || n.state === 'checking'}<span class="h-4 w-4 animate-spin rounded-full border-2 {spin(n.state)}"></span>
						{:else if n.state === 'held'}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M9 5.5v13M15 5.5v13" /></svg>
						{:else if n.state === 'approval'}<UserOutline class="h-3.5 w-3.5" />
						{:else if n.state === 'rest'}<span class="h-1.5 w-1.5 rounded-full bg-success-solid"></span>
						{:else}<ClockSolid class="h-4 w-4" />{/if}
					</span>
					{#if n.label}<span class="mp-name {lit && FRONTIER.has(n.state) ? 't-ui-sm text-fg' : 't-meta text-fg-subtle'} {n.state === 'failed' && lit ? 'text-danger' : ''}" title={n.label}>{n.label}</span>{/if}
				{/if}
			</li>
		{/if}
	{/each}
</ol>

<style>
	/* the geometry contract (see the doc comment): absolute slots on a fixed pitch, connectors of constant length; no flex-grow, no fr, no % */
	.mp { position: relative; display: block; flex: none; margin: 0; padding: 0; list-style: none; line-height: 0; }
	.mp-dim { opacity: 0.6; }
	.mp-slot { position: absolute; top: 0; display: block; width: var(--d); height: var(--d); }
	.mp-seg { position: absolute; top: calc(var(--d) / 2 - var(--line) / 2); width: calc(var(--pitch) - var(--d)); height: var(--line); background: repeating-linear-gradient(90deg, var(--k-line-subtle) 0 3px, transparent 3px 6px); }
	.mp-xs .mp-seg.mp-solid { background: var(--k-line-strong); }
	.mp-sm .mp-seg { background: var(--k-line-strong); }
	/* family: a reached or not-yet station is a hollow ring (never a grey disc); the line says which */
	/* r39 (owner 2026-11-03/11-08, kit parts/strand): DONE is the calm green fill, a filled disc; no ring, no icon */
	.mp-done { background-color: var(--k-done); }
	.mp-nu .st-active, .mp-nu .st-check { box-shadow: inset 0 0 0 1.5px var(--k-fg-muted); background: radial-gradient(circle, var(--k-fg-muted) 0 1.5px, transparent 2px); }
	.mp-nu .st-hold { box-shadow: inset 0 0 0 1.5px var(--k-fg-subtle); }
	.mp-nu .st-live { box-shadow: inset 0 0 0 1.5px var(--k-fg-muted); }
	.mp-ring { box-shadow: inset 0 0 0 1.5px var(--k-fg-subtle); }
	.mp-ring-off { box-shadow: inset 0 0 0 1.5px var(--k-line-strong); }
	.mp-dot { width: var(--d); height: var(--d); }
	.mp-rest { background: radial-gradient(circle, var(--k-success-solid) 0 2px, transparent 2.5px); }
	.mp-ask { box-shadow: inset 0 0 0 1.5px var(--k-fg); }
	.mp-disc { display: flex; align-items: center; justify-content: center; width: var(--d); height: var(--d); border-radius: 9999px; }
	/* a fold node: three-character "+N" centred in its own slot; the slot is wider than d only in text, it never changes the pitch */
	.mp-fold { display: flex; align-items: center; justify-content: center; width: var(--d); height: var(--d); color: var(--k-fg-subtle); font-size: 11px; }
	.mp-xs .mp-fold { font-size: 9px; }
	/* labels hang under the node, centred on it, never wider than the pitch; the strand's own width is unchanged by them (absolute) */
	.mp-name { position: absolute; top: calc(var(--d) + 6px); left: calc(var(--d) / 2 - var(--pitch) / 2 + 2px); width: calc(var(--pitch) - 4px); overflow: hidden; text-align: center; text-overflow: ellipsis; white-space: nowrap; line-height: 16px; }
</style>
