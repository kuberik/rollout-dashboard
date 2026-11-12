/**
 * ⭐ ONE BLOCKING STORY PER ROLLOUT.
 *
 * ── THE DEFECT THIS EXISTS TO KILL ───────────────────────────────────────
 *
 * For the SAME rollout at the SAME moment, two pages gave opposite answers to
 * the only question that matters at 3am:
 *
 *   `/apps/hello-world-app`   "STAGING is waiting on an approval … Nothing
 *                              promotes into STAGING until `ghd-p2fld` allows
 *                              one. **This will not clear on its own.**"
 *   rollout detail            "Automatic deploys are paused. **Nothing
 *                              promotes itself until 13h 34m (1:00:00 PM).**"
 *
 * The API said BOTH were true — `ghd-p2fld` published an empty allow-list and
 * `schedule-gate-nwm62` was not passing. Neither page said both. One told you
 * to escalate, the other told you to go back to bed, and the `Investigate` CTA
 * on the first took you to the second.
 *
 * AND THE ATTRIBUTION WAS WRONG, not merely incomplete. `ghd-p2fld` is created
 * and owned by the **environment controller**; its allow-list is the set of
 * builds the UPSTREAM environment has already deployed. Captioning it *"Needs
 * a person to approve"* is not vague, it is a wrong instruction: there is no
 * human anywhere who can approve that object. The person it sends looking will
 * not find anybody.
 *
 * ── THE GROUND TRUTH, READ OFF THE CONTROLLER ────────────────────────────
 *
 * `rollout-controller/internal/controller/rollout_controller.go`, gate loop:
 *
 *     if gate.Spec.Passing != nil && !*gate.Spec.Passing {
 *         summary.Message = "Gate is not passing"; gatesPassing = false
 *     } else if gate.Spec.AllowedVersions != nil {
 *         summary.AllowedVersions = *gate.Spec.AllowedVersions
 *         ... "Gate does not allow any release candidate" | "Gate is passing"
 *     } else {
 *         summary.Message = "Gate is passing"
 *     }
 *
 * So `passing` and `allowedVersions` are **two different facts** and the status
 * summary can only ever carry one of them — a not-passing gate never publishes
 * an allow-list. That gives the structural split `promotionBlock` already draws.
 * What it does NOT give is WHO WRITES THE GATE, and that is the half that was
 * missing:
 *
 *   | writer                  | sets            | clears when                  |
 *   |-------------------------|-----------------|------------------------------|
 *   | `RolloutSchedule`       | `passing`       | the clock reaches the window |
 *   | `Environment` (env ctl) | `allowedVersions` | the upstream env deploys it |
 *   | `RolloutDependency`     | `allowedVersions` | the provider ships         |
 *   | a human, by `kubectl`   | `allowedVersions` | **a person acts**          |
 *
 * Three of those four publish an allow-list, so "has an allow-list" ⇒ "needs a
 * person" is wrong three times out of four. **The writer is joinable from the
 * SAME `/api/rollouts` payload** and never from the gate's name:
 *
 *   · `Environment.status.rolloutGateRef.name`  → the promotion gate, and
 *     the app's topology (`sites-waves.ts`: tier, wave, leader) says which
 *     sites must go first; the `WaveReady` condition says what it waits for.
 *   · `RolloutDependency.status.gateName`       → the contract gate, and
 *     `spec.providerRef`/`spec.contract` say which service must ship.
 *   · anything else that is merely not passing  → a schedule or a check;
 *     `RolloutSchedule.status.managedGates` names it exactly and
 *     `status.nextTransition` says WHEN, via `api/schedules.ts`.
 *   · anything else with an allow-list          → nobody automated wrote it.
 *     That, and only that, is the one a person can approve.
 *
 * ⛔ NEVER PATTERN-MATCH THE NAME. `ghd-`, `schedule-gate-` and
 * `dependency-` are `generateName` prefixes, an implementation detail of three
 * controllers, and a rollout may carry a hand-written gate called anything.
 * Every classification below is a JOIN on a published reference.
 *
 * ── WHAT THE PRODUCT PROMISES AND MUST KEEP PROMISING ────────────────────
 *
 * `if !r.hasManualDeployment(&rollout) && len(history) > 0 { if !gatesPassing
 * { return } }` — a gate holds **automatic promotion only**. A deploy a person
 * starts still applies immediately; a critic verified this by force-deploying
 * through three closed gates. Every sentence this module emits keeps that
 * clause, and none of them ever says "deployments are blocked".
 */

import type { Rollout, Environment, RolloutDependency, RolloutGate } from '$lib/../types';
import { heldBuilds } from './held';
import { promotionBlock, promotionCandidates, blockingGateNames, type PromotionBlock } from './promotion';
import { liveForPlace, type Fleet } from './failed-builds';
import { formatTimeUntil, formatAbsoluteReopen } from '$lib/api/schedules';
import { displayVersionForTag } from '$lib/version-utils';
import { countLabel } from '$lib/disclosure';
import { stateWord } from '$lib/components/new/state-words';
import {
	DEFAULT_SITE,
	buildTopology,
	deployNameOf,
	placeKeyOfSite,
	siteNodeOf,
	upstreamOf,
	waveReady,
	type AppTopology,
	type Tier,
	type WaveBlocker,
	type WaveReady
} from './sites-waves';

/**
 * HOW A GATE STOPS BEING A PROBLEM.
 *
 *   `clock`    — a deploy window. It reopens at a known time, on its own.
 *   `check`    — not passing, and nothing published a time. Self-clearing but
 *                unschedulable; we say so rather than invent a clock.
 *   `upstream` — another deployment has to happen first. Nobody approves it and
 *                no clock clears it; it clears when the thing in front moves.
 *   `person`   — a human has to act. **The only value that means escalate.**
 *   `unknown`  — WE DO NOT KNOW, AND WE SAY SO. See the block below.
 *
 * ── ⛔ WHY `unknown` EXISTS, AND WHY IT IS NOT `person` (2026-08-31) ──────
 *
 * `person` used to be the FALL-THROUGH: any gate publishing an allow-list that
 * no join claimed was captioned *"Waiting for someone to approve it"* and the
 * banner told the reader *"This will not clear on its own"* behind a person
 * glyph. That inference — "no automated writer claimed it, therefore a human
 * wrote it" — is only sound if **every automated writer was actually
 * consulted**, and on rollout detail one of them never was: the page built its
 * join table with `rolloutDependencies: null` hard-coded, because the
 * single-rollout endpoint does not carry them. So a `RolloutDependency` gate —
 * a machine-written object **no human anywhere can approve** — was reported on
 * the rollout's own page as waiting on an approval, while `/apps`,
 * `/apps/<name>`, `/environments` and the Dependencies tab all said, correctly,
 * *"nobody has to approve anything"*.
 *
 * This is the SECOND time this defect shape shipped, so the fix is to the
 * shape: **`person` is now claimed from evidence, never from absence.** Two
 * independent things have to fail before a machine gate can be captioned as an
 * approval again:
 *
 *   1. **The owner-reference veto (positive evidence).** A gate created by a
 *      controller carries `metadata.ownerReferences[controller=true]`, and the
 *      single-rollout endpoint already serves it on `rolloutGates`. A gate with
 *      a controller owner is machine-written and can NEVER be `person`,
 *      whatever the joins did or did not match.
 *   2. **The provenance test (no confident inference from absence).** When we
 *      have no owner information for a gate, `person` requires that every
 *      attributing source was present in the payload — `GateContext.sources`
 *      records that, and `buildGateContext` sets each flag only when the key
 *      was actually served rather than `null`/absent.
 *
 * Anything left over is `unknown`, and an `unknown` gate says something TRUE
 * and NON-COMMITTAL — it names the rule, it does not name a remedy, and it
 * never tells anyone to go and find a person who does not exist.
 */
export type GateClears = 'clock' | 'check' | 'upstream' | 'person' | 'unknown';

/**
 * ⭐ THE HOLD-ONE-RULE SHAPE. (2026-10-09, coordinator ruling, design-rollout
 * TL.) "Held" = refused by a gate OR held by a dependency-contract, per
 * build — a `RolloutDependency` contract hold is very often NOT published on
 * `rollout.status.gates` at all (see `ckGates()`'s own comment in
 * `lib/demo/mock-data.ts`: "because publishing it flips blockingStory's
 * banner too"), so a reader of `rollout.status.gates` alone cannot see it.
 *
 * This is deliberately leaner than `ClassifiedGate` — it is read off a
 * `GraphEdge` (`dependency-graph.ts`'s own join against the live
 * `RolloutDependency` object), not off a `RolloutGate` CRD, so there is no
 * gate id, no owner reference, nothing to classify. `provider` is the other
 * rollout's own name (`GraphEdge.from`'s node); `required`/`has` are the
 * edge's own `requiredVersion`/`providedVersion`, verbatim — undefined
 * exactly when the edge itself does not carry one.
 *
 * Keyed on the DISPLAY version (`GraphEdge.held` is already in that form) —
 * the same key `promotionHoldBreakdown`'s own `build` field uses, so a
 * caller building this map off `contractHoldsForRollout`
 * (`dependency-graph.ts`) and a caller reading `promotionHoldBreakdown`'s
 * `held[].build` are talking about the same string.
 */
export type ContractHold = {
	provider: string;
	required?: string;
	has?: string;
	/**
	 * The `RolloutGate` the dependency owns (`GraphEdge.gate`, i.e. the
	 * dependency's `status.gateName`). Identity of the cause: a status gate with
	 * this name IS this hold, whether or not a join could name its provider.
	 */
	gate?: string;
};

/**
 * ⭐ EVERY CONTRACT HOLDING ONE DISPLAY VERSION, NOT JUST THE LAST ONE SEEN.
 * (2026-10-10, QA finding.) Two `RolloutDependency` objects can both refuse
 * the SAME consumer build — `payments-svc ~2.9.0` and `auth ~1.4` both
 * holding `4.43.0-43` back at once is a real live shape, not a corner case —
 * and a map keyed on the bare `ContractHold` silently kept only whichever
 * edge `dependency-graph.ts`'s join visited last. The value is therefore
 * always the LIST of holds on that version, newest-write-wins nowhere.
 */
export type ContractHolds = ReadonlyMap<string, readonly ContractHold[]>;

/**
 * ⭐ THE ONE SENTENCE FOR A CONTRACT HOLD, REUSED EVERYWHERE ONE IS NAMED.
 * (2026-10-09) Byte-identical in shape to the Overview row's own wording
 * (`routes/.../[name]/+page.svelte`: `Needs {providerName} {requiredVersion}
 * · has {providedVersion}`) and the Gates tab's "Held builds" row — so a
 * reader who has learned this sentence on either tab reads the identical
 * one here, rather than a fourth spelling of the same fact.
 */
export function contractHoldClause(hold: ContractHold): string {
	return contractHoldSlots(hold).join(' · ');
}

/** The same sentence as two SLOTS ("Needs payments-svc ~2.9.0" | "has 2.4.1"), for surfaces that draw
 *  the separator in CSS (`.dot-list`) instead of typing a "·". */
export function contractHoldSlots(hold: ContractHold): string[] {
	const required = hold.required ? ` ${hold.required}` : '';
	const slots = [`Needs ${hold.provider}${required}`];
	if (hold.has) slots.push(`has ${hold.has}`);
	return slots;
}

/**
 * ONE CONTRACT HOLD, CLASSIFIED into the same shape `classifyGate` produces
 * for a status gate — so it can ride in the same `gates`/`upstream` arrays
 * and the existing worst-first sort, headline and consequence machinery
 * never has to know this one did not come from `rollout.status.gates`.
 *
 * `id` is synthetic (`contract:<provider>`) — there is no `RolloutGate`
 * object backing this hold, so there is no handle to print in `ruleHandle`'s
 * footnote; callers that disclose gate ids should skip these.
 */
function classifyContractHold(hold: ContractHold): ClassifiedGate {
	return {
		id: `contract:${hold.provider}`,
		kind: 'dependency',
		clears: 'upstream',
		label: `depends on ${hold.provider}`,
		// The noun-clause form every other `upstream` clause already uses
		// (`classifyGate`'s own dependency branch: "X ships Y") — composed
		// here from `ContractHold`'s own fields rather than `GateContext`'s
		// join, since this hold never had a `RolloutGate` object to join.
		clause: hold.required ? `${hold.provider} ships ${hold.required}` : `${hold.provider} ships a newer version`,
		short: contractHoldClause(hold),
		clearsAt: null,
		timezone: null,
		...NOTHING_TO_DRAW,
		subject: hold.provider,
		subjectKind: 'service',
		predicate: hold.required ? `ships ${hold.required}` : 'ships a newer version',
		contract: null,
		have: hold.has ?? null,
		need: hold.required ?? null
	};
}

/**
 * A gate the controller wrote for a `RolloutDependency` (classified
 * `dependency`, by join or by owner reference) that one of `contracts` already
 * names: the dependency's own gate (same gate name), or a joined gate with the
 * same provider. A nameless gate is never absorbed by an unrelated contract.
 */
export function isDependencyGateCoveredBy(
	gate: { kind: ClassifiedGate['kind']; id?: string; subject?: string | null },
	contracts: readonly ContractHold[]
): boolean {
	if (gate.kind !== 'dependency') return false;
	// The gate IS the dependency's own gate: same object, same cause.
	if (gate.id && contracts.some((c) => c.gate === gate.id)) return true;
	// A joined gate names its provider; a nameless one (owner reference only)
	// is covered by nothing but its own dependency's gate, never by "any contract".
	return !!gate.subject && contracts.some((c) => c.provider === gate.subject);
}

/**
 * ⭐ THE GLYPH IS A FUNCTION OF THE STORY, COMPUTED ONCE, HERE. (2026-09-03)
 *
 * `BlockingStoryPanel.svelte`'s own `iconForStory` picked this off `story`'s
 * arrays every time it rendered, worst-first — pinned, then person, then
 * unknown, then upstream (split dependency/promotion), then clock, else
 * check. That is correct and stays correct; the defect was that three OTHER
 * surfaces (`/envs/<name>`, `/dependencies`, `/versions/<rev>`) each faced
 * the exact same blocking fact — *"hello-frontend-app hasn't shipped api
 * ^1.67.0"* — and each hand-picked a DIFFERENT icon for it (a calendar, a
 * padlock, a person), because none of them had the classified story to read
 * a glyph off. `iconKind` is that story's own answer, carried on the object
 * so every consumer asks the same question of the same data and a picture
 * can never disagree with the one the reference banner already draws.
 */
export type StoryIconKind =
	| 'pinned'
	| 'person'
	| 'unknown'
	| 'dependency'
	| 'promotion'
	| 'clock'
	| 'check'
	/**
	 * ⭐ THE STORY'S KIND IS NOT KNOWN YET, NOT THAT IT IS UNKNOWABLE.
	 * (2026-09-04) Picked only when the icon would otherwise have been
	 * `check` on the strength of a gate that is itself `pending` (see
	 * `ClassifiedGate.pending`) — i.e. the ONLY evidence for "check" is the
	 * absence of a schedule join that has not been asked for yet. A glyph
	 * is a claim about KIND (`../../CLAUDE.md`: "a mark that is not true of
	 * its kind is worse than no mark"), and `check`'s shield glyph is a
	 * claim this gate might not deserve once `/schedules` answers. A
	 * renderer that sees `'pending'` should skeleton the icon slot, not
	 * print a glyph for it.
	 */
	| 'pending';

