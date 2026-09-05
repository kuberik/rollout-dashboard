import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// The page remembers its last shape (repository count) in localStorage via
// `skeleton-hints`; another test file in the same worker can leave a value
// behind, which once made the two-repo test fail only when run alongside
// `src/lib/messages`. Start every test from a clean store.
beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
});
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import WithQueryClient from '$lib/testing/WithQueryClient.svelte';
import Page from './+page.svelte';
import type { Environment, Rollout } from '../../types';

/**
 * ONE CONSISTENT BLOCK PER REPOSITORY (second repo, 2026-09-05).
 *
 * A second source repo appeared on the live fleet and `/revisions` gave only
 * `ledgers[0]` a hero — every other repo's newest build was demoted to a
 * plain "Still running" row, and the repo IDENTITY card (name, services, the
 * three figures, `View repository`) sat in the rail with no indication of
 * WHICH repo it belonged to. The fix makes every repo render the identical
 * sequence: its own hero, "Also still running", "No longer running
 * anywhere", and its own "Never deployed" — and, past one repo, a section
 * header names which repository each block is about.
 *
 * THE HARD CONSTRAINT THIS SUITE EXISTS TO PIN: with exactly one repository
 * the page must render byte-identical to before this round, except the head
 * band's own "N repositories" clause. The first test below is that pin, as
 * a snapshot of the heading (landmark) order — the section header row and
 * the extra rail figures are both gated on `ledgers.length > 1`, so a
 * single-repo fleet should show neither.
 */

function rel(sha: string, minutesAgo: number) {
	return {
		tag: `main-${sha}`,
		revision: `${sha}${'0'.repeat(40)}`.slice(0, 40),
		created: new Date(Date.now() - minutesAgo * 60_000).toISOString()
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
			// The real API delivers availableReleases OLDEST-FIRST.
			availableReleases: [...releases].reverse(),
			history: history.map((h) => ({
				version: h.r,
				timestamp: new Date(Date.now() - h.minutesAgo * 60_000).toISOString(),
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
 * ONE REPO, SHAPED TO REACH EVERY CARD ON THE PAGE.
 *
 *   r1  newest, `web` runs it now                → the hero ("Newest build in use")
 *   r2  older, `api` still runs it                → "Also still running"
 *   r3  known (on the release list), never run    → "Never deployed"
 *   r4  `web` ran it once, nothing runs it now     → "No longer running anywhere"
 *
 * `web` and `api` share one release list (the same repo, two services), which
 * is what `revision-ledger.ts` assumes: a commit is one row across services.
 */
function repoFixture(source: string, prefix: string) {
	const r1 = rel(`${prefix}1111111`, 10);
	const r2 = rel(`${prefix}2222222`, 200);
	const r3 = rel(`${prefix}3333333`, 400);
	const r4 = rel(`${prefix}4444444`, 600);
	const releases = [r1, r2, r3, r4];
	const web = rollout(`${prefix}-web`, 'team', source, releases, [
		{ r: r1, minutesAgo: 10 },
		{ r: r4, minutesAgo: 600 }
	]);
	const api = rollout(`${prefix}-api`, 'team', source, releases, [{ r: r2, minutesAgo: 200 }]);
	return {
		rollouts: [web, api],
		environments: [
			environment(`${prefix}-web`, 'team', 'prod'),
			environment(`${prefix}-api`, 'team', 'prod')
		]
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
	// The hero is the first thing any non-empty fleet renders once the query
	// settles — waiting on it clears the loading branch for every assertion
	// below.
	await waitFor(() =>
		expect(screen.getAllByText('Newest build in use').length).toBeGreaterThan(0)
	);
}

function headingTexts(): string[] {
	return screen.getAllByRole('heading').map((h) => h.textContent?.trim() ?? '');
}

describe('/revisions — one consistent block per repository', () => {
	test('a single repo renders the same landmark order as before the multi-repo round', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();

		// THE PIN. Any reordering, insertion or removal here is a structural
		// change to the ONE fleet this page must not touch: the section header
		// row and its meta line are gated on `ledgers.length > 1` and must stay
		// absent, and the rail's repo-identity card must stay the last heading.
		expect(headingTexts()).toEqual([
			'Revisions',
			'Newest build in use',
			'Also still running',
			'No longer running anywhere',
			'Never deployed',
			'repo-a'
		]);

		// The only sanctioned visible change for one repository: the head band
		// now names the repository count.
		expect(screen.getByText(/·\s*1\s*repository/)).toBeInTheDocument();
	});

	test('two repos each get their own hero, lists and rail — never a hero for one and a list for the other', async () => {
		const a = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const b = repoFixture('https://github.com/acme/repo-b.git', 'b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();

		// The defect this round closes: only `ledgers[0]` used to reach these
		// cards. Both repos must reach all four now.
		expect(screen.getAllByText('Newest build in use')).toHaveLength(2);
		expect(screen.getAllByText('Also still running')).toHaveLength(2);
		expect(screen.getAllByText('No longer running anywhere')).toHaveLength(2);
		expect(screen.getAllByText('Never deployed')).toHaveLength(2);

		// Each section opens with its own name exactly once, and the old
		// bottom-of-rail identity card — which never said which repo it was —
		// does not also print it a second time.
		const headings = headingTexts();
		expect(headings.filter((h) => h === 'repo-a')).toHaveLength(1);
		expect(headings.filter((h) => h === 'repo-b')).toHaveLength(1);

		// `repo-a` is the more recently active fleet (its lead was deployed 10
		// minutes ago in both fixtures, so the tiebreak is fixture order) and
		// must lead the page — same rule the old single-lead banner relied on.
		expect(headings.indexOf('repo-a')).toBeLessThan(headings.indexOf('repo-b'));

		expect(screen.getByText(/·\s*2\s*repositories/)).toBeInTheDocument();
	});
});
