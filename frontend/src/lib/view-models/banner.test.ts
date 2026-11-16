import { describe, expect, it } from 'vitest';
import { failedBannerTitle } from './banner';

describe('failedBannerTitle', () => {
	it('names the app, the tier and, when given, the place', () => {
		expect(failedBannerTitle('checkout-api', 'prod', 'eu-west-2')).toBe('checkout-api failed in prod · eu-west-2');
		expect(failedBannerTitle('checkout-api', 'staging')).toBe('checkout-api failed in staging');
		expect(failedBannerTitle('checkout-api', 'staging', '')).toBe('checkout-api failed in staging');
	});
});

describe('failedBannerTitle, failing now', () => {
	it('says failing while a check is failing now, failed otherwise', () => {
		expect(failedBannerTitle('orders-hub', 'prod', null, true)).toBe('orders-hub failing in prod');
		expect(failedBannerTitle('orders-hub', 'prod', null, false)).toBe('orders-hub failed in prod');
	});
});
