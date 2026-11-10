import { describe, it, expect } from 'vitest';
import { reachedProdTimestamps } from './reached-prod';

describe('reachedProdTimestamps', () => {
	it('returns nothing for entries that never reach prod', () => {
		const entries = [
			{ releaseKey: 'checkout-edge::1.0.0', timestampMs: 100, isProd: false },
			{ releaseKey: 'checkout-edge::1.0.0', timestampMs: 200, isProd: false }
		];
		expect(reachedProdTimestamps(entries)).toEqual([]);
	});

	it('takes the EARLIEST prod deploy per release, not every prod deploy', () => {
		// Same release promoted to two prod regions — only the first counts
		// as "reached prod"; the second region landing later is the same
		// release still carrying the same new-to-prod fact.
		const entries = [
			{ releaseKey: 'checkout-edge::1.0.0', timestampMs: 500, isProd: true }, // prod-us
			{ releaseKey: 'checkout-edge::1.0.0', timestampMs: 300, isProd: true }, // prod-eu, earlier
			{ releaseKey: 'checkout-edge::1.0.0', timestampMs: 100, isProd: false } // dev, before either
		];
		expect(reachedProdTimestamps(entries)).toEqual([300]);
	});

	it('a redeploy of a release already in prod does not add a second timestamp', () => {
		const entries = [
			{ releaseKey: 'checkout-edge::1.0.0', timestampMs: 300, isProd: true },
			{ releaseKey: 'checkout-edge::1.0.0', timestampMs: 900, isProd: true } // same region, redeployed
		];
		expect(reachedProdTimestamps(entries)).toEqual([300]);
	});

	it('one timestamp per distinct release', () => {
		const entries = [
			{ releaseKey: 'checkout-edge::1.0.0', timestampMs: 300, isProd: true },
			{ releaseKey: 'orders-api::2.0.0', timestampMs: 700, isProd: true }
		];
		expect(reachedProdTimestamps(entries).sort((a, b) => a - b)).toEqual([300, 700]);
	});

	it('empty input yields no timestamps', () => {
		expect(reachedProdTimestamps([])).toEqual([]);
	});
});
