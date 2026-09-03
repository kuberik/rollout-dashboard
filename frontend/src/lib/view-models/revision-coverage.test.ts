import { describe, it, expect } from 'vitest';
import { buildRevisionLedger } from './revision-ledger';
import {
	revisionCoverage,
	coverageSegments,
	coverageFill,
	COVERAGE_ORDER,
	buildState,
	releaseSplit,
	type RevisionCoverage,
	type CoverageSlotVM
} from './revision-coverage';
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

	/**
	 * ⛔ (2026-09-03, operator-walk BLOCKING item — supersedes the assertion
	 * this test used to make.) Every place running rel-66 IS running the
	 * revision — `onIt` is a git-sha match and does not care which release
	 * tag is on screen. Filing all three under `notYet` was the false claim
	 * an operator read as "PROD has not gotten this build" about a place
	 * that had run it for days. `live` now means exactly "running the
	 * revision", full stop; `onOwnRelease` (below) is the separate, narrower
	 * fact about whether it is on the row's own headline release of it.
	 */
	it('counts a place running an OLDER release of the revision as live, not "not here yet"', () => {
		const repo = heldRevisionFixture();
		// One row: both releases share the revision, so the ledger groups them.
		expect(repo.rows).toHaveLength(1);
		const row = repo.rows[0];
		const cov = revisionCoverage(row, new Date());
		// All three run the revision — 3 of 3, not 0 of 3.
		expect(cov.liveCount).toBe(3);
		expect(cov.totalCount).toBe(3);
		const live = cov.buckets.find((b) => b.key === 'live');
		expect(live?.slots.length).toBe(3);
		expect(cov.buckets.some((b) => b.key === 'notYet')).toBe(false);
		// None of them are on the row's OWN release (rel-67, held) — they are
		// on the older one (rel-66) that shares its revision.
		expect(live?.slots.every((s) => s.onOwnRelease === false)).toBe(true);
		expect(live?.slots.every((s) => s.runs === '1.66.0-66')).toBe(true);
		expect(live?.slots.every((s) => s.label === '1.67.0-67')).toBe(true);
	});

	it('does not mark a place "on its own release" merely for sharing the revision', () => {
		const repo = heldRevisionFixture();
		const cov = revisionCoverage(repo.rows[0], new Date());
		const live = cov.buckets.find((b) => b.key === 'live')!;
		expect(live.slots.map((s) => s.onOwnRelease)).toEqual([false, false, false]);
	});

	it('keeps a release "live" when the environment is genuinely on this row\'s own build', () => {
		const repo = fixture();
		const head = repo.rows[0];
		// The ordinary case — no second release sharing the revision — must be
		// byte-identical to before: three places are live, not reclassified.
		expect(counts(head)).toEqual({ live: 3, notYet: 1 });
	});

	/**
	 * ⭐ THE BAR MAY NOT PAINT A HELD PLACE AS DONE. (2026-09-03, design pass
	 * 7, finding #5) `buildState()` already leads with `held in N places` for
	 * this exact fixture — checked BEFORE `done` — so a segment list that
	 * still called every one of these three slots plain `live` would draw the
	 * page's largest colour mass in direct contradiction of its own hero word,
	 * 40px above the bar. `classify()` and the bucket count are unchanged
	 * (`live: 3`, asserted above and in `heldRevisionFixture`'s own tests);
	 * only the BAR's segmentation carves the held slots back out.
	 */
	describe('coverageSegments: a `live` slot held on an older release is not `live` on the bar', () => {
		it('draws the whole bucket as `held`, not `live`, when every place is held', () => {
			const repo = heldRevisionFixture();
			const cov = revisionCoverage(repo.rows[0], new Date());
			// The bucket itself is untouched — this is still `live: 3` to every
			// consumer that reads `cov.buckets` or `cov.liveCount` directly.
			expect(counts(repo.rows[0])).toEqual({ live: 3 });
			const segs = coverageSegments(cov);
			expect(segs).toEqual([
				{ key: 'held', count: 3, title: 'Held on an older release', reachable: true }
			]);
		});

		it('splits the bucket into both segments when only part of it is held', () => {
			// One service on its own release, one held behind a gate — the
			// ordinary partial case, not the all-or-nothing fixture above.
			const sha = 'fffffff0000000000000000000000000000000';
			const older = { tag: 'main-66', version: '1.66.0-66', revision: sha, created: minsAgo(120) };
			const newer = { tag: 'main-67', version: '1.67.0-67', revision: sha, created: minsAgo(10) };
			const rollouts = [
				rollout('hello-frontend-app', 'hfa-dev', [newer, older], [{ r: older, minutesAgo: 5 }]),
				rollout('hello-frontend-app', 'hfa-prod', [newer, older], [{ r: newer, minutesAgo: 5 }])
			];
			const environments = [
				environment('hello-frontend-app', 'hfa-dev', 'dev'),
				environment('hello-frontend-app', 'hfa-prod', 'prod')
			];
			const repo = buildRevisionLedger(rollouts, environments)[0];
			const row = repo.rows.find((r) => r.short === sha.slice(0, 7))!;
			const cov = revisionCoverage(row, new Date());
			const segs = coverageSegments(cov);
			expect(segs).toEqual([
				{ key: 'live', count: 1, title: 'Running it now', reachable: true },
				{ key: 'held', count: 1, title: 'Held on an older release', reachable: true }
			]);
		});

		it('does not appear at all in the ordinary case — byte-identical to before', () => {
			const repo = fixture();
			const cov = revisionCoverage(repo.rows[0], new Date());
			const segs = coverageSegments(cov);
			expect(segs.some((s) => s.key === 'held')).toBe(false);
		});
	});

	/**
	 * ⭐ SUPERSEDED 2026-09-03 (operator-walk finding B4). This asserted the
	 * gray `tone-mute` pair `BuildStateMark`'s word wears, on the theory that
	 * matching it in HUE was the whole requirement. Measured on the live
	 * page instead: `6 of 6 places running it` over a bar painted 3 green +
	 * 3 gray reads as "3 of 6", because gray is this table's colour for
	 * ABSENCE everywhere else (`ahead`, `notYet`'s outline) — a held place
	 * IS running the revision, just on an older release, and needs a fill
	 * that says "filled". `HELD_SEGMENT_FILL` is now the exact orange
	 * `ControlCenter.svelte`/`RolloutGrid.svelte` already paint their own
	 * `held` dot — zero new colour values, see its own comment. It still
	 * must not collide with `live`'s green or `ahead`'s gray, which is the
	 * one assertion this test keeps.
	 */
	it('`coverageFill` gives `held` the product\'s own orange `held` tone, never `live`\'s green or `ahead`\'s gray', () => {
		expect(coverageFill('held')).toBe('bg-orange-500');
		expect(coverageFill('held')).not.toBe(coverageFill('live'));
		expect(coverageFill('held')).not.toBe(coverageFill('ahead'));
	});

	/** Same shape as `heldRevisionFixture`, plus the gate the live cluster
	 *  fixture actually carries — a contract with an empty allow-list, which
	 *  refuses the newer release (rel-67) everywhere. */
	function heldRevisionFixtureWithGate() {
		const sha = 'eeeeeee0000000000000000000000000000000';
		const older = { tag: 'main-66', version: '1.66.0-66', revision: sha, created: minsAgo(120) };
		const newer = { tag: 'main-67', version: '1.67.0-67', revision: sha, created: minsAgo(10) };
		const gated = (r: Rollout): Rollout => {
			r.status!.gates = [{ name: 'dependency-hello-frontend-needs-api', allowedVersions: [] }];
			return r;
		};
		const rollouts = [
			gated(
				rollout('hello-frontend-app', 'hfa-dev', [newer, older], [{ r: older, minutesAgo: 5 }])
			),
			gated(
				rollout(
					'hello-frontend-app',
					'hfa-staging',
					[newer, older],
					[{ r: older, minutesAgo: 5 }]
				)
			),
			gated(
				rollout('hello-frontend-app', 'hfa-prod', [newer, older], [{ r: older, minutesAgo: 3 }])
			)
		];
		const environments = [
			environment('hello-frontend-app', 'hfa-dev', 'dev'),
			environment('hello-frontend-app', 'hfa-staging', 'staging'),
			environment('hello-frontend-app', 'hfa-prod', 'prod')
		];
		return buildRevisionLedger(rollouts, environments)[0];
	}

	/**
	 * ⭐ THE RELEASE-LINE CLAUSE — the fact `classify()` folds into `live`
	 * without saying which release. (2026-09-03, operator-walk BLOCKING item)
	 */
	describe('releaseSplit', () => {
		it("is empty when every live place is on the row's own release — the ordinary case", () => {
			const repo = fixture();
			const cov = revisionCoverage(repo.rows[0], new Date());
			expect(releaseSplit(cov)).toEqual([]);
		});

		it("names the older release, the count, the places, and the row's own release they have not taken", () => {
			const repo = heldRevisionFixture();
			const cov = revisionCoverage(repo.rows[0], new Date());
			const lines = releaseSplit(cov);
			expect(lines).toHaveLength(1);
			expect(lines[0].behindLabel).toBe('1.66.0-66');
			expect(lines[0].count).toBe(3);
			expect(lines[0].aheadLabel).toBe('1.67.0-67');
			expect(lines[0].envLabels.slice().sort()).toEqual(['dev', 'prod', 'staging']);
			// No gate on this fixture — no evidence, so no "held" claim.
			expect(lines[0].held).toBe(false);
		});

		it('says `held` only when every one of the places has real gate evidence', () => {
			const repo = heldRevisionFixtureWithGate();
			const cov = revisionCoverage(repo.rows[0], new Date());
			const lines = releaseSplit(cov);
			expect(lines).toHaveLength(1);
			expect(lines[0].held).toBe(true);
		});
	});

	/**
	 * ⛔ NOT `fully rolled out` WHILE A RELEASE OF THE REVISION IS HELD.
	 * (2026-09-03, operator-walk BLOCKING item) `liveCount === totalCount`
	 * alone used to be the ONLY test `done` made — true here (3 of 3), and
	 * still false: the row's own headline release has landed nowhere.
	 */
	describe('buildState — the held-release case', () => {
		it("is `held`, never `done`, when a live place is not on the row's own release", () => {
			const repo = heldRevisionFixture();
			const cov = revisionCoverage(repo.rows[0], new Date());
			const state = buildState(cov);
			expect(state.key).toBe('held');
			expect(state.word).not.toContain('fully rolled out');
			expect(state.word).toContain('on an older release of it');
		});

		it('names the gate-held case with its own word when there is real gate evidence', () => {
			const repo = heldRevisionFixtureWithGate();
			const cov = revisionCoverage(repo.rows[0], new Date());
			const state = buildState(cov);
			expect(state.key).toBe('held');
			expect(state.word).toBe('held in 3 places');
		});

		it('stays `done` in the ordinary case — every live place IS on its own release', () => {
			// Hand-built rather than derived from a row: the fixtures above have
			// no shape that is fully converged with nothing else to say, and
			// `done` is exactly the absence of every other bucket AND of any
			// held-behind slot.
			const slot = (envLabel: string): CoverageSlotVM => ({
				key: 'live',
				appName: 'api',
				envName: envLabel.toLowerCase(),
				envLabel,
				slot: {} as CoverageSlotVM['slot'],
				label: '1.3.0',
				labelDiffers: true,
				dotClass: '',
				statusWord: 'deploy succeeded',
				stuck: false,
				runs: '1.3.0',
				currentRank: 0,
				revRank: 0,
				onOwnRelease: true,
				gap: 0,
				blockingGates: [],
				awaitingApprovalGates: [],
				notPassingGates: [],
				candidate: false,
				promoteTag: null,
				rolloutRef: null
			});
			const slots = [slot('DEV'), slot('PROD')];
			const cov: RevisionCoverage = {
				liveCount: 2,
				totalCount: 2,
				buckets: [{ key: 'live', title: 'Running it now', description: '', slots }],
				reachable: true
			};
			const state = buildState(cov);
			expect(state.key).toBe('done');
			expect(state.word).toBe('fully rolled out');
		});
	});
});
