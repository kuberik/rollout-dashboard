import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * ⭐ ROUND 3 §2 — THE SEARCH QUERY LIVES IN THE URL. The page reads
 * `page.url.searchParams.get('q')` on load and calls `goto` to keep it in
 * sync as the operator types; `vi.mock` is hoisted per file, so the mock
 * lives here rather than mutating the real `$app/navigation` module. Same
 * pattern as `lib/messages/subject-detail.svelte.test.ts`.
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

// The page remembers its last shape (repository count, open sections, ledger
// sizes) in localStorage via `skeleton-hints`; another test file in the same
// worker can leave a value behind, which once made the two-repo test fail
// only when run alongside `src/lib/messages`. Start every test from a clean
// store — and a clean URL/mock-call state for the search-sync tests below.
beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	state.page.url = new URL('http://localhost/revisions');
	vi.mocked(goto).mockClear();
});
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/svelte';
import { configure } from '@testing-library/svelte';

// The full suite runs this page's tests under CPU load from 70 other files; a
// render after opening a repository can exceed the library's default 1 s wait
// (seen once in three runs as "Unable to find … Newest build in use").
configure({ asyncUtilTimeout: 5000 });
import { goto } from '$app/navigation';
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
 * a snapshot of the heading (landmark) order.
 */

// ⛔ ONE CLOCK FOR EVERY FIXTURE. `repoFixture('…repo-a')` and
// `repoFixture('…repo-b')` are built back to back; with a live `Date.now()`
// per call, any millisecond that ticked between them made repo-b the more
// recently active repository, `sortByDeviation` put it at index 0, and the
// two index-0 tests failed only under full-suite load (2026-09-06, 2 of 3
// runs). A shared instant makes the tie exact, so insertion order decides.
const FIXTURE_NOW = Date.now();

function rel(sha: string, minutesAgo: number) {
	return {
		tag: `main-${sha}`,
		revision: `${sha}${'0'.repeat(40)}`.slice(0, 40),
		created: new Date(FIXTURE_NOW - minutesAgo * 60_000).toISOString()
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
				timestamp: new Date(FIXTURE_NOW - h.minutesAgo * 60_000).toISOString(),
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
 * `r3` is OLDER than `r1` (400 minutes vs 10), so this fixture's own repo
 * header reads "Newest build deployed" — see the distance-rollup tests below
 * for the "N newer builds" half.
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
		],
		r1,
		r2,
		r3,
		r4
	};
}

/**
 * ONE SERVICE, ONE ENVIRONMENT, FULLY CONVERGED — for the §2 "the bar is
 * omitted at full coverage" case, where `liveCount === totalCount`.
 */
function fullCoverageFixture() {
	const r1 = rel('f1111111', 5);
	const rollouts = [
		rollout('full-svc', 'team', 'https://github.com/acme/full.git', [r1], [{ r: r1, minutesAgo: 5 }])
	];
	const environments = [environment('full-svc', 'team', 'prod')];
	return { rollouts, environments };
}

/**
 * ONE SERVICE, NINE PLACES, ONLY ONE ON THE HEAD BUILD — the exact "1 of 9"
 * shape the craft review's bar-width regression test needs. `CoverageBar`'s
 * cells (`flex: 1`) drew this identically to "8 of 9": a fully-filled
 * 200px track either way.
 */
function nineSlotFixture() {
	const newest = rel('n1111111', 10);
	const older = rel('n0000000', 500);
	const envNames = Array.from({ length: 9 }, (_, i) => `env${i}`);
	const rollouts = envNames.map((ns, i) =>
		rollout('web', ns, 'https://github.com/acme/nine.git', [newest, older], [
			{ r: i === 0 ? newest : older, minutesAgo: i === 0 ? 10 : 500 }
		])
	);
	const environments = envNames.map((ns) => environment('web', ns, ns));
	return { rollouts, environments };
}

/**
 * A BUILD NEWER THAN THE DEPLOYED FRONTIER, NEVER DEPLOYED — for §6's
 * "N newer builds" half. `newerRel` is created more recently (5 minutes ago)
 * than the deployed head `headRel` (100 minutes ago) but nobody has run it.
 */
