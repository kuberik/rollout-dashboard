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

afterEach(() => vi.unstubAllGlobals());
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * batch4 followup (b): the detail page's banner printed "2 newer builds" off the rollout's own list, then corrected it to "1" once the fleet list
 * (the wave chain) arrived. The banner must print NO count while the fleet query is pending, then the right one, and never the wrong one.
 * Fixture: eu-west-1 is a wave-2 follower pinned to b-45; its list carries b-46 and b-47, b-46 failed in the wave-2 LEADER (still running it).
 */
const v45 = { tag: 'b-45', version: '4.45.0-45', revision: 'aaaaaaa1111111' };
const v46 = { tag: 'b-46', version: '4.46.0-46', revision: 'bbbbbbb2222222', created: '2026-01-01T00:00:00Z' };
const v47 = { tag: 'b-47', version: '4.47.0-47', revision: 'ddddddd4444444', created: '2026-01-02T00:00:00Z' };
const env = (site: string, wave: number) => ({ metadata: { name: `app-${site}`, namespace: `app-prod-${site}` }, spec: { name: 'app', environment: 'prod', site, wave, rolloutRef: { name: 'app' } }, status: { conditions: [] } });
const ro = (site: string) => {
	const lead = site === 'ap-southeast-2';
	const history = lead ? [{ bakeStatus: 'Failed', version: v46, timestamp: '2026-11-10T10:00:00Z' }, { bakeStatus: 'Succeeded', version: v45, timestamp: '2026-11-10T09:00:00Z' }] : [{ bakeStatus: 'Succeeded', version: v45, timestamp: '2026-11-10T09:00:00Z' }];
	return {
		metadata: { name: 'app', namespace: `app-prod-${site}` },
		spec: site === 'eu-west-1' ? { wantedVersion: 'b-45' } : {},
		status: { currentVersion: lead ? 'b-46' : 'b-45', releaseCandidates: lead ? [] : [v47, v46], availableReleases: [v45, v46, v47], history, gates: [] }
	};
};

describe('rollout detail: the newer-builds count waits for the fleet list', () => {
	test('no count while the fleet query is pending, the live count once it answers, never the raw one', async () => {
		const sites = ['us-east-1', 'ap-southeast-2', 'eu-west-1', 'us-west-2'];
		const waves: Record<string, number> = { 'us-east-1': 1, 'ap-southeast-2': 2, 'eu-west-1': 2, 'us-west-2': 2 };
		const fleet = { rollouts: { items: sites.map(ro) }, environments: { items: sites.map((s) => env(s, waves[s])) }, rolloutDependencies: [], clusters: [{ name: 'prod', url: 'https://x' }] };
		let release!: () => void;
		const held = new Promise<void>((r) => (release = r));
		const f = async (req: any) => {
			const url = String(typeof req === 'string' ? req : (req?.url ?? req));
			if (/\/clusters\/prod\/rollouts\/app-prod-eu-west-1\/app(\?|$)/.test(url)) return json({ rollout: ro('eu-west-1'), environment: env('eu-west-1', 2), rolloutGates: { items: [] } });
			if (url.includes('/schedules') || url.includes('/rollout-tests')) return json({ items: [] });
			if (url.includes('/permissions')) return json({ canDeploy: true, canPin: true });
			if (url.includes('/api/cluster')) return json({ name: 'prod', clusters: [{ name: 'prod', url: 'https://x' }] });
			if (url.includes('/api/commits') || url.includes('/api/github')) return json({ connected: false });
			if (url.includes('/health-checks')) return json({ items: [] });
			if (!/\/api\/rollouts(\?|$)/.test(url)) return json({ items: [] });
			await held; /* the fleet list: held back */
			return json(fleet);
		};
		vi.stubGlobal('fetch', vi.fn(f));
		reactivePage.params = { cluster: 'prod', namespace: 'app-prod-eu-west-1', name: 'app' };
		reactivePage.url = new URL('http://localhost/rollouts/prod/app-prod-eu-west-1/app');
		const { container } = render(WithQueryClient, { props: { component: RolloutDetail as any } });
		const text = () => container.textContent ?? '';
		await waitFor(() => expect(text()).toMatch(/pinned to/), { timeout: 12000 });
		const seen: string[] = [];
		const sample = () => seen.push(text().match(/\d+ newer builds?/g)?.join('|') ?? '');
		await new Promise((r) => setTimeout(r, 300));
		sample();
		expect(text()).toMatch(/Newer builds are available and none of them will deploy while the pin is set/); /* pending: said without a number */
		expect(seen.at(-1)).toBe('');
		release();
		await waitFor(() => expect(text()).toMatch(/1 newer build is available and none of them will deploy/), { timeout: 8000 });
		sample();
		expect(seen.join(',')).not.toMatch(/2 newer/);
		expect(text()).not.toMatch(/2 newer builds/);
	}, 30000);
});
