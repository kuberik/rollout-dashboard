import { describe, it, expect } from 'vitest';
import { buildRevisionLedger } from './revision-ledger';
import { revisionCoverage, coverageSegments, COVERAGE_ORDER } from './revision-coverage';
import type { Environment, Rollout } from '../../types';

/**
 * RELEASE COVERAGE — the bucketing behind the coverage bar on `/versions` and
 * `/versions/<revision>`.
 *
 * The fixture is the one `revision-ledger.test.ts` uses, for the same reason:
 * two services on ONE repo shipping the same three commits under different
 * label schemes, which is the shape the pages exist to describe.
 *
 *   api  labels them 1.3.0 / 1.2.0 / 1.1.0, and is converged on the head
 *   web  labels them with the short sha, and its prod is two builds behind
 */

const SOURCE = 'https://github.com/acme/monorepo.git';

type Rel = { tag: string; version?: string; revision: string; created: string };

function rel(sha: string, label: string | undefined, minutesAgo: number): Rel {
	return {
		tag: `main-${sha}`,
		version: label,
		revision: `${sha}${'0'.repeat(40)}`.slice(0, 40),
		created: new Date(Date.now() - minutesAgo * 60_000).toISOString()
	};
}

function rollout(
	name: string,
	ns: string,
	releases: Rel[],
	history: { r: Rel; minutesAgo: number; bake?: string }[]
): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source: SOURCE,
			// The real API delivers availableReleases OLDEST-FIRST.
			availableReleases: [...releases].reverse(),
			history: history.map((h) => ({
				version: h.r,
				timestamp: new Date(Date.now() - h.minutesAgo * 60_000).toISOString(),
				bakeStatus: h.bake ?? 'Succeeded'
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

function fixture(webProdBake?: string) {
	const A = [
		rel('aaaaaaa', '1.3.0', 10),
		rel('bbbbbbb', '1.2.0', 120),
		rel('ccccccc', '1.1.0', 300)
	];
	const W = [
		rel('aaaaaaa', undefined, 10),
		rel('bbbbbbb', undefined, 120),
		rel('ccccccc', undefined, 300)
	];
	const rollouts = [
		rollout('api', 'api-dev', A, [{ r: A[0], minutesAgo: 5 }]),
		rollout('api', 'api-prod', A, [{ r: A[0], minutesAgo: 3 }]),
		rollout('web', 'web-dev', W, [{ r: W[0], minutesAgo: 5 }]),
		rollout('web', 'web-prod', W, [
			{ r: W[2], minutesAgo: 200, bake: webProdBake },
			{ r: W[1], minutesAgo: 250 }
		])
	];
	const environments = [
		environment('api', 'api-dev', 'dev'),
		environment('api', 'api-prod', 'prod'),
		environment('web', 'web-dev', 'dev'),
		environment('web', 'web-prod', 'prod')
	];
	return buildRevisionLedger(rollouts, environments)[0];
}

/** Bucket key → count, for the assertions below. */
function counts(row: ReturnType<typeof fixture>['rows'][number]) {
	const cov = revisionCoverage(row, new Date());
	return Object.fromEntries(cov.buckets.map((b) => [b.key, b.slots.length]));
}

describe('revisionCoverage', () => {
	it('splits the head into what is live and what has not taken it yet', () => {
		const repo = fixture();
		const head = repo.rows[0];
		expect(head.short).toBe('aaaaaaa');
		// api dev + api prod + web dev are on it; web prod is two builds back.
		expect(counts(head)).toEqual({ live: 3, notYet: 1 });
		expect(revisionCoverage(head, new Date()).liveCount).toBe(3);
		expect(revisionCoverage(head, new Date()).totalCount).toBe(4);
	});

	it('splits an old build into what still runs it and what rolled past', () => {
		const repo = fixture();
		const old = repo.rows[2];
		expect(old.short).toBe('ccccccc');
		// Only web prod still runs it; the other three moved to the head.
		expect(counts(old)).toEqual({ live: 1, ahead: 3 });
	});

	it('moves a slot from live to failing when the deploy failed', () => {
		const repo = fixture('Failed');
		const old = repo.rows[2];
		expect(counts(old)).toEqual({ failing: 1, ahead: 3 });
		// It is still a place this build reached, so it still counts toward the
		// hero numerator — the bar is what says the deploy is not healthy.
		expect(revisionCoverage(old, new Date()).liveCount).toBe(1);
	});

	it('emits segments in bar order and drops empty buckets', () => {
		const repo = fixture();
		const segs = coverageSegments(revisionCoverage(repo.rows[0], new Date()));
		expect(segs.map((s) => s.key)).toEqual(['live', 'notYet']);
		// …and bar order is always a subsequence of the declared order, so the
		// list's miniature and the detail page's 26px bar cannot disagree.
		const declared = COVERAGE_ORDER.filter((k) => segs.some((s) => s.key === k));
		expect(segs.map((s) => s.key)).toEqual(declared);
	});

	it('carries the per-service label only where it differs from the sha', () => {
		const repo = fixture();
		const cov = revisionCoverage(repo.rows[0], new Date());
		const live = cov.buckets.find((b) => b.key === 'live')!;
		const api = live.slots.filter((s) => s.appName === 'api');
		const web = live.slots.filter((s) => s.appName === 'web');
		expect(api.every((s) => s.labelDiffers && s.label === '1.3.0')).toBe(true);
		expect(web.every((s) => !s.labelDiffers)).toBe(true);
	});

	it('never names a gate it has no evidence for', () => {
		const repo = fixture();
		const cov = revisionCoverage(repo.rows[0], new Date());
		const notYet = cov.buckets.find((b) => b.key === 'notYet')!;
		// This fixture declares no gates at all, so the page must fall back to
		// the observable rather than inventing one.
		expect(notYet.slots[0].blockingGates).toEqual([]);
	});

	/**
	 * ⛔ THE TWO-DENOMINATOR REGRESSION — `hello-frontend-app` rel-66/rel-67.
	 * Two releases can share ONE git revision (a rollback re-ships a build
	 * already released once before under a new tag). `onIt` matches on the
	 * revision alone, so every environment running the OLDER release used to
	 * classify as `live` for the row that represents the NEWER one — a held
	 * release read as `fully rolled out`. See `classify()`'s own comment.
	 */
	function heldRevisionFixture() {
		const sha = 'eeeeeee0000000000000000000000000000000';
		const older = { tag: 'main-66', version: '1.66.0-66', revision: sha, created: minsAgo(120) };
		const newer = { tag: 'main-67', version: '1.67.0-67', revision: sha, created: minsAgo(10) };
		const rollouts = [
			rollout('hello-frontend-app', 'hfa-dev', [newer, older], [{ r: older, minutesAgo: 5 }]),
			rollout(
				'hello-frontend-app',
				'hfa-staging',
				[newer, older],
				[{ r: older, minutesAgo: 5 }]
			),
			rollout('hello-frontend-app', 'hfa-prod', [newer, older], [{ r: older, minutesAgo: 3 }])
		];
		const environments = [
			environment('hello-frontend-app', 'hfa-dev', 'dev'),
			environment('hello-frontend-app', 'hfa-staging', 'staging'),
			environment('hello-frontend-app', 'hfa-prod', 'prod')
		];
		return buildRevisionLedger(rollouts, environments)[0];
	}

	function minsAgo(m: number): string {
		return new Date(Date.now() - m * 60_000).toISOString();
	}

	it('does not call a held release "live" because an older release shares its revision', () => {
		const repo = heldRevisionFixture();
		// One row: both releases share the revision, so the ledger groups them.
		expect(repo.rows).toHaveLength(1);
		const row = repo.rows[0];
		const cov = revisionCoverage(row, new Date());
		// Every place is running rel-66, not rel-67 — the row's own (newest)
		// release has landed NOWHERE, so nothing may read as `live`.
		expect(cov.liveCount).toBe(0);
		const notYet = cov.buckets.find((b) => b.key === 'notYet');
		expect(notYet?.slots.length).toBe(3);
		expect(cov.buckets.some((b) => b.key === 'live')).toBe(false);
	});

	it('keeps a release "live" when the environment is genuinely on this row\'s own build', () => {
		const repo = fixture();
		const head = repo.rows[0];
		// The ordinary case — no second release sharing the revision — must be
		// byte-identical to before: three places are live, not reclassified.
		expect(counts(head)).toEqual({ live: 3, notYet: 1 });
	});
});
