<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ONE STATEMENT BANNER. Role: the page's single blocking/attention statement —
	 * a deployment failed, an approval is waiting, a place is held, checks are running.
	 * Pages pass CONTENT; the shell, the meta line and the action row's responsive
	 * behaviour live here so no page can diverge.
	 *
	 * Owner ruling 2026-11-02 (reviewing on a phone): the app page crammed three
	 * stacked full-width buttons in a column indented past the icon while /rollouts'
	 * failing lead had a 40px mark · title · chevron, a meta line "prod-eu-west ·
	 * Since 9h" and ONE action row spanning the card's inner width (primary flex-1,
	 * one compact secondary, the rest behind "⋯"). That lead is the reference; this
	 * is it as a component.
	 *
	 * Why not a new base: AlertPanel stays the base (never wrapped or overridden from
	 * outside). This component only composes it in its `actionBar` mode and fills its
	 * slots: `messageBody` carries the check line, the meta line (place chip · Since ·
	 * build) and the sentence; `actions` is `ActRow`. Proportions: the tab's signed
	 * banner (AlertPanel, 40px disc, 14px body).
	 *
	 * Disclosure (r34 S1b): `toggle` puts the one 44px chevron at the corner (AlertPanel owns it)
	 * for the statements that open in place (/needs-you, the Changes lead). `plain` is the same
	 * statement at rest in a LIST (neutral surface, no field): /needs-you's second and third
	 * cards. `slots` orders the meta line build · place · since · cause; it is one .dot-list at every width.
	 */
	import AlertPanel from './AlertPanel.svelte';
	import ActRow, { type Act } from './ActRow.svelte';
	import Chip from './Chip.svelte';
	import FailedCheckLine from './FailedCheckLine.svelte';
	import HeldGlyph from './HeldGlyph.svelte';
	import ObservationFigure from './ObservationFigure.svelte';
	import { failingLead } from '$lib/view-models/attention';
	import type { HealthObservation } from '$lib/../types';
	import { canHover } from '$lib/can-hover.svelte';
	import { blur } from 'svelte/transition';
	import { Tooltip } from 'flowbite-svelte';
	import type { ComponentProps, Snippet } from 'svelte';

	export type { Act };
	type Severity = 'failed' | 'approval' | 'held' | 'checking' | 'info';

	let {
		severity,
		title,
		check,
		checkInk = true,
		observations = null,
		message,
		messageDesktopOnly = false,
		place,
		since,
		sinceLabel = 'Since',
		build,
		buildDesktopOnly = false,
		cause,
		causeDesktopOnly = false,
		slots = false,
		plain = false,
		follow = false,
		compact = false,
		checkAfterMeta = false,
		fact,
		toggle,
		age,
		body,
		primary,
		secondary = [],
		openHref,
		phoneMax = 2,
		note,
		tooltips,
		open = true,
		pulse = false,
		footnoteLabel,
		footnoteBody,
		class: className = 'mb-0'
	}: {
		severity: Severity;
		title: string;
		/** the failing check: printed as the tab prints it (red mark · name · message) */
		check?: { name: string; message?: string };
		/** the failing check's HealthCheck observations: a failed banner leads with the first drawable one as a figure (as the failure cards do) and the check line keeps its name + the budget */
		observations?: HealthObservation[] | null;
		checkInk?: boolean;
		/** one sentence under the title (what the wait or hold means) */
		message?: string;
		/** phone shows less (owner §5): the sentence is one tap away on the rollout, not printed below 640 */
		messageDesktopOnly?: boolean;
		/** the place this statement is about: an env chip */
		place?: { label: string; theme?: ComponentProps<typeof Chip>['theme'] };
		/** time in this state, already formatted ("9h"); prints "Since 9h" */
		since?: string;
		/** the word before the time: "Since 9h" (a failure, a place held) or "Waiting 19m" (an approval) */
		sinceLabel?: string;
		/** the one build this statement is about (mono) */
		build?: string;
		/** phone shows less (owner §5): the build is one tap away */
		buildDesktopOnly?: boolean;
		/** the one line of consequence on the meta line (the check's message, the approval's scope) */
		cause?: string;
		causeDesktopOnly?: boolean;
		/** fixed tracks on the meta line from 640 (build | place | since | cause) */
		slots?: boolean;
		/** the statement at rest in a list: neutral surface */
		plain?: boolean;
		/** r34 needs-you r2 (additive): the actions follow a 56rem text track instead of flying to the far edge (AlertPanel `follow`) */
		follow?: boolean;
		/** r34 needs-you r2 (additive): title at most two lines, 32px disc below 640, facts truncate instead of wrapping (AlertPanel `compact`) */
		compact?: boolean;
		/** r34 needs-you r2 (additive): the failing check prints UNDER the meta line (title · facts · reason) instead of above it */
		checkAfterMeta?: boolean;
		/** r34 needs-you r2 (additive): the last fact on the meta line as a snippet (a link), in the cause's slot; wins over `cause` */
		fact?: Snippet;
		/** the corner chevron (open in place) */
		toggle?: { open: boolean; onclick: () => void; label: string; controls?: string };
		/** a short fact right after the title (Folio's clock + age) */
		age?: Snippet;
		/** extra rows under the meta line (e.g. one slotted row per failure); they own their own actions via ActRow */
		body?: Snippet;
		primary?: Act;
		secondary?: Act[];
		/** r34: a failure banner is never a dead end. When a failed statement carries no action at all (data.ts actionFor is null for the viewer) this link to the rollout tab is its one quiet action */
		openHref?: string;
		/** how many actions stay on the phone row (the lead + one side by default; 1 = the lead and "⋯") */
		phoneMax?: number;
		/** a line under the actions (why an action is disabled, on touch) */
		note?: string;
		/** hover tooltips by action `id` (desktop only) */
		tooltips?: Record<string, string>;
		open?: boolean;
		pulse?: boolean;
		footnoteLabel?: string;
		footnoteBody?: Snippet;
		class?: string;
	} = $props();

	const tone = $derived(
		severity === 'failed' ? 'error' : severity === 'approval' || severity === 'held' ? 'pinned' : 'info'
	);
	const acts = $derived<Act[]>(severity === 'failed' && !primary && !secondary.length && openHref ? [{ label: 'Open rollout', href: openHref, after: true, key: 'open-rollout' }] : secondary);
	const hasActions = $derived(!!primary || acts.length > 0);
	/* the failure cards' rule (attention.ts): a measured figure leads, and the check line then says the name + the budget instead of repeating the figure in its message */
	const figure = $derived(severity === 'failed' && (check || observations?.length) ? (() => { const l = failingLead(check ?? null, observations); return l.kind === 'check' ? null : l; })() : null);
	const shownCheck = $derived(check && figure?.budget ? { name: check.name, message: figure.budget } : check);
	const hasBody = $derived(!!(figure || check || place || since || build || cause || fact || message || body));
