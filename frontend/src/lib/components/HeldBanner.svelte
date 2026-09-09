<svelte:options runes={true} />

<script module lang="ts">
	import type { BlockingStory } from '$lib/view-models/blocking-story';

	/**
	 * ⭐ FINDING 3 (operator sweep, 2026-09-09) — NAME EVERY BLOCKING GATE ON
	 * EVERY HELD PLACE, NOT JUST ONE REPRESENTATIVE SLOT.
	 *
	 * `hello-frontend-app` in PROD *and* STAGING both carry `allowedVersions:
	 * []` gates, and the old banner (`heldGateReason`, `/revisions`' own
	 * route) picked the FIRST held slot with gate evidence and stopped —
	 * an operator reading it would not learn that shipping the dependency
	 * does not clear every place at once. `stories` is one
	 * `blockingStory(...)` result PER DISTINCT HELD ROLLOUT; two places
	 * blocked by the identical contract produce the IDENTICAL `consequence`
	 * string, so deduping by that string — not by place — is what keeps
	 * "hello-api-app ships a newer api than 1.66.0" from repeating once per
	 * place while still naming a SECOND, unrelated cause if one exists.
	 */
	export function dedupedConsequences(stories: BlockingStory[]): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		for (const s of stories) {
			if (!s.consequence || seen.has(s.consequence)) continue;
			seen.add(s.consequence);
			out.push(s.consequence);
		}
		return out;
	}

	/**
	 * ⭐ FINDING 3 — "WAITING" CLAIMS SOMETHING IS IN FLIGHT. `blockingStory`'s
	 * own lead clause ("N newer builds are waiting.") is true when the
	 * BLOCKED rollout has newer candidates of ITS OWN — it says nothing
	 * about whether the PROVIDER it depends on has ever published a build
	 * that would satisfy the requirement. When
	 * `hello-api-app.status.availableReleases` tops out at `1.66.0-66` and
	 * the gate needs `^1.67.0`, nothing is "waiting" — there is nothing to
	 * wait FOR until someone ships it. `indefinite` is the caller's own
	 * answer to that question (it already resolved the contract gate's
	 * `have`/`need` via `classifyGate` to build `stories`); this only
	 * changes the WORDING once told.
	 */
	export function heldExplanation(stories: BlockingStory[], indefinite: boolean): string {
		const parts = dedupedConsequences(stories);
		const sentence = parts.join(' ');
		if (!indefinite || !sentence) return sentence;
		return (
			sentence +
			' No newer build satisfying this exists anywhere yet — this is not a matter of waiting, it is held indefinitely until someone ships one.'
		);
	}
</script>

<script lang="ts">
	/**
	 * THE HELD BANNER — extracted from `/revisions` (round 11, lane 2).
	 * Round 7.3's own ruling stands unchanged: filled `AlertPanel`, never
	 * collapsible, drawn wherever a hold exists (the repository page, lane
	 * 3 — the index carries only the alarm chip that points at it, B.2).
	 *
	 * ⭐ FINDING 3 — THE EXPLANATION AND THE ACTION ARE ALWAYS VISIBLE AND
	 * WRAP. The old banner put both behind `footnoteBody`/`footnoteCount` —
	 * a DISCLOSURE, sized like every other gate popover on this product,
	 * which is exactly wrong for a sentence that is the page's own reason
	 * for existing right now. Measured live at 390: a 340px explanation
	 * line inside a ~205px disclosure box clipped. `AlertPanel`'s `message`
	 * is a plain, unconstrained, `break-words` paragraph — nothing here
	 * hides behind a `<summary>`.
	 */
	import { ArrowRightOutline, CalendarMonthSolid, UserCircleSolid } from 'flowbite-svelte-icons';
	import type { Component } from 'svelte';
	import AlertPanel from './AlertPanel.svelte';

	let {
		subject,
		releaseSplitMessage,
		stories,
		indefinite = false,
		primaryHref = null,
		primaryLabel = null,
		hasSchedule = false
	}: {
		/** `9f10e49`, or `hello-frontend-app 2.67.0-67` when the sha is ambiguous. */
		subject: string;
		/** The top sentence — how many places, which release split. */
		releaseSplitMessage: string;
		/** One `blockingStory(...)` result per DISTINCT held rollout. */
		stories: BlockingStory[];
		/** See `heldExplanation`'s own doc comment. */
		indefinite?: boolean;
		/** "Open <service>" target — the provider's app page. */
		primaryHref?: string | null;
		primaryLabel?: string | null;
		/** Picks the icon, same rule the route used: a clock gate present → calendar. */
		hasSchedule?: boolean;
	} = $props();

	const explanation = $derived(heldExplanation(stories, indefinite));
	const message = $derived(explanation ? `${releaseSplitMessage} ${explanation}` : releaseSplitMessage);
	const HeldIcon: Component = $derived(hasSchedule ? CalendarMonthSolid : UserCircleSolid);
</script>

{#snippet openAction()}
	<a class="nav-link" href={primaryHref}>
		Open {primaryLabel ?? 'the service'}
		<ArrowRightOutline class="h-3.5 w-3.5" aria-hidden="true" />
	</a>
{/snippet}

<div class="held-banner mx-4 my-4 overflow-hidden rounded-lg">
	<!--
		⚠️ `actions` PASSED CONDITIONALLY, NOT A SNIPPET WHOSE BODY IS
		CONDITIONAL. `lib/CLAUDE.md`'s own note: a snippet reference is
		always truthy, so handing `AlertPanel` one unconditionally (even if
		it renders nothing) still draws its `.ap-actions-cell` row. `null`
		when there is nowhere to send the reader.
	-->
	<AlertPanel
		severity="warning"
		icon={HeldIcon}
		title="{subject} is held"
		{message}
		actions={primaryHref ? openAction : undefined}
	/>
</div>
