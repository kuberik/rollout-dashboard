import { describe, test, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import RolloutNeighbourhood from './RolloutNeighbourhood.svelte';
import BlockedActions from './new/BlockedActions.svelte';
import { ASK_LOADING, askView } from './new/state-words';
import { approvalAskAt, rollouts, type ApprovalTarget } from './new/data';
import type { RolloutNeighbourhood as Hood } from '$lib/view-models/rollout-neighbourhood';
import type { GateBox } from '$lib/view-models/rollout-gates';

/**
 * The viewer's approval ask on the rollout page has three states, and each draws a different thing in the same place:
 * a target ("Needs your approval" + Approve), still loading (neutral words + a slot reserved at the button's size, so nothing moves
 * when the answer lands), and null (today's words, no button, no reserve). Pinned for the tile in the Gates column and the banner's
 * action row.
 */
const target = (): ApprovalTarget => {
	const row = rollouts('incident').rows.find((r) => r.app === 'payments-core' && r.tier === 'prod')!;
	return approvalAskAt(row.href, 'incident')!;
};

const gate = {
	key: 'gate:approval',
	kind: 'approval',
	state: 'blocked',
	title: 'Prod approval',
	kindWord: 'Approval',
	phrase: 'holding b2',
	held: ['b2'],
	mark: { kind: 'person', clears: 'person' },
	gates: ['approval']
} as unknown as GateBox;

const focus = { id: 'c/ns/this-app', cluster: 'c', namespace: 'ns', name: 'this-app', env: 'prod', envRank: 0, unresolved: false, build: 'b1', candidateCount: 0, waiting: false, blocked: false, holds: [] };
const hood = { focus, upstream: [], downstream: [], gates: [gate], heldLinks: 0, total: 1, holding: 1, heldBuilds: ['b2'] } as unknown as Hood;
const tile = (approveAsk: ApprovalTarget | typeof ASK_LOADING | null) => render(RolloutNeighbourhood, { props: { hood, approveAsk } }).container;

describe('the held approval tile', () => {
	test('a target says "Needs your approval" and carries Approve', () => {
		const c = tile(target());
		expect(c.textContent).toContain('Needs your approval');
		expect(c.querySelectorAll('[data-approve-open]')).toHaveLength(1);
		expect(c.textContent).not.toContain('How to approve');
	});
	test('loading says the neutral words, no Approve, and reserves the button box (h-7)', () => {
		const c = tile(ASK_LOADING);
		expect(c.textContent).toContain('Waiting for approval');
		expect(c.textContent).not.toContain('Needs your approval');
		expect(c.querySelector('[data-approve-open]')).toBeNull();
		expect(c.querySelectorAll('[data-approve-slot]')).toHaveLength(1);
		expect(c.querySelector('[data-approve-slot]')).toHaveClass('h-7');
	});
	test("null keeps today's words: \"How to approve\", no Approve, no reserve", () => {
		const c = tile(null);
		expect(c.textContent).toContain('How to approve');
		expect(c.querySelector('[data-approve-open]')).toBeNull();
		expect(c.querySelector('[data-approve-slot]')).toBeNull();
	});
});

describe('the blocked banner action row', () => {
	const headline = 'Held: waiting on an approval';
	const banner = (ask: ApprovalTarget | typeof ASK_LOADING | null) => {
		const v = askView(ask, headline, 'prod');
		const c = render(BlockedActions, { props: { state: v.slot, ask, gatesHref: '/x/gates' } }).container;
		return { v, c };
	};
	test('a target says "Needs your approval in prod" and carries Approve', () => {
		const { v, c } = banner(target());
		expect(v.headline).toBe('Needs your approval in prod');
		expect(c.querySelectorAll('[data-approve-open]')).toHaveLength(1);
		expect(c.querySelector('[data-approve-slot]')).toBeNull();
	});
	test('loading is neutral and reserves 104x32 (h-8 w-[104px])', () => {
		const { v, c } = banner(ASK_LOADING);
		expect(v.headline).toBe('Waiting for approval in prod');
		expect(c.querySelector('[data-approve-open]')).toBeNull();
		const slot = c.querySelectorAll('[data-approve-slot]');
		expect(slot).toHaveLength(1);
		expect(slot[0]).toHaveClass('h-8', 'w-[104px]');
	});
	test("null keeps today's words, no Approve, no reserve", () => {
		const { v, c } = banner(null);
		expect(v.headline).toBe(headline);
		expect(c.querySelector('[data-approve-open]')).toBeNull();
		expect(c.querySelector('[data-approve-slot]')).toBeNull();
	});
});
