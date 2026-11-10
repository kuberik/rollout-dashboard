/**
 * /dependencies prints the range the Gates tab names for each held checkout-api
 * edge (home-incident). A graph edge drops its range when the held builds ask
 * for different ones; the page reads the per-build contract hold instead.
 *//* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * /dependencies names the Gates tab's cause per environment (home-incident).
 * The staging row reads the staging hold; no row reads another environment's
 * clause for its own.
 */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';

const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/dependencies'),
		route: { id: '/dependencies' as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Dependencies from './+page.svelte';
import { respondHomeIncident } from '$lib/demo/home-incident';
import { fixture, now, gatesTabCause } from '$lib/view-models/gates-tab-reference.testkit';

afterEach(() => vi.unstubAllGlobals());

const rangeOf = (cause: string) => /until it ships (\S+)/.exec(cause)?.[1] ?? null;

describe('/dependencies held links read the Gates tab', () => {
	test('prod-ap-southeast-2 and prod-us-east-2 print ~2.9.0; staging prints no range', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const r = respondHomeIncident('GET', typeof input === 'string' ? input : input.toString(), fixture, now);
				return new Response(r?.body ?? '{}', { status: r?.status ?? 200 });
			})
		);
		const { container } = render(WithQueryClient, { props: { component: Dependencies as any } });
		await waitFor(() => expect(container.textContent ?? '').toMatch(/Its next release needs/), {
			timeout: 15000
		});
		const sentences = [...container.querySelectorAll('p')]
			.map((p) => p.textContent ?? '')
			.filter((t) => t.startsWith('Its next release needs payments'));
		for (const ns of ['checkout-api-prod-ap-southeast-2', 'checkout-api-prod-us-east-2']) {
			const range = rangeOf(gatesTabCause(ns));
			expect(range).toBe('~2.9.0');
			expect(sentences.some((t) => t.startsWith(`Its next release needs payments ${range}.`))).toBe(true);
		}
		// Staging's Gates tab names "a newer payments" and no range: the page adds none.
		expect(rangeOf(gatesTabCause('checkout-api-staging'))).toBeNull();
		expect(sentences.some((t) => t.startsWith('Its next release needs payments.'))).toBe(true);
	}, 30000);
});
