/**
 * ONE ROLLOUT, EVERY SURFACE, ONE NUMBER — AND THE NUMBER IS THE CONTROLLER'S.
 *
 * ⚠️ THIS FILE WAS REWRITTEN 2026-08-31 AND IT REVERSES ITS OWN EARLIER
 * RULING. It used to pin "N behind = the build's rank on the app's union
 * ladder". A live critique then measured the product printing TWO numbers for
 * one word on ONE card: `/apps/<name>` said `−20 PROD` (ladder) beside
 * `15 versions ready` (the rollout's own candidates), and rollout detail said
 * `15 upgrades available`.
 *
 * The tie was broken against the API, not against taste. On the live hub,
 * `hello-world-app` / prod running `205a312`:
 *
 *   prod `availableReleases`              33 entries, `205a312` at index 8
 *   ⇒ newer in prod's OWN list          **24**
 *   prod `status.releaseCandidates`      **24**   ← the controller's own answer
 *   union ladder across dev+staging+prod   37 entries
 *   ⇒ ladder rank of `205a312`             28
 *
 * The four extra builds the ladder counts (`139acae`, `171c103`, `bddd9e4`,
 * `e87f059`) are in dev's and staging's lists and in NEITHER prod's
 * `availableReleases` nor prod's `releaseCandidates`. **`/rollouts/<...>`
 * renders "N upgrades available" and its whole upgrade list straight from
 * `releaseCandidates`, and `ChangeVersionModal` renders its picker straight
 * from `availableReleases`.** A chip saying 28 above a list of 24 rows is the
 * same contradiction one level down.
 *
 * Swept across all 15 live rollouts: every build the union adds to a
 * rollout's own list is OLDER than that rollout's own newest. The union never
 * contributes a newer release — it can only inflate.
 *
 * ── THE COST, PINNED HERE SO NOBODY REDISCOVERS IT AS A BUG ───────────────
 *
 * Two environments running the IDENTICAL sha CAN hold different numbers,
 * because their candidate lists genuinely differ. Measured live,
 * `hello-world-app` at `c78a9de4`: prod 30, dev 28, staging 29. That is not a
 * contradiction — it is three upgrade paths — and `rankTitle` names the
 * ENVIRONMENT as the subject so the number is never presented as a fact about
 * the sha.
 *
 * What must NEVER happen, and is asserted below, is a page rendering a LAG
 * BETWEEN two environments that are on the same build. Different counts is a
 * fact; "staging is 20 behind dev" while both run one sha is a lie.
 */
import { describe, it, expect } from 'vitest';
import type { Rollout, Environment } from '$lib/../types';
import { groupRolloutsByApp } from '$lib/version-utils';
import { buildRolloutCards } from '$lib/rollout-cards';
import { buildMatrix } from './matrix';
import { buildLadder } from './build-ladder';
import { newerReleaseCount } from './promotion';
import {
	rankVerdicts,
	rankVerdictFor,
	rankVerdictsByRollout,
	rankLabel,
	rankRole,
	rankTitle,
	rankBehindBy
} from './env-rank';

const APP = 'hello-world-app';
const NOW = new Date('2026-08-30T12:00:00Z');

/** Build at ladder rank `r`. Rank 0 is the newest; `created` descends with it. */
const sha = (r: number) => `b${String(r).padStart(2, '0')}`;
const created = (r: number) => new Date(NOW.getTime() - r * 3_600_000).toISOString();
const release = (r: number) => ({ version: sha(r), tag: sha(r), created: created(r) });

/**
 * THE LIVE SHAPE. Ranks each environment's `availableReleases` carries, given
 * OLDEST-FIRST as the API serves them, so the first entry is what that
 * environment is running.
 *
 *   dev     16 entries, oldest is rank 19  → own list says 15 newer
 *   staging 15 entries, oldest is rank 19  → own list says 14 newer
 *   prod    20 entries, oldest is rank 24  → own list says 19 newer
 *
 * Their union is ranks 0..24 — one ladder, 25 builds deep.
 */
const DEV_LIST = [19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 0];
const STAGING_LIST = [19, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 3, 0];
const PROD_LIST = [24, 23, 22, 21, 20, 19, 17, 16, 15, 14, 13, 12, 11, 10, 9, 4, 3, 2, 1, 0];

function rollout(tier: string, list: number[], currentRank: number, deployedAgoMin = 60): Rollout {
	return {
		metadata: { name: APP, namespace: `${APP}-${tier}` },
		spec: {},
		status: {
			history: [
				{
					version: release(currentRank),
					timestamp: new Date(NOW.getTime() - deployedAgoMin * 60_000).toISOString(),
					bakeStatus: 'Succeeded'
				}
			],
			// OLDEST-FIRST — the API's contract, and the thing three derivations
			// have now got backwards at least once between them.
			availableReleases: list
				.slice()
				.sort((a, b) => b - a)
				.map(release),
			gates: []
		}
	} as unknown as Rollout;
}

