/**
 * ⭐ THE HEALTH CHECK AS EVIDENCE — the two facts every list surface threw away.
 *
 * ── FINDING 1: "healthy" printed on the rollout whose SLO was blown ──────────
 *
 * A critic set `hello-world-prod/hello-world-app`'s check to `Unhealthy`
 * ("p99 latency 4.2s exceeds SLO of 500ms for 5m"). The controller reacted
 * correctly and published `DeploymentBlocked: True, reason:
 * UnhealthyHealthChecks` on the rollout itself. At that same second:
 *
 *   | `/`            | *"Trailing 2 — healthy, but behind a newer build"*  |
 *   | `/rollouts`    | `Attention 0 · … · Trailing 2 · Steady 13`           |
 *   | `/apps`        | a banner naming three GATES, never the check        |
 *   | `/environments`| prod `4/4 running`                                  |
 *   | rollout detail | **correct**                                         |
 *
 * Four surfaces called it healthy because `fleet-groups.ts` defined healthy as
 * `statusKey === 'succeeded' && !stuck` — the DEPLOY's verdict — and the deploy
 * genuinely did succeed. The check failed *afterwards*. Nothing in the card
 * derivation read the condition the controller had already written down.
 *
 * ⛔ THE FACT IS IN THE LIST PAYLOAD ALREADY. `/api/rollouts` carries
 * `status.conditions` on every rollout; the HealthCheck objects themselves are
 * a separate per-rollout request that no list surface makes and none needs to.
 * The condition is the join.
 *
 * ⚠️ ONE BLIND SPOT, AND IT IS THE CONTROLLER'S, NOT OURS.
 * `setDeploymentBlockedCondition` short-circuits to `reason: ManualDeployment`
 * whenever `spec.wantedVersion` or the `force-deploy` annotation is set, so a
 * PINNED rollout with a failing check publishes `DeploymentBlocked: False`.
 * There is nothing in the list payload to recover that from, and inventing it
 * would be worse than the silence. A pin already promotes its own mark.
 *
 * ── FINDING 2: `LastErrorTime` survives recovery, and the UI deleted it ─────
 *
 * That is DELIBERATE SEMANTICS in this system, not stale data: the error time
 * is a **witness** that something failed earlier even though the check passes
 * now, and rollout/stepgate rely on it to catch transient failures they would
 * otherwise miss. The API returned
 * `{"status":"Healthy","lastErrorTime":"…01:39:09Z","message":"p99 latency
 * back within SLO"}` while the other three checks had no `lastErrorTime` at
 * all — a perfect discriminator — and the page rendered `Health Checks —
 * 4/4 healthy` and nothing else, because with no problem rows the panel has no
 * list and no expander. There was no affordance anywhere in the product to
 * learn a check had been erroring ninety seconds earlier.
 *
 * ⭐ THE WINDOW RULE, AND WHY IT IS THIS ONE.
 * `windowStart = max(history[0].timestamp, history[0].lastRetryTimestamp)`.
 * This is not a number picked for the UI — it is `rollout_controller.go`'s own
 * `errorCutoff`, verbatim:
 *
 *     errorCutoff := deployTime
 *     if currentEntry.LastRetryTimestamp != nil && …After(errorCutoff) {
 *         errorCutoff = currentEntry.LastRetryTimestamp.Time
 *     }
 *     … if hc.Status.LastErrorTime != nil && !…Before(errorCutoff) { … }
 *
 * The controller uses it to decide which errors count against the attempt in
 * flight; `visibleHealthChecks` on rollout detail already uses it to decide
 * which failures to show. Reusing it means the UI and the controller cannot
 * disagree about which errors belong to this deploy.
 *
 * It also answers the other half of the question — WHEN THE MARK CLEARS —
 * without a timer and without a second opinion. An error from three deploys
 * ago is history, not a witness: the next deploy moves `history[0]`, the window
 * moves with it, and the mark goes away on its own. A retry moves it too, which
 * is the same event the controller treats as a fresh start. **Marking a
 * recovered check forever is how a signal stops being read**, and a rule that
 * expires by itself is the only kind that stays true.
 */

import type { Rollout, HealthCheck } from '$lib/../types';

/**
 * A rollout the controller is currently refusing to deploy into because a
 * health check is `Unhealthy`. The DEPLOY may be long since green — that is the
 * whole point.
 */
export type CheckFailure = {
	/** The failing check's object name, when the condition message names one. */
	check: string | null;
	/** The check's own message — the SLO sentence an operator acts on. */
	detail: string | null;
	/** The controller's full condition message, never discarded. */
	raw: string;
	/** ISO instant the condition last transitioned to True. */
	since: string | null;
};

/**
 * The controller writes exactly this shape in `evaluateHealthChecks`:
 *
 *   HealthCheck '<name>' in namespace '<ns>' is not healthy (status: Unhealthy): <message>
 *
 * ⚠️ PARSED DEFENSIVELY AND NEVER TRUSTED. The name and the detail are the only
 * place those two facts exist in the list payload, but a message that does not
 * match falls through to `raw`, which is always shown. A regex that misses
 * costs a tooltip; a regex that is assumed to hit costs the sentence.
 */
const CONDITION_MESSAGE = /^HealthCheck '([^']+)' in namespace '[^']*' is not healthy \([^)]*\)(?::\s*(.*))?$/s;

