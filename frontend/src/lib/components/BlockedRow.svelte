<svelte:options runes={true} />

<script lang="ts" module>
	import type { RolloutCard } from '$lib/rollout-cards';
	import { holdCausePhrase, type BlockingStory } from '$lib/view-models/blocking-story';
	import { approvalCellText } from '$lib/view-models/held';
	import { shortenVersion } from '$lib/utils';

	export type BlockedKind = 'failed' | 'stuck' | 'held';
	/**
	 * The row's one action. `href` makes it a link (navigation is never a
	 * button, §3.6); `run` an in-place act. One of the two.
	 */
	export type BlockedAction = { label: string; run?: () => void; href?: string; primary?: boolean; title?: string };

	/** The kind a needs-you rollout takes (failed and a failing check are one kind). */
	export function blockedKindOf(c: RolloutCard, held = false): BlockedKind {
		if (held) return 'held';
		return c.statusKey === 'failed' || c.checkFailure != null ? 'failed' : 'stuck';
	}

	/** The row's fact, in plain words: why a person is needed. */
	export function blockedFact(c: RolloutCard, kind: BlockedKind, story?: BlockingStory | null): string {
		if (kind === 'held') {
			// The one hold-cause phrase product-wide (holdCausePhrase), from the
			// classified story the caller holds. Without one, a needs-you held row
			// IS an approval wait (that is how it joined the list), so say that;
			// the bare breakdown cannot tell approval from promotion order.
			const place = c.envDisplay || null;
			return heldSentence(story ? holdCausePhrase(story, { place: '\u0000' }) : '', place ?? null);
		}
		if (c.checkFailure) return `Health check “${c.checkFailure.check || 'health'}” failing`;
		if (kind === 'failed') {
			// ⛔ "HEALTHCHECK FAILED" READ AS A DEPLOY FAILURE EVERYWHERE ELSE ON
			// THE PAGE. (2026-10-11, demo/chain-order.) `categorizeFailure`'s
			// `'healthcheck'` tag is the SAME classifier `activityKindOf`
			// (`activity-kind.ts`) now reads off the identical
			// `bakeStatusMessage` to pick its own verb — one event, one phrase,
			// on both the Needs-you row and the activity sentence.
			if (c.failureCategory === 'healthcheck') return 'Failed its health check';
			return c.failureCategory && c.failureCategory !== 'failed'
				? `${c.failureCategory.charAt(0).toUpperCase() + c.failureCategory.slice(1)} failed`
				: 'Deploy failed';
		}
		if (c.stuck?.kind === 'baking') return 'Checking for over an hour';
		if (c.stuck?.kind === 'deploying') return 'Deploying for over an hour';
		if (c.stuck?.kind === 'promotion')
			{ const n = c.stuck.newerCount ?? c.stuck.candidateCount; return `${n} release${n === 1 ? '' : 's'} waiting`; }
		return `Stuck behind ${c.stuck?.peerEnv ?? 'its upstream'}`;
	}

	/**
	 * holdCausePhrase speaks subject-first ("prod is waiting on an approval");
	 * a row speaks the state first, in sentence case, with the place after
	 * ("Waiting on an approval in prod") — the fallback's own shape, so every
	 * held row reads alike (qa8 S3). `phrase` is built with a placeholder
	 * subject (\u0000) so the rewrite never depends on the place's spelling.
	 */
	export function heldSentence(phrase: string | null, place?: string | null): string {
		const rest = phrase && phrase.startsWith('\u0000 is ') ? phrase.slice('\u0000 is '.length) : '';
		const where = place ? ` in ${place}` : '';
		if (!rest) return `Waiting on an approval${where}`;
		if (rest === 'held') return `Held${where}`;
		return `${rest.charAt(0).toUpperCase()}${rest.slice(1)}${where}`;
	}

	/**
	 * The build the row is ABOUT. A failed or stuck row names what runs (it is
	 * the thing that broke); a HELD row names BOTH builds — the one running
	 * and the one waiting — never just the one already running (⭐ shared/
	 * approval-words, 2026-10-12: the defect this fixes in full — telemetry-
	 * indexer's held row printed only 7b3c9f1, which is live, with no mention
	 * that 4a8d2e6 was the build actually waiting on the approval).
	 * `held.ts`'s `approvalCellText` is the one place both labels are built;
	 * this only joins them for the row's single build slot.
	 */
	export function blockedBuild(c: RolloutCard, kind: BlockedKind): string | null {
		if (kind === 'held') {
			const { running, pending } = approvalCellText(c);
			return [running, pending].filter(Boolean).join(' · ') || null;
		}
		return c.version ? shortenVersion(c.version) : null;
	}