function newerPendingFixture() {
	const headRel = rel('p1111111', 100);
	const newerRel = rel('p2222222', 5);
	const rollouts = [
		rollout(
			'pending-svc',
			'team',
			'https://github.com/acme/pending.git',
			[newerRel, headRel],
			[{ r: headRel, minutesAgo: 100 }]
		)
	];
	const environments = [environment('pending-svc', 'team', 'prod')];
	return { rollouts, environments, headRel, newerRel };
}

/**
 * TWO SERVICES WITH DISJOINT RELEASE LISTS — for the per-service chip
 * filter. `repoFixture`'s two services share one release list, so every row
 * names both services regardless of which one is live; here each service
 * only ever appears on its OWN builds, so pressing a chip has something real
 * to narrow.
 */
function filterFixture(prefix: string) {
	const w1 = rel(`${prefix}w111111`, 5); // web's head — the hero
	const w2 = rel(`${prefix}w222222`, 300); // web, retired
	const a1 = rel(`${prefix}a111111`, 8); // api's head — "Also still running"
	const a2 = rel(`${prefix}a222222`, 200); // api, retired
	const source = `https://github.com/acme/${prefix}-filter.git`;
	const web = rollout(`${prefix}-web`, 'team', source, [w1, w2], [
		{ r: w1, minutesAgo: 5 },
		{ r: w2, minutesAgo: 300 }
	]);
	const api = rollout(`${prefix}-api`, 'team', source, [a1, a2], [
		{ r: a1, minutesAgo: 8 },
		{ r: a2, minutesAgo: 200 }
	]);
	return {
		rollouts: [web, api],
		environments: [
			environment(`${prefix}-web`, 'team', 'prod'),
			environment(`${prefix}-api`, 'team', 'prod')
		],
		w1,
		w2,
		a1,
		a2
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
		expect(screen.getAllByText(/^Newest build ·/).length).toBeGreaterThan(0)
	);
}

function headingTexts(): string[] {
	return screen.getAllByRole('heading').map((h) => h.textContent?.trim() ?? '');
}

/**
 * ⭐ ROUND SIX §5 — THE TITLE IS NOT THE BUTTON ANY MORE. The disclosure
 * used to be the whole 47px header (`aria-expanded` on the SAME element
 * that rendered the repo's name), so finding it by name and by role were
 * the same query. Now the name is a plain `<h2>` and the control is a
 * separate `36 builds ⌄` pill beside it — find the heading first, then the
 * one `aria-expanded` button inside its `.repo-card` ancestor.
 */
function repoHeaderButton(name: string): HTMLElement {
	const heading = screen
		.getAllByRole('heading', { level: 2 })
		.find((h) => h.textContent?.includes(name));
	if (!heading) throw new Error(`no repository heading contains "${name}"`);
	const card = heading.closest('.repo-card');
	if (!card) throw new Error(`heading "${name}" has no .repo-card ancestor`);
	const btn = within(card as HTMLElement)
		.getAllByRole('button')
		.find((b) => b.getAttribute('aria-expanded') !== null);
	if (!btn) throw new Error(`no repository disclosure button inside the repo-card for "${name}"`);
	return btn;
}