export type ClassifiedGate = {
	/** The Kubernetes object name. A HANDLE — never a headline, never a label. */
	id: string;
	/** Which writer put it there, derived by join. `unknown` = no join matched. */
	kind: 'schedule' | 'check' | 'promotion' | 'dependency' | 'approval' | 'unknown';
	clears: GateClears;
	/**
	 * The gate in words an operator can act on. `Business Hours Only`,
	 * `dev has to deploy it first`, `hello-world-manual-approval`.
	 * NEVER a generated id unless the object genuinely has no other name, and
	 * in that case the id is not dressed as prose.
	 */
	label: string;
	/**
	 * The gate's display name, resolved by `gate-name.ts` exactly as the Gates
	 * tab prints it (published pretty name, else humanised, else "Gate").
	 * Set by `classifyGate`; optional only because `classifyGateInner` builds
	 * the rest of the record first.
	 */
	displayName?: string;
	/** the kind the BACKEND wrote on the gate summary (`GateSummary.kind`), kept beside the joined `kind` so a closed window still reads as one before the schedule join loads. */
	backendKind?: string | null;
	/**
	 * ⭐ THE `until …` FORM, and it is deliberately a NOUN CLAUSE, lowercase,
	 * never a sentence. Every clause composes behind ONE opener — *"Nothing
	 * promotes itself until …"*, the rollout detail page's own words — so the
	 * list reads as English however many gates there are, and so no clause ever
	 * has to be capitalised. That last part is not cosmetic: capitalising the
	 * first clause renamed the environment (`dev` → `Dev`) in the one sentence
	 * whose whole job is to name it exactly.
	 */
	clause: string;
	/**
	 * The ROW form: one capitalised, verb-led phrase for a card body or a list
	 * row that has no banner opener in front of it. Same fact, so a row and the
	 * banner above it cannot disagree.
	 */
	short: string;
	/**
	 * A topology fault (DuplicateSite, InvalidTopology): the configuration is wrong, not merely waiting.
	 * It earns the error tone and a headline of its own instead of "waiting on an approval".
	 */
	fault?: boolean;
	/** The headline this gate states when it is the only one (waves: the fact, not "waiting on an approval"). */
	headline?: string;
	/** ISO instant this clears, when `clears === 'clock'`. */
	clearsAt: string | null;
	/**
	 * ⭐ THE OBJECT THAT HAS TO MOVE, AS A NAME — never a sentence, never a
	 * generated id. (2026-09-02)
	 *
	 * From the human, on the card-scale row: *"i feel like you could better
	 * visualize this rather than just putting ascii icons in there."* The row
	 * printed *"Waiting for hello-api-app to ship a newer api — it is on
	 * 1.66.0"*, which is THREE facts — a provider, a contract with a required
	 * range, and the version it serves — flattened into one 11px gray
	 * sentence with a decorative arrow in front of it. The product already has
	 * the vocabulary to draw that: chips carry versions, the dependency graph
	 * draws provider → consumer.
	 *
	 * So the row is now composed rather than narrated, and `subject` /
	 * `predicate` are `clause` SPLIT AT ITS OWN JOINT — the noun and the verb
	 * phrase, exactly the two halves `clause` already concatenates. That is
	 * why they cannot disagree with the sentence: the sentence is built FROM
	 * them.
	 *
	 * ⛔ `subject` IS NULL WHERE THERE IS NO OBJECT TO DRAW, and that is the
	 * argued half of the answer. A `check`, an `approval` and an `unknown`
	 * gate name no second party — the only concrete thing they carry is the
	 * gate's generated id, which this product deliberately moved OUT of the
	 * printed tier ("FIVE handle lines in one viewport"). A surface that finds
	 * `subject === null` prints `short`, unchanged. Prose is what you use when
	 * there is no shape; it is not a failure to use it where there is none.
	 */
	subject: string | null;
	/** How to draw `subject`. Null exactly when `subject` is null. */
	subjectKind: 'service' | 'environment' | 'schedule' | null;
	/** The environment a PROMOTION gate waits on, when it is exactly one (the source chip); null for a wave, an unknown upstream, and every other kind. Structured so no surface parses `subject`'s wording. */
	promotionSource?: string | null;
	/**
	 * The verb phrase about `subject`, lowercase — `deploys it first`. Null
	 * where the state is DRAWN instead (a clock's countdown, a version pair).
	 */
	predicate: string | null;
	/** The contract this gate is about (`api`), for a `dependency` gate. */
	contract: string | null;
	/** The contract version the provider serves today (`1.66.0`). */
	have: string | null;
	/**
	 * The constraint the held build asks for (`^1.67.0`), verbatim from the
	 * candidate's own requires annotation.
	 *
	 * ⛔ NULL WHERE THE BLOCKED CANDIDATES DISAGREE. Masterminds semver is not
	 * orderable across constraint spellings, so two candidates asking for
	 * different ranges have no single "the requirement" — and rendering one of
	 * them as if it were the requirement is a claim the payload does not
	 * support. The row falls back to the sentence there.
	 */
	need: string | null;
	/**
	 * ⭐ THE SCHEDULE'S OWN ZONE, FOR A `clock` GATE ONLY. (P2, operator-walk
	 * finding) `clearsAt` is an absolute ISO instant and an instant alone
	 * does not say WHOSE wall clock a reader should read it against —
	 * `blockingStory`'s clock loop used to hand it to `toLocaleString()`,
	 * which silently substitutes the READER's machine zone (and, in that
	 * form, prints US date order plus seconds nobody asked for on a
	 * schedule boundary). The `RolloutSchedule`'s own `spec.timezone` (an
	 * IANA name) is the authoritative zone; carried here so every renderer
	 * of a clock clause formats against IT rather than guessing. `null` for
	 * every non-`clock` gate — and for a `clock` gate whose schedule never
	 * declared one, in which case the renderer falls back to UTC rather
	 * than the reader's own zone, which is at least a NAMED zone.
	 */
	timezone: string | null;
	/**
	 * ⭐ TRUE ONLY FOR ONE SHAPE: a gate that fell to the `check` fallback
	 * (not passing, no window in `GateContext.schedule`) BEFORE
	 * `schedulesLoaded` was true. (2026-09-04, load-state audit finding 4)
	 *
	 * It is not a permanent classification like `unknown` — `unknown` means
	 * "we asked every source and none of them can attribute this gate";
	 * `pending` means "we have not asked the one source that would settle
	 * whether this is really a `check` or actually a `clock` gate yet". A
	 * caller that prints `short`/`clause`/`label` for a gate with
	 * `pending: true` is printing a confident claim the model itself does
	 * not yet believe — render a `SkeletonBar` in its place instead (see
	 * `../../CLAUDE.md`'s "Loading states" section) until `blockingStory` is
	 * recomputed with a `GateContext` where `schedulesLoaded` is `true`, at
	 * which point this same gate reclassifies to either a genuine `clock`
	 * gate (with its real window and reopen time) or a genuine `check`
	 * (`pending: false`) — never both across two renders.
	 *
	 * `undefined`/absent on every other branch — this is the ONE place in
	 * `classifyGate` that can produce it.
	 */
	pending?: boolean;
	/**
	 * `promotion` only — the CANONICAL TIER of the sites this gate waits on
	 * (`staging` for a wave-1 leader, the leader's own tier for a follower or a
	 * later wave). `held.ts` reads it to tell chain sequencing (an earlier tier:
	 * not reached yet) from a same-tier order hold, which the gate's `subject`
	 * (`wave 1 (eu-west-1, us-east-1)`, `eu-west-1`) can no longer say by name.
	 * Null/absent when the gate names no tier.
	 */
	upstreamTier?: string | null;
};

/** The five drawing fields, off. Spread by every branch that draws no object. */
const NOTHING_TO_DRAW = {
	subject: null,
	subjectKind: null,
	predicate: null,
	contract: null,
	have: null,
	need: null
} as const;

/**
 * What the environment controller's promotion gate means for one Environment,
 * joined by `status.rolloutGateRef` and read off the app's topology.
 *
 * `upstream` are place keys (the same strings `ChainEnv.upstream` carries);
 * `upstreamSites` are the bare site names, which is what a sentence names.
 * `via` is how the version arrives: from the previous tier (`tier`), from the
 * previous wave of this tier (`wave`) or from this wave's leader (`follow`).
 * `ready` is the WaveReady condition, parsed: the controller's own reason for
 * holding wins over the topology's generic "after X".
 */
export type PromotionJoin = {
	tier: Tier | null;
	site: string;
	wave: number;
	role: 'Leader' | 'Follower';
	upstream: string[];
	upstreamSites: string[];
	upstreamTier: Tier | null;
	upstreamWave: number | null;
	via: 'tier' | 'wave' | 'follow' | null;
	/** The wave's selected revision, 7 characters. */
	selected: string | null;
	ready: WaveReady | null;
};

/**
 * The join table, built ONCE per `/api/rollouts` response and passed down.
 * Keys are `namespace/gateName`: gate names are namespace-scoped and
 * `dependency-hello-frontend-needs-api` genuinely exists in three namespaces
 * at once on the live cluster.
 */
export type GateContext = {
	promotion: Map<string, PromotionJoin>;
	dependency: Map<
		string,
		{
			provider: string;
			contract: string;
			providedVersion: string | null;
			/** See `ClassifiedGate.need` for why disagreement resolves to null. */
			requiredVersion: string | null;
		}
	>;
	/**
	 * Gate name → the schedule that owns it. Filled from
	 * `RolloutSchedule.status.managedGates`, which is an EXACT reference — the
	 * page-level `ScheduleWindow` could only say "some schedule is closed", and
	 * a card that names one gate must name that gate's own schedule.
	 */
	schedule: Map<string, { label: string; nextTransition: string | null; timezone: string | null }>;
	/**
	 * ⭐ THE OWNER-REFERENCE VETO. Gate name → its CONTROLLER owner, read off
	 * `metadata.ownerReferences[controller=true]` of the `RolloutGate` objects
	 * the single-rollout endpoint already serves.
	 *
	 * Three states, and the difference between the last two is the whole point:
	 *   · absent from the map      — we never saw the object. Infer nothing.
	 *   · present, `kind: null`    — we saw it and NO controller owns it. That
	 *                                is positive evidence of a hand-authored
	 *                                gate, the only kind a person can approve.
	 *   · present, `kind: 'X'`     — controller `X` wrote it. **Never `person`.**
	 */
	owners: Map<string, { kind: string | null; name: string | null }>;
	/**
	 * WHICH ATTRIBUTING SOURCES THE PAYLOAD ACTUALLY CARRIED. `false` means the
	 * key was `null` or absent, not that it was empty: an installed CRD with no
	 * objects serves `{ items: [] }` and IS a consulted source, while a cluster
	 * without the CRD serves `null` and is not.
	 *
	 * ⛔ ADDING A NEW AUTOMATED GATE WRITER MEANS ADDING A FLAG HERE. The
	 * `person` branch requires every flag to be true, so a writer that is not
	 * represented can only ever produce `unknown` — which is the safe answer —
	 * rather than silently re-opening "needs a person" for its gates.
	 */
	sources: { environments: boolean; dependencies: boolean };
	/** Gate key (`ns/name`) -> the pretty-name annotation of its RolloutGate object, when it has one (QA round 2 A4). */
	pretty?: Map<string, string>;
	/**
	 * ⭐ WAS `/schedules` EVER CONSULTED FOR THIS JOIN? (2026-09-04,
	 * load-state audit finding 4: "Wrong gate kind until `/schedules`
	 * arrives.") `schedule` above answers "which gate does a window own" —
	 * an EMPTY map is genuinely ambiguous between "this rollout has no
	 * schedule gates" and "the `/schedules` request has not resolved yet".
	 * `classifyGate`'s fallback branch (not passing, no window in `schedule`)
	 * used to treat both the same way and print a CONFIDENT `A check is not
	 * passing` in both cases — true of the first, a guess dressed as a fact
	 * in the second, because the gate in question is very often a schedule
	 * gate whose join simply has not landed yet.
	 *
	 * Deliberately NOT folded into `sources` above: `sources` tracks
	 * ATTRIBUTION evidence (does an empty map mean "no data" or "not
	 * fetched"), or's the safe answer when `false`. This tracks LOADEDNESS
	 * of a request that lands strictly after `buildGateContext`'s own
	 * payload — see `withSchedules`, the only place this ever flips to
	 * `true`. `false` by default so a caller that never calls `withSchedules`
	 * (most `blocking-story.test.ts` fixtures, any surface that has not
	 * wired schedules up yet) gets the OLD, honest-when-genuinely-unknown
	 * behaviour unchanged.
	 */
	schedulesLoaded: boolean;
	/** False on a page that never asks for schedules: a `check` gate there is
	 *  not `pending`, it is the page's honest best answer. Default true. */
	schedulesExpected: boolean;
};

export const EMPTY_GATE_CONTEXT: GateContext = {
	promotion: new Map(),
	dependency: new Map(),
	schedule: new Map(),
	owners: new Map(),
	sources: { environments: false, dependencies: false },
	schedulesLoaded: false,
	schedulesExpected: true
};

const key = (namespace: string | undefined, gate: string) => `${namespace ?? ''}/${gate}`;

/** `main-1787999329-991829b…` is not a name. Neither is `ghd-p2fld`. */
import { prettyNameOf as sharedPrettyNameOf } from './gate-name';
import { gateDisplayName, scheduleLabelOf } from './gate-name';
export function prettyNameOf(meta?: { annotations?: Record<string, string> }): string | null {
	return sharedPrettyNameOf(meta);
}

function promotionJoinOf(env: Environment, topologies: Map<string, AppTopology>): PromotionJoin {
	const topo = topologies.get(deployNameOf(env));
	const node = siteNodeOf(topo, env);
	const ready = waveReady(env);
	const base: PromotionJoin = {
		tier: node?.tier ?? null,
		site: node?.site ?? env?.spec?.site ?? DEFAULT_SITE,
		wave: node?.wave ?? env?.spec?.wave ?? 1,
		role: node?.role ?? 'Leader',
		upstream: [],
		upstreamSites: [],
		upstreamTier: null,
		upstreamWave: null,
		via: null,
		selected: null,
		ready: ready.ready === null && !ready.raw ? null : ready
	};
	if (!topo || !node) return base;
	const up = upstreamOf(topo, node);
	base.upstream = up.map((u) => placeKeyOfSite(topo, u));
	base.upstreamSites = up.map((u) => u.site);
	if (up.length) {
		base.upstreamTier = up[0].tier;
		base.upstreamWave = up[0].wave;
		base.via = !node.isLeader ? 'follow' : up[0].tier === node.tier ? 'wave' : 'tier';
	}
	const wave = topo.tiers.find((t) => t.tier === node.tier)?.waves.find((w) => w.wave === node.wave);
	base.selected = wave?.selectedRevision ? wave.selectedRevision.slice(0, 7) : null;
	return base;
}

/**
 * Build the join table from the `/api/rollouts` payload. Every input is
 * optional: a cluster that has not installed the RolloutDependency CRD serves
 * `rolloutDependencies: null`, and the classification degrades to `unknown`
 * rather than to a confident wrong answer.
 */
