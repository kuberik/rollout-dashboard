<svelte:options runes={true} />

<script lang="ts">
	/**
	 * THE ROLLOUT TAB HEADER — the Overview's title line, for every other tab.
	 *
	 * ROLE: the first thing on History, Logs, Gates and the diff page. It prints
	 * what the Overview prints on its title line — `name / build` and the state
	 * pill (+ the Stuck badge) — so switching tabs keeps the object's identity
	 * AND its state in the same place; only the meta row (the tab's own facts),
	 * the actions and the `below` strip change. Before (2026-10-09) the other
	 * tabs printed a bare name, so leaving the Overview dropped "is it deployed,
	 * checking, failed?" — the first question on every rollout page.
	 *
	 * WHY NOT PageHeader DIRECTLY: it IS PageHeader; this wrapper only owns the
	 * shared `titleAfter` + `identity` pair (the Overview builds the same pair
	 * from page-local snippets, which the other tabs cannot reach). The words
	 * come from `rolloutStateChip`, never a local mapping.
	 *
	 * Loading: the name comes from the URL and renders at once; the build and
	 * pill fill in place (no layout shift on the title).
	 */
	import type { Snippet } from 'svelte';
	import type { Rollout } from '../../types';
	import PageHeader from './PageHeader.svelte';
	import StarToggle from './StarToggle.svelte';
	import Chip from './Chip.svelte';
	import StuckBadge from './StuckBadge.svelte';
	import {
		getDisplayVersion,
		detectStuck,
		hasFailedBakeStatus,
		hasUnblockFailedAnnotation
	} from '$lib/utils';
	import { rollbackTarget } from '$lib/view-models/deploy-risk';
	import { page } from '$app/state';
	import { href } from '$lib/paths';
	import { UndoOutline } from 'flowbite-svelte-icons';
	import { changePathForRollout } from '$lib/version-utils';
	import { rolloutStateChip, type StateChipRole } from '$lib/view-models/rollout-state-chip';
	import { now } from '$lib/stores/time';

	let {
		name,
		rollout,
		meta: metaRender,
		actions,
		identityExtra,
		rollbackHref,
		titleAfter: titleAfterOverride,
		chip: chipOverride,
		inlineRollback = true,
		quietRollback = false,
		below,
		metaSeparated = true,
		subtitleOnPhone = true,
		class: className = 'mb-6'
	}: {
		name: string;
		rollout?: Rollout | null;
		meta?: Snippet;
		actions?: Snippet;
		/**
		 * ⭐ ADDITIVE, OPTIONAL (logs round 7, AD round 3, item 2: "'Roll
		 * back' inline with the pill"). `actions` wraps to its OWN line
		 * below the whole title block at phone (PageHeader's own doc,
		 * "the title owns its line and the actions wrap under it") — right
		 * for a real action row, wrong for a single compact control that
		 * should read as part of the identity line, beside the state chip,
		 * not a second header row. Renders inside the SAME `identity`
		 * snippet as the chip/`StuckBadge`, after both, so it wraps WITH
		 * them on the title's own flex-wrap row instead of under it.
		 * `undefined` by default — every existing caller (History, Gates,
		 * the Overview-sibling tabs) renders exactly as before.
		 */
		identityExtra?: Snippet;
		/**
		 * Where the header's failed-state "Roll back to X" goes. Default: the
		 * Overview with `?action=rollback` (it opens the same dialog its banner
		 * does). A tab that hosts the dialog itself (History) passes its own.
		 */
		rollbackHref?: string;
		/**
		 * Replaces the `/ build` part of the title line. A page about ONE deploy
		 * that is not the running one (the diff page: `/ b7e0d41 → d09e6f4`)
		 * names that deploy instead of the rollout's current build, so the
		 * title never contradicts the page beneath it.
		 */
		titleAfter?: Snippet;
		/**
		 * Replaces the state pill. A page about one past deploy (the diff page)
		 * shows THAT deploy's outcome ("healthy", "failed"), not the rollout's
		 * live state. Same Chip roles as `rolloutStateChip`; null hides it.
		 */
		chip?: { role: StateChipRole; label: string; title?: string } | null;
		/**
		 * false: the page draws the failed-state Roll back itself (in its own
		 * `actions` slot, e.g. the diff page's single action slot). Default
		 * true: drawn here, beside the state pill.
		 */
		inlineRollback?: boolean;
		/** LOGOPEN r10, D8: on a build that is NOT failing, the secondary
		 *  "Roll back to <sha>" the calm Overview and History already show,
		 *  at every width, in the same actions slot they use. */
		quietRollback?: boolean;
		below?: Snippet;
		metaSeparated?: boolean;
		/** false: the description is dropped below sm, so the tab's own (adverse) fact is never the one the one-line meta row cuts. QA #19-adjacent (Gates tab, 390). */
		subtitleOnPhone?: boolean;
		class?: string;
	} = $props();

	const latest = $derived(rollout?.status?.history?.[0]);
	const build = $derived(latest ? getDisplayVersion(latest.version) : null);
	const chip = $derived(
		chipOverride !== undefined ? chipOverride : latest ? rolloutStateChip(latest.bakeStatus) : null
	);
	const stuck = $derived(detectStuck(rollout, { now: $now }));
	/**
	 * ⭐ ONE RULE FOR EVERY TAB (AD, History + Logs, 2026-10-10): on a failed
	 * rollout, "Roll back to X" is the PRIMARY button in the header, the same
	 * weight as the Overview banner's. Drawn here once, not per tab, from the
	 * Overview's own predicates (`hasFailedBakeStatus` minus the unblock
	 * annotation; `rollbackTarget` for a proven-older build).
	 */
	const isFailed = $derived(
		!!rollout && hasFailedBakeStatus(rollout) && !hasUnblockFailedAnnotation(rollout)
	);
	const rollbackNow = $derived(rollout ? rollbackTarget(rollout) : null);
	const rollbackDisplay = $derived(
		rollbackNow ? getDisplayVersion({ tag: rollbackNow.tag, version: rollbackNow.version }) : ''
	);
	const rollbackLink = $derived(
		rollbackHref ??
			href(
				`/rollouts/${page.params.cluster}/${page.params.namespace}/${page.params.name ?? name}?action=rollback`
			)
	);
	const subtitle = $derived(
		rollout?.status?.title && rollout.status.title !== name ? rollout.status.title : null
	);