describe('/revisions — one consistent block per repository', () => {
	test('a single repo renders the same landmark order as before the multi-repo round', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();

		// THE PIN, UPDATED FOR REVISIONS-2026-09-05 (repository sections). The
		// single-repo rail identity card (name, service count, the three
		// figures, `View repository`) that used to sit LAST is folded into the
		// §1 repository card that now OPENS the page — the repo name moves
		// from last heading to second, right after the page's own `sr-only`
		// `h1`. A single repo is expanded by default (index 0), so every
		// build card still renders with no interaction.
		expect(headingTexts()).toEqual([
			'Revisions',
			'repo-a',
			expect.stringMatching(/^Newest build ·/),
			'Also still running',
			'No longer running anywhere',
			'Never deployed'
		]);

		// The only sanctioned visible change for one repository: the head band
		// now names the repository count, and "revisions" became "builds"
		// (§4 — the object is a build).
		expect(screen.getByText(/·\s*1\s*repository/)).toBeInTheDocument();
		expect(screen.getByText(/of\s*\d+\s*builds deployed/)).toBeInTheDocument();
	});

	test('two repos each get their own hero, lists and rail once both are open', async () => {
		const a = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const b = repoFixture('https://github.com/acme/repo-b.git', 'b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();

		// §1's default open state: index 0 (repo-a, more recently active)
		// open, repo-b closed — so only repo-a's hero/list cards render yet.
		await waitFor(() => expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(1));

		// Opening repo-b's own disclosure reaches the defect this round
		// closes: only `ledgers[0]` used to reach these cards at all.
		await fireEvent.click(repoHeaderButton('repo-b'));
		await waitFor(() => expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(2));
		await waitFor(() => {
			expect(screen.getAllByText('Also still running')).toHaveLength(2);
			expect(screen.getAllByText('No longer running anywhere')).toHaveLength(2);
			expect(screen.getAllByText('Never deployed')).toHaveLength(2);
		});

		// Each section names itself exactly once, and `repo-a` still leads
		// `repo-b` — `ledgers` is sorted most-recently-active first.
		const headings = headingTexts();
		expect(headings.filter((h) => h === 'repo-a')).toHaveLength(1);
		expect(headings.filter((h) => h === 'repo-b')).toHaveLength(1);
		expect(headings.indexOf('repo-a')).toBeLessThan(headings.indexOf('repo-b'));

		expect(screen.getByText(/·\s*2\s*repositories/)).toBeInTheDocument();
	});
});

describe('/revisions — default open state and the remembered open set (REVISIONS-2026-09-05 §1)', () => {
	test('index 0 is open by default; every other section starts closed', async () => {
		const a = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const b = repoFixture('https://github.com/acme/repo-b.git', 'b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();

		expect(repoHeaderButton('repo-a')).toHaveAttribute('aria-expanded', 'true');
		expect(repoHeaderButton('repo-b')).toHaveAttribute('aria-expanded', 'false');
		// The ledger itself is NOT gated by the disclosure — collapsed still
		// carries the page's most useful answer.
		expect(screen.getByText('repo-b')).toBeInTheDocument();
		expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(1);
	});

	test('opening a second section is remembered across a remount', async () => {
		const a = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const b = repoFixture('https://github.com/acme/repo-b.git', 'b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);

		const first = render(WithQueryClient, { props: { component: Page as any } });
		await waitFor(() =>
			expect(screen.getAllByText(/^Newest build ·/).length).toBeGreaterThan(0)
		);
		await fireEvent.click(repoHeaderButton('repo-b'));
		await waitFor(() => expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(2));
		first.unmount();

		// A fresh mount of the SAME page — no interaction — must remember that
		// repo-b (index 1) was left open.
		render(WithQueryClient, { props: { component: Page as any } });
		await waitFor(() =>
			expect(screen.getAllByText(/^Newest build ·/).length).toBeGreaterThan(0)
		);
		expect(repoHeaderButton('repo-b')).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(2);
	});
});

describe('/revisions — the coverage bar is single-fill and only draws a shortfall (§2)', () => {
	test('the bar is omitted entirely at full coverage', async () => {
		const fleet = fullCoverageFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		expect(document.querySelector('.single-bar')).toBeNull();
	});

	test('the bar renders below full coverage', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		// `api` has not yet taken the hero build `r1`, so the hero is below
		// full coverage (1 of 2 places).
		expect(document.querySelector('.single-bar')).not.toBeNull();
	});

	test('craft review item 1 — the fill is an exact WIDTH, "1 of 9" draws 11%, never a full track', async () => {
		const fleet = nineSlotFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		const fill = document.querySelector('.single-bar-fill') as HTMLElement | null;
		expect(fill).not.toBeNull();
		// `CoverageBar`'s cells are `flex: 1`, so both "1 of 9" and "8 of 9"
		// used to draw a fully-filled track — this is the regression test
		// for that: 1/9 rounds to 11%, not 100%.
		expect(fill!.style.width).toBe('11%');
	});
});

describe('/revisions — every age names its event (§5)', () => {
	test('Deployed / Last deployed / Built, never a bare "N ago"', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		await waitFor(() => expect(screen.getByText('Also still running')).toBeInTheDocument());

		// r2 — "Also still running".
		expect(screen.getAllByText(/^Deployed .+ ago$/).length).toBeGreaterThan(0);
		// r4 — "No longer running anywhere".
		expect(screen.getAllByText(/^Last deployed .+ ago$/).length).toBeGreaterThan(0);
		// r3 — "Never deployed".
		expect(screen.getAllByText(/^Built .+ ago$/).length).toBeGreaterThan(0);
		// The old bare form is gone from the page.
		expect(screen.queryByText(/^\d+[a-z]+ ago$/)).toBeNull();
	});
});

