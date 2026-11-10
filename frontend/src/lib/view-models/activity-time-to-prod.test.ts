import { describe, it, expect } from 'vitest';
import { medianTimeToProdMs } from './activity-time-to-prod';

describe('medianTimeToProdMs', () => {
	it('returns null with no entries', () => {
		expect(medianTimeToProdMs([])).toBeNull();
	});

	it('never returns 0 — a release whose first deploy IS its prod deploy is excluded, not counted as 0', () => {
		const entries = [{ releaseKey: 'a::v1', timestampMs: 1000, isProd: true }];
		expect(medianTimeToProdMs(entries)).toBeNull();
	});

	it('computes the gap for a release that reached prod after starting elsewhere', () => {
		const entries = [
			{ releaseKey: 'a::v1', timestampMs: 0, isProd: false },
			{ releaseKey: 'a::v1', timestampMs: 1000, isProd: true }
		];
		expect(medianTimeToProdMs(entries)).toBe(1000);
	});

	it('takes the median across multiple releases, excluding zero-gap ones', () => {
		const entries = [
			{ releaseKey: 'a::v1', timestampMs: 0, isProd: false },
			{ releaseKey: 'a::v1', timestampMs: 1000, isProd: true },
			{ releaseKey: 'b::v1', timestampMs: 0, isProd: false },
			{ releaseKey: 'b::v1', timestampMs: 3000, isProd: true },
			// A release that only ever shows up already in prod — excluded.
			{ releaseKey: 'c::v1', timestampMs: 500, isProd: true }
		];
		expect(medianTimeToProdMs(entries)).toBe(2000);
	});

	it('uses the EARLIEST deploy anywhere and the EARLIEST prod deploy, not the latest', () => {
		const entries = [
			{ releaseKey: 'a::v1', timestampMs: 500, isProd: false },
			{ releaseKey: 'a::v1', timestampMs: 0, isProd: false },
			{ releaseKey: 'a::v1', timestampMs: 2000, isProd: true },
			{ releaseKey: 'a::v1', timestampMs: 1000, isProd: true }
		];
		expect(medianTimeToProdMs(entries)).toBe(1000);
	});
});
