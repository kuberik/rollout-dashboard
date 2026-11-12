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

import { QueryClient } from '@tanstack/svelte-query';
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
		// the rail's card ("Depends on this") is a placeholder too, so nothing pops in once the list answers (batch4 followup 5)
		const pending = container.querySelector('[data-testid="gates-pending"]');
		expect(pending).not.toBeNull();
		const rail = pending!.querySelector('.content-start');
		expect(rail?.children.length).toBe(1);
		expect(rail!.querySelectorAll('.skel-block').length).toBeGreaterThan(2);
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

	test('a settled list that lacks this rollout never draws "No gates": skeleton until the next refetch, then an empty slot', async () => {
		const other = { ...ro, metadata: { name: 'other', namespace: 'other-ns' } };
		const otherEnv = { ...env, metadata: { name: 'other-env', namespace: 'other-ns' }, spec: { ...env.spec, name: 'other', rolloutRef: { name: 'other' } } };
		const fleet = { rollouts: { items: [other] }, environments: { items: [otherEnv] }, rolloutDependencies: [], clusters: [{ name: 'prod', url: 'https://x' }] };
		let listCalls = 0;
		const f = async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (/\/clusters\/prod\/rollouts\/app-prod-eu-west-1\/app(\?|$)/.test(url)) return json({ rollout: ro, environment: env, rolloutGates: { items: [] } });
			if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
			if (url.includes('/api/cluster')) return json({ name: 'prod', clusters: [{ name: 'prod', url: 'https://x' }] });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			if (!/\/api\/rollouts(\?|$)/.test(url)) return json({ items: [] });
			listCalls++;
			return json(fleet);
		};
		vi.stubGlobal('fetch', vi.fn(f));
		reactivePage.params = { cluster: 'prod', namespace: 'app-prod-eu-west-1', name: 'app' };
		reactivePage.url = new URL('http://localhost/rollouts/prod/app-prod-eu-west-1/app/gates');
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: Infinity } } });
		const { container } = render(WithQueryClient, { props: { component: RolloutGates as any, client } });
		const text = () => container.textContent ?? '';
		const seen: boolean[] = [];
		const obs = new MutationObserver(() => seen.push(/No gates on this rollout/.test(text())));
		obs.observe(container, { childList: true, subtree: true, characterData: true });
		await waitFor(() => expect(listCalls).toBeGreaterThan(0), { timeout: 12000 });
		await new Promise((r) => setTimeout(r, 800));
		// the list answered without this rollout: a skeleton, never the finished sentence
		expect(text()).not.toMatch(/No gates on this rollout/);
		expect(container.querySelector('[data-testid="gates-top-pending"]')).not.toBeNull();
		// the next refetch still lacks it: the slot is empty (as before), still no sentence
		const before = listCalls;
		await client.refetchQueries();
		await waitFor(() => expect(listCalls).toBeGreaterThan(before), { timeout: 8000 });
		await waitFor(() => expect(container.querySelector('[data-testid="gates-top-pending"]')).toBeNull(), { timeout: 8000 });
		expect(text()).not.toMatch(/No gates on this rollout/);
		obs.disconnect();
		expect(seen.includes(true)).toBe(false);
	}, 40000);

	test('same, with the rollout\'s own hold present (a gate refuses the newer build): never "No gates" above Held builds', async () => {
		const roHeld = { ...ro, status: { ...ro.status, releaseCandidates: [{ tag: 'b-46', version: '4.46.0-46', revision: 'bbbbbbb2222222', created: '2026-01-01T00:00:00Z' }], gates: [{ name: 'approval', passing: false, allowedVersions: null }] } };
		const other = { ...ro, metadata: { name: 'other', namespace: 'other-ns' } };
		const otherEnv = { ...env, metadata: { name: 'other-env', namespace: 'other-ns' }, spec: { ...env.spec, name: 'other', rolloutRef: { name: 'other' } } };
		const fleet = { rollouts: { items: [other] }, environments: { items: [otherEnv] }, rolloutDependencies: [], clusters: [{ name: 'prod', url: 'https://x' }] };
		let listCalls = 0;
		const f = async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (/\/clusters\/prod\/rollouts\/app-prod-eu-west-1\/app(\?|$)/.test(url)) return json({ rollout: roHeld, environment: env, rolloutGates: { items: [] } });
			if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
			if (url.includes('/api/cluster')) return json({ name: 'prod', clusters: [{ name: 'prod', url: 'https://x' }] });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			if (!/\/api\/rollouts(\?|$)/.test(url)) return json({ items: [] });
			listCalls++;
			return json(fleet);
		};
		vi.stubGlobal('fetch', vi.fn(f));
		reactivePage.params = { cluster: 'prod', namespace: 'app-prod-eu-west-1', name: 'app' };
		reactivePage.url = new URL('http://localhost/rollouts/prod/app-prod-eu-west-1/app/gates');
		const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0, staleTime: Infinity } } });
		const { container } = render(WithQueryClient, { props: { component: RolloutGates as any, client } });
		const text = () => container.textContent ?? '';
		const seen: boolean[] = [];
		const obs = new MutationObserver(() => seen.push(/No gates on this rollout/.test(text())));
		obs.observe(container, { childList: true, subtree: true, characterData: true });
		await waitFor(() => expect(listCalls).toBeGreaterThan(0), { timeout: 12000 });
		await new Promise((r) => setTimeout(r, 800));
		// the rollout's own hold is on the page (this is the case that drew "No gates" above Held builds)
		expect(text()).toMatch(/Held builds/);
		// the list answered without this rollout: a skeleton, never the finished sentence
		expect(text()).not.toMatch(/No gates on this rollout/);
		expect(container.querySelector('[data-testid="gates-top-pending"]')).not.toBeNull();
		// the next refetch still lacks it: the slot is empty (as before), still no sentence
		const before = listCalls;
		await client.refetchQueries();
		await waitFor(() => expect(listCalls).toBeGreaterThan(before), { timeout: 8000 });
		await waitFor(() => expect(container.querySelector('[data-testid="gates-top-pending"]')).toBeNull(), { timeout: 8000 });
		expect(text()).not.toMatch(/No gates on this rollout/);
		obs.disconnect();
		expect(seen.includes(true)).toBe(false);
	}, 40000);

	test('with no main column the rail stays in the right track (lg:col-start-2)', async () => {
		const ro2 = { ...ro, metadata: { name: 'app2', namespace: 'app-dev' }, status: { ...ro.status } };
		const env2 = { metadata: { name: 'app-dev', namespace: 'app-dev' }, spec: { name: 'app', environment: 'dev', wave: 0, rolloutRef: { name: 'app2' } }, status: { conditions: [] } };
		const fleet = { rollouts: { items: [ro, ro2] }, environments: { items: [env, env2] }, rolloutDependencies: [], clusters: [{ name: 'prod', url: 'https://x' }] };
		const f = async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (/\/clusters\/prod\/rollouts\/app-prod-eu-west-1\/app(\?|$)/.test(url)) return json({ rollout: ro, environment: env, rolloutGates: { items: [] } });
			if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
			if (url.includes('/api/cluster')) return json({ name: 'prod', clusters: [{ name: 'prod', url: 'https://x' }] });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			if (!/\/api\/rollouts(\?|$)/.test(url)) return json({ items: [] });
			return json(fleet);
		};
		vi.stubGlobal('fetch', vi.fn(f));
		reactivePage.params = { cluster: 'prod', namespace: 'app-prod-eu-west-1', name: 'app' };
		reactivePage.url = new URL('http://localhost/rollouts/prod/app-prod-eu-west-1/app/gates');
		const { container } = render(WithQueryClient, { props: { component: RolloutGates as any } });
		await waitFor(() => expect(container.textContent).toMatch(/No gates on this rollout/), { timeout: 20000 });
		await waitFor(() => expect(container.textContent).toMatch(/Depends on this/), { timeout: 5000 });
		const rail = [...container.querySelectorAll('section')].find((x) => /Depends on this/.test(x.textContent ?? ''))!.parentElement!;
		expect(rail.className).toMatch(/lg:col-start-2/);
	}, 40000);
});
