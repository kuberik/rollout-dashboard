import { describe, expect, test } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import RolloutNeighbourhood from './RolloutNeighbourhood.svelte';
import { chainWaitOf, stageWaitText } from '$lib/view-models/wait-fact';
import { gatesOnThisRollout, type NeighbourLink, type RolloutNeighbourhood as Hood } from '$lib/view-models/rollout-neighbourhood';

/** batch4 #76, UX71 1 + 2: the upstream card of a stage the build waits on says what the stage is doing, and the header counts it as holding. */
function link(env: string, over: Partial<NeighbourLink> = {}): NeighbourLink {
	return {
		key: `link:${env}`, side: 'upstream', writer: 'promotion', state: 'clear', held: [], contract: null, requiredVersion: null, providedVersion: null,
		cyclic: false, gate: 'promotion', chainPredecessor: true,
		node: { id: `c/ns/${env}`, cluster: 'c', namespace: 'ns', name: 'invoice-api', env, envRank: 0, unresolved: false, build: 'a11c808', candidateCount: 0, waiting: false, blocked: false, holds: [] },
		...over
	} as unknown as NeighbourLink;
}
function tile(chainWait: { stage: string; text: string } | null): { text: string; edges: number } {
	const l = link('test');
	const focus = { ...l.node, env: 'staging' };
	const hood = { focus, upstream: [l], downstream: [], gates: [], heldLinks: 0, total: 1, holding: 0, heldBuilds: [] } as unknown as Hood;
	const { container } = render(RolloutNeighbourhood, { props: { hood, chainWait, peerHeldByEnv: new Map([['test', { state: 'healthy', held: false, causeLabel: null }]]) } });
	const t = container.querySelector('[data-key="link:test"]')!;
	return { text: (t.textContent ?? '').replace(/\s+/g, ' '), edges: (t.getAttribute('data-gate-type') === 'promotion' ? 1 : 0) };
}

describe('wait grammar (one for the app page and the Gates card)', () => {
	test('started word follows the peer state', () => {
		expect(stageWaitText('dev', ['checking'], '775f46a')).toBe('Waiting for dev to finish checking 775f46a');
		expect(stageWaitText('dev', ['deploying'], '775f46a')).toBe('Waiting for dev to finish deploying 775f46a');
		expect(stageWaitText('test', ['healthy'], 'a11c909')).toBe('Waiting for test to deploy a11c909');
	});
	test('chainWaitOf: wave text wins, a held stage and a missing build give nothing', () => {
		expect(chainWaitOf({ stage: 'test', wave: 'Waiting for x to y z' }, 'healthy', 'b')).toEqual({ stage: 'test', text: 'Waiting for x to y z' });
		expect(chainWaitOf({ stage: 'test', heldCause: 'test held on a rule' }, 'healthy', 'b')).toBeNull();
		expect(chainWaitOf({ stage: 'test' }, 'healthy', null)).toBeNull();
		expect(chainWaitOf(null, 'healthy', 'b')).toBeNull();
		expect(chainWaitOf({ stage: 'test' }, 'healthy', 'a11c909')?.text).toBe('Waiting for test to deploy a11c909');
	});
});

describe('Gates upstream card (invoice-api staging waits for test)', () => {
	test('while the stage is the cause it says what it is doing, never "Nothing held"', () => {
		const t = tile(chainWaitOf({ stage: 'test' }, 'healthy', 'a11c909'));
		expect(t.text).toContain('Waiting for test to deploy a11c909');
		expect(t.text).not.toContain('Nothing held');
		expect(t.edges).toBe(1);
	});
	test('when the upstream genuinely holds nothing it is a passed promotion tile: type on the tile root, no wait sentence, no "Nothing held"', () => {
		const t = tile(null);
		expect(t.text).toContain('Promotion');
		expect(t.text).not.toContain('Nothing held');
		expect(t.text).not.toContain('Waiting for');
		expect(t.edges).toBe(1);
	});
});

describe('Gates header count (promotion wait counts as holding)', () => {
	const up = [link('test')];
	test('waiting on the chain stage: 1 of 1 holding; not waiting: 0 of 0', () => {
		expect(gatesOnThisRollout({ upstream: up, downstream: [], gates: [] }, 'test')).toEqual({ total: 1, holding: 1 });
		expect(gatesOnThisRollout({ upstream: up, downstream: [], gates: [] })).toEqual({ total: 0, holding: 0 });
		expect(gatesOnThisRollout({ upstream: up, downstream: [], gates: [] }, 'dev')).toEqual({ total: 0, holding: 0 });
	});
	test('adds to real blocked gates once, not per held build', () => {
		const blocked = link('x', { chainPredecessor: false, state: 'blocked', held: ['a', 'b'] as never });
		expect(gatesOnThisRollout({ upstream: [...up, blocked], downstream: [], gates: [] }, 'test')).toEqual({ total: 2, holding: 2 });
	});
});

describe('promotion gate box: the chip links to the source environment Gates tab (F4)', () => {
	const mkBox = (source: string | null) => ({
		key: 'gate:promo', kind: 'unknown', state: 'blocked', title: 'Promotion', kindWord: null, phrase: 'holding b2', held: ['b2'],
		mark: { kind: 'unknown', clears: 'unknown' }, gates: ['promo'], label: { kind: 'promotion', source }
	});
	const draw = (source: string | null, upstream: NeighbourLink[]) => {
		const hood = { focus: { ...link('x').node, env: 'prod' }, upstream, downstream: [], gates: [mkBox(source)], heldLinks: 0, total: 1, holding: 1, heldBuilds: ['b2'] } as unknown as Hood;
		return render(RolloutNeighbourhood, { props: { hood, hrefOf: (n: { env: string }) => `/rollouts/c/ns/${n.env}/gates` } }).container.querySelector('[data-key="gate:gate:promo"]')!;
	};
	test('the source chip is an anchor to that environment Gates tab with an accessible name', () => {
		const a = draw('staging', [link('staging')]).querySelector('a[href]');
		expect(a).toHaveAttribute('href', '/rollouts/c/ns/staging/gates');
		expect(a).toHaveAttribute('aria-label', 'Open staging');
	});
	test('no known rollout for the source: chip stays unlinked; unknown source reads the word', () => {
		expect(draw('staging', []).querySelector('a[href]')).toBeNull();
		const el = draw(null, []);
		expect(el.querySelector('a[href]')).toBeNull();
		expect(el.textContent).toContain('Promotion');
	});
});