export function buildGateContext(payload: {
	/** See GateContext.schedulesExpected. */
	schedulesExpected?: boolean;
	environments?: { items?: Environment[] } | null;
	rolloutDependencies?: { items?: RolloutDependency[] } | null;
	/**
	 * Rollouts whose gate SUMMARIES (`status.gates[].displayName`) seed `pretty` before any gate object has loaded; the objects, when
	 * present, still win. Same one name, earlier.
	 */
	rollouts?: readonly Rollout[] | null;
	/**
	 * The `RolloutGate` OBJECTS, when the caller has them. Only the
	 * single-rollout endpoint serves these, and they are what makes the
	 * classification evidence-based rather than inference-based on that page —
	 * see the `owners` field.
	 */
	rolloutGates?: { items?: RolloutGate[] } | null;
}): GateContext {
	const ctx: GateContext = {
		promotion: new Map(),
		dependency: new Map(),
		schedule: new Map(),
		owners: new Map(),
		pretty: new Map(),
		// ⛔ `!= null` AND NOT A TRUTHINESS TEST. `{ items: [] }` is a source we
		// consulted and found empty; `null` is a source that was never served.
		// Collapsing the two is exactly how "no join matched" became "a person
		// must approve it".
		sources: {
			environments: payload?.environments != null,
			dependencies: payload?.rolloutDependencies != null
		},
		// Schedules are never part of THIS payload — they land through
		// `withSchedules`, a separate, later request. See that field's own
		// doc comment on `GateContext`.
		schedulesLoaded: false,
		schedulesExpected: payload.schedulesExpected ?? true
	};

	for (const r of payload?.rollouts ?? []) {
		for (const g of r?.status?.gates ?? []) {
			if (g?.name && g.displayName) ctx.pretty!.set(key(r.metadata?.namespace, g.name), g.displayName);
		}
	}

	for (const gate of payload?.rolloutGates?.items ?? []) {
		const name = gate?.metadata?.name;
		if (!name) continue;
		const owner = (gate?.metadata?.ownerReferences ?? []).find((o) => o?.controller === true);
		const pretty = sharedPrettyNameOf(gate?.metadata);
		if (pretty) ctx.pretty!.set(key(gate?.metadata?.namespace, name), pretty);
		ctx.owners.set(key(gate?.metadata?.namespace, name), {
			kind: owner?.kind ?? null,
			name: owner?.name ?? null
		});
	}

	const envItems = payload?.environments?.items ?? [];
	const topologies = buildTopology(envItems);
	for (const env of envItems) {
		const gate = env?.status?.rolloutGateRef?.name;
		if (!gate) continue;
		ctx.promotion.set(key(env?.metadata?.namespace, gate), promotionJoinOf(env, topologies));
	}

	for (const dep of payload?.rolloutDependencies?.items ?? []) {
		const gate = dep?.status?.gateName;
		if (!gate) continue;
		// ⭐ THE REQUIRED RANGE, WHICH THE PAYLOAD HAS ALWAYS CARRIED AND NO
		// SURFACE HAS EVER DRAWN. `status.blockedReleases[].requiredVersion` is
		// the constraint each held candidate places on the contract, verbatim
		// from its `com.kuberik.rollout.requires.<contract>` annotation.
		//
		// ⛔ ONLY WHEN THEY ALL AGREE. Two candidates can ask for two different
		// ranges and semver constraints are not orderable, so there is no "the"
		// requirement to print — see `ClassifiedGate.need`.
		const required = [
			...new Set(
				(dep?.status?.blockedReleases ?? []).map((b) => b?.requiredVersion).filter(Boolean)
			)
		];
		ctx.dependency.set(key(dep?.metadata?.namespace, gate), {
			provider: dep?.spec?.providerRef?.name ?? 'another service',
			contract: dep?.spec?.contract ?? 'dependency',
			providedVersion: dep?.status?.providedVersion ?? null,
			requiredVersion: required.length === 1 ? (required[0] as string) : null
		});
	}

	return ctx;
}

/**
 * Fold `RolloutSchedule`/`ClusterRolloutSchedule` objects into the context.
 * Separate from `buildGateContext` because the schedules are a DIFFERENT
 * request — `/api/rollouts/:ns/:name/schedules`, one per rollout — and every
 * sentence here has to be renderable before that request lands. A gate with no
 * schedule join is a `check`, which is true and useful; it gains the window and
 * the clock when the answer arrives.
 *
 * ⭐ CALL THIS ONLY ONCE THE REQUEST HAS ACTUALLY SETTLED — including with an
 * EMPTY array on success-with-nothing or on a genuine failure. It is the sole
 * place `schedulesLoaded` flips to `true`, and it flips regardless of whether
 * `schedules` turns out to be empty: an empty array from a query that has not
 * run yet and an empty array from a query that ran and found nothing must not
 * look the same to `classifyGate`'s fallback branch, and this is the only
 * signal that tells them apart. A caller that calls this with `[]` before the
 * request has resolved (a `$state` initialised to `[]` instead of `null`, say)
 * defeats the whole point — see rollout detail's own `scheduleObjects` for the
 * fix that keeps the two states distinguishable.
 */
export function withSchedules(
	ctx: GateContext,
	namespace: string | undefined,
	schedules: Array<{
		metadata?: { name?: string; annotations?: Record<string, string> };
		spec?: { action?: 'Allow' | 'Deny'; timezone?: string };
		status?: { active?: boolean; nextTransition?: string; managedGates?: string[] };
	}>
): GateContext {
	// QA round 3: SPREAD the context, so a field added to `GateContext` (`pretty` was dropped here) can never be silently lost again.
	const next: GateContext = {
		...ctx,
		schedule: new Map(ctx.schedule),
		schedulesLoaded: true
	};
	for (const s of schedules ?? []) {
		// Only a schedule that is currently REFUSING explains a closed gate.
		// `Allow` schedules block while inactive; `Deny` schedules block while
		// active. Same predicate `ScheduleStatus` and `api/schedules.ts` use.
		const active = s?.status?.active === true;
		const action = s?.spec?.action;
		const blocking = (action === 'Allow' && !active) || (action === 'Deny' && active);
		if (!blocking) continue;
		const label = scheduleLabelOf(s?.metadata) || 'a deploy window';
		for (const g of s?.status?.managedGates ?? []) {
			next.schedule.set(key(namespace, g), {
				label,
				nextTransition: s?.status?.nextTransition ?? null,
				// ⭐ P2, operator-walk finding — see `ClassifiedGate.timezone`'s
				// own comment. The schedule's IANA zone, carried through so the
				// gate's clause can be formatted against IT, not the reader's.
				timezone: s?.spec?.timezone ?? null
			});
		}
	}
	return next;
}

type GateSummary = { name?: string; kind?: string | null; passing?: boolean; allowedVersions?: string[] | null };

const shortRev = (rev: string | undefined): string => (rev ? rev.slice(0, 7) : '');

/** `eu-west-1`, or the tier when the site is the unnamed `default` of ANOTHER tier. */
function siteName(site: string, tier: string, ownTier: string | null): string {
	return site === DEFAULT_SITE && tier !== ownTier ? tier : site;
}

/** The blocker's wording. Every string here is a fact the controller's WaveReady message carries. */
function blockerGate(id: string, b: WaveBlocker, ownTier: string | null): ClassifiedGate {
	const none = { clearsAt: null, timezone: null, ...NOTHING_TO_DRAW } as const;
	switch (b.kind) {
		case 'member': {
			const who = siteName(b.site, b.tier, ownTier);
			const rev = shortRev(b.rev);
			if (b.what === 'selection') {
				return {
					id,
					kind: 'promotion',
					clears: 'upstream',
					label: 'after ' + who + ' picks',
					clause: who + ' picks a build',
					short: 'Waiting for ' + who + ' to pick a build',
					...none,
					subject: who,
					subjectKind: 'environment',
					promotionSource: who,
					predicate: 'picks a build'
				};
			}
			if (b.outcome) {
				// `Failing` is the product's word for a failed check; the sentence keeps the controller's own verb.
				const ended = b.outcome === 'failed' ? 'failed' : 'was cancelled';
				const text = who + "'s check " + ended + (rev ? ' on ' + rev : '');
				return {
					id,
					kind: 'promotion',
					clears: 'upstream',
					label: who + ' is ' + (stateWord('failed') ?? 'failing').toLowerCase(),
					clause: text,
					short: text,
					...none,
					subject: who,
					subjectKind: 'environment',
					promotionSource: who,
					predicate: 'check ' + ended
				};
			}
			const finishing = 'finish ' + (stateWord('checking') ?? 'checking').toLowerCase() + ' ' + (rev || 'the build');
			return {
				id,
				kind: 'promotion',
				clears: 'upstream',
				label: who + ' is ' + (stateWord('checking') ?? 'checking').toLowerCase(),
				clause: who + ' to ' + finishing,
				short: 'Waiting for ' + who + ' to ' + finishing,
				...none,
				subject: who,
				subjectKind: 'environment',
				promotionSource: who,
				predicate: 'to ' + finishing
			};
		}
		case 'noSites':
			return {
				id,
				kind: 'promotion',
				clears: 'person',
				label: b.tier + ' has no sites',
				clause: 'a site registers in ' + b.tier,
				short: 'Waiting for a site to register in ' + b.tier,
				...none
			};
		case 'candidate':
			return {
				id,
				kind: 'promotion',
				clears: 'upstream',
				label: 'waiting for ' + shortRev(b.rev),
				clause: shortRev(b.rev) + ' is available on this cluster',
				short: 'Waiting for ' + shortRev(b.rev) + ' to become available on this cluster',
				...none
			};
		case 'pinned':
			return {
				id,
				kind: 'promotion',
				clears: 'person',
				label: 'pinned to ' + shortRev(b.pinned),
				clause: 'the pin on ' + shortRev(b.pinned) + ' is cleared',
				short: 'Pinned to ' + shortRev(b.pinned) + ', the wave selected ' + shortRev(b.selected),
				...none
			};
		case 'gap': {
			let text: string;
			if (b.missing.length > 0) {
				const n = b.missing.length;
				text = b.tier + ' has no wave' + (n === 1 ? ' ' : 's ') + b.missing.join(', ');
			} else {
				text = b.tier + ' waves start at ' + (b.waves.length ? Math.min(...b.waves) : '?') + ', not 1';
			}
			return {
				id,
				kind: 'promotion',
				clears: 'person',
				label: text,
				clause: text + ' (fix the wave numbers)',
				short: text,
				...none
			};
		}
		case 'lockstep': {
			const who = siteName(b.site, b.tier, ownTier);
			const rev = shortRev(b.rev);
			return {
				id,
				kind: 'promotion',
				clears: 'upstream',
				label: 'lockstep with ' + who,
				clause: 'lockstep: ' + who + ' finishes ' + rev,
				short: 'Lockstep: waiting for ' + who + ' to finish ' + rev,
				...none,
				subject: who,
				subjectKind: 'environment',
				promotionSource: who,
				predicate: 'to finish ' + rev
			};
		}
		case 'duplicate': {
			const o = b.owner;
			const where = (o.cluster ? o.cluster + '/' : '') + (o.namespace ? o.namespace + '/' : '') + o.name;
			const text = 'Held: another Environment, ' + where + ', owns site ' + b.site + ' of ' + b.tier;
			return {
				id,
				kind: 'promotion',
				clears: 'person',
				label: 'duplicate site ' + b.site,
				clause: where + ' gives up site ' + b.site + ' of ' + b.tier + ', or this Environment is annotated environments.kuberik.com/take-over-site=true to take it over',
				short: text + '. Annotate this Environment with environments.kuberik.com/take-over-site=true to take it over.',
				...none
			};
		}
		case 'selfUpstream':
			return {
				id,
				kind: 'promotion',
				clears: 'person',
				label: b.tier + ' is its own upstream',
				clause: b.tier + ' stops being its own upstream',
				short: b.tier + ' is its own upstream',
				...none
			};
		case 'aliasTier': {
			const text = b.names.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' are the same tier (' + b.tier + ')';
			return {
				id,
				kind: 'promotion',
				clears: 'person',
				label: text,
				clause: 'one name is used per tier (split with sites and waves)',
				short: text + '. Use one name per tier; split with sites and waves.',
				...none
			};
		}
		case 'unknownTier': {
			const text = b.name + ' is not a known tier';
			return {
				id,
				kind: 'promotion',
				clears: 'person',
				label: text,
				clause: b.name + ' is renamed to dev, test, staging or prod',
				short: text + '. Use dev, test, staging or prod.',
				...none
			};
		}
		case 'unparsed':
		default:
			return {
				id,
				kind: 'promotion',
				clears: 'unknown',
				label: b.raw || b.reason,
				clause: b.raw || b.reason,
				short: b.raw || b.reason,
				...none
			};
	}
}

/** The headline, and whether it is a fault, for the blockers that are not "someone approves it". */
function waveFault(b: WaveBlocker, g: ClassifiedGate): Pick<ClassifiedGate, 'headline' | 'fault'> {
	switch (b.kind) {
		case 'duplicate':
			return { headline: 'Site ' + b.site + ' of ' + b.tier + ' is owned by another Environment', fault: true };
		case 'gap':
		case 'selfUpstream':
			return { headline: g.short, fault: true };
		case 'aliasTier':
		case 'unknownTier':
			return { headline: g.label, fault: true };
		case 'pinned':
		case 'noSites':
			return { headline: g.short };
		default:
			return {};
	}
}

/**
 * The environment controller's promotion gate, in words. Order of authority:
 * the controller's own WaveReady reason (what it is waiting for right now),
 * then the shape of the topology (who this site follows).
 *
 *   wave-1 leader   after staging                    (the previous tier)
 *   wave-N leader   after wave 1 (eu-west-1, us-east-1)
 *   follower        follows eu-west-1's pick (abc1234)
 *
 * With no upstream and no reported reason the gate "has nothing to compare
 * against yet", which is a real state and is said as one.
 */
function classifyPromotion(id: string, promo: PromotionJoin): ClassifiedGate {
	const b = promo.ready && promo.ready.ready === false ? promo.ready.blocker : null;
	if (b) {
		const t = b.kind === 'member' || b.kind === 'lockstep' ? b.tier : b.kind === 'candidate' ? promo.tier : null;
		const g = blockerGate(id, b, promo.tier);
		return { ...g, ...waveFault(b, g), upstreamTier: t };
	}

	const base = { id, kind: 'promotion', clears: 'upstream', clearsAt: null, timezone: null } as const;
	const names = promo.upstreamSites.map((x) => siteName(x, promo.upstreamTier ?? '', promo.tier));
	if (promo.via === 'follow') {
		const leader = names[0] ?? promo.site;
		const pick = promo.selected ? ' (' + promo.selected + ')' : '';
		return {
			...base,
			upstreamTier: promo.tier,
			label: 'follows ' + leader + "'s pick" + pick,
			clause: promo.selected ? leader + "'s pick (" + promo.selected + ') reaches it' : leader + ' picks a build',
			short: promo.selected
				? "Following " + leader + "'s pick (" + promo.selected + ')'
				: 'Waiting for ' + leader + ' to pick a build',
			...NOTHING_TO_DRAW,
			subject: leader,
			subjectKind: 'environment',
			promotionSource: leader,
			predicate: promo.selected ? "pick (" + promo.selected + ') reaches it' : 'picks a build'
		};
	}
	let subject: string | null = null;
	if (promo.via === 'wave') {
		subject = 'wave ' + promo.upstreamWave + ' (' + names.join(', ') + ')';
	} else if (promo.via === 'tier') {
		subject = promo.upstreamTier;
	}
	// ⭐ `clause` IS BUILT FROM `subject` + `predicate` IN BOTH BRANCHES, so
	// the drawn row and the banner sentence are the same two words in the
	// same order and cannot drift.
	const named = subject ?? 'its upstream environment';
	const predicate = subject ? 'deploys it first' : 'deploys this build';
	return {
		...base,
		upstreamTier: promo.via === 'wave' ? promo.tier : promo.upstreamTier,
		label: subject ? 'after ' + subject : 'after its upstream environment',
		clause: named + ' ' + predicate,
		short: subject
			? 'Waiting for ' + subject + ' to deploy it first'
			: 'Waiting for its upstream environment to deploy this build',
		...NOTHING_TO_DRAW,
		subject: named,
		subjectKind: 'environment',
		promotionSource: promo.via === 'tier' ? subject : null,
		predicate
	};
}

