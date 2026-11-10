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
const CONDITION_MESSAGE =
	/^HealthCheck '([^']+)' in namespace '[^']*' is not healthy \([^)]*\)(?::\s*(.*))?$/s;

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
	return `${subject} is failing${tail}. Automatic deploys here are held until it passes; a deploy you start by hand still applies.`;
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

/**
 * ⭐ "PROMOTE ONLY WHEN IT'S HEALTHY" — THE HALF OF THE CONTROLLER NO GATE
 * MODELS. (2026-09-20, demo film finding: the hero take showed a `Ready`
 * build with a loud primary `Deploy` while a health check was still
 * `Pending` — the exact opposite of what the beat claims.)
 *
 * `rollout_controller.go`'s promotion loop short-circuits BEFORE the gate
 * loop even runs: `if !r.hasManualDeployment(&rollout) && len(history) > 0
 * && !healthChecksHealthy { return }`. Nothing in `promotion.ts` or
 * `blocking-story.ts` reads this — both of those classify
 * `rollout.status.gates`, and a HealthCheck is not a gate object. So a
 * newest candidate with an empty `allowedVersions` story and a `Pending`
 * check passed every existing "is this blocked" test on the page and
 * rendered as plain `Ready`.
 *
 * `pending` AND `failing` both hold automatic promotion back — a check that
 * has not yet reported is exactly as much "not proven healthy" as one that
 * has proven unhealthy, which is why both are counted here rather than only
 * `failing`. `passing` and `recovered` (`classifyCheck`'s other two states)
 * are both `status: Healthy` right now and never count.
 */
export type HealthGateCounts = { pending: number; failing: number };

export function healthGateCounts(
	healthChecks: HealthCheck[],
	windowStart: Date | null
): HealthGateCounts {
	let pending = 0;
	let failing = 0;
	for (const hc of healthChecks ?? []) {
		const state = classifyCheck(hc, windowStart);
		if (state === 'pending') pending += 1;
		else if (state === 'failing') failing += 1;
	}
	return { pending, failing };
}

/** Whether ANY check is holding automatic promotion back right now. */
export function healthGateHolding(counts: HealthGateCounts): boolean {
	return counts.pending > 0 || counts.failing > 0;
}

/**
 * ⭐ THE VISIBILITY FILTER, EXTRACTED. (2026-10-08, Gates-tab integration.)
 * Rollout detail's `visibleHealthChecks` (inline, `+page.svelte`) and the
 * Gates tab's `healthHold` (`rollout-gates.ts`) each wrote this same filter
 * by hand: a check that is CURRENTLY `Failed`/`Unhealthy` is evidence about
 * the running deploy only if its `lastErrorTime` falls on or after
 * `windowStart` (`deployWindowStart`'s own `errorCutoff`); a stale failure —
 * or one with no `lastErrorTime` at all once a window exists — is dropped.
 * Every OTHER check (passing, recovered, pending) always passes through
 * unfiltered; only a failing verdict needs a witness to earn a place. With
 * no window (`windowStart === null`, no deploy to attribute anything to),
 * nothing is filtered — same as detail's `errorCutoff !== null ? … :
 * healthChecks`. One function so the two pages read the same set of checks
 * and cannot quietly diverge on which failure is "this deploy's".
 */
export function visibleHealthChecks(
	healthChecks: HealthCheck[],
	windowStart: Date | null
): HealthCheck[] {
	if (!windowStart) return healthChecks;
	return healthChecks.filter((hc) => {
		const st = hc.status?.status;
		if (st !== 'Failed' && st !== 'Unhealthy') return true;
		const lastErrorTime = hc.status?.lastErrorTime;
		if (!lastErrorTime) return false;
		const at = new Date(lastErrorTime).getTime();
		return Number.isFinite(at) && at >= windowStart.getTime();
	});
}

