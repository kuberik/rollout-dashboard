import { describe, it, expect } from 'vitest';
import { buildRevisionLedger } from './revision-ledger';
import {
	revisionCoverage,
	coverageBarSegments,
	coverageBarLabel,
	coverageCounts,
	coverageCells,
	coverageWeight,
	releaseHeldClause,
	WEIGHT_ORDER,
	WEIGHT_FILL,
	COVERAGE_ORDER,
	buildState,
	releaseSplit,
	type RevisionCoverage,
	type CoverageSlotVM,
	type CoverageBucket,
	type CoverageKey
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

	/**
	 * ⭐ ROUND 11, A.5 — `coverageBarSegments` REPLACES THE OLD BUCKET-KEYED
	 * SHIM THIS TEST USED TO PIN. The bar's segments are now
	 * `CoverageWeight`-keyed and ALWAYS four entries, in `WEIGHT_ORDER`,
	 * never dropping an empty one — see that function's own doc comment for
	 * why a fixed partition is the point.
	 */
	it('emits exactly the four weights, in WEIGHT_ORDER, summing to the total', () => {
		const repo = fixture();
		const cov = revisionCoverage(repo.rows[0], new Date());
		const segs = coverageBarSegments(cov);
		expect(segs.map((s) => s.key)).toEqual(WEIGHT_ORDER);
		expect(segs.reduce((n, s) => n + s.count, 0)).toBe(cov.totalCount);
		// `live: 3, notYet: 1` (asserted above) collapses to `here: 3`,
		// `notReached: 1` — the two weights this fixture's buckets map to.
		expect(segs.find((s) => s.key === 'here')!.count).toBe(3);
		expect(segs.find((s) => s.key === 'notReached')!.count).toBe(1);
		expect(segs.find((s) => s.key === 'movedOn')!.count).toBe(0);
		expect(segs.find((s) => s.key === 'unplaceable')!.count).toBe(0);
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
	 * ⭐ REVISIONS-2026-09-06, ITEM 1 — SUPERSEDES THE ROUND 4a EXPECTATION
	 * THIS TEST USED TO ASSERT. `heldRevisionFixture` still produces TWO rows
	 * (`revision-ledger.test.ts` has the same fixture's own row-level
	 * assertions), but the held release's OWN row now reports `live: 3`, not
	 * `notYet: 3` — the page's identifier is the SHA, and all three places
	 * genuinely run this commit (under the sibling release). Reading `notYet`
	 * here was the exact bug the round-4/5 critique caught live: `held in 3
	 * places · 3 of 6` while all 6 places ran the revision. `onOwnRelease`
	 * carries the finer fact ("not on THIS row's exact release") that
	 * `classify()` no longer folds into the bucket.
	 */
	it('gives the held release its own row: live, on the commit, but not on its own release', () => {
		const repo = heldRevisionFixture();
		expect(repo.rows).toHaveLength(2);
		const held = repo.rows.find((r) => r.services[0].label === '1.67.0-67')!;
		const cov = revisionCoverage(held, new Date());
		expect(cov.liveCount).toBe(3);
		expect(cov.totalCount).toBe(3);
		expect(cov.buckets.some((b) => b.key === 'notYet')).toBe(false);
		const live = cov.buckets.find((b) => b.key === 'live');
		expect(live?.slots.length).toBe(3);
		// They ARE running the same commit — just the sibling release, so
		// `onOwnRelease` is false even though the bucket is `live`.
		expect(live?.slots.every((s) => s.onOwnRelease)).toBe(false);
		expect(live?.slots.every((s) => s.slot.onRevision)).toBe(true);
		expect(live?.slots.every((s) => s.runs === '1.66.0-66')).toBe(true);
		expect(live?.slots.every((s) => s.label === '1.67.0-67')).toBe(true);
	});

	it('gives the running release its own row: live, and on its own release', () => {
		const repo = heldRevisionFixture();
		const running = repo.rows.find((r) => r.services[0].label === '1.66.0-66')!;
		const cov = revisionCoverage(running, new Date());
		expect(cov.liveCount).toBe(3);
		const live = cov.buckets.find((b) => b.key === 'live')!;
		expect(live.slots.map((s) => s.onOwnRelease)).toEqual([true, true, true]);
	});

	it('keeps a release "live" when the environment is genuinely on this row\'s own build', () => {
		const repo = fixture();
		const head = repo.rows[0];
		// The ordinary case — no second release sharing the revision — must be
		// byte-identical to before: three places are live, not reclassified.
		expect(counts(head)).toEqual({ live: 3, notYet: 1 });
	});

	/**
	 * ⛔ THE `held` SEGMENT IS GONE — ONE BAR, ONE FILL. (2026-09-03, direct
	 * from the human, overriding design pass 7 finding #5: *"I don't like
	 * that revisions status bars are split in two."*) A `live` slot on an
	 * older release now draws the SAME plain `live` segment as any other —
	 * `classify()` and the bucket count are still unchanged (`live: 3`,
	 * asserted above and in `heldRevisionFixture`'s own tests) and so is the
	 * WORD (`buildState()` still leads with `held in N places` for this
	 * fixture — see the describe block below); only the bar's SEGMENTATION
	 * reverted to one segment per bucket.
	 */
	/**
	 * ⭐ ROUND 11 — RETARGETS THE OLD BUCKET-KEYED DESCRIBE BLOCK AT
	 * `coverageBarSegments`. The claim survives unchanged ("a live slot held
	 * on an older release still draws as plain live, never a second colour")
	 * — only the vocabulary does: there is no `held` KEY to check for any
	 * more because there is no per-bucket key at all on the bar now, only
	 * the four weights, and `live`/`failing`/`deploying` are deliberately
	 * one weight, `here` (see `coverageWeight`'s own doc comment).
	 */
	describe('coverageBarSegments: a `live` slot held on an older release still draws as plain `here`', () => {
		it('draws the whole row as `here`, whichever release each place is actually on', () => {
			const repo = heldRevisionFixture();
			const held = repo.rows.find((r) => r.services[0].label === '1.67.0-67')!;
			const running = repo.rows.find((r) => r.services[0].label === '1.66.0-66')!;
			const heldSegs = coverageBarSegments(revisionCoverage(held, new Date()));
			const runningSegs = coverageBarSegments(revisionCoverage(running, new Date()));
			expect(heldSegs).toEqual([
				{ key: 'here', count: 3, title: 'Running this build', reachable: true },
				{ key: 'movedOn', count: 0, title: 'Have moved past this build', reachable: true },
				{ key: 'notReached', count: 0, title: 'Not reached yet', reachable: true },
				{ key: 'unplaceable', count: 0, title: 'On a different release line', reachable: true }
			]);
			expect(runningSegs).toEqual(heldSegs);
		});

		/**
		 * ⭐ REVISIONS-2026-09-06, ITEM 1 — ASYMMETRIC BY DESIGN, so this fixture
		 * is the one that proves it. `hfa-dev` runs the OLDER release (66) while
		 * `hfa-prod` runs the NEWER one (67); both share one commit.
		 *
		 *   · On rel-67's OWN row, `dev` (on the older release of THIS commit)
		 *     is now `live`, not `notYet` — item 1's fix. `prod` is `live` via
		 *     plain `onIt`. Both places run the revision, so the row is `2 of 2`
		 *     — all `here` on the bar.
		 *   · On rel-66's OWN row, `prod` (on the NEWER release) is still
		 *     `ahead` — UNCHANGED, so it reads `movedOn` on the bar. It has
		 *     genuinely moved past this row's own release, which is a
		 *     different fact from "hasn't arrived yet", and item 1 only
		 *     touches the `currentRank > service.rank` (not-yet-arrived)
		 *     branch, never the `ahead` one. `dev` is `live` via `onIt`, so
		 *     `here`.
		 */
		it('is asymmetric: an older sibling release reads `here`, a newer one still reads `movedOn`', () => {
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
			const rel67 = repo.rows.find((r) => r.services[0].label === '1.67.0-67')!;
			const rel66 = repo.rows.find((r) => r.services[0].label === '1.66.0-66')!;
			expect(coverageBarSegments(revisionCoverage(rel67, new Date()))).toEqual([
				{ key: 'here', count: 2, title: 'Running this build', reachable: true },
				{ key: 'movedOn', count: 0, title: 'Have moved past this build', reachable: true },
				{ key: 'notReached', count: 0, title: 'Not reached yet', reachable: true },
				{ key: 'unplaceable', count: 0, title: 'On a different release line', reachable: true }
			]);
			expect(coverageBarSegments(revisionCoverage(rel66, new Date()))).toEqual([
				{ key: 'here', count: 1, title: 'Running this build', reachable: true },
				{ key: 'movedOn', count: 1, title: 'Have moved past this build', reachable: true },
				{ key: 'notReached', count: 0, title: 'Not reached yet', reachable: true },
				{ key: 'unplaceable', count: 0, title: 'On a different release line', reachable: true }
			]);
		});

		it('is the ordinary case, byte-equivalent to a live/notYet mix folded into here/notReached', () => {
			const repo = fixture();
			const cov = revisionCoverage(repo.rows[0], new Date());
			const segs = coverageBarSegments(cov);
			expect(segs.map((s) => s.key)).toEqual(WEIGHT_ORDER);
			expect(segs.reduce((n, s) => n + s.count, 0)).toBe(cov.totalCount);
		});
	});

	/**
	 * ⭐ ROUND 11, LANE 1 ACCEPTANCE — `coverageBarSegments` ON A 0%, A 100%,
	 * A MIXED, AND AN ALL-`ahead` FIXTURE. Built directly from synthetic
	 * `RevisionCoverage` values (`coverageFrom`, a light-weight `CoverageSlotVM`
	 * stand-in) rather than through `buildRevisionLedger`, because the claim
	 * under test is `coverageBarSegments`'s own arithmetic — the weight
	 * mapping and the fixed four-entry partition — not the ledger's.
	 */
	describe('coverageBarSegments — the four required fixtures', () => {
		function stubSlot(key: CoverageKey, appName = 'app'): CoverageSlotVM {
			return {
				key,
				appName,
				envName: 'env',
				envLabel: 'ENV',
				slot: {} as CoverageSlotVM['slot'],
				label: 'v1',
				labelDiffers: false,
				dotClass: '',
				statusWord: '',
				stuck: false,
				inFlight: key === 'deploying',
				runs: null,
				currentRank: null,
				revRank: null,
				onOwnRelease: true,
				gap: null,
				blockingGates: [],
				awaitingApprovalGates: [],
				notPassingGates: [],
				candidate: false,
				promoteTag: null,
				rolloutRef: null
			};
		}

		function coverageFrom(specs: Array<[CoverageKey, string?]>, reachable = true): RevisionCoverage {
			const byKey = new Map<CoverageKey, CoverageSlotVM[]>();
			for (const [key, appName] of specs) {
				const list = byKey.get(key) ?? [];
				list.push(stubSlot(key, appName));
				byKey.set(key, list);
			}
			const buckets: CoverageBucket[] = COVERAGE_ORDER.filter((k) => byKey.has(k)).map((k) => ({
				key: k,
				title: k,
				description: '',
				slots: byKey.get(k)!
			}));
			const liveCount = (byKey.get('live')?.length ?? 0) + (byKey.get('failing')?.length ?? 0);
			return { liveCount, totalCount: specs.length, buckets, reachable };
		}

		it('0% — every place notYet, all track', () => {
			const cov = coverageFrom([['notYet'], ['notYet'], ['notYet']]);
			const segs = coverageBarSegments(cov);
			expect(segs.map((s) => s.key)).toEqual(WEIGHT_ORDER);
			expect(segs.reduce((n, s) => n + s.count, 0)).toBe(cov.totalCount);
			expect(segs.map((s) => s.count)).toEqual([0, 0, 3, 0]);
		});

		it('100% — every place live/failing/deploying, all here', () => {
			const cov = coverageFrom([['live'], ['live'], ['failing'], ['deploying']]);
			const segs = coverageBarSegments(cov);
			expect(segs.map((s) => s.key)).toEqual(WEIGHT_ORDER);
			expect(segs.reduce((n, s) => n + s.count, 0)).toBe(cov.totalCount);
			expect(segs.map((s) => s.count)).toEqual([4, 0, 0, 0]);
		});

		it('mixed — one of each bucket', () => {
			const cov = coverageFrom([
				['live'],
				['deploying'],
				['ahead'],
				['ahead'],
				['notYet'],
				['unplaceable']
			]);
			const segs = coverageBarSegments(cov);
			expect(segs.map((s) => s.key)).toEqual(WEIGHT_ORDER);
			expect(segs.reduce((n, s) => n + s.count, 0)).toBe(cov.totalCount);
			expect(segs.map((s) => s.count)).toEqual([2, 2, 1, 1]);
		});

		it('all-ahead — every place has moved on', () => {
			const cov = coverageFrom([['ahead'], ['ahead'], ['ahead']]);
			const segs = coverageBarSegments(cov);
			expect(segs.map((s) => s.key)).toEqual(WEIGHT_ORDER);
			expect(segs.reduce((n, s) => n + s.count, 0)).toBe(cov.totalCount);
			expect(segs.map((s) => s.count)).toEqual([0, 3, 0, 0]);
		});
	});

	describe('coverageBarLabel', () => {
		function stubSlot(key: CoverageKey, appName: string): CoverageSlotVM {
			return {
				key,
				appName,
				envName: 'env',
				envLabel: 'ENV',
				slot: {} as CoverageSlotVM['slot'],
				label: 'v1',
				labelDiffers: false,
				dotClass: '',
				statusWord: '',
				stuck: false,
				inFlight: key === 'deploying',
				runs: null,
				currentRank: null,
				revRank: null,
				onOwnRelease: true,
				gap: null,
				blockingGates: [],
				awaitingApprovalGates: [],
				notPassingGates: [],
				candidate: false,
				promoteTag: null,
				rolloutRef: null
			};
		}

		function coverageFrom(specs: Array<[CoverageKey, string]>): RevisionCoverage {
			const byKey = new Map<CoverageKey, CoverageSlotVM[]>();
			for (const [key, appName] of specs) {
				const list = byKey.get(key) ?? [];
				list.push(stubSlot(key, appName));
				byKey.set(key, list);
			}
			const buckets: CoverageBucket[] = COVERAGE_ORDER.filter((k) => byKey.has(k)).map((k) => ({
				key: k,
				title: k,
				description: '',
				slots: byKey.get(k)!
			}));
			const liveCount = (byKey.get('live')?.length ?? 0) + (byKey.get('failing')?.length ?? 0);
			return { liveCount, totalCount: specs.length, buckets, reachable: true };
		}

		it('at 0%, names the denominator and says none is running it yet', () => {
			const cov = coverageFrom([
				['notYet', 'hello-api-app'],
				['notYet', 'hello-frontend-app']
			]);
			expect(coverageBarLabel(cov, '9f10e49')).toBe(
				'Across the 2 places hello-api-app and hello-frontend-app deploy to: none is running 9f10e49 yet.'
			);
		});

		it('at 100%, names a single-app denominator with the singular verb', () => {
			const cov = coverageFrom([
				['live', 'hello-api-app'],
				['live', 'hello-api-app']
			]);
			expect(coverageBarLabel(cov, '9f10e49')).toBe(
				'Across the 2 places hello-api-app deploys to: 2 running 9f10e49.'
			);
		});

		it('names `deploying` as its own clause, separate from `running`', () => {
			const cov = coverageFrom([
				['live', 'api'],
				['deploying', 'api']
			]);
			expect(coverageBarLabel(cov, 'abc1234')).toBe(
				'Across the 2 places api deploys to: 1 running abc1234, 1 deploying it.'
			);
		});

		it('appends the unplaceable clause last, without a second sentence', () => {
			const cov = coverageFrom([
				['live', 'api'],
				['unplaceable', 'api']
			]);
			const label = coverageBarLabel(cov, 'abc1234');
			expect(label).toBe(
				'Across the 2 places api deploys to: 1 running abc1234, 1 on a different release line.'
			);
			expect(label.match(/\./g)?.length).toBe(1);
		});
	});

	it('WEIGHT_FILL never reaches blue, red, amber or yellow — adversity and status stay off the bar', () => {
		const values = Object.values(WEIGHT_FILL).join(' ');
		expect(values).not.toMatch(/blue-|red-|amber-|yellow-/);
	});

	it('coverageWeight maps every CoverageKey onto exactly one of the four weights', () => {
		expect(coverageWeight('live')).toBe('here');
		expect(coverageWeight('failing')).toBe('here');
		expect(coverageWeight('deploying')).toBe('here');
		expect(coverageWeight('ahead')).toBe('movedOn');
		expect(coverageWeight('notYet')).toBe('notReached');
		expect(coverageWeight('unplaceable')).toBe('unplaceable');
	});

	it('coverageCounts splits deploying out of `here` for the words, while the bar still merges them', () => {
		const repo = fixture();
		const cov = revisionCoverage(repo.rows[0], new Date());
		const counts = coverageCounts(cov);
		expect(counts).toEqual({ here: 3, deploying: 0, movedOn: 0, notReached: 1, unplaceable: 0, total: 4 });
	});

	/**
	 * ⭐ OPERATOR-WALK ADDITION, ROUND 11 — `releaseHeldClause` MUST NOT SAY
	 * "HELD FROM A NEWER RELEASE" ABOUT THE ROW'S OWN RELEASE. See that
	 * function's own doc comment: `releaseSplit`'s `aheadLabel` is always
	 * the row's own name, so a generic "held from a newer release" is
	 * self-referential on this exact hero. The plain statement names both
	 * labels as the SAME commit and says where.
	 */
	describe('releaseHeldClause', () => {
		it('names the same build under a newer label and where it has not reached, with no gate evidence', () => {
			const repo = heldRevisionFixture();
			const held = repo.rows.find((r) => r.services[0].label === '1.67.0-67')!;
			const cov = revisionCoverage(held, new Date());
			const lines = releaseSplit(cov);
			expect(lines).toHaveLength(1);
			const clause = releaseHeldClause(lines[0]);
			expect(clause).toBe(
				'1.67.0-67 is this same build under a newer label · has not reached dev, staging and prod yet'
			);
			expect(clause).not.toMatch(/held from a newer release/);
		});

		it('says "held in", not a bare count, when there is real gate evidence', () => {
			const repo = heldRevisionFixtureWithGate();
			const cov = revisionCoverage(repo.rows[0], new Date());
			const lines = releaseSplit(cov);
			expect(lines).toHaveLength(1);
			const clause = releaseHeldClause(lines[0]);
			expect(clause).toBe('1.67.0-67 is this same build under a newer label · held in dev, staging and prod');
		});
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
				inFlight: false,
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

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 1 — THE EXACT LIVE-FLEET SHAPE. Two
	 * services share one commit: `hello-api-app` has only ever released it
	 * once (`1.66.0-66`), `hello-frontend-app` has released it twice — the
	 * running `2.66.0-66` and the held `2.67.0-67`. All SIX places run the
	 * revision. The bug report: the hero for this commit read `held in 3
	 * places · 3 of 6` with a half-empty bar, though every place was on it.
	 */
	describe('the two-service held-commit fleet shape', () => {
		function twoServiceHeldFixture() {
			const sha = 'ddddddd0000000000000000000000000000000';
			const apiRel = {
				tag: 'main-api-66',
				version: '1.66.0-66',
				revision: sha,
				created: minsAgo(120)
			};
			const older = { tag: 'main-66', version: '2.66.0-66', revision: sha, created: minsAgo(120) };
			const newer = { tag: 'main-67', version: '2.67.0-67', revision: sha, created: minsAgo(10) };
			const rollouts = [
				rollout('hello-api-app', 'haa-dev', [apiRel], [{ r: apiRel, minutesAgo: 5 }]),
				rollout('hello-api-app', 'haa-staging', [apiRel], [{ r: apiRel, minutesAgo: 5 }]),
				rollout('hello-api-app', 'haa-prod', [apiRel], [{ r: apiRel, minutesAgo: 3 }]),
				rollout(
					'hello-frontend-app',
					'hfa-dev',
					[newer, older],
					[{ r: older, minutesAgo: 5 }]
				),
				rollout(
					'hello-frontend-app',
					'hfa-staging',
					[newer, older],
					[{ r: older, minutesAgo: 5 }]
				),
				rollout(
					'hello-frontend-app',
					'hfa-prod',
					[newer, older],
					[{ r: older, minutesAgo: 3 }]
				)
			];
			const environments = [
				environment('hello-api-app', 'haa-dev', 'dev'),
				environment('hello-api-app', 'haa-staging', 'staging'),
				environment('hello-api-app', 'haa-prod', 'prod'),
				environment('hello-frontend-app', 'hfa-dev', 'dev'),
				environment('hello-frontend-app', 'hfa-staging', 'staging'),
				environment('hello-frontend-app', 'hfa-prod', 'prod')
			];
			return buildRevisionLedger(rollouts, environments)[0];
		}

		it('reads 6 of 6, never 3 of 6, on the held release\'s own row', () => {
			const repo = twoServiceHeldFixture();
			const held = repo.rows.find((r) => r.services.some((s) => s.label === '2.67.0-67'))!;
			const cov = revisionCoverage(held, new Date());
			expect(cov.liveCount).toBe(6);
			expect(cov.totalCount).toBe(6);
			expect(cov.buckets.some((b) => b.key === 'notYet')).toBe(false);
		});
	});

	/**
	 * ⭐ REVISIONS-2026-09-06, ITEM 2 (IN-FLIGHT STATE, blocking). During a pin
	 * clear the list read `fully rolled out · 9 of 9` for ~2 minutes while one
	 * place was mid-canary (`bakeStatus: Deploying`). A slot whose newest
	 * history entry is `Deploying` or `InProgress` buckets as `deploying` —
	 * excluded from `live` — so the page can never again call a build "fully
	 * rolled out" while a deploy is still going out somewhere.
	 */
	describe('the in-flight bucket', () => {
		function inFlightFixture(bake: string) {
			const A = [rel('aaaaaaa', '1.3.0', 10), rel('bbbbbbb', '1.2.0', 120)];
			const rollouts = [
				rollout('api', 'api-dev', A, [{ r: A[0], minutesAgo: 5 }]),
				rollout('api', 'api-prod', A, [{ r: A[0], minutesAgo: 1, bake }])
			];
			const environments = [
				environment('api', 'api-dev', 'dev'),
				environment('api', 'api-prod', 'prod')
			];
			return buildRevisionLedger(rollouts, environments)[0];
		}

		it('buckets a `Deploying` slot as `deploying`, excluded from `live`', () => {
			const repo = inFlightFixture('Deploying');
			const cov = revisionCoverage(repo.rows[0], new Date());
			expect(cov.liveCount).toBe(1);
			expect(cov.totalCount).toBe(2);
			const deploying = cov.buckets.find((b) => b.key === 'deploying');
			expect(deploying?.slots.length).toBe(1);
			expect(deploying?.slots[0].inFlight).toBe(true);
			expect(cov.buckets.some((b) => b.key === 'live' && b.slots.length === 2)).toBe(false);
		});

		it('buckets an `InProgress` (baking) slot as `deploying` too', () => {
			const repo = inFlightFixture('InProgress');
			const cov = revisionCoverage(repo.rows[0], new Date());
			const deploying = cov.buckets.find((b) => b.key === 'deploying');
			expect(deploying?.slots.length).toBe(1);
			expect(deploying?.slots[0].inFlight).toBe(true);
		});

		it('never says "fully rolled out" while a place is still deploying', () => {
			const repo = inFlightFixture('Deploying');
			const cov = revisionCoverage(repo.rows[0], new Date());
			const state = buildState(cov);
			expect(state.key).toBe('deploying');
			expect(state.word).not.toBe('fully rolled out');
			expect(state.word).toBe('1 live · 1 deploying');
		});

		it('is `done` once the in-flight place settles — same fixture, no bake override', () => {
			const A = [rel('aaaaaaa', '1.3.0', 10), rel('bbbbbbb', '1.2.0', 120)];
			const rollouts = [
				rollout('api', 'api-dev', A, [{ r: A[0], minutesAgo: 5 }]),
				rollout('api', 'api-prod', A, [{ r: A[0], minutesAgo: 1 }])
			];
			const environments = [
				environment('api', 'api-dev', 'dev'),
				environment('api', 'api-prod', 'prod')
			];
			const repo = buildRevisionLedger(rollouts, environments)[0];
			const cov = revisionCoverage(repo.rows[0], new Date());
			expect(buildState(cov).key).toBe('done');
		});
	});
});

/**
 * ⭐ REVISIONS-PASS-6, ITEM 3 — `coverageCells()`. One entry per PLACE
 * (never per bucket), ordered by environment then service, so `CoverageBar`
 * can title each cell it draws — "which 3 of the 6" is answerable now.
 */
describe('coverageCells', () => {
	it('emits one cell per place, ordered by environment then service', () => {
		const repo = fixture();
		const head = repo.rows[0]; // api-dev, api-prod, web-dev live; web-prod notYet.
		const cells = coverageCells(revisionCoverage(head, new Date()));
		expect(cells).toHaveLength(4);
		// dev before prod; api before web within each environment.
		expect(cells.map((c) => c.title)).toEqual([
			'dev · api · running this build',
			'dev · web · running this build',
			'prod · api · running this build',
			'prod · web · not reached yet'
		]);
		expect(cells.map((c) => c.key)).toEqual(['here', 'here', 'here', 'notReached']);
	});

	it('sums to the same total as coverageBarSegments, for every fixture', () => {
		const repo = fixture();
		for (const row of repo.rows) {
			const cov = revisionCoverage(row, new Date());
			expect(coverageCells(cov)).toHaveLength(cov.totalCount);
			expect(coverageCells(cov).length).toBe(
				coverageBarSegments(cov).reduce((n, s) => n + s.count, 0)
			);
		}
	});

	it('an all-`ahead` build (everyone moved past it) is four "moved past" cells, no "running"', () => {
		const repo = fixture();
		const old = repo.rows[2]; // ccccccc: only web-prod still runs it; the rest moved on.
		const cov = revisionCoverage(old, new Date());
		const cells = coverageCells(cov);
		expect(cells.filter((c) => c.key === 'movedOn')).toHaveLength(3);
		expect(cells.filter((c) => c.key === 'here')).toHaveLength(1);
		for (const c of cells.filter((c) => c.key === 'movedOn')) {
			expect(c.title).toMatch(/ · moved past$/);
		}
	});
});
