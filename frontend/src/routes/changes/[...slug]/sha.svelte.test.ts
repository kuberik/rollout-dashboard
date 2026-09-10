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

	/**
	 * ⭐ FIX PASS ITEM 2 (2026-09-10) REGRESSION — "SUPERSEDED IS LIVE, EVEN
	 * ON THE BARE-SHA PAGE". The bug, live: `0afab6f35627` read "Rolled back
	 * in dev" although the deployed HEAD (`f7a46ae…`) is a NEWER commit that
	 * carries this exact change (`commits/0afab6f35627`'s own `containedIn`
	 * includes it — confirmed live, see `api/commit.ts`'s doc comment).
	 * `shaMeta` used to hardcode `containedIn: []`, so `buildCell`'s RULE 1
	 * (`set.has(headRevision)`) could never see that the head descends from
	 * this sha, and fell through to RULE 2's "an older entry has it, HEAD
	 * does not" — a real rollback's own signature, misapplied here.
	 */
	test('item 2: a sha whose deployed HEAD is a newer commit containing it reads live, not rolled back', async () => {
		const NEWER_HEAD = 'cccccccccc2222222222333333333344444444';
		stubFetch({
			rollouts: [
				{
					metadata: { name: 'web', namespace: 'team' },
					spec: {},
					status: {
						source: REPO_SOURCE,
						availableReleases: [],
						history: [
							{
								version: { tag: 'main-cccccccccc', revision: NEWER_HEAD },
								timestamp: new Date(NOW).toISOString(),
								bakeStatus: 'Succeeded'
							},
							{
								version: { tag: 'main-a1111111', revision: SHA },
								timestamp: new Date(NOW - 60_000).toISOString(),
								bakeStatus: 'Succeeded'
							}
						]
					}
				} as unknown as Rollout
			],
			environments: [environment('web', 'team', 'prod')],
			githubConnected: true,
			commitPulls: () => jsonResponse([]),
			commitDetail: () =>
				jsonResponse({
					sha: SHA,
					subject: 'Add patch',
					author: 'octocat',
					committedAt: new Date(NOW - 2 * 60_000).toISOString(),
					htmlUrl: `https://github.com/acme/kuberik-testing/commit/${SHA}`,
					containedIn: [NEWER_HEAD],
					containedInAll: false
				})
		});
		renderAt(`${REPO_PATH}/${SHA}`);

		await screen.findByRole('heading', { level: 1 });
		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 2, name: /^Live/ })).toBeInTheDocument()
		);
		expect(screen.queryByText(/Rolled back/i)).toBeNull();
	});

	/**
	 * The other half of item 2's own regression: a sha whose HEAD really did
	 * move to something OLDER (a genuine rollback) must keep reading
	 * "rolled back" — wiring real `containedIn` data in must not turn every
	 * bare-sha page into "live" by default. Mirrors the live fixture's own
	 * `51b976affa37` case, named in the fix pass spec.
	 */
	test('a sha whose deployed HEAD genuinely rolled back to something older stays rolled back', async () => {
		const OLDER_HEAD = 'eeeeeeeeee2222222222333333333344444444';
		stubFetch({
			rollouts: [
				{
					metadata: { name: 'web', namespace: 'team' },
					spec: {},
					status: {
						source: REPO_SOURCE,
						availableReleases: [],
						history: [
							{
								version: { tag: 'main-eeeeeeeeee', revision: OLDER_HEAD },
								timestamp: new Date(NOW).toISOString(),
								bakeStatus: 'Succeeded'
							},
							{
								version: { tag: 'main-a1111111', revision: SHA },
								timestamp: new Date(NOW - 60_000).toISOString(),
								bakeStatus: 'Succeeded'
							}
						]
					}
				} as unknown as Rollout
			],
			environments: [environment('web', 'team', 'prod')],
			githubConnected: true,
			commitPulls: () => jsonResponse([]),
			// Real ancestry: the current (older) head is NOT in this sha's own
			// containedIn — it never descended from it, a genuine rollback.
			commitDetail: () =>
				jsonResponse({
					sha: SHA,
					subject: 'Add patch',
					author: 'octocat',
					committedAt: new Date(NOW - 2 * 60_000).toISOString(),
					htmlUrl: `https://github.com/acme/kuberik-testing/commit/${SHA}`,
					containedIn: [],
					containedInAll: false
				})
		});
		renderAt(`${REPO_PATH}/${SHA}`);

		await screen.findByRole('heading', { level: 1 });
		await waitFor(() =>
			expect(screen.getByRole('heading', { level: 2, name: /Rolled back/i })).toBeInTheDocument()
		);
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
		// Fix pass item 7 — "N of M rollouts have a build of this change",
		// off `pr-pipeline.ts`'s own rolloutsWithBuild/rolloutsTotal counts.
		await waitFor(() =>
			expect(screen.getByText(/2 of 2 rollouts have a build of this change/)).toBeInTheDocument()
		);
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