</script>

{#snippet bodySnip()}
			<div class="flex min-w-0 flex-col gap-2" data-statement-body>
				{#if figure}<ObservationFigure fig={figure} />{/if}
				{#if shownCheck && !checkAfterMeta}<FailedCheckLine check={shownCheck} danger ink={checkInk} />{/if}
				{#if place || since || build || cause || fact}
					<!-- one .dot-list row at every width and in every banner (no fixed tracks: a track left a 50px hole between the sha and the badge) -->
					<div class="dot-list min-w-0" data-statement-meta>
						<div class="dot-list-row flex min-w-0 flex-wrap items-center gap-y-1">
							{#if slots}
								{#if build}<span class="t-code sb-build whitespace-nowrap text-fg {buildDesktopOnly ? 'max-sm:hidden' : ''}" data-statement-build>{build}</span>{/if}
								{#if place}<span class="flex items-center"><Chip role="env" label={place.label} theme={place.theme} wide class="shrink-0" /></span>{/if}
								{#if since}<span class="t-meta whitespace-nowrap tabular-nums text-fg-subtle">{sinceLabel} {since}</span>{/if}
							{:else}
								{#if place}<span class="flex items-center"><Chip role="env" label={place.label} theme={place.theme} /></span>{/if}
								{#if since}<span class="t-meta tabular-nums text-fg-subtle">{sinceLabel} {since}</span>{/if}
								{#if build}<span class="t-meta font-mono text-fg-muted {buildDesktopOnly ? 'max-sm:hidden' : ''}">{build}</span>{/if}
							{/if}
							{#if fact}<span class="t-ui-sm sb-cause min-w-0 max-w-full truncate text-fg-muted" data-statement-cause>{@render fact()}</span>
							{:else if cause}<span class="t-ui-sm sb-cause min-w-0 {compact ? 'max-w-full truncate' : ''} text-fg-muted {causeDesktopOnly ? 'max-sm:hidden' : ''}" data-statement-cause>{cause}</span>{/if}
						</div>
					</div>
				{/if}
				{#if shownCheck && checkAfterMeta}<FailedCheckLine check={shownCheck} danger ink={checkInk} />{/if}
				{#if message}<p class="min-w-0 {messageDesktopOnly ? 'max-sm:hidden' : ''}">{message}</p>{/if}
				{#if body}{@render body()}{/if}
			</div>
{/snippet}
{#snippet actionsSnip()}
			<ActRow {primary} secondary={acts} {phoneMax} />
			{#if note}<p class="t-meta basis-full opacity-80">{note}</p>{/if}
			{#if canHover.current && tooltips}
				{#each Object.entries(tooltips) as [id, text] (id)}
					<Tooltip triggeredBy="#{id}" placement="bottom" class="max-w-xs" transition={blur} transitionParams={{ duration: 300 }}>{text}</Tooltip>
				{/each}
			{/if}
{/snippet}

<AlertPanel
	{open}
	severity={tone}
	icon={severity === 'held' || severity === 'approval' ? HeldGlyph : undefined}
	{title}
	{pulse}
	{plain}
	{follow}
	{compact}
	{toggle}
	extra={age}
	{footnoteLabel}
	{footnoteBody}
	class={className}
	actionBar={true}
	messageBody={hasBody ? bodySnip : undefined}
	actions={hasActions ? actionsSnip : undefined}

/>
