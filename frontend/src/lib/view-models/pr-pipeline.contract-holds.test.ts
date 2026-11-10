import { describe, it, expect, vi } from 'vitest';
import type { Rollout, Environment } from '$lib/../types';

/**
 * The hold-one-rule (squad-rollout): "held" is a gate OR a contract.
 * `buildPrPipeline` must hand `promotionHoldBreakdown` the rollout's contract
 * holds, or a build held only by a contract reads as deployable. The graph
 * lookup is mocked so this checks the WIRING, not dependency-graph.ts's own
 * contract resolution (which has its own tests).
 */
const holds = vi.hoisted(() => ({ map: new Map<string, unknown>() }));
vi.mock('./dependency-graph', async (orig) => {
	const real = await orig<typeof import('./dependency-graph')>();
	return { ...real, contractHoldsForRollout: () => holds.map };
});

const { buildPrPipeline } = await import('./pr-pipeline');

const NOW = new Date('2026-09-10T12:00:00Z');
const SOURCE = 'github.com/acme/widget';

function rollout(): Rollout {
	return {
		metadata: { name: 'widget-app', namespace: 'widget-dev', annotations: {} },
		spec: {},
		status: {
			source: SOURCE,
			gates: [],
			history: [
				{
					id: 0,
					timestamp: '2026-08-20T00:00:00Z',
					bakeStatus: 'Succeeded',
					version: { tag: 'old-1', revision: 'old-1' }
				}
			],
			availableReleases: [
				{ tag: 'old-1', revision: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ tag: 'build-42', revision: 'c0ffee1', created: '2026-09-02T00:00:00Z' }
			]
		}
	} as unknown as Rollout;
}
const env = {
	metadata: { name: 'widget-app-dev', namespace: 'widget-dev', annotations: {} },
	spec: { environment: 'dev', rolloutRef: { name: 'widget-app' } }
} as unknown as Environment;
const meta = {
	owner: 'acme',
	repo: 'widget',
	number: 42,
	mergedAt: '2026-09-01T00:00:00Z',
	mergeCommitSha: 'c0ffee1',
	containedIn: ['c0ffee1'],
	containedInAll: true
};

describe('buildPrPipeline passes contract holds into "held"', () => {
	it('a build held only by a contract is held', () => {
		holds.map = new Map([
			['c0ffee1', [{ provider: 'api-app', required: '>=2.0.0', has: '1.0.0' }]]
		]);
		const vm = buildPrPipeline(meta, [rollout()], [env], { items: [] }, NOW);
		expect(vm.services[0].cells[0].held).toBe(true);
	});

	it('with no contract hold and no gate, it is not', () => {
		holds.map = new Map();
		const vm = buildPrPipeline(meta, [rollout()], [env], { items: [] }, NOW);
		expect(vm.services[0].cells[0].held).toBe(false);
	});
});
