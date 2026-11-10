import { describe, test, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';

const state = vi.hoisted(() => ({
	page: {
		params: { slug: 'github.com/acme/widget/pull/999' } as Record<string, string>,
		url: new URL('http://localhost/changes/github.com/acme/widget/pull/999'),
		route: { id: null as string | null },
		status: 200,
		error: null,
		data: {},
		form: null
	}
}));
vi.mock('$app/state', () => state);
vi.mock('$app/navigation', () => ({ goto: vi.fn(), afterNavigate: () => {}, beforeNavigate: () => {} }));
import Page from './+page.svelte';

afterEach(() => vi.unstubAllGlobals());

function stub(status: object) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/auth/github/status')) return new Response(JSON.stringify(status), { status: 200 });
			if (url.includes('/api/github/changes')) return new Response(JSON.stringify({ error: 'github_not_connected' }), { status: 401 });
			return new Response(
				JSON.stringify({ rollouts: { items: [] }, environments: { items: [] }, rolloutDependencies: { items: [] }, clusters: [], clusterErrors: [] }),
				{ status: 200 }
			);
		})
	);
}

describe('QA #9 / #20 — a change page with GitHub absent says so and offers the remedy', () => {
	test('configured but not connected: "needs GitHub" + Connect, never "does not exist"', async () => {
		stub({ configured: true, connected: false });
		render(WithQueryClient, { props: { component: Page } } as never);
		await waitFor(() => expect(screen.getByText('This change needs GitHub')).toBeInTheDocument(), { timeout: 4000 });
		expect(screen.queryByText('This change does not exist')).not.toBeInTheDocument();
		// round 2 C4: the same centred empty state /changes draws, not the not-found template with its "Where to look" rail
		expect(screen.queryByText('Where to look')).not.toBeInTheDocument();
		expect(document.querySelector('[data-list-empty][data-github-absence]')).not.toBeNull();
		expect(screen.getAllByRole('button', { name: /Connect GitHub/i }).length).toBeGreaterThan(0);
	});
	test('not configured at all: needs GitHub, no Connect button', async () => {
		stub({ configured: false, connected: false });
		render(WithQueryClient, { props: { component: Page } } as never);
		await waitFor(() => expect(screen.getByText('This change needs GitHub')).toBeInTheDocument(), { timeout: 4000 });
		expect(screen.queryByRole('button', { name: /Connect GitHub/i })).not.toBeInTheDocument();
	});
});