/**
 * ONE GATE, CLASSIFIED. The order of the branches is the order of the joins,
 * and the fallthrough is the LAST branch rather than the first — a gate we
 * cannot attribute is called an approval only after every published reference
 * has been checked and missed.
 */
export function classifyGate(
	gate: GateSummary,
	namespace: string | undefined,
	ctx: GateContext = EMPTY_GATE_CONTEXT
): ClassifiedGate {
	const out = classifyGateInner(gate, namespace, ctx);
	const id = gate?.name ?? 'a rule';
	return { ...out, displayName: gateDisplayName(id, ctx.pretty?.get(key(namespace, id)) ?? null), backendKind: (gate as { kind?: string | null } | undefined)?.kind ?? null };
}

function classifyGateInner(
	gate: GateSummary,
	namespace: string | undefined,
	ctx: GateContext = EMPTY_GATE_CONTEXT
): ClassifiedGate {
	const id = gate?.name ?? 'a rule';
	const k = key(namespace, id);

	const promo = ctx.promotion.get(k);
	if (promo) return classifyPromotion(id, promo);

	const dep = ctx.dependency.get(k);
	if (dep) {
		/**
		 * ⭐ SECOND OPERATOR WALK, ITEM 3 (PAINFUL) — THE CONSTRAINT THE GATE
		 * ACTUALLY EVALUATES, NOT "A NEWER ONE THAN WHAT IT HAS NOW".
		 * `RolloutDependency.status.blockedReleases[].requiredVersion` is the
		 * range the gate compares candidates against (`^1.67.0`, say) — a
		 * DIFFERENT fact from `providedVersion` (`1.66.0`, what the provider
		 * happens to serve right now). This branch used to build its sentence
		 * from `providedVersion` alone ("ships a newer api than 1.66.0"),
		 * which is true today and tells the reader nothing about what would
		 * actually satisfy the gate — `/apps/<provider>` states the same hold
		 * as "They need it to ship api ^1.67.0", a different fact from the
		 * SAME `dep.requiredVersion` this object already carries (`need`,
		 * below). Every surface that reads THIS `clause`/`short` — the
		 * repository page's and the build page's held banners, both — now
		 * gets the range when `ctx.dependency`'s own join resolved exactly
		 * one (`requiredVersion` is `null` on an ambiguous or absent join;
		 * see that field's own comment), and falls back to the honest vaguer
		 * form only then.
		 */
		// `wantClause` is set ONLY when the join resolved exactly one required
		// version — the range the gate actually evaluates (named apart from
		// the object's own `need` FIELD below, which is the bare version
		// string `BlockReason`'s drawn chip reads; this is the fuller
		// "<contract> <range>" clause fragment). `null` (an ambiguous or
		// absent join) falls all the way back to the ORIGINAL "a newer
		// X"/"a newer X than Y" phrasing, byte-identical to before this fix —
		// this branch's job is to state the range when it is KNOWN, not to
		// invent a new default for when it is not.
		const wantClause = dep.requiredVersion ? `${dep.contract} ${dep.requiredVersion}` : null;
		// ⚠️ NO NESTED TEMPLATE LITERALS IN A `.ts` FACT VALUE (`lib/CLAUDE.md`'s
		// own rule) — `lib/messages/scan.ts`'s census regex cannot parse one
		// template literal inside another and comes back with a garbled
		// fragment nobody can read (`Waiting for … to ship …${ dep.providedVersion
		// ?`, verified live against `truth.test.ts`). The aside is built as its
		// own plain string FIRST, so `short`'s own template stays flat.
		const haveAside = dep.providedVersion ? ' — it is on ' + dep.providedVersion : '';
		return {
			id,
			kind: 'dependency',
			clears: 'upstream',
			label: `depends on ${dep.provider}`,
			// ⚠️ NOT the "— it is on X" aside in `clause` — it is the terse
			// form `joinClauses` strings several gates' worth of together
			// into one sentence (the consequence line); the aside stays in
			// `short`, the one-gate-at-a-time form, same as before this fix.
			clause: wantClause
				? `${dep.provider} ships ${wantClause}`
				: dep.providedVersion
					? `${dep.provider} ships a newer ${dep.contract} than ${dep.providedVersion}`
					: `${dep.provider} ships a newer ${dep.contract}`,
			short: wantClause
				? `Waiting for ${dep.provider} to ship ${wantClause}${haveAside}`
				: dep.providedVersion
					? `Waiting for ${dep.provider} to ship a newer ${dep.contract} — it is on ${dep.providedVersion}`
					: `Waiting for ${dep.provider} to ship a newer ${dep.contract}`,
			clearsAt: null,
			timezone: null,
			...NOTHING_TO_DRAW,
			// THE ONE GATE KIND WITH AN OBVIOUS SHAPE: a provider, a contract, the
			// version it serves, and the range the held build asks for. Drawn as a
			// relation; the `predicate` is the fallback for a surface that has no
			// room, and for a dependency whose two versions are not both known.
			subject: dep.provider,
			subjectKind: 'service',
			predicate: wantClause ? `ships ${wantClause}` : `ships a newer ${dep.contract}`,
			contract: dep.contract,
			have: dep.providedVersion,
			need: dep.requiredVersion
		};
	}

	// ⛔ THE ALLOW-LIST TEST COMES AFTER THE JOINS, NOT BEFORE. This is the
	// exact inversion that produced "Needs a person to approve `ghd-p2fld`".
	const hasAllowList = Array.isArray(gate?.allowedVersions);

	if (!hasAllowList) {
		const sched = ctx.schedule.get(k);
		if (sched) {
			return {
				id,
				kind: 'schedule',
				clears: 'clock',
				label: sched.label,
				clause: 'the deploy window reopens',
				short: `Outside the ${sched.label} deploy window`,
				clearsAt: sched.nextTransition,
				timezone: sched.timezone,
				...NOTHING_TO_DRAW,
				// The window has a NAME and a REOPENING TIME, and both are already
				// carried on this object (`label`, `clearsAt`). Drawn, the row is
				// those two facts and nothing else: `Business Hours Only reopens in
				// 12h 59m` against the old `Outside the Business Hours Only deploy
				// window — reopens in 12h 59m (9/3/2026, 12:13:22 AM)`, which was
				// three wrapped lines in a 300px card for the same two facts. The
				// absolute instant moves into the record, where a `<dl>` row can
				// hold it without wrapping.
				//
				// ⛔ ONLY WHEN A TRANSITION IS PUBLISHED. `reopens in` with no clock
				// after it is a broken sentence, and the window's NAME on its own is
				// not a state — so with no `nextTransition` the drawing is off and
				// the surface falls back to `short`, which is complete on its own.
				subject: sched.nextTransition ? sched.label : null,
				subjectKind: sched.nextTransition ? 'schedule' : null,
				predicate: sched.nextTransition ? 'reopens in' : null
			};
		}
		// Not passing, nothing published a window — genuinely TRUE and
		// unschedulable ONLY once `/schedules` has actually been consulted.
		// Before that, this gate might still turn out to be a `clock` gate
		// whose join simply has not landed (`pending`, see that field's own
		// comment) — the CLASSIFICATION below is unchanged (still `check`,
		// still nothing to draw) because reclassifying speculatively would be
		// a second guess on top of the first; `pending` is what tells a
		// renderer not to print `short`/`clause` yet.
		return {
			id,
			kind: 'check',
			clears: 'check',
			label: id,
			clause: 'a check starts passing',
			short: 'A check is not passing',
			clearsAt: null,
			timezone: null,
			// NOTHING TO DRAW, AND THAT IS THE HONEST ANSWER. A check names no
			// second party; the only concrete thing it carries is the gate's
			// generated id, which belongs in the disclosed tier. The row prints
			// `short`.
			...NOTHING_TO_DRAW,
			pending: ctx.schedulesExpected && !ctx.schedulesLoaded
		};
	}

	// ── AN ALLOW-LIST NO JOIN CLAIMED ───────────────────────────────────────
	// ⛔ THIS IS THE BRANCH THAT SHIPPED THE DEFECT TWICE. It used to return
	// `person` unconditionally. It now returns `person` only from EVIDENCE.

	const owner0 = ctx.owners.get(k);
	// The backend's `kind` is the classification when present: promotion / dependency stand for their controllers' owner even where the joins missed.
	const said = gate?.kind;
	/* An ApprovalPolicy / ClusterApprovalPolicy owns the approval gate (design/APPROVALS-API.md §5.1, §8.2): that owner reference IS the approval, a person clears it. It must not reach the "a controller we have no story for" branch below, which called it a rule this dashboard cannot attribute. */
	const policyOwned = said === 'approval' || owner0?.kind === 'ApprovalPolicy' || owner0?.kind === 'ClusterApprovalPolicy';
	const owner = policyOwned ? null : said === 'promotion' ? { kind: 'Environment', name: null } : said === 'dependency' ? { kind: 'RolloutDependency', name: null } : owner0;

	// (1) POSITIVE MACHINE EVIDENCE — a controller owns the object. Whatever
	// the joins missed, no human can approve this, so `person` is off the table.
	if (owner && owner.kind) {
		const ownerName = owner.name ? `${owner.kind} ${owner.name}` : owner.kind;
		if (owner.kind === 'Environment') {
			return {
				id,
				kind: 'promotion',
				clears: 'upstream',
				label: 'after its upstream environment',
				clause: 'its upstream environment deploys this build',
				short: 'Waiting for its upstream environment to deploy this build',
				clearsAt: null,
				timezone: null,
				...NOTHING_TO_DRAW,
				subject: 'its upstream environment',
				subjectKind: 'environment',
				promotionSource: null,
				predicate: 'deploys this build'
			};
		}
		if (owner.kind === 'RolloutDependency') {
			return {
				id,
				kind: 'dependency',
				clears: 'upstream',
				label: 'depends on another service',
				clause: 'the service it depends on ships a newer version',
				short: 'Waiting for the service it depends on to ship a newer version',
				clearsAt: null,
				timezone: null,
				// ⛔ NOTHING TO DRAW. The owner reference proves a `RolloutDependency`
				// wrote this gate and proves nothing about WHICH provider or WHICH
				// contract — that join is exactly what this branch is the fallback
				// for. Drawing a nameless box would be inventing the object.
				...NOTHING_TO_DRAW
			};
		}
		// A controller we do not have a story for. Say who owns it and stop —
		// naming the owner is true, and it is the fastest route to the answer.
		return {
			id,
			kind: 'unknown',
			clears: 'unknown',
			label: ownerName,
			clause: `${ownerName} allows this build`,
			short: `Held by ${ownerName}`,
			clearsAt: null,
			timezone: null,
			...NOTHING_TO_DRAW
		};
	}

	// (2) POSITIVE HUMAN EVIDENCE, or a complete set of joins that all missed.
	// `owner` present with a null kind means we read the object and nothing
	// owns it; `sources` all true means every automated writer was consulted.
	// Either is enough to say a person wrote this, and nothing else is.
	const provenanceComplete = ctx.sources.environments && ctx.sources.dependencies;
	// ⭐ THE BACKEND'S `kind` IS THE CLASSIFICATION WHEN PRESENT. `approval` is a person whatever the joins saw; `unknown` is never a person
	// (the backend looked and could not say). Approval-by-elimination below is only the fallback for a payload WITHOUT `kind` (an older backend).
	if (policyOwned || (said == null && ((owner && owner.kind === null) || provenanceComplete))) {
		return {
			id,
			kind: 'approval',
			clears: 'person',
			label: id,
			clause: 'someone approves it',
			short: 'Waiting for someone to approve it',
			clearsAt: null,
			timezone: null,
			...NOTHING_TO_DRAW
		};
	}

	// (3) WE DID NOT LOOK EVERYWHERE, SO WE DO NOT GUESS. True, non-committal,
	// and it names the handle so the reader can go and read the object. The one
	// thing it must never do is send someone hunting for an approver who may
	// not exist.
	return {
		id,
		kind: 'unknown',
		clears: 'unknown',
		label: id,
		clause: `the rule ${id} allows this build`,
		short: `Held by ${id} — this dashboard cannot tell what clears it`,
		clearsAt: null,
		timezone: null,
		...NOTHING_TO_DRAW
	};
}

export type BlockingStory = {
	/** Promotion is held: newer builds exist and no gate lets any of them in. */
	blocked: boolean;
	/** How many newer builds this rollout could take. */
	candidateCount: number;
	/** The count a SENTENCE prints: `candidateCount` minus the builds that failed here or upstream in the wave chain (failed-builds.ts, the ONE behind rule). `blocked` and `nothingWaiting` keep reading the raw `candidateCount` (a gate still refuses a failed build). Absent = `candidateCount`. */
	newerCount?: number;
	/** true while the fleet had not answered: no sentence carries a count, and a consumer must not fall back to `candidateCount` to print one */
	countPending?: boolean;
	/** `spec.wantedVersion`. A pin refuses ALL builds, so it outranks every gate. */
	pinnedTo: string | null;
	/**
	 * `pinnedTo`, SHORTENED FOR PROSE. `displayVersionForTag` — the same
	 * lookup every other surface uses (`/apps`, rollout detail's own "Version
	 * pinned" banner, `dependency-graph.ts`'s node hold) — resolves the raw
	 * ~60-char OCI tag (`main-1788002370-0afab6f…`) to the short form
	 * (`0afab6f`) it deploys under. `null` exactly when `pinnedTo` is null.
	 *
	 * ⛔ THE DEFECT THIS CLOSES: `headline` used to interpolate `pinnedTo`
	 * RAW — *"DEV is pinned to main-1788002370-0afab6f35627254181e41053c…"* —
	 * while `/apps`, `/apps/<name>` and this page's OWN "Version pinned"
	 * banner all printed `0afab6f`. `pinnedTo` itself stays the raw tag: a
	 * caller needing the actual OCI reference (a `title`, an API call) still
	 * has it.
	 */
	pinnedToDisplay: string | null;
	/** EVERY gate currently holding it. Never a subset, never one. */
	gates: ClassifiedGate[];
	person: ClassifiedGate[];
	clock: ClassifiedGate[];
	upstream: ClassifiedGate[];
	checks: ClassifiedGate[];
	/**
	 * Gates we could not attribute. Never empty *and* silent: a story with an
	 * `unknown` gate is not `selfClearing`, so no surface can file it under
	 * "this sorts itself out", and its verdict says we cannot tell.
	 */
	unknown: ClassifiedGate[];
	/** Earliest moment any clock gate reopens, ISO. */
	clearsAt: string | null;
	/** True iff nothing here needs a person or another deploy. */
	selfClearing: boolean;
	/** Headline for the banner. */
	headline: string;
	/** The concrete consequence: every gate, each with how it clears. */
	consequence: string;
	/**
	 * The verdict ALONE — "do I get up?", in one sentence. Split out from
	 * `resolution` because the manual-deploy clause is a PAGE-level promise:
	 * printed once in a banner it is the thing that stops a reader panicking,
	 * printed under every row in a card it was three identical sentences in one
	 * viewport.
	 */
	verdict: string;
	/**
	 * `verdict` plus the manual-deploy escape. The banner line. It is never
	 * omitted there: a gate holds AUTOMATIC promotion only, and a reader who
	 * does not know that reads every banner on this product as an outage.
	 */
	resolution: string;
	/**
	 * ⭐ THE HUE RULE (F2, 2026-09-03): blocked by a RULE — a contract, a
	 * promotion order, a schedule, a health check, an approval — is
	 * `warning` (amber). A STATE A PERSON CHOSE — pinned, rolled back — is
	 * `info` (blue). Failed is `error` (red), but that is never THIS field:
	 * a failure is `isFailed`'s own `FailurePanel`, which this story does not
	 * model.
	 *
	 * ⛔ IT USED TO BE `selfClearing ? 'info' : 'warning'`, WHICH ANSWERED A
	 * DIFFERENT QUESTION. `selfClearing` is "does this need a PERSON", not
	 * "is this a rule or a choice" — a rollout held by a schedule alone
	 * (`person`/`upstream`/`unknown` all empty) is `selfClearing: true` and
	 * was rendering `info` (blue), identical to the "Rolled back" panel
	 * directly below it on `/rollouts/dev/hello-world-dev/hello-world-app`.
	 * Both are true facts and neither is a choice: a clock and a health check
	 * are rules exactly like an approval is, so every non-pinned branch of
	 * this function is `warning` now, `selfClearing` or not. `selfClearing`
	 * still gates what a caller may say ("clears on its own") — it just no
	 * longer picks the colour.
	 *
	 * The pin branch below keeps `info` — pinning is the one choice this
	 * story itself renders, and the gate kind (`iconKind`) is the only thing
	 * that may vary the GLYPH; it never touches this field.
	 */
	severity: 'warning' | 'info' | 'error';
	/** Which glyph this story earns. See `StoryIconKind`'s own note. */
	iconKind: StoryIconKind;
	/**
	 * ⭐ TRUE WHEN THE STORY'S CLAIM MAY STILL CHANGE SHAPE, NOT JUST VALUE.
	 * (2026-09-04, load-state audit finding 4) `true` exactly when at least
	 * one of `checks` is `pending` (see `ClassifiedGate.pending`) — this
	 * rollout is held by a gate that is CURRENTLY classified `check` only
	 * because `/schedules` has not answered, and might reclassify to
	 * `clock` (with a real window and reopen time) the moment it does.
	 *
	 * A caller rendering the hero banner reads this BEFORE trusting
	 * `headline`/`consequence`/`iconKind`: while `true`, print a
	 * `SkeletonBar` for the reason line instead of the confident-but-
	 * possibly-wrong sentence. `false` — including every `NOT_BLOCKED` and
	 * pinned story, where a schedule's exact kind is irrelevant to the
	 * claim being made — means the claim is final for the data given.
	 */
	kindPending: boolean;
	/**
	 * ⭐ EVERY CANDIDATE, PER-BUILD, NEWEST FIRST — `promotionHoldBreakdown`'s
	 * OWN `perBuild`, carried onto the story so `heldVerdict` (`held.ts`)
	 * can apply its frontier rule without a second
	 * `promotionHoldBreakdown` call (qa12, squad-rollout gates-2 follow-up,
	 * 2026-10-11, tl-integrate ruling). Every other field on this type
	 * (`gates`/`person`/`upstream`/… and the prose built from them) is
	 * still the WHOLE-ROLLOUT blend `promotionBlock`'s own "can this
	 * promote at all" question needs — `candidates` is additive, read by
	 * `heldVerdict` ALONE, and never folded back into those blended fields.
	 */
	candidates?: PromotionHoldBreakdown['perBuild'];
};

