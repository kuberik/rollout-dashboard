import { describe, it, expect } from 'vitest';
import { leadTime, compactSpan, median, medianBakeSpan, type LeadEnv } from './lead-time';

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

	// ⭐ (2026-09-03, operator-walk finding 18) `status.history[].timestamp` is
	// written the instant a deploy STARTS, not once it settles, so a rollout
	// mid-bake or mid-deploy already has a `history[0]` entry with a real
	// timestamp and no verdict. Measured live: `/apps/hello-world-app`'s
	// `Typical to prod` flipped `11m` → `— no full trip yet` → `11m` across
	// ONE deploy, because the in-flight entry was read as both a possible
	// departure and a possible arrival right alongside the already-completed
	// trip that had earned the `11m` figure.
	describe('an in-flight deploy never removes a completed trip from the sample', () => {
		it('an in-flight deploy in the SOURCE env does not disturb an already-completed trip', () => {
			const vm = leadTime([
				env({
					label: 'dev',
					order: 1,
					deploys: [
						// The completed trip: `a` departed dev, arrived prod 11m later.
						{ version: 'a', ms: 0 },
						// A brand-new build starts deploying to dev — in flight, no
						// verdict yet. It must not touch `a`'s own sample.
						{ version: 'b', ms: 20 * HOUR, inFlight: true }
					]
				}),
				env({
					label: 'prod',
					order: 7,
					prod: true,
					deploys: [{ version: 'a', ms: 11 * MIN }]
				})
			]);
			expect(vm?.samples).toBe(1);
			expect(vm?.medianMs).toBe(11 * MIN);
		});

		it('an in-flight deploy in the TARGET env is not counted as an arrival', () => {
			const vm = leadTime([
				env({
					label: 'dev',
					order: 1,
					deploys: [
						{ version: 'a', ms: 0 },
						{ version: 'b', ms: 5 * HOUR }
					]
				}),
				env({
					label: 'prod',
					order: 7,
					prod: true,
					deploys: [
						// `a`'s completed trip.
						{ version: 'a', ms: 11 * MIN },
						// `b` has started deploying to prod but has not settled —
						// this must not read as "`b` arrived" and must not disturb
						// `a`'s already-completed sample either.
						{ version: 'b', ms: 6 * HOUR, inFlight: true }
					]
				})
			]);
			expect(vm?.samples).toBe(1);
			expect(vm?.medianMs).toBe(11 * MIN);
		});

		it('an app with ONLY an in-flight trip returns null, not a premature number', () => {
			const vm = leadTime([
				env({ label: 'dev', order: 1, deploys: [{ version: 'a', ms: 0 }] }),
				env({
					label: 'prod',
					order: 7,
					prod: true,
					deploys: [{ version: 'a', ms: 11 * MIN, inFlight: true }]
				})
			]);
			expect(vm).toBeNull();
		});
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

describe('median', () => {
	it('returns null for an empty sample, never 0', () => {
		expect(median([])).toBeNull();
	});
	it('is the middle value for an odd-length sample', () => {
		expect(median([5, 1, 3])).toBe(3);
	});
	it('averages the two middle values for an even-length sample', () => {
		expect(median([1, 2, 3, 4])).toBe(3); // (2 + 3) / 2 = 2.5 -> rounds to 3
	});
});

describe('medianBakeSpan', () => {
	it('returns null when no rollout has both a start and an end', () => {
		expect(
			medianBakeSpan([
				{ status: { history: [{ bakeStartTime: '2026-01-01T00:00:00Z' }] } }
			])
		).toBeNull();
	});
	it('excludes a still-baking window (no bakeEndTime) rather than clamping to now', () => {
		const ms = medianBakeSpan([
			{
				status: {
					history: [
						{
							bakeStartTime: '2026-01-01T00:00:00Z',
							bakeEndTime: '2026-01-01T00:05:00Z'
						},
						{ bakeStartTime: '2026-01-02T00:00:00Z' }
					]
				}
			}
		]);
		expect(ms).toBe(5 * MIN);
	});
	it('is the median span across every rollout passed in, not per-rollout', () => {
		const ms = medianBakeSpan([
			{
				status: {
					history: [
						{ bakeStartTime: '2026-01-01T00:00:00Z', bakeEndTime: '2026-01-01T00:01:00Z' }
					]
				}
			},
			{
				status: {
					history: [
						{ bakeStartTime: '2026-01-01T00:00:00Z', bakeEndTime: '2026-01-01T00:03:00Z' },
						{ bakeStartTime: '2026-01-01T00:00:00Z', bakeEndTime: '2026-01-01T00:05:00Z' }
					]
				}
			}
		]);
		expect(ms).toBe(3 * MIN);
	});
});
