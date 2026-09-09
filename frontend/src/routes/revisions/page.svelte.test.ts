import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * ⭐ ROUND 11 (2026-09-09), LANE 2 — `/revisions` IS NOW THE INDEX ONLY.
 *
 * Full spec: `.agents-context/design/REVISIONS-2026-09-05.md`, "B. ONE PAGE
 * PER REPOSITORY", specifically B.2 (the index card), B.3, B.5 (`?q=`), B.6
 * (index landmarks), B.7 (one repository still renders), B.8/B.9
 * (skeleton/states).
 *
 * EVERY BUILD-LIST HEADING ("Also still running", "No longer running
 * anywhere", "Never deployed") LEFT THIS FILE. They moved to
 * `/revisions/<repoSlug>` (lane 3's route) along with the hero and the held
 * banner — see `RepoLedgerCard.svelte.test.ts`, `BuildLists.svelte.test.ts`
 * and `HeldBanner.svelte.test.ts` for the components this file's old tests
 * were split across.
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

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	state.page.url = new URL('http://localhost/revisions');
	vi.mocked(goto).mockClear();
});

import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { configure } from '@testing-library/svelte';

configure({ asyncUtilTimeout: 5000 });
import { goto } from '$app/navigation';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Page from './+page.svelte';
import type { Environment, Rollout } from '../../types';
import { repoSlug } from '$lib/version-utils';

const NOW = Date.now();

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
	source: string,
	releases: Rel[],
	history: { r: Rel; minutesAgo: number }[]
): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source,
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

/** One repo, one service, one deployed head — the minimal non-empty fleet. */
function repoFixture(prefix: string, source: string) {
	const head = rel(`${prefix}111111`, 10);
	const svc = rollout(`${prefix}-app`, 'team', source, [head], [{ r: head, minutesAgo: 10 }]);
	return {
		rollouts: [svc],
		environments: [environment(`${prefix}-app`, 'team', 'prod')]
	};
}

/** A held place: `allowedVersions: []` refuses every candidate. */
function heldFixture() {
	const head = rel('held1111', 5);
	const older = rel('held0000', 200);
	const svc = rollout('held-app', 'team', 'https://github.com/acme/held.git', [head, older], [
		{ r: older, minutesAgo: 200 }
	]);
	(svc as unknown as { status: { gates: unknown[] } }).status.gates = [
		{
			name: 'no-promotion',
			type: 'AllowedVersions',
			pending: false,
			conditions: [{ type: 'Passing', status: 'False' }],
			allowedVersions: []
		}
	];
	return {
		rollouts: [svc],
		environments: [environment('held-app', 'team', 'prod')]
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

afterEach(() => {
	vi.unstubAllGlobals();
});

async function renderRevisions() {
	render(WithQueryClient, { props: { component: Page as any } });
	// The first repository card's header is the first non-skeleton thing any
	// non-empty fleet renders once the query settles.
	await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0));
}

function headingTexts(): string[] {
	return screen.getAllByRole('heading').map((h) => h.textContent?.trim() ?? '');
}

describe('/revisions — the index (round 11, B.2/B.6)', () => {
	test('one repository: landmark order is [Revisions, repo-a] — B.6', async () => {
		const { rollouts, environments } = repoFixture('a', 'https://github.com/acme/repo-a.git');
		stubFetch(rollouts, environments);
		await renderRevisions();
		expect(headingTexts()).toEqual(['Revisions', 'repo-a']);
	});

	test('two repositories: landmark order is [Revisions, repo-a, repo-b] — B.6', async () => {
		const a = repoFixture('a', 'https://github.com/acme/repo-a.git');
		const b = repoFixture('b', 'https://github.com/acme/repo-b.git');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();
		expect(headingTexts()).toEqual(['Revisions', 'repo-a', 'repo-b']);
	});

	test('no bar, no hero, no build lists, no held banner on the index — B.2.5', async () => {
		const { rollouts, environments } = heldFixture();
		stubFetch(rollouts, environments);
		await renderRevisions();
		expect(screen.queryByText(/^Newest build ·/)).toBeNull();
		expect(screen.queryByText('Also still running')).toBeNull();
		expect(screen.queryByText('No longer running anywhere')).toBeNull();
		expect(screen.queryByText('Never deployed')).toBeNull();
		expect(screen.queryByText(/is held$/)).toBeNull(); // the held banner's own title shape
	});

	test('a repository with a held ledger line draws the ONE unified HELD spelling — craft review (b)', async () => {
		// Row-level unification is asserted in depth in
		// `RepoLedgerCard.svelte.test.ts`; here it is enough to prove the
		// index actually renders a held line as the joined alarm chip, not
		// the old quiet outlined `HELD` beside a separate rank chip.
		const { rollouts, environments } = heldFixture();
		stubFetch(rollouts, environments);
		await renderRevisions();
		expect(screen.getByText('HELD')).toBeInTheDocument();
	});

	test('an unheld repository reads "Everything on its newest build"', async () => {
		const { rollouts, environments } = repoFixture('a', 'https://github.com/acme/repo-a.git');
		stubFetch(rollouts, environments);
		await renderRevisions();
		expect(screen.getByText('Everything on its newest build')).toBeInTheDocument();
	});

	test('the card header is ONE <a> to the repository page; "Open on GitHub" is a separate <a> in the footer; no nested anchors', async () => {
		const { rollouts, environments } = repoFixture('a', 'https://github.com/acme/repo-a.git');
		stubFetch(rollouts, environments);
		const { container } = await (async () => {
			await renderRevisions();
			return { container: document.body };
		})();
		const headerLink = container.querySelector('a.tap-zone');
		expect(headerLink).not.toBeNull();
		expect(headerLink!.getAttribute('href')).toBe(`/revisions/${repoSlug('repo:github.com/acme/repo-a')}`);
		expect(headerLink!.querySelector('a')).toBeNull();
		expect(container.querySelectorAll('a').length).toBeGreaterThan(1);
	});

	test('one repository: the ledger is uncapped and the head band has no "· 1 repository"', async () => {
		const { rollouts, environments } = repoFixture('a', 'https://github.com/acme/repo-a.git');
		stubFetch(rollouts, environments);
		await renderRevisions();
		expect(screen.queryByText(/1 repository/)).toBeNull();
	});

	test('two repositories: the head band names the count', async () => {
		const a = repoFixture('a', 'https://github.com/acme/repo-a.git');
		const b = repoFixture('b', 'https://github.com/acme/repo-b.git');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();
		expect(screen.getByText(/2 repositories/)).toBeInTheDocument();
	});

	test('empty fleet — "Nothing built yet"', async () => {
		stubFetch([], []);
		render(WithQueryClient, { props: { component: Page as any } });
		await waitFor(() => expect(screen.getByText('Nothing built yet')).toBeInTheDocument());
	});
});

