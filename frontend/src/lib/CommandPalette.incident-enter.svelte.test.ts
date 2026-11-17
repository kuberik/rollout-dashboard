/**
 * Enter on the "This rollout" incident row opens the rollout, never the row's action (the action, here "See what's blocking", is its own link).
 * One rollout is made to need a person with nothing failing, so the incident row heads "This rollout".
 */
import { describe, test, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import { goto } from '$app/navigation';
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/state', async () => ({ page: (await import('$lib/testing/reactive-page.svelte')).reactivePage }));
vi.mock('$lib/view-models/fleet-groups', async (orig) => {
	const m = await orig<typeof import('$lib/view-models/fleet-groups')>();
	return { ...m, isNeedsYou: (c: { ns: string; name: string }) => (c.ns === 'orders-api-prod' && c.name === 'orders-api') || m.isNeedsYou(c as never) };
});
import { reactivePage } from '$lib/testing/reactive-page.svelte';

if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
	HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(Element.prototype as any).animate = () => ({ finished: Promise.resolve(), cancel: () => {}, play: () => {}, pause: () => {}, addEventListener: () => {}, removeEventListener: () => {} });
}

import CommandPalette from './CommandPalette.svelte';
import WithQueryClient from './testing/WithQueryClient.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { buildGateContext } from '$lib/view-models/blocking-story';
import type { Rollout, Environment } from '../types';

function props() {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
	return {
		open: true, scope: null,
		rollouts: (l.rollouts?.items ?? []) as Rollout[],
		environments: (l.environments?.items ?? []) as Environment[],
		rolloutDependencies: l.rolloutDependencies?.items ?? [],
		gateContext: buildGateContext({ environments: { items: l.environments.items }, rolloutDependencies: { items: l.rolloutDependencies?.items ?? [] } }),
		localClusterName: 'hub',
		currentNamespace: 'orders-api-prod',
		currentName: 'orders-api'
	};
}
const draw = () => {
	vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200 }))));
	return render(WithQueryClient, { props: { component: CommandPalette as never, props: props() } });
};
afterEach(() => { installLiveSource(null); cleanup(); });

describe('Enter on the incident row of "This rollout"', { timeout: 60_000 }, () => {
	test('opens the rollout, not the row\'s action', async () => {
		reactivePage.url = new URL('http://localhost/rollouts/prod/orders-api-prod/orders-api/history');
		draw();
		const row = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')][0];
		expect(row.getAttribute('aria-label')).toMatch(/orders-api/);
		expect(row.getAttribute('aria-selected')).toBe('true');
		// the row offers its own action; Enter must not be it
		expect(row.parentElement!.textContent).toMatch(/This rollout/);
		expect(row.textContent).toMatch(/See what.s blocking/);
		vi.mocked(goto).mockClear();
		await fireEvent.keyDown(document.body.querySelector<HTMLInputElement>('input')!, { key: 'Enter' });
		expect(goto).toHaveBeenCalledTimes(1);
		expect(String(vi.mocked(goto).mock.calls[0][0])).toMatch(/\/rollouts\/prod\/orders-api-prod\/orders-api$/);
	});
});