export function parseCheckMessage(raw: string): { check: string | null; detail: string | null } {
	const m = CONDITION_MESSAGE.exec(raw ?? '');
	if (!m) return { check: null, detail: null };
	return { check: m[1] || null, detail: (m[2] ?? '').trim() || null };
}

/**
 * ⛔ THE PREDICATE FINDING 1 IS ABOUT. Reads `DeploymentBlocked` — the condition
 * the controller sets from health-check state alone, deliberately independent
 * of gate blocking so *"both blockers can surface concurrently"*
 * (`recovery_mode_test.go`: *"surfaces DeploymentBlocked=True even when a
 * blocking gate would otherwise return early"*).
 *
 * That independence is what resolves the critic's own caveat. The rollout it
 * measured also had three gates closed, so it could not tell whether gate
 * precedence was contributing. It is not: this condition is written before the
 * gate loop and is `True` with no gates at all.
 */
export function checkFailure(rollout: Rollout | null | undefined): CheckFailure | null {
	const cond = (rollout?.status?.conditions ?? []).find((c) => c?.type === 'DeploymentBlocked');
	if (!cond || cond.status !== 'True') return null;
	const raw = cond.message ?? '';
	const { check, detail } = parseCheckMessage(raw);
	return { check, detail, raw, since: cond.lastTransitionTime ?? null };
}

/** One sentence for a chip title or a card row. Never the bare object name. */
export function checkFailureTitle(f: CheckFailure): string {
	const subject = f.check ? `Health check ${f.check}` : 'A health check';
	const detail = f.detail || f.raw;
	const tail = detail ? ` — ${detail}` : '';
	// ⛔ `Nothing new deploys here until it passes.` WAS THE `Blocked` DEFECT
	// AGAIN, ONE OBJECT OVER. (2026-08-31) The controller's health-check
	// short-circuit is `if !r.hasManualDeployment(&rollout) && len(history) > 0
	// && !healthChecksHealthy { return }` — the SAME `!hasManualDeployment`
	// guard the gate loop has. A deploy a person starts still applies, and this
	// sentence told them it would not. `FailurePanel`'s own footnote already
	// said `Automated deployments are paused until this is resolved`, so the
	// product was carrying both scopes for one fact and only one of them was
	// true. `blocking-story.ts`'s standing rule — never say "deployments are
	// blocked" — applies here for the same reason.
	return `${subject} is failing${tail}. Automatic deploys here are paused until it passes; a deploy you start by hand still applies.`;
}

/**
 * ⭐ THE CURRENT DEPLOY'S WINDOW — `rollout_controller.go`'s `errorCutoff`.
 * `null` when the rollout has never deployed: there is no attempt for an error
 * to be evidence ABOUT, and an unattributable error is not a witness.
 */
export function deployWindowStart(rollout: Rollout | null | undefined): Date | null {
	const entry = rollout?.status?.history?.[0];
	if (!entry?.timestamp) return null;
	const deployed = new Date(entry.timestamp).getTime();
	const retried = entry.lastRetryTimestamp ? new Date(entry.lastRetryTimestamp).getTime() : 0;
	const start = Math.max(deployed, Number.isFinite(retried) ? retried : 0);
	return Number.isFinite(start) ? new Date(start) : null;
}

/**
 * ⚠️ FOUR STATES, AND `recovered` IS THE ONE THAT DID NOT EXIST.
 * `passing` and `recovered` are BOTH `status: Healthy` to the API. The only
 * thing separating them is a `lastErrorTime` the controller deliberately did
 * not clear, inside the window above.
 */
export type CheckState = 'failing' | 'pending' | 'recovered' | 'passing';

export function classifyCheck(hc: HealthCheck, windowStart: Date | null): CheckState {
	const status = hc?.status?.status;
	if (status === 'Failed' || status === 'Unhealthy') return 'failing';
	if (status !== 'Healthy') return 'pending';
	const lastErrorTime = hc?.status?.lastErrorTime;
	if (!lastErrorTime || !windowStart) return 'passing';
	const at = new Date(lastErrorTime).getTime();
	if (!Number.isFinite(at)) return 'passing';
	return at >= windowStart.getTime() ? 'recovered' : 'passing';
}

/** Passing right now, but it errored inside this deploy's window. */
export function recoveredChecks(
	healthChecks: HealthCheck[],
	windowStart: Date | null
): HealthCheck[] {
	return (healthChecks ?? []).filter((hc) => classifyCheck(hc, windowStart) === 'recovered');
}

/**
 * The recovered row's sentence. **"passing, last errored 2m ago"** — the state
 * FIRST, because the check really is passing and a reader who takes only the
 * first two words must not be misled, and the witness second, because a reader
 * who stops there has still learned the thing the alert was about.
 */
export function recoveredLabel(ago: string): string {
	return `passing, last errored ${ago}`;
}

/**
 * The sentence for a recovered check's tooltip. It says the two things the
 * `4/4 healthy` rollup could not: that the check DID fail during this deploy,
 * and — because *"marking everything forever is how a signal stops being read"*
 * — exactly when this mark goes away.
 */
export function recoveredTitle(hc: HealthCheck, ago: string): string {
	const name = hc?.metadata?.name ?? 'This check';
	return `${name} is passing now, but it errored ${ago} — inside the window of the deploy that is running. The controller keeps that error as evidence; this mark clears on the next deploy or retry.`;
}
