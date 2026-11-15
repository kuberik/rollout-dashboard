/* eslint-disable @typescript-eslint/no-explicit-any */
// Clicking another environment on the Overview strip is a CLIENT navigation:
// this page stays mounted and its params change. Until the next rollout's
// detail answers, `rollout` is undefined, `appLane` is null, and the strip's
// per-node permission `createQueries` drops from N queries to none.
// svelte-query 6.0.12 cannot shrink a top-level result array by 2+ (its
// `createRawRef` deletes one key and shortens the array, so the next delete
// finds nothing and the proxy throws "'deleteProperty' on proxy: trap returned
// falsish"). The fix wraps the results in an object; this test navigates
// between two stages of one app with the second stage's detail still loading.
import { test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { QueryClient } from '@tanstack/svelte-query';

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
import { rolloutQueryKey, rolloutsListQueryKey } from '$lib/api/rollouts';
import { homeInput } from '$lib/view-models/home/fixture';

afterEach(() => vi.unstubAllGlobals());

const CL = 'rollout-dashboard.kuberik.com/source-cluster';

test('switching environments on the Overview strip does not throw while the next rollout loads', async () => {
	const input = homeInput();
	// The app with the longest lane: many stages, so the strip's query list is long.
	const counts = new Map<string, number>();
	for (const r of input.rollouts as any[]) counts.set(r.metadata.name, (counts.get(r.metadata.name) ?? 0) + 1);
	const app = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
	const [a, b] = (input.rollouts as any[]).filter((r) => r.metadata.name === app);
	const at = (r: any) => ({
		cluster: r.metadata.annotations?.[CL] ?? 'prod',
		namespace: r.metadata.namespace,
		name: r.metadata.name
	});
	const pa = at(a);
	const pb = at(b);
	const list = {
		rollouts: { items: input.rollouts },
		environments: { items: input.environments },
		rolloutDependencies: input.rolloutDependencies,
		clusters: [...new Set([pa.cluster, pb.cluster])].map((name) => ({ name, url: 'https://x' }))
	};
	const json = (body: unknown) =>
		new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
	vi.stubGlobal(
		'fetch',
		vi.fn(async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (/\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/.test(url)) {
				if (url.includes(`/rollouts/${pb.namespace}/`)) return new Promise<Response>(() => {}); // still loading
				return json({ rollout: a, environment: null, rolloutGates: { items: [] } });
			}
			if (url.includes('/schedules') || url.includes('/health-checks') || url.includes('/rollout-tests'))
				return json({ items: [] });
			if (url.includes('/permissions')) return json({ permissions: { approve: true } });
			if (url.includes('/api/cluster')) return json({ name: pa.cluster, clusters: list.clusters });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			return json(list);
		})
	);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, staleTime: Infinity } }
	});
	client.setQueryData(rolloutsListQueryKey, list);
	client.setQueryData(rolloutQueryKey(pa.namespace, pa.name, pa.cluster), {
		rollout: a,
		environment: null,
		rolloutGates: { items: [] }
	});
	reactivePage.params = pa;
	reactivePage.url = new URL(`http://localhost/rollouts/${pa.cluster}/${pa.namespace}/${pa.name}`);

	const errors: unknown[] = [];
	const onError = (e: ErrorEvent) => {
		errors.push(e.error);
		e.preventDefault();
	};
	const onRejection = (e: PromiseRejectionEvent) => {
		errors.push(e.reason);
		e.preventDefault();
	};
	window.addEventListener('error', onError);
	window.addEventListener('unhandledrejection', onRejection);
	try {
		const { container } = render(WithQueryClient, { props: { component: RolloutDetail as any, client } });
		await waitFor(() => expect(container.querySelector('h1')?.textContent ?? '').toContain(app), {
			timeout: 8000
		});
		// The strip's lane must have more than one node, or nothing shrinks.
		expect(counts.get(app)).toBeGreaterThan(2);
		// Click the next environment: same component, new params, detail not cached.
		// flushSync runs the page's effects now, so a throw in them fails this test.
		flushSync(() => {
			reactivePage.params = pb;
			reactivePage.url = new URL(`http://localhost/rollouts/${pb.cluster}/${pb.namespace}/${pb.name}`);
		});
		await new Promise((r) => setTimeout(r, 50));
		// And back to the first one.
		// flushSync runs the page's effects now, so a throw in them fails this test.
		flushSync(() => {
			reactivePage.params = pa;
			reactivePage.url = new URL(`http://localhost/rollouts/${pa.cluster}/${pa.namespace}/${pa.name}`);
		});
		await new Promise((r) => setTimeout(r, 50));
	} finally {
		window.removeEventListener('error', onError);
		window.removeEventListener('unhandledrejection', onRejection);
	}
	expect(errors.map((e) => String(e))).toEqual([]);
});
