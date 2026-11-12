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

function renderTile(peerState: Parameters<typeof peerHeldMap>[0]): Element | null {
	const link = {
		key: 'link:chain', side: 'upstream', writer: 'promotion', state: 'clear', held: [], contract: null, requiredVersion: null, providedVersion: null,
		cyclic: false, gate: 'promotion', chainPredecessor: true,
		node: { id: 'c/ns/checkout-api', cluster: 'c', namespace: 'ns', name: 'checkout-api', env: 'prod-us-east-2', envRank: 0, unresolved: false, build: 'b', candidateCount: 0, waiting: false, blocked: false, holds: [] }
	} as unknown as NeighbourLink;
	const focus = { ...link.node, name: 'checkout-api', env: 'prod-af-south-1' };
	const hood = { focus, upstream: [link], downstream: [], gates: [], heldLinks: 0, total: 1, holding: 0, heldBuilds: [] } as unknown as Hood;
	const { container } = render(RolloutNeighbourhood, { props: { hood, peerHeldByEnv: peerHeldMap(peerState) } });
	return container.querySelector('[data-key="link:chain"]');
}
function tileText(peerState: Parameters<typeof peerHeldMap>[0]): string {
	return (renderTile(peerState)?.textContent ?? '').replace(/\s+/g, ' ');
}
/** The held mark is StatusMark's pause glyph (two bars). */
const HELD_GLYPH = 'path[d="M9 5.5v13M15 5.5v13"]';

describe('Gates peer tile, checkout-api prod-us-east-2 (home-incident)', () => {
	test('the app page row, /rollouts and the Gates tile all say Checking', () => {
		expect(appRow.state).toBe('checking');
		expect(rolloutStateChip(card.bakeStatus).label).toBe('checking');
		const text = tileText(new Map([['prod-us-east-2', card]]));
		expect(text).toMatch(/Checking/i);
		expect(text).not.toContain('Nothing held');
	});
	test('a place past the build draws the passed mark and no held line (it never says "Nothing held")', () => {
		const done = { ...card, bakeStatus: 'Succeeded', statusKey: 'succeeded', stuck: null, held: false } as typeof card;
		const el = renderTile(new Map([['prod-us-east-2', done]]));
		expect(el?.getAttribute('data-gate-type')).toBe('promotion');
		expect(el?.querySelector('[data-gate-mark]')?.getAttribute('data-gate-mark')).toBe('newest');
		expect(el?.querySelector('[data-gate-release]')).toBeNull();
		expect(tileText(new Map([['prod-us-east-2', done]]))).not.toContain('Nothing held');
	});
	test('a held peer reads "Waits on <cause>" beside the behind mark, never the passed dot', () => {
		const heldCard = cards.find((c) => c.envName === 'prod-us-east-2' && peerHeldMap(new Map([['x', c]])).get('x')?.held && c.heldCauseLabel)
			?? cards.find((c) => peerHeldMap(new Map([['x', c]])).get('x')?.held && c.heldCauseLabel)!;
		const tile = renderTile(new Map([['prod-us-east-2', heldCard]]));
		// a held predecessor is never drawn held (it does not hold THIS build): line "Waits on <cause>", mark 'behind', never the passed dot
		expect((tile?.textContent ?? '').replace(/\s+/g, ' ')).toContain('Waits on');
		expect(tile?.querySelector('[data-gate-mark]')?.getAttribute('data-gate-mark')).toBe('behind');
		expect(tile?.querySelector(HELD_GLYPH)).toBeNull();
	});
});
