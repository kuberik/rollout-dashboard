/* eslint-disable @typescript-eslint/no-explicit-any */
// Mounting rollout detail with the fleet list ALREADY in the query cache is
// what happens when you come back to Overview from another tab (Gates,
// History, …): the layout and the other tabs share `rolloutsListQueryKey`, so
// `listQuery.data` and the rollout itself are there on the very first
// synchronous read. On a cold
// load it is undefined, `appLane` returns early, and nothing reads further.
// With it warm, `createQueries` evaluates its options eagerly at setup,
// which pulls `laneNodes` -> `appLane` -> `gateContext` / `providerNetwork`.
// Those must be declared before that read, or setup throws
// `ReferenceError: Cannot access 'gateContext' before initialization`.
import { test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';
import { QueryClient } from '@tanstack/svelte-query';

const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/rollouts/a/b/c'),
		route: { id: null as string | null },
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
import RolloutDetail from './+page.svelte';
import { rolloutQueryKey, rolloutsListQueryKey } from '$lib/api/rollouts';
import { homeInput } from '$lib/view-models/home/fixture';

afterEach(() => vi.unstubAllGlobals());

const CL = 'rollout-dashboard.kuberik.com/source-cluster';

test('rollout detail mounts with the fleet list already cached (back to Overview from Gates)', async () => {
	const input = homeInput();
	const one: any = input.rollouts.find((r: any) => (r.status?.history?.length ?? 0) > 0)!;
	const env = input.environments.find(
		(e: any) => e.metadata?.namespace === one.metadata.namespace && e.spec?.rolloutRef?.name === one.metadata.name
	);
	const cluster = one.metadata.annotations?.[CL] ?? 'prod';
	const p = { cluster, namespace: one.metadata.namespace, name: one.metadata.name };
	state.page.params = p;
	state.page.url = new URL(`http://localhost/rollouts/${p.cluster}/${p.namespace}/${p.name}`);
	const list = {
		rollouts: { items: input.rollouts },
		environments: { items: input.environments },
		rolloutDependencies: input.rolloutDependencies,
		clusters: [{ name: cluster, url: 'https://x' }]
	};
	const json = (b: unknown) =>
		new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
	vi.stubGlobal(
		'fetch',
		vi.fn(async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (/\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/.test(url))
				return json({ rollout: one, environment: env, rolloutGates: { items: [] } });
			if (url.includes('/schedules') || url.includes('/health-checks') || url.includes('/rollout-tests'))
				return json({ items: [] });
			if (url.includes('/permissions')) return json({ permissions: { approve: true } });
			if (url.includes('/api/cluster')) return json({ name: cluster, clusters: list.clusters });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			return json(list);
		})
	);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } }
	});
	// Warm cache: the state the Gates tab (or any list page) leaves behind.
	client.setQueryData(rolloutsListQueryKey, list);
	client.setQueryData(rolloutQueryKey(p.namespace, p.name, p.cluster), {
		rollout: one,
		environment: env,
		rolloutGates: { items: [] }
	});
	const errors: unknown[] = [];
	const onError = (e: ErrorEvent) => errors.push(e.error);
	window.addEventListener('error', onError);
	try {
		const { container } = render(WithQueryClient, {
			props: { component: RolloutDetail as any, client }
		});
		await waitFor(() => expect(container.querySelector('h1')?.textContent ?? '').toContain(p.name), {
			timeout: 8000
		});
	} finally {
		window.removeEventListener('error', onError);
	}
	expect(errors).toEqual([]);
});
