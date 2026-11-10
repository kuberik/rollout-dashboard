import { describe, it, expect } from 'vitest';
import type { Rollout, HealthCheck } from '$lib/../types';
import {
	checkFailure,
	checkFailureTitle,
	parseCheckMessage,
	deployWindowStart,
	classifyCheck,
	recoveredChecks,
	recoveredLabel,
	healthGateCounts,
	healthGateHolding,
	healthGateCountsLabel,
	healthHolds,
	healthQuietState,
	visibleHealthChecks,
	pendingNextProbeAt,
	pendingProbeClause,
	pendingRowText,
	readsHealthy
} from './health-witness';

const NOW = new Date('2026-08-31T02:00:00Z');
const DEPLOYED_AT = '2026-08-31T01:30:00Z';

const SLO_MESSAGE =
	"HealthCheck 'payment-latency' in namespace 'hello-world-prod' is not healthy (status: Unhealthy): p99 latency 4.2s exceeds SLO of 500ms for 5m";

function rollout(opts: {
	blocked?: { status: 'True' | 'False'; reason: string; message: string };
	deployedAt?: string | null;
	retriedAt?: string;
}): Rollout {
	return {
		metadata: { name: 'hello-world-app', namespace: 'hello-world-prod' },
		spec: {},
		status: {
			history:
				opts.deployedAt === null
					? []
					: [
							{
								version: { version: 'rel-66' },
								timestamp: opts.deployedAt ?? DEPLOYED_AT,
								bakeStatus: 'Succeeded',
								...(opts.retriedAt ? { lastRetryTimestamp: opts.retriedAt } : {})
							}
						],
			conditions: opts.blocked
				? [
						{
							type: 'DeploymentBlocked',
							status: opts.blocked.status,
							reason: opts.blocked.reason,
							message: opts.blocked.message,
							lastTransitionTime: '2026-08-31T01:55:00Z'
						}
					]
				: []
		}
	} as unknown as Rollout;
}

function check(status: string, lastErrorTime?: string, name = 'payment-latency'): HealthCheck {
	return {
		metadata: { name, namespace: 'hello-world-prod' },
		status: { status, ...(lastErrorTime ? { lastErrorTime } : {}) }
	} as unknown as HealthCheck;
}

/**
 * ⛔ FINDING 1. Four list surfaces printed "healthy" on a rollout whose SLO was
 * blown, because every one of them read the DEPLOY's verdict and stopped. The
 * fact was already in the same payload.
 */
describe('checkFailure — the fact the list surfaces threw away', () => {
	it('reads `DeploymentBlocked: True / UnhealthyHealthChecks`', () => {
		const f = checkFailure(
			rollout({
				blocked: { status: 'True', reason: 'UnhealthyHealthChecks', message: SLO_MESSAGE }
			})
		);
		expect(f).not.toBeNull();
		expect(f!.check).toBe('payment-latency');
		expect(f!.detail).toBe('p99 latency 4.2s exceeds SLO of 500ms for 5m');
		expect(f!.since).toBe('2026-08-31T01:55:00Z');
	});

	it('is null when the controller says the checks are healthy', () => {
		expect(
			checkFailure(
				rollout({ blocked: { status: 'False', reason: 'HealthChecksHealthy', message: '' } })
			)
		).toBeNull();
	});

	it('is null on a rollout that publishes no condition at all', () => {
		expect(checkFailure(rollout({}))).toBeNull();
		expect(checkFailure(null)).toBeNull();
		expect(checkFailure(undefined)).toBeNull();
	});

	it('⚠️ NEVER LOSES THE MESSAGE when the controller string does not parse', () => {
		// A regex that misses costs a tooltip; a regex that is assumed to hit
		// costs the sentence. `raw` is always carried and always renderable.
		const odd = 'something else entirely';
		const f = checkFailure(
			rollout({ blocked: { status: 'True', reason: 'UnhealthyHealthChecks', message: odd } })
		);
		expect(f!.check).toBeNull();
		expect(f!.detail).toBeNull();
		expect(f!.raw).toBe(odd);
		expect(checkFailureTitle(f!)).toContain(odd);
		expect(checkFailureTitle(f!)).toMatch(/^A health check is failing/);
	});

	it('the title names the check and states the consequence', () => {
		const f = checkFailure(
			rollout({
				blocked: { status: 'True', reason: 'UnhealthyHealthChecks', message: SLO_MESSAGE }
			})
		)!;
		expect(checkFailureTitle(f)).toBe(
			'Health check payment-latency is failing — p99 latency 4.2s exceeds SLO of 500ms for 5m. Automatic deploys here are held until it passes; a deploy you start by hand still applies.'
		);
	});

	// ⛔ THE `Blocked` CLASS OF DEFECT, PINNED. The controller's health-check
	// short-circuit sits behind `!r.hasManualDeployment(&rollout)`, so a deploy
	// a person starts still applies while a check is failing. This title may
	// never claim otherwise, and it may never drop the escape clause.
	it('never claims a manual deploy is held', () => {
		const f = checkFailure(
			rollout({
				blocked: { status: 'True', reason: 'UnhealthyHealthChecks', message: SLO_MESSAGE }
			})
		)!;
		const title = checkFailureTitle(f);
		expect(title).not.toMatch(/nothing new deploys/i);
		expect(title).toMatch(/automatic deploys/i);
		expect(title).toMatch(/by hand still applies/i);
	});

	it('parses a message with no trailing detail', () => {
		expect(
			parseCheckMessage("HealthCheck 'x' in namespace 'y' is not healthy (status: Unhealthy)")
		).toEqual({ check: 'x', detail: null });
	});
});

