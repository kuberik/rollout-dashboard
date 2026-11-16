import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import Harness from './AppDetail.retry-harness.svelte';
import { respond } from '../../../demo/respond';
import { resetDemoState } from '../../../demo/state';
import { install } from '../../../demo/health-failures-fixtures';
import { installLiveSource, type FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';

/** Retry on the app page asks exactly as the rollout Overview's failure panel does (view-models/retry-confirm.ts). */
const posts: string[] = [];
const load = () => {
	resetDemoState('calm');
	const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
	const gh = JSON.parse(respond('GET', '/api/github/changes?days=365').body!);
	const hc = JSON.parse(respond('GET', '/api/health-checks').body ?? 'null');
	installLiveSource({ rollouts: l.rollouts.items, environments: l.environments.items, rolloutDependencies: l.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: gh.changes, changesState: 'ok', healthChecks: hc?.rolloutHealthChecks?.items ?? null, github: { configured: true, connected: true, login: 'demo' }, me: 'demo', now: new Date() } as unknown as FleetSource);
};
const mountApp = (app: string) => {
	load();
	vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
		const method = init?.method ?? 'GET';
		if (method === 'POST' && /\/retry$/.test(String(url))) { posts.push(String(url)); return new Response('{}', { status: 200 }); }
		const r = respond(method, String(url));
		return new Response(r.body ?? '{}', { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
	});
	return render(Harness, { props: { name: app } });
};

if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function () { this.open = true; };
	HTMLDialogElement.prototype.show = function () { this.open = true; };
	HTMLDialogElement.prototype.close = function () { this.open = false; };
}

describe('AppDetail Retry confirmation', () => {
	beforeAll(() => {
		install(true);
		if (!Element.prototype.animate) Element.prototype.animate = (() => ({ finished: Promise.resolve(), cancel() {}, onfinish: null, play() {}, pause() {}, addEventListener() {} })) as never;
	});
	afterEach(() => { installLiveSource(null); posts.length = 0; vi.unstubAllGlobals(); });
	it('a production failed place: Retry opens the confirm; the POST follows the confirm', async () => {
		const { findByRole, findByLabelText, getByRole } = mountApp('search-indexer');
		await fireEvent.click(await findByRole('button', { name: /^Retry$/ }));
		await new Promise((r) => setTimeout(r, 50));
		expect(posts).toEqual([]);
		expect(await findByRole('dialog')).toBeTruthy();
		const input = (await findByLabelText(/to confirm/)) as HTMLInputElement;
		const confirm = getByRole('dialog').querySelector('.btn-danger') as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		await fireEvent.input(input, { target: { value: input.labels?.[0]?.querySelector('span')?.textContent ?? '' } });
		await fireEvent.click(confirm);
		await waitFor(() => expect(posts.length).toBe(1));
	});
});
