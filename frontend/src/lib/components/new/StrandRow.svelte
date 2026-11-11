<svelte:options runes={true} />

<script lang="ts">
	/**
	 * A STRAND ROW (r39 kit parts/row.js `row()` / `restRow()`): one rollout (or one healthy place) in the "All rollouts" list card.
	 *
	 * ROLE: the page's list row — mark · name + joined tier chip · step strand · sentence · age — columns at the same x in every row of
	 * a card. Reference: the r39 kit's `.lr` (ported from r35 rollouts-kit, signed on r38 Rollouts G). WHY NOT RolloutLine / RolloutRow:
	 * those carry a build track and an action slot and open in place; this row's whole body is ONE link and nothing in it is a second
	 * action (the actions live on the Attention cards above), so the strand can sit in a fixed 120px track instead of competing with a button.
	 * ACTIVE rows are 48px (mark + state hue + MiniPipeline `neutral`, the mark carries the hue), QUIET rows (At rest) are 40px: no mark, no
	 * chip colour, the name muted, a repeat of the previous app's name dimmed, the place as plain 12px text, the build in the code face.
	 * PHONE (< 600px of the card): name · age on line 1, the sentence on line 2, the strand on line 3 (a quiet row drops its strand).
	 */
	import StatusMark from '$lib/components/StatusMark.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import MiniPipeline from './MiniPipeline.svelte';
	import { truthAttrs } from './data';
	import { envTheme } from './rollout-view';
	import type { StrandRow, RestRow } from './rollouts-page';
	import { atoms } from '$lib/components/atoms/atoms-context';
	import LeadBar from '$lib/components/atoms/LeadBar.svelte';

	let { row = null, rest = null, dense = false }: { row?: StrandRow | null; rest?: RestRow | null; /** the quiet flow (Changes' At rest): no mark / drawing tracks, the age auto-wide */ dense?: boolean } = $props();
	const href = $derived(row?.href ?? rest?.href ?? '#');
	/* r42 atoms (opt-in, /design/atoms): the progress pie + its words, and the landed change's lead bar */
	const AT = atoms();
	const pg = $derived(row && row.mark === 'checking' && AT.progress ? (AT.progress.get(href.split('/').filter(Boolean).slice(2, 4).join('/')) ?? null) : null);
	const name = $derived(row?.app ?? rest?.app ?? '');
	/* the env chip's own label form: "prod-us-east-2", a folded set "5 prod regions"; Chip splits it into the tinted tier + neutral place halves */
	const chip = $derived(!row ? '' : !row.place ? row.tier : /^\d+ regions?$/.test(row.place) ? row.place.replace(/ (regions?)$/, ` ${row.tier} $1`) : `${row.tier}-${row.place}`);
</script>

