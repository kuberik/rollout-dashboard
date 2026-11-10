import { describe, it, expect } from 'vitest';
import { attentionModel, failingLead, approvalLead, drawable, num } from './attention';
import { regionStates, rollouts } from '$lib/components/new/data';
import type { HealthObservation } from '../../types';

const check = { name: 'invoice-api-error-rate', message: 'error rate 8.2% over a 1% budget' };
const thr: HealthObservation = { name: 'error rate', kind: 'Threshold', value: '8.20', limit: '1', direction: 'Above', unit: '%' };

describe('attention lead: failing asks', () => {
	it('Threshold -> figure + unit + budget + gauge', () => {
		const l = failingLead(check, [thr]);
		expect(l).toMatchObject({ kind: 'threshold', value: '8.2', unit: '%', label: 'error rate', budget: 'over a 1% budget' });
		expect((l as { gauge: { fill: number; over: boolean } }).gauge).toMatchObject({ fill: 1, over: true });
	});
	it('a non-% unit gets a space; Below says floor', () => {
		const l = drawable({ name: 'rps', kind: 'Threshold', value: '40', limit: '100', direction: 'Below', unit: 'req/s' });
		expect(l?.budget).toBe('under a 100 req/s floor');
		expect(l?.gauge).toMatchObject({ over: true });
	});
	it('Ratio -> "N of M" + name; Count -> number + name', () => {
		expect(failingLead(null, [{ name: 'checks failed', kind: 'Ratio', value: '3', total: '41' }])).toMatchObject({ kind: 'ratio', value: '3', unit: 'of 41', label: 'checks failed' });
		expect(failingLead(null, [{ name: 'pods not ready', kind: 'Count', value: '3' }])).toMatchObject({ kind: 'count', value: '3', label: 'pods not ready' });
	});
	it('State, absent list, missing limit/direction/total -> the check name + message', () => {
		for (const obs of [undefined, [], [{ name: 'phase', kind: 'State', value: 'Degraded' }], [{ name: 'e', kind: 'Threshold', value: '8' }], [{ name: 'e', kind: 'Threshold', value: '8', limit: '1' }], [{ name: 'r', kind: 'Ratio', value: '3' }]] as (HealthObservation[] | undefined)[])
			expect(failingLead(check, obs)).toEqual({ kind: 'check', name: check.name, message: check.message });
	});
	it('the first NOT-healthy drawable observation leads; a healthy one never does', () => {
		const ok: HealthObservation = { name: 'p99', kind: 'Threshold', value: '90', limit: '500', direction: 'Above', unit: 'ms', healthy: true };
		expect(failingLead(check, [ok, thr])).toMatchObject({ label: 'error rate' });
		expect(failingLead(check, [ok]).kind).toBe('check');
	});
	it('decimals are trimmed', () => { expect(num('8.200')).toBe('8.2'); expect(num('12')).toBe('12'); });
});

describe('attention model', () => {
	it('threshold card: figure-led, fact = check name + the budget', () => {
		const m = attentionModel({ state: 'failed', age: '9h', tier: 'prod', place: 'eu-west', check, observations: [thr] });
		expect(m.figure?.kind).toBe('threshold');
		expect(m.word).toBe('Failing');
		expect(m.forAge).toBe('for 9h');
		expect(m.fact).toEqual({ name: 'invoice-api-error-rate', message: 'over a 1% budget' });
	});
	it('fallback card: title-led, fact = check name + message', () => {
		const m = attentionModel({ state: 'failed', check, title: 'Retry webhook delivery' });
		expect(m.figure).toBeNull();
		expect(m.fact).toEqual({ name: check.name, message: check.message });
	});
	it('approval: ratio from regions, one region has none', () => {
		const ink = (xs: string[]) => xs.map((i) => ({ ink: i }));
		expect(approvalLead(ink(['healthy', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']))).toMatchObject({ value: '5', unit: 'of 6', label: 'prod regions' });
		expect(approvalLead(ink(['waiting']))).toBeNull();
		expect(attentionModel({ state: 'approval', age: '15m', regions: ink(['waiting', 'waiting']), gateSentence: 'Releases when someone approves' }).word).toBe('Needs your approval');
	});
});