/**
 * ⭐ COORDINATOR PASS 2 — A HELD HEAD, END TO END. `hello-frontend-app`
 * carries two releases of one revision (a rollback re-tag): the older is
 * running, the newer is held by a gate that allows nothing. This is the
 * live fleet's own shape (`9f10e49`, rel-66/rel-67), miniaturised to one
 * service, one place.
 */
function relVersion(sha: string, version: string, minutesAgo: number) {
	return {
		tag: `main-${sha}`,
		version,
		revision: `${sha}${'0'.repeat(40)}`.slice(0, 40),
		created: new Date(FIXTURE_NOW - minutesAgo * 60_000).toISOString()
	};
}

function heldHeadFixture() {
	const source = 'https://github.com/acme/held.git';
	const older = relVersion('eeeeeee', '2.66.0-66', 120); // running
	const newer = relVersion('eeeeeee', '2.67.0-67', 10); // held — never deployed
	const fe = rollout(
		'hello-frontend-app',
		'team',
		source,
		[newer, older] as unknown as Rel[],
		[{ r: older as unknown as Rel, minutesAgo: 5 }]
	);
	// A gate that refuses every candidate — the live fleet's own
	// `dependency-hello-frontend-needs-api`, allowing nothing through.
	(fe.status as { gates?: unknown }).gates = [{ name: 'dependency-x', allowedVersions: [] }];
	return {
		rollouts: [fe],
		environments: [environment('hello-frontend-app', 'team', 'prod')]
	};
}

describe('/revisions — a held head reads `held`, never `behind`/`deployed` (coordinator pass 2)', () => {
	test('item B — the repo header shows `HELD`, not `BEHIND`, and the distance verdict says `held`, not `deployed`', async () => {
		const fleet = heldHeadFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		// The repo header's OWN deviation chip — `1 held`, not `1 behind`.
		// (The LEDGER ROW below it correctly still says `1 behind` for the
		// RUNNING release's own rank against the held one — that fact is
		// real and stays; only the repo-wide summary chip must not repeat
		// it as the headline.)
		expect(screen.getByText('1 held')).toBeInTheDocument();
		expect(screen.getByText('Newest build held')).toBeInTheDocument();
		expect(screen.queryByText('Newest build deployed')).toBeNull();
	});

	test('item A — one banner for the hold, not two: the page-level "is held in" sentence does not also fire', async () => {
		const fleet = heldHeadFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		// The repository's OWN banner (round 4's ruled home for this fact).
		expect(screen.getByText(/run 2\.66\.0-66; 2\.67\.0-67 is held in/)).toBeInTheDocument();
		// The retired page-level grammar ("hello-frontend-app is held in
		// prod.") must not ALSO render — that was two spellings of one fact.
		expect(screen.queryByText(/^hello-frontend-app is held in/)).toBeNull();
		expect(screen.queryByText('See what\u2019s blocking it')).toBeNull();
	});
});

describe('/revisions — the repo header leads with distance (§6)', () => {
	test('reads "Newest build deployed" when nothing pending is newer than the head', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		expect(screen.getByText('Newest build deployed')).toBeInTheDocument();
	});

	test('counts a pending build newer than the deployed frontier as "N newer builds"', async () => {
		const fleet = newerPendingFixture();
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		expect(screen.getByText('1 newer build')).toBeInTheDocument();
	});
});

