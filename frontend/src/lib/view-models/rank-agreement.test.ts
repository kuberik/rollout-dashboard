/**
 * ONE ROLLOUT, EVERY SURFACE, ONE NUMBER.
 *
 * This file exists because the product shipped three answers for one rollout,
 * and one page contradicted itself. Measured on the live hub, `hello-world-app`,
 * cluster fully settled, nothing deploying:
 *
 *   /rollouts     dev −15 991829b │ staging  newest 991829b │ prod −19 51b976a
 *   /apps/[name]  19 behind       │ 19 behind              │ 24 behind
 *   API           dev's own list 15 newer │ staging's 14 │ prod's 19
 *
 * **dev and staging run the IDENTICAL build `991829b`, on the same page, in
 * adjacent rows — one said `−15`, the other said `newest`.** Both halves of
 * that are expressible as tests and both are here.
 *
 * The fixture is the live shape, synthesised: 25 builds on the app's ladder,
 * three environments whose own `availableReleases` lists are 16 / 15 / 20
 * entries long. **THE ASYMMETRY IS THE FIXTURE'S WHOLE POINT** — the three
 * lists are different lengths because each rollout's gates and retention admit
 * a different subset, and a definition of "N behind" that is a property of the
 * BUILD has to survive it. Any derivation that counts against a rollout's own
 * list gives dev 15 and staging 14 for one sha.
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
	it('gives two environments running the IDENTICAL build the IDENTICAL verdict', () => {
		// THE DEFECT, STATED AS ONE ASSERTION. Before this, `/rollouts` printed
		// `dev −15 991829b` beside `staging newest 991829b`.
		const g = group();
		const d = rankVerdictFor(g, 'dev');
		const s = rankVerdictFor(g, 'staging');
		expect(d).toEqual(s);
		expect(d).toEqual({ kind: 'behind', by: 19 });
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
		expect(rankLabel(byNs('dev').rank)).toBe('19 behind');
		expect(rankLabel(byNs('staging').rank)).toBe('19 behind');
		expect(rankLabel(byNs('prod').rank)).toBe('24 behind');
		// ⛔ Not `−19`. A signed integer beside a build id reads as a diff and
		// names no unit; `/` and `/rollouts` were the last two pages spelling
		// it that way.
		for (const c of cards) expect(rankLabel(c.rank)).not.toMatch(/^−/);
	});

	it('does not let a rollout’s own list length move the number', () => {
		// Shrink staging's retention window to 4 entries — a pure retention
		// change, nothing deployed, nothing promoted. Its own count would move
		// 14 → 3. Its RANK must not move at all.
		const narrow = rollout('staging', [19, 15, 9, 0], 19);
		const g2 = groupRolloutsByApp([dev, narrow, prod], ENVIRONMENTS).get(APP)!;
		expect(newerReleaseCount(narrow)).toBe(3);
		expect(rankVerdictFor(g2, 'staging')).toEqual({ kind: 'behind', by: 19 });
		expect(rankVerdictFor(g2, 'dev')).toEqual({ kind: 'behind', by: 19 });
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
			expect(rankBehindBy(card.rank)).toBe(ladder.rankOf(version));
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

	it('gives every region on one build the same number, whatever its window holds', () => {
		const g = groupRolloutsByApp(many, envs).get(APP)!;
		const regions = REGIONS.slice(2);
		const verdicts = regions.map((r) => rankVerdictFor(g, r));
		// Their own lists say 6, 2, 4 and 1 — four numbers for one build, which
		// is the defect at fan-out scale.
		expect(many.slice(2).map(newerReleaseCount)).toEqual([6, 2, 4, 1]);
		// The ladder says one thing.
		for (const v of verdicts) expect(v).toEqual(verdicts[0]);
		expect(verdicts[0]).toEqual({ kind: 'behind', by: 6 });
		expect(rankLabel(verdicts[0])).toBe('6 behind');
	});

	it('still ranks the promotion line above the fan-out', () => {
		const g = groupRolloutsByApp(many, envs).get(APP)!;
		expect(rankVerdictFor(g, 'dev')).toEqual({ kind: 'newest' });
		expect(rankVerdictFor(g, 'staging')).toEqual({ kind: 'behind', by: 1 });
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
