import { describe, test, expect } from 'vitest';
import { recoveryModeReason, flowHealthChecksFor } from './change-version-entry';

const withBake = (bakeStatus?: string) =>
	({ status: { history: [{ version: { tag: '1' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus }] } }) as never;

describe('recoveryModeReason predicts the controller (any bakeStatus other than Succeeded)', () => {
	test.each(['Failed', 'InProgress', 'Cancelled', 'Deploying'])('%s on the running entry is previous-failed', (b) => {
		expect(recoveryModeReason(withBake(b), [])).toBe('previous-failed');
	});
	test.each([undefined, 'Succeeded'])('%s is not a trigger', (b) => {
		expect(recoveryModeReason(withBake(b), [])).toBeNull();
	});
	test('unknown checks never read as none', () => {
		expect(recoveryModeReason(withBake('Succeeded'), null)).toBe('health-checks-unavailable');
	});
});

describe('flowHealthChecksFor: what a page hands the flow', () => {
	const sel = { hasSelector: true };
	test('failed load is null, loading is undefined, loaded is the list', () => {
		expect(flowHealthChecksFor({ ...sel, isSuccess: false, isError: true }, [])).toBeNull();
		expect(flowHealthChecksFor({ ...sel, isSuccess: false, isError: false }, [])).toBeUndefined();
		expect(flowHealthChecksFor({ ...sel, isSuccess: true, isError: false }, [])).toEqual([]);
	});
	test('no selector: there is nothing to load', () => {
		expect(flowHealthChecksFor({ hasSelector: false, isSuccess: false, isError: false }, [])).toEqual([]);
	});
});
