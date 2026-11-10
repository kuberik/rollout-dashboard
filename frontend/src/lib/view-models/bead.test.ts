import { describe, expect, it } from 'vitest';
import { beadOf, beadsFor, type BeadChange } from './bead';

const c = (ref: string, state: BeadChange['state'], key?: string): BeadChange => ({ ref, state, key });

describe('beads', () => {
	it('prints two refs for a group of two, "ref +N" beyond', () => {
		expect(beadOf([c('#1', 'deploying'), c('#2', 'deploying')])).toMatchObject({ refs: ['#1', '#2'], more: 0 });
		expect(beadOf([c('#1', 'deploying'), c('#2', 'deploying'), c('#3', 'deploying')])).toMatchObject({ refs: ['#1'], more: 2 });
	});
	it('compact replaces the refs of a group with its count', () => {
		expect(beadOf([c('#1', 'held'), c('#2', 'held')], { compact: true })).toMatchObject({ refs: [], count: 2 });
		expect(beadOf([c('#1', 'held')], { compact: true })).toMatchObject({ refs: ['#1'], count: null });
	});
	it('keeps a failing change and one waiting for you alone, merges the rest by state, worst first', () => {
		const bs = beadsFor([c('#5', 'deploying'), c('#4', 'failed'), c('#6', 'deploying'), c('#7', 'approval-yours'), c('#8', 'failed')]);
		expect(bs.map((b) => b.state + ':' + b.refs.join(','))).toEqual(['failed:#4', 'failed:#8', 'approval-yours:#7', 'deploying:#5,#6']);
		expect(bs[0].emphasis).toBe('failed');
		expect(bs[2].emphasis).toBe('yours');
	});
	it('team views merge everything by state and carry no personal emphasis', () => {
		const bs = beadsFor([c('#4', 'failed'), c('#8', 'failed')], { team: true });
		expect(bs).toHaveLength(1);
		expect(bs[0].emphasis).toBe('');
	});
});
