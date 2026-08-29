import { describe, it, expect } from 'vitest';
import { leadTime, compactSpan, type LeadEnv } from './lead-time';

const MIN = 60_000;
const HOUR = 60 * MIN;

function env(p: Partial<LeadEnv> & { label: string; order: number }): LeadEnv {
	return { prod: false, deploys: [], ...p };
}

/**
 * The four ways a lead time can be a lie:
 *   1. averaging instead of taking the median, so one parked build owns it
 *   2. measuring to the LAST production region instead of the first arrival
 *   3. returning a number when nothing was observed
 *   4. counting a negative hop as a fast one
 */
describe('leadTime', () => {
	it('is the MEDIAN of observed first-env → first-prod-arrival hops', () => {
		const vm = leadTime([
			env({
				label: 'dev',
				order: 1,
				deploys: [
					{ version: 'a', ms: 0 },
					{ version: 'b', ms: 10 * HOUR },
					{ version: 'c', ms: 20 * HOUR }
				]
			}),
			env({
				label: 'prod',
				order: 7,
				prod: true,
				deploys: [
					{ version: 'a', ms: 1 * HOUR },
					{ version: 'b', ms: 12 * HOUR },
					// 100 hours — the outlier a mean would let own the answer
					{ version: 'c', ms: 120 * HOUR }
				]
			})
		]);
		expect(vm?.samples).toBe(3);
		expect(vm?.medianMs).toBe(2 * HOUR);
		expect(vm?.fromLabel).toBe('dev');
		expect(vm?.toLabel).toBe('prod');
	});

	it('measures to the FIRST production region, because prod is a SET', () => {
		const vm = leadTime([
			env({ label: 'dev', order: 1, deploys: [{ version: 'a', ms: 0 }] }),
			env({ label: 'us-east', order: 7, prod: true, deploys: [{ version: 'a', ms: 3 * HOUR }] }),
			env({ label: 'ap-south', order: 7, prod: true, deploys: [{ version: 'a', ms: 40 * HOUR }] })
		]);
		expect(vm?.medianMs).toBe(3 * HOUR);
		expect(vm?.toLabel).toBe('prod');
	});

	it('uses the last step on the LINE when the app has no production tier', () => {
		const vm = leadTime([
			env({ label: 'dev', order: 1, deploys: [{ version: 'a', ms: 0 }] }),
			env({ label: 'staging', order: 5, deploys: [{ version: 'a', ms: 90 * MIN }] })
		]);
		expect(vm?.medianMs).toBe(90 * MIN);
		expect(vm?.toLabel).toBe('staging');
	});

	it('returns null rather than a number when no build made the whole trip', () => {
		expect(
			leadTime([
				env({ label: 'dev', order: 1, deploys: [{ version: 'new', ms: 0 }] }),
				env({ label: 'prod', order: 7, prod: true, deploys: [{ version: 'old', ms: -HOUR }] })
			])
		).toBeNull();
	});

	it('returns null for a single-environment app — there is no hop to time', () => {
		expect(
			leadTime([env({ label: 'dev', order: 1, deploys: [{ version: 'a', ms: 0 }] })])
		).toBeNull();
	});

	it('drops non-positive hops instead of counting them as instant', () => {
		const vm = leadTime([
			env({
				label: 'dev',
				order: 1,
				deploys: [
					{ version: 'hotfix', ms: 5 * HOUR },
					{ version: 'normal', ms: 0 }
				]
			}),
			env({
				label: 'prod',
				order: 7,
				prod: true,
				deploys: [
					// Applied downstream FIRST — not a lead time for this hop.
					{ version: 'hotfix', ms: 1 * HOUR },
					{ version: 'normal', ms: 4 * HOUR }
				]
			})
		]);
		expect(vm?.samples).toBe(1);
		expect(vm?.medianMs).toBe(4 * HOUR);
	});

	it('takes the EARLIEST deploy of a build in each env — a redeploy is not a second arrival', () => {
		const vm = leadTime([
			env({
				label: 'dev',
				order: 1,
				deploys: [
					{ version: 'a', ms: 8 * HOUR },
					{ version: 'a', ms: 0 }
				]
			}),
			env({
				label: 'prod',
				order: 7,
				prod: true,
				deploys: [
					{ version: 'a', ms: 30 * HOUR },
					{ version: 'a', ms: 2 * HOUR }
				]
			})
		]);
		expect(vm?.medianMs).toBe(2 * HOUR);
	});
});

describe('compactSpan', () => {
	it('uses the same unit boundaries as formatTimeAgoCompact', () => {
		expect(compactSpan(45_000)).toBe('45s');
		expect(compactSpan(45 * MIN)).toBe('45m');
		expect(compactSpan(5 * HOUR)).toBe('5h');
		expect(compactSpan(5 * 24 * HOUR)).toBe('5d');
		expect(compactSpan(120 * 24 * HOUR)).toBe('4mo');
	});
});
