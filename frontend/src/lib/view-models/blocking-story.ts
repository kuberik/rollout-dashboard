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
 *     `Environment.spec.relationship` says which environment must go first.
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
import { promotionBlock, promotionCandidates, type PromotionBlock } from './promotion';
import { formatTimeUntil, formatAbsoluteReopen } from '$lib/api/schedules';
import { displayVersionForTag } from '$lib/version-utils';

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
	| 'check';

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
 * The join table, built ONCE per `/api/rollouts` response and passed down.
 * Keys are `namespace/gateName`: gate names are namespace-scoped and
 * `dependency-hello-frontend-needs-api` genuinely exists in three namespaces
 * at once on the live cluster.
 */
export type GateContext = {
	promotion: Map<string, { after: string | null; relType: 'After' | 'Parallel' | null }>;
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
};

export const EMPTY_GATE_CONTEXT: GateContext = {
	promotion: new Map(),
	dependency: new Map(),
	schedule: new Map(),
	owners: new Map(),
	sources: { environments: false, dependencies: false }
};

const key = (namespace: string | undefined, gate: string) => `${namespace ?? ''}/${gate}`;

/** `main-1787999329-991829b…` is not a name. Neither is `ghd-p2fld`. */
export function prettyNameOf(meta?: { annotations?: Record<string, string> }): string | null {
	return meta?.annotations?.['gate.kuberik.com/pretty-name'] || null;
}

/**
 * Build the join table from the `/api/rollouts` payload. Every input is
 * optional: a cluster that has not installed the RolloutDependency CRD serves
 * `rolloutDependencies: null`, and the classification degrades to `unknown`
 * rather than to a confident wrong answer.
 */
