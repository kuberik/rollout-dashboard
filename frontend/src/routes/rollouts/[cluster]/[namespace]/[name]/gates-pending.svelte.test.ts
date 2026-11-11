/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor, fireEvent } from '@testing-library/svelte';

vi.mock('$app/state', async () => ({
	page: (await import('$lib/testing/reactive-page.svelte')).reactivePage
}));
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import RolloutGates from './gates/+page.svelte';
import { reactivePage } from '$lib/testing/reactive-page.svelte';

afterEach(() => vi.unstubAllGlobals());
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * batch4 followup (b2): the Gates tab drew "No gates on this rollout" while the fleet list (which hasChain / hasContracts / the graph are read
 * off) was still pending: a finished, false sentence during loading. It must show a skeleton until the list answers, then the true state.
 */
const v45 = { tag: 'b-45', version: '4.45.0-45', revision: 'aaaaaaa1111111' };
const ro = { metadata: { name: 'app', namespace: 'app-prod-eu-west-1' }, spec: {}, status: { currentVersion: 'b-45', releaseCandidates: [], availableReleases: [v45], history: [{ bakeStatus: 'Succeeded', version: v45, timestamp: '2026-11-10T09:00:00Z' }], gates: [] } };
const env = { metadata: { name: 'app-eu-west-1', namespace: 'app-prod-eu-west-1' }, spec: { name: 'app', environment: 'prod', site: 'eu-west-1', wave: 1, rolloutRef: { name: 'app' } }, status: { conditions: [] } };

