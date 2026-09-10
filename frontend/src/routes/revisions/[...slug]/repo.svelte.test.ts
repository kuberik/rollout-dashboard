import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * ⭐ ROUND 11 (2026-09-09), LANE 3 — `/revisions/<repoSlug>` IS THE
 * REPOSITORY PAGE.
 *
 * Full spec: `.agents-context/design/REVISIONS-2026-09-05.md`, "B. ONE PAGE
 * PER REPOSITORY" — B.1 (resolution order: the WHOLE slug against a known
 * repo, before ever popping a build key off it), B.4 (the repository page
 * itself), B.6 (landmark order), B.9 (states).
 *
 * `deploying.svelte.test.ts` (this route's sibling file) already covers the
 * BUILD page (`/revisions/<repoSlug>/<key>`) in depth and stays green,
 * unchanged, through this round — this file is the repository page's own
 * suite, plus the resolution boundary between the two.
 */
const state = vi.hoisted(() => ({
	page: {
		params: {} as Record<string, string>,
		url: new URL('http://localhost/revisions'),
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

/**
 * Same shape as `BuildLists.svelte.test.ts`'s own `repoFixture`: `r1` is
 * `web`'s current head — this repo's one lead row, so its own hero renders
 * "Newest build … ". `r2` is `api`'s current build, older than the line's
 * own head — "Also still running". `r3` is known (in `availableReleases`)
 * but never deployed — the rail's "No deploy on record". `r4` ran once, on `web`, and
 * nothing runs it now — "No longer running anywhere". One repo, one
 * release line, every build list non-empty — exactly what B.6's landmark
 * pin needs present at once.
 */
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
	state.page.url = new URL(`http://localhost/revisions/${slug}${query}`);
	render(WithQueryClient, { props: { component: Page as any } });
}

describe('/revisions/[...slug] — repository page resolution (B.1)', () => {
	test('the whole slug matches a repository → the repository page, landmark order per B.6', async () => {
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
			// ⭐ LANE 9, ROUND 11 QA, ITEM 13 — the rail's heading is fixed now
			// ('No deploy on record', always); see `BuildLists.svelte`'s own
			// `pendingTitle`.
			'No deploy on record'
		]);
	});

	test('the repository name is a visible h1, not sr-only — B.4 item 2', async () => {
		const { rollouts, environments } = repoFixture();
		stubFetch(rollouts, environments);
		await renderAt(REPO_PATH);
		await waitFor(() => expect(screen.getByText('What each service runs')).toBeInTheDocument());

		const h1 = screen.getByRole('heading', { level: 1, name: 'kuberik-testing' });
		expect(h1.className).not.toContain('sr-only');
	});

	test('the slug plus a build key still resolves to the build page, unchanged', async () => {
		const { rollouts, environments } = repoFixture();
		stubFetch(rollouts, environments);
		const revision = `a111111${'0'.repeat(40)}`.slice(0, 40);
		await renderAt(`${REPO_PATH}/${revision}`);
		await waitFor(() => expect(screen.getByText(/places run this build/)).toBeInTheDocument());

		// The repository-page-only landmark is absent; this is the build page.
		expect(screen.queryByText('What each service runs')).toBeNull();
	});

	test('the build page breadcrumb trail is "All revisions › kuberik-testing", both linking with ?q= carried', async () => {
		const { rollouts, environments } = repoFixture();
		stubFetch(rollouts, environments);
		const revision = `a111111${'0'.repeat(40)}`.slice(0, 40);
		await renderAt(`${REPO_PATH}/${revision}`, '?q=web');
		await waitFor(() => expect(screen.getByText(/places run this build/)).toBeInTheDocument());

		const trail = screen.getByRole('navigation', { name: 'Breadcrumb' });
		const links = Array.from(trail.querySelectorAll('a'));
		expect(links.map((a) => a.textContent?.trim())).toEqual(['All revisions', 'kuberik-testing']);
		expect(links[0].getAttribute('href')).toBe('/revisions?q=web');
		expect(links[1].getAttribute('href')).toContain(`/revisions/${REPO_PATH}`);
		expect(links[1].getAttribute('href')).toContain('q=web');
	});

	/**
	 * ⭐ ROUND 6, LANE 10 — THE NOT-FOUND STATE IS `ErrorState` NOW, THE SAME
	 * OBJECT `/rollouts/<cluster>/<namespace>/<name>` DRAWS FOR THE IDENTICAL
	 * CLASS OF FACT (a successful fetch, object absent). It used to be bare
	 * centred text ("No repository X is known to this dashboard.", a leading
	 * `←`) — the one not-found state in the product with its own grammar.
	 * The generic missing-object copy (`errorHeadline`/`errorConsequence`) is
	 * now the headline and body; the specific slug the reader typed still
	 * survives, in `ErrorState`'s "Address" fact (`errorFacts`), which is
	 * where the rollout page's own missing-object case puts its own
	 * `namespace/name` pair.
	 */
	test('an unknown, single-segment slug gets ErrorState, never a glued repo+revision string — B.9', async () => {
		stubFetch([], []);
		await renderAt('no-such-repo');
		await waitFor(() =>
			expect(screen.getByText('This repository does not exist')).toBeInTheDocument()
		);
		expect(
			screen.getByText((_, node) => node?.textContent === '/revisions/no-such-repo')
		).toBeInTheDocument();
		// The breadcrumb prints "All revisions"; `ErrorState`'s own way out
		// (this file's `backLabel`) prints "Back to all revisions" — same
		// destination, same word, different case and a leading verb.
		const backLinks = screen.getAllByRole('link', { name: /all revisions/i });
		expect(backLinks.length).toBeGreaterThanOrEqual(2); // breadcrumb + the not-found state's own way out
		for (const link of backLinks) expect(link).toHaveAttribute('href', '/revisions');
	});

	/**
	 * ⭐ LANE 9, ROUND 11 QA, ITEM 11 — A MULTI-SEGMENT BOGUS SLUG NAMES THE
	 * WHOLE SLUG, NOT THE POPPED REMAINDER. Before this fix, B.1's "pop the
	 * last segment and try it as a build key" fallback ran even when NEITHER
	 * the whole slug nor the popped repo path was a real repository, so the
	 * not-found state read "No repository github.com/littlechimera is
	 * known … so it cannot hold the revision no-such-repo either" — a repo
	 * path invented by the pop, holding a "revision" that was actually the
	 * one meaningful segment of the URL the reader typed. Now (round 6 lane
	 * 10) the headline is the same generic "This repository does not exist"
	 * either way; what still proves the WHOLE slug survived, not a popped
	 * remainder, is the "Address" fact.
	 */
	test('an unknown, multi-segment slug names the WHOLE slug, not the popped remainder — B.9', async () => {
		stubFetch([], []);
		await renderAt('github.com/littlechimera/no-such-repo');
		await waitFor(() =>
			expect(screen.getByText('This repository does not exist')).toBeInTheDocument()
		);
		expect(
			screen.getByText(
				(_, node) =>
					node?.textContent === '/revisions/github.com/littlechimera/no-such-repo'
			)
		).toBeInTheDocument();
		expect(screen.queryByText(/cannot hold the revision/)).toBeNull();
	});
});