/**
 * ⭐ THE ONE PREDICATE "IS HEALTH HOLDING THE NEWEST BUILD BACK" MAY EVER BE.
 * (2026-10-08.) Extracted so rollout detail's `newestHeldByHealth` and the
 * Gates tab's `healthHold` cannot drift the way they just had — the tab's
 * version was missing the "already blocked by a real gate" exclusion
 * entirely, so a rollout a gate already explains got a SECOND, independent
 * health box for the same hold.
 *
 * `hasCandidate`: there must be something newer to hold back at all
 * (`promotionCandidates(rollout)[0]`, mirroring detail's
 * `rollout.status.releaseCandidates?.[0]`).
 *
 * `newestCandidateBlockedByGate`: true when a real gate (not health) already
 * refuses the newest candidate (detail's `newestCandidateBlockedByGate`,
 * `getBlockingGates(tag).length > 0`). Health is ADDITIVE evidence, never a
 * replacement for a gate's own verdict — a rollout already explained by a
 * gate must not also print "held by health" for the identical build.
 *
 * ⛔ PIN IS DELIBERATELY NOT A PARAMETER HERE. Detail's own `newestHeldByHealth`
 * computed value does not consult `spec.wantedVersion` either — the pin's
 * precedence ("a pin outranks every gate", `blocking-story.ts`) is applied by
 * each CALLER, not baked into this predicate: detail's template tests
 * `blockStory.pinnedTo` before `newestHeldByHealth` in an if/else-if chain
 * (`+page.svelte` ~2928), and `rolloutGateBoxes` applies the same ordering by
 * skipping the health box outright once its own PIN box is pushed. Keeping
 * the exclusion out of this function is what lets both callers apply it in
 * the shape each one needs (a sentence slot vs. a box list) without this
 * shared piece knowing about either.
 */
export function healthHolds(
	hasCandidate: boolean,
	newestCandidateBlockedByGate: boolean,
	counts: HealthGateCounts
): boolean {
	return hasCandidate && !newestCandidateBlockedByGate && healthGateHolding(counts);
}

/**
 * "1 pending", "1 failing", "1 pending, 1 failing" — the counts alone, so
 * two call sites (a release-candidate row's own clause, the version card's
 * metadata line) can drop the identical fact into two different sentence
 * shapes without re-deriving the count. Empty when nothing is held; callers
 * check `healthGateHolding` first, same pattern as `heldClears` above.
 */
export function healthGateCountsLabel(counts: HealthGateCounts): string {
	const parts: string[] = [];
	if (counts.failing > 0) parts.push(`${counts.failing} failing`);
	if (counts.pending > 0) parts.push(`${counts.pending} pending`);
	return parts.join(', ');
}

/**
 * ⭐ THE PENDING COUNTDOWN IS A REAL CLOCK COMPARISON, NOT A BAKED STRING.
 * (2026-09-21, film critic finding: `HealthChecksCard`'s pending sub-line
 * printed `evaluating alert state · next probe in 12s` as a literal string
 * stamped once at fixture-build time — the number never moved no matter how
 * long the row sat on screen, and it could not, because it was never a
 * number to begin with by the time it reached the DOM.)
 *
 * `nextProbeAt` is not part of the real `HealthCheck` CRD's status today —
 * these two functions read it defensively (an absent field is simply "no
 * countdown to show", never an error) so a real backend response is
 * unaffected. The mock (`lib/demo/state.ts`) is the one place that writes
 * it, on that module's own demo clock (`peekDemoClock()`) — the same clock
 * domain every other timestamp there uses, and the one the capture harness's
 * `/api/demo/now` reports, so a browser whose clock is pinned to that
 * endpoint (as the film capture and this feature's own verification both do)
 * sees a countdown that agrees with the pin. See `state.ts`'s "THE PENDING
 * COUNTDOWN" section for the full reasoning and its one accepted limitation
 * (an unpinned browser against a long-uptime dev server).
 */
