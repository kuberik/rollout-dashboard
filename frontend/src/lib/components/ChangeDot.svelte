<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ONE DOT. QA round 4 (2026-10-11, coordinator ruling, D1) —
	 * `ChangeLine.svelte`'s own per-family meter dot and `CommandPalette.svelte`'s
	 * identical-looking one used to be two hand-written copies of the same
	 * `{#if step.resolved} ... {:else if step.tone === 'live'} ...` chain,
	 * and they had already drifted: the palette drew a PARTIAL rollback
	 * (`liveCount < builtCount`, the D3 shape) as a plain filled green dot —
	 * the live-ring branch ChangeLine's own copy had, the palette's never
	 * did. One component, imported by both, is what makes that
	 * structurally impossible from here on: there is only one dot to get
	 * right.
	 *
	 * The fleet track's stop picture (Home redesign 2, AD): a filled dot =
	 * the build is there, a hollow ring = not yet. One picture for "how far
	 * did this build get", everywhere this meter is drawn.
	 */
	import type { FamilyProgressStep } from '$lib/view-models/changes';
	import type { Bead } from '$lib/view-models/bead';
	import StatusMark from '$lib/components/StatusMark.svelte';

	/**
	 * r39 BEAD MODE (additive; `step` callers are untouched). `bead` draws the env-row BEAD instead of the 8px dot: ONE pill, 20px
	 * tall at every size (the kit's "one bead size everywhere"), state mark · #ref inside the box a change reached. Same job as the
	 * dot (where did this build get to), drawn at the density an env-row box has room for. Model + grouping: `view-models/bead.ts`;
	 * the reference is the r39 kit `bead()` (kit/parts/envrow.*). Failing = danger tint, waiting-for-you = held tint, the rest
	 * surface (dark: ground) so a bead always sits one step off the box it is in.
	 */
	let { step, bead }: { step?: FamilyProgressStep; bead?: Bead } = $props();
	const MARK = { failed: 'failed', held: 'held', deploying: 'deploying', checking: 'checking' } as const;
</script>

