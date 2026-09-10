import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * THE CHANGE PAGE'S PULL FORM — `/changes/<repo>/pull/<n>`. CHANGES-2026-09-10.md
 * §3: "the change page is ONE page kind", moved here from the superseded
 * `/pr/{owner}/{repo}/{number}` route (which now 308s to this address — see
 * `routes/pr/[owner]/[repo]/[number]/+page.ts`). Covers the states this
 * route itself owns (loading, not_connected, not_found, error, open, closed,
 * merged-with-cards) plus this pass's own additions (the compact
 * `LandingGrid` and the deployment count under the verdict) —
 * `PipelineCard.svelte.test.ts` covers the per-service card in depth and
 * `pr-cell-copy.test.ts` covers every state sentence; this file does not
 * re-derive either. `repo.svelte.test.ts` (this route's sibling) covers the
 * repository-page form and the redirect/not-found boundary; `sha.svelte.test.ts`
 * covers the bare-commit form.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/changes/github.com/acme/widget/pull/42'),
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
		openedAt: null,
		headSha: null,
		changedFiles: null,
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
			if (url === PULL_URL || url.startsWith('/api/github/pulls/acme/widget/')) return pull();
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
	state.page.params = { slug: 'github.com/acme/widget/pull/42' };
	state.page.url = new URL('http://localhost/changes/github.com/acme/widget/pull/42');
	localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function renderPage() {
	return render(WithQueryClient, { props: { component: Page as never } });
}

describe('/changes/[...slug] — pull form', () => {
	test('merged PR: head band, verdict, the deployment count and one card per matching service', async () => {
		stubFetch({
			rollouts: [rollout('widget-app', 'widget-dev', 'c0ffee1', new Date().toISOString())],
			environments: [environment('widget-app', 'widget-dev', 'dev')]
		});
		renderPage();

		expect(await screen.findByRole('heading', { level: 1, name: 'Add the widget flow' })).toBeInTheDocument();
		expect(screen.getByText(/#42 · acme\/widget/)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /View on GitHub/i })).toHaveAttribute(
			'href',
			'https://github.com/acme/widget/pull/42'
		);

		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 2, name: 'Live everywhere' })).toBeInTheDocument()
		);
		// §2/item 3, updated by fix pass item 7, then again by ROUND 2 R2.3
		// ("the grid gets a card") — off `pr-pipeline.ts`'s own
		// rolloutsLive/rolloutsTotal counts, now the "Every rollout" card's
		// own `verdict` rollup rather than a bare sentence. ⭐ ROUND 3, ITEM 5
		// (2026-09-10): "deployed to N of M rollouts", never "have this
		// build" — `rolloutsLive` (not `rolloutsWithBuild`) is the count that
		// actually means deployed.
		expect(screen.getByText('deployed to 1 of 1 rollouts')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'widget-app' })).toHaveAttribute('href', '/apps/widget-app');
	});

	// ⭐ ROUND 3 (2026-09-10 ruling A, "NO RELEASE MEANS NOT AFFECTED")
	// SUPERSEDES item 4's own premise. `widget-manifests` never released this
	// exact commit (its own only release, `unrelated-1`, is not it) — under
	// ruling A that means the service is UNAFFECTED and `buildPrPipeline`
	// drops it entirely (`unaffectedServices`, debug-only), rather than the
	// page naming it in a secondary "not built yet" line. `widget-app` alone
	// still reads live everywhere.
	test('item 4 (⭐ ROUND 3 ruling A): a service with no release evidence is dropped, never named in a secondary line', async () => {
		stubFetch({
			rollouts: [
				rollout('widget-app', 'widget-dev', 'c0ffee1', new Date().toISOString()),
				rollout('widget-manifests', 'widget-manifests-dev', 'unrelated-1', '2026-08-01T00:00:00Z')
			],
			environments: [
				environment('widget-app', 'widget-dev', 'dev'),
				environment('widget-manifests', 'widget-manifests-dev', 'dev')
			]
		});
		renderPage();
		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 2, name: 'Live everywhere' })).toBeInTheDocument()
		);
		expect(screen.queryByText(/widget-manifests/)).not.toBeInTheDocument();
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

	test('not found, scope=repo: names the repo, not a generic failure', async () => {
		stubFetch({
			pull: () =>
				Promise.resolve(new Response(JSON.stringify({ error: 'not_found', scope: 'repo' }), { status: 404 }))
		});
		renderPage();
		expect(
			await screen.findByText('No service on this cluster deploys acme/widget.')
		).toBeInTheDocument();
	});

	test('not found, scope=pr: a wrong PR number — links to GitHub search and hints ⌘K', async () => {
		stubFetch({
			pull: () =>
				Promise.resolve(new Response(JSON.stringify({ error: 'not_found', scope: 'pr' }), { status: 404 }))
		});
		state.page.params = { slug: 'github.com/acme/widget/pull/999' };
		state.page.url = new URL('http://localhost/changes/github.com/acme/widget/pull/999');
		renderPage();
		expect(await screen.findByRole('heading', { name: 'PR not found' })).toBeInTheDocument();
		expect(
			screen.getByText(/PR #999 not found in acme\/widget \(or you cannot see it\)/)
		).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /search acme\/widget's pull requests on GitHub/i })).toHaveAttribute(
			'href',
			'https://github.com/acme/widget/pulls?q=is%3Apr'
		);
	});

	test('open: not merged yet, names the base branch', async () => {
		stubFetch({ pull: () => jsonResponse(pullInfo({ state: 'open', mergedAt: null, mergeCommitSha: null })) });
		renderPage();
		expect(await screen.findByRole('heading', { name: 'Not merged yet' })).toBeInTheDocument();
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
