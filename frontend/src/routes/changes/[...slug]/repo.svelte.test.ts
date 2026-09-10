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
		// A `PipelineCard` per matching service is the change page's own
		// landmark (route RESOLUTION is what this test owns — the verdict's
		// exact wording is `pr-pipeline.test.ts`'s job).
		await waitFor(() => expect(screen.getByRole('link', { name: 'web' })).toHaveAttribute('href', '/apps/web'));
		expect(screen.getByRole('link', { name: 'api' })).toHaveAttribute('href', '/apps/api');

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
});
