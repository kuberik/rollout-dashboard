import { describe, expect, it } from 'vitest';
import { pinLeadSentence } from './pin-hold';

describe('pinLeadSentence', () => {
	it('a pinned rollout leads with the pin, and never says builds can deploy', () => {
		const lead = pinLeadSentence({
			pinnedTo: 'r1',
			headline: 'checkout-api is pinned to 4.40.0-40',
			consequence: '5 newer builds are available and none of them will deploy while the pin is set.'
		});
		expect(lead?.headline).toBe('checkout-api is pinned to 4.40.0-40');
		expect(lead?.consequence).not.toMatch(/can deploy/);
	});
	it('an unpinned rollout has no pin lead', () => {
		expect(pinLeadSentence({ pinnedTo: null, headline: 'x', consequence: 'y' })).toBeNull();
	});
});