</script>

<script lang="ts">
	/**
	 * THE BLOCKED ROW — one rollout a person must act on. (Extracted from
	 * NeedsYouCard for the command palette, design-rollout 2026-10-10: one
	 * anatomy wherever a "needs you" rollout is listed.)
	 *
	 * Anatomy: StatusMark · [app glyph] · name · env chip · the fact (why) ·
	 * the build it is about · age · [one action, or a chevron]. The whole row
	 * is one link (`.tap-zone` / `.tap-link`); the action is raised above it.
	 * `size="row"` is the card row (py-3, wraps to two lines on a phone);
	 * `size="palette"` is the palette's 40px single line (no glyph, no action,
	 * the fact truncates first).
	 */
	import StatusMark from './StatusMark.svelte';
	import Chip from './Chip.svelte';
	import AppGlyph from './AppGlyph.svelte';
	import { ChevronRightOutline } from 'flowbite-svelte-icons';
	import { formatTimeAgoCompact } from '$lib/utils';
	import { eventAge } from '$lib/view-models/event-age';
	import { now } from '$lib/stores/time';
	import type { Snippet } from 'svelte';

	let {
		card,
		kind,
		href,
		fact = undefined,
		story = null,
		build = undefined,
		size = 'row',
		glyph = false,
		action = null,
		as = 'div',
		wrap = false,
		trailing = undefined,
		approval = false,
		class: className = ''
	}: {
		/** A held row whose hold waits on a PERSON (an approval): the approval
		 *  mark (person glyph, strong ink), never the orange pause a rule hold
		 *  wears. Only meaningful with `kind: 'held'`. */
		approval?: boolean;
		card: RolloutCard;
		kind: BlockedKind;
		href: string;
		/** Overrides the default fact. */
		fact?: string;
		/** The rollout's classified BlockingStory, for the precise hold cause. */
		story?: BlockingStory | null;
		/** Overrides the default build (`blockedBuild`). */
		build?: string | null;
		size?: 'row' | 'palette';
		glyph?: boolean;
		action?: BlockedAction | null;
		/** The element: `li` inside a list (the card), `div` elsewhere. */
		as?: 'div' | 'li';
		/** Palette only: below `sm` the fact takes its own second line (the card
		 *  row's two-line form) instead of truncating; one 40px line from `sm`. */
		wrap?: boolean;
		/** Palette only: content the palette owns (e.g. "Open logs" plus a ↵
		 *  key while the row is selected), rendered last. With `wrap` it ends
		 *  line 2 below `sm` and line 1 from `sm`; otherwise it ends the line. */
		trailing?: Snippet;
		class?: string;
	} = $props();

	const factText = $derived(fact ?? blockedFact(card, kind, story));
	const buildText = $derived(build === undefined ? blockedBuild(card, kind) : build);
	// ⭐ shared/age-lag-total: ONE AGE PER EVENT. Was `card.timestamp`
	// unconditionally — the deploy's own start — which is wrong for `held`
	// (the row should say how long the NEWER build has been waiting, not how
	// long ago the CURRENT one started) and was the second of the four
	// disagreeing instants the coordinator's blind read found. `eventAge`
	// reads the instant for THIS row's own `kind` (`event-age.ts`).
	const ageInstant = $derived(eventAge(card, kind));
	const age = $derived(ageInstant ? formatTimeAgoCompact(ageInstant, $now) : null);
	const palette = $derived(size === 'palette');
</script>

<svelte:element
	this={as}
	class="br tap-zone flex items-center gap-x-3 transition-colors hover:bg-hover {palette
		? wrap
			? 'min-h-10 flex-wrap gap-y-0.5 px-3 py-1.5 sm:h-10 sm:flex-nowrap sm:py-0'
			: 'h-10 flex-nowrap px-3'
		: 'flex-wrap gap-y-0.5 px-4 py-3'} {className}"
	data-blocked-kind={kind}
