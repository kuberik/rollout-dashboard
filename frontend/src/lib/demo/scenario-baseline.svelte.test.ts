/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { respond } from './respond';
import { resetDemoState } from './state';

/**
 * The three scenarios' failure baselines, pinned. Demo-data changes (giving
 * every fleet build its revision, the viewer's own changes) must not move the
 * fleet's story: calm Home has nothing that needs you, incident has exactly
 * checkout-worker failing in staging, wide adds telemetry-forwarder in prod.
 */
const FAILED_HEADS: Record<'calm' | 'incident' | 'wide', string[]> = {
	calm: [],
	incident: ['checkout-worker-staging/checkout-worker'],
	wide: ['checkout-worker-staging/checkout-worker', 'telemetry-forwarder-prod/telemetry-forwarder']
};

function json(url: string) {
	return JSON.parse(respond('GET', url).body ?? 'null');
}

afterEach(() => vi.unstubAllGlobals());

describe.each(['calm', 'incident', 'wide'] as const)('scenario baseline — %s', (scenario) => {
	test('the failed heads are exactly the scenario’s own', () => {
		resetDemoState(scenario);
		const items = json('/api/rollouts').rollouts.items as any[];
		const failed = items
			.filter((r) => r.status?.history?.[0]?.bakeStatus === 'Failed')
			.map((r) => `${r.metadata.namespace}/${r.metadata.name}`)
			.sort();
		expect(failed).toEqual(FAILED_HEADS[scenario]);
	});

	/* 2026-11-09: `calm Home has no Needs-you card and no pill` went with ControlCenter (old Home); the new Home's calm state is held by home-page.test. */
});
