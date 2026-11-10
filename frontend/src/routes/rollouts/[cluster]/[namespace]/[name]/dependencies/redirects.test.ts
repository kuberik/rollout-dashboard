import { describe, expect, test } from 'vitest';

/**
 * This tab was renamed "Dependencies" → "Gates" (2026-10-08). The old
 * address keeps resolving, params and query string intact — see
 * `routes/versions/+page.ts`'s own redirect for the pattern this follows.
 */
function caught(fn: () => unknown): { status: number; location: string } {
	try {
		fn();
	} catch (e) {
		return e as { status: number; location: string };
	}
	throw new Error('load() did not redirect');
}

describe('rollout .../dependencies → .../gates (renamed tab)', () => {
	test('redirects straight to the gates tab, params preserved', async () => {
		const { load } = await import('./+page');
		const result = caught(() =>
			load({
				params: { cluster: 'staging', namespace: 'checkout-api-staging', name: 'checkout-api' },
				url: new URL('https://dashboard.example/rollouts/staging/checkout-api-staging/checkout-api/dependencies')
			} as never)
		);
		expect(result.status).toBe(308);
		expect(result.location).toBe('/rollouts/staging/checkout-api-staging/checkout-api/gates');
	});

	test('preserves the query string', async () => {
		const { load } = await import('./+page');
		const result = caught(() =>
			load({
				params: { cluster: 'prod', namespace: 'payments-prod', name: 'payments-svc' },
				url: new URL(
					'https://dashboard.example/rollouts/prod/payments-prod/payments-svc/dependencies?deploy=abc123def456'
				)
			} as never)
		);
		expect(result.status).toBe(308);
		expect(result.location).toBe(
			'/rollouts/prod/payments-prod/payments-svc/gates?deploy=abc123def456'
		);
	});

	test('encodes params that need it', async () => {
		const { load } = await import('./+page');
		const result = caught(() =>
			load({
				params: { cluster: 'local/hub', namespace: 'ns', name: 'name' },
				url: new URL('https://dashboard.example/rollouts/local%2Fhub/ns/name/dependencies')
			} as never)
		);
		expect(result.status).toBe(308);
		expect(result.location).toBe('/rollouts/local%2Fhub/ns/name/gates');
	});
});
