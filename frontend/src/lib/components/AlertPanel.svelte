<svelte:options runes={true} />

<script lang="ts">
	import CauseText from './CauseText.svelte';
	import { titleParts } from '$lib/view-models/banner';
	import type { Cause } from '$lib/view-models/gate-label';
	import Avatar from './Avatar.svelte';
	import Banner, { type BannerSeverity } from './Banner.svelte';
	import type { Snippet, Component } from 'svelte';
	import { countLabel } from '$lib/disclosure';
	import { ExclamationCircleSolid, InfoCircleSolid } from 'flowbite-svelte-icons';

	type Severity = 'error' | 'warning' | 'info' | 'pinned';

	/**
	 * The banner API the product's older call sites speak (`severity` error/warning/pinned/info, `message`, `footnote`,
	 * an `actions` snippet). Since the banners system (2026-11-27) it draws nothing of its own: every prop maps onto
	 * `Banner`, the one shell, so a page using this and a page using `Banner` directly cannot look different — the
	 * filled field with the 40px disc, the 17px headline and the four drifting button positions are gone.
	 *
	 *   error → critical · warning → warning (amber: stuck only) · pinned → held (orange) · info → info
	 *
	 * Kept from before, because the content rules still hold: a typed `Cause` title draws a gate as » + its source chip;
	 * the footnote is DISCLOSED, never printed (the 2026-08-31 measurement: two printed footnotes ate 456px of an 844px
	 * phone viewport); the disclosure's word follows `lib/disclosure.ts` (`N rules` for a set, `Details` otherwise); the
	 * change line is build · title · #ref · person. `plain` puts the statement on the card surface (a list at rest);
	 * `actionBar`, `follow` and `compact` are accepted for old callers and no longer change anything — the action
	 * position is the shell's, one place for every banner.
	 */
	interface Props {
		severity?: Severity;
		/** a typed cause draws a promotion gate as » + its source chip (`CauseText`); a string prints as text */
		title: string | Cause;
		message?: string | Cause;
		/** the message when it is more than a sentence (a list, a figure); pass one or the other */
		messageBody?: Snippet;
		/** the mechanism, the verdict, the rule handle: disclosed behind the label, never printed */
		footnote?: string;
		/** the disclosure's label: `Details` unless the content is a countable set (see `footnoteCount`) */
		footnoteLabel?: string;
		/** the number of things behind the control: the label becomes `1 rule` / `3 rules` (`countLabel`) */
		footnoteCount?: number;
		/** The kind of thing `footnoteCount` counts. Singular; the plural is `-s`. */
		footnoteNoun?: string;
		/** a record (`FactList`, `GateRecord`) instead of a sentence; pass it conditionally (a snippet is always truthy) */
		footnoteBody?: Snippet;
		icon?: Component;
		pulse?: boolean;
		change?: { /** the build the change shipped as: leads the line in t-code */ build?: string; title: string; ref?: string; person?: string; src?: string | null; you?: boolean };
		actions?: Snippet;
		/** accepted, no effect: the shell owns the action position */
		actionBar?: boolean;
		plain?: boolean;
		/** accepted, no effect */
		follow?: boolean;
		/** accepted, no effect */
		compact?: boolean;
		toggle?: { open: boolean; onclick: () => void; label: string; controls?: string };
		extra?: Snippet;
		class?: string;
		/** Read by the landing page's guided tour to find this banner by a stable name. */
		dataTour?: string;
		open?: boolean;
	}

	const p: Props = $props();

	const TONE: Record<Severity, BannerSeverity> = { error: 'critical', warning: 'warning', pinned: 'held', info: 'info' };
	const tone = $derived(TONE[p.severity ?? 'info']);
	/* the shell draws its own default glyph; a circled flowbite glyph would be a disc inside a disc */
	const icon = $derived(p.icon === ExclamationCircleSolid || p.icon === InfoCircleSolid ? undefined : p.icon);
	/* a plain sentence is the shell's own `line` (Details follows it on the line); anything richer is a body block */
	const plainLine = $derived(typeof p.message === 'string' && !p.messageBody && !p.change ? p.message : undefined);
	const hasBody = $derived(!plainLine && (!!p.messageBody || !!p.message || !!p.change));
	const hasFoot = $derived(!!p.footnote || !!p.footnoteBody);
	const disclosureLabel = $derived(
		p.footnoteCount === undefined ? (p.footnoteLabel ?? 'Details') : countLabel(p.footnoteCount, p.footnoteNoun ?? 'rule')
	);
</script>

{#snippet heading()}
	<p class="t-heading inline text-fg [overflow-wrap:anywhere]" data-banner-title>{#if typeof p.title === 'string'}{@const tp = titleParts(p.title)}{tp.lead}{#if tp.place}<span class="whitespace-nowrap" data-title-place>{tp.place}</span>{/if}{:else}<CauseText parts={p.title} />{/if}</p>
{/snippet}

{#snippet body()}
	{#if p.messageBody}
		<div class="break-words">{@render p.messageBody()}</div>
	{:else if p.message}
		<p class="break-words">{#if typeof p.message === 'string'}{p.message}{:else}<CauseText parts={p.message} />{/if}</p>
	{/if}
	{#if p.change}
		{@const change = p.change}
		<p class="ap-change t-meta mt-1 flex min-w-0 flex-wrap items-center gap-y-0.5 overflow-hidden text-fg-subtle" data-ap-change>
			<span class="flex min-w-0 max-w-full items-center gap-2">
				{#if change.build}<span class="t-code shrink-0 whitespace-nowrap text-fg-muted" data-ap-build>{change.build}</span><span class="shrink-0" aria-hidden="true">{'·'}</span>{/if}
				<span class="min-w-0 truncate">{change.title}</span>
				{#if change.ref}<span class="t-code-sm shrink-0">{change.ref}</span>{/if}
			</span>
			{#if change.person}
				<span class="ml-2 inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-l border-line-strong pl-2" data-ap-author>
					{#if !change.you}<Avatar name={change.person} src={change.src ?? null} size={16} />{/if}{change.you ? 'you' : change.person}
				</span>
			{/if}
		</p>
	{/if}
{/snippet}

{#snippet foot()}
	{#if p.footnoteBody}
		<div class="min-w-0">{@render p.footnoteBody()}</div>
	{:else if p.footnote}
		<p class="max-w-[80ch] break-words">{p.footnote}</p>
	{/if}
{/snippet}

<Banner
	open={p.open}
	severity={p.plain ? 'info' : tone}
	markTone={p.plain ? tone : undefined}
	{icon}
	{heading}
	extra={p.extra}
	line={plainLine}
	body={hasBody ? body : undefined}
	detailsBody={hasFoot ? foot : undefined}
	detailsLabel={disclosureLabel}
	actions={p.actions}
	toggle={p.toggle}
	pulse={p.pulse}
	role={p.severity === 'error' ? 'alert' : 'status'}
	class={p.class ?? 'mb-4'}
	dataTour={p.dataTour}
/>
