import { describe, it, expect, vi } from 'vitest';
import * as bs from './blocking-story';

/* batch4: every buildGateContext caller hands over the rollouts, so the summaries' displayName seeds ctx.pretty and no path can print an
   unseeded "Gate". (Apps.svelte, ChangeVersionModal.svelte and the two pages are template/script wired the same way; the pure callers are pinned here.) */
vi.mock('./blocking-story', async (orig) => {
	const m = await orig<typeof import('./blocking-story')>();
	return { ...m, buildGateContext: vi.fn(m.buildGateContext) };
});
import { fleetGraph } from '$lib/components/new/held-chain';
import { prPipelineGraph } from './pr-pipeline';

const rollout = { metadata: { name: 'app', namespace: 'ns' }, spec: {}, status: { gates: [{ name: 'g-1', displayName: 'Business Hours Only' }] } } as never;
const seeded = () => (bs.buildGateContext as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].rollouts);

describe('buildGateContext is handed the rollouts', () => {
	it('held-chain fleetGraph', () => {
		vi.mocked(bs.buildGateContext).mockClear();
		fleetGraph({ rollouts: [rollout], environments: [], rolloutDependencies: null } as never);
		expect(seeded()).toEqual([[rollout]]);
	});
	it('pr-pipeline prPipelineGraph', () => {
		vi.mocked(bs.buildGateContext).mockClear();
		prPipelineGraph([rollout], [], null);
		expect(seeded()).toEqual([[rollout]]);
	});
});