export function pendingNextProbeAt(hc: HealthCheck): Date | null {
	const raw = (hc?.status as { nextProbeAt?: string } | undefined)?.nextProbeAt;
	if (!raw) return null;
	const at = new Date(raw);
	return Number.isFinite(at.getTime()) ? at : null;
}

/**
 * `null` when there is nothing to derive (no `nextProbeAt` on this check) —
 * the caller falls back to the check's own `status.message`. Never a
 * negative count: once the instant passes, this reads `probing…` and stays
 * there until the caller's own data changes (the check resolves, or a fresh
 * `nextProbeAt` arrives) — never a frozen NUMBER, which is the defect this
 * exists to fix.
 */
export function pendingProbeClause(hc: HealthCheck, now: Date): string | null {
	const at = pendingNextProbeAt(hc);
	if (!at) return null;
	const remainingMs = at.getTime() - now.getTime();
	return remainingMs > 0 ? `next probe in ${Math.ceil(remainingMs / 1000)}s` : 'probing…';
}

/**
 * Text that reads as a healthy verdict. A Pending check has not settled, so
 * "No alerts firing for labels …" under a Pending chip (prometheus-controller)
 * is read as "fine". `unhealthy` / `not healthy` are NOT matched.
 */
const READS_HEALTHY =
	/\b(no alerts?( are)? firing|not firing|(?<!un)(?<!not )healthy|ok|passing|reconciled|no (errors?|issues?|problems?)|all\b[^.]*\bready|\d+\/\d+ ready)\b/i;

export function readsHealthy(message: string): boolean {
	return READS_HEALTHY.test(message);
}

/**
 * The sub-line of a PENDING row. Pending also covers EVALUATED states (an
 * alert in its pending phase, Datadog Warn/NoData, resources not ready), so the
 * controller's message is real information and is kept — EXCEPT when it reads
 * healthy, where it is dropped (batch4 #6). Dropping beats a neutral lead-in:
 * no extra words on every row, and the Pending chip already is the lead-in.
 * Then the probe countdown when known, else "Not evaluated yet".
 */
export function pendingRowText(hc: HealthCheck, now: Date): string {
	const raw = hc.status?.message?.trim();
	const msg = raw && !readsHealthy(raw) ? raw : null;
	const clause = pendingProbeClause(hc, now);
	if (msg && clause) return `${msg} · ${clause}`;
	return msg ?? clause ?? 'Not evaluated yet';
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

/**
 * ⭐ THE GATES TAB'S OWN EMPTY STATE, AND WHY PENDING WAS SILENTLY "PASSING".
 * (2026-10-08, QA + design review.) The tab's quiet one-sentence empty state
 * (`gates/+page.svelte`) used to ask only `anyHealthFailing` — `status ===
 * 'Failed' || 'Unhealthy'` — to pick between "a health check is failing…"
 * and "its health checks are passing". A check that has not reported yet
 * (`classifyCheck` → `pending`: anything that is not `Healthy` and not
 * `Failed`/`Unhealthy`) is neither, and the binary swallowed it into the
 * PASSING branch — claiming a check is clean when it is simply unproven,
 * the exact "not proven healthy is not the same as healthy" distinction
 * `healthGateCounts`'s own doc comment makes for the gate-holding count.
 *
 * Three states, not two, and `classifyCheck`/`visibleHealthChecks` decide
 * them the same way `healthHold` does (stale pre-deploy failures excluded),
 * so this sentence and the box column above it can never disagree about
 * which checks are live. Failing outranks pending — a rollout with one of
 * each is still "a health check is failing", the louder and truer fact.
 */
export type HealthQuietState = 'failing' | 'pending' | 'passing';

export function healthQuietState(
	healthChecks: HealthCheck[] | null,
	windowStart: Date | null
): HealthQuietState {
	const counts = healthGateCounts(
		visibleHealthChecks(healthChecks ?? [], windowStart),
		windowStart
	);
	if (counts.failing > 0) return 'failing';
	if (counts.pending > 0) return 'pending';
	return 'passing';
}
