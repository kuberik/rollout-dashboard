import { describe, it, expect } from 'vitest';
import { groupByState, attentionRollup } from './apps-page';

const a = (app: string, group = 'quiet') => ({ app, group });
describe('groupByState', () => {
	it('splits the unclaimed apps into In flight (moving) and At rest, keeping the caller order', () => {
		const { inFlight, atRest } = groupByState([a('x1'), a('x2', 'moving'), a('solo'), a('y1', 'waiting'), a('z', 'moving')]);
		expect(inFlight.map((t) => t.app)).toEqual(['x2', 'z']);
		expect(atRest.map((t) => t.app)).toEqual(['x1', 'solo', 'y1']);
	});
});
describe('attentionRollup', () => {
	it('prints only what is non-zero, adverse parts inked', () => {
		expect(attentionRollup({ failing: 3, approval: 3, yours: 1 })).toEqual([{ text: '3 failing', ink: 'danger' }, { text: '3 need approval', ink: 'held' }, { text: '1 yours' }]);
		expect(attentionRollup({ failing: 0, approval: 1, yours: 0 })).toEqual([{ text: '1 needs approval', ink: 'held' }]);
	});
});