</script>

{#snippet titleAfter()}
	{#if build}
		<!-- The separator travels with the build (one nowrap group): a wrap
		     at phone width moves "/ build" together, never leaving a line
		     that ends on a bare slash after the star. -->
		<span class="inline-flex items-baseline gap-x-3 whitespace-nowrap">
			<span class="t-title text-fg-disabled" aria-hidden="true">/</span>
			<a
				href={changePathForRollout(rollout, name, build)}
				class="t-code-lg text-fg-muted hover:text-fg hover:underline">{build}</a
			>
		</span>
	{/if}
{/snippet}
{#snippet starThenTitleAfter()}
	<!-- The app's star sits on the name's line, right after it, on every tab. -->
	<StarToggle app={name} class="self-center" />
	{#if titleAfterOverride}{@render titleAfterOverride()}{:else if build}{@render titleAfter()}{/if}
{/snippet}
{#snippet identity()}
	{#if chip}
		<!-- Below sm the chip moves onto the meta line (see `metaRow`). -->
		<span class="max-lg:hidden lg:contents"
			><Chip role={chip.role} label={chip.label} title={chip.title} /></span
		>
	{/if}
	{#if stuck}<StuckBadge reason={stuck} />{/if}
	{#if identityExtra}{@render identityExtra()}{/if}
{/snippet}
{#snippet actionsRow()}
	<!-- ⭐ ONE ACTION SLOT ON EVERY ROLLOUT TAB (AD, History round 7):
	     right-aligned, 36px, the same position and size the diff page
	     uses; only the fill changes by state. -->
	{#if inlineRollback && isFailed && rollbackNow}
		<!-- sm+ only: below sm the action sits on the meta line (`metaRow`).
		     `data-desktop-only` lets the actions cell collapse when this is its
		     only child (language.css, "LOGOPEN r8"), so no empty 12px row. -->
		<a
			class="btn btn-primary max-lg:hidden"
			data-desktop-only
			href={rollbackLink}
			title="Roll back to {rollbackDisplay}"
		>
			<UndoOutline class="h-4 w-4" aria-hidden="true" />
			Roll back
		</a>
	{/if}
	{#if quietRollback && !isFailed && rollbackNow}
		<a
			class="btn btn-secondary max-lg:h-11"
			data-phone-end
			href={rollbackLink}
			title="Roll back to {rollbackDisplay}"
		>
			<UndoOutline class="h-4 w-4" aria-hidden="true" />
			Roll back
		</a>
	{/if}
	{#if actions}{@render actions()}{/if}
{/snippet}
{#snippet metaRow()}
	<!-- ⭐ THE PHONE META LINE (LOGOPEN r8; below lg since r11, History AD
	     round 12). Below lg (phones and the 768-1023 tablet width) the title
	     row holds only the name and build, so it sits at the same y on every
	     tab; the state chip leads this line and the failed build's one action
	     ends it as a 44px "Roll back" (the dialog names the sha). A calm
	     build's secondary "Roll back to <sha>" keeps its own row, pushed to
	     the right edge (language.css `[data-phone-end]`). lg+ renders none of
	     the phone copies (`lg:hidden`), and a meta row holding nothing else
	     collapses (language.css).

	     ONE LINE, ALWAYS (r11 worst case: "128 in 7d", "12 rolled back",
	     "deployed 3 weeks ago"). Below lg the row does not wrap. When the
	     facts do not fit, they give way in a fixed order, never the chip or
	     the action: the LAST fact truncates first with an ellipsis, then the
	     ones before it (flex-shrink 100 vs 1, language.css "LOGOPEN r11b").
	     The full facts are always on the lg+ line and in the page. Ages are already
	     dropped below lg when another fact is present (r11, item 5), so an
	     age is never what gets cut. `data-rth-meta` scopes that rule to this
	     header's row. -->
	<span hidden data-rth-meta></span>
	{#if !subtitle && !metaRender}
		<!-- This meta line exists only for the phone: sm+ had none here. -->
		<span hidden data-meta-phone-only></span>
	{/if}
	{#if chip}
		<span class="inline-flex items-center lg:hidden" data-phone-only
			><Chip role={chip.role} label={chip.label} title={chip.title} /></span
		>
	{/if}
	{#if subtitle}<a href={href(`/apps/${encodeURIComponent(name)}`)} class="min-w-0 truncate text-fg-subtle underline decoration-transparent underline-offset-[3px] transition-colors hover:text-fg hover:decoration-current {subtitleOnPhone ? '' : 'max-sm:hidden'}" title="Open app {subtitle}">{subtitle}</a>{/if}
	{#if metaRender}{@render metaRender()}{/if}
	{#if inlineRollback && isFailed && rollbackNow}
		<a
			class="btn btn-primary ml-auto h-11 bg-none px-4 lg:hidden"
			data-phone-only
			href={rollbackLink}
			title="Roll back to {rollbackDisplay}"
		>
			<UndoOutline class="h-4 w-4" aria-hidden="true" />
			Roll back
		</a>
	{/if}
{/snippet}

<PageHeader
	title={name}
	class={className}
	{metaSeparated}
	actions={actions || (inlineRollback && isFailed && rollbackNow) || (quietRollback && rollbackNow)
		? actionsRow
		: undefined}
	{below}
	titleAfter={starThenTitleAfter}
	identity={chip || identityExtra ? identity : undefined}
	meta={subtitle || metaRender || chip || (inlineRollback && isFailed && rollbackNow)
		? metaRow
		: undefined}
/>