>
	<StatusMark state={approval && kind === 'held' ? 'approval' : kind} label={approval && kind === 'held' ? 'waits for your approval' : kind} />
	{#if glyph && !palette}<AppGlyph name={card.name} size={20} />{/if}
	<a {href} class="tap-link t-card-title min-w-0 {palette ? 'shrink' : ''} truncate text-fg">{card.name}</a>
	<!-- Palette squeeze order: the env chip gives way first (its label
	     truncates inside the pill, down to 3rem), then the name. -->
	{#if card.envDisplay}<Chip role="env" theme={card.theme} label={card.envDisplay} wide class={palette ? 'min-w-12 shrink-[1000]' : 'shrink-0'} />{/if}
	{#if palette && wrap}
		<!-- Below sm the fact gets its own line (.dot-list, so no orphaned "·");
		     from sm it is the palette's one truncated line. -->
		<span class="t-meta flex min-w-0 basis-full items-baseline gap-x-3 pl-7 text-fg-muted sm:basis-auto sm:flex-1 sm:pl-0">
			<span class="dot-list block min-w-0 flex-1">
				<span class="dot-list-row flex min-w-0 flex-wrap items-baseline sm:flex-nowrap">
					<span class="min-w-0 sm:truncate">{factText}</span>
					{#if buildText}<span class="t-code-sm shrink-0">{buildText}</span>{/if}
					{#if age}<span class="shrink-0 whitespace-nowrap tabular-nums">{age} ago</span>{/if}
				</span>
			</span>
			{#if trailing}<span class="ms-auto shrink-0">{@render trailing()}</span>{/if}
		</span>
	{:else if palette}
		<!-- One truncated line that never wraps: text separators cannot orphan. -->
		<span class="t-meta min-w-0 flex-1 truncate text-fg-muted">
			<span>{factText}</span>{#if buildText}{' · '}<span class="t-code-sm">{buildText}</span>{/if}{#if age}{' · '}<span
					class="whitespace-nowrap tabular-nums">{age} ago</span
				>{/if}
		</span>
		{#if trailing}<span class="shrink-0">{@render trailing()}</span>{/if}
	{:else}
		<!-- The card row wraps at phone width: `.dot-list` draws the separator,
		     so a wrapped line never starts or ends with "·" (qa6 B2, §3.16d). -->
		<!-- The indent lives OUTSIDE `.dot-list`: the list pulls its row 20px
		     into its own clip, so padding on the same box would show the dot. -->
		<!-- sm:basis-0 (qa11b): with a content-width basis, flex-wrap broke the
		     row BEFORE the fact could shrink, dropping a longer action ("Review
		     approval in prod") onto its own line. From sm the fact takes the
		     room left and truncates; the action keeps the row's right. -->
		<span class="t-body block min-w-0 basis-full pl-7 text-fg-muted sm:basis-0 sm:flex-1 sm:pl-0">
			<span class="dot-list block">
				<!-- The facts wrap inside their own column (qa11b): a long build line
				     ("running 7b3c9f1 · 4a8d2e6 waits for you") drops under the fact
				     instead of truncating either, and the action keeps the right. -->
				<span class="dot-list-row flex min-w-0 flex-wrap items-baseline">
					<span class="min-w-0">{factText}</span>
					{#if buildText}<span class="t-code-sm min-w-0 max-w-full truncate">{buildText}</span>{/if}
					{#if age}<span class="shrink-0 whitespace-nowrap tabular-nums">{age} ago</span>{/if}
				</span>
			</span>
		</span>
	{/if}
	{#if action && !palette && action.href}
		<a
			href={action.href}
			class="btn btn-sm {action.primary ? 'btn-primary' : 'btn-secondary'} relative z-[1] ml-7 shrink-0 sm:ml-0"
			title={action.title}>{action.label}</a
		>
	{:else if action && !palette}
		<button
			type="button"
			class="btn btn-sm {action.primary ? 'btn-primary' : 'btn-secondary'} relative z-[1] ml-7 shrink-0 sm:ml-0"
			title={action.title}
			onclick={() => action.run?.()}>{action.label}</button
		>
	{:else if !palette}
		<ChevronRightOutline class="hidden h-4 w-4 shrink-0 text-fg-subtle sm:block" aria-hidden="true" />
	{/if}
</svelte:element>
