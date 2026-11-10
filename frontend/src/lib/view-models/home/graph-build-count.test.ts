/**
 * Home builds many change rows over one set of cluster inputs. The rollout
 * graph `buildPrPipeline` reads contract holds from depends only on those
 * inputs, so `buildChangeRows` builds it once, not once per change (round 1
 * measured ~29 of ~60ms of a Home build on the fixture). Asserts call counts
 * only, never timing.
 */
import { describe, expect, it, vi } from 'vitest';
import { homeInput } from './fixture';

vi.mock('../dependency-graph', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../dependency-graph')>();
	return { ...actual, buildRolloutGraph: vi.fn(actual.buildRolloutGraph) };
});

const { buildRolloutGraph } = await import('../dependency-graph');
const { buildChangeRows } = await import('../changes');
const { buildPrPipeline, prPipelineGraph } = await import('../pr-pipeline');
const { buildHomeModel } = await import('../home-model');
const spy = vi.mocked(buildRolloutGraph);

describe('change-row graph build count', () => {
	const input = homeInput();
	const deps = input.rolloutDependencies;

	it('buildChangeRows builds the graph once for all changes', () => {
		expect(input.changes.length).toBeGreaterThan(1);
		spy.mockClear();
		buildChangeRows(input.changes, input.rollouts, input.environments, deps, input.now);
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('buildChangeRows with no changes builds no graph', () => {
		spy.mockClear();
		expect(buildChangeRows([], input.rollouts, input.environments, deps, input.now)).toEqual([]);
		expect(spy).not.toHaveBeenCalled();
	});

	it('the shared graph gives the same rows as one graph per change', () => {
		const shared = buildChangeRows(
			input.changes,
			input.rollouts,
			input.environments,
			deps,
			input.now
		);
		const perChange = input.changes.map(
			(c) => buildChangeRows([c], input.rollouts, input.environments, deps, input.now)[0]
		);
		expect(shared).toEqual(perChange);
	});

	it('buildPrPipeline uses a given graph and builds its own otherwise', () => {
		const c = input.changes[0];
		const meta = {
			owner: c.owner,
			repo: c.repo,
			number: c.number ?? 0,
			mergedAt: c.mergedAt,
			mergeCommitSha: c.mergeCommitSha,
			containedIn: c.containedIn ?? [],
			containedInAll: c.containedInAll
		};
		const graph = prPipelineGraph(input.rollouts, input.environments, deps);
		spy.mockClear();
		const given = buildPrPipeline(meta, input.rollouts, input.environments, deps, input.now, {
			graph
		});
		expect(spy).not.toHaveBeenCalled();
		const own = buildPrPipeline(meta, input.rollouts, input.environments, deps, input.now);
		expect(spy).toHaveBeenCalledTimes(1);
		expect(given).toEqual(own);
	});

	it('a Home build makes the same number of graph builds whatever the change count', () => {
		spy.mockClear();
		buildHomeModel(input);
		const one = spy.mock.calls.length;
		spy.mockClear();
		buildHomeModel({ ...input, changes: [...input.changes, ...input.changes] });
		expect(spy.mock.calls.length).toBe(one);
	});
});