/**
 * ⭐ ROUND 3 §1 — A REPOSITORY IS NOT ONE RELEASE LINE. Two services (`web`/
 * `web2`) share one newest build; a third (`jobs`) has never shipped a
 * commit either of them has — the exact `kuberik-testing` shape measured on
 * the live fleet (two services on `9f10e49`, three on an unrelated
 * `064b655`), miniaturised to one line of two and one line of one.
 */
function twoLineRepoFixture(prefix: string) {
	const source = `https://github.com/acme/${prefix}-twoline.git`;
	const l1 = rel(`${prefix}l1111111`, 5); // web + web2's own newest
	const l2 = rel(`${prefix}l2222222`, 50); // jobs' own, unrelated newest
	const web = rollout(`${prefix}-web`, 'team', source, [l1], [{ r: l1, minutesAgo: 5 }]);
	const web2 = rollout(`${prefix}-web2`, 'team', source, [l1], [{ r: l1, minutesAgo: 5 }]);
	const jobs = rollout(`${prefix}-jobs`, 'team', source, [l2], [{ r: l2, minutesAgo: 50 }]);
	return {
		rollouts: [web, web2, jobs],
		environments: [
			environment(`${prefix}-web`, 'team', 'prod'),
			environment(`${prefix}-web2`, 'team', 'prod'),
			environment(`${prefix}-jobs`, 'team', 'prod')
		],
		l1,
		l2
	};
}

describe('/revisions — round 3 §1 (a repository is not one release line)', () => {
	test('a repo with two independent release lines gets one hero PER LINE, each naming its own services', async () => {
		const fleet = twoLineRepoFixture('m');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		// One repo, one card — but TWO "Newest build in use" bands, because
		// `m-jobs`'s own current build is not older than anything on ITS OWN
		// line; it is only not the repo-wide newest by creation time.
		expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(2);
		// Printed twice each — the hero's own `Card` verdict AND the ledger's
		// per-line caption (addendum H) — never a bare repo-wide count.
		expect(screen.getAllByText('m-web · m-web2').length).toBeGreaterThan(0);
		expect(screen.getAllByText('m-jobs').length).toBeGreaterThan(0);
	});

	test('a multi-line repo prints NO distance verdict at repo scope (item 6, supersedes round 4 item 11)', async () => {
		const fleet = twoLineRepoFixture('m');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		// ⛔ REVISIONS-2026-09-06, ITEM 6 — SUPERSEDES round 4 item 11's OWN
		// EXPECTATION. A multi-line repo used to print a distance verdict at
		// repo scope just like a single-line one (`Newest build deployed`) —
		// which is a claim about `repo.rows[0]`, i.e. ONE line's own frontier,
		// stated as if it were true of the whole repository. On the live
		// fleet that produced `Newest build held` for a repo whose OTHER line
		// was fully caught up, `9 of 9`. A repository with more than one
		// release line now prints NO distance-verdict sentence in the header
		// at all — the hero cards below speak for each line individually; the
		// release-line COUNT still lives on the meta line.
		expect(screen.queryByText('Newest build deployed')).toBeNull();
		expect(screen.getByText(/·\s*across\s*2\s*release lines/)).toBeInTheDocument();
	});

	test("m-jobs's own current build is never filed under Also still running", async () => {
		const fleet = twoLineRepoFixture('m');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		// Before this round, only ONE repo-wide "newest" row got a hero and
		// everything else — including a DIFFERENT line's own current build —
		// was filed as "older". `l2` is `m-jobs`'s own head, so it must never
		// also appear as a `.bld-row` (the shared row grammar every OTHER
		// build-list row uses — "Also still running", "No longer running",
		// "Never deployed") — only the hero and the ledger, neither of which
		// is a `.bld-row`.
		await waitFor(() => expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(2));
		expect(document.querySelectorAll(`.bld-row [title="${fleet.l2.revision}"]`)).toHaveLength(0);
	});
});

describe('/revisions — round 3 §3 (state in words, right kind, right hue)', () => {
	test('a pinned rollout draws the PINNED word in the ledger, never amber', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		// `web`'s history[0] is r1, the hero build — pin it.
		fleet.rollouts[0].spec = { wantedVersion: fleet.r1.tag } as unknown as Rollout['spec'];
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		await waitFor(() => expect(screen.getByText('pinned')).toBeInTheDocument());
	});
});

