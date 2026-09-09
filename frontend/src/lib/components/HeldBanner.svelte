<svelte:options runes={true} />

<script module lang="ts">
	import { joinClauses, type BlockingStory } from '$lib/view-models/blocking-story';
	import { sortEnvironmentNames } from '$lib/env-order';

	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 1 — REPLACES `dedupedConsequences`.
	 *
	 * `dedupedConsequences` (finding 3, 2026-09-09) deduped by the full,
	 * per-environment SENTENCE — which is exactly why it did not collapse
	 * `hello-frontend-app` held in dev/staging/prod to one paragraph:
	 * `blockingStory`'s own `consequence` appends a DIFFERENT promotion-order
	 * tail per environment ("and dev deploys it first" / "and staging deploys
	 * it first"), so the three sentences differ by that tail and none of them
	 * are byte-identical. The banner printed the identical contract clause
	 * three times with three different endings.
	 *
	 * The fix reads gates, not sentences: every story's `person`/`unknown`/
	 * checks`/`clock` gates and the DEPENDENCY half of `upstream` are named
	 * once each, deduped by their own `clause` text (worst-first, the same
	 * order `blockingStory`'s own `consequence` builds in). The PROMOTION half
	 * of `upstream` — "dev deploys it first", "staging deploys it first" — is
	 * excluded here entirely; it is the SAME fact restated once per downstream
	 * environment, and `orderClause` below turns that set into one ordered
	 * chain instead of one clause per environment.
	 *
	 * ⚠️ A `clock` gate's own "in 3h" countdown is NOT reconstructed here —
	 * that needs `now` and a timezone, which is `blockingStory`'s own job when
	 * it builds each story's `consequence`. Naming the clock gate's bare
	 * `clause` ("the deploy window reopens") without the countdown is the
	 * trade for not threading a second clock through this component; a
	 * contract hold (this fix's whole reason for existing) never carries one.
	 */
	export function dedupedClauses(stories: BlockingStory[]): string[] {
		const seen = new Set<string>();
		const out: string[] = [];
		const push = (clause: string) => {
			if (!clause || seen.has(clause)) return;
			seen.add(clause);
			out.push(clause);
		};
		for (const s of stories) {
			for (const g of s.person) push(g.clause);
			for (const g of s.unknown) push(g.clause);
			for (const g of s.upstream) {
				if (g.kind === 'dependency') push(g.clause);
			}
			for (const g of s.checks) push(g.clause);
			for (const g of s.clock) push(g.clause);
		}
		return out;
	}

	/**
	 * THE ORDER, NAMED ONCE. A `promotion`-kind gate anywhere in `stories`
	 * means the held places are a CHAIN, not independent holds — this turns
	 * that into `then dev → staging → prod` rather than the deleted
	 * per-environment repeat. `heldEnvLabels` is the caller's own set (it
	 * already knows which places these stories cover — that is how it built
	 * `stories` in the first place); sorted here in the product's one
	 * pipeline order so every caller draws the same chain regardless of the
	 * order it discovered the places in.
	 */
	export function orderClause(stories: BlockingStory[], heldEnvLabels: string[]): string {
		const hasPromotionGate = stories.some((s) => s.upstream.some((g) => g.kind === 'promotion'));
		if (!hasPromotionGate || heldEnvLabels.length < 2) return '';
		return `then ${sortEnvironmentNames(heldEnvLabels)
			.map((e) => e.toLowerCase())
			.join(' → ')}`;
	}

	/**
	 * ONE CONSEQUENCE SENTENCE: the causes, once each, then the order, once.
	 * `Nothing promotes itself until hello-api-app ships a newer api than
	 * 1.66.0 · then dev → staging → prod.` — never the old three-times-with-
	 * three-tails paragraph.
	 */
	export function heldConsequence(stories: BlockingStory[], heldEnvLabels: string[]): string {
		const clauses = dedupedClauses(stories);
		if (clauses.length === 0) return '';
		const order = orderClause(stories, heldEnvLabels);
		const body = order ? `${joinClauses(clauses)} · ${order}` : joinClauses(clauses);
		return `Nothing promotes itself until ${body}.`;
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
	 *
	 * ⛔ ROUND 11 REVISIONS-PASS-6, ITEM 1 — THE LEAD CLAUSE MUST NOT SURVIVE
	 * INTO THE INDEFINITE BRANCH. The old version APPENDED the indefinite
	 * sentence after `sentence`, which still opened with "N newer builds are
	 * waiting." — printing "waiting" and "this is not a matter of waiting" in
	 * the same paragraph. The lead is gated on `!indefinite` now, not merely
	 * followed by a correction.
	 */
	export function heldExplanation(
		stories: BlockingStory[],
		heldEnvLabels: string[],
		indefinite: boolean = false
	): string {
		const consequence = heldConsequence(stories, heldEnvLabels);
		if (!consequence) return '';
		const n = stories[0]?.candidateCount ?? 0;
		const lead =
			!indefinite && n > 0
				? `${n} newer build${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} waiting. `
				: '';
		const tail = indefinite
			? ' No newer build satisfying this exists anywhere yet — this is not a matter of waiting, it is held indefinitely until someone ships one.'
			: '';
		return `${lead}${consequence}${tail}`;
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
		heldEnvLabels = [],
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
		/** The environments `stories` covers — see `orderClause`'s own doc comment. */
		heldEnvLabels?: string[];
		/** See `heldExplanation`'s own doc comment. */
		indefinite?: boolean;
		/** "Open <service>" target — the provider's app page. */
		primaryHref?: string | null;
		primaryLabel?: string | null;
		/** Picks the icon, same rule the route used: a clock gate present → calendar. */
		hasSchedule?: boolean;
	} = $props();

	const explanation = $derived(heldExplanation(stories, heldEnvLabels, indefinite));
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
