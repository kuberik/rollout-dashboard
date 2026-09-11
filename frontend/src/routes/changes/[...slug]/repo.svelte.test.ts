import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * `/changes/<repoSlug>` — THE REPOSITORY PAGE, moved here from
 * `routes/revisions/[...slug]/repo.svelte.test.ts` (CHANGES-2026-09-10.md
 * §1/§3: "KEPT, as `/changes/<repo>`" — renamed and relinked, otherwise
 * untouched). Also covers the resolution boundary CHANGES-2026-09-10 adds:
 * the whole-slug repository match still runs FIRST (unchanged from B.1),
 * and only once it fails does a `pull/<n>` tail or a bare build key decide
 * which of the change page's two forms renders (`pull.svelte.test.ts` /
 * `sha.svelte.test.ts`, this route's siblings).
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
import { render, screen, waitFor } from '@testing-library/svelte';
import { configure } from '@testing-library/svelte';

configure({ asyncUtilTimeout: 5000 });

import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Page from './+page.svelte';
import type { Environment, Rollout } from '../../../types';

const NOW = Date.now();
const REPO_PATH = 'github.com/acme/kuberik-testing';
const REPO_SOURCE = 'https://github.com/acme/kuberik-testing.git';

function rel(sha: string, minutesAgo: number) {
	return {
		tag: `main-${sha}`,
		revision: `${sha}${'0'.repeat(40)}`.slice(0, 40),
		created: new Date(NOW - minutesAgo * 60_000).toISOString()
	};
}
type Rel = ReturnType<typeof rel>;

function rollout(
	name: string,
	ns: string,
	releases: Rel[],
	history: { r: Rel; minutesAgo: number }[]
): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source: REPO_SOURCE,
			availableReleases: [...releases].reverse(),
			history: history.map((h) => ({
				version: h.r,
				timestamp: new Date(NOW - h.minutesAgo * 60_000).toISOString(),
				bakeStatus: 'Succeeded'
			}))
		}
	} as unknown as Rollout;
}

function environment(app: string, ns: string, tier: string): Environment {
	return {
		metadata: { name: app, namespace: ns },
		spec: { environment: tier, name: app, rolloutRef: { name: app } }
	} as unknown as Environment;
}

function repoFixture() {
	const r1 = rel('a111111', 10);
	const r2 = rel('a222222', 200);
	const r3 = rel('a333333', 400);
	const r4 = rel('a444444', 600);
	const releases = [r1, r2, r3, r4];
	const web = rollout('web', 'team', releases, [
		{ r: r1, minutesAgo: 10 },
		{ r: r4, minutesAgo: 600 }
	]);
	const api = rollout('api', 'team', releases, [{ r: r2, minutesAgo: 200 }]);
	return {
		rollouts: [web, api],
		environments: [environment('web', 'team', 'prod'), environment('api', 'team', 'prod')]
	};
}

function stubFetch(rollouts: Rollout[], environments: Environment[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok: true,
			json: async () => ({
				rollouts: { items: rollouts },
				environments: { items: environments }
			})
		}))
	);
}

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function headingTexts(): string[] {
	return screen.getAllByRole('heading').map((h) => h.textContent?.trim() ?? '');
}

async function renderAt(slug: string, query = '') {
	state.page.params = { slug };
	state.page.url = new URL(`http://localhost/changes/${slug}${query}`);
	render(WithQueryClient, { props: { component: Page as any } });
}