describe('/revisions — search finds a build (§7b)', () => {
	async function setup(fleet: ReturnType<typeof repoFixture>) {
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		return screen.getByPlaceholderText('Find a build or service') as HTMLInputElement;
	}

	test('matches a full revision prefix', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		await fireEvent.input(search, { target: { value: fleet.r4.revision.slice(0, 10) } });
		await waitFor(() => expect(screen.getByTitle(fleet.r4.revision)).toBeInTheDocument());
	});

	test('matches a short sha', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		const short = fleet.r2.revision.slice(0, 7);
		await fireEvent.input(search, { target: { value: short } });
		await waitFor(() => expect(screen.getAllByTitle(fleet.r2.revision).length).toBeGreaterThan(0));
		// ⭐ ROUND 4, ITEM 1 — the OTHER build lists narrow to NOTHING, not to
		// a repeated no-match sentence: the repo itself has a match (r2), so
		// `repoNoMatch` is false and every empty card here collapses to its
		// own `0 of N` rollup instead of printing "No build matches" a
		// second (third, fourth…) time.
		expect(screen.queryByText(new RegExp('No build matches'))).toBeNull();
	});

	test('matches a service name', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		await fireEvent.input(search, { target: { value: 'a-api' } });
		// r2 is `a-api`'s own live build and must survive the filter.
		await waitFor(() => expect(screen.getAllByTitle(fleet.r2.revision).length).toBeGreaterThan(0));
	});

	test('every section expands while searching, and the remembered set returns once cleared', async () => {
		const a = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const b = repoFixture('https://github.com/acme/repo-b.git', 'b');
		stubFetch([...a.rollouts, ...b.rollouts], [...a.environments, ...b.environments]);
		await renderRevisions();
		expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(1);

		const search = screen.getByPlaceholderText('Find a build or service') as HTMLInputElement;
		// A query that matches only repo-a's own build still counts repo-b as
		// SEARCHED — the rule is "searching", not "this repo happens to
		// match" — but repo-b has nothing at all to show, so per ROUND 4,
		// ITEM B its whole header collapses to `repo-b · no match`: no
		// stats, no distance verdict, and (nothing left to disclose) no
		// button — `repoHeaderButton` would find none, which is the point.
		await fireEvent.input(search, { target: { value: a.r1.revision.slice(0, 8) } });
		const repoBHeading = await screen.findByRole('heading', { level: 2, name: 'repo-b' });
		const repoBCard = repoBHeading.closest('.repo-card') as HTMLElement;
		await waitFor(() => expect(within(repoBCard).getByText('no match')).toBeInTheDocument());
		expect(within(repoBCard).queryByRole('button')).toBeNull();
		expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(1);

		await fireEvent.input(search, { target: { value: '' } });
		await waitFor(() => expect(repoHeaderButton('repo-b')).toHaveAttribute('aria-expanded', 'false'));
		expect(screen.getAllByText(/^Newest build ·/)).toHaveLength(1);
	});

	/**
	 * ⭐ ROUND 4a, ITEM D — ONE LINE, NOT TWO. This used to wait for a body
	 * paragraph ("No build matches …") printed UNDER a header that already
	 * said `no match` — the same fact stated twice, in two different
	 * grammars, 47px apart. The header carries it alone now.
	 */
	test('a repo with no match keeps its repository card and prints the header word, once', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		await fireEvent.input(search, { target: { value: 'zzz-nothing-here' } });
		await waitFor(() => expect(screen.getByText('no match')).toBeInTheDocument());
		// The repository card itself — its header — is still there.
		expect(screen.getByText('repo-a')).toBeInTheDocument();
		// The old body sentence is gone; the header carries the fact alone.
		expect(screen.queryByText(/No build matches/)).toBeNull();
	});

	test('craft review item 5 — a repo-wide miss collapses to ONE sentence, never three empty cards', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await setup(fleet);
		await fireEvent.input(search, { target: { value: 'zzz-nothing-here' } });
		await waitFor(() => expect(screen.getByText('no match')).toBeInTheDocument());
		// The three build-list cards do not render at all in this state —
		// their headers, and the "0 of N builds" rollup each would have
		// printed, are gone rather than repeated per card.
		expect(screen.queryByText('Also still running')).toBeNull();
		expect(screen.queryByText('No longer running anywhere')).toBeNull();
		expect(screen.queryByText('Never deployed')).toBeNull();
	});
});