{#if bead}
	<svelte:element
		this={bead.href ? 'a' : 'span'}
		class="cd-bead cd-bead--{bead.emphasis || 'plain'}"
		class:cd-bead--nomark={bead.state === 'landed'}
		href={bead.href}
		title={bead.title}
		data-bead={bead.state}
	>
		{#if bead.state === 'approval-yours'}<StatusMark state="approval" tone="held" />
		{:else if bead.state === 'approval'}<StatusMark state="approval" tone="neutral" />
		{:else if bead.state !== 'landed'}<StatusMark state={MARK[bead.state]} />{/if}
		{#if bead.count !== null}<span class="cd-x">{bead.count}</span>
		{:else}{#each bead.refs as r (r)}<span>{r}</span>{/each}{#if bead.more}<span class="cd-x">+{bead.more}</span>{/if}{/if}
	</svelte:element>
{:else if !step}
	<!-- nothing to draw -->
{:else if step.resolved}
	<!-- ⭐ QA FIX (round 2, 2026-10-11) — RESOLVED IS NEUTRAL, DRAWING ONLY.
	     `step.tone` stays whatever `landing-grid.ts` classified it as
	     (`active`, folded from `rolled-back` — no second vocabulary for "a
	     mark that used to matter"), because the STANDING WORD beside this
	     dot reads that same tone/state ("rolled back in prod-eu-central")
	     and must not change. Only the dot itself draws the quiet
	     not-reached ring: a resolved build was here, failed or was undone,
	     and is gone again — never a filled or moving (blue/pulsing) dot,
	     which is what `tone === 'active'` would otherwise draw below. -->
	<span class="cl-dot cl-dot--dashed" aria-hidden="true"></span>
{:else if step.tone === 'live'}
	{#if step.liveCount < step.builtCount}
		<span class="cl-dot cl-dot--live-ring" aria-hidden="true"></span>
	{:else}
		<span class="cl-dot bg-success-solid" aria-hidden="true"></span>
	{/if}
{:else if step.tone === 'queued'}
	<span class="cl-dot cl-dot--ring" aria-hidden="true"></span>
{:else if step.tone === 'none'}
	<span class="cl-dot cl-dot--dashed" aria-hidden="true"></span>
{:else if step.tone === 'failed'}
	<span class="cl-dot bg-danger-solid" aria-hidden="true"></span>
{:else if step.tone === 'stuck'}
	<span class="cl-dot bg-held-solid" aria-hidden="true"></span>
{:else}
	<!-- `active` — everything EXCEPT `baking`/`retrying` is blue (deploying,
	     promoting, cancelled, rolled-back…), the same two-way split the
	     row's own leading icon makes (`ChangeLine`'s own `isBaking`) —
	     restated here off the real state.
	     ⛔ DESIGN LANGUAGE TL ROUND 3 (2026-10-08) — WAS
	     `step.state === 'deploying'`, A NARROWER TEST THAN THE ICON'S OWN.
	     A `promoting` step (this family's own real state: "promoting to
	     dev" — blue icon, blue verb) is not literally `deploying`, so it
	     fell to the `else` branch and drew `bg-progress-solid` (yellow) —
	     one row, two hues for ONE family's ONE state. `isActiveBlue`
	     mirrors `isBaking`'s own predicate exactly so the dot can never
	     again disagree with the glyph/verb it sits beside.
	     ⛔ DESIGN LANGUAGE TL ROUND 2 (2026-10-08) — THE PULSE IS THE BLUE
	     CASE ONLY. Yellow (progress/baking/retrying) never pulses or
	     glows — the owner's rule that keeps it visually distinct from the
	     one thing that is actually in motion right now. A
	     `bg-progress-solid` dot used to carry `animate-pulse` too, which
	     spent the product's one "something is live" motion cue on a hue
	     that must stay quiet. -->
	{@const isActiveBlue = step.state !== 'baking' && step.state !== 'retrying'}
	<span
		class="cl-dot {isActiveBlue ? 'bg-active-solid animate-pulse' : 'bg-progress-solid'}"
		aria-hidden="true"
	></span>
{/if}

<style>
	.cd-bead {
		position: relative;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		padding: 0 7px 0 3px;
		border-radius: 10px;
		background: var(--k-surface);
		font: 400 12px/16px var(--font-mono, ui-monospace, monospace);
		color: var(--k-fg-muted);
		white-space: nowrap;
	}
	:global(.dark) .cd-bead { background: var(--k-ground); }
	.cd-bead--nomark { padding-left: 7px; }
	a.cd-bead:hover { background: var(--k-hover); color: var(--k-fg); }
	.cd-x { font-family: var(--font-sans, inherit); color: var(--k-fg-subtle); font-weight: 500; }
	.cd-bead--failed { background: color-mix(in srgb, var(--k-danger-tint) 45%, var(--k-surface)); color: var(--k-fg); }
	:global(.dark) .cd-bead--failed { background: var(--k-danger-tint); }
	.cd-bead--yours { background: var(--k-held-tint); color: var(--k-fg); }
	/* 8px — the fleet track's stop dot (Home redesign 2): the same picture,
	   at the same size, wherever a build's progress is drawn. */
	.cl-dot {
		display: inline-block;
		height: 8px;
		width: 8px;
		border-radius: 9999px;
		flex-shrink: 0;
	}

	/* Not there yet: the hollow ring of the fleet track. */
	.cl-dot--ring {
		background: transparent;
		box-shadow: inset 0 0 0 1.5px var(--k-fg-disabled);
	}

	/* `not-built`, or a family the change cannot have reached yet (past the
	   frontier), or a resolved (rolled-back) family — no fill, no ring
	   colour (state-only, never identity — the same rule `LandingMark`'s
	   own `.lm--dashed` states). */
	.cl-dot--dashed {
		border: 1.5px dashed var(--k-fg-disabled);
		background: transparent;
	}

	:global(.dark) .cl-dot--dashed {
		border-color: var(--k-fg-subtle);
	}

	/* Partial-live — some cells in this family are live, none are
	   stuck/failed (a rolled-back region among them reads this too, since
	   D3: the family is not settled while something else in it is still
	   genuinely live) — a green RING (not a filled disc) says "getting
	   there", never a second hue for a state that is still, honestly,
	   green. */
	.cl-dot--live-ring {
		border: 1.5px solid var(--k-success-solid);
		background: transparent;
	}
</style>