describe('/revisions — `?q=` at the index (B.5)', () => {
	test('the query lives in the URL as ?q=, deep-linkable and read on load', async () => {
		const { rollouts, environments } = repoFixture('a', 'https://github.com/acme/repo-a.git');
		stubFetch(rollouts, environments);
		state.page.url = new URL('http://localhost/revisions?q=a111111');
		await renderRevisions();
		expect((screen.getByPlaceholderText('Find a build or service') as HTMLInputElement).value).toBe(
			'a111111'
		);
	});

	test('typing pushes ?q= into the URL without spamming history (replaceState)', async () => {
		const { rollouts, environments } = repoFixture('a', 'https://github.com/acme/repo-a.git');
		stubFetch(rollouts, environments);
		await renderRevisions();
		const input = screen.getByPlaceholderText('Find a build or service');
		await fireEvent.input(input, { target: { value: 'a111111' } });
		await waitFor(() => expect(goto).toHaveBeenCalled());
		const [url, opts] = vi.mocked(goto).mock.calls.at(-1)!;
		expect(url).toContain('q=a111111');
		expect(opts).toMatchObject({ replaceState: true });
	});

	test('a repo with no match keeps its card and prints "No build matches" with the header saying "no match" — B.5', async () => {
		const { rollouts, environments } = repoFixture('a', 'https://github.com/acme/repo-a.git');
		stubFetch(rollouts, environments);
		await renderRevisions();
		const input = screen.getByPlaceholderText('Find a build or service');
		await fireEvent.input(input, { target: { value: 'zzzzzzz' } });
		await waitFor(() => expect(screen.getByText('no match')).toBeInTheDocument());
		expect(screen.getByText(/No build matches/)).toBeInTheDocument();
		// The zero-result search does not resurrect the fleet's held/behind
		// verdict beside it — finding 6.
		expect(screen.queryByText(/held/)).toBeNull();
	});

	test('under a filter the repository rollup reads "{n} of {m} builds" — B.5', async () => {
		const head = rel('a111111', 10);
		const older = rel('a222222', 200);
		const svc = rollout('a-app', 'team', 'https://github.com/acme/repo-a.git', [head, older], [
			{ r: head, minutesAgo: 10 }
		]);
		stubFetch([svc], [environment('a-app', 'team', 'prod')]);
		await renderRevisions();
		const input = screen.getByPlaceholderText('Find a build or service');
		await fireEvent.input(input, { target: { value: 'a111111' } });
		await waitFor(() => expect(screen.getByText(/1 of 2 builds/)).toBeInTheDocument());
	});

	test('a query matching a release LABEL finds the build in its repository card — finding 1 (BLOCKING)', async () => {
		const head = { tag: 'main-9f10e49', version: '2.67.0-67', revision: '9f10e494d5601111111111111111111111111111', created: new Date(NOW - 10 * 60_000).toISOString() };
		const svc = rollout('api', 'team', 'https://github.com/acme/repo-a.git', [head as Rel], [
			{ r: head as Rel, minutesAgo: 10 }
		]);
		stubFetch([svc], [environment('api', 'team', 'prod')]);
		await renderRevisions();
		const input = screen.getByPlaceholderText('Find a build or service');
		await fireEvent.input(input, { target: { value: '2.67.0-67' } });
		await waitFor(() => expect(screen.queryByText('no match')).toBeNull());
		expect(screen.getByText('api')).toBeInTheDocument();
		expect(screen.getByText(/1 build matches/)).toBeInTheDocument();
	});
});