describe('/changes/[...slug] — repository page resolution', () => {
	test('the whole slug matches a repository → the repository page, landmark order unchanged', async () => {
		const { rollouts, environments } = repoFixture();
		stubFetch(rollouts, environments);
		await renderAt(REPO_PATH);

		await waitFor(() => expect(screen.getByText('What each service runs')).toBeInTheDocument());

		expect(headingTexts()).toEqual([
			'kuberik-testing',
			'What each service runs',
			'Newest build a111111 · api · web',
			'Also still running',
			'No longer running anywhere',
			'No deploy on record'
		]);
	});

	test('the repository name is a visible h1, not sr-only', async () => {
		const { rollouts, environments } = repoFixture();
		stubFetch(rollouts, environments);
		await renderAt(REPO_PATH);
		await waitFor(() => expect(screen.getByText('What each service runs')).toBeInTheDocument());

		const h1 = screen.getByRole('heading', { level: 1, name: 'kuberik-testing' });
		expect(h1.className).not.toContain('sr-only');
	});

	test('document title is "kuberik | <repo> changes"', async () => {
		const { rollouts, environments } = repoFixture();
		stubFetch(rollouts, environments);
		await renderAt(REPO_PATH);
		await waitFor(() => expect(document.title).toBe('kuberik | kuberik-testing changes'));
	});

	test('the slug plus a build key with no PR resolves to the sha form of the change page', async () => {
		const { rollouts, environments } = repoFixture();
		stubFetch(rollouts, environments);
		const revision = `a111111${'0'.repeat(40)}`.slice(0, 40);
		await renderAt(`${REPO_PATH}/${revision}`);
		// A `PipelineCard` per matching service WITH A BUILD is the change
		// page's own landmark (route RESOLUTION is what this test owns — the
		// verdict's exact wording is `pr-pipeline.test.ts`'s job). `web`'s own
		// head IS this exact sha, so it gets a card; `api` has never built it
		// (⭐ ROUND 2, R2.3 — "a service with no build of this change is a NAME
		// IN A SENTENCE", not a card any more) and is named in the grid
		// card's own "Not built yet for …" line instead of a link here.
		await waitFor(() => expect(screen.getByRole('link', { name: 'web' })).toHaveAttribute('href', '/apps/web'));
		expect(screen.queryByRole('link', { name: 'api' })).toBeNull();
		expect(screen.getByText(/Not built yet for api/)).toBeInTheDocument();

		// The repository-page-only landmark is absent; this is the change page.
		expect(screen.queryByText('What each service runs')).toBeNull();
		// No breadcrumb on the change page itself (superseded `/pr/…` route's
		// own explicit decision, carried over).
		expect(screen.queryByRole('navigation', { name: 'Breadcrumb' })).toBeNull();
	});

	test('the slug plus `pull/<n>` resolves to the pull form of the change page', async () => {
		const { rollouts, environments } = repoFixture();
		// Only the rollouts/environments fetch matters here — the pull's own
		// GitHub fetch is covered by `pull.svelte.test.ts`; this asserts only
		// that the ROUTE dispatches to that form rather than the repo page.
		stubFetch(rollouts, environments);
		await renderAt(`${REPO_PATH}/pull/4`);
		await waitFor(() => expect(screen.queryByText('What each service runs')).toBeNull());
	});

	test('an unknown, single-segment slug gets ErrorState, never a glued repo+revision string', async () => {
		stubFetch([], []);
		await renderAt('no-such-repo');
		await waitFor(() =>
			expect(screen.getByText('This repository does not exist')).toBeInTheDocument()
		);
		expect(
			screen.getByText((_, node) => node?.textContent === '/changes/no-such-repo')
		).toBeInTheDocument();
		const backLinks = screen.getAllByRole('link', { name: /all changes/i });
		expect(backLinks.length).toBeGreaterThanOrEqual(2); // breadcrumb + the not-found state's own way out
		for (const link of backLinks) expect(link).toHaveAttribute('href', '/changes');
	});

	test('an unknown, multi-segment slug (not a valid github.com/owner/repo) names the WHOLE slug, not the popped remainder', async () => {
		stubFetch([], []);
		await renderAt('github.com/littlechimera/no-such-repo');
		await waitFor(() =>
			expect(screen.getByText('This repository does not exist')).toBeInTheDocument()
		);
		expect(
			screen.getByText(
				(_, node) => node?.textContent === '/changes/github.com/littlechimera/no-such-repo'
			)
		).toBeInTheDocument();
		expect(screen.queryByText(/cannot hold the revision/)).toBeNull();
	});

	// ══ ROUND 2, R2.4 — "CHANGES IN THIS REPOSITORY" ADOPTS THE INDEX'S OWN
	// TWO SECTIONS ═══════════════════════════════════════════════════════════

	function stubFetchWithChanges(rollouts: Rollout[], environments: Environment[], changes: unknown[]) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (url.startsWith('/api/github/changes')) {
					return {
						ok: true,
						json: async () => ({ user: 'acme', repos: [REPO_PATH], since: new Date(0).toISOString(), changes })
					};
				}
				if (url === '/api/auth/github/status') {
					return { ok: true, json: async () => ({ configured: true, connected: true }) };
				}
				return {
					ok: true,
					json: async () => ({ rollouts: { items: rollouts }, environments: { items: environments } })
				};
			})
		);
	}

	test('GitHub connected: the compact "Changes" list renders above "What each service runs" (ROUND 3 RULING B)', async () => {
		const liveRel = rel('a1', 10);
		const liveSha = liveRel.revision;
		const web = rollout('web', 'team', [liveRel], [{ r: liveRel, minutesAgo: 10 }]);
		const environments = [environment('web', 'team', 'prod')];

		stubFetchWithChanges(
			[web],
			environments,
			[
				{
					owner: 'acme',
					repo: 'kuberik-testing',
					kind: 'pr',
					number: 4,
					title: 'fix(frontend): retry on 502',
					htmlUrl: 'https://github.com/acme/kuberik-testing/pull/4',
					author: 'lskugor',
					mergedAt: new Date(NOW - 5 * 3600_000).toISOString(),
					mergeCommitSha: 'c0ffee1'.padEnd(40, '0'),
					base: 'main',
					containedIn: ['c0ffee1'.padEnd(40, '0')],
					// ⚠️ `false`, DELIBERATELY — `true` (a truncated since-list) lets
					// `pr-pipeline.ts`'s own `containment()` fall back to "a release
					// CREATED after this PR's merge counts as containing it", which
					// `web`'s single fixture release (created only 10 minutes ago)
					// satisfied against a PR "merged" 5 hours ago — this change read
					// as already live everywhere instead of not-built. `false` means
					// the list is COMPLETE, so absence from it is authoritative: this
					// service has not built the change, full stop.
					containedInAll: false
				},
				{
					owner: 'acme',
					repo: 'kuberik-testing',
					kind: 'commit',
					title: 'Everywhere already',
					htmlUrl: 'https://github.com/acme/kuberik-testing/commit/' + liveSha,
					author: 'lskugor',
					mergedAt: new Date(NOW - 2 * 3600_000).toISOString(),
					mergeCommitSha: liveSha,
					base: 'main',
					containedIn: [liveSha],
					containedInAll: true
				}
			]
		);
		await renderAt(REPO_PATH);

		await waitFor(() => expect(screen.getByText('Changes')).toBeInTheDocument());
		// ⛔ FIX PASS ITEM 1 (2026-09-11) — the section is a `Card` now, and
		// the live-everywhere commit is the whole "live run", folded behind
		// one `.nav-link` line rather than shown as a `ChangeLine` row (the
		// SAME fold `/changes`' own "Your changes" applies) — no "Not
		// everywhere yet"/"Live everywhere" split, no landing grid.
		expect(screen.getByText('1 change · all live everywhere ›')).toBeInTheDocument();
		expect(screen.queryByText('Everywhere already')).toBeNull();
		// ⭐ ROUND 3B (2026-09-10) — "NO RELEASE MEANS NOT AFFECTED, AND MUST
		// NOT COMPETE". `web` (this repo's only rollout) carries no release
		// evidence anywhere for PR #4's own sha — it is `noRelease`, folded
		// behind the muted footer line rather than shown as a normal row or
		// counted as "not everywhere yet" (a fact about a DEPLOYABLE change
		// that has not reached every environment, which this one is not).
		expect(screen.queryByText(/retry on 502/)).toBeNull();
		expect(screen.queryByText(/not everywhere yet/)).toBeNull();
		expect(screen.getByText('1 commit produced no release ›')).toBeInTheDocument();
		// The section precedes the ops content, landmark order unchanged below
		// it (R2.4's own pin, restated for the round-3 single section).
		const headings = headingTexts();
		expect(headings.indexOf('Changes')).toBeLessThan(headings.indexOf('What each service runs'));
	});
});
