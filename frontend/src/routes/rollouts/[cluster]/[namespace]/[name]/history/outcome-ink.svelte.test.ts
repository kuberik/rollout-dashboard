/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';

/**
 * A History row's outcome word ("Failed after 10m of checks") follows the health rule: a check failing now reads in danger ink, the head
 * deploy whose checks are all OK again reads neutral. Renders the real page on the health-failures demo: catalog-api (failed, its check
 * recovered) and orders-hub (failed, checks still failing).
 */
const store = vi.hoisted(() => ({ value: null as any }));
vi.mock('$app/stores', async () => {
	const { writable } = await import('svelte/store');
	const page = writable({
		params: { cluster: 'prod', namespace: 'catalog-api-prod-default', name: 'catalog-api' },
		url: new URL('http://localhost/rollouts/prod/catalog-api-prod-default/catalog-api/history'),
		route: { id: null },
		status: 200,
		error: null,
		data: {},
		form: null,
		state: {}
	});
	store.value = page;
	return { page, navigating: writable(null), updated: { subscribe: writable(false).subscribe, check: async () => false } };
});
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import History from './+page.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';

beforeAll(() => install(true));
afterEach(() => vi.unstubAllGlobals());

function open(app: string) {
	resetDemoState('calm');
	const ns = `${app}-prod-default`;
	store.value.update((p: any) => ({
		...p,
		params: { cluster: 'prod', namespace: ns, name: app },
		url: new URL(`http://localhost/rollouts/prod/${ns}/${app}/history`)
	}));
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: any, init?: any) => {
			const url = String(typeof input === 'string' ? input : (input?.url ?? input));
			const r = respond((init?.method ?? 'GET') as string, url.replace(/^https?:\/\/[^/]+/, ''));
			return new Response(r.body ?? '', { status: r.status, headers: r.headers });
		})
	);
	render(WithQueryClient, { props: { component: History as any } });
}

/** the head row's outcome word, once the live checks have answered (the header's own failing/failed word appears with them) */
async function headOutcome(): Promise<HTMLElement> {
	let el: HTMLElement | null = null;
	await waitFor(
		() => {
			el = document.querySelector('[data-outcome-word]');
			expect(el?.textContent).toBe('Failed');
		},
		{ timeout: 10_000 }
	);
	return el!;
}

describe('History: the outcome word follows failing vs failed', { timeout: 30_000 }, () => {
	test('a recovered head deploy reads Failed in neutral ink', async () => {
		open('catalog-api');
		const el = await headOutcome();
		await waitFor(() => expect(el.className).toContain('text-fg-muted'), { timeout: 10_000 });
		expect(el.className).not.toContain('text-danger');
	});
	test('a head deploy whose check is failing now keeps danger ink', async () => {
		open('orders-hub');
		const el = await headOutcome();
		await new Promise((r) => setTimeout(r, 1000));
		expect(el.className).toContain('text-danger');
	});
});
