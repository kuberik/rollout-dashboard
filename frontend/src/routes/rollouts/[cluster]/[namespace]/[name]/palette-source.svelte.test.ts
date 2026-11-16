// The command palette (one mount, in the root shell) draws its Needs-you rows from the live fleet source: failure ages and which
// failures have recovered. The source was installed only by the Overview and Gates tabs, so on History and Logs the palette read
// nothing and drew another list (alphabetical, a recovered failure as failing). The rollout layout now installs it for every tab.
import { test, expect, vi, afterEach, beforeAll } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, waitFor } from '@testing-library/svelte';

const state = vi.hoisted(() => ({
	page: { params: {} as Record<string, string>, url: new URL('http://localhost/rollouts/a/b/c'), route: { id: null as string | null }, status: 200, error: null, data: {}, form: null }
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), pushState: vi.fn(), replaceState: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Harness from '$lib/testing/RolloutLayoutHarness.svelte';
import { respond } from '$lib/demo/respond';
import { resetDemoState } from '$lib/demo/state';
import { install } from '$lib/demo/health-failures-fixtures';
import { installLiveSource, liveSource } from '$lib/components/home/sketch/fleet-source.svelte';

beforeAll(() => install(true));
afterEach(() => { installLiveSource(null); vi.unstubAllGlobals(); });

for (const tab of ['', '/history', '/gates', '/logs']) {
	test(`the rollout layout installs the live fleet source on ${tab || 'overview'} (the palette's Needs-you reads it)`, async () => {
		resetDemoState('calm');
		const l = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}');
		const one = l.rollouts.items[0];
		const cluster = 'prod';
		state.page.params = { cluster, namespace: one.metadata.namespace, name: one.metadata.name };
		state.page.url = new URL(`http://localhost/rollouts/${cluster}/${one.metadata.namespace}/${one.metadata.name}${tab}`);
		vi.stubGlobal('fetch', vi.fn(async (req: unknown) => {
			const url = String(typeof req === 'string' ? req : ((req as { url?: string })?.url ?? req));
			const path = url.replace(/^https?:\/\/[^/]+/, '');
			const r = respond('GET', path);
			return new Response(r.body ?? '{}', { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
		}));
		expect(liveSource()).toBeNull();
		render(WithQueryClient, { props: { component: Harness as never } });
		await waitFor(() => expect(liveSource()).not.toBeNull(), { timeout: 8000 });
		expect(liveSource()!.healthChecks).not.toBeNull();
	});
}