describe('Gates tab: no empty sentence while the fleet list is pending', () => {
	test('skeleton while pending, the true empty state once the list answers', async () => {
		const fleet = { rollouts: { items: [ro] }, environments: { items: [env] }, rolloutDependencies: [], clusters: [{ name: 'prod', url: 'https://x' }] };
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		const f = async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (/\/clusters\/prod\/rollouts\/app-prod-eu-west-1\/app(\?|$)/.test(url)) return json({ rollout: ro, environment: env, rolloutGates: { items: [] } });
			if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
			if (url.includes('/api/cluster')) return json({ name: 'prod', clusters: [{ name: 'prod', url: 'https://x' }] });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			if (!/\/api\/rollouts(\?|$)/.test(url)) return json({ items: [] });
			await held;
			return json(fleet);
		};
		vi.stubGlobal('fetch', vi.fn(f));
		reactivePage.params = { cluster: 'prod', namespace: 'app-prod-eu-west-1', name: 'app' };
		reactivePage.url = new URL('http://localhost/rollouts/prod/app-prod-eu-west-1/app/gates');
		const { container } = render(WithQueryClient, { props: { component: RolloutGates as any } });
		const text = () => container.textContent ?? '';
		await waitFor(() => expect(container.querySelector('h1')?.textContent ?? '').toContain('app'), { timeout: 12000 });
		const seen: boolean[] = [];
		const obs = new MutationObserver(() => seen.push(/No gates on this rollout/.test(text())));
		obs.observe(container, { childList: true, subtree: true, characterData: true });
		await new Promise((r) => setTimeout(r, 500));
		expect(text()).not.toMatch(/No gates on this rollout/);
		expect(container.querySelector('.skel-block, [aria-hidden="true"].animate-pulse, [data-skeleton]')).not.toBeNull();
		// the rail's two cards ("Runs in", "Depends on this") are placeholders too, so nothing pops in once the list answers (batch4 followup 5)
		const pending = container.querySelector('[data-testid="gates-pending"]');
		expect(pending).not.toBeNull();
		const rail = pending!.querySelector('.content-start');
		expect(rail?.children.length).toBe(2);
		expect(rail!.querySelectorAll('.skel-block').length).toBeGreaterThan(4);
		release();
		await waitFor(() => expect(text()).toMatch(/No gates on this rollout/), { timeout: 8000 });
		obs.disconnect();
		expect(seen.indexOf(true)).toBeGreaterThanOrEqual(0);
	}, 30000);

	test('a failed fleet fetch shows the unavailable card, never "No gates" and never a newer-builds count', async () => {
		const f = async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (/\/clusters\/prod\/rollouts\/app-prod-eu-west-1\/app(\?|$)/.test(url)) return json({ rollout: { ...ro, status: { ...ro.status, releaseCandidates: [{ tag: 'b-46', version: '4.46.0-46', revision: 'bbbbbbb2222222' }] } }, environment: env, rolloutGates: { items: [] } });
			if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
			if (url.includes('/api/cluster')) return json({ name: 'prod', clusters: [{ name: 'prod', url: 'https://x' }] });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			if (!/\/api\/rollouts(\?|$)/.test(url)) return json({ items: [] });
			return json({ error: 'boom' }, 500);
		};
		vi.stubGlobal('fetch', vi.fn(f));
		reactivePage.params = { cluster: 'prod', namespace: 'app-prod-eu-west-1', name: 'app' };
		reactivePage.url = new URL('http://localhost/rollouts/prod/app-prod-eu-west-1/app/gates');
		const { container } = render(WithQueryClient, { props: { component: RolloutGates as any } });
		const text = () => container.textContent ?? '';
		await waitFor(() => expect(text()).toMatch(/Rules couldn't be loaded/), { timeout: 20000 });
		expect(text()).not.toMatch(/No gates on this rollout/);
		expect(text()).not.toMatch(/\d+ newer builds?/);
		expect(container.querySelector('[data-testid="gates-pending"]')).toBeNull();
		expect(text()).toMatch(/Try again/);
	}, 40000);

	test('Try again keeps the unavailable card through the refetch ("Checking…"), a second failure keeps it, a success shows the content', async () => {
		let mode: 'fail' | 'hold' | 'ok' = 'fail';
		let releaseHold!: () => void;
		const hold = new Promise<void>((r) => (releaseHold = r));
		const fleet = { rollouts: { items: [ro] }, environments: { items: [env] }, rolloutDependencies: [], clusters: [{ name: 'prod', url: 'https://x' }] };
		const f = async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (/\/clusters\/prod\/rollouts\/app-prod-eu-west-1\/app(\?|$)/.test(url)) return json({ rollout: ro, environment: env, rolloutGates: { items: [] } });
			if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
			if (url.includes('/api/cluster')) return json({ name: 'prod', clusters: [{ name: 'prod', url: 'https://x' }] });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			if (!/\/api\/rollouts(\?|$)/.test(url)) return json({ items: [] });
			if (mode === 'hold') {
				await hold;
				return json({ error: 'boom' }, 500);
			}
			return mode === 'ok' ? json(fleet) : json({ error: 'boom' }, 500);
		};
		vi.stubGlobal('fetch', vi.fn(f));
		reactivePage.params = { cluster: 'prod', namespace: 'app-prod-eu-west-1', name: 'app' };
		reactivePage.url = new URL('http://localhost/rollouts/prod/app-prod-eu-west-1/app/gates');
		const { container, getByRole } = render(WithQueryClient, { props: { component: RolloutGates as any } });
		const text = () => container.textContent ?? '';
		await waitFor(() => expect(text()).toMatch(/Rules couldn't be loaded/), { timeout: 20000 });
		// failure -> Try again: the card stays and says Checking… (no skeleton swap)
		mode = 'hold';
		await fireEvent.click(getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(text()).toMatch(/Checking…/), { timeout: 5000 });
		expect(text()).toMatch(/Rules couldn't be loaded/);
		expect(container.querySelector('[data-testid="gates-pending"]')).toBeNull();
		// the retry fails again: the card is still there, button back to Try again
		releaseHold();
		await waitFor(() => expect(getByRole('button', { name: 'Try again' })).toBeEnabled(), { timeout: 8000 });
		expect(text()).toMatch(/Rules couldn't be loaded/);
		expect(container.querySelector('[data-testid="gates-pending"]')).toBeNull();
		// a success shows the content
		mode = 'ok';
		await fireEvent.click(getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(text()).toMatch(/No gates on this rollout/), { timeout: 8000 });
		expect(text()).not.toMatch(/Rules couldn't be loaded/);
	}, 60000);
});
