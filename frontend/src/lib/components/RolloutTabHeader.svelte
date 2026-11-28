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
	import { dashboardManagesWantedVersion, WANTED_VERSION_OWNED_REASON } from '$lib/view-models/pin-hold';
	import { page } from '$app/state';
	import { href } from '$lib/paths';
	import { UndoOutline, RefreshOutline } from 'flowbite-svelte-icons';
	import RolloutHeaderFlows from './RolloutHeaderFlows.svelte';
	import { failureRecovered } from '$lib/components/new/data';
	import { rolloutPath } from '$lib/source-dashboard';
	import { changePathForRollout } from '$lib/version-utils';
	import { rolloutStateChip, type StateChipRole } from '$lib/view-models/rollout-state-chip';
	import { now } from '$lib/stores/time';

	let {
		name,
		rollout,
		meta: metaRender,
		actions,
		identityExtra,
		titleAfter: titleAfterOverride,
		chip: chipOverride,
		inlineRollback = true,
		quietRollback = false,
		failingNow = false,
		recovered: recoveredIn,
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
		/** A health check of the head deploy fails right now (`headFailingNow`, the Overview's own reading): the state pill then says "failing", not "failed", so switching tabs never changes the word. */
		failingNow?: boolean;
		/** the head failure's checks are all OK again (the page's own `headRecovered`); absent: read from the fleet source */
		recovered?: boolean;
		below?: Snippet;
		metaSeparated?: boolean;
		/** false: the description is dropped below sm, so the tab's own (adverse) fact is never the one the one-line meta row cuts. QA #19-adjacent (Gates tab, 390). */
		subtitleOnPhone?: boolean;
		class?: string;
	} = $props();

	const latest = $derived(rollout?.status?.history?.[0]);
	const build = $derived(latest ? getDisplayVersion(latest.version) : null);
	const chip = $derived(
		chipOverride !== undefined ? chipOverride : latest ? rolloutStateChip(latest.bakeStatus, latest, failingNow) : null
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
	/**
	 * The failed place's checks are all OK again: Retry is the primary (view-models/failure-actions.ts), printed after Roll back as on the Overview banner.
	 * Retry and Roll back open their confirm in place (`RolloutHeaderFlows`); Roll back stays beside Retry on lg+.
	 */
	const recovered = $derived(isFailed && (recoveredIn ?? failureRecovered(rolloutPath(page.params.cluster ?? '', page.params.namespace ?? '', page.params.name ?? name))));
	const rollbackDisplay = $derived(
		rollbackNow ? getDisplayVersion({ tag: rollbackNow.tag, version: rollbackNow.version }) : ''
	);
	/**
	 * Roll back and Retry open their confirm IN PLACE, on every tab (`RolloutHeaderFlows`, mounted on the first press): Cancel leaves the
	 * operator on the Logs, Gates or History they were reading, with the URL unchanged. They are buttons, not links to the Overview.
	 */
	let retryRequest = $state(0);
	let rollbackRequest = $state(0);
	const pressRetry = () => retryRequest++;
	/** another field manager (Flux) owns `spec.wantedVersion`: Roll back is a pin, so it is disabled, with the Overview's own reason */
	const managesPin = $derived(dashboardManagesWantedVersion(rollout));
	/** a calm build's Roll back is disabled because another manager owns the wanted version */
	const ownedReasonShown = $derived(!!rollbackNow && !managesPin);
	/** the disabled Roll back points at the reason line, so a keyboard or a screen reader reaches it (a title does not) */
	const reasonRef = $derived(ownedReasonShown ? 'owned-reason' : undefined);
	const rollbackTitle = $derived(managesPin ? `Roll back to ${rollbackDisplay}` : WANTED_VERSION_OWNED_REASON);
	const pressRollback = () => {
		if (managesPin) rollbackRequest++;
	};
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
		<button type="button"
			class="btn {recovered ? 'btn-secondary' : 'btn-primary'} max-lg:hidden"
			data-desktop-only
			onclick={pressRollback}
			title={rollbackTitle}
			disabled={!managesPin} aria-describedby={reasonRef}
		>
			<UndoOutline class="h-4 w-4" aria-hidden="true" />
			Roll back
		</button>
		<button type="button" class="btn {recovered ? 'btn-primary' : 'btn-secondary'} max-lg:hidden" data-desktop-only data-action="retry" onclick={pressRetry}>
			<RefreshOutline class="h-4 w-4" aria-hidden="true" />
			Retry
		</button>
	{/if}
	{#if quietRollback && !isFailed && rollbackNow}
		<button type="button"
			class="btn btn-secondary max-lg:h-11"
			data-phone-end
			onclick={pressRollback}
			title={rollbackTitle}
			disabled={!managesPin} aria-describedby={reasonRef}
		>
			<UndoOutline class="h-4 w-4" aria-hidden="true" />
			Roll back
		</button>
	{/if}
	{#if actions}{@render actions()}{/if}
{/snippet}
{#snippet metaRow()}
	<!-- ⭐ THE PHONE META LINE (LOGOPEN r8; below lg since r11, History AD
	     round 12). Below lg (phones and the 768-1023 tablet width) the title
	     row holds only the name and build, so it sits at the same y on every
	     tab; the state chip leads this line; a failed build's action pair (Roll back,
	     Retry; 44px) sits on its own line under it (`phoneActions`). A calm
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
{/snippet}

{#snippet phoneActions()}
	<!-- ⭐ THE PHONE ACTION PAIR (below lg): the same pair the lg+ slot shows, in the same order (Roll back, then Retry; the
	     state decides which is blue, as on the Overview banner), on its OWN line under the meta row. It is not part of the
	     meta row: that row is one nowrap line of facts, and a pair at its end covered the age or the deploy count at 320.
	     language.css hides the cell from lg up when this is its only child. -->
	{#if inlineRollback && isFailed && rollbackNow}
		<div class="flex flex-wrap items-center gap-2 lg:hidden" data-phone-actions>
			<button type="button" class="btn {recovered ? 'btn-secondary' : 'btn-primary bg-none'} h-11 px-4" data-phone-only data-action="rollback" onclick={pressRollback} title={rollbackTitle} disabled={!managesPin} aria-describedby={reasonRef}>
				<UndoOutline class="h-4 w-4" aria-hidden="true" />
				Roll back
			</button>
			<button type="button" class="btn {recovered ? 'btn-primary bg-none' : 'btn-secondary'} h-11 px-4" data-phone-only data-action="retry" onclick={pressRetry}>
				<RefreshOutline class="h-4 w-4" aria-hidden="true" />
				Retry
			</button>
		</div>
	{/if}
{/snippet}
{#snippet belowAll()}
	{@render phoneActions()}
	<!-- A Roll back is disabled when another manager owns the wanted version. The reason is TEXT at every width, once, under the actions (the Overview's own words): a title is hover-only and a disabled button is out of the keyboard's reach. -->
	{#if ownedReasonShown}
		<p id="owned-reason" class="t-meta text-fg-subtle {below ? 'mb-6' : ''}" data-owned-reason>{WANTED_VERSION_OWNED_REASON}</p>
	{/if}
	{#if below}{@render below()}{/if}
{/snippet}

{#if retryRequest > 0 || rollbackRequest > 0}
	<RolloutHeaderFlows
		cluster={page.params.cluster ?? ''}
		namespace={page.params.namespace ?? ''}
		name={page.params.name ?? name}
		request={retryRequest}
		rollbackRequest={rollbackRequest}
	/>
{/if}

<PageHeader
	title={name}
	app={name}
	class={className}
	{metaSeparated}
	actions={actions || (inlineRollback && isFailed && rollbackNow) || (quietRollback && rollbackNow)
		? actionsRow
		: undefined}
	below={below || (inlineRollback && isFailed && rollbackNow) || ownedReasonShown ? belowAll : undefined}
	titleAfter={starThenTitleAfter}
	identity={chip || identityExtra ? identity : undefined}
	meta={subtitle || metaRender || chip
		? metaRow
		: undefined}
/>
