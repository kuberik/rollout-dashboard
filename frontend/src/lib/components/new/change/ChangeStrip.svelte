<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE CHANGE'S ENVIRONMENT STRIP (change-strip r1, owner 2026-11-12: "using the environment progression mini boxes strip we
	 * already had. it just didn't have waves. it also had a shortcoming that on prod box we couldn't select exact site").
	 * "Where is my change right now, and what's next?" drawn by the ONE environment row every page uses (EnvRow, size L, neutral),
	 * each tier box holding its sites as marks in wave order, every site one tap from its rollout (the site picker).
	 * Truth: `stagesOf({ kind: 'change' })` (stages-model) — the same classified / notReached / countsOf the Changes list reads. The
	 * SHAPE (tiers, waves, the order of sites) comes from topology, never from state: a state change repaints a mark, nothing moves.
	 * No words in the strip: a word appearing would widen its box and push the next one (0px rule, tools/stability.mjs).
	 * Several apps: one row per app on a shared grid (EnvRow `lanes`).
	 */
	import EnvRow, { type EnvCell, type EnvLane, type EnvSite } from '$lib/components/EnvRow.svelte';
	import type { SiteState } from '$lib/components/SiteMark.svelte';
	import type { TChange, HomeState } from '../data';
	import { stagesOf, type StageState, type StagePlace } from '../stages/stages-model';

	let { change: c, scenario = 'incident', class: className = '' }: { change: TChange; scenario?: HomeState; class?: string } = $props();

	const SITE: Record<StageState, SiteState> = { deployed: 'done', checking: 'checking', deploying: 'deploying', held: 'held', approval: 'approval', failed: 'failed', notreached: 'notreached', notaffected: 'notaffected', replaced: 'notaffected' };
	const INK: Partial<Record<StageState, string>> = { checking: 'text-progress', deploying: 'text-active', held: 'text-held', approval: 'text-held', failed: 'text-danger', notreached: 'text-fg-subtle' };
	const QUIET = new Set<StageState>(['deployed', 'notreached', 'notaffected', 'replaced']);

	const stages = $derived(stagesOf({ kind: 'change', change: c }, scenario));
	const tiers = $derived([...new Set(stages.columns.map((col) => col.tier))]);
	const site = (p: StagePlace, wave: number | null): EnvSite => ({
		key: p.href,
		name: p.name,
		wave,
		state: SITE[p.state],
		word: p.progress ? p.word + ' · step ' + p.progress : p.word,
		wordInk: INK[p.state],
		aside: p.age ?? undefined,
		href: p.href
	});
	const lanes = $derived<EnvLane[]>(
		stages.lanes.map((l) => ({
			key: l.app,
			label: l.app,
			app: l.app,
			cells: tiers.map((t) => {
				const ps = stages.columns.flatMap((col, i) => (col.tier === t ? (l.cells[i]?.places ?? []).map((p) => ({ p, wave: col.multi ? col.wave : null })) : []));
				if (!ps.length) return null;
				const cell: EnvCell = { key: t, label: t, sites: ps.map((x) => site(x.p, x.wave)), hot: ps.some((x) => !QUIET.has(x.p.state)) };
				return cell;
			})
		}))
	);
	const label = $derived(
		lanes.map((l) => (lanes.length > 1 ? l.label + ': ' : '') + l.cells.filter(Boolean).map((cell) => cell!.label + ' ' + cell!.sites!.map((x) => x.name + ' ' + x.word).join(', ')).join('; ')).join('. ')
	);
</script>

<div class="w-full min-w-0 {className}" data-change-strip data-stages role="group" aria-label={label}>
	{#if lanes.length > 1}
		<EnvRow {lanes} size="L" />
	{:else if lanes.length === 1}
		<EnvRow cells={lanes[0].cells.filter((x): x is EnvCell => !!x)} lane={lanes[0].key} size="L" />
	{/if}
</div>