/**
 * ⛔ FINDING 2. `LastErrorTime` survives recovery on purpose — it is a witness
 * the controller and stepgate read. The page rendered `4/4 healthy` and deleted
 * it, so the operator concluded the alert that paged them was noise.
 */
describe('the deploy window — the controller`s own errorCutoff', () => {
	it('is the deploy timestamp', () => {
		expect(deployWindowStart(rollout({}))!.toISOString()).toBe(new Date(DEPLOYED_AT).toISOString());
	});

	it('a retry moves it forward — the same rule `rollout_controller.go` uses', () => {
		const w = deployWindowStart(rollout({ retriedAt: '2026-08-31T01:50:00Z' }))!;
		expect(w.toISOString()).toBe(new Date('2026-08-31T01:50:00Z').toISOString());
	});

	it('an EARLIER retry stamp never moves it backwards', () => {
		const w = deployWindowStart(rollout({ retriedAt: '2026-08-31T00:00:00Z' }))!;
		expect(w.toISOString()).toBe(new Date(DEPLOYED_AT).toISOString());
	});

	it('is null with no deploy — an unattributable error is not a witness', () => {
		expect(deployWindowStart(rollout({ deployedAt: null }))).toBeNull();
	});
});

describe('classifyCheck — `passing` and `recovered` are both status: Healthy', () => {
	const window = new Date(DEPLOYED_AT);

	it('THE REPORTED DEFECT — Healthy + lastErrorTime in window is `recovered`', () => {
		// The exact payload the critic left behind.
		expect(classifyCheck(check('Healthy', '2026-08-31T01:39:09Z'), window)).toBe('recovered');
	});

	it('Healthy with NO lastErrorTime is plain `passing` — the perfect discriminator', () => {
		expect(classifyCheck(check('Healthy'), window)).toBe('passing');
	});

	it('⭐ AN ERROR FROM A PREVIOUS DEPLOY IS HISTORY, NOT A WITNESS', () => {
		// *"marking everything forever is how a signal stops being read"*. The
		// mark expires by itself when the window moves.
		expect(classifyCheck(check('Healthy', '2026-08-30T23:00:00Z'), window)).toBe('passing');
	});

	it('the boundary is inclusive, matching the controller`s `!Before(cutoff)`', () => {
		expect(classifyCheck(check('Healthy', DEPLOYED_AT), window)).toBe('recovered');
	});

	it('with no window nothing is recovered', () => {
		expect(classifyCheck(check('Healthy', '2026-08-31T01:39:09Z'), null)).toBe('passing');
	});

	it('Unhealthy and Failed are `failing`; anything else is `pending`', () => {
		expect(classifyCheck(check('Unhealthy'), window)).toBe('failing');
		expect(classifyCheck(check('Failed'), window)).toBe('failing');
		expect(classifyCheck(check('Pending'), window)).toBe('pending');
		expect(classifyCheck(check(''), window)).toBe('pending');
	});
});

describe('recoveredChecks — the one row that had nowhere to render', () => {
	it('picks exactly the check the critic left behind, out of four', () => {
		const all = [
			check('Healthy', '2026-08-31T01:39:09Z', 'payment-latency'),
			check('Healthy', undefined, 'kustomization-a'),
			check('Healthy', undefined, 'kustomization-b'),
			check('Healthy', undefined, 'kustomization-c')
		];
		const r = recoveredChecks(all, new Date(DEPLOYED_AT));
		expect(r.map((h) => h.metadata?.name)).toEqual(['payment-latency']);
	});

	it('the label leads with the state, then the witness', () => {
		expect(recoveredLabel('2m ago')).toBe('passing, last errored 2m ago');
	});
});

