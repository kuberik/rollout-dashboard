<svelte:options runes={true} />

<script lang="ts" module>
	export type { DetailRow } from '$lib/view-models/detail-rows';
</script>

<script lang="ts">
	/**
	 * THE REPORT BANNER (signed "Q1L", rollback glance 2026-11-27). Role: the one statement at the top of a rollout page that says
	 * what the controller did or refused to do about a deploy: "Rolled back automatically", "Failed, not rolled back",
	 * "Deploy refused". Every rollout-page report banner renders through this one component (the rollback glance, the failure
	 * panel via `StatementBanner`, the refused deploy, the dependency banners), so none can drift.
	 *
	 * Why not `AlertPanel`: that is the filled attention field (tinted ground, 40px disc, three text tiers) the owner called
	 * "very poorly styled" for a report. A report is quiet: it is the SAME surface as the cards under it (`Card`'s radius, 1px
	 * border and `bg-surface`), and only the state carries colour.
	 *
	 * Reference regions: the `Card` shell (8px radius, 1px `border-line`, `bg-surface`, 16px gutter, 16px mark + 8px gap so the
	 * text track starts where a card title starts), the header buttons (`.btn`, 36px) and the `Details ›` disclosure
	 * (`GlanceSplit`'s toggle: chevron, `t-ui-sm`). Proportions come from `Card`'s header, not from a new scale.
	 *
	 * Shape: two text lines. Line 1 is the title at `t-card-title`. Line 2 is ONE sentence of 12 words or fewer, then `Details ›`;
	 * versions in it are drawn in the code role (`move`, or `\`2.4.0\`` in the string). No age (the page header has it), no chips,
	 * no second sentence. The failure list, severity words and the controller's facts sit in Details.
	 *   live failure or block  1px danger outline + 16px mark in the danger hue (`tone="danger"`)
	 *   a rollback that worked 1px normal card border; the mark keeps the hue (`tone="neutral"`)
	 * Buttons: at most two visible (`ActRow`, `.btn`, primary rightmost) on the right of the title row; the rest go in "⋯".
	 * Below 640px OF THE BANNER the buttons span the bottom (44px), `Details ›` moves to the right of the title row, and the
	 * opened Details sits above the buttons. A button label never carries a version ("Roll back", "Deploy anyway").
	 */
	import type { Component, Snippet, ComponentProps } from 'svelte';
	import { ArrowRightOutline, ChevronRightOutline } from 'flowbite-svelte-icons';
	import { canHover } from '$lib/can-hover.svelte';
	import { blur } from 'svelte/transition';
	import { Tooltip } from 'flowbite-svelte';
	import ActRow, { type Act } from './ActRow.svelte';
	import type { DetailRow } from '$lib/view-models/detail-rows';

	interface Props {
		/** the banner's condition: false collapses it out (300 ms) instead of unmounting in one frame */
		open?: boolean;
		tone?: 'danger' | 'neutral';
		icon: Component;
		title: string;
		/** `{from} → {to}`: two versions in the code role, ahead of the sentence */
		move?: { from: string; to: string };
		/** the one sentence; `\`code\`` marks a version, a check or a path */
		line?: string;
		/** Details rows, aligned in shared columns */
		rows?: DetailRow[];
		/** more Details than rows (a conflict, evidence) */
		detailsBody?: Snippet;
		/** the disclosure's word; `Details` unless a set can be counted */
		detailsLabel?: string;
		/** the visible buttons: at most two, primary rightmost */
		primary?: Act;
		secondary?: Act;
		/** everything else: the "⋯" menu, at every width */
		more?: Act[];
		/** hover tooltips by action `id` (desktop only) */
		tooltips?: Record<string, string>;
		/** a line under the buttons (why one is disabled, on touch) */
		note?: string;
		dataTour?: string;
		class?: string;
	}

	const all: Props = $props();
	const open = $derived(all.open ?? true);

	// Props live while open, frozen at their last open values while the banner collapses (same rule as `AlertPanel`).
	// svelte-ignore state_referenced_locally
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

	const tone = $derived(shown.tone ?? 'danger');
	const Icon = $derived(shown.icon);
	const rows = $derived(shown.rows ?? []);
	const detailsBody = $derived(shown.detailsBody);
	const detailsLabel = $derived(shown.detailsLabel ?? 'Details');
	const hasDetails = $derived(rows.length > 0 || !!detailsBody);
	const hasTag = $derived(rows.some((r) => r.tag));
	const primary = $derived(shown.primary);
	const secondary = $derived(shown.secondary);
	const more = $derived(shown.more ?? []);
	const hasActions = $derived(!!primary || !!secondary || more.length > 0);
	const tooltips = $derived(shown.tooltips);
	const note = $derived(shown.note);

	/** "Rolling back to `5.1.0` would break `checkout`" -> text and code parts */
	const parts = $derived((shown.line ?? '').split('`').map((text, i) => ({ text, code: i % 2 === 1 })).filter((p) => p.text));
	const hasLine = $derived(!!shown.move || parts.length > 0);

	let detailsOpen = $state(false);
	const panelId = `cb-${Math.random().toString(36).slice(2, 8)}`;