export function buildGateContext(payload: {
	environments?: { items?: Environment[] } | null;
	rolloutDependencies?: { items?: RolloutDependency[] } | null;
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
		// ⛔ `!= null` AND NOT A TRUTHINESS TEST. `{ items: [] }` is a source we
		// consulted and found empty; `null` is a source that was never served.
		// Collapsing the two is exactly how "no join matched" became "a person
		// must approve it".
		sources: {
			environments: payload?.environments != null,
			dependencies: payload?.rolloutDependencies != null
		}
	};

	for (const gate of payload?.rolloutGates?.items ?? []) {
		const name = gate?.metadata?.name;
		if (!name) continue;
		const owner = (gate?.metadata?.ownerReferences ?? []).find((o) => o?.controller === true);
		ctx.owners.set(key(gate?.metadata?.namespace, name), {
			kind: owner?.kind ?? null,
			name: owner?.name ?? null
		});
	}

	for (const env of payload?.environments?.items ?? []) {
		const gate = env?.status?.rolloutGateRef?.name;
		if (!gate) continue;
		const rel = env?.spec?.relationship ?? null;
		ctx.promotion.set(key(env?.metadata?.namespace, gate), {
			after: rel?.environment ?? null,
			relType: rel?.type ?? null
		});
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
	const next: GateContext = {
		promotion: ctx.promotion,
		dependency: ctx.dependency,
		schedule: new Map(ctx.schedule),
		owners: ctx.owners,
		sources: ctx.sources
	};
	for (const s of schedules ?? []) {
		// Only a schedule that is currently REFUSING explains a closed gate.
		// `Allow` schedules block while inactive; `Deny` schedules block while
		// active. Same predicate `ScheduleStatus` and `api/schedules.ts` use.
		const active = s?.status?.active === true;
		const action = s?.spec?.action;
		const blocking = (action === 'Allow' && !active) || (action === 'Deny' && active);
		if (!blocking) continue;
		const label = prettyNameOf(s?.metadata) || s?.metadata?.name || 'a deploy window';
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

type GateSummary = { name?: string; passing?: boolean; allowedVersions?: string[] | null };

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
	const id = gate?.name ?? 'a rule';
	const k = key(namespace, id);

	const promo = ctx.promotion.get(k);
	if (promo) {
		// The environment controller's own description, in the product's words:
		// *"passing only for those versions that have been successfully deployed
		// after the <env> environment"*. With no relationship published the gate
		// exists but has nothing to compare against yet, which is a real state
		// (`prettyName = "Relationship not ready yet"`) and is said as one.
		const verb = promo.relType === 'Parallel' ? 'deploys it alongside' : 'deploys it first';
		const noun = promo.relType === 'Parallel' ? 'deploy it alongside' : 'deploy it first';
		// ⭐ `clause` IS BUILT FROM `subject` + `predicate` IN BOTH BRANCHES, so
		// the drawn row and the banner sentence are the same two words in the
		// same order and cannot drift. The un-related branch used to be one
		// literal; splitting it changes no output.
		const subject = promo.after ?? 'its upstream environment';
		const predicate = promo.after ? verb : 'deploys this build';
		return {
			id,
			kind: 'promotion',
			clears: 'upstream',
			label: promo.after ? `after ${promo.after}` : 'after its upstream environment',
			clause: `${subject} ${predicate}`,
			short: promo.after
				? `Waiting for ${promo.after} to ${noun}`
				: 'Waiting for its upstream environment to deploy this build',
			clearsAt: null,
			timezone: null,
			...NOTHING_TO_DRAW,
			subject,
			subjectKind: 'environment',
			predicate
		};
	}

	const dep = ctx.dependency.get(k);
	if (dep) {
		return {
			id,
			kind: 'dependency',
			clears: 'upstream',
			label: `depends on ${dep.provider}`,
			clause: dep.providedVersion
				? `${dep.provider} ships a newer ${dep.contract} than ${dep.providedVersion}`
				: `${dep.provider} ships a newer ${dep.contract}`,
			short: dep.providedVersion
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
			predicate: `ships a newer ${dep.contract}`,
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
		// Not passing, nothing published a window. TRUE and unschedulable.
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
			...NOTHING_TO_DRAW
		};
	}

	// ── AN ALLOW-LIST NO JOIN CLAIMED ───────────────────────────────────────
	// ⛔ THIS IS THE BRANCH THAT SHIPPED THE DEFECT TWICE. It used to return
	// `person` unconditionally. It now returns `person` only from EVIDENCE.

	const owner = ctx.owners.get(k);

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
	if ((owner && owner.kind === null) || provenanceComplete) {
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
	severity: 'warning' | 'info';
	/** Which glyph this story earns. See `StoryIconKind`'s own note. */
	iconKind: StoryIconKind;
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
	iconKind: 'check'
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
		const contract = g.contract ?? 'a newer version';
		return g.need ? `ship ${contract} ${g.need} from ${provider}` : `ship a newer ${contract} from ${provider}`;
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
	const dep = upstream.find((g) => g.kind === 'dependency' && g.subject && g.contract);
	if (!dep) return `${subjectLead} ${isVerb} waiting on another deploy`;
	const verb = dep.need ? `ship ${dep.contract} ${dep.need}` : `ship a newer ${dep.contract}`;
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
	options: { place?: string | null; subject?: StorySubject | null; now?: Date } = {}
): BlockingStory {
	const namespace = rollout?.metadata?.namespace;
	const block: PromotionBlock = promotionBlock(rollout);
	const pinnedTo = rollout?.spec?.wantedVersion ?? null;
	const candidateCount = promotionCandidates(rollout).length;
	const place = options.place ? options.place.toUpperCase() : null;
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
			blocked: candidateCount > 0,
			candidateCount,
			pinnedTo,
			pinnedToDisplay,
			selfClearing: false,
			// `info` (blue) — pinning is a STATE A PERSON CHOSE, not a rule
			// holding the rollout back. See the field's own doc comment (F2).
			severity: 'info',
			headline: `${subjectLead} ${isVerb} pinned to ${pinnedToDisplay}`,
			consequence:
				candidateCount > 0
					? `${candidateCount} newer build${candidateCount === 1 ? '' : 's'} ${candidateCount === 1 ? 'is' : 'are'} available and none of them will deploy while the pin is set.`
					: 'Automatic updates are off here until the pin is cleared.',
			verdict: 'Clearing the pin is the only thing that restarts automatic deploys.',
			resolution: 'Clearing the pin is the only thing that restarts automatic deploys.',
			iconKind: 'pinned'
		};
	}

	if (!block.blocked || block.blockingGates.length === 0) {
		return { ...NOT_BLOCKED, candidateCount };
	}

	// The gate OBJECTS, not the names: `promotionBlock` publishes names only, so
	// re-select the summaries it attributed the block to. Same predicate, so the
	// two cannot disagree about which gates are holding it.
	const holding = new Set(block.blockingGates);
	const gates = (rollout?.status?.gates ?? [])
		.filter((g) => g?.name && holding.has(g.name))
		.map((g) => classifyGate(g, namespace, ctx))
		.sort((a, b) => {
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
				? `${g.clause} in ${until} — ${formatAbsoluteReopen(g.clearsAt!, g.timezone)}`
				: g.clause
		);
	}
	// ⭐ ONE OPENER, THE REFERENCE PAGE'S OWN WORDS. The rollout detail banner —
	// the page the human calls beautiful — says *"Nothing promotes itself
	// until …"*, and a reader who has learned that sentence there reads the
	// same sentence here with N causes behind it instead of one. It is also
	// what makes every clause a lowercase noun clause, so the sentence never
	// capitalises an environment name to start itself.
	const lead =
		candidateCount > 0
			? `${candidateCount} newer build${candidateCount === 1 ? '' : 's'} ${candidateCount === 1 ? 'is' : 'are'} waiting. `
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
	const iconKind: StoryIconKind =
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

	return {
		blocked: true,
		candidateCount,
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
		severity: 'warning',
		iconKind
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
