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
	 *   [20px status glyph] [title  t-heading                    ] [secondary] [primary]
	 *                       [one line ≤12 words · Details ›      ]
	 *                       [Details panel, behind a hairline    ]
	 * - Severity is the glyph's hue plus, for the three states that need someone, a faint field (28% of the tint, the DL
	 *   §1.12 "trace of hue") and a 1px hue line. `info` and `success` stay on the card surface with the card border: a note
	 *   is not an alarm. No disc, no side bar (side bars are only legal on square elements), no filled area.
	 *     critical  danger   failed, refused, error        warning  amber    stuck (DL: amber means stuck only)
	 *     held      orange   a rule holds it               info     blue     pinned, partial, recovery, a note
	 *     success   green    a recovery that worked
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
		critical: { icon: BangGlyph, disc: `${hueSolid('danger')} text-white`, face: 'field-danger border-banner-danger-line' },
		warning: { icon: BangGlyph, disc: `${hueSolid('warning')} text-gray-900`, face: 'field-warning border-warning-line' },
		held: { icon: HeldGlyph, disc: `${hueSolid('held')} text-white`, face: 'field-held border-held-line' },
		info: { icon: InfoGlyph, disc: `${hueSolid('active')} text-white`, face: 'bg-surface border-line' },
		success: { icon: CheckGlyph, disc: `${hueSolid('success')} text-white`, face: 'bg-surface border-line' }
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
	const primary = $derived(shown.primary);
	const secondary = $derived(shown.secondary === undefined ? [] : Array.isArray(shown.secondary) ? shown.secondary : [shown.secondary]);
	const more = $derived(shown.more ?? []);
	const actions = $derived(shown.actions);
	const toggle = $derived(shown.toggle);
	const hasActs = $derived(!!primary || secondary.length > 0 || more.length > 0);
	const hasActions = $derived(hasActs || !!actions || !!toggle);
	const tooltips = $derived(shown.tooltips);
	const note = $derived(shown.note);

	/** "Rolling back to `5.1.0` would break `checkout`" -> text and code parts */
	const parts = $derived((shown.line ?? '').split('`').map((text, i) => ({ text, code: i % 2 === 1 })).filter((p) => p.text));
	const hasLine = $derived(!!shown.move || parts.length > 0 || !!shown.body);

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
				<section class="bn rounded-md border text-fg {sev.face}" {role} data-banner data-severity={severity}>
					<span class="bn-icon relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full {disc}" aria-hidden="true" data-banner-mark>
						{#if shown.pulse}<span class="bn-halo absolute inset-0 rounded-full opacity-30 {disc}"></span>{/if}
						<Icon class="relative h-3 w-3" />
					</span>
					<div class="bn-head min-w-0">
						{#if shown.heading}{@render shown.heading()}{:else}<p class="t-heading inline text-fg [overflow-wrap:anywhere]" data-banner-title>{shown.title}</p>{/if}
						{#if shown.extra}<span class="bn-extra ml-2 inline-flex align-baseline">{@render shown.extra()}</span>{/if}
					</div>
					{#if hasLine || hasDetails}
						<div class="bn-row2 min-w-0" class:bn-row2--block={!!shown.body}>
							{#if hasLine}
								<div class="bn-line t-body min-w-0 text-fg-muted [overflow-wrap:anywhere]" data-banner-line>
									{#if shown.body}
										{@render shown.body()}
									{:else}
										<span class="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
											{#if shown.move}
												<span class="inline-flex items-center gap-1.5 whitespace-nowrap" data-banner-move>
													<span class="t-code text-fg-muted">{shown.move.from}</span>
													<ArrowRightOutline class="h-3 w-3 shrink-0 text-fg-subtle" aria-label="replaced by" />
													<span class="t-code text-fg">{shown.move.to}</span>
												</span>
												{#if parts.length > 0}<span class="text-fg-subtle" aria-hidden="true">·</span>{/if}
											{/if}
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
	/* glyph | text | buttons. 12px between glyph and text: the text track starts 48px in, on every banner */
	.bn {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		column-gap: 12px;
		align-items: start;
		padding: 12px 16px;
	}
	.bn-icon {
		grid-column: 1;
		grid-row: 1;
		margin-top: 2px; /* centred on the 24px title line */
	}
	.bn-head {
		grid-column: 2;
		grid-row: 1;
		min-height: 24px;
	}
	.bn-row2 {
		grid-column: 2;
		grid-row: 2;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 12px;
		row-gap: 2px;
		margin-top: 2px;
	}
	/* a body block: Details follows its LAST line, inline, and wraps under it only when the line is full */
	.bn-row2--block {
		align-items: last baseline;
	}
	/* THE action position: the first button row is centred on the title line (32px button on a 24px line), always */
	.bn-acts {
		grid-column: 3;
		grid-row: 1 / span 2;
		align-self: start;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: 4px 12px;
		margin: -4px 0 0 16px;
		max-width: 28rem;
	}
	.bn-note {
		text-align: right;
	}
	/* every control in the column is the banner's height (DL §3.6: 32px inside a banner), whoever drew it */
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
	/* the primary is the last button and "⋯" closes the row at EVERY width, so the phone row reads like the desktop one */
	.bn-acts :global(.ar-end .btn-primary) {
		order: 1;
	}
	.bn-acts :global(.ar-end .ar-more) {
		order: 2;
	}
	.bn-panel {
		grid-column: 2 / -1;
		grid-row: 3;
		margin-top: 10px;
		border-top: 1px solid var(--k-line);
		padding-top: 4px;
	}
	.bn[data-severity='critical'] .bn-panel,
	.bn[data-severity='warning'] .bn-panel,
	.bn[data-severity='held'] .bn-panel {
		border-top-color: color-mix(in oklab, currentColor 12%, transparent);
	}
	.bn-panel[hidden] {
		display: none;
	}
	/* one set of columns for every row: the rows are subgrids of the list */
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

	/* phone: the text spans past the glyph's column, the buttons become a full-width row at the bottom */
	@container (max-width: 639px) {
		.bn {
			padding: 12px;
		}
		.bn-row2 {
			grid-column: 2 / -1;
		}
		.bn-head {
			grid-column: 2 / -1;
		}
		.bn-panel {
			grid-column: 1 / -1;
		}
		.bn-acts {
			grid-column: 1 / -1;
			grid-row: 4;
			margin: 12px 0 0;
			max-width: none;
			justify-content: stretch;
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
			min-height: 44px;
		}
		.bn-own :global(.btn),
		.bn-own :global(.nav-link) {
			flex: 1 1 auto;
			height: 44px;
			min-height: 44px;
			justify-content: center;
		}
		.bn-acts :global(.ar .btn) {
			height: 44px;
			min-height: 44px;
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
