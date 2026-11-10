import { describe, test, expect } from 'vitest';
import { recoveryModeReason, flowHealthChecksFor } from './change-version-entry';

const withBake = (bakeStatus?: string) =>
	({ status: { history: [{ version: { tag: '1' }, timestamp: '2026-11-10T10:00:00Z', bakeStatus }] } }) as never;

describe('recoveryModeReason predicts the controller (any bakeStatus other than Succeeded) with an honest reason', () => {
	// rollout_controller.go:1188-1189 triggers on every status but Succeeded; the
	// WORDING differs: only Failed failed (api/v1alpha1/rollout_types.go:423-427).
	test.each([
		['Failed', 'previous-failed'],
		['Cancelled', 'previous-cancelled'],
		['InProgress', 'previous-unfinished'],
		['Deploying', 'previous-unfinished']
	])('%s on the running entry is %s', (b, reason) => {
		expect(recoveryModeReason(withBake(b), [])).toBe(reason);
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