<li class="lr tap-zone" class:q={!!rest} class:dn={dense} class:hl={!!rest && rest.lead !== undefined} data-key={row?.key ?? rest?.key} {...dense ? {} : { "data-truth-kind": row ? "rollout" : "rest", "data-truth-app": name, "data-truth-href": href, "data-truth-group": row?.row.group ?? "rest", ...(row ? truthAttrs(row.row) : { "data-truth-state": "healthy" }) }}>
	<div class="lr-in">
		<span class="lr-mk">{#if row}<StatusMark state={row.mark} progress={pg?.fraction ?? null} />{/if}</span>
		<div class="lr-id">
			<a {href} class="tap-link lr-nm" class:rep={rest?.rep} aria-label={row ? `${name} in ${row.place ?? row.tier}` : `${name} ${rest?.place}`}>{name}</a>
			{#if row}<Chip role="env" theme={envTheme(row.tier)} label={chip} wide />
			{:else if rest?.place}<span class="lr-pl t-meta">{rest.place}</span>{/if}
		</div>
		<span class="lr-dr">{#if row}<MiniPipeline nodes={row.nodes} neutral label="{name} steps" />{/if}</span>
		<p class="lr-sn" class:wrap={!!row?.row.alsoApproval}>
			{#if row}<span class="lr-ld" data-state-word>{row.lead}</span>{#if pg?.words && !row.row.stillChecking}{" "}<span class="lr-left t-meta tabular-nums">{pg.words}</span>{" "}{/if}{row.rest}{:else if rest}{#if rest.codeFirst && rest.code}<span class="lr-code first t-code-sm">{rest.code}</span>{/if}{rest.sentence}{#if !rest.codeFirst && rest.code}<span class="lr-code t-code-sm">{rest.code}</span>{/if}{/if}
		</p>
		{#if rest && rest.lead !== undefined}<span class="lr-ldw t-meta" title={rest.lead ? `${rest.lead.total} to prod` : undefined}>{#if rest.lead}<LeadBar hops={rest.lead.hops} origin={rest.lead.origin} scaleMs={rest.lead.scale} width={72} /><span class="lr-lead-t tabular-nums">{rest.lead.total}<span class="lr-tp">to prod</span></span>{/if}</span>{/if}
		<span class="lr-age t-meta">{row?.age ?? rest?.age ?? ''}</span>
	</div>
</li>

<style>
	/* the landed change's lead bar: its own track, so the sentence keeps its room; "to prod" is spelt where the row is wide (and in the tooltip) */
	.lr-ldw { display: flex; align-items: center; gap: 8px; width: 9rem; }
	.lr-lead-t { color: var(--k-fg-muted); white-space: nowrap; }
	.lr-tp { display: none; margin-left: 0.3em; }
	.lr.dn.hl .lr-in { grid-template-columns: minmax(96px, 150px) minmax(0, 1fr) 9rem auto; }
	@media (min-width: 1700px) { .lr-tp { display: inline; } .lr-ldw { width: 12rem; } .lr.dn.hl .lr-in { grid-template-columns: minmax(96px, 200px) minmax(0, 1fr) 12rem auto; } }
	.lr-left { color: var(--k-fg-subtle); margin-right: 8px; margin-left: -2px; }
	.lr { position: relative; padding: 0 16px; min-width: 0; }
	.lr:hover { background: var(--k-hover); }
	.lr-in { display: grid; grid-template-columns: 16px minmax(13rem, 15rem) 120px minmax(0, 1fr) 2.5rem; column-gap: 16px; align-items: center; min-height: 48px; padding: 8px 0; border-top: 1px solid var(--k-line-subtle); box-sizing: border-box; }
	:global(.lr:first-child) .lr-in { border-top: 0; }
	.lr-mk { display: grid; place-items: center; width: 16px; }
	.lr-id { display: flex; align-items: center; gap: 8px; min-width: 0; }
	.lr-nm { font-size: 14px; line-height: 20px; font-weight: 600; letter-spacing: -0.004em; color: var(--k-fg); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.lr-nm:hover { text-decoration: underline; }
	.lr-pl { color: var(--k-fg-subtle); white-space: nowrap; }
	.lr-dr { display: flex; align-items: center; justify-self: start; min-width: 0; }
	.lr-sn { font-size: 14px; line-height: 20px; color: var(--k-fg-muted); min-width: 0; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.lr-ld { font-weight: 500; color: var(--k-fg); margin-right: 8px; }
	.lr-age { color: var(--k-fg-subtle); text-align: right; font-variant-numeric: tabular-nums; }
	/* quiet (At rest): 40px, no mark, no colour; a repeated app name dims */
	.lr.q .lr-in { min-height: 40px; }
	.lr.q .lr-nm { font-weight: 500; color: var(--k-fg-muted); }
	.lr.q .lr-nm.rep { font-weight: 400; color: var(--k-fg-subtle); }
	.lr.q .lr-sn { color: var(--k-fg-subtle); }
	.lr-code { color: var(--k-fg-subtle); margin-left: 8px; }
	.lr-code.first { margin-left: 0; margin-right: 8px; }
	.lr.dn .lr-in { grid-template-columns: minmax(120px, 200px) minmax(0, 1fr) auto; }
	.lr.dn .lr-mk, .lr.dn .lr-dr { display: none; }
	/* the list card is the container: 2 columns of rows from 1700px of card, 3 from 3200 (the page's own grid, see Rollouts.svelte) */
	@container (max-width: 600px) {
		.lr { padding: 0 12px; }
		.lr-in { grid-template-columns: 16px minmax(0, 1fr) auto; row-gap: 4px; }
		.lr-mk { grid-row: 1 / 4; align-self: start; padding-top: 2px; }
		.lr-id { grid-column: 2; grid-row: 1; }
		.lr-age { grid-column: 3; grid-row: 1; }
		.lr-sn { grid-column: 2 / 4; grid-row: 2; }
		/* F4: "· also needs your approval" is the second ask of a held row; on a phone it wraps, never an ellipsis */
		.lr-sn.wrap { white-space: normal; overflow: visible; text-overflow: clip; }
		.lr-dr { grid-column: 2 / 4; grid-row: 3; }
		.lr.q .lr-dr { display: none; }
		.lr.dn .lr-in { grid-template-columns: minmax(0, 1fr) auto; }
		.lr.dn .lr-id { grid-column: 1; }
		.lr.dn .lr-age { grid-column: 2; }
		.lr.dn .lr-sn { grid-column: 1 / 3; }
		.lr.dn.hl .lr-in { grid-template-columns: minmax(0, 1fr) auto; }
		.lr.dn .lr-ldw { grid-column: 1 / 3; grid-row: 3; width: auto; }
		.lr.dn .lr-ldw:empty { display: none; }
		.lr-tp { display: inline; }
	}
</style>
