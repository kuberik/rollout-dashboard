<svelte:options runes={true} />

<script lang="ts">
	/**
	 * ⭐ THE SAME LIE AS THE ETERNAL SKELETON, IN MINIATURE.
	 *
	 * The hub fans out to its spokes and **fails soft**: `/api/rollouts` answers
	 * `200` with the clusters that replied in `rollouts` and the ones that did
	 * not in `clusterErrors`. So a page can be *partly* true — every count,
	 * every "4/4 healthy", every "nothing needs you" on it is computed over a
	 * subset — and until now only `/` and `/rollouts` mentioned it at all, as a
	 * 12px amber aside. Eight other pages read the identical payload and said
	 * nothing.
	 *
	 * A rollout on an unreachable spoke is **absent, not healthy**, and an
	 * absent record is not an observation. That is the whole reason this
	 * component exists and it is why it is an `AlertPanel` — the product's one
	 * filled banner, `COMPOSITION-GRAMMAR.md` §4 — rather than a third error
	 * idiom.
	 *
	 * ⭐ `info`, NOT `warning`. (round 2, 2026-10-08, design review 4) This was
	 * `severity="warning"` on the reasoning "not error, so warning" — but
	 * `warning` is DESIGN-LANGUAGE.md's STUCK-only amber token (§2.5, §5.3.1),
	 * and nothing here is stuck. What IS on the page is true, just not all of
	 * it — the calm, no-alarm case `info` exists for, same severity `+error.
	 * svelte`'s 404 and `ErrorState`'s missing-object case already settled on.
	 *
	 * ⭐ ONE SENTENCE, THE LIST UNDER `Details`. The per-cluster list (each
	 * carrying the server's OWN sentence, verbatim, never a cause we did not
	 * observe) used to sit inside `message` itself — `AlertPanel`'s message
	 * slot is for the one concrete consequence, always printed; a growing list
	 * of cluster names belongs behind the same `Details` disclosure
	 * `ErrorState`'s own evidence list already uses (`footnoteBody`), not
	 * inflating the banner's own height with every cluster that's ever down.
	 */
	import AlertPanel from './AlertPanel.svelte';
	import FactList, { type Fact } from './FactList.svelte';
	import type { ClusterError } from '$lib/api/rollouts';
	import { formatClockTime } from '$lib/display-time';
	import { RefreshOutline } from 'flowbite-svelte-icons';

	let {
		errors,
		/** What this page is a list of, for the "counts below cover only…" line. */
		subject = 'this page',
		onRetry = null,
		isRetrying = false,
		class: className = 'mb-4'
	}: {
		errors: ClusterError[];
		subject?: string;
		onRetry?: (() => void) | null;
		isRetrying?: boolean;
		class?: string;
	} = $props();

	const names = $derived(errors.map((e) => e.name).filter(Boolean));
	/* QA #3: a spoke whose LAST-KNOWN items are still merged is not "missing" — its rollouts are on the page, but stale. */
	const lastSeenText = $derived(errors[0]?.lastSeen ? formatClockTime(errors[0].lastSeen) : '');
	const stale = $derived(errors.length > 0 && errors.every((e) => e.stale));
	const title = $derived(
		stale
			? names.length === 1
				? `${names[0]} is unreachable — its rollouts show their last known state`
				: `${names.length} clusters are unreachable — their rollouts show their last known state`
			: names.length === 1
			? `${names[0]} did not answer — this page is incomplete`
			: `${names.length} clusters did not answer — this page is incomplete`
	);
	const message = $derived(
		stale
			? `${names.length === 1 ? names[0] : 'These clusters'} stopped answering${lastSeenText ? ` after ${lastSeenText}` : ''}. What you see for ${names.length === 1 ? 'it' : 'them'} is the last copy the hub holds, not live state.`
			: `Everything on ${subject} covers only the clusters that replied — a rollout on ${
			names.length === 1 ? names[0] : 'one of these'
		} is missing from these counts, not healthy in them.`
	);
	const facts = $derived<Fact[]>(
		errors.map((ce) => ({ label: ce.name, value: ce.error || 'the hub gave no reason.' }))
	);
</script>

{#snippet detail()}
	<FactList {facts} tone="banner" />
{/snippet}

{#if errors.length > 0}
	<AlertPanel
		severity="info"
		{title}
		{message}
		footnoteBody={facts.length > 0 ? detail : undefined}
		class={className}
	>
		{#snippet actions()}
			{#if onRetry}
				<button
					type="button"
					class="btn btn-secondary btn-sm"
					onclick={() => onRetry?.()}
					disabled={isRetrying}
				>
					<RefreshOutline
						class="h-4 w-4 shrink-0 {isRetrying ? 'animate-spin' : ''}"
						aria-hidden="true"
					/>
					{isRetrying ? 'Checking…' : 'Try again'}
				</button>
			{/if}
		{/snippet}
	</AlertPanel>
{/if}
