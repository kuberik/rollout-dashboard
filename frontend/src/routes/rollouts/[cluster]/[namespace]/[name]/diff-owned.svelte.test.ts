/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';

const st = vi.hoisted(() => ({ page: { params: {} as Record<string, string>, url: new URL('http://localhost/x'), route: { id: null as string | null }, status: 200, error: null, data: {}, form: null } }));
vi.mock('$app/state', () => st);
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), pushState: vi.fn(), replaceState: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Diff from './diff/[version]/+page.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';

beforeAll(() => install(true));
afterEach(() => { vi.unstubAllGlobals(); owned = false; });

const call = (input: any, init?: any) => {
	const url = String(typeof input === 'string' ? input : (input?.url ?? input));
	return respond((init?.method ?? 'GET') as string, url.replace(/^https?:\/\/[^/]+/, ''));
};
const rolloutOf = (app: string) => JSON.parse(call(`/api/rollouts/${app}-prod-default/${app}?cluster=prod`).body ?? '{}').rollout;

let owned = false;
function open(Page: any, app: string, tail: string, version?: string) {
	resetDemoState('calm');
	const ns = `${app}-prod-default`;
	const params: Record<string, string> = { cluster: 'prod', namespace: ns, name: app, ...(version ? { version } : {}) };
	const url = new URL(`http://localhost/rollouts/prod/${ns}/${app}/${tail}`);
	st.page.params = params;
	st.page.url = url;
	vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
		const r = call(input, init);
		let body = r.body ?? '';
		if (owned && /\/rollouts\/[^/]+\/[^/?]+(\?|$)/.test(String(input))) {
			const j = JSON.parse(body);
			if (j.rollout) {
				j.rollout.metadata.managedFields = [{ manager: 'flux-controller', operation: 'Apply', fieldsV1: { 'f:spec': { 'f:wantedVersion': {} } } }];
				j.rollout.spec = { ...(j.rollout.spec ?? {}), wantedVersion: 'pinned' };
				body = JSON.stringify(j);
			}
		}
		return new Response(body, { status: r.status, headers: r.headers });
	}));
	document.body.innerHTML = '';
	render(WithQueryClient, { props: { component: Page } });
}


const head = (app: string) => (resetDemoState('calm'), rolloutOf(app).status.history[0].version.tag as string);
const reason = "Another controller owns this rollout's wanted version, so the dashboard cannot pin it.";
const rollbacks = () => [...document.querySelectorAll<HTMLElement>('[data-desktop-only], [data-phone-only], [data-phone-end]')].filter((e) => /Roll back/.test(e.textContent ?? ''));

/** The diff page's own Roll back follows the ownership rule of every other entry point: disabled, with the reason, when another controller owns the wanted version. */
describe('diff page: Roll back on an owned rollout', { timeout: 40_000 }, () => {
	test('owned elsewhere: every Roll back is a disabled button that carries the reason', async () => {
		owned = true;
		open(Diff, 'orders-hub', `diff/${head('orders-hub')}`, head('orders-hub'));
		await waitFor(() => expect(rollbacks().length).toBeGreaterThan(0), { timeout: 20_000 });
		for (const b of rollbacks()) {
			expect(b.tagName).toBe('BUTTON');
			expect((b as HTMLButtonElement).disabled).toBe(true);
			expect(b.getAttribute('title')).toBe(reason);
			expect(b.getAttribute('aria-describedby')).toBe('owned-reason');
			expect(b.getAttribute('href')).toBeNull();
		}
	});
	test('owned by the dashboard: Roll back is a link to History', async () => {
		owned = false;
		open(Diff, 'orders-hub', `diff/${head('orders-hub')}`, head('orders-hub'));
		await waitFor(() => expect(rollbacks().length).toBeGreaterThan(0), { timeout: 20_000 });
		for (const b of rollbacks()) {
			expect(b.tagName).toBe('A');
			expect(b.getAttribute('href')).toMatch(/action=rollback/);
		}
	});
});