function environment(tier: string): Environment {
	return {
		metadata: { name: APP, namespace: `${APP}-${tier}` },
		spec: { environment: tier, name: APP, rolloutRef: { name: APP } }
	} as unknown as Environment;
}

const dev = rollout('dev', DEV_LIST, 19);
const staging = rollout('staging', STAGING_LIST, 19);
const prod = rollout('prod', PROD_LIST, 24);
const ROLLOUTS = [dev, staging, prod];
const ENVIRONMENTS = [environment('dev'), environment('staging'), environment('prod')];

const group = () => groupRolloutsByApp(ROLLOUTS, ENVIRONMENTS).get(APP)!;

describe('the fixture really is the shape that broke — asymmetric lists, one build', () => {
	it('gives three DIFFERENT own-list counts for two environments on ONE build', () => {
		// This is the API reading, and it is why the per-rollout denominator
		// lost. dev and staging run the same sha and their own lists disagree.
		expect(newerReleaseCount(dev)).toBe(15);
		expect(newerReleaseCount(staging)).toBe(14);
		expect(newerReleaseCount(prod)).toBe(19);
		expect(dev.status!.history![0].version).toEqual(staging.status!.history![0].version);
	});

	it('unions those asymmetric lists into ONE ladder that explains them', () => {
		// 16 + 15 + 20 entries, 25 distinct builds. Each list is a WINDOW onto
		// the ladder, not a ladder of its own.
		const ladder = buildLadder(group().cells);
		expect(ladder.builds.length).toBe(25);
		expect(ladder.builds[0].version).toBe(sha(0));
		expect(ladder.rankOf(sha(19))).toBe(19);
		expect(ladder.rankOf(sha(24))).toBe(24);
	});
});

describe('⛔ the dev-vs-staging contradiction', () => {
	it('gives every environment the number ITS OWN controller published', () => {
		// THE DEFINITION, STATED AS ONE ASSERTION. The verdict is the
		// rollout's own candidate count and nothing else — the same number
		// rollout detail prints as `N upgrades available` and the same number
		// of rows Change Version offers.
		const g = group();
		expect(rankVerdictFor(g, 'dev')).toEqual({ kind: 'behind', by: newerReleaseCount(dev) });
		expect(rankVerdictFor(g, 'staging')).toEqual({
			kind: 'behind',
			by: newerReleaseCount(staging)
		});
		expect(rankVerdictFor(g, 'prod')).toEqual({ kind: 'behind', by: newerReleaseCount(prod) });
		expect(rankVerdictFor(g, 'dev')).toEqual({ kind: 'behind', by: 15 });
		expect(rankVerdictFor(g, 'staging')).toEqual({ kind: 'behind', by: 14 });
		expect(rankVerdictFor(g, 'prod')).toEqual({ kind: 'behind', by: 19 });
	});

	it('NEVER exceeds what the rollout could actually deploy', () => {
		// ⛔ THE REGRESSION THIS FILE NOW EXISTS FOR. The union ladder ranks
		// all three at 19/19/24 — above dev's and staging's own candidate
		// counts — so the chip promised upgrades the picker does not list.
		// Whatever the derivation, the number may never be bigger than the
		// list it points at.
		const g = group();
		const ladder = buildLadder(g.cells);
		for (const cell of g.cells) {
			const own = newerReleaseCount(cell.rollout);
			const by = rankBehindBy(rankVerdicts(g).get(cell)!);
			expect(own).not.toBeNull();
			expect(by).toBeLessThanOrEqual(own!);
			expect(by).toBe(own);
		}
		// And the ladder really would have over-promised — this is the proof
		// the fixture still has teeth, not a tautology.
		expect(ladder.rankOf(sha(19))).toBeGreaterThan(newerReleaseCount(staging)!);
	});

	it('never prints `newest` for an environment that is 19 builds behind', () => {
		// The specific lie: `newest` is the product's rank-0 verdict and it was
		// being reached from "the derivation returned null".
		const cards = buildRolloutCards(ROLLOUTS, ENVIRONMENTS, NOW);
		for (const card of cards) {
			expect(card.rank.kind).not.toBe('newest');
			expect(rankLabel(card.rank)).not.toBe('newest');
		}
	});

	it('prints ONE spelling of the rank, and it is `N behind`', () => {
		const cards = buildRolloutCards(ROLLOUTS, ENVIRONMENTS, NOW);
		const byNs = (tier: string) => cards.find((c) => c.ns === `${APP}-${tier}`)!;
		expect(rankLabel(byNs('dev').rank)).toBe('15 behind');
		expect(rankLabel(byNs('staging').rank)).toBe('14 behind');
		expect(rankLabel(byNs('prod').rank)).toBe('19 behind');
		// ⛔ Not `−19`. A signed integer beside a build id reads as a diff and
		// names no unit; `/` and `/rollouts` were the last two pages spelling
		// it that way.
		for (const c of cards) expect(rankLabel(c.rank)).not.toMatch(/^−/);
	});

	it('tracks the rollout’s own list, and ONLY its own', () => {
		// Shrink staging's window to 4 entries. Its candidate list really does
		// become 3 — that is what its Change Version picker will offer — so
		// the chip follows it there. This assertion is the exact inverse of
		// the one it replaced, and deliberately so: the number is a fact about
		// what THIS rollout can take, not about the sha it is running.
		const narrow = rollout('staging', [19, 15, 9, 0], 19);
		const g2 = groupRolloutsByApp([dev, narrow, prod], ENVIRONMENTS).get(APP)!;
		expect(newerReleaseCount(narrow)).toBe(3);
		expect(rankVerdictFor(g2, 'staging')).toEqual({ kind: 'behind', by: 3 });
		// …and NOBODY ELSE moves. A neighbour's window is not evidence about
		// this rollout, in either direction.
		expect(rankVerdictFor(g2, 'dev')).toEqual({ kind: 'behind', by: 15 });
		expect(rankVerdictFor(g2, 'prod')).toEqual({ kind: 'behind', by: 19 });
	});

	it('states the ENVIRONMENT as the subject, never the build', () => {
		// The cost of this definition is that one sha can carry two numbers on
		// adjacent rows. That is legible only if the sentence says whose
		// upgrade path it is — so the title may not claim anything about the
		// build itself.
		const t = rankTitle({ kind: 'behind', by: 14 }, 'STAGING');
		expect(t).toBe('STAGING can still take 14 newer builds');
		expect(t).not.toMatch(/this app has/);
		expect(rankTitle({ kind: 'behind', by: 1 }, 'DEV')).toBe('DEV can still take 1 newer build');
	});
});

