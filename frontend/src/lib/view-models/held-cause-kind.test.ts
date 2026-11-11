import { describe, expect, it } from 'vitest';
import { verdictForGates } from './held';
import type { ClassifiedGate } from './blocking-story';

const g = (o: Partial<ClassifiedGate>): ClassifiedGate => ({ id: 'x', label: 'x', kind: 'check', clears: 'check', ...o }) as ClassifiedGate;
const approval = g({ id: 'appr', kind: 'approval', clears: 'person' });
const check = g({ id: 'smoke', kind: 'check', clears: 'check' });
const window = g({ id: 'win', kind: 'schedule', clears: 'clock' });
const order = g({ id: 'ord', kind: 'promotion', clears: 'upstream', subjectKind: 'environment', subject: 'prod-eu' });

describe('the primary cause classifies a gate by its backend kind (F2)', () => {
	it('a schedule-kind gate with a cold join (kind unresolved, clears check) plus an approval is a window, not a check', () => {
		const cold = g({ id: 'sched', kind: 'check', clears: 'check', backendKind: 'schedule' });
		const v = verdictForGates([approval, cold], 'prod-us');
		expect(v.cause).toBe('clock');
		expect(v.alsoHold?.kind).toBe('window');
	});
	it('the same gate with the join loaded reads the same cause', () => {
		expect(verdictForGates([approval, g({ id: 'sched', kind: 'schedule', clears: 'clock', backendKind: 'schedule' })], 'prod-us').cause).toBe('clock');
	});
});

describe('a persistent check outranks a window or an order hold in the cause (F3, kills the window-before-check mutation)', () => {
	it('check + window: the check is the cause', () => { expect(verdictForGates([check, window], 'prod-us').cause).toBe('check'); });
	it('check + order: the check is the cause', () => { expect(verdictForGates([check, order], 'prod-us').cause).toBe('check'); });
	it('check + window + approval: still the check', () => { expect(verdictForGates([approval, check, window], 'prod-us').cause).toBe('check'); });
});
