import { describe, it, expect } from 'vitest';
import { slipwayLeadSplit } from './rollout-view';

const approve = { label: 'Approve', key: 'slipway-action' };
describe('slipwayLeadSplit', () => {
	it('Approve is the primary even when the place is not failing', () => {
		const r = slipwayLeadSplit(approve, { failing: false, approve: true });
		expect(r.primary).toBe(approve);
		expect(r.leadSecondary).toEqual([]);
	});
	it('a failing lead is the primary', () => {
		expect(slipwayLeadSplit(approve, { failing: true, approve: false }).primary).toBe(approve);
	});
	it('another lead stays a secondary carrying the phone lead flag', () => {
		const r = slipwayLeadSplit(approve, { failing: false, approve: false });
		expect(r.primary).toBeUndefined();
		expect(r.leadSecondary).toEqual([{ ...approve, lead: true }]);
	});
	it('no lead, nothing', () => {
		expect(slipwayLeadSplit(null, { failing: false, approve: true })).toEqual({ primary: undefined, leadSecondary: [] });
	});
});
