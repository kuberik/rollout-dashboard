<svelte:options runes={true} />

<script lang="ts" module>
	import type { DetailRow } from '$lib/view-models/detail-rows';
	export type { DetailRow };
	export type BannerSeverity = 'critical' | 'warning' | 'held' | 'info' | 'success';
</script>

<script lang="ts">
	/**
	 * THE BANNER (banners system, 2026-11-27). Role: the one statement a page makes about its subject's state — a failure, a
	 * rollback, a refusal, a hold, a pin, a partial answer. Every in-page banner in the product renders through this shell
	 * (`AlertPanel`, `StatementBanner`, `BlockingStoryPanel`, `ErrorState`, `PartialDataNotice`, `ReleaseSourceNotice`,
	 * `FailurePanel` and the rollout page's report banners), so the anatomy and the button position cannot drift.
	 *
	 * Why a new shell: the product had two (`AlertPanel`'s filled field with a 40px disc, and `CalmBanner`'s neutral card),
	 * and their buttons sat in four different places (right column centred on 2 or 3 rows, a bottom row indented to the
	 * text, a full-width bottom row). The owner rejected both looks ("busy", "too calm") and the drifting buttons.
	 *
	 * Anatomy (borrows Primer Banner and Atlassian section message; proportions from `Card`'s header):
	 *   STATEMENT (glyph, title, one sentence, Details)  |  SHAPE (the drawn facts)  |  ACT (buttons, fixed at the right)
	 *   Below 640px OF THE BANNER the three cells stack: statement, shape under the text, then a 44px button row.
	 * - Every severity is a tinted field with a 1px hue line and the status glyph (the owner: info and success are coloured
	 *   too). Corner radius is the cards' (rounded-md, 8px). No disc beyond the 20px mark, no side bar (side bars are only
	 *   legal on square elements).
	 *     critical  danger   failed, refused, error        warning  amber    stuck (DL: amber means stuck only)
	 *     held      orange   a rule holds it               info     blue     pinned, partial, a note, "Rolled back" (the system acted)
	 *     success   green    DONE only: a recovery, an approval, a finished step; "Rolled back" is never success
	 * - ONE action position: the buttons are a right-hand column whose first row is centred on the TITLE line, whatever the
	 *   body holds or whether Details is open, so a reader's eye finds them in the same place on every banner. Primary is
	 *   rightmost, at most two visible, the rest in "⋯". Below 640px OF THE BANNER they become a full-width 44px row at the
	 *   bottom (`ActRow`'s phone row). Labels never carry a version ("Roll back", not "Roll back to 5.1.0").
	 * - Copy: a short title, then at most one sentence of 12 words or fewer; shaped facts are drawn (`move` 2.4.0 → 2.3.0,
	 *   `code` spans); lists, reasons and the controller's own words go behind `Details`.
	 */
	import type { Component, Snippet } from 'svelte';
	import { ArrowRightOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
	import { canHover } from '$lib/can-hover.svelte';
	import { blur } from 'svelte/transition';
	import { Tooltip } from 'flowbite-svelte';
	import ActRow, { type Act } from './ActRow.svelte';
	import HeldGlyph from './HeldGlyph.svelte';
	import BangGlyph from './BangGlyph.svelte';
	import InfoGlyph from './InfoMarkGlyph.svelte';
	import CheckGlyph from './CheckMarkGlyph.svelte';
	import { hueSolid } from '$lib/view-models/state-tone';

	interface Props {
		/** the banner's condition: false collapses it out (300 ms) instead of unmounting in one frame */
		open?: boolean;
		severity?: BannerSeverity;
		/** the status glyph; each severity has a default */
		icon?: Component;
		/** the disc's hue when it differs from the banner's (a rollback that worked: an info banner whose undo mark is red) */
		markTone?: BannerSeverity;
		title?: string;
		/** a title that is more than a string (a gate's source chip); replaces `title` */
		heading?: Snippet;
		/** a small fact after the title on its line (an age, "Rechecking every 30s") */
		extra?: Snippet;
		/** `{from} → {to}`: two versions in the code role, ahead of the sentence */
		move?: { from: string; to: string };
		/** the drawn facts (chips and arrows) in the middle cell; `move` is drawn there too */
		shape?: Snippet;
		/** the one sentence; `\`code\`` marks a version, a check or a path */
		line?: string;
		/** the body when it is more than a sentence (a measured figure, a check line); renders in the line's place */
		body?: Snippet;
		/** Details rows, aligned in shared columns */
		rows?: DetailRow[];
		/** more Details than rows (a conflict, evidence, a record) */
		detailsBody?: Snippet;
		/** the disclosure's word; `Details` unless a set can be counted */
		detailsLabel?: string;
		/** the visible buttons: at most two, primary rightmost */
		primary?: Act;
		secondary?: Act | Act[];
		/** everything else: the "⋯" menu, at every width */
		more?: Act[];
		/** buttons a caller draws itself (an Approve button with its own state); same slot, same position */
		actions?: Snippet;
		/** hover tooltips by action `id` (desktop only) */
		tooltips?: Record<string, string>;
		/** a line under the buttons (why one is disabled, on touch) */
		note?: string;
		/** a chevron at the end of the action column that opens the subject in place (a list's lead statement) */
		toggle?: { open: boolean; onclick: () => void; label: string; controls?: string };
		/** the subject is live right now (a deploy failing as you look): the glyph carries a halo */
		pulse?: boolean;
		role?: 'alert' | 'status';
		dataTour?: string;
		class?: string;
	}

	// every prop is read through `shown` (frozen while the banner collapses), which the rule cannot follow
	// eslint-disable-next-line svelte/no-unused-props
	const all: Props = $props();
	const open = $derived(all.open ?? true);

	// Props live while open, frozen at their last open values while the banner collapses.
	let shown = $state.raw<Props>({ ...all });
	let closing = $state(false);
	let wasOpen = false;
	$effect.pre(() => {
		const isOpen = open;
		const snapshot = { ...all };
		if (isOpen) {
			shown = snapshot;
			wasOpen = true;
			closing = false;
			return;
		}
		if (!wasOpen) return;
		wasOpen = false;
		closing = true;
		const t = setTimeout(() => (closing = false), 900);
		return () => clearTimeout(t);
	});

	/* the mark is the product's status disc (StatusMark's grammar) at 20px: a solid hue with a white glyph */
	const SEV = {
		critical: { icon: BangGlyph, disc: `${hueSolid('danger')} text-white`, face: 'bn-f-danger border-banner-danger-line' },
		warning: { icon: BangGlyph, disc: `${hueSolid('warning')} text-gray-900`, face: 'bn-f-warning border-warning-line' },
		held: { icon: HeldGlyph, disc: `${hueSolid('held')} text-white`, face: 'bn-f-held border-held-line' },
		info: { icon: InfoGlyph, disc: `${hueSolid('active')} text-white`, face: 'bn-f-info border-active-line' },
		success: { icon: CheckGlyph, disc: `${hueSolid('success')} text-white`, face: 'bn-f-success border-success-line' }
	} as const;

	const severity = $derived(shown.severity ?? 'info');
	const sev = $derived(SEV[severity]);
	const disc = $derived(SEV[shown.markTone ?? severity].disc);
	const Icon = $derived(shown.icon ?? SEV[shown.markTone ?? severity].icon);
	const role = $derived(shown.role ?? (severity === 'critical' ? 'alert' : 'status'));
	const rows = $derived(shown.rows ?? []);
	const detailsBody = $derived(shown.detailsBody);
	const detailsLabel = $derived(shown.detailsLabel ?? 'Details');
	const hasDetails = $derived(rows.length > 0 || !!detailsBody);
	const hasTag = $derived(rows.some((r) => r.tag));
	// a-tweak: text-only buttons (a disclosure chevron after the label stays)
	const plain = (a?: Act): Act | undefined => (a && !a.iconAfter ? { ...a, icon: undefined } : a);
	const primary = $derived(plain(shown.primary));
	const secondary = $derived((shown.secondary === undefined ? [] : Array.isArray(shown.secondary) ? shown.secondary : [shown.secondary]).map((a) => plain(a)!));
	const more = $derived((shown.more ?? []).map((a) => plain(a)!));
	// throwaway switch for the owner's review: ?bv=d1..d5 (default d1), all one continuous surface
	const variant = (() => { const v = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('bv') : null; return v === 'd2' || v === 'd3' || v === 'd4' || v === 'd5' ? v : 'd1'; })();
	const actions = $derived(shown.actions);
	const toggle = $derived(shown.toggle);
	const hasActs = $derived(!!primary || secondary.length > 0 || more.length > 0);
	const hasActions = $derived(hasActs || !!actions || !!toggle);
	const tooltips = $derived(shown.tooltips);
	const note = $derived(shown.note);

	/** "Rolling back to `5.1.0` would break `checkout`" -> text and code parts */
	const parts = $derived((shown.line ?? '').split('`').map((text, i) => ({ text, code: i % 2 === 1 })).filter((p) => p.text));
	const hasLine = $derived(parts.length > 0 || !!shown.body);
	const hasShape = $derived(!!shown.move || !!shown.shape);

	let detailsOpen = $state(false);
	const panelId = `bn-${Math.random().toString(36).slice(2, 8)}`;
</script>

{#if open || closing}
	<div
		class="bn-collapse {shown.class ?? 'mb-4'}"
		class:bn-collapse--closing={!open}
		data-tour={shown.dataTour}
		ontransitionend={(e) => {
			if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows' && !open) closing = false;
		}}
	>
		<div class="bn-collapse-inner">
			<div class="bn-cq">
				<section class="bn rounded-md border text-fg {sev.face}" class:bn--acts={hasActions} class:is-open={detailsOpen} data-variant={variant} {role} data-banner data-severity={severity}>
					<div class="bn-st">
					<span class="bn-icon relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full {disc}" aria-hidden="true" data-banner-mark>
						{#if shown.pulse}<span class="bn-halo absolute inset-0 rounded-full opacity-30 {disc}"></span>{/if}
						<Icon class="relative h-3 w-3" />
					</span>
						<div class="bn-txt min-w-0">
					<div class="bn-head min-w-0">
						{#if shown.heading}{@render shown.heading()}{:else}<p class="t-heading inline text-fg [overflow-wrap:anywhere]" data-banner-title>{shown.title}</p>{/if}
						{#if shown.extra}<span class="bn-extra ml-2 inline-flex align-baseline">{@render shown.extra()}</span>{/if}
											{#if hasDetails}<button type="button" class="bn-details bn-det-ph t-ui-sm hit-32 items-center gap-1 text-fg-muted hover:text-fg" aria-expanded={detailsOpen} aria-controls={panelId} onclick={() => (detailsOpen = !detailsOpen)}>{detailsLabel}<ChevronRightOutline class="h-3 w-3 shrink-0 transition-transform {detailsOpen ? 'rotate-90' : ''}" aria-hidden="true" /></button>{/if}
					</div>
					{#if hasLine || hasDetails || hasShape}
						<div class="bn-row2 min-w-0" class:bn-row2--block={!!shown.body}>
							{#if hasShape}
								<span class="bn-sh" data-banner-shape>
									{#if shown.move}
										<span class="bn-chip bn-chip--old t-code-sm" data-banner-move>{shown.move.from}</span>
										<ArrowRightOutline class="h-3.5 w-3.5 shrink-0 text-fg-subtle" aria-label="replaced by" />
										<span class="bn-chip t-code-sm">{shown.move.to}</span>
									{/if}
									{#if shown.shape}{@render shown.shape()}{/if}
								</span>
							{/if}
							{#if hasLine}
								<div class="bn-line t-body min-w-0 text-fg-muted [overflow-wrap:anywhere]" data-banner-line>
									{#if shown.body}
										{@render shown.body()}
									{:else}
										<span class="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
											{#if parts.length > 0}
												<span class="min-w-0">{#each parts as p, i (i)}{#if p.code}<span class="t-code whitespace-nowrap text-fg">{p.text}</span>{:else}{p.text}{/if}{/each}</span>
											{/if}
										</span>
									{/if}
								</div>
							{/if}
							{#if hasDetails}
								<button
									type="button"
									class="bn-details t-ui-sm hit-32 inline-flex shrink-0 items-center gap-1 text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-line-strong focus-visible:outline-none"
									aria-expanded={detailsOpen}
									aria-controls={panelId}
									onclick={() => (detailsOpen = !detailsOpen)}
									data-banner-details
								>
									{detailsLabel}<ChevronRightOutline class="h-3 w-3 shrink-0 transition-transform {detailsOpen ? 'rotate-90' : ''}" aria-hidden="true" />
								</button>
							{/if}
						</div>
					{/if}
						</div>
					</div>
					{#if hasDetails}
						<div class="bn-panel" id={panelId} hidden={!detailsOpen} data-banner-panel>
							{#if rows.length > 0}
								<ul class="bn-rows t-body" class:bn-rows--tag={hasTag}>
									{#each rows as r (r.key)}
										<li class="bn-reow" title={r.title}>
											{#if r.href}
												<a class="bn-name nav-link min-w-0 truncate {r.mono ? 't-code' : ''}" href={r.href} title={r.name}>{r.name}</a>
											{:else}
												<span class="bn-name min-w-0 truncate text-fg {r.mono ? 't-code' : ''}" title={r.name}>{r.name}</span>
											{/if}
											{#if hasTag}<span class="bn-tag t-ui-sm whitespace-nowrap {r.tone === 'danger' ? 'text-danger' : 'text-fg-muted'}">{r.tag ?? ''}</span>{/if}
											<span class="bn-text min-w-0 text-fg-muted [overflow-wrap:anywhere]">{r.text ?? ''}</span>
										</li>
									{/each}
								</ul>
							{/if}
							{#if detailsBody}<div class="bn-body min-w-0 t-body text-fg-muted">{@render detailsBody()}</div>{/if}
						</div>
					{/if}
					{#if hasActions}
						<div class="bn-acts" inert={!open}>
							{#if hasActs}
								<ActRow {primary} {secondary} {more} size="sm" equal phoneMax={2} align="end" />
							{/if}
							{#if actions}<div class="bn-own flex flex-wrap items-center justify-end gap-3">{@render actions()}</div>{/if}
							{#if toggle}
								<button
									type="button"
									class="btn btn-ghost btn-sm btn-icon bn-toggle"
									aria-expanded={toggle.open}
									aria-controls={toggle.controls}
									aria-label={toggle.label}
									onclick={toggle.onclick}
								>
									<ChevronRightOutline class="h-4 w-4 transition-transform {toggle.open ? 'rotate-90' : ''}" aria-hidden="true" />
								</button>
							{/if}
							{#if note}<p class="bn-note t-meta basis-full text-fg-muted">{note}</p>{/if}
							{#if canHover.current && tooltips}
								{#each Object.entries(tooltips) as [id, text] (id)}
									<Tooltip triggeredBy="#{id}" placement="bottom" class="max-w-xs" transition={blur} transitionParams={{ duration: 300 }}>{text}</Tooltip>
								{/each}
							{/if}
						</div>
					{/if}
				</section>
			</div>
		</div>
	</div>
{/if}

<style>
	.bn-cq {
		container-type: inline-size;
	}
	/* c-redesign r2: one tinted field with a 1px hue line; the text column, then the buttons fixed at the right edge. No cells, no dividers. */
	.bn {
		
		--h-tint: var(--k-active-tint);
		--h-line: var(--k-active-line);
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-items: start;
		border-color: var(--h-line);
		background: color-mix(in oklab, var(--h-tint) var(--h-mix, 62%), var(--k-surface));
		overflow: hidden;
	}
	.bn--acts {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.bn[data-severity='critical'] { --h-tint: var(--k-danger-tint); --h-line: var(--k-banner-danger-line); }
	.bn[data-severity='warning'] { --h-tint: var(--k-warning-tint); --h-line: var(--k-warning-line); }
	.bn[data-severity='held'] { --h-tint: var(--k-held-tint); --h-line: var(--k-held-line); }
	.bn[data-severity='success'] { --h-tint: var(--k-success-tint); --h-line: var(--k-success-line); }
	.bn-st,
	.bn-acts {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.bn-st {
		padding: 12px 16px;
	}
	/* desktop: the buttons are centred vertically across the statement rows and sit flush right (same inset on every banner) */
	.bn-acts {
		align-self: center; /* centred on the closed statement rows; the Details panel is a later grid row, so opening it never moves the buttons */
		padding: 8px 16px 8px 0;
	}
	.bn-st {
		align-items: flex-start;
		gap: 12px;
	}
	.bn-txt {
		flex: 1 1 auto;
	}
	.bn-icon {
		margin-top: 2px; /* centred on the 24px title line */
	}
	.bn-head {
		min-height: 24px;
	}
	.bn-row2 {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 12px;
		row-gap: 2px;
		margin-top: 2px;
	}
	.bn-row2--block {
		align-items: last baseline;
	}
	.bn-det-ph {
		display: none;
	}
	/* SHAPE: the facts drawn, inline in the text column ahead of the sentence */
	.bn-sh {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.bn-chip,
	.bn-sh :global(.bn-ent) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 8px;
		border-radius: 6px;
		background: var(--k-surface);
		border: 1px solid color-mix(in oklab, var(--h-line) 70%, var(--k-line));
		white-space: nowrap;
	}
	/* a drawn entity (a name chip) takes t-ui-sm's metrics; the version chips carry the t-code-sm class */
	.bn-sh :global(.bn-ent) {
		font: 500 12px/16px var(--font-sans);
	}
	.bn-chip--old {
		color: var(--k-fg-muted);
		text-decoration: line-through;
		text-decoration-color: color-mix(in oklab, var(--k-fg-muted) 60%, transparent);
	}
	/* ACT: the buttons at the right edge, centred on the banner's height */
	.bn-acts {
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 4px 12px;
	}
	.bn-note {
		text-align: right;
	}
	.bn-acts :global(.btn),
	.bn-acts :global(.nav-link) {
		height: 32px;
		min-height: 32px;
	}
	.bn-acts :global(.nav-link) {
		display: inline-flex;
		align-items: center;
		padding-top: 0;
		padding-bottom: 0;
	}
	.bn-acts :global(.ar-end .btn-primary) {
		order: 1;
	}
	.bn-acts :global(.ar-end .ar-more) {
		order: 2;
	}
	.bn-panel {
		grid-column: 1 / -1;
		padding: 0 16px 12px 48px;
		order: 5;
	}
	.bn-panel[hidden] {
		display: none;
	}
	.bn-rows {
		display: grid;
		grid-template-columns: fit-content(18rem) minmax(0, 1fr);
		column-gap: 16px;
	}
	.bn-rows--tag {
		grid-template-columns: fit-content(18rem) max-content minmax(0, 1fr);
	}
	.bn-reow {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		align-items: baseline;
		padding: 6px 0;
	}
	.bn-reow + .bn-reow {
		border-top: 1px solid color-mix(in oklab, currentColor 10%, transparent);
	}
	.bn-body {
		padding-top: 6px;
	}
	.bn-rows + .bn-body {
		margin-top: 2px;
	}
	.bn-halo {
		animation: bn-halo-ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite;
	}
	@keyframes bn-halo-ping {
		75%,
		100% {
			transform: scale(1.9);
			opacity: 0;
		}
	}

	/* phone: statement, shape under the text track, buttons in a 44px row under a hairline; Details joins the title row */
	@container (max-width: 639px) {
		.bn,
		.bn--acts {
			grid-template-columns: minmax(0, 1fr);
		}
		.bn-st {
			padding: 12px;
		}
		.bn-head {
			display: flex;
			align-items: baseline;
			gap: 8px;
		}
		.bn-det-ph {
			display: inline-flex;
			margin-left: auto;
		}
		.bn-row2 .bn-details {
			display: none;
		}
		.bn-acts {
			order: 2;
			align-self: stretch;
			padding: 0 12px 12px;
			justify-content: stretch;
		}
		.bn-panel {
			order: 3;
			padding: 0 12px 12px 44px;
		}
		.bn-acts > :global(*) {
			flex: 1 1 100%;
		}
		.bn-own {
			flex-wrap: nowrap;
			gap: 8px;
		}
		.bn-own > :global(*) {
			flex: 1 1 0;
			display: flex;
		}
		.bn-own :global(.btn),
		.bn-own :global(.nav-link),
		.bn-acts :global(.ar .btn) {
			flex: 1 1 0;
			min-width: 0;
			height: 44px;
			min-height: 44px;
			justify-content: center;
		}
		.bn-acts :global(.ar-more) {
			flex: 0 0 44px;
		}
		.bn-acts :global(.ar-more-btn) {
			width: 44px;
			min-width: 44px;
		}
		.bn-note {
			text-align: left;
		}
		.bn-rows,
		.bn-rows--tag {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.bn-reow {
			row-gap: 2px;
		}
		.bn-text {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}

	/* ---- the owner's review variants of D (?bv=d1..d4); d1 is the base above ---- */
	/* d2: stronger tint, icon-led */
	.bn[data-variant='d2'] { --h-mix: 90%; }
	/* d3: compact one line, OUTLINE buttons (the primary is drawn as an outline too) */
	.bn[data-variant='d3'] :global(.bn-acts .btn-primary) {
		background: var(--k-surface);
		color: var(--k-fg);
		border: 1px solid var(--h-line);
	}
	/* d4: light tint, the glyph in a tinted rounded-sm square */
	.bn[data-variant='d4'] { --h-mix: 38%; }
	/* d5: SQUARE corners (a side bar is only legal on a square element): 3px hue bar on the left, light tint, a bare hue glyph, no disc */
	.bn[data-variant='d5'] {
		--h-mix: 34%;
		border-radius: 0;
		border-left: 3px solid var(--h-line);
	}
	.bn[data-variant='d5'] .bn-icon {
		background: transparent;
		color: color-mix(in oklab, var(--h-line) 70%, var(--k-fg));
		width: 24px;
		height: 24px;
		margin-top: 0;
	}
	.bn[data-variant='d5'] .bn-icon :global(svg) {
		width: 20px;
		height: 20px;
	}
	@container (min-width: 640px) {
		.bn[data-variant='d5'] .bn-st {
			align-items: center;
		}
	}
	/* d2 icon: stronger hierarchy: a 24px solid disc, generous padding, a consistent height */
	.bn[data-variant='d2'] .bn-icon {
		width: 24px;
		height: 24px;
		margin-top: 0;
	}
	.bn[data-variant='d2'] .bn-icon :global(svg) {
		width: 14px;
		height: 14px;
	}
	/* d4: the glyph in a 32px tinted rounded square (hue tint, hue icon), not a solid disc */
	.bn[data-variant='d4'] .bn-icon {
		width: 32px;
		height: 32px;
		margin-top: 0;
		border-radius: 4px;
		background: color-mix(in oklab, var(--h-line) 32%, var(--k-surface));
		color: color-mix(in oklab, var(--h-line) 65%, var(--k-fg));
	}
	.bn[data-variant='d4'] .bn-icon :global(svg) {
		width: 16px;
		height: 16px;
	}
	@container (min-width: 640px) {
		.bn[data-variant='d2'] {
			min-height: 80px;
		}
		.bn[data-variant='d2'] .bn-st {
			padding: 16px;
			align-items: center;
		}
		.bn[data-variant='d2'] .bn-acts {
			padding: 16px 16px 16px 0;
		}
		.bn[data-variant='d2'] .bn-panel {
			padding-left: 52px;
		}
		.bn[data-variant='d4'] .bn-st {
			padding: 12px 16px;
			align-items: center;
		}
		.bn[data-variant='d4'] .bn-panel {
			padding-left: 60px;
		}
		/* d3: title and the one sentence on ONE line, sentence muted after a separator; wraps gracefully */
		.bn[data-variant='d3'] .bn-st {
			padding: 14px 16px;
			align-items: center;
		}
		.bn[data-variant='d3'] .bn-txt {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			column-gap: 12px;
		}
		.bn[data-variant='d3'] .bn-row2 {
			margin-top: 0;
			flex: 0 1 auto;
		}
		.bn[data-variant='d3'] .bn-row2:not(.bn-row2--block)::before {
			content: '\00b7';
			color: var(--k-fg-subtle);
			margin-right: 0;
		}
		.bn[data-variant='d3'] .bn-acts {
			padding: 10px 16px 10px 0;
		}
	}
	@container (max-width: 639px) {
		.bn[data-variant='d2'] .bn-panel {
			padding-left: 48px;
		}
		.bn[data-variant='d4'] .bn-panel {
			padding-left: 56px;
		}
	}

	/* the collapse: fade, then fold */
	.bn-collapse {
		display: grid;
		grid-template-rows: 1fr;
		transition:
			grid-template-rows 300ms cubic-bezier(0.45, 0, 0.55, 1),
			margin 300ms cubic-bezier(0.45, 0, 0.55, 1);
	}
	.bn-collapse--closing {
		grid-template-rows: 0fr;
		margin-bottom: 0 !important;
		transition-delay: 150ms;
	}
	.bn-collapse-inner {
		min-height: 0;
		transition: opacity 150ms ease 300ms;
	}
	.bn-collapse--closing > .bn-collapse-inner {
		opacity: 0;
		transition-delay: 0s;
		overflow: hidden;
	}
	@media (prefers-reduced-motion: reduce) {
		.bn-collapse,
		.bn-collapse--closing,
		.bn-collapse-inner {
			transition: none;
		}
		.bn-halo {
			animation: none;
		}
	}
</style>
