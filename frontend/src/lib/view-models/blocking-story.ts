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
import { formatTimeUntil } from '$lib/api/schedules';

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
};

/**
 * The join table, built ONCE per `/api/rollouts` response and passed down.
 * Keys are `namespace/gateName`: gate names are namespace-scoped and
 * `dependency-hello-frontend-needs-api` genuinely exists in three namespaces
 * at once on the live cluster.
 */
export type GateContext = {
	promotion: Map<string, { after: string | null; relType: 'After' | 'Parallel' | null }>;
	dependency: Map<string, { provider: string; contract: string; providedVersion: string | null }>;
	/**
	 * Gate name → the schedule that owns it. Filled from
	 * `RolloutSchedule.status.managedGates`, which is an EXACT reference — the
	 * page-level `ScheduleWindow` could only say "some schedule is closed", and
	 * a card that names one gate must name that gate's own schedule.
	 */
	schedule: Map<string, { label: string; nextTransition: string | null }>;
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
		ctx.dependency.set(key(dep?.metadata?.namespace, gate), {
			provider: dep?.spec?.providerRef?.name ?? 'another service',
			contract: dep?.spec?.contract ?? 'dependency',
			providedVersion: dep?.status?.providedVersion ?? null
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
		spec?: { action?: 'Allow' | 'Deny' };
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
				nextTransition: s?.status?.nextTransition ?? null
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
		return {
			id,
			kind: 'promotion',
			clears: 'upstream',
			label: promo.after ? `after ${promo.after}` : 'after its upstream environment',
			clause: promo.after
				? `${promo.after} ${verb}`
				: 'its upstream environment deploys this build',
			short: promo.after
				? `Waiting for ${promo.after} to ${noun}`
				: 'Waiting for its upstream environment to deploy this build',
			clearsAt: null
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
			clearsAt: null
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
				clearsAt: sched.nextTransition
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
			clearsAt: null
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
				clearsAt: null
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
				clearsAt: null
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
			clearsAt: null
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
			clearsAt: null
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
		clearsAt: null
	};
}

export type BlockingStory = {
	/** Promotion is held: newer builds exist and no gate lets any of them in. */
	blocked: boolean;
	/** How many newer builds this rollout could take. */
	candidateCount: number;
	/** `spec.wantedVersion`. A pin refuses ALL builds, so it outranks every gate. */
	pinnedTo: string | null;
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
	/** `warning` when something needs a person; `info` when it clears itself. */
	severity: 'warning' | 'info';
};

export const NOT_BLOCKED: BlockingStory = {
	blocked: false,
	candidateCount: 0,
	pinnedTo: null,
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
	severity: 'info'
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
	options: { place?: string | null; subject?: string | null; now?: Date } = {}
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
	 */
	const subject = options.subject || place || 'this service';
	const now = options.now ?? new Date();

	// A PIN OUTRANKS EVERY GATE and short-circuits. A gate holds the NEXT
	// build; a pin refuses all of them. While `wantedVersion` is set, every
	// gate is also blocking and none of them is the cause — the exact defect
	// reported as *"that panel blamed HELD BY hello-world-manual-approval; the
	// actual cause was the pin, which the page never mentioned."*
	if (pinnedTo) {
		return {
			...NOT_BLOCKED,
			blocked: candidateCount > 0,
			candidateCount,
			pinnedTo,
			selfClearing: false,
			severity: 'info',
			headline: `${subject} is pinned to ${pinnedTo}`,
			consequence:
				candidateCount > 0
					? `${candidateCount} newer build${candidateCount === 1 ? '' : 's'} ${candidateCount === 1 ? 'is' : 'are'} available and none of them will deploy while the pin is set.`
					: 'Automatic updates are off here until the pin is cleared.',
			verdict: 'Clearing the pin is the only thing that restarts automatic deploys.',
			resolution: 'Clearing the pin is the only thing that restarts automatic deploys.'
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
	// were the whole story. With exactly one it names that one's kind.
	let headline: string;
	if (gates.length > 1) {
		headline = `${countWord(gates.length)} things are holding ${subject}`;
	} else if (person.length === 1) {
		headline = `${subject} is waiting on an approval`;
	} else if (unknown.length === 1) {
		// ⛔ NOT "waiting on an approval". The whole point of `unknown` is that
		// we do not know what it is waiting on, and the headline is the one line
		// a reader takes at a glance — so it states the fact and no remedy.
		headline = `Something is holding ${subject}`;
	} else if (upstream.length === 1) {
		headline = `${subject} is waiting on another deploy`;
	} else {
		headline = 'Automatic deploys are paused';
	}

	// ── THE CONSEQUENCE ─────────────────────────────────────────────────────
	// Every gate contributes its own clause, in the same worst-first order, and
	// the clock gate carries its actual time. This is the line that made
	// `/versions` the one page the critic said got it right.
	const parts: string[] = [];
	for (const g of person) parts.push(g.clause);
	for (const g of unknown) parts.push(g.clause);
	for (const g of upstream) parts.push(g.clause);
	for (const g of checks) parts.push(g.clause);
	for (const g of clock) {
		const until = g.clearsAt ? formatTimeUntil(g.clearsAt, now) : null;
		parts.push(
			until ? `${g.clause} in ${until} (${new Date(g.clearsAt!).toLocaleString()})` : g.clause
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
	if (person.length > 0) {
		verdict = 'This will not clear on its own.';
	} else if (unknown.length > 0) {
		// The one sentence this whole branch exists for. It refuses BOTH wrong
		// instructions — "go and find an approver" and "go back to bed" — and
		// the reader is left with the handle, which is the honest place to send
		// them. Something true and non-committal beats a confident wrong one.
		verdict = 'This dashboard cannot tell what clears this — it may or may not need a person.';
	} else if (upstream.length > 0) {
		verdict = 'Nobody has to approve anything — this clears when the deploy in front of it lands.';
	} else if (clearsAt) {
		verdict = 'This clears on its own.';
	} else {
		verdict = 'This clears on its own once the check passes.';
	}
	const resolution = `${verdict} ${manual}`;

	return {
		blocked: true,
		candidateCount,
		pinnedTo: null,
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
		severity: selfClearing ? 'info' : 'warning'
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
	if (story.pinnedTo) return `Pinned to ${story.pinnedTo}`;
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