/**
 * ⛔ "PROMOTE ONLY WHEN IT'S HEALTHY" — the half of the controller no gate
 * models. A `Pending` check is exactly as unproven as a failing one for the
 * purpose of holding automatic promotion back; only `passing`/`recovered`
 * (both `status: Healthy`) count as clear.
 */
describe('healthGateCounts / healthGateHolding / healthGateCountsLabel — the check-gate no `status.gates` object models', () => {
	const window = new Date(DEPLOYED_AT);

	it('counts a Pending check as pending, not as clear', () => {
		const counts = healthGateCounts([check('Pending')], window);
		expect(counts).toEqual({ pending: 1, failing: 0 });
		expect(healthGateHolding(counts)).toBe(true);
		expect(healthGateCountsLabel(counts)).toBe('1 pending');
	});

	it('counts Unhealthy/Failed as failing', () => {
		const counts = healthGateCounts([check('Unhealthy'), check('Failed', undefined, 'b')], window);
		expect(counts).toEqual({ pending: 0, failing: 2 });
		expect(healthGateCountsLabel(counts)).toBe('2 failing');
	});

	it('failing leads pending in the label, both counted together', () => {
		const counts = healthGateCounts([check('Pending'), check('Unhealthy', undefined, 'b')], window);
		expect(counts).toEqual({ pending: 1, failing: 1 });
		expect(healthGateCountsLabel(counts)).toBe('1 failing, 1 pending');
	});

	it('a passing check, and a recovered one, hold nothing back', () => {
		const passing = healthGateCounts([check('Healthy')], window);
		expect(passing).toEqual({ pending: 0, failing: 0 });
		expect(healthGateHolding(passing)).toBe(false);

		// `recovered`: Healthy now, but errored inside this deploy's window —
		// classifyCheck's own reported-defect fixture. Still not held: the
		// check is CURRENTLY healthy, which is all promotion cares about.
		const recovered = healthGateCounts([check('Healthy', '2026-08-31T01:39:09Z')], window);
		expect(recovered).toEqual({ pending: 0, failing: 0 });
		expect(healthGateHolding(recovered)).toBe(false);
	});

	it('no checks at all holds nothing back', () => {
		const counts = healthGateCounts([], window);
		expect(healthGateHolding(counts)).toBe(false);
		expect(healthGateCountsLabel(counts)).toBe('');
	});
});

// Keep NOW referenced so the fixture's intent (02:00, 21m after the deploy,
// 90s after the error) stays legible rather than drifting into a magic string.
it('the fixture is the critic`s timeline', () => {
	expect(NOW.getTime() - new Date(DEPLOYED_AT).getTime()).toBe(30 * 60_000);
});

/**
 * ⛔ FILM CRITIC FINDING 1 (2026-09-21): the pending sub-line read `next
 * probe in 12s` as a literal string baked in at fixture-build time — it
 * never moved no matter how long the row sat on screen. `pendingProbeClause`
 * is the fix: a real clock comparison, recomputed against whatever `now` the
 * caller passes (the page's `$now` store, ticking every 100ms).
 */
describe('pendingNextProbeAt / pendingProbeClause — a real clock comparison, not a baked string', () => {
	const base = new Date('2026-09-21T12:00:00Z');

	function pendingWithProbe(nextProbeAt?: string): HealthCheck {
		return {
			metadata: { name: 'probe', namespace: 'hello-world-prod' },
			status: { status: 'Pending', ...(nextProbeAt ? { nextProbeAt } : {}) }
		} as unknown as HealthCheck;
	}

	it('is null when the check carries no `nextProbeAt` at all', () => {
		expect(pendingNextProbeAt(pendingWithProbe())).toBeNull();
		expect(pendingProbeClause(pendingWithProbe(), base)).toBeNull();
	});

	it('counts down the whole way: 12s, 3s, 1s — never negative, never frozen', () => {
		const hc = pendingWithProbe(new Date(base.getTime() + 12_000).toISOString());
		expect(pendingProbeClause(hc, base)).toBe('next probe in 12s');
		expect(pendingProbeClause(hc, new Date(base.getTime() + 9_000))).toBe('next probe in 3s');
		expect(pendingProbeClause(hc, new Date(base.getTime() + 11_000))).toBe('next probe in 1s');
	});

	it('reads `probing…`, never a negative number, once the instant passes', () => {
		const hc = pendingWithProbe(new Date(base.getTime() + 3_000).toISOString());
		// Exactly at the instant, and arbitrarily far past it (the stepped
		// `step=pass` route may resolve the check whenever it is called,
		// long after `nextProbeAt` — the countdown must not show a negative
		// number either way).
		expect(pendingProbeClause(hc, new Date(base.getTime() + 3_000))).toBe('probing…');
		expect(pendingProbeClause(hc, new Date(base.getTime() + 3_600_000))).toBe('probing…');
	});

	it('an unparsable `nextProbeAt` is treated as absent, not as a crash', () => {
		const hc = pendingWithProbe('not-a-date');
		expect(pendingNextProbeAt(hc)).toBeNull();
		expect(pendingProbeClause(hc, base)).toBeNull();
	});
});

