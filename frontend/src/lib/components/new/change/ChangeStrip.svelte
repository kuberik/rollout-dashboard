<script lang="ts">
	/**
	 * THE CHANGE'S ENVIRONMENT ROW (detail pass 2026-11-08; was a StagePath dot strand). "Where has my change got to?" drawn by the ONE
	 * environment row every page uses (EnvRow, size L, neutral: no box is highlighted off the rollout tab), exactly as the change's repo card
	 * on /changes draws it: one box per tier the change's app has, the change itself as ONE bead (state mark · #ref) inside the box it reached
	 * (`classifyChanges` — the same column and state the list computes, so list and detail never disagree). A landed change sits in its last
	 * tier without a mark. Dots stay for the steps inside one rollout only (owner 2026-11-03).
	 * Truth: `stripOf` (detail-model) still decides which tiers exist; each box's title keeps what the old station said in words.
	 */
	import EnvRow, { type EnvCell } from '$lib/components/EnvRow.svelte';
	import { beadsFor } from '$lib/view-models/bead';
	import { classifyChanges, refOf } from '../changes-page';
	import type { TChange, HomeState } from '../data';
	import type { Tile } from './detail-model';

	let { tiles, change: c, scenario = 'incident', class: className = '' }: { tiles: Tile[]; change: TChange; scenario?: HomeState; class?: string } = $props();
	const p = $derived.by(() => { const { mineP, teamP } = classifyChanges(scenario); return [...mineP, ...teamP].find((x) => x.c.key === c.key) ?? null; });
	const col = $derived(!p ? null : p.col === 'landed' ? (tiles[tiles.length - 1]?.tier ?? null) : p.col);
	const cells = $derived<EnvCell[]>([
		...(col === 'merged' ? [{ key: 'merged', label: 'released' }] : []),
		...tiles.map((t) => ({ key: t.tier, label: t.tier, title: [t.tier, t.state, t.label, t.aside, t.word].filter(Boolean).join(' · ') }))
	].map((cell) => ({ ...cell, beads: p && cell.key === col ? beadsFor([{ ref: refOf(c), title: c.title, state: p.state, key: c.key }]) : undefined })));
	const label = $derived(tiles.map((t) => [t.tier, t.state, t.label, t.aside].filter(Boolean).join(' ')).join(', '));
</script>

<div class="w-full min-w-0 {className}" data-change-strip data-tiers={tiles.map((t) => t.tier).join(',')} role="img" aria-label={label}><EnvRow {cells} size="L" /></div>
