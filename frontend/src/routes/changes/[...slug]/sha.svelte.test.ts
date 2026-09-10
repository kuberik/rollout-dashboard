import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * `/changes/<repo>/<sha>` — THE CHANGE PAGE'S SHA FORM (CHANGES-2026-09-10.md
 * §3): "the change page is ONE page kind" — a bare commit with no PR behind
 * it renders the SAME body as the pull form (`pull.svelte.test.ts`), built
 * off a `PrPipelineMeta` with `containedIn: []`, `containedInAll: false`
 * (exact membership). Covers: the title resolution (a PR title via
 * `commits/:sha/pulls` when GitHub resolves one, else the short sha), a sha
 * this cluster has never built (item 8 — still a real page, never a 404),
 * and the "no linked GitHub repository" degrade for an `app:`-fallback repo.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/changes'),
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
import type { Environment, Rollout } from '../../../types';

const NOW = Date.now();
const REPO_PATH = 'github.com/acme/kuberik-testing';
const REPO_SOURCE = 'https://github.com/acme/kuberik-testing.git';
const SHA = 'a1111111112222222222333333333344444444';

function rollout(name: string, ns: string, revision: string | null, source = REPO_SOURCE): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source,
			availableReleases: revision ? [{ tag: `main-${revision.slice(0, 7)}`, revision, created: new Date(NOW).toISOString() }] : [],
			history: revision
				? [{ version: { tag: `main-${revision.slice(0, 7)}`, revision }, timestamp: new Date(NOW).toISOString(), bakeStatus: 'Succeeded' }]
				: []
		}
	} as unknown as Rollout;
}

function environment(app: string, ns: string, tier: string): Environment {
	return {
		metadata: { name: app, namespace: ns },
		spec: { environment: tier, name: app, rolloutRef: { name: app } }
	} as unknown as Environment;
}

function jsonResponse(body: unknown, status = 200) {
	return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function stubFetch(opts: {
	rollouts?: Rollout[];
	environments?: Environment[];
	commitPulls?: () => Promise<Response>;
	commitDetail?: () => Promise<Response>;
	githubConnected?: boolean;
}) {
	vi.stubGlobal(
		'fetch',
		vi.fn((url: string) => {
			if (url === '/api/rollouts') {
				return jsonResponse({
					rollouts: { items: opts.rollouts ?? [] },
					environments: { items: opts.environments ?? [] }
				});
			}
			if (url === '/api/cluster') return jsonResponse({ url: 'https://hub', name: 'hub' });
			if (url === '/api/auth/github/status') {
				return jsonResponse({ connected: opts.githubConnected ?? false });
			}
			if (url.includes('/commits/') && url.includes('/pulls')) {
				return (opts.commitPulls ?? (() => jsonResponse([])))();
			}
			// ITEM 4 — GET /api/github/repos/:owner/:repo/commits/:sha (no
			// `/pulls` suffix): the bare-commit lookup this file's own
			// "item 4" test exercises. Checked AFTER the `/pulls` branch
			// above, since that URL also contains `/commits/`.
			if (url.includes('/commits/')) {
				return (opts.commitDetail ?? (() => jsonResponse({})))();
			}
			return jsonResponse({});
		})
	);
}

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function renderAt(slug: string) {
	state.page.params = { slug };
	state.page.url = new URL(`http://localhost/changes/${slug}`);
	return render(WithQueryClient, { props: { component: Page as never } });
}

describe('/changes/[...slug] — sha form', () => {
	test('a build with no PR: title falls back to the short sha, subtitle names the repo, "View commit" links to GitHub', async () => {
		stubFetch({
			rollouts: [rollout('web', 'team', SHA)],
			environments: [environment('web', 'team', 'prod')]
		});
		renderAt(`${REPO_PATH}/${SHA}`);

		expect(await screen.findByRole('heading', { level: 1, name: 'a111111' })).toBeInTheDocument();
		expect(screen.getByText(/a111111 · acme\/kuberik-testing/)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /View commit/i })).toHaveAttribute(
			'href',
			`https://github.com/acme/kuberik-testing/commit/${SHA}`
		);
		await waitFor(() => expect(screen.getByRole('link', { name: 'web' })).toBeInTheDocument());
	});

	test('item 4: a build with no PR but a resolved commit — title is the subject, subtitle is "committed N ago by @who"', async () => {
		const committedAt = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
		stubFetch({
			rollouts: [rollout('web', 'team', SHA)],
			environments: [environment('web', 'team', 'prod')],
			githubConnected: true,
			commitPulls: () => jsonResponse([]),
			commitDetail: () =>
				jsonResponse({
					sha: SHA,
					subject: 'Fix the flaky retry loop',
					author: 'jane',
					committedAt,
					htmlUrl: `https://github.com/acme/kuberik-testing/commit/${SHA}`
				})
		});
		renderAt(`${REPO_PATH}/${SHA}`);

		expect(
			await screen.findByRole('heading', { level: 1, name: 'Fix the flaky retry loop' })
		).toBeInTheDocument();
		expect(screen.getByText(/committed 3d ago by @jane/)).toBeInTheDocument();
	});

	test('a sha this cluster has never built anywhere still renders a page — never a 404', async () => {
		stubFetch({
			rollouts: [rollout('web', 'team', 'somethingelse0000000000000000000000000')],
			environments: [environment('web', 'team', 'prod')]
		});
		renderAt(`${REPO_PATH}/${SHA}`);

		await screen.findByRole('heading', { level: 1, name: 'a111111' });
		// buildPrPipeline's own "not built here" state — an honest answer,
		// not an error page. (The word "not built yet" also appears on the
		// card's own rollup and row sentence, so this asserts the VERDICT
		// heading specifically, not a bare text match.)
		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 2, name: 'Not built yet' })).toBeInTheDocument()
		);
		expect(screen.queryByText('This repository does not exist')).toBeNull();
	});

	test('item 3: the deployment count is a number, not an inference from row-counting', async () => {
		stubFetch({
			rollouts: [rollout('web', 'team', SHA), rollout('api', 'team', SHA)],
			environments: [environment('web', 'team', 'prod'), environment('api', 'team', 'prod')]
		});
		renderAt(`${REPO_PATH}/${SHA}`);
		await waitFor(() => expect(screen.getByText(/2 rollouts would get it/)).toBeInTheDocument());
	});

	test('a build with no linked GitHub repository degrades honestly, no crash', async () => {
		stubFetch({
			rollouts: [rollout('legacy-app', 'team', SHA, '')],
			environments: [environment('legacy-app', 'team', 'prod')]
		});
		// No `status.source` at all → `repoKeyFor` falls back to `app:<name>`,
		// whose URL body is the bare app name (`repoSlug`/`repoBody` strip the
		// internal `app:` discriminator) — never a "changes" concept, since
		// there is no repository to build a PR/commit reference from.
		renderAt(`legacy-app/${SHA}`);
		await waitFor(() =>
			expect(screen.getByText(/no linked GitHub repository/i)).toBeInTheDocument()
		);
	});
});