export const NOT_BLOCKED: BlockingStory = {
	blocked: false,
	candidateCount: 0,
	pinnedTo: null,
	pinnedToDisplay: null,
	gates: [],
	person: [],
	clock: [],
	upstream: [],
	checks: [],
	unknown: [],
	clearsAt: null,
	selfClearing: true,
	headline: '',
	consequence: '',
	verdict: '',
	resolution: '',
	severity: 'info',
	// Never rendered — nothing is blocked, so no banner reads this — but a
	// concrete value beats leaving the one non-optional field on the type
	// without one where `NOT_BLOCKED` is spread as a base.
	iconKind: 'check',
	kindPending: false,
	// frozen: every spread of this constant would otherwise share one array
	candidates: Object.freeze([]) as never[]
};

const COUNT_WORD = ['no', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];

function countWord(n: number): string {
	return COUNT_WORD[n] ?? String(n);
}

/** `a, b and c` — an English list, because `a, b, c` reads as a table cell. */
export function joinClauses(parts: string[]): string {
	if (parts.length === 0) return '';
	if (parts.length === 1) return parts[0];
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * ⭐ IS A SET OF NAMED SUBJECTS SINGULAR OR PLURAL, GRAMMATICALLY. (2026-09-02)
 *
 * `heldSubjects()` (`dependency-graph.ts`) folds "one app held in three
 * environments" into ONE subject — *"hello-frontend-app in dev, staging and
 * prod"* — deliberately, per its own comment: repeating the app name once
 * per environment was the defect it exists to close. That folding is exactly
 * why the SENTENCE stays singular too: one app, wherever it runs, is still
 * one thing that needs — *"hello-frontend-app in prod needs api ^1.67.0"*,
 * not *"need"*. Only when the set names MORE THAN ONE distinct subject —
 * two different apps held on the same provider, say — does the verb turn
 * plural.
 *
 * A caller with the list of names behind a `heldSubjects()` sentence (an app
 * per held node) counts the DISTINCT ones and asks this, rather than
 * re-parsing the prose `heldSubjects()` already built to recover the count
 * that went into it.
 */
export function isPluralSubject(names: string[]): boolean {
	return new Set(names).size > 1;
}

/**
 * ⭐ A SUBJECT THAT STANDS FOR MORE THAN ONE THING. (2026-09-02)
 *
 * Every headline template puts `subject` in one of two grammatical slots —
 * SUBJECT of the sentence (`${subject} is waiting on …`) or OBJECT of one
 * (`Something is holding ${subject}`) — and until now `subject` was always a
 * single string reused verbatim in both, which is exactly right for a
 * singular subject: `STAGING` and `hello-frontend-app` read correctly
 * whether they open the sentence or sit inside it.
 *
 * A subject naming a SET does not: `/apps/<name>`'s banner needed
 * *"All 3 environments are waiting on another deploy"* (SUBJECT position,
 * capitalised, plural verb) and, had it fallen into the `unknown`/`gates.length
 * > 1` branches, *"holding all 3 environments"* (OBJECT position — "Something
 * is holding **All** 3 environments" breaks mid-sentence case). One string
 * cannot spell both. `plural()` builds the pair; `lead` is what a template
 * opens with, `object` is what it embeds, and they are IDENTICAL except where
 * the caller's own casing differs at the sentence boundary.
 *
 * ⛔ NEVER GUESSED. `blockingStory` does not lower-case a string's first
 * letter to derive `object` — a place label (`STAGING`) or a joined list of
 * them (`DEV, STAGING and PROD`) does not change case between the two slots,
 * and blind-lowering would corrupt those. Only a caller building a phrase
 * that genuinely differs (`All 3 environments` / `all 3 environments`) reaches
 * for `plural()`; every existing caller keeps passing a bare string and gets
 * byte-identical output, because a bare string always has `lead === object`
 * and `plural: false`.
 */
export type StorySubject =
	| string
	| {
			/** How the subject reads opening the sentence, e.g. `"All 3 environments"`. */
			lead: string;
			/**
			 * How the subject reads embedded mid-sentence, e.g.
			 * `"all 3 environments"`. Defaults to `lead` when the caller's phrase
			 * does not change case between the two slots.
			 */
			object?: string;
			/** Conjugates the headline's verb: singular `is` → plural `are`. */
			plural: true;
	  };

/** Builds a {@link StorySubject} that conjugates its headline as plural. */
export function pluralSubject(lead: string, object: string = lead): StorySubject {
	return { lead, object, plural: true };
}

/**
 * ⭐ THE `upstream` VERDICT, SPLIT BY WHO ACTUALLY HAS TO MOVE. (2026-09-02)
 *
 * `clears: 'upstream'` covers TWO writers (see the table at the top of this
 * file) and they clear on DIFFERENT events: a `promotion` gate (Environment-
 * written) clears when the deploy IN FRONT of it lands; a `dependency`
 * (RolloutDependency) contract clears only when the PROVIDER ships a version
 * that satisfies it — "someone has to ship it first", exactly as the
 * Dependencies tab already says. One hard-coded sentence — *"this clears
 * when the deploy in front of it lands"* — is true of the first and false of
 * the second, and it had shipped as the verdict for BOTH: the rollout
 * Overview banner's rule block correctly said `Clears: Waiting for
 * hello-api-app to ship a newer api`, and four lines later the SAME banner's
 * footer said the deploy in front would land — a contract with no deploy in
 * front of it.
 *
 * ONE SENTENCE PER GATE CLASS, NEVER ONE PER CARD. A contract's own class
 * names WHO has to publish WHAT, read straight off `subject` / `contract` /
 * `need` — *"No approval will unblock this. Someone has to ship api ^1.67.0
 * from hello-api-app; until then the only way forward is a hand-started
 * deploy, which bypasses the check."* (See the second doc comment below,
 * 2026-09-03, for why the LEAD clause changed from "nobody has to approve
 * anything" — that reasoning belongs next to the function it decides, not
 * duplicated here.) A gate whose held candidates disagree on the required
 * range (`need === null`) falls back to "ship a newer `<contract>`", same
 * wording `classifyGate`'s own clause uses. Mixed gates — a promotion order
 * AND a contract both holding the same rollout — say both, joined as one
 * list of `when` clauses so the sentence reads as English rather than two
 * verdicts glued together.
 *
 * Every surface that renders the `upstream` verdict calls this ONE function:
 * `blockingStory` itself, and rollout detail's `heldClears()` (the
 * release-candidate row popover, which used to carry a byte-identical copy
 * of the old literal). `/apps`, `/apps/[name]`, `/envs/[name]` and
 * `/dependencies` render the same fact from their own gate lists and should
 * adopt this rather than keep their own copies — `/dependencies` had grown
 * one near its line 199 as of this pass.
 *
 * ⭐ THE CONTRACT LEADS. (2026-09-02, second pass) The mixed sentence first
 * shipped as *"…the deploy in front of it lands and hello-api-app ships api
 * ^1.67.0"* — promotion clause first, contract clause second, because that
 * is simply the order the two `kind`s happen to be checked in. From the
 * human: *"The contract is the binding cause; the order gate follows on its
 * own once the provider ships."* A promotion gate is the environment
 * controller watching whether the environment IN FRONT has deployed — once
 * `hello-api-app` ships the version the contract needs, staging is free to
 * take it and prod's promotion gate opens behind it. The contract is the
 * one a person can act on (go find the provider's owner); the promotion
 * gate is bookkeeping that resolves once the contract does. Leading with it
 * is leading with the sentence's actual point.
 *
 * ⛔ NOT A CAUSAL CLAIM, THOUGH — A CONJUNCTION. A stronger form was
 * considered — *"this clears when hello-api-app ships api ^1.67.0; the
 * deploy in front of it follows"* — spelling the promotion gate as a
 * CONSEQUENCE of the contract clearing rather than a second, independent
 * condition. That is true on the live cluster today (staging is itself
 * gated on the same contract, so it deploys the moment the provider ships
 * and prod's promotion gate opens right behind it) but this function
 * cannot see that: `upstream` only carries THIS rollout's own gates, not
 * whatever is holding the environment named in the promotion clause. A
 * promotion gate can just as well be stuck on something the contract never
 * touches — a failing health check upstream, a pin, a second contract of
 * its own — and asserting "it follows" would be a claim about a rollout
 * this function never read. `and` stays a plain conjunction: both
 * conditions are true and named, in the order that leads with the one a
 * reader can act on, without promising a chain neither `blockingStory` nor
 * its caller has verified.
 */
/**
 * ⭐ "NOBODY HAS TO APPROVE ANYTHING" IS THE CLAUSE A 3AM READER STOPS AT,
 * AND FOR A CONTRACT GATE IT LEADS WITH THE WRONG HALF. (2026-09-03,
 * operator-walk finding 6) *"Nobody has to approve anything — this clears
 * when hello-api-app ships api ^1.67.0 and the deploy in front of it
 * lands."* The leading clause is the one a tired reader takes — "not mine" —
 * and stops there. It is true (no approval clears a contract gate) but it is
 * not the ACTIONABLE half, and it reads exactly like an all-clear on a gate
 * that will not move without hello-api-app's owner doing something.
 *
 * A `promotion`-only gate keeps the original sentence: it really is inert
 * from this rollout's own side, nothing but time and an upstream deploy
 * clears it, and "nobody has to approve anything" is the whole, honest
 * answer.
 *
 * A gate carrying a CONTRACT (`dependency`) is different, and now says so by
 * leading with the negative — *"No approval will unblock this."* — then
 * naming who has to ship what, then the one thing that DOES move it right
 * now: `!r.hasManualDeployment(&rollout) && ...` in the controller means a
 * gate only holds AUTOMATIC promotion, so a deploy a person starts by hand
 * still applies immediately. That is not a workaround the dashboard is
 * inventing; it is the one true escape hatch, and burying it under "nobody
 * has to approve anything" is why the rule's binding party never got the
 * page's attention.
 */
export function upstreamVerdict(gates: ClassifiedGate[]): string {
	const upstream = gates.filter((g) => g.clears === 'upstream');
	const promotion = upstream.some((g) => g.kind === 'promotion');
	const dependencies = upstream.filter((g) => g.kind === 'dependency');

	// A promotion-order gate ALONE is bookkeeping, not a stoppage: it opens
	// itself once the environment in front deploys. Keep the original
	// sentence — including the defensive "called with no upstream gate at
	// all" case, which falls back here too.
	if (dependencies.length === 0) {
		return 'Nobody has to approve anything — this clears when the deploy in front of it lands.';
	}

	// ⭐ CONTRACT CLAUSES FIRST, THEN THE PROMOTION CLAUSE AS A CONSEQUENCE,
	// NOT A COORDINATE ITEM. (2026-09-03, coordinator follow-up) `joinClauses`
	// joining "ship api ^1.67.0 from hello-api-app" AND "the deploy in front
	// of it lands" with a plain `and` read as two peer facts, when the second
	// is actually what happens NEXT, once the first is true — the promotion
	// gate is bookkeeping that resolves once the contract does (see the
	// function doc above). `, then … has to land` states the sequence instead
	// of a coordination.
	const shipClauses = dependencies.map((g) => {
		const provider = g.subject ?? 'the service it depends on';
		// A contract hold with no contract NAME (`classifyContractHold` — see
		// its own comment) still has a provider and often a range; say that
		// plainly rather than the grammatically odd "ship a newer version
		// ~2.9.0 from payments-svc".
		if (!g.contract) return g.need ? `ship ${g.need} from ${provider}` : `ship a newer version from ${provider}`;
		return g.need ? `ship ${g.contract} ${g.need} from ${provider}` : `ship a newer ${g.contract} from ${provider}`;
	});
	const then = promotion ? ', then the deploy in front of it has to land' : '';
	return `No approval will unblock this. Someone has to ${joinClauses(shipClauses)}${then}; until then the only way forward is a hand-started deploy, which bypasses the check.`;
}

/**
 * ⭐ THE CONTRACT LEADS THE HEADLINE TOO, NOT ONLY THE VERDICT. (2026-09-03)
 *
 * A promotion-order gate is the environment controller's own bookkeeping —
 * it opens once the environment IN FRONT deploys, and on `hello-frontend-app`
 * prod that environment is itself held on the SAME contract. Naming the order
 * gate ("waiting on another deploy") instead of the contract answers a
 * different question than the reader asked, for the same reason
 * `upstreamVerdict` leads with it — see that function's doc for the full
 * argument. Falls back to the generic sentence when no `dependency` gate is
 * present to name: two promotion gates holding the same rollout at two hops
 * is the one shape left with nothing more specific to say.
 *
 * ⭐ SHARED BY BOTH THE LONE-GATE AND THE UNIFORM-BUCKET CALLER. (2026-09-03)
 * `/rollouts/dev/hello-dep-dev/hello-frontend-app` carries ONLY the contract
 * gate, and it used to print the same generic sentence a lone promotion gate
 * does — "DEV is waiting on another deploy" — for the SAME contract that
 * PROD's two-gate banner (fixed above) now names by provider and range. One
 * gate is not a reason to say less than two gates of the identical kind, so
 * `blockingStory`'s `upstream.length === 1` branch calls this function too,
 * not a copy of it.
 */
function upstreamHeadline(upstream: ClassifiedGate[], subjectLead: string, isVerb: string): string {
	const dep = upstream.find((g) => g.kind === 'dependency' && g.subject);
	if (!dep) return `${subjectLead} ${isVerb} waiting on another deploy`;
	// ⭐ A CONTRACT HOLD HAS NO `contract` NAME ON THIS OBJECT — see
	// `classifyContractHold`'s own comment: it is read off a `GraphEdge`, not
	// off `GateContext.dependency`'s join, so it never learned the contract's
	// own name (`api`, `payments`), only the version range. `dep.contract`
	// null still names the PROVIDER and the range when `need` is known —
	// never silently falls back to the generic "waiting on another deploy"
	// sentence when there IS something more specific to say.
	const verb = dep.contract
		? dep.need
			? `ship ${dep.contract} ${dep.need}`
			: `ship a newer ${dep.contract}`
		: dep.need
			? `ship ${dep.need}`
			: 'ship a newer version';
	return `${subjectLead} ${isVerb} waiting for ${dep.subject} to ${verb}`;
}

/**
 * ⭐ ONE CAUSE UNDER TWO NAMES IS STILL ONE CAUSE. (2026-09-03)
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * `hello-frontend-app`'s rollout Overview banner read *"Two things are
 * holding PROD"* while `/envs/prod`, `/apps` and `/dependencies` all named
 * the cause — `hello-api-app` has not shipped `api ^1.67.0`. Both of PROD's
 * gates ARE that one cause: `hello-frontend-needs-api` is the contract, and
 * the promotion-order gate ("after staging") only exists because staging is
 * held on the identical contract — it is downstream bookkeeping, not a
 * second reason. `gates.length > 1` used to fire before either gate's
 * `clears` was even read, so a rollout held twice by ONE mechanism and a
 * rollout held by a person AND a contract printed the identical shape of
 * sentence: a bare count.
 *
 * ── THE FIX ───────────────────────────────────────────────────────────────
 *
 * When EVERY blocking gate agrees on `clears`, there is only one KIND of
 * story regardless of how many gates carry it, so the headline is the one
 * that kind would print alone: `person` and `unknown` read exactly like
 * their single-gate branches below (the verb does not change with the
 * count — only the disclosure control, `N rules`, does, and that lives in
 * `BlockingStoryPanel`, not here). `upstream` goes through
 * `upstreamHeadline`, which names the contract for the same reason
 * `upstreamVerdict` does.
 *
 * ⛔ `clock` AND `check` ARE LEFT OUT ON PURPOSE. Neither has a headline of
 * its own that says more than the count already does — a lone `check` gate
 * prints the SAME generic `'Automatic deploys are paused'` a mixed pile of
 * seven does, so collapsing a uniform pile of seven checks to that sentence
 * would throw away the one fact the count carries (how many) for no fact
 * gained. `person`/`unknown`/`upstream` are different: each has a headline
 * that names something the count does not.
 *
 * ⛔ WHEN THE BUCKETS DIFFER, THE COUNT STAYS. A person gate and a contract
 * are two DIFFERENT kinds of story — one needs a human, one does not — and
 * collapsing them into either one's headline would misreport the other. The
 * count headline already exists for exactly this case and is untouched;
 * only the CONSEQUENCE below reorders to put the human-actionable clause
 * first, which the existing worst-first build order already does.
 *
 * Returns `null` for a single gate, a mixed bucket, or a uniform `clock`/
 * `check` bucket, so the caller falls through to the count headline in all
 * three cases — every single-gate headline this file has ever printed stays
 * byte-identical.
 */
function sameBucketHeadline(
	gates: ClassifiedGate[],
	upstream: ClassifiedGate[],
	subjectLead: string,
	subjectObject: string,
	isVerb: string
): string | null {
	if (gates.length <= 1) return null;
	const cause = gates[0].clears;
	if (!gates.every((g) => g.clears === cause)) return null;
	if (cause === 'person') return `${subjectLead} ${isVerb} waiting on an approval`;
	if (cause === 'unknown') return `Something is holding ${subjectObject}`;
	if (cause === 'upstream') return upstreamHeadline(upstream, subjectLead, isVerb);
	// `clock`/`check`: no headline of their own beats the count — see the doc
	// above. Falls through to it.
	return null;
}

/**
 * ⭐ THE CONTRACT LEADS THE CONSEQUENCE TOO, AND NOT BY ACCIDENT OF SPELLING.
 * (2026-09-03) `upstream`'s only order was the gates' own worst-first sort's
 * id tiebreak — `dependency-hello-frontend-needs-api` happened to sort before
 * `ghd-frontend-prod` alphabetically, which is exactly why this drifted
 * unnoticed: a hand-authored gate or a differently-`generateName`d one is not
 * guaranteed to alphabetise the same way. `upstreamVerdict` already has the
 * real rule — the contract is the binding cause, the promotion gate is the
 * consequence that resolves once it ships — so the consequence's clause list
 * uses the same ordering rather than reusing whatever the id sort produced.
 */
function orderedUpstream(upstream: ClassifiedGate[]): ClassifiedGate[] {
	const dependencies = upstream.filter((g) => g.kind === 'dependency');
	const rest = upstream.filter((g) => g.kind !== 'dependency');
	return [...dependencies, ...rest];
}

/** THE one phrase for "N newer builds are": with the fleet pending it carries no number. Every surface printing "... waiting." goes through it. */
export const newerBuildsAre = (n: number, pending: boolean): string =>
	pending ? 'Newer builds are' : `${n} newer build${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'}`;

/**
 * ⭐ THE ONE STORY. Every surface calls this and renders the same three
 * strings, so two pages cannot answer the 3am question differently again.
 *
 * `place` is the environment label (`STAGING`) when the caller has one. It is
 * used verbatim and never invented: a rollout detail page has no environment
 * bracket to speak of and gets the un-placed wording.
 */
export function blockingStory(
	rollout: Rollout | null | undefined,
	ctx: GateContext = EMPTY_GATE_CONTEXT,
	options: {
		place?: string | null;
		subject?: StorySubject | null;
		now?: Date;
		/** the fleet lists the place's wave chain lives in (failed-builds.ts `Fleet`): without one only a failure HERE is subtracted from the printed count */
		fleet?: Fleet | null;
		/** false while the fleet query is still loading: the sentences print NO "N newer builds" (a number that the wave subtraction would correct later); default true. The route passes `fleetSettled(query)` (behind.ts), the rule the header chip uses. */
		settled?: boolean;
		/**
		 * ⭐ THE HOLD-ONE-RULE'S OTHER HALF. (2026-10-09, coordinator ruling.)
		 * "Held" = refused by a gate OR held by a contract, per build —
		 * `block` below reads `rollout.status.gates` alone and cannot see a
		 * `RolloutDependency` contract the controller never published there.
		 * `promotionHoldBreakdown` is given this SAME map so the two can never
		 * disagree about which candidates are held. Built off the dependency
		 * graph by `contractHoldsForRollout` (`dependency-graph.ts`); `undefined`
		 * on a caller with no graph in hand, which keeps this byte-identical to
		 * every existing gate-only call site. Keyed on a LIST per version — see
		 * `ContractHolds`' own doc for why one build can be held by more than
		 * one contract at once.
		 */
		contractHolds?: ContractHolds;
		/** See `heldBuilds`' `skipped` (QA round 2 A8). */
		skipped?: (entry: { tag: string }, stage: string) => boolean;
	} = {}
): BlockingStory {
	const namespace = rollout?.metadata?.namespace;
	const block: PromotionBlock = promotionBlock(rollout);
	const pinnedTo = rollout?.spec?.wantedVersion ?? null;
	const candidateCount = promotionCandidates(rollout).length;
	const newerCount = liveForPlace(rollout as never, promotionCandidates(rollout) as never, options.fleet).length; /* what sentences print (batch4 #3d) */
	const countPending = options.settled === false; /* the fleet has not answered: say it without the number */
	const shownNewer = countPending ? candidateCount : newerCount; /* pending: only whether any build waits, never how many */
	// An environment is a NAME, set as written, never uppercased (design
	// language principle 11; uppercase is for state labels only). Was
	// `toUpperCase()`: "hello-world in PROD", "PROD-EU-" / "CENTRAL" at 390.
	const place = options.place ? options.place : null;
	/**
	 * ⭐ THE SUBJECT IS THE CALLER'S, BECAUSE WHAT IDENTIFIES A ROLLOUT
	 * DEPENDS ON THE PAGE. (2026-08-31)
	 *
	 * `place` alone answers "which environment", and that is the whole subject
	 * on a surface where the APP is already fixed — rollout detail, `/apps`,
	 * `/apps/<name>`. On `/environments` it is fixed the other way round: the
	 * page's own banner spoke for one rollout and said *"DEV is waiting on an
	 * approval"* on a page listing two apps in three environments, with the
	 * app name nowhere in the banner. The sentence was TRUE and it did not say
	 * what it was about, which is the second half of the same defect.
	 *
	 * So a caller that has both axes passes both, verbatim — and verbatim
	 * matters: `place` is upper-cased because an environment label is a chip
	 * elsewhere in the product, and upper-casing an APP name would rename it.
	 *
	 * ⭐ AND IT MAY NOW BE A SET — see `StorySubject` above. `subjectLead` /
	 * `subjectObject` / `isVerb` are the three values every headline template
	 * below is built from; a plain string collapses all three to the old
	 * behaviour exactly (`lead === object`, `is`).
	 */
	const subjectOpt = options.subject;
	const isSet = typeof subjectOpt === 'object' && subjectOpt !== null;
	const subjectLead = isSet ? subjectOpt.lead : subjectOpt || place || 'this service';
	const subjectObject = isSet ? (subjectOpt.object ?? subjectOpt.lead) : subjectLead;
	const isVerb = isSet ? 'are' : 'is';
	const now = options.now ?? new Date();

	// A PIN OUTRANKS EVERY GATE and short-circuits. A gate holds the NEXT
	// build; a pin refuses all of them. While `wantedVersion` is set, every
	// gate is also blocking and none of them is the cause — the exact defect
	// reported as *"that panel blamed HELD BY hello-world-manual-approval; the
	// actual cause was the pin, which the page never mentioned."*
	if (pinnedTo) {
		// ⛔ THE RAW OCI TAG NEVER PRINTS. `~60 characters
		// (main-1788002370-0afab6f35627254181e41053c51660f26a8ccee2)` against
		// `0afab6f` everywhere else this product names a build.
		const pinnedToDisplay = displayVersionForTag(rollout, pinnedTo) || pinnedTo;
		return {
			...NOT_BLOCKED,
			candidates: [],
			blocked: candidateCount > 0,
			candidateCount,
			newerCount,
			countPending,
			pinnedTo,
			pinnedToDisplay,
			selfClearing: false,
			// `info` (blue) — pinning is a STATE A PERSON CHOSE, not a rule
			// holding the rollout back. See the field's own doc comment (F2).
			severity: 'info',
			headline: `${subjectLead} ${isVerb} pinned to ${pinnedToDisplay}`,
			consequence:
				shownNewer > 0
					? `${newerBuildsAre(newerCount, countPending)} available and none of them will deploy while the pin is set.`
					: 'Automatic updates are off here until the pin is cleared.',
			verdict: 'Clearing the pin is the only thing that restarts automatic deploys.',
			resolution: 'Clearing the pin is the only thing that restarts automatic deploys.',
			iconKind: 'pinned'
		};
	}

	// ⭐ THE HOLD-ONE-RULE: "BLOCKED" IS THE UNION, NEVER `block.blocked` ALONE.
	// (2026-10-09, coordinator ruling.) `block` (`promotionBlock`, above) reads
	// `rollout.status.gates` only, so a candidate held purely by a dependency
	// contract the controller never publishes there (`ckGates()`'s own fixture
	// comment, `mock-data.ts`) reads as "deployable" to `block` alone — the
	// exact defect this ruling exists to close. `promotionHoldBreakdown` is the
	// SAME per-build read the Overview's "Newer builds" rows and the Gates tab
	// already use, given the SAME `contractHolds` map, so this verdict can
	// never disagree with either.
	const breakdown = promotionHoldBreakdown(rollout, ctx, { contractHolds: options.contractHolds });
	if (!breakdown.allHeld) {
		// ⭐ qa12: `candidates` STILL CARRIES THE REAL PER-BUILD READ HERE,
		// even though nothing refuses every candidate at once (`allHeld` is
		// the OLD single-cause question — "can this promote at all"). A
		// caller running `heldVerdict`'s frontier rule over this story still
		// needs the real `perBuild` list to find whether the newest
		// ELIGIBLE candidate is held or merely queued; leaving it empty
		// here would silently hide a genuine "waits for `<stage>`" fact
		// whenever an OLDER candidate happens to be fully deployable.
		return { ...NOT_BLOCKED, candidateCount, newerCount, countPending, candidates: breakdown.perBuild };
	}

	// The gate OBJECTS, not the names: `promotionBlock` publishes names only, so
	// re-select the summaries it attributed the block to. Same predicate, so the
	// two cannot disagree about which gates are holding it.
	//
	// ⛔ `block.blockingGates` CAN BE EMPTY HERE AND STILL BE RIGHT. It is
	// "gates that refuse EVERY candidate" (plus `promotionBlock`'s own
	// newest-candidate fallback) — a GATE-ONLY read. When the union above is
	// what makes `allHeld` true (a contract holds the one candidate no status
	// gate touches), no single status gate need refuse all of them, so this
	// falls back to the union of every held candidate's OWN blocking gate
	// names — still gate names actually published on `rollout.status.gates`,
	// never invented.
	const holdingNames =
		block.blockingGates.length > 0
			? new Set(block.blockingGates)
			: new Set(breakdown.held.flatMap((h) => h.gateNames));
	const allStatusGates = (rollout?.status?.gates ?? [])
		.filter((g) => g?.name && holdingNames.has(g.name))
		.map((g) => classifyGate(g, namespace, ctx));
	// A dependency-owned gate no join could name (nameless) is the same cause as
	// the contract hold that does name it: keep the contract, never both.
	const allContracts = breakdown.held.flatMap((h) => h.contracts);
	const statusGates = allStatusGates.filter(
		(g) => !(g.kind === 'dependency' && !g.subject && isDependencyGateCoveredBy(g, allContracts))
	);

	// ⭐ THE CONTRACT HOLDS, AS THEIR OWN CLASSIFIED ENTRIES. (2026-10-09)
	// Deduped by provider — a `RolloutDependency` contract hold is ONE fact
	// regardless of how many candidates it holds back (`4.43.0-43` and
	// `4.44.0-44` behind the SAME `payments-svc ~2.9.0` read as one gate, not
	// two). Skipped when a status gate ALREADY named this exact provider as a
	// `dependency` (the ordinary case where the controller did publish the
	// contract gate) — never doubling the same cause under two entries.
	const existingDependencyProviders = new Set(
		statusGates.filter((g) => g.kind === 'dependency' && g.subject).map((g) => g.subject as string)
	);
	const contractHoldsByProvider = new Map<string, ContractHold>();
	for (const h of breakdown.held) {
		for (const c of h.contracts) contractHoldsByProvider.set(c.provider, c);
	}
	const contractGates = [...contractHoldsByProvider.values()]
		.filter((h) => !existingDependencyProviders.has(h.provider))
		.map((h) => classifyContractHold(h));

	const gates = [...statusGates, ...contractGates].sort((a, b) => {
		// Worst first: a person, then a rule we cannot attribute, then
		// another deploy, then a clock. The reader's question is "is this
		// mine", so the answer leads — and "we cannot tell" ranks second
		// because it is the only other answer that might be yes.
		const rank = { person: 0, unknown: 1, upstream: 2, check: 3, clock: 4 } as const;
		return rank[a.clears] - rank[b.clears] || a.id.localeCompare(b.id);
	});

	const person = gates.filter((g) => g.clears === 'person');
	const unknown = gates.filter((g) => g.clears === 'unknown');
	const upstream = gates.filter((g) => g.clears === 'upstream');
	const clock = gates.filter((g) => g.clears === 'clock');
	const checks = gates.filter((g) => g.clears === 'check');

	let clearsAt: string | null = null;
	for (const g of clock) {
		if (!g.clearsAt) continue;
		if (!clearsAt || new Date(g.clearsAt) < new Date(clearsAt)) clearsAt = g.clearsAt;
	}

	// ⛔ `unknown` COUNTS AGAINST `selfClearing`. Every surface uses this flag
	// to decide whether a rollout can be filed under "sorts itself out", and a
	// rule we cannot attribute has not earned that. Not knowing is not benign.
	const selfClearing = person.length === 0 && upstream.length === 0 && unknown.length === 0;

	// ── THE HEADLINE ────────────────────────────────────────────────────────
	// With more than one gate it COUNTS THEM AND SAYS SO, because the single
	// biggest thing wrong with the old pages was each naming one gate as if it
	// were the whole story — UNLESS every gate agrees on `clears`, in which
	// case there is only one KIND of story and `sameBucketHeadline` names it
	// the same way its single-gate branch would. With exactly one gate it
	// names that one's kind.
	let headline: string;
	const bucketHeadline = sameBucketHeadline(gates, upstream, subjectLead, subjectObject, isVerb);
	if (bucketHeadline) {
		headline = bucketHeadline;
	} else if (gates.length > 1) {
		headline = `${countWord(gates.length)} things are holding ${subjectObject}`;
	} else if (gates.length === 1 && gates[0].headline) {
		headline = gates[0].headline;
	} else if (person.length === 1) {
		headline = `${subjectLead} ${isVerb} waiting on an approval`;
	} else if (unknown.length === 1) {
		// ⛔ NOT "waiting on an approval". The whole point of `unknown` is that
		// we do not know what it is waiting on, and the headline is the one line
		// a reader takes at a glance — so it states the fact and no remedy.
		//
		// ⚠️ `Something is …` — the SENTENCE's subject is `Something`, not the
		// caller's `subject`, which sits in OBJECT position here and so takes
		// `subjectObject` (never `isVerb`: "is" agrees with "Something").
		headline = `Something is holding ${subjectObject}`;
	} else if (upstream.length === 1) {
		// ⭐ THE SAME RULE AS THE MULTI-GATE CASE, FOR ONE GATE. (2026-09-03)
		// `/rollouts/dev/hello-dep-dev/hello-frontend-app` has ONLY the contract
		// gate and used to print the generic "DEV is waiting on another
		// deploy" while the two-gate PROD banner, fixed above, named
		// `hello-api-app` and `^1.67.0` for the SAME contract. One gate is not
		// a reason to know less than two gates of the identical kind —
		// `upstreamHeadline` already carries the "name the contract when
		// there is one to name" rule, so the lone-gate branch calls the exact
		// function the uniform-bucket branch does, and a lone promotion-order
		// gate (no `dependency` gate present) still falls back to the generic
		// sentence unchanged.
		headline = upstreamHeadline(upstream, subjectLead, isVerb);
	} else {
		// (2026-09-03, vocabulary pass) Was 'Automatic deploys are paused' —
		// one of five "paused" spellings the state-word census found for the
		// SAME fact `HELD`/`is held` already name everywhere else. This is
		// the generic fallback (a `check`/`clock` gate with nothing more
		// specific to say), so it gets the same word every other branch
		// above it already uses.
		headline = `${subjectLead} ${isVerb} held`;
	}

	// ── THE CONSEQUENCE ─────────────────────────────────────────────────────
	// Every gate contributes its own clause, in the same worst-first order, and
	// the clock gate carries its actual time. This is the line that made
	// `/versions` the one page the critic said got it right.
	const parts: string[] = [];
	for (const g of person) parts.push(g.clause);
	for (const g of unknown) parts.push(g.clause);
	for (const g of orderedUpstream(upstream)) parts.push(g.clause);
	for (const g of checks) parts.push(g.clause);
	for (const g of clock) {
		const until = g.clearsAt ? formatTimeUntil(g.clearsAt, now) : null;
		// ⭐ P2, operator-walk finding — see `ClassifiedGate.timezone`'s own
		// comment. This used to be `new Date(g.clearsAt!).toLocaleString()`:
		// the READER's machine zone, US date order, and seconds on a
		// schedule boundary — `(9/3/2026, 1:00:00 PM)` beside a rule whose
		// own label says `9 AM - 5 PM EST`, with no zone printed at all.
		// `formatAbsoluteReopen` formats against the SCHEDULE's own
		// `spec.timezone` and states it by name, with the UTC reading beside
		// it so no reader has to already know what that zone means.
		parts.push(
			until
				? `${g.clause} in ${until} — ${formatAbsoluteReopen(g.clearsAt!)}`
				: g.clause
		);
	}
	// ⭐ ONE OPENER, THE REFERENCE PAGE'S OWN WORDS. The rollout detail banner —
	// the page the human calls beautiful — says *"Nothing promotes itself
	// until …"*, and a reader who has learned that sentence there reads the
	// same sentence here with N causes behind it instead of one. It is also
	// what makes every clause a lowercase noun clause, so the sentence never
	// capitalises an environment name to start itself.
	// QA (TL, 2026-11-09): the lead must count the builds THESE holds refuse here, the same per-build predicate the Gates tab's "Held builds"
	// list uses (`verdictForGates` on each build's own gates). A candidate that has not cleared an earlier stage is "waiting for <stage>",
	// not held by this approval: saying "5 newer builds are waiting" beside "3 held here" claimed an approval would release 5.
	const hb = heldBuilds(breakdown, options.place, options.skipped);
	const heldHere = hb.held.length;
	const notYet = hb.waiting.find((w) => w.stage)?.stage ?? null;
	const skippedStage = hb.skipped[0]?.stage ?? null;
	const plural = (n: number) => `build${n === 1 ? '' : 's'}`;
	const nWait = hb.waiting.length;
	const nSkip = hb.skipped.length;
	const lead =
		candidateCount > 0
			? heldHere > 0 && heldHere < candidateCount && (notYet || skippedStage)
				? `${heldHere} newer ${plural(heldHere)} ${heldHere === 1 ? 'is' : 'are'} waiting here` +
					(nWait > 0 && notYet ? `; ${nWait} more ${nWait === 1 ? "hasn't" : "haven't"} reached ${notYet} yet` : '') +
					(nSkip > 0 && skippedStage ? `; ${nSkip} ${nSkip === 1 ? 'was' : 'were'} skipped by ${skippedStage}, which runs a newer ${plural(1)}` : '') +
					'. '
				: shownNewer > 0
				? `${newerBuildsAre(newerCount, countPending)} waiting. `
				: ''
			: '';
	const consequence = `${lead}Nothing promotes itself until ${joinClauses(parts)}.`;

	// ── THE VERDICT ─────────────────────────────────────────────────────────
	// The 3am answer, and the promise the product already keeps.
	const manual = 'A deploy you start by hand still applies immediately.';
	let verdict: string;
	// ⛔ THE MANUAL CLAUSE WAS DOUBLING ITSELF. (2026-09-03, coordinator
	// follow-up) `upstreamVerdict` now STATES the hand-started-deploy escape
	// hatch itself for a CONTRACT gate — "…until then the only way forward is
	// a hand-started deploy, which bypasses the check." — and `resolution`
	// below unconditionally appended the generic `manual` sentence after
	// every verdict, so a contract gate's banner read the identical fact
	// twice back to back. `verdictCoversManual` is true exactly when the
	// verdict already said it; every OTHER gate class (person, unknown, a
	// promotion-only upstream gate, check, clock) still needs `manual`
	// appended, because none of THEIR verdict sentences mention it.
	let verdictCoversManual = false;
	if (person.length > 0) {
		verdict = 'This will not clear on its own.';
	} else if (unknown.length > 0) {
		// The one sentence this whole branch exists for. It refuses BOTH wrong
		// instructions — "go and find an approver" and "go back to bed" — and
		// the reader is left with the handle, which is the honest place to send
		// them. Something true and non-committal beats a confident wrong one.
		verdict = 'This dashboard cannot tell what clears this — it may or may not need a person.';
	} else if (upstream.length > 0) {
		verdict = upstreamVerdict(upstream);
		verdictCoversManual = upstream.some((g) => g.kind === 'dependency');
	} else if (clearsAt) {
		verdict = 'This clears on its own.';
	} else {
		verdict = 'This clears on its own once the check passes.';
	}
	const resolution = verdictCoversManual ? verdict : `${verdict} ${manual}`;

	// ⭐ WORST-FIRST, THE SAME ORDER THE SENTENCE ITSELF IS BUILT IN. A person
	// glyph over "we cannot tell what clears this" is the same picture-scale
	// lie an unattributed gate would tell with `person`'s icon, so `unknown`
	// still outranks `upstream` here exactly as it does in every clause above.
	let iconKind: StoryIconKind =
		person.length > 0
			? 'person'
			: unknown.length > 0
				? 'unknown'
				: upstream.length > 0
					? upstream[0].kind === 'dependency'
						? 'dependency'
						: 'promotion'
					: clock.length > 0
						? 'clock'
						: 'check';

	// ⭐ THE HERO CLAIM'S OWN "IS THIS EVEN THE RIGHT KIND" FLAG. (2026-09-04,
	// load-state audit finding 4) `checks.some(pending)` — a gate the model
	// currently calls `check` purely because `/schedules` has not answered
	// yet. Only overrides the glyph when `check` is what's ACTUALLY driving
	// it: a genuine `clock`/`person`/`unknown`/`upstream` gate elsewhere in
	// the same story already outranks `check` above, so its glyph is real
	// regardless of what a co-occurring pending check might turn out to be.
	const kindPending = checks.some((g) => g.pending);
	if (iconKind === 'check' && kindPending) iconKind = 'pending';

	return {
		blocked: true,
		candidateCount,
		newerCount,
		countPending,
		pinnedTo: null,
		pinnedToDisplay: null,
		gates,
		person,
		clock,
		upstream,
		checks,
		unknown,
		clearsAt,
		selfClearing,
		headline,
		consequence,
		verdict,
		resolution,
		// ⭐ ALWAYS `warning` HERE. See the field's own doc comment (F2,
		// 2026-09-03): every gate this branch can hold on — person, unknown,
		// upstream, clock, check — is a RULE, not a choice, whether or not it
		// clears on its own. `selfClearing` answers "does this need a
		// person", a different question this field no longer conflates with
		// colour.
		severity: gates.some((g) => g.fault) ? 'error' : 'warning',
		iconKind,
		kindPending,
		candidates: breakdown.perBuild
	};
}

/**
 * The gates' HANDLES, for the `rule:` footnote. Names only, never prose — the
 * labels are already in `consequence`, and a page that prints both is printing
 * the identifier twice.
 */
export function ruleHandle(story: BlockingStory): string | null {
	if (story.gates.length === 0) return null;
	return story.gates.map((g) => g.id).join(', ');
}

/**
 * A ONE-LINE form for a row or a card body, where a three-string banner does
 * not fit. It keeps the fact that a banner keeps — HOW MANY and WHETHER A
 * PERSON — and drops only the clock arithmetic.
 *
 * ⛔ It is derived from the same story, so a row and the banner above it can
 * never disagree. The old product had `/apps` blaming one gate, rollout detail
 * saying "1 schedule", and `/apps/<name>` naming two others.
 */
/**
 * ⭐ ONE STORY, ONE COUNT — SO A COUNT NEVER DRIFTS FROM THE STORY IT SITS
 * UNDER. (2026-09-03, coordinator finding 2)
 *
 * `hello-frontend-app` printed FIVE different counts of "how many rules"
 * across five surfaces for what was, on close reading, the same fact viewed
 * from different subjects: prod's Overview banner said `2 rules`
 * (`story.gates.length` for prod's own rollout, via `RulePopover`'s
 * `countLabel`), the Dependencies tab said `1 contract` (only the
 * `dependency`-kind gate, dropping the downstream promotion-order gate that
 * is the SAME contract's own bookkeeping), and the revision page unioned
 * gate NAMES across dev+staging+prod into a bare `3 rules` with no subject
 * at all. Two of those five are wrong not because the number is wrong but
 * because nothing produces it FROM a `BlockingStory` — a caller re-derived
 * its own count from a gate-name array, which is exactly the shape that let
 * the Overview and the tab disagree about a rollout sitting under the same
 * banner.
 *
 * `ruleCountLabel` is the one producer: it reads `story.gates.length`, the
 * same field `RulePopover`'s `Kind`/`Now`/`Clears` record already lists in
 * full, so a caller printing this string and a caller printing the record
 * behind it can never disagree about how many rows are in it. Never call
 * this on a name array or a union across rollouts — a caller with MORE THAN
 * ONE rollout's story has to say so (see the revision page's own per-
 * environment breakdown), not flatten them into one number this function
 * would then mislabel as a single subject's count.
 */
export function ruleCountLabel(story: BlockingStory): string {
	return countLabel(story.gates.length, 'rule');
}

/**
 * ⭐ THE DEPENDENCIES TAB'S OWN EXCEPTION, MADE PRECISE. (2026-09-03)
 *
 * `lib/CLAUDE.md`'s vocabulary decision (b) carves out `1 contract` on the
 * Dependencies tab as a DELIBERATE exception to the generic `N rule(s)`
 * disclosure — "that tab's every row IS a contract, so naming the kind
 * there is the kind mattering". But `story.gates` for a rollout held on a
 * contract can ALSO carry the downstream promotion-order gate that exists
 * only because the contract hasn't cleared (see `upstreamVerdict`'s own
 * doc) — printing bare `1 contract` there silently drops that second gate,
 * which is the defect this pass found: the tab said `1 contract` while the
 * Overview it sits under said `2 rules` for the identical rollout.
 *
 * So the tab's count names BOTH when they differ — `1 contract of 2 rules`
 * — and collapses to the plain contract count only when every held gate
 * actually is one (no bookkeeping gate riding along), so the common case
 * (a rollout with nothing downstream of it, e.g. `/rollouts/dev/…`) still
 * reads as the tab's own established `1 contract` / `N contracts`.
 */
export function contractRuleCountLabel(story: BlockingStory): string {
	const contracts = story.gates.filter((g) => g.kind === 'dependency').length;
	if (contracts === 0) return ruleCountLabel(story);
	if (contracts === story.gates.length) return countLabel(contracts, 'contract');
	return `${countLabel(contracts, 'contract')} of ${ruleCountLabel(story)}`;
}

/**
 * ⭐ PER-BUILD HELD, BESIDE `blockingStory`'S PER-ROLLOUT VERDICT. (New,
 * additive — squad-rollout coordinator, 2026-10-09, cleared with the
 * design-rollout TL as a pure helper beside `blockingStory`, not a change
 * to its contract.)
 *
 * `blockingStory` answers "can THIS ROLLOUT promote AT ALL right now" —
 * true (`blocked`) only when EVERY candidate is refused (`promotionBlock`'s
 * own rule: `deployableCount === 0`). That is the right question for a
 * banner, and it is RIGHT to say nothing when an older candidate can still
 * deploy even though a newer one cannot. Measured live,
 * `checkout-api/prod-us-east-2` (CHECKING): `4.43.0-43`/`4.44.0-44`/
 * `4.45.0-45` are each held behind `payments-svc`, `4.42.0-42` (the one
 * currently applying) is not — the Overview correctly shows no banner
 * there, and the rollout is not stuck; nobody has promoted past what IS
 * available yet.
 *
 * A caller that needs the OTHER true fact — "which of my candidates are
 * individually held, and by what" (the Overview's own "Newer builds" rows,
 * the Gates tab's lead sentence, the Change Version picker's row glyphs) —
 * reads THIS function instead of inventing a second read of
 * `rollout.status.gates`. It is built from the exact same shared
 * primitives the Overview's per-row read already uses —
 * `promotionCandidates`, `blockingGateNames` (`promotion.ts`'s own "ONE
 * SHARED PREDICATE FOR is this build held, and by what" doc comment) and
 * `classifyGate` — so the build ids and the gate clauses this names can
 * never disagree with what the Overview's row already shows for the same
 * build.
 *
 * `allHeld` IS `blockingStory(...).blocked` for the promotion case: the
 * environment is held (the banner) only when no candidate can move. It
 * carries no prose: a caller that needs the sentence takes `blockingStory`'s
 * words when `allHeld`, and composes the mixed case from `held`/`deployable`
 * on its own page (the words live with the page that prints them).
 *
 * ⭐ THE HOLD-ONE-RULE: "HELD" = REFUSED BY A GATE *OR* HELD BY A CONTRACT.
 * (2026-10-09, coordinator ruling.) `gateNames`/`clauses` alone, read off
 * `rollout.status.gates`, miss a `RolloutDependency` contract whose gate the
 * controller never publishes there (`ckGates()`'s own fixture comment).
 * `options.contractHolds` — built by `contractHoldsForRollout`
 * (`dependency-graph.ts`), off the SAME graph the Overview/Gates tab already
 * read — is the other half of the same join: a candidate is held when
 * EITHER source says so, and `allHeld` is the union, never the gate-only
 * read alone.
 */
export type PromotionHoldBreakdown = {
	/** Every promotion candidate at least one gate OR contract refuses, newest first. */
	held: {
		build: string;
		tag: string;
		gateNames: string[];
		clauses: string[];
		/**
		 * The FIRST contract holding this build back, when `options.contractHolds`
		 * named at least one — kept for callers that only ever expected one.
		 * Prefer `contracts` (below), which never drops a second provider.
		 */
		contract?: ContractHold;
		/** Every contract holding this build back. Empty, never undefined. */
		contracts: ContractHold[];
		/**
		 * ⭐ THIS BUILD'S OWN GATES, CLASSIFIED — status gates named in
		 * `gateNames` PLUS this build's own `contracts` (above), each run
		 * through `classifyGate`/`classifyContractHold` exactly as
		 * `blockingStory`'s whole-rollout `gates` field is built, just
		 * scoped to this one candidate rather than unioned across every
		 * held candidate. (squad-rollout gates-2 follow-up, 2026-10-11)
		 *
		 * This is what `held.ts`'s `verdictForGates` reads to tell a
		 * chain-refused candidate ("waits for staging", not yet reached)
		 * apart from one this environment genuinely refuses — `gateNames`/
		 * `clauses` are names and prose, not classified gates, and cannot
		 * answer "is this a same-tier order gate or an earlier-tier chain
		 * link" on their own.
		 */
		classifiedGates: ClassifiedGate[];
	}[];
	/** Every candidate every gate AND every contract allows, newest first — display build ids. */
	deployable: string[];
	/** True once `held.length > 0` — what the Gates header/rollup count against. */
	anyHeld: boolean;
	/** True when EVERY candidate is held — the case that must agree with `blockingStory`. */
	allHeld: boolean;
	/**
	 * ⭐ EVERY CANDIDATE, HELD AND DEPLOYABLE ALIKE, NEWEST FIRST — THE ONE
	 * ORDERED LIST `heldVerdict`'s FRONTIER RULE WALKS. (qa12, squad-rollout
	 * gates-2 follow-up, 2026-10-11, tl-integrate ruling.) `held`/`deployable`
	 * above are both filtered VIEWS of this same array — this is the array
	 * itself, unfiltered, in `promotionCandidates`' own newest-first order.
	 * `held.ts`'s `frontierVerdict` finds the newest entry here that has
	 * cleared every earlier stage (not chain-refused by its own
	 * `classifiedGates`) and reports THAT one's own verdict as the place's
	 * — never a blend of every held candidate's causes into one list, which
	 * is the exact defect (a newer chain-refused candidate's gate silently
	 * outranking an older candidate's real, local hold) this field exists
	 * to let `heldVerdict` stop reproducing.
	 */
	perBuild: {
		build: string;
		tag: string;
		gateNames: string[];
		clauses: string[];
		contract?: ContractHold;
		contracts: ContractHold[];
		classifiedGates: ClassifiedGate[];
	}[];
};

export function promotionHoldBreakdown(
	rollout: Rollout | null | undefined,
	ctx: GateContext = EMPTY_GATE_CONTEXT,
	options: {
		place?: string | null;
		subject?: StorySubject | null;
		now?: Date;
		/** Keyed on the DISPLAY version — see `ContractHolds`' own doc comment. */
		contractHolds?: ContractHolds;
	} = {}
): PromotionHoldBreakdown {
	const namespace = rollout?.metadata?.namespace;
	const candidates = promotionCandidates(rollout);
	const statusGates = rollout?.status?.gates ?? [];
	const contractHolds = options.contractHolds;

	const perBuild = candidates.map((c) => {
		const tag = c.tag ?? c.version ?? '';
		const build = displayVersionForTag(rollout, tag) || tag;
		const gateNames = blockingGateNames(rollout, tag || null);
		const held = new Set(gateNames);
		const contracts = [...(contractHolds?.get(build) ?? [])];
		// ⭐ A DEPENDENCY'S RolloutGate AND ITS CONTRACT HOLD ARE ONE CAUSE. The
		// controller writes a RolloutGate (owner RolloutDependency) on every
		// consumer; `contractHolds` names the same dependency from the graph.
		// The contract entry carries the richer fact (required range + what the
		// provider has), so the gate that is the same dependency is dropped from
		// `clauses` and from `classifiedGates`, never listed beside it.
		const classifiedStatusGates = statusGates
			.filter((g) => g?.name && held.has(g.name))
			.map((g) => classifyGate(g, namespace, ctx))
			.filter((g) => !isDependencyGateCoveredBy(g, contracts));
		const clauses = [...new Set(classifiedStatusGates.map((g) => g.clause))];
		// Same dedupe `blockingStory` applies at the whole-rollout level
		// (above, `existingDependencyProviders`), scoped to this build: a
		// contract the controller already published AS a status gate for
		// THIS candidate is not counted a second time.
		const existingDependencyProviders = new Set(
			classifiedStatusGates.filter((g) => g.kind === 'dependency' && g.subject).map((g) => g.subject as string)
		);
		const contractGates = contracts
			.filter((c) => !existingDependencyProviders.has(c.provider))
			.map((c) => classifyContractHold(c));
		const classifiedGates = [...classifiedStatusGates, ...contractGates];
		return { build, tag, gateNames, clauses, contract: contracts[0], contracts, classifiedGates };
	});

	const held = perBuild.filter((b) => b.gateNames.length > 0 || b.contracts.length > 0);
	const deployable = perBuild
		.filter((b) => b.gateNames.length === 0 && b.contracts.length === 0)
		.map((b) => b.build);
	const allHeld = candidates.length > 0 && deployable.length === 0 && held.length > 0;

	if (held.length === 0) {
		return { held: [], deployable, anyHeld: false, allHeld: false, perBuild };
	}

	return { held, deployable, anyHeld: true, allHeld, perBuild };
}

/**
 * ⭐ ONE CAUSE PHRASE, EVERY SURFACE THAT NAMES WHY A HOLD EXISTS. (2026-10-10,
 * coordinator ruling, design-rollout TL commit "held-cause-phrase".)
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────
 *
 * The changes page's `HeldBanner` titled itself `${subject} is held` and drew
 * a person glyph for EVERY hold that was not on a schedule — a promotion-order
 * hold and a contract hold (neither of which any person can approve) both
 * wore the same face as an actual approval gate. The same fact, read off the
 * identical `BlockingStory`, printed `"${place} is waiting on an approval"`
 * on Home for a rollout the Overview's own banner at the time still spelled
 * generically. Two surfaces, two different confidences about the same cause.
 *
 * ── THE FIX ───────────────────────────────────────────────────────────────
 *
 * One function, FACT + CAUSE, nothing else — no KIND/RULE dump (that still
 * sits behind the `› Details` disclosure every banner already has; this
 * function never replaces it, only the headline above it):
 *
 *   `prod-us-east-2 is waiting on promotion order`   — a bare promotion gate
 *   `prod-us-east-2 is waiting for payments-svc ~2.9.0` — a dependency contract
 *   `prod-us-east-2 is waiting on an approval`       — a person gate
 *
 * RANK, WORST-FIRST, THE SAME ORDER `blockingStory`'s own `iconKind` already
 * picks (a person gate outranks everything; `unknown` outranks a named cause
 * because "we cannot tell" might still mean "a person", exactly as that
 * field's own doc argues): `person` → `unknown` → `dependency` (a contract
 * LEADS over a bare promotion order, the same rule `upstreamVerdict`'s own
 * "THE CONTRACT LEADS" doc already established for the verdict sentence,
 * applied here to the headline) → `promotion` → the generic fallback for a
 * lone `clock`/`check` hold, which names no second party worth a headline of
 * its own (see `sameBucketHeadline`'s identical carve-out).
 *
 * Deliberately a NEW sentence, not a repoint of `story.headline` — changing
 * `headline` itself would rewrite every surface that already prints it
 * (`truth.test.ts`'s fixtures, `axis.ts`'s glance-line regex, the catalogue)
 * for a wording only THIS pass's callers asked for. `holdCausePhrase` is
 * additive beside it, the same way `shortStory` sits beside `headline`
 * without replacing it.
 *
 * ── THE SECOND INPUT SHAPE ───────────────────────────────────────────────
 *
 * A caller naming a SPECIFIC held BUILD (Home's Needs-you sentence, which
 * must name the build `promotionHoldBreakdown` says is actually held, never
 * the rollout's currently-running one — see that type's own doc) passes one
 * of ITS entries, or the breakdown itself (its first held entry is read),
 * rather than the whole-rollout `BlockingStory`.
 *
 * ⚠️ A bare `PromotionHoldBreakdown` entry carries NO gate classification —
 * no `kind`, no `clears` (see that type's own doc: it is read off
 * `blockingGateNames`, names only, never joined against `GateContext`) — so
 * it cannot distinguish an approval gate from a promotion-order gate by name
 * alone. Its `gateNames` with no `contract` reads as the more common case,
 * `promotion order`; a caller that needs the precise kind for a possibly-
 * approval hold passes the `BlockingStory` instead, which HAS the
 * classification.
 */
export function holdCausePhrase(
	input: BlockingStory | PromotionHoldBreakdown,
	options: { place?: string | null } = {}
): string | null {
	const subject = options.place ?? 'this service';

	// A `BlockingStory` is the only one of the two shapes that carries
	// `gates` — `PromotionHoldBreakdown` has no field by that name.
	if ('gates' in input) {
		// ⭐ `null`, NEVER `''`. (2026-10-10, QA finding.) `BlockingStoryPanel`'s
		// own `title={titleOverride ?? story.headline}` only falls back when
		// `titleOverride` is NULLISH — `''` is not, so a caller handing this
		// straight to that prop during the banner's collapse (the rollout
		// detail page's Overview banner) printed a BLANK headline the instant
		// `blocked` flipped false, instead of keeping the frozen story's own
		// `headline` through the collapse. `''` claimed "no title", which is
		// not what "nothing is held" means to a nullable prop.
		if (!input.blocked) return null;
		// A topology fault or wave wait states its own fact ("Site us-east-1 of prod is owned by another Environment"), never an approval.
		if (input.gates.length === 1 && input.gates[0].headline) return input.gates[0].headline;
		if (input.person.length > 0) return `${subject} is waiting on an approval`;
		// ⛔ NOT "waiting on an approval" — see `blockingStory`'s own `unknown`
		// branch: we do not know what clears this, and guessing a remedy is the
		// wrong instruction, not merely an imprecise one.
		if (input.unknown.length > 0) return `${subject} is waiting on a rule this dashboard cannot attribute`;
		// ⭐ THE CONTRACT LEADS, same rule as `upstreamHeadline`/`upstreamVerdict`.
		// ⭐ NAMES EVERY PROVIDER, NOT JUST THE FIRST. (2026-10-10, QA finding.)
		// `payments-svc ~2.9.0` and `auth ~1.4` can both hold the SAME build at
		// once (`ContractHolds`' own doc) — `joinClauses` is the house list
		// joiner every multi-item sentence in this module already uses, so two
		// providers read "X and Y" and three or more read "X, Y and Z".
		const contracts = input.upstream.filter((g) => g.kind === 'dependency' && g.subject);
		if (contracts.length > 0) {
			const clauses = contracts.map((g) => {
				const need = g.need ? ` ${g.need}` : '';
				return `${g.subject}${need}`;
			});
			return `${subject} is waiting for ${joinClauses(clauses)}`;
		}
		if (input.upstream.some((g) => g.kind === 'promotion')) {
			return `${subject} is waiting on promotion order`;
		}
		// A lone clock/check hold names no second party — same carve-out
		// `sameBucketHeadline` already makes for the full headline.
		return `${subject} is held`;
	}

	// A `PromotionHoldBreakdown` — see this function's own doc for what a
	// bare entry cannot tell. THE CONTRACT LEADS here too, same rule as the
	// `BlockingStory` branch above: a held build with no contract of its
	// own (refused only by a promotion-order gate) does not get to hide a
	// SIBLING held build's contract — `checkout-api/prod-us-east-2`'s own
	// shape, where the newest candidates are promotion-gate-held and the
	// contract sits on an older one `held[0]` would otherwise skip.
	const held = input.held.find((h) => h.contracts.length > 0) ?? input.held[0];
	if (!held) return null;
	if (held.contracts.length > 0) {
		// Same list joiner as the `BlockingStory` branch above — a build held
		// by two contracts at once names both.
		const clauses = held.contracts.map((c) => {
			const required = c.required ? ` ${c.required}` : '';
			return `${c.provider}${required}`;
		});
		return `${subject} is waiting for ${joinClauses(clauses)}`;
	}
	if (held.gateNames.length > 0) return `${subject} is waiting on promotion order`;
	return `${subject} is held`;
}

export function shortStory(story: BlockingStory): string | null {
	if (story.pinnedTo) return `Pinned to ${story.pinnedToDisplay ?? story.pinnedTo}`;
	if (!story.blocked || story.gates.length === 0) return null;
	if (story.gates.length === 1) return story.gates[0].short;
	const kinds: string[] = [];
	if (story.person.length > 0) kinds.push('an approval');
	if (story.unknown.length > 0) kinds.push('a rule this dashboard cannot attribute');
	if (story.upstream.length > 0) kinds.push('another deploy');
	if (story.clock.length > 0) kinds.push('a deploy window');
	if (story.checks.length > 0) kinds.push('a check');
	return `Held by ${story.gates.length} rules — waiting on ${joinClauses(kinds)}`;
}
