/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	(Element.prototype as any).animate = () => ({ finished: Promise.resolve(), cancel: () => {}, play: () => {}, pause: () => {}, addEventListener: () => {}, removeEventListener: () => {} });
}

/**
 * The Overview names the place of a rollout whose label says only `prod` by the Environment's SITE ("prod · eu-west"), at both places it
 * mounts a confirm: the failure panel's Roll back, and the page's own Change version flow (the palette's `?action=rollback`).
 */
const state = vi.hoisted(() => ({
	page: { params: {} as Record<string, string>, url: new URL('http://localhost/rollouts/rollout-a/alpha-dev/alpha-app'), route: { id: null as string | null }, status: 200, error: null, data: {}, form: null }
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), pushState: vi.fn(), replaceState: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import RolloutDetail from './+page.svelte';
import { fleet, respond } from '../../../../../lib/messages/fleet-fixture';

afterEach(() => vi.unstubAllGlobals());
const ROLLOUT_DETAIL_URL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;

/** the rollout is labelled plain `prod`; its Environment sits in the eu-west site; `failed` makes the head build Failed */
function detailFetch(failed: boolean) {
	const payload = fleet(() => ({ at: 2, cameFrom: 1, hold: 'none' }));
	const one = JSON.parse(JSON.stringify(payload.rollouts.items[0]));
	const env = JSON.parse(JSON.stringify(payload.environments.items[0]));
	one.metadata.labels = { ...(one.metadata.labels ?? {}), environment: 'prod' };
	env.spec = { ...(env.spec ?? {}), environment: 'prod', site: 'eu-west' };
	if (failed) one.status.history[0].bakeStatus = 'Failed';
	const list = respond(payload) as any;
	return async (input: any) => {
		const url = String(typeof input === 'string' ? input : (input?.url ?? input));
		if (url.includes('/permissions/')) {
			return new Response(JSON.stringify({ permissions: { update: true, patch: true, approve: true }, resource: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}
		if (ROLLOUT_DETAIL_URL.test(url)) {
			return new Response(JSON.stringify({ rollout: one, environment: env, rolloutGates: { items: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}
		return list(input);
	};
}
const mount = (search: string, failed: boolean) => {
	state.page.params = { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' };
	state.page.url = new URL(`http://localhost/rollouts/rollout-a/alpha-dev/alpha-app${search}`);
	vi.stubGlobal('fetch', vi.fn(detailFetch(failed)));
	render(WithQueryClient, { props: { component: RolloutDetail as any } });
};
const dialogText = () => document.querySelector('dialog[open]')?.textContent ?? '';

describe('the Overview names the Environment\'s site in its confirms', { timeout: 30_000 }, () => {
	test('the page\'s Change version flow (?action=rollback): "Roll back prod · eu-west to …"', async () => {
		mount('?action=rollback', false);
		await waitFor(() => expect(dialogText()).toMatch(/Roll back prod · eu-west to /), { timeout: 8000 });
	});
	test('the failure panel\'s Roll back names it too', async () => {
		mount('', true);
		const btn = await waitFor(() => { const b = document.querySelector<HTMLButtonElement>('#failure-rollback-btn'); if (!b || b.disabled) throw new Error('no enabled Roll back yet'); return b; }, { timeout: 8000 });
		await fireEvent.click(btn);
		// a failed head: the recovery warning comes first, then the picker
		const cont = await screen.findByRole('button', { name: 'Continue' }, { timeout: 8000 });
		await fireEvent.click(cont);
		await waitFor(() => expect(dialogText()).toMatch(/Roll back prod · eu-west to /), { timeout: 8000 });
		expect(screen.queryByText(/Roll back prod to /)).toBeNull();
	});
});
