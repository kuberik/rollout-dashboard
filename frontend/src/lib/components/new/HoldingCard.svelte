<script lang="ts">
	/**
	 * r34 — THE HOLDING CARD (rail), one component for Rollouts and Environments (AD envs r6 C2: the two pages drew the
	 * same card two ways). Owner ruling 2026-10-28: one line per CAUSE holding builds, with the places — the SRE's "what is
	 * blocking the fleet"; the title says what it is for; the rollup counts causes. A row opens the first held place's
	 * Gates tab. Places are grouped per app ("checkout-api · staging and 2 prod regions"), never the app twice. Approvals
	 * are rows with an Approve action, not holds — callers filter them out (same on both pages).
	 */
	import { LockOutline, PauseOutline } from 'flowbite-svelte-icons';
	import Card from '$lib/components/Card.svelte';
	import StatusMark from '$lib/components/StatusMark.svelte';
	import HeldGlyph from '$lib/components/HeldGlyph.svelte';
	import AppGlyph from '$lib/components/AppGlyph.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { plural, tabEnv, envTheme } from './rollout-view';
	import type { HeldCause, TRow } from './data';
	import GateText from '$lib/components/GateText.svelte';
	import { plainGateText } from '$lib/view-models/gate-label';

	let { holds, class: className = '', quiet = false, rollup = '', id = undefined }: { holds: HeldCause[]; class?: string; /** r3-filters: the anchor the old /rollouts?state=held link lands on */ id?: string; /** Environments: the card's rollup in PLACES ("6 held"), the unit the hold callouts above it sum to */ rollup?: string; /** NO LONGER CHANGES ANYTHING (one colouring on every page: held orange on the pause glyph only, no dot clusters); kept so callers type-check. Was: /changes only (budget, "neutral at rest"): no app glyphs, no place dots, grey strip; the cause word and the figure carry the row */ quiet?: boolean } = $props();
	/** EF6: "Waiting on X" (data.ts) is said "Waits on X" everywhere a row says it; "Waiting for …" keeps its own words. */
	const waitsTitle = (c: string) => c.replace(/^Waiting on /, 'Waits on ');
	/* rollouts-11 W20: ONE vocabulary: the rollup counts the same rollouts the Held chip counts ("5 rollouts · 4 causes"); a row names its places ("3 places") */
	const rollouts = $derived(new Set(holds.flatMap((h) => h.rows.map((r) => r.key))).size);
	const placesOf = (rows: TRow[]) => rows.reduce((n, r) => n + Math.max(1, r.regions?.length ?? 1), 0);
	/* rollouts-8 V9: a row that folds several regions is a COUNT ("2 regions"), never a count printed in a place chip; `n` > 0 marks it */
	type Pl = { tier: string; label: string; n: number };
	const byApp = (rows: TRow[]): [string, Pl[]][] => { const m = new Map<string, Pl[]>(); for (const r of rows) m.set(r.app, [...(m.get(r.app) ?? []), { tier: r.tier, label: tabEnv(r), n: (r.regions?.length ?? 0) > 1 ? r.regions.length : 0 }]); return [...m]; };
</script>

<!-- r4 AD envs-2: the header's icon is the rows' mark (pause), not a lock --><Card class={className} {id} icon={PauseOutline} title="Holding" verdict={holds.length ? rollup || `${plural(rollouts, 'rollout')} · ${plural(holds.length, 'cause')}` : ''} padded={false}>
	{#if holds.length}
		<!-- r7 U8 (owner §7, TYPO P1/P7 Holding): ONE grid per cause, slots at one x on every row: mark 16 | cause 14/500 ink | places track (dot strip + "3 places") over, on line 2 at the text x,
		     one slot per app: AppGlyph 16 + app (t-ui-sm) + its place chips. No "cause · 3 places · app, app" run. 390: cause + places figure on line 1, the apps' glyphs + names on line 2 (places one tap away). -->
		<ul class="hcl divide-y divide-line-subtle">
			{#each holds as h (h.key)}
				{@const n = placesOf(h.rows)}
				<li class="hc tap-zone grid min-w-0 gap-x-3 px-4 py-3 hover:bg-hover" data-truth-kind="hold" data-truth-cause={plainGateText(h.cause)} data-truth-href={h.rows[0].href} data-truth-hrefs={h.rows.map((r) => r.href).join(" ")}>
					<span class="hc-mark flex h-5 items-center">{#if h.rows[0].state === 'awaiting-approval'}<StatusMark state="approval" />{:else}<HeldGlyph size={16} class="text-held" title="Held" />{/if}</span>
					<a href="{h.rows[0].href}/gates" class="hc-cause tap-link t-ui min-w-0 break-words font-medium text-fg hover:underline"><GateText text={waitsTitle(h.cause)} /></a>
					<span class="hc-places t-meta whitespace-nowrap text-right tabular-nums text-fg-subtle" data-truth-kind="hold-places">{plural(n, 'place')}</span>
					<div class="hc-apps flex min-w-0 flex-col gap-1.5">
						{#each byApp(h.rows) as [app, places] (app)}
							<div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><!-- envdetail-12 EW5: the app name stays whole; the place chips wrap to a second line before it gives way --><AppGlyph name={app} size={20} class="shrink-0" /><span class="t-ui-sm min-w-0 truncate text-fg-muted">{app}</span><span class="flex shrink-0 items-center gap-1.5"><!-- r4 AD envs-1: the place chips stay on the phone (never drop facts silently) -->{#each places.slice(0, 2) as pl (pl)}<Chip role="env" theme={envTheme(pl.tier)} label={pl.n ? `${pl.n} ${pl.tier === 'prod' ? 'prod ' : ''}regions` : pl.label} wide /><!-- envdetail-11 EV4: the count lives inside the chip, never a bare "2 regions" beside a staging chip -->{/each}{#if places.length > 2}<span class="t-meta text-fg-subtle">+{places.length - 2}</span>{/if}</span></div>
						{/each}
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<div class="flex flex-col items-center gap-1 px-4 py-6 text-center">
			<LockOutline class="h-5 w-5 text-fg-disabled" aria-hidden="true" />
			<p class="t-ui text-fg">Nothing is holding a build</p>
			<p class="t-meta text-fg-subtle">Approvals and rules that hold a build appear here.</p>
		</div>
	{/if}
</Card>

<style>
	.hc { grid-template-columns: 16px minmax(0, 1fr) auto; grid-template-areas: 'mark cause places' '. apps apps'; row-gap: 8px; align-items: center; }
	.hc-mark { grid-area: mark; }
	.hc-cause { grid-area: cause; }
	.hc-places { grid-area: places; }
	/* envdetail-9 EW4: in the 320px rail (1024-1279) the dot strip gives way so "Waits on payments-svc" stays on one line; the figure keeps its slot */
	.hcl { container-type: inline-size; }
	
	.hc-apps { grid-area: apps; }
</style>
