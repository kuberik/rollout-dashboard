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
	/**
	 * ⭐ SECOND OPERATOR WALK, ITEM 3 (PAINFUL) — THE GATE, NOT JUST ITS
	 * SENTENCE. Two rollouts can print the identical clause text for two
	 * DIFFERENT rules (a coincidence, not a guarantee), so the cause and its
	 * generated name are captured together, once, right here — never
	 * recovered by re-walking `stories` a second time the way a naive
	 * "look up the id for this clause" helper would have to.
	 */
	export type DedupedCause = { clause: string; id: string };

	export function dedupedCauses(stories: BlockingStory[]): DedupedCause[] {
		const seen = new Set<string>();
		const out: DedupedCause[] = [];
		const push = (clause: string, id: string) => {
			if (!clause || seen.has(clause)) return;
			seen.add(clause);
			out.push({ clause, id });
		};
		for (const s of stories) {
			for (const g of s.person) push(g.clause, g.id);
			for (const g of s.unknown) push(g.clause, g.id);
			for (const g of s.upstream) {
				if (g.kind === 'dependency') push(g.clause, g.id);
			}
			for (const g of s.checks) push(g.clause, g.id);
			for (const g of s.clock) push(g.clause, g.id);
		}
		return out;
	}

	export function dedupedClauses(stories: BlockingStory[]): string[] {
		return dedupedCauses(stories).map((c) => c.clause);
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
	 * `Nothing promotes itself until hello-api-app ships api ^1.67.0 · then
	 * dev → staging → prod.` — never the old three-times-with-three-tails
	 * paragraph.
	 *
	 * ⭐ SECOND OPERATOR WALK, ITEM 3 (PAINFUL) — THE GATES ARE NAMED, NOT
	 * JUST THEIR SENTENCE. The banner used to state a cause ("hello-api-app
	 * ships a newer api…") with no way to tell WHICH rule that was — an
	 * operator who wants to `kubectl get rolloutgate` or search a runbook
	 * for it had nothing to search for. The generated id(s) used to close a
	 * parenthetical on this SAME sentence; round 11 (r11c, item 6) moved
	 * them to their own muted line instead — see the note above
	 * `heldConsequence` and the template's own `Gates:` line, below.
	 */
	/**
	 * ⭐ ROUND 11 REVISIONS-PASS-6, ITEM 6 (r11c) — THE GATE ID STAYS OUT OF
	 * THE SENTENCE. `lib/CLAUDE.md`'s own "ids belong in the disclosed tier"
	 * rule: a raw generated id like `dependency-hello-frontend-needs-api` in
	 * the middle of prose reads as noise to the reader who does not need it
	 * and is unfindable-by-eye for the one who does (an operator scanning for
	 * `ghd-5b2wn` in a runbook). The parenthetical used to append every id
	 * inline — `heldConsequence` no longer does; `HeldBanner`'s own template
	 * renders the SAME `dedupedCauses(stories)` list as a separate, muted
	 * `t-micro` line under the sentence instead (`Gates: <id> · <id>`).
	 */
	export function heldConsequence(stories: BlockingStory[], heldEnvLabels: string[]): string {
		const causes = dedupedCauses(stories);
		if (causes.length === 0) return '';
		const order = orderClause(stories, heldEnvLabels);
		const clauseBody = joinClauses(causes.map((c) => c.clause));
		const body = order ? `${clauseBody} · ${order}` : clauseBody;
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
	import GateRecord from './GateRecord.svelte';
	import type { ClassifiedGate } from '$lib/view-models/blocking-story';

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
	const message = $derived(
		explanation
			? `${/[.!?]$/.test(releaseSplitMessage.trim()) ? releaseSplitMessage.trim() : releaseSplitMessage.trim() + '.'} ${explanation}`
			: releaseSplitMessage
	);
	const HeldIcon: Component = $derived(hasSchedule ? CalendarMonthSolid : UserCircleSolid);
	/**
	 * ⛔ FIX PASS ITEM 17, 2026-09-11 — "› N rules", THE SAME DISCLOSURE
	 * `BlockingStoryPanel` (rollout detail's own banner) ALREADY DRAWS FOR
	 * THE IDENTICAL `BlockingStory[]` SHAPE. Supersedes the flat, always-
	 * visible "Rules: id1 · id2" line ROUND 11's `gateIds` printed — that
	 * decision was correct FOR A BARE LIST OF ID STRINGS ("this fact is
	 * neither a set nor a record"), but a `ClassifiedGate` carries a kind, a
	 * rule name and a description, which IS a record, and `lib/CLAUDE.md`'s
	 * later disclosure taxonomy is unambiguous about the shape a countable
	 * SET of records gets: "`N <noun>`", behind a control, same as every
	 * other gate list on the product. Deduped by gate id across every
	 * distinct held rollout `stories` covers (two places blocked by the
	 * identical rule show it once), same dedup key `dedupedCauses` already
	 * used, now keeping the full gate object instead of throwing it away
	 * for a bare id string.
	 *
	 * ⚠️ NOT SUPERSEDING FINDING 3 (round 7.3): that ruling is about the
	 * EXPLANATION SENTENCE (`message`, above) staying always-visible,
	 * unconstrained prose — untouched here, still passed to `AlertPanel` as
	 * plain `message`, never folded behind a `<summary>`.
	 *
	 * ⚠️ KNOWN GAP, FLAGGED RATHER THAN GUESSED: `ClassifiedGate` carries no
	 * environment/version field, so a rule held identically in dev/staging/
	 * prod cannot yet print "what differs (env, version)" per row the way
	 * the punch list also asks — that needs a field this VM does not have
	 * yet, not a template guess at one.
	 *
	 * ⭐ FIX PASS ITEM 7, 2026-09-11 — THE GAP ABOVE IS CLOSED, ONE LEVEL
	 * DOWN. `PrCell.gateProvidedVersion` (`pr-pipeline.ts`) now carries
	 * exactly the missing per-row fact for the ONE surface that draws a
	 * per-environment stage row over this same held shape (`PipelineRow`'s
	 * own doc comment) — this banner still speaks for the WHOLE hold, at
	 * the coarser grain `ClassifiedGate` can support, and correctly does
	 * not attempt env/version rows itself.
	 *
	 * ⭐ NEW BY DESIGN (FIX PASS ITEM 8, 2026-09-11). ROLE: the RECORD
	 * behind this banner's disclosure — the full set of rules a reader can
	 * open to inspect (kind, name, description), never restated as prose
	 * in the banner body itself. WHY NOTHING EXISTING FITS: this is
	 * explicitly NOT new — the comment above already states it supersedes
	 * a flat, always-visible id list with the SAME disclosure
	 * `BlockingStoryPanel` (rollout detail's own banner) already draws for
	 * the identical `BlockingStory[]` shape, so there was no gap to design
	 * around, only a second hand-rolled copy to delete. WHICH REFERENCE
	 * LENDS PROPORTIONS: `BlockingStoryPanel` + `GateRecord` exactly —
	 * same count-form trigger (`lib/CLAUDE.md`'s "N <noun>" rule), same
	 * `<dl>` record component, `tone="banner"` the only caller-supplied
	 * difference (reads `currentColor` off this banner's own severity ink
	 * instead of the card-scale neutral).
	 */
	const gates = $derived.by<ClassifiedGate[]>(() => {
		const seen = new Set<string>();
		const out: ClassifiedGate[] = [];
		for (const s of stories) {
			for (const g of s.gates) {
				if (seen.has(g.id)) continue;
				seen.add(g.id);
				out.push(g);
			}
		}
		return out;
	});
</script>

{#snippet gateBody()}
	<!-- THE SAME OBJECT `BlockingStoryPanel`'s own disclosure draws, in the
	     banner's own ink — `tone="banner"` reads `currentColor` off
	     `AlertPanel`'s footnote class, same mechanism, same voice. -->
	<GateRecord {gates} tone="banner" />
{/snippet}

{#snippet openAction()}
	<a class="nav-link" href={primaryHref}>
		Open {primaryLabel ?? 'the service'}
		<ArrowRightOutline class="h-3.5 w-3.5" aria-hidden="true" />
	</a>
{/snippet}

<!--
	⭐ ROUND 11 REVISIONS-PASS-6, ITEM 3 (r11c) — NO `mx-4` HERE. Both call
	sites (the repository page, the build page) render this directly inside
	the page's own `.rev-cq` container, which already supplies the page's
	one horizontal inset (`px-4 sm:px-6` — 16px at 390, the same edge every
	`Card` on the page sits flush against). `mx-4` added a SECOND 16px on
	top of that, measured live as 32px at 390 and 216px at 1440 against the
	cards' 200 — the banner was the one element on the page not sharing
	their left/right edge.
-->
<div class="held-banner">
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
		footnoteCount={gates.length === 0 ? undefined : gates.length}
		footnoteBody={gates.length === 0 ? undefined : gateBody}
		actions={primaryHref ? openAction : undefined}
	/>
</div>

<!--
	⛔ NO WRAPPER RADIUS, NO OVERFLOW CLIP, NO `:global(.ap-cq)` OVERRIDE.
	(2026-09-10, human on a phone in dark: "borders are screwed up".) A
	wrapper that clips at 8px around AlertPanel's own 12px-radius bordered
	container leaves the border showing on two edges and not the others.
	AlertPanel is THE alert component; its radius is its own decision, and
	this banner takes it as is. Change AlertPanel if every panel must change.
	No outer margin either: a component does not own the space around it,
	the caller does — the repository page reorders this banner above the
	ledger below `sm`, and a margin that travelled with it left the ledger
	touching the first hero (2026-09-10, human on a phone).
-->