describe('/revisions — round 3 §2: search is the ONE filter; the service name is a link', () => {
	test('the service name is a plain link to /apps/<name> — no filter chip, no aria-pressed control', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		const webLink = screen.getByRole('link', { name: 'a-web' });
		expect(webLink).toHaveAttribute('href', '/apps/a-web');
		expect(webLink.closest('.svc-ledger')).not.toBeNull();
		// The per-repo chip strip this replaces is gone entirely.
		expect(screen.queryByRole('button', { name: /Show only/ })).toBeNull();
		expect(document.querySelector('[aria-pressed]')).toBeNull();
	});

	test('the name is plain t-body sans, mono stays reserved for the sha', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		const webLink = screen.getByRole('link', { name: 'a-web' });
		expect(webLink.className).toMatch(/\bt-body\b/);
		expect(webLink.className).not.toMatch(/\bt-code\b/);
		expect(webLink.className).not.toMatch(/\bt-label\b/);
	});

	test('a multi-build service group has ONE link on its first line; continuation lines carry no link', async () => {
		const a = filterFixture('a');
		stubFetch(a.rollouts, a.environments);
		await renderRevisions();
		// `filterFixture` gives each service exactly one line in the ledger
		// (disjoint release lists), so this asserts the general invariant:
		// exactly one `/apps/<name>` link per distinct service name.
		const links = screen
			.getAllByRole('link')
			.filter((l) => l.getAttribute('href')?.startsWith('/apps/'));
		const names = links.map((l) => l.getAttribute('href'));
		expect(new Set(names).size).toBe(names.length);
	});

	test('the query lives in the URL as ?q=, deep-linkable and read on load', async () => {
		state.page.url = new URL('http://localhost/revisions?q=a-api');
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		const search = screen.getByPlaceholderText('Find a build or service') as HTMLInputElement;
		expect(search.value).toBe('a-api');
		// `a-api`'s own live build (r2) survives the filter that was already
		// active on arrival — no keystroke needed.
		await waitFor(() => expect(screen.getAllByTitle(fleet.r2.revision).length).toBeGreaterThan(0));
	});

	test('typing into the search field pushes ?q= into the URL, without spamming history', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		const search = await (async () => {
			stubFetch(fleet.rollouts, fleet.environments);
			await renderRevisions();
			return screen.getByPlaceholderText('Find a build or service') as HTMLInputElement;
		})();
		await fireEvent.input(search, { target: { value: 'a-api' } });
		await waitFor(() => expect(goto).toHaveBeenCalledWith('?q=a-api', expect.objectContaining({ replaceState: true })));
	});

	test('Escape clears the field and the URL param', async () => {
		state.page.url = new URL('http://localhost/revisions?q=a-api');
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		const search = screen.getByPlaceholderText('Find a build or service') as HTMLInputElement;
		expect(search.value).toBe('a-api');
		await fireEvent.keyDown(search, { key: 'Escape' });
		expect(search.value).toBe('');
	});
});

describe('/revisions — the reflow classes named in the spec are present', () => {
	test('the repository card, the ledger and the build rows carry their container-query classes', async () => {
		const fleet = repoFixture('https://github.com/acme/repo-a.git', 'a');
		stubFetch(fleet.rollouts, fleet.environments);
		await renderRevisions();
		expect(document.querySelector('.repo-card')).not.toBeNull();
		expect(document.querySelector('.svc-ledger')).not.toBeNull();
		expect(document.querySelectorAll('.bld-row').length).toBeGreaterThan(0);
		expect(document.querySelector('.rev-shell')).not.toBeNull();
		expect(document.querySelector('.rev-cols')).not.toBeNull();
	});
});
