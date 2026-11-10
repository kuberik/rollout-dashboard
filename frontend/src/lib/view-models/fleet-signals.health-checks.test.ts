import { describe, it, expect } from 'vitest';
import { fleetSignals, healthCheckKey, signalEvidence, type FleetSignal } from './fleet-signals';
import { buildRolloutCards, type RolloutCard } from '$lib/rollout-cards';
import { buildLanes } from './promotion-lanes';
import { cardContext } from './card-context';
import { homeInput, FIXTURE_NOW } from './home/fixture';
import type { HealthCheck } from '../../types';

/**
 * hc-v2: the lastErrorTime witness reaches `fleetSignals` (check-recovered,
 * check-flapping), read against what the controllers write:
 * - prometheus-controller: `status` Healthy/Unhealthy/Pending, `lastChangeTime`
 *   on each status change, `lastErrorTime` on every Unhealthy evaluation.
 * - rollout-controller: a bake starts only when every check is Healthy with a
 *   `lastChangeTime` after the deploy; a failed bake records
 *   `failedHealthChecks` on that entry; a retry CLEARS them.
 */
const NS = 'telemetry-collector-prod';
const NAME = 'telemetry-collector';
const T = FIXTURE_NOW.getTime();
const ago = (min: number) => new Date(T - min * 60e3).toISOString();

function hc(
	status: Partial<NonNullable<HealthCheck['status']>>,
	name = 'tc-error-rate'
): HealthCheck {
	return {
		apiVersion: 'kuberik.com/v1alpha1',
		kind: 'HealthCheck',
		metadata: {
			name,
			namespace: NS,
			labels: { app: NAME },
			annotations: { 'kuberik.com/display-name': 'error-rate' }
		},
		spec: { class: 'prometheus-alert' },
		status: { status: 'Healthy', ...status }
	} as unknown as HealthCheck;
}

type Entry = Record<string, unknown>;
const entry = (tag: string, deployedMin: number, extra: Entry = {}): Entry => ({
	version: { tag, version: tag, revision: tag },
	timestamp: ago(deployedMin),
	bakeStatus: 'Succeeded',
	bakeStartTime: ago(deployedMin - 1),
	bakeEndTime: ago(deployedMin - 2),
	...extra
});
const failedOn = (name: string, deployedMin: number): Entry => ({
	bakeStatus: 'Failed',
	bakeEndTime: ago(deployedMin - 5),
	failedHealthChecks: [
		{ name, namespace: NS, message: 'Alert firing for labels map[alertname:HighErrorRate]' }
	]
});

function run(history: Entry[], checks: HealthCheck[], cluster = 'prod'): FleetSignal[] {
	const input = homeInput(FIXTURE_NOW);
	input.rollouts = structuredClone(input.rollouts);
	const r = input.rollouts.find((x) => x.metadata?.namespace === NS && x.metadata?.name === NAME)!;
	(r.status as { history: unknown }).history = history;
	const ctx = cardContext({
		rollouts: input.rollouts,
		environments: { items: input.environments },
		rolloutDependencies: input.rolloutDependencies,
		schedulesExpected: false
	});
	const cards = buildRolloutCards(
		input.rollouts,
		input.environments,
		FIXTURE_NOW,
		ctx.gateContext,
		ctx.contractHoldsFor
	);
	return fleetSignals({
		cards,
		lanes: buildLanes(cards),
		healthChecks: new Map([[healthCheckKey(cluster, NS, NAME), checks]]),
		prFor: () => null,
		isApproval: (c: RolloutCard) => c.heldCause === 'person',
		now: FIXTURE_NOW,
		href: (c) => `/r/${c.ns}/${c.name}`,
		appHref: (a) => `/apps/${a}`
	}).filter((s) => s.app === NAME && (s.kind === 'check-flapping' || s.kind === 'check-recovered'));
}

