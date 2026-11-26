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

/*
 * TAKE B: the per-region Held links sentences the old version pinned are gone by design (owner D4: one fact per relationship,
 * regions folded into one cell). What the page still promises, pinned here:
 *  1. a held cell's range is the Gates tab's range for the same rollout, and a cell whose Gates tab names no range prints none;
 *  2. the banner's named blocker is drawn in the matrix (owner D2), with its "frees N" footer.
 * The matrix measures its own width; jsdom has none, so clientWidth is stubbed to a desktop width.
 */
const cellNeed = (container: HTMLElement, key: string) =>
	/needs (\S+)/.exec(container.querySelector(`[data-cell="${key}"]`)?.textContent ?? '')?.[1] ?? null;

describe('/dependencies agrees with the Gates tab and its own banner', () => {
	test('held cells print the Gates tab range; the banner blocker is drawn', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const r = respondHomeIncident('GET', typeof input === 'string' ? input : input.toString(), fixture, now);
				return new Response(r?.body ?? '{}', { status: r?.status ?? 200 });
			})
		);
		const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
		Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1100 });
		try {
			const { container } = render(WithQueryClient, { props: { component: Dependencies as any } });
			await waitFor(() => expect(container.querySelector('[data-lanes-matrix]')).not.toBeNull(), { timeout: 15000 });

			// 1. prod: every held region's Gates tab asks ~2.9.0 or names none; the folded cell prints the shared one
			const prodRanges = ['checkout-api-prod-ap-southeast-2', 'checkout-api-prod-us-east-2'].map((ns) => rangeOf(gatesTabCause(ns)));
			expect(prodRanges).toEqual(['~2.9.0', '~2.9.0']);
			expect(cellNeed(container, 'checkout-api|prod')).toBe('~2.9.0');
			// staging: the Gates tab names "a newer payments" and no range, so the cell names none either
			expect(rangeOf(gatesTabCause('checkout-api-staging'))).toBeNull();
			expect(cellNeed(container, 'checkout-api|staging')).toBe('payments');

			// 2. the banner names the top blocker; that blocker's cell is in the matrix with its frees footer
			const banner = container.textContent ?? '';
			const m = /(\S+) in (\S+) frees the most: (\d+) rollouts?/.exec(banner);
			expect(m).not.toBeNull();
			const [, name, col, n] = m!;
			const cell = container.querySelector(`[data-cell="${name}|${col}"]`);
			expect(cell).not.toBeNull();
			expect(cell!.querySelector('[data-frees]')?.textContent).toMatch(new RegExp(`frees ${n}\\b`));
		} finally {
			if (desc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', desc);
		}
	}, 30000);
});
