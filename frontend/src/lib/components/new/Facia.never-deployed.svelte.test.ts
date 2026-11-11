import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import Facia from './Facia.svelte';
import { laneOf } from './Footprint.svelte';
import { apps } from './data';

/* NodeState 'none' means two things: a place with no releases (flagged noReleases, at rest) and a never-deployed place (no flag, NOT at rest).
   A running tile must not call a never-deployed place healthy. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const mount = (flag: boolean) => {
	const m = apps('incident');
	const base = m.items.find((a) => a.app === 'payments-core')!;
	const item = {
		...base,
		group: 'steady',
		approval: null,
		row: null,
		fact: 'b17 in dev',
		noReleases: undefined
	} as never;
	const { lane, last } = laneOf(item, m.R.c.m as never, m.R.c.events as never);
	const target = lane.stages[0];
	const fix = (n: any) =>
		n === target
			? { ...n, state: 'none', ...(flag ? { noReleases: true } : {}) }
			: { ...n, state: 'newest', behind: 0 };
	const byTier: any = {};
	for (const [t, ns] of Object.entries(lane.byTier)) byTier[t] = (ns as any[]).map(fix);
	const l2 = { ...lane, byTier, stages: lane.stages.map(fix), prod: lane.prod.map(fix) };
	const c = render(Facia, {
		props: { item, lane: l2, approvals: m.R.rows, scenario: 'incident', last, recent: [] } as never
	}).container;
	return c.textContent?.replace(/\s+/g, ' ') ?? '';
};
describe('Facia: a never-deployed place is not at rest', () => {
	it('a pending none node (no flag) does not make the tile "All healthy"', () => {
		expect(mount(false)).not.toMatch(/All healthy/);
	});
	it('a no-release none node (flagged) still rests', () => {
		expect(mount(true)).toMatch(/All healthy/);
	});
});