describe('fleet signals — HealthCheck witness (hc-v2)', () => {
	it('recovered: Healthy now, lastErrorTime after the deploy, no earlier failure', () => {
		const s = run([entry('b', 30)], [hc({ lastErrorTime: ago(10), lastChangeTime: ago(8) })]);
		expect(s.map((x) => x.kind)).toEqual(['check-recovered']);
		expect(s[0].facts).toEqual({ kind: 'check-recovered', failedAgoMs: 10 * 60e3 });
		expect(s[0].since).toBe(ago(10));
	});

	it('flapping: failed in the previous deploy, passed at this bake start, failed again after it, Healthy now', () => {
		const s = run(
			[entry('b', 30), entry('a', 80, failedOn('tc-error-rate', 80))],
			[hc({ lastErrorTime: ago(10), lastChangeTime: ago(8) })]
		);
		expect(s.map((x) => x.kind)).toEqual(['check-flapping']);
		// the first failure is the earlier entry's bake end (80 - 5 = 75 minutes ago)
		expect(s[0].facts).toEqual({
			kind: 'check-flapping',
			check: 'error-rate',
			failures: 2,
			spanMs: 75 * 60e3
		});
		expect(s[0].evidence).toBe('error-rate 2× in 1h, expected 0');
		expect(s[0].evidence.split(/\s+/).length).toBeLessThanOrEqual(6);
	});

	it('counts every earlier failed entry in the window', () => {
		const s = run(
			[
				entry('c', 30),
				entry('b', 80, failedOn('tc-error-rate', 80)),
				entry('a', 200, failedOn('tc-error-rate', 200))
			],
			[hc({ lastErrorTime: ago(10), lastChangeTime: ago(8) })]
		);
		expect(s[0].facts).toMatchObject({ kind: 'check-flapping', failures: 3, spanMs: 195 * 60e3 });
	});

	it('an earlier failure outside the 24h window is not flapping', () => {
		const s = run(
			[entry('b', 30), entry('a', 25 * 60, failedOn('tc-error-rate', 25 * 60))],
			[hc({ lastErrorTime: ago(10), lastChangeTime: ago(8) })]
		);
		expect(s.map((x) => x.kind)).toEqual(['check-recovered']);
	});

	it("an earlier failure of a DIFFERENT check is not this check's flapping", () => {
		const s = run(
			[entry('b', 30), entry('a', 80, failedOn('tc-latency', 80))],
			[hc({ lastErrorTime: ago(10), lastChangeTime: ago(8) })]
		);
		expect(s.map((x) => x.kind)).toEqual(['check-recovered']);
	});

	it('no healthy pass in between (error before this bake started) is one failure, not flapping', () => {
		// the check was still failing when the head deployed; it never passed between the two
		const s = run(
			[
				entry('b', 30, { bakeStartTime: ago(5), bakeEndTime: ago(4) }),
				entry('a', 80, failedOn('tc-error-rate', 80))
			],
			[hc({ lastErrorTime: ago(20), lastChangeTime: ago(6) })]
		);
		expect(s.map((x) => x.kind)).toEqual(['check-recovered']);
	});

	it('the old reading (head failedHealthChecks + a retry before lastErrorTime) is not flapping: a retry clears them', () => {
		const head = entry('b', 60, {
			lastRetryTimestamp: ago(30),
			bakeStartTime: ago(25),
			...failedOn('tc-error-rate', 20)
		});
		const s = run([head], [hc({ lastErrorTime: ago(16), lastChangeTime: ago(12) })]);
		expect(s.map((x) => x.kind)).toEqual(['check-recovered']);
	});

	it('Unhealthy now is failing, not recovered or flapping', () => {
		const s = run(
			[entry('b', 30), entry('a', 80, failedOn('tc-error-rate', 80))],
			[hc({ status: 'Unhealthy', lastErrorTime: ago(1), lastChangeTime: ago(10) })]
		);
		expect(s).toEqual([]);
	});

	it('the lookup is per cluster: the same namespace/name on another cluster is not this rollout', () => {
		const s = run(
			[entry('b', 30)],
			[hc({ lastErrorTime: ago(10), lastChangeTime: ago(8) })],
			'staging'
		);
		expect(s).toEqual([]);
	});

	it('evidence states actual against expected', () => {
		expect(
			signalEvidence({
				kind: 'check-flapping',
				check: 'error-rate',
				failures: 3,
				spanMs: 3 * 3600e3
			})
		).toBe('error-rate 3× in 3h, expected 0');
	});
});