/**
 * ⭐ ITEM 2, QA + design review 2026-10-08: a merely PENDING check must read
 * as pending/waiting, never as failing — and never, which was the actual
 * defect, be swallowed into "passing" by a binary that only asked about
 * `Failed`/`Unhealthy`.
 */
describe('healthQuietState — the Gates tab`s empty-state sentence, three states not two', () => {
	const window = new Date(DEPLOYED_AT);

	it('is `passing` with no checks or all-clear checks', () => {
		expect(healthQuietState([], window)).toBe('passing');
		expect(healthQuietState([check('Healthy')], window)).toBe('passing');
	});

	it('⛔ THE REPORTED DEFECT — a Pending check used to read as `passing`', () => {
		expect(healthQuietState([check('Pending')], window)).toBe('pending');
		// Status '' (never reported) is `pending` too (`classifyCheck`'s rule).
		expect(healthQuietState([check('')], window)).toBe('pending');
	});

	it('is `failing` when a check is Failed/Unhealthy inside the deploy window', () => {
		expect(healthQuietState([check('Unhealthy', '2026-08-31T01:45:00Z')], window)).toBe('failing');
	});

	it('failing outranks pending when both are present', () => {
		expect(
			healthQuietState([check('Pending'), check('Unhealthy', '2026-08-31T01:45:00Z', 'b')], window)
		).toBe('failing');
	});

	it('a STALE failure (before this deploy`s window) is not failing — and not pending either', () => {
		// visibleHealthChecks drops it entirely, same as `healthHold` would.
		expect(healthQuietState([check('Unhealthy', '2026-08-30T23:00:00Z')], window)).toBe('passing');
	});

	it('null healthChecks (not yet loaded) reads as `passing`, same as `[]`', () => {
		expect(healthQuietState(null, window)).toBe('passing');
	});
});

describe('visibleHealthChecks — the shared filter `healthHold` and detail`s own both need', () => {
	const window = new Date(DEPLOYED_AT);

	it('drops a failure whose lastErrorTime predates the window', () => {
		const stale = check('Unhealthy', '2026-08-30T23:00:00Z');
		expect(visibleHealthChecks([stale], window)).toEqual([]);
	});

	it('keeps a failure inside the window', () => {
		const fresh = check('Unhealthy', '2026-08-31T01:45:00Z');
		expect(visibleHealthChecks([fresh], window)).toEqual([fresh]);
	});

	it('drops a failing check with no lastErrorTime at all, once a window exists', () => {
		const noWitness = check('Unhealthy');
		expect(visibleHealthChecks([noWitness], window)).toEqual([]);
	});

	it('never filters a non-failing check', () => {
		const pending = check('Pending');
		const healthy = check('Healthy');
		expect(visibleHealthChecks([pending, healthy], window)).toEqual([pending, healthy]);
	});

	it('with no window, nothing is filtered — even an unwitnessed failure', () => {
		const noWitness = check('Unhealthy');
		expect(visibleHealthChecks([noWitness], null)).toEqual([noWitness]);
	});
});

/**
 * ⭐ ITEM 3, QA 2026-10-08: the ONE predicate rollout detail's
 * `newestHeldByHealth` and the Gates tab's `healthHold` both must read.
 */
