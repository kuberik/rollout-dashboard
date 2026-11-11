import { describe, expect, test } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import RolloutNeighbourhood from './RolloutNeighbourhood.svelte';
import { buildHomeModel, peerHeldMap } from '$lib/view-models/home-model';
import { homeInput } from '$lib/view-models/home/fixture';
import { buildRolloutCards } from '$lib/rollout-cards';
import { rolloutStateChip } from '$lib/view-models/rollout-state-chip';
import type { NeighbourLink, RolloutNeighbourhood as Hood } from '$lib/view-models/rollout-neighbourhood';

/**
 * checkout-api prod us-east-2 is still checking its own build (home-incident). The Gates tab of a sibling place draws it as a chain
 * predecessor tile; that tile must read the same word the app page row and /rollouts print, never "Nothing held" with a passed dot.
 */
const input = homeInput();
const model = buildHomeModel(input);
const appRow = model.apps.find((a) => a.app === 'checkout-api')!.envs.find((e) => e.env === 'prod-us-east-2')!;
const cards = buildRolloutCards(input.rollouts, input.environments, input.now);
const card = cards.find((c) => c.name === 'checkout-api' && c.envName === 'prod-us-east-2')!;

function tileText(peerState: Parameters<typeof peerHeldMap>[0]): string {
	const link = {
		key: 'link:chain', side: 'upstream', writer: 'promotion', state: 'clear', held: [], contract: null, requiredVersion: null, providedVersion: null,
		cyclic: false, gate: 'promotion', chainPredecessor: true,
		node: { id: 'c/ns/checkout-api', cluster: 'c', namespace: 'ns', name: 'checkout-api', env: 'prod-us-east-2', envRank: 0, unresolved: false, build: 'b', candidateCount: 0, waiting: false, blocked: false, holds: [] }
	} as unknown as NeighbourLink;
	const focus = { ...link.node, name: 'checkout-api', env: 'prod-af-south-1' };
	const hood = { focus, upstream: [link], downstream: [], gates: [], heldLinks: 0, total: 1, holding: 0, heldBuilds: [] } as unknown as Hood;
	const { container } = render(RolloutNeighbourhood, { props: { hood, peerHeldByEnv: peerHeldMap(peerState) } });
	return (container.querySelector('[data-key="link:chain"]')?.textContent ?? '').replace(/\s+/g, ' ');
}

describe('Gates peer tile, checkout-api prod-us-east-2 (home-incident)', () => {
	test('the app page row, /rollouts and the Gates tile all say Checking', () => {
		expect(appRow.state).toBe('checking');
		expect(rolloutStateChip(card.bakeStatus).label).toBe('checking');
		const text = tileText(new Map([['prod-us-east-2', card]]));
		expect(text).toMatch(/Checking/i);
		expect(text).not.toContain('Nothing held');
	});
	test('a place past the build still prints the passed line', () => {
		const done = { ...card, bakeStatus: 'Succeeded', statusKey: 'succeeded', stuck: null, held: false } as typeof card;
		expect(tileText(new Map([['prod-us-east-2', done]]))).toContain('Nothing held');
	});
});
