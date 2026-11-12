/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

/**
 * A rollout without releases says so ONCE on its page (batch4 #61.4): one visible statement outside .sr-only, no
 * Newer builds header label ([data-no-releases]), no "no releases" fact on the lane boxes. In its own file because
 * `vi.mock` is hoisted per file.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);
/* the release catalogue is empty for every rollout: the one `noReleasesOf` rule (page, lane) answers "No releases yet" */
vi.mock('$lib/releases/registry.svelte', async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	noReleasesOf: () => ({ kind: 'empty', label: 'No releases yet', message: "This Rollout's release source has not published any releases yet." })
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
import { fleet, respond } from '$lib/messages/fleet-fixture';

afterEach(() => vi.unstubAllGlobals());

const DETAIL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;
const REQUIRED = {
	type: 'ReleasesUpdated',
	status: 'False',
	reason: 'NoReleases',
	message: "This Rollout's release source has not published any releases yet."
};

async function mount(noSource: boolean) {
	state.page.params = { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' };
	const payload = fleet();
	const one: any = JSON.parse(JSON.stringify(payload.rollouts.items[0]));
	if (noSource) {
		for (const f of ['availableReleases', 'releaseCandidates', 'gatedReleaseCandidates'])
			one.status[f] = [];
		one.status.conditions = [...(one.status.conditions ?? []), REQUIRED];
	}
	const list = respond(payload) as any;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: any) => {
			const url = String(typeof input === 'string' ? input : (input?.url ?? input));
			if (url.includes('/permissions'))
				return new Response(JSON.stringify({ permissions: { update: true, patch: true } }), {
					status: 200,
					headers: { 'Content-Type': 'application/json' }
				});
			if (DETAIL.test(url))
				return new Response(
					JSON.stringify({
						rollout: one,
						environment: payload.environments.items[0],
						rolloutGates: { items: [] }
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } }
				);
			return list(input);
		})
	);
	const r = render(WithQueryClient, { props: { component: RolloutDetail as any } });
	await waitFor(() => expect(screen.getAllByText(/alpha-app/i).length).toBeGreaterThan(0), {
		timeout: 5000
	});
	return r.container;
}


const SAYS = /no releases?\b|not published/i;
describe('a rollout whose release source published nothing says so once', () => {
	test('one visible statement (the Newer builds body), no header label, a silent lane', { timeout: 30000 }, async () => {
		const c = await mount(false);
		await waitFor(() => expect(c.querySelector('[data-change-version-reason]')).not.toBeNull(), { timeout: 25000 });
		const visible = [...c.querySelectorAll('*')].filter(
			(e) => !e.closest('.sr-only, .hidden') && !['SCRIPT', 'STYLE', 'TITLE'].includes(e.tagName) && ![...e.children].some((k) => SAYS.test(k.textContent ?? '')) && SAYS.test(e.textContent ?? '')
		);
		expect(visible.map((e) => e.textContent), 'visible "no releases" statements outside .sr-only').toHaveLength(1);
		expect(c.querySelector('[data-no-releases]')).toBeNull();
		expect(c.querySelector('.env-fact')).toBeNull();
	});
});