describe('every surface reads the same derivation', () => {
	it('the rollout card, the matrix cell and the ladder agree, rollout by rollout', () => {
		// `/` + `/rollouts` read the card; `/apps` + `/environments` read the
		// matrix; `/apps/[name]` reads the ladder. Three readers, one number.
		const cards = buildRolloutCards(ROLLOUTS, ENVIRONMENTS, NOW);
		const row = buildMatrix(ROLLOUTS, ENVIRONMENTS).rows.find((r) => r.appName === APP)!;
		const g = group();
		const ladder = buildLadder(g.cells);

		for (const tier of ['dev', 'staging', 'prod']) {
			const card = cards.find((c) => c.ns === `${APP}-${tier}`)!;
			const cell = row.cells[tier]!;
			const version = cell.version;
			expect(card.rank).toEqual(cell.rank);
			expect(card.rank).toEqual(rankVerdictFor(g, tier));
			// The oracle is the CONTROLLER's count, not the ladder position.
			expect(rankBehindBy(card.rank)).toBe(newerReleaseCount(card.rollout));
			// The ladder still orders builds, and it is still the thing that
			// decides which build is newest — it just does not count.
			expect(ladder.rankOf(version)).toBeGreaterThanOrEqual(rankBehindBy(card.rank));
			// `behind` is attribution only — its number is copied off the rank
			// so the two can never disagree.
			if (card.behind) expect(card.behind.behindBy).toBe(rankBehindBy(card.rank));
		}
	});

	it('the fleet-wide door agrees with the per-app one', () => {
		const flat = rankVerdictsByRollout(ROLLOUTS, ENVIRONMENTS);
		const g = group();
		const perApp = rankVerdicts(g);
		for (const cell of g.cells) {
			expect(flat.get(cell.rollout)).toEqual(perApp.get(cell));
		}
	});

	it('splits Steady from Trailing by the VERDICT, not by a falsy number', () => {
		// `ControlCenter` used `(behind?.behindBy ?? 0) === 0`, which put every
		// unresolved rollout in Steady and rendered it `newest`. All three of
		// these are behind, so Steady must be empty.
		const cards = buildRolloutCards(ROLLOUTS, ENVIRONMENTS, NOW);
		const steady = cards.filter((c) => c.rank.kind === 'newest' || c.rank.kind === 'unknown');
		const trailing = cards.filter((c) => rankBehindBy(c.rank) > 0 || c.rank.kind === 'diverged');
		expect(steady).toHaveLength(0);
		expect(trailing).toHaveLength(3);
	});
});

