import { describe, test, expect } from 'vitest';
import type { Rollout, Environment, RolloutDependency } from '../../types';
import { rolloutTabs } from './rollout-tabs';

const BASE = { namespace: 'checkout-api-prod', name: 'checkout-api', environments: [], rolloutDependencies: [] };

function rollout(over: {
	gates?: unknown[];
	healthCheckSelector?: unknown;
	deploymentBlocked?: boolean;
} = {}): Rollout {
	return {
		metadata: { name: 'checkout-api', namespace: 'checkout-api-prod' },
		spec: over.healthCheckSelector ? { healthCheckSelector: over.healthCheckSelector } : {},
		status: {
			gates: over.gates ?? [],
			conditions: over.deploymentBlocked
				? [{ type: 'DeploymentBlocked', status: 'True' }]
				: []
		}
	} as unknown as Rollout;
}

function env(tier: string, over: { site?: string; wave?: number; name?: string } = {}): Environment {
	return {
		metadata: { name: `checkout-api-${tier}-${over.site ?? 'default'}`, namespace: 'checkout-api-prod' },
		spec: { name: 'checkout-api', environment: tier, site: over.site, wave: over.wave },
		status: {}
	} as unknown as Environment;
}

function depEdge(over: { consumer?: string; provider?: string; consumerNs?: string; providerNs?: string }): RolloutDependency {
	return {
		metadata: { name: 'dep', namespace: over.consumerNs ?? 'checkout-api-prod' },
		spec: {
			rolloutRef: { name: over.consumer ?? 'checkout-api' },
			providerRef: { name: over.provider ?? 'payments-svc', namespace: over.providerNs }
		},
		status: { gateName: 'checkout-api-needs-payments' }
	} as unknown as RolloutDependency;
}

describe('rolloutTabs — one truth for Gates-tab visibility', () => {
	test('a rollout with no gate, no neighbouring Environment and no dependency has no Gates tab', () => {
		expect(rolloutTabs({ ...BASE, rollout: rollout(), environment: null }).gates).toBe(false);
	});

	test('status.gates non-empty earns the tab', () => {
		expect(
			rolloutTabs({ ...BASE, rollout: rollout({ gates: [{ name: 'g' }] }), environment: null }).gates
		).toBe(true);
	});

	test('the detail payload\'s own rolloutGates earns the tab even with an empty status.gates', () => {
		expect(
			rolloutTabs({
				...BASE,
				rollout: rollout(),
				rolloutGates: { items: [{ metadata: { name: 'g' } } as never] },
				environment: null
			}).gates
		).toBe(true);
	});

	test('a health check selector earns the tab whether or not anything is currently failing', () => {
		expect(
			rolloutTabs({
				...BASE,
				rollout: rollout({ healthCheckSelector: { matchLabels: { app: 'checkout-api' } } }),
				environment: null
			}).gates
		).toBe(true);
	});

	test('DeploymentBlocked=True earns the tab even when no other source names why', () => {
		expect(
			rolloutTabs({ ...BASE, rollout: rollout({ deploymentBlocked: true }), environment: null }).gates
		).toBe(true);
	});

	test('a prod Environment with a dev Environment of the same app upstream earns the tab', () => {
		const dev = env('dev');
		const prod = env('prod');
		expect(
			rolloutTabs({ ...BASE, rollout: rollout(), environment: prod, environments: [dev, prod] }).gates
		).toBe(true);
	});

	test('the head of a line still earns the tab: something downstream takes its version', () => {
		const dev = env('dev');
		const prod = env('prod');
		expect(
			rolloutTabs({ ...BASE, rollout: rollout(), environment: dev, environments: [dev, prod] }).gates
		).toBe(true);
	});

	test('a tier with more than one site earns the tab even with no other tier', () => {
		const eu = env('prod', { site: 'eu-west-1', wave: 1 });
		const us = env('prod', { site: 'us-east-1', wave: 1 });
		expect(
			rolloutTabs({ ...BASE, rollout: rollout(), environment: eu, environments: [eu, us] }).gates
		).toBe(true);
	});

	test('a lone Environment with no neighbour does not — "has an Environment" is not "has a neighbour"', () => {
		const only = env('staging');
		expect(
			rolloutTabs({ ...BASE, rollout: rollout(), environment: only, environments: [only] }).gates
		).toBe(false);
	});

	test('another app\'s Environments are not this app\'s neighbours', () => {
		const mine = env('prod');
		const other = {
			...env('dev'),
			spec: { name: 'other-app', environment: 'dev' }
		} as unknown as Environment;
		expect(
			rolloutTabs({ ...BASE, rollout: rollout(), environment: mine, environments: [mine, other] }).gates
		).toBe(false);
	});

	test('a RolloutDependency naming this rollout as the CONSUMER earns the tab', () => {
		expect(
			rolloutTabs({
				...BASE,
				rollout: rollout(),
				environment: null,
				rolloutDependencies: [depEdge({ consumer: 'checkout-api' })]
			}).gates
		).toBe(true);
	});

	test('a RolloutDependency naming this rollout as the PROVIDER earns the tab too — an edge has two ends', () => {
		expect(
			rolloutTabs({
				...BASE,
				rollout: rollout(),
				environment: null,
				rolloutDependencies: [depEdge({ consumer: 'checkout-worker', provider: 'checkout-api' })]
			}).gates
		).toBe(true);
	});

	test('a RolloutDependency naming neither end of THIS rollout does not', () => {
		expect(
			rolloutTabs({
				...BASE,
				rollout: rollout(),
				environment: null,
				rolloutDependencies: [depEdge({ consumer: 'checkout-worker', provider: 'payments-svc' })]
			}).gates
		).toBe(false);
	});
});
