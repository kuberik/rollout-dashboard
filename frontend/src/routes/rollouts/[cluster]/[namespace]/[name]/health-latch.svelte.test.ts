/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';

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
import RolloutDetail from './+page.svelte';
import { reactivePage } from '$lib/testing/reactive-page.svelte';
import { homeInput } from '$lib/view-models/home/fixture';

afterEach(() => vi.unstubAllGlobals());
const json = (b: unknown, status = 200) =>
	new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * batch4 QA18 #1: the "health checks could not be loaded" latch (which carries
 * the failure through "Try again"'s refetch) must belong to ONE rollout. Client
 * navigation from an errored rollout to one with NO healthCheckSelector re-uses
 * this component, and the other rollout must not inherit the error card.
 */
describe('rollout detail: the health-checks load-failure latch is per rollout', () => {
	test('navigating from an errored rollout to a selector-less one does not show the error card', async () => {
		const input = homeInput();
		const base: any = input.rollouts.find((r: any) => (r.status?.history?.length ?? 0) > 0)!;
		const ns = base.metadata.namespace;
		const withSel = structuredClone(base);
		withSel.metadata.name = 'hc-errored';
		withSel.spec = { ...withSel.spec, healthCheckSelector: { matchLabels: { app: 'x' } } };
		const noSel = structuredClone(base);
		noSel.metadata.name = 'hc-selectorless';
		noSel.spec = { ...noSel.spec };
		delete noSel.spec.healthCheckSelector;
		const byName: Record<string, any> = { 'hc-errored': withSel, 'hc-selectorless': noSel };
		const cluster = 'prod';
		const f = async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (url.includes('/health-checks')) return json({ error: 'boom' }, 500);
			const m = url.match(/\/rollouts\/[^/]+\/([^/?]+)(\?|$)/);
			if (m && byName[m[1]])
				return json({ rollout: byName[m[1]], environment: null, rolloutGates: { items: [] } });
			if (url.includes('/schedules') || url.includes('/rollout-tests')) return json({ items: [] });
			if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
			if (url.includes('/api/cluster')) return json({ name: cluster, clusters: [{ name: cluster, url: 'https://x' }] });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			return json({
				rollouts: { items: [withSel, noSel] },
				environments: { items: [] },
				rolloutDependencies: [],
				clusters: [{ name: cluster, url: 'https://x' }]
			});
		};
		vi.stubGlobal('fetch', vi.fn(f));
		reactivePage.params = { cluster, namespace: ns, name: 'hc-errored' };
		reactivePage.url = new URL(`http://localhost/rollouts/${cluster}/${ns}/hc-errored`);
		const { container } = render(WithQueryClient, { props: { component: RolloutDetail as any } });
		await waitFor(
			() => expect(container.textContent ?? '').toMatch(/Health checks couldn't be loaded/),
			{ timeout: 8000 }
		);
		// Client navigation, same mounted component.
		reactivePage.params = { cluster, namespace: ns, name: 'hc-selectorless' };
		reactivePage.url = new URL(`http://localhost/rollouts/${cluster}/${ns}/hc-selectorless`);
		await waitFor(() => expect(container.querySelector('h1')?.textContent ?? '').toContain('hc-selectorless'), { timeout: 8000 });
		await new Promise((r) => setTimeout(r, 800));
		expect(container.textContent ?? '').not.toMatch(/Health checks couldn't be loaded/);
		expect(container.textContent ?? '').toMatch(/No health checks select this rollout/);
	});
});
