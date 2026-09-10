import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * THE PR-CENTRIC VIEW'S ROUTE. Design doc:
 * `luka-polish-revisions-pass-6-design-20260910-092839.md`. Covers the
 * states the route itself owns (loading, not_connected, not_found, error,
 * open, closed, merged-with-cards) — `PipelineCard.svelte.test.ts` covers
 * the per-service card in depth, and `pr-cell-copy.test.ts` covers every
 * state sentence; this file does not re-derive either.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/pr/acme/widget/42'),
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

import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, configure } from '@testing-library/svelte';
configure({ asyncUtilTimeout: 5000 });

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Page from './+page.svelte';
import { resetPrMetaStore } from '$lib/stores/pr-meta.svelte';
import type { PullRequestInfo } from '$lib/api/pulls';
import type { Rollout, Environment } from '$lib/../types';

const PULL_URL = '/api/github/pulls/acme/widget/42';

function pullInfo(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
	return {
		number: 42,
		title: 'Add the widget flow',
		htmlUrl: 'https://github.com/acme/widget/pull/42',
		author: 'lskugor',
		state: 'merged',
		mergedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
		mergeCommitSha: 'c0ffee1',
		base: 'main',
		containedIn: ['c0ffee1'],
		containedInAll: true,
		...overrides
	};
}

function rollout(name: string, ns: string, revision: string, timestamp: string): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source: 'github.com/acme/widget',
			availableReleases: [],
			history: [
				{ version: { tag: revision, revision }, timestamp, bakeStatus: 'Succeeded', bakeEndTime: timestamp }
			]
		}
	} as unknown as Rollout;
}

function environment(app: string, ns: string, tier: string): Environment {
	return {
		metadata: { name: app, namespace: ns },
		spec: { environment: tier, rolloutRef: { name: app } }
	} as unknown as Environment;
}

function jsonResponse(body: unknown) {
	return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

function stubFetch(opts: {
	pull?: () => Promise<Response>;
	rollouts?: Rollout[];
	environments?: Environment[];
}) {
	const pull = opts.pull ?? (() => jsonResponse(pullInfo()));
	vi.stubGlobal(
		'fetch',
		vi.fn((url: string) => {
			if (url === PULL_URL) return pull();
			if (url === '/api/rollouts') {
				return jsonResponse({
					rollouts: { items: opts.rollouts ?? [] },
					environments: { items: opts.environments ?? [] }
				});
			}
			if (url === '/api/cluster') return jsonResponse({ url: 'https://hub', name: 'hub' });
			return jsonResponse({});
		})
	);
}

beforeEach(() => {
	resetPrMetaStore();
	state.page.params = { owner: 'acme', repo: 'widget', number: '42' };
	state.page.url = new URL('http://localhost/pr/acme/widget/42');
	localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function renderPage() {
	return render(WithQueryClient, { props: { component: Page as never } });
}

describe('/pr/[owner]/[repo]/[number]', () => {
	test('merged PR: head band, verdict and one card per matching service', async () => {
		stubFetch({
			rollouts: [rollout('widget-app', 'widget-dev', 'c0ffee1', new Date().toISOString())],
			environments: [environment('widget-app', 'widget-dev', 'dev')]
		});
		renderPage();

		expect(await screen.findByRole('heading', { level: 1, name: 'Add the widget flow' })).toBeInTheDocument();
		expect(screen.getByText(/#42 · acme\/widget/)).toBeInTheDocument();
		// A loose time match, not an exact "2h ago" — the mock's `mergedAt` is
		// computed a few ms before `coarse` captures "now", which can round
		// down a bucket (119m59s floors to `1h`, not `2h`); the FORMAT is
		// what this test owns, not clock-skew arithmetic.
		expect(screen.getByText(/merged \d+[hm] ago by @lskugor/)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /View on GitHub/i })).toHaveAttribute(
			'href',
			'https://github.com/acme/widget/pull/42'
		);

		await waitFor(() => expect(screen.getByText('Live everywhere')).toBeInTheDocument());
		expect(screen.getByRole('link', { name: 'widget-app' })).toHaveAttribute(
			'href',
			'/apps/widget-app'
		);
	});

	test('document.title leads with the PR, not the product name', async () => {
		stubFetch({});
		renderPage();
		await screen.findByRole('heading', { level: 1, name: 'Add the widget flow' });
		expect(document.title).toBe('#42 Add the widget flow · kuberik');
	});

	test('not connected: the GitHub connect prompt, never the generic error state', async () => {
		stubFetch({
			pull: () =>
				Promise.resolve(
					new Response(JSON.stringify({ error: 'github_not_connected' }), { status: 401 })
				)
		});
		renderPage();
		expect(await screen.findByText('Connect GitHub to see this pull request')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /Connect GitHub/i })).toBeInTheDocument();
	});

	test('not found: names the repo, not a generic failure', async () => {
		stubFetch({
			pull: () =>
				Promise.resolve(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }))
		});
		renderPage();
		expect(
			await screen.findByText('No service on this cluster deploys acme/widget.')
		).toBeInTheDocument();
	});

	test('a transient server error renders the generic ErrorState, not a blank page', async () => {
		stubFetch({
			pull: () => Promise.resolve(new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
		});
		renderPage();
		await waitFor(() => expect(screen.queryByText(/failed/i)).toBeInTheDocument());
	});

	test('open: not merged yet, names the base branch', async () => {
		stubFetch({ pull: () => jsonResponse(pullInfo({ state: 'open', mergedAt: null, mergeCommitSha: null })) });
		renderPage();
		expect(await screen.findByRole('heading', { name: 'Not merged yet' })).toBeInTheDocument();
		expect(screen.getByText(/targets/)).toBeInTheDocument();
		expect(screen.getByText('main', { exact: false })).toBeInTheDocument();
	});

	test('closed: closed without merging, no cards', async () => {
		stubFetch({
			pull: () => jsonResponse(pullInfo({ state: 'closed', mergedAt: null, mergeCommitSha: null }))
		});
		renderPage();
		expect(await screen.findByRole('heading', { name: 'Closed without merging' })).toBeInTheDocument();
	});
});
