<svelte:options runes={true} />

<script lang="ts" module>
	export type Hop = { tier: string; start: number; end: number };
</script>

<script lang="ts">
	/**
	 * r42 ATOM "Lead bar" (/design/atoms, opt-in; no page draws it yet).
	 *
	 * ROLE: how one build travelled to production, on one 6px line: each environment's deploy + checks is a short BAR
	 * (start of the deploy -> bake end, from that place's own `status.history` entry), the time it sat between two
	 * environments is a 1px WAIT line. The total ("50m") travels beside it. Rows share one scale (`scaleMs`), so a slow
	 * change reads longer than a quick one in the same list.
	 *
	 * Neutral on purpose: a landed change is history, not state. The last bar (production) is one step stronger so the
	 * line ends on the arrival. Reference: Trigger.dev's run span (bar = running, thin line = waiting), Inngest's trace
	 * waterfall; no axis, no labels inside — tier names are in the tooltip.
	 */
	let {
		hops,
		origin = undefined,
		scaleMs,
		width = 160,
		class: className = ''
	}: {
		/** in travel order; times are epoch ms; the first hop's start is t=0 */
		hops: Hop[];
		/** the merge (epoch ms): the line starts there, the wait until the first deploy drawn as a wait */
		origin?: number;
		/** the duration the full width stands for (the longest row in the list) */
		scaleMs: number;
		width?: number;
		class?: string;
	} = $props();
	const t0 = $derived(origin ?? hops[0]?.start ?? 0);
	const x = (t: number) => Math.max(0, Math.min(width, ((t - t0) / Math.max(1, scaleMs)) * width));
	const fmt = (ms: number) => {
		const m = Math.round(ms / 60000);
		return m < 60 ? `${Math.max(1, m)}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`;
	};
	const runs = $derived(hops.map((h, i) => {
		const a = x(h.start), b = Math.max(x(h.end), a + 3);
		return { ...h, a, w: b - a, last: i === hops.length - 1, title: `${h.tier}: ${fmt(h.end - h.start)}` };
	}));
	const waits = $derived([
		...(origin != null && runs[0] ? [{ a: 0, b: runs[0].a, title: `merged; first deploy ${fmt(hops[0].start - origin)} later` }] : []),
		...hops.slice(1).map((h, i) => ({ a: runs[i].a + runs[i].w, b: runs[i + 1].a, title: `waited ${fmt(h.start - hops[i].end)} before ${h.tier}` }))
	].filter((w) => w.b - w.a > 1));
	const end = $derived(runs.length ? runs[runs.length - 1].a + runs[runs.length - 1].w : 0);
</script>

<svg class="lb {className}" width={width} height="8" viewBox="0 0 {width} 8" role="img" aria-label="reached prod in {fmt((hops.at(-1)?.end ?? t0) - t0)}" data-lead-bar>
	{#each waits as w, i (i)}<line x1={w.a} x2={w.b} y1="4" y2="4" class="lb-wait"><title>{w.title}</title></line>{/each}
	{#each runs as r (r.tier + r.start)}<rect x={r.a} y="1" width={r.w} height="6" rx="1.5" class="lb-run" class:last={r.last}><title>{r.title}</title></rect>{/each}
	{#if end < width}<line x1={end} x2={width} y1="4" y2="4" class="lb-rest" />{/if}
</svg>

<style>
	.lb { display: block; flex-shrink: 0; overflow: visible; }
	.lb-run { fill: var(--k-fg-disabled); }
	.lb-run.last { fill: var(--k-fg-muted); }
	.lb-wait { stroke: var(--k-fg-disabled); stroke-width: 1; }
	.lb-rest { stroke: var(--k-line); stroke-width: 1; stroke-dasharray: 1 3; stroke-linecap: round; }
</style>
