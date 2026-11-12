/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';

/**
 * The visible reason beside a disabled "Change version": it renders only when the button is disabled
 * BECAUSE there are no releases (a Rollout with no release source), never otherwise. In its own file
 * because `vi.mock` is hoisted per file.
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
vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	invalidateAll: vi.fn(),
	pushState: vi.fn(),
	replaceState: vi.fn(),
	beforeNavigate: vi.fn(),
	afterNavigate: vi.fn()
}));

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import RolloutDetail from '../../routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte';
import { fleet, respond } from './fleet-fixture';

afterEach(() => vi.unstubAllGlobals());

const DETAIL = /\/api\/(?:clusters\/[^/]+\/)?rollouts\/[^/]+\/[^/]+(\?|$)/;
const REQUIRED = {
	type: 'ReleasesUpdated',
	status: 'False',
	reason: 'ReleaseSourceRequired',
	message: 'spec.releaseSourceRef is not set, so this Rollout has no releases.'
};

async function mount(noSource: boolean) {
	state.page.params = { cluster: 'rollout-a', namespace: 'alpha-dev', name: 'alpha-app' };
	const payload = fleet();
	const one: any = JSON.parse(JSON.stringify(payload.rollouts.items[0]));
	if (noSource) {
		for (const f of ['availableReleases', 'releaseCandidates', 'gatedReleaseCandidates'])
			delete one.status[f];
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

describe('the Change version reason', () => {
	test(
		'no release source: the reason is printed and the button is disabled',
		{ timeout: 30000 },
		async () => {
			const c = await mount(true);
			await waitFor(() => expect(c.querySelector('[data-change-version-reason]')).not.toBeNull(), {
				timeout: 25000
			});
			for (const el of c.querySelectorAll('[data-change-version-reason]')) {
				expect(el.classList.contains('sr-only'), 'said once elsewhere: the button\'s reason is for assistive tech').toBe(true);
				expect(el.textContent).toBe('No release source: no versions to choose from');
			}
			const btn = [...c.querySelectorAll('button')].find((b) =>
				/^Change version$/i.test((b.textContent ?? '').trim())
			);
			expect(btn).toBeTruthy();
			expect(btn!.disabled).toBe(true);
			const id = btn!.getAttribute('aria-describedby');
			expect(id).toBeTruthy();
			expect(c.querySelector(`#${id}`)?.hasAttribute('data-change-version-reason')).toBe(true);
		}
	);

	test(
		'a Rollout with releases: the button is enabled and there is no reason line',
		{ timeout: 30000 },
		async () => {
			const c = await mount(false);
			await waitFor(() => expect(c.querySelector('#status-change-version-btn')).not.toBeNull(), {
				timeout: 25000
			});
			expect((c.querySelector('#status-change-version-btn') as HTMLButtonElement).disabled).toBe(
				false
			);
			expect(c.querySelector('[data-change-version-reason]')).toBeNull();
		}
	);
});
