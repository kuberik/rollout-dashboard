import { describe, it, expect } from 'vitest';
import type { Rollout, HealthCheck } from '$lib/../types';
import {
	checkFailure,
	checkFailureTitle,
	parseCheckMessage,
	deployWindowStart,
	classifyCheck,
	recoveredChecks,
	recoveredLabel
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
			rollout({ blocked: { status: 'True', reason: 'UnhealthyHealthChecks', message: SLO_MESSAGE } })
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
			rollout({ blocked: { status: 'True', reason: 'UnhealthyHealthChecks', message: SLO_MESSAGE } })
		)!;
		expect(checkFailureTitle(f)).toBe(
			'Health check payment-latency is failing — p99 latency 4.2s exceeds SLO of 500ms for 5m. Nothing new deploys here until it passes.'
		);
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

// Keep NOW referenced so the fixture's intent (02:00, 21m after the deploy,
// 90s after the error) stays legible rather than drifting into a magic string.
it('the fixture is the critic`s timeline', () => {
	expect(NOW.getTime() - new Date(DEPLOYED_AT).getTime()).toBe(30 * 60_000);
});