describe('an unresolvable comparison prints `unknown`, never `newest`', () => {
	it('gives a rollout with nothing deployed the `unranked` role and the word `unknown`', () => {
		const bare = {
			metadata: { name: APP, namespace: `${APP}-prod` },
			spec: {},
			status: {
				availableReleases: PROD_LIST.slice()
					.sort((a, b) => b - a)
					.map(release)
			}
		} as unknown as Rollout;
		const g = groupRolloutsByApp([dev, staging, bare], ENVIRONMENTS).get(APP)!;
		const v = rankVerdictFor(g, 'prod');
		expect(v).toEqual({ kind: 'unknown' });
		expect(rankLabel(v)).toBe('unknown');
		expect(rankRole(v)).toBe('unranked');
	});

	it('has no verdict that formats as an empty string or a bare zero', () => {
		// The `unranked` trap: a `0` in the rank chip reads as "newest", and a
		// null label sent four call sites into an `{:else}` that printed the
		// word. Every verdict now has a word.
		for (const v of [
			{ kind: 'newest' } as const,
			{ kind: 'behind', by: 1 } as const,
			{ kind: 'diverged' } as const,
			{ kind: 'unknown' } as const
		]) {
			expect(rankLabel(v)).toBeTruthy();
			expect(rankLabel(v)).not.toBe('0');
			expect(rankRole(v)).toBeTruthy();
		}
	});
});

describe('a many-region fleet — the fan-out shape', () => {
	// `payments-core` in the mock: one dev, one staging, and a set of
	// production regions that do NOT promote into each other. Every region has
	// its own retention window, so the own-list denominator gives a different
	// number per region for regions running the same build.
	const REGIONS = [
		'dev',
		'staging',
		'prod-us-east-1',
		'prod-eu-central-1',
		'prod-ap-southeast-2',
		'prod-sa-east-1'
	];
	const many = [
		rollout('dev', [0, 1, 2, 3, 4, 5, 6, 7, 8], 0),
		rollout('staging', [1, 2, 3, 4, 5, 6, 7], 1),
		// FOUR REGIONS, ALL RUNNING RANK 6, and each one's own list admits a
		// different set of NEWER builds — 6, 2, 4 and 1 of them. That is what a
		// per-region gate set does to `availableReleases`, and it is why the
		// own-list denominator cannot survive a fan-out.
		rollout('prod-us-east-1', [6, 7, 8, 5, 4, 3, 2, 1, 0], 6),
		rollout('prod-eu-central-1', [6, 7, 8, 2, 0], 6),
		rollout('prod-ap-southeast-2', [6, 7, 4, 3, 1, 0], 6),
		rollout('prod-sa-east-1', [6, 0], 6)
	];
	const envs = REGIONS.map(environment);

	it('gives every region the number ITS OWN picker will offer', () => {
		// ⚠️ THIS IS THE HARDEST CASE FOR THE CHOSEN DEFINITION AND IT IS
		// PINNED RATHER THAN HIDDEN. Four regions run ONE build and print
		// 6, 2, 4 and 1. That reads as a contradiction and is not one: each
		// region's gates admit a different set, so each region's Change
		// Version list really is a different length. The ladder's single `6`
		// would be wrong for three of the four — `prod-sa-east-1` has exactly
		// one build it can take, and telling its operator there are six sends
		// them to a picker with one row.
		const g = groupRolloutsByApp(many, envs).get(APP)!;
		const regions = REGIONS.slice(2);
		expect(many.slice(2).map(newerReleaseCount)).toEqual([6, 2, 4, 1]);
		expect(regions.map((r) => rankBehindBy(rankVerdictFor(g, r)))).toEqual([6, 2, 4, 1]);
		expect(rankLabel(rankVerdictFor(g, 'prod-sa-east-1'))).toBe('1 behind');
	});

	it('still ranks the promotion line above the fan-out', () => {
		const g = groupRolloutsByApp(many, envs).get(APP)!;
		expect(rankVerdictFor(g, 'dev')).toEqual({ kind: 'newest' });
		// staging's own list is [1..7] and it runs rank 1 — its head IS rank
		// 1, so it has nothing newer TO TAKE. `newest` is the honest word:
		// there is no button for it to press. The ladder said `1 behind`,
		// pointing at a build staging's controller does not offer.
		expect(rankVerdictFor(g, 'staging')).toEqual({ kind: 'newest' });
		expect(newerReleaseCount(many[1])).toBe(0);
	});

	it('agrees across the card and the matrix for all six', () => {
		const cards = buildRolloutCards(many, envs, NOW);
		const row = buildMatrix(many, envs).rows.find((r) => r.appName === APP)!;
		for (const tier of REGIONS) {
			const card = cards.find((c) => c.ns === `${APP}-${tier}`)!;
			expect(card.rank).toEqual(row.cells[tier]!.rank);
		}
	});
});