describe('healthHolds — the shared predicate detail and the Gates tab both read', () => {
	it('false with no candidate to hold back, regardless of check state', () => {
		expect(healthHolds(false, false, { pending: 1, failing: 1 })).toBe(false);
	});

	it('false when a real gate already blocks the newest candidate', () => {
		expect(healthHolds(true, true, { pending: 1, failing: 0 })).toBe(false);
	});

	it('true when there is a candidate, no gate blocks it, and health holds', () => {
		expect(healthHolds(true, false, { pending: 1, failing: 0 })).toBe(true);
		expect(healthHolds(true, false, { pending: 0, failing: 1 })).toBe(true);
	});

	it('false when health itself holds nothing back', () => {
		expect(healthHolds(true, false, { pending: 0, failing: 0 })).toBe(false);
	});
});

/**
 * batch4 #6: a Pending check printed the controller's message under the
 * Pending chip — prometheus-controller's "No alerts firing for labels …" reads
 * as a healthy verdict on a check that has not been evaluated. Pending rows
 * print the product's own sentence and never the controller message.
 */
describe('pendingRowText — Pending keeps real information, drops only text that reads healthy', () => {
	const base = new Date('2026-09-21T12:00:00Z');
	const hc = (message: string | undefined, extra: Record<string, unknown> = {}) =>
		({
			metadata: { name: 'probe', namespace: 'p' },
			status: { status: 'Pending', ...(message ? { message } : {}), ...extra }
		}) as unknown as HealthCheck;
	const probe = { nextProbeAt: new Date(base.getTime() + 5000).toISOString() };

	it('keeps a Prometheus alert-pending message (about to fire)', () => {
		const m = 'alert HighErrorRate is pending, fires after 5m';
		expect(pendingRowText(hc(m), base)).toBe(m);
	});

	it('keeps a Datadog NoData / Warn message', () => {
		expect(pendingRowText(hc('monitor state: No Data'), base)).toBe('monitor state: No Data');
		expect(pendingRowText(hc('monitor state: Warn'), base)).toBe('monitor state: Warn');
	});

	it('keeps a message and appends the probe clause', () => {
		expect(pendingRowText(hc('1 of 3 pods ready, waiting', probe), base)).toBe(
			'1 of 3 pods ready, waiting · next probe in 5s'
		);
	});

	it.each([
		'No alerts firing for labels map[alertname:X]',
		'No alerts firing',
		'Healthy',
		'OK',
		'3/3 ready'
	])('drops healthy-sounding %j on a Pending check', (m) => {
		expect(pendingRowText(hc(m), base)).toBe('Not evaluated yet');
		expect(pendingRowText(hc(m, probe), base)).toBe('next probe in 5s');
	});

	it('does not treat "unhealthy" / "not healthy" as healthy', () => {
		expect(pendingRowText(hc('pod is unhealthy'), base)).toBe('pod is unhealthy');
		expect(pendingRowText(hc('not healthy yet'), base)).toBe('not healthy yet');
	});
});

describe('readsHealthy — only a WHOLE message that is a complete healthy form drops', () => {
	it.each([
		'No alerts firing for labels map[alertname:X]',
		'No alerts firing',
		'  No alerts firing for labels map[app:x].  ',
		'0 errors',
		'3/3 ready',
		'3 of 3 ready',
		'all 3 resources ready',
		'Healthy',
		'OK',
		'ok.'
	])('reads healthy: %j', (m) => expect(readsHealthy(m)).toBe(true));

	it.each([
		'not ok',
		'not passing',
		'no longer healthy',
		"isn't ready",
		'Health isn’t ready',
		'monitor isn’t healthy',
		'never became ready',
		'unhealthy',
		'status: unready',
		'2 of 3 not ready',
		'alert pending: HighErrorRate',
		'Alert pending for labels map[app:checkout]',
		'Alert pending (not firing yet)',
		'2/3 healthy',
		'2/3 passing',
		'1/3 ready',
		'0 of 3 ready',
		'12/1 ready',
		'1 of 3 checks passing',
		'Waiting for all pods to be ready (1/3)',
		'not all ready',
		'all 3 pods ready but one restarting',
		'HTTP 200 OK but p99 latency 3.2s over budget',
		'healthy: false',
		'ok=false',
		'OK (stale)',
		'3 Datadog monitors OK',
		'Warn: error rate 0.8% near 1% budget',
		'No Data',
		'Pending resources: ns/web (Ready: 1/3)',
		'Kustomization pending: generation 4 not yet observed',
		'Test job is pending',
		'not yet healthy',
		'unknown',
		'ready',
		'no errors but latency high',
		'0 errors in the last minute, 5 timeouts'
	])('keeps: %j', (m) => expect(readsHealthy(m)).toBe(false));
});
