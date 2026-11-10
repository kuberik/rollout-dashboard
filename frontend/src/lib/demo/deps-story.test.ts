import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { respond } from './respond';
import { resetDemoState } from './state';
import { buildRolloutGraph } from '../view-models/dependency-graph';
import { buildGateContext, withSchedules } from '../view-models/blocking-story';
import { rolloutGateBoxes } from '../view-models/rollout-gates';
import type { Environment, Rollout, RolloutDependency, RolloutGate } from '../../types';

/**
 * `/api/demo/deps?step=` — the stepped "nothing moves before its
 * dependencies" story (deps-story.ts). Driven through `respond()` and read back
 * through the same `/api/rollouts` payload and graph builder the pages use, so
 * what this asserts is what the graph draws.
 */
type List = {
	rollouts: { items: Rollout[] };
	environments: { items: Environment[] };
	rolloutDependencies: { items: RolloutDependency[] };
};
const get = (url: string) => respond('GET', url);
const body = (url: string) => JSON.parse(get(url).body ?? '{}');

function graph() {
	const l = body('/api/rollouts') as List;
	return buildRolloutGraph({
		rollouts: l.rollouts.items,
		environments: l.environments.items,
		dependencies: l.rolloutDependencies.items,
		envOrder: []
	});
}
const held = (to: string, contract: string) =>
	graph().edges.find((e) => e.writer === 'contract' && e.contract === contract && e.to.endsWith(to))!;

describe('the stepped dependencies story', () => {
	beforeEach(() => resetDemoState('calm'));
	afterEach(() => resetDemoState('calm'));

	it('reports where it is, refuses an out-of-order or unknown step', () => {
		expect(body('/api/demo/deps')).toMatchObject({ step: 'arm' });
		expect(get('/api/demo/deps?step=payments').status).toBe(409);
		expect(get('/api/demo/deps?step=nope').status).toBe(400);
	});

	it('moves only what its dependencies allow, one beat at a time', () => {
		expect(held('/platform-prod/payments-svc', 'ledger').state).toBe('blocked');
		expect(held('/checkout-api-prod-eu-central/checkout-api', 'payments').held).toEqual([
			'4.45.0-45',
			'4.44.0-44'
		]);

		expect(get('/api/demo/deps?step=ledger').status).toBe(200);
		expect(held('/platform-prod/payments-svc', 'ledger').state).toBe('clear');
		// payments-svc has not shipped yet: checkout-api is still held on it.
		expect(held('/checkout-api-prod-eu-central/checkout-api', 'payments').state).toBe('blocked');

		expect(get('/api/demo/deps?step=payments').status).toBe(200);
		expect(held('/checkout-api-prod-eu-central/checkout-api', 'payments').state).toBe('clear');
		// A newer provider does not satisfy an older ~2.9.0 pin.
		expect(held('/checkout-api-prod-us-east-2/checkout-api', 'payments').state).toBe('blocked');

		// Promotion order still applies: the region cannot take b-45 before staging.
		const eu = () =>
			(body('/api/rollouts/checkout-api-prod-eu-central/checkout-api') as { rollout: Rollout }).rollout;
		expect(eu().status?.gates?.[0]?.allowedVersions).not.toContain('b-45');
		expect(get('/api/demo/deps?step=staging').status).toBe(200);
		expect(eu().status?.gates?.[0]?.allowedVersions).toContain('b-45');

		expect(get('/api/demo/deps?step=regions').status).toBe(200);
		expect(eu().status?.history?.[0]?.version?.tag).toBe('b-45');
		expect(get('/api/demo/deps?step=regions').status).toBe(200); // repeat: no-op

		resetDemoState();
		expect(body('/api/demo/deps')).toMatchObject({ step: 'arm' });
		expect(held('/platform-prod/payments-svc', 'ledger').state).toBe('blocked');
	});

	/**
	 * The Gates tab on checkout-api staging — the filmed page — built the way
	 * the tab builds it. The deploy window and the approval are drawn on every
	 * beat and hold nothing on any of them: the only cause is payments-svc.
	 */
	it('checkout-api staging carries an open deploy window and a given approval, holding nothing', () => {
		const NS = 'checkout-api-staging';
		const tab = () => {
			const l = body('/api/rollouts') as List;
			const d = body(`/api/rollouts/${NS}/checkout-api`) as {
				rollout: Rollout;
				rolloutGates: { items: RolloutGate[] };
			};
			const schedules = body(`/api/rollouts/${NS}/checkout-api/schedules`).rolloutSchedules.items;
			const ctx = withSchedules(
				buildGateContext({
					environments: l.environments,
					rolloutDependencies: l.rolloutDependencies,
					rolloutGates: d.rolloutGates
				}),
				NS,
				schedules
			);
			const g = buildRolloutGraph({
				rollouts: l.rollouts.items,
				environments: l.environments.items,
				dependencies: l.rolloutDependencies.items,
				envOrder: [],
				gates: ctx,
				focus: { cluster: 'staging', namespace: NS, name: 'checkout-api' }
			});
			const focus = g.nodes.find((n) => n.namespace === NS && n.name === 'checkout-api')!;
			const boxes = rolloutGateBoxes({
				focus,
				rollout: d.rollout,
				rolloutGates: d.rolloutGates.items,
				schedules,
				healthChecks: null,
				edgeGates: new Set(g.edges.filter((e) => e.to === focus.id).map((e) => e.gate))
			});
			return { boxes, focus, edges: g.edges.filter((e) => e.to === focus.id) };
		};

		for (const step of [null, 'ledger', 'payments', 'staging', 'regions'] as const) {
			if (step) expect(get(`/api/demo/deps?step=${step}`).status).toBe(200);
			const { boxes, focus, edges } = tab();
			expect(boxes.map((b) => [b.kind, b.title, b.state])).toEqual([
				['schedule', 'Business hours', 'clear'],
				['approval', 'Release approval', 'clear']
			]);
			expect(boxes[0].phrase).toMatch(/^open now · closes /);
			// Neither is a hold: nothing new holds staging on any beat.
			expect(focus.holds).toEqual([]);
			const payments = edges.find((e) => e.contract === 'payments')!;
			expect(payments.state).toBe(step === null || step === 'ledger' ? 'blocked' : 'clear');
		}
	});
});