</script>

{#if open || closing}
	<div
		class="cb-collapse {shown.class ?? 'mb-4'}"
		class:cb-collapse--closing={!open}
		data-tour={shown.dataTour}
		ontransitionend={(e) => {
			if (e.target === e.currentTarget && e.propertyName === 'grid-template-rows' && !open) closing = false;
		}}
	>
		<div class="cb-collapse-inner">
			<div class="cb-cq">
				<section
					class="cb rounded-md border bg-surface text-fg {tone === 'danger' ? 'border-banner-danger-line' : 'border-line'}"
					role={tone === 'danger' ? 'alert' : 'status'}
					data-calm-banner
					data-tone={tone}
				>
					<Icon class="cb-icon h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
					<p class="cb-title t-card-title min-w-0 [overflow-wrap:anywhere]">{shown.title}</p>
					{#if hasLine || hasDetails}
						<div class="cb-row2">
							{#if hasLine}
								<div class="cb-line t-body min-w-0 text-fg-muted [overflow-wrap:anywhere]" data-calm-line>
									<div class="dot-list">
										<div class="dot-list-row flex flex-wrap items-center gap-y-0.5">
											{#if shown.move}
												<span class="flex items-center gap-1.5 whitespace-nowrap" data-calm-move>
													<span class="t-code text-fg-muted">{shown.move.from}</span>
													<ArrowRightOutline class="h-3 w-3 shrink-0 text-fg-subtle" aria-label="replaced by" />
													<span class="t-code text-fg">{shown.move.to}</span>
												</span>
											{/if}
											{#if parts.length > 0}
												<span class="min-w-0">{#each parts as p}{#if p.code}<span class="t-code whitespace-nowrap text-fg">{p.text}</span>{:else}{p.text}{/if}{/each}</span>
											{/if}
										</div>
									</div>
								</div>
							{/if}
							{#if hasDetails}
								<button
									type="button"
									class="cb-details t-ui-sm hit-32 inline-flex shrink-0 items-center gap-1 text-fg-muted hover:text-fg focus-visible:ring-2 focus-visible:ring-line-strong focus-visible:outline-none"
									aria-expanded={detailsOpen}
									aria-controls={panelId}
									onclick={() => (detailsOpen = !detailsOpen)}
									data-calm-details
								>
									{detailsLabel}<ChevronRightOutline class="h-3 w-3 shrink-0 transition-transform {detailsOpen ? 'rotate-90' : ''}" aria-hidden="true" />
								</button>
							{/if}
						</div>
					{/if}
					{#if hasDetails}
						<div class="cb-panel" id={panelId} hidden={!detailsOpen} data-calm-panel>
							{#if rows.length > 0}
								<ul class="cb-rows t-body" class:cb-rows--tag={hasTag}>
									{#each rows as r (r.key)}
										<li class="cb-reow" title={r.title}>
											{#if r.href}
												<a class="cb-name nav-link min-w-0 truncate {r.mono ? 't-code-sm' : ''}" href={r.href} title={r.name}>{r.name}</a>
											{:else}
												<span class="cb-name min-w-0 truncate text-fg {r.mono ? 't-code-sm' : ''}" title={r.name}>{r.name}</span>
											{/if}
											{#if hasTag}<span class="cb-tag t-ui-sm whitespace-nowrap {r.tone === 'danger' ? 'text-danger' : 'text-fg-muted'}">{r.tag ?? ''}</span>{/if}
											<span class="cb-text min-w-0 text-fg-muted [overflow-wrap:anywhere]">{r.text ?? ''}</span>
										</li>
									{/each}
								</ul>
							{/if}
							{#if detailsBody}<div class="cb-body min-w-0">{@render detailsBody()}</div>{/if}
						</div>
					{/if}
					{#if hasActions}
						<div class="cb-acts" inert={!open}>
							<ActRow {primary} secondary={secondary ? [secondary] : []} {more} size="md" equal phoneMax={2} align="end" />
							{#if note}<p class="t-meta basis-full text-fg-muted">{note}</p>{/if}
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
	.cb-cq {
		container-type: inline-size;
	}
	/* wide: mark | text | buttons; the text track starts where a card title starts (16px mark, 8px gap) */
	.cb {
		display: grid;
		grid-template-columns: 16px minmax(0, 1fr) auto;
		column-gap: 8px;
		align-items: start;
		padding: 12px 16px;
	}
	.cb :global(.cb-icon) {
		grid-column: 1;
		grid-row: 1;
		margin-top: 2px;
	}
	.cb-title {
		grid-column: 2;
		grid-row: 1;
	}
	.cb-row2 {
		grid-column: 2;
		grid-row: 2;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 12px;
		min-width: 0;
	}
	.cb-acts {
		grid-column: 3;
		grid-row: 1 / span 2;
		align-self: center;
		margin-left: 16px;
	}
	.cb-panel {
		grid-column: 2 / -1;
		grid-row: 3;
		margin-top: 8px;
		border-top: 1px solid var(--k-line);
		padding-top: 4px;
	}
	.cb-panel[hidden] {
		display: none;
	}
	/* one set of columns for every row: the rows are subgrids of the list */
	.cb-rows {
		display: grid;
		grid-template-columns: fit-content(18rem) minmax(0, 1fr);
		column-gap: 16px;
	}
	.cb-rows--tag {
		grid-template-columns: fit-content(18rem) max-content minmax(0, 1fr);
	}
	.cb-reow {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		align-items: baseline;
		padding: 6px 0;
	}
	.cb-reow + .cb-reow {
		border-top: 1px solid var(--k-line);
	}
	.cb-body {
		padding-top: 6px;
	}
	.cb-rows + .cb-body {
		border-top: 1px solid var(--k-line);
		margin-top: 2px;
	}

	/* phone: the title row carries Details; the sentence, the opened Details and the buttons span the banner */
	@container (max-width: 639px) {
		.cb-row2 {
			display: contents;
		}
		.cb-details {
			grid-column: 3;
			grid-row: 1;
			margin-right: -8px;
		}
		.cb-line {
			grid-column: 1 / -1;
			grid-row: 2;
			margin-top: 4px;
		}
		.cb-panel {
			grid-column: 1 / -1;
			grid-row: 3;
		}
		.cb-acts {
			grid-column: 1 / -1;
			grid-row: 4;
			margin: 12px 0 0;
			align-self: stretch;
		}
		.cb-rows,
		.cb-rows--tag {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.cb-reow {
			row-gap: 2px;
		}
		.cb-text {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}

	/* the collapse: fade, then fold (the same sequence `AlertPanel` uses) */
	.cb-collapse {
		display: grid;
		grid-template-rows: 1fr;
		transition:
			grid-template-rows 300ms cubic-bezier(0.45, 0, 0.55, 1),
			margin 300ms cubic-bezier(0.45, 0, 0.55, 1);
	}
	.cb-collapse--closing {
		grid-template-rows: 0fr;
		margin-bottom: 0 !important;
		transition-delay: 150ms;
	}
	.cb-collapse-inner {
		min-height: 0;
		transition: opacity 150ms ease 300ms;
	}
	.cb-collapse--closing > .cb-collapse-inner {
		opacity: 0;
		transition-delay: 0s;
		overflow: hidden;
	}
	@media (prefers-reduced-motion: reduce) {
		.cb-collapse,
		.cb-collapse--closing,
		.cb-collapse-inner {
			transition: none;
		}
	}
</style>
