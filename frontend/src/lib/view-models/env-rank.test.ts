import { describe, it, expect } from 'vitest';
import { groupRolloutsByApp } from '$lib/version-utils';
import {
	rankVerdicts,
	rankVerdictFor,
	rankLabel,
	rankRole,
	rankBehindBy,
	rankIsAdverse
} from './env-rank';
import { buildMatrix } from './matrix';
import type { Rollout, Environment } from '$lib/../types';

// ── Fixture builders ─────────────────────────────────────────────────────
// `ago(n)` keeps every timestamp relative so the fixtures cannot rot.
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

type Deploy = { sha: string; agoMin: number };

function rollout(
	app: string,
	tier: string,
	deploys: Deploy[],
	releases: { sha: string; agoMin: number }[] | null
): Rollout {
	return {
		metadata: { name: app, namespace: `${app}-${tier}` },
		spec: {},
		status: {
			history: deploys.map((d) => ({
				version: { tag: d.sha, version: d.sha },
				timestamp: ago(d.agoMin),
				bakeStatus: 'Succeeded'
			})),
			...(releases
				? {
						// OLDEST-FIRST, the real API's contract.
						availableReleases: releases
							.slice()
							.reverse()
							.map((r) => ({ tag: r.sha, version: r.sha, created: ago(r.agoMin) }))
					}
				: {})
		}
	} as unknown as Rollout;
}

function environment(app: string, tier: string): Environment {
	return {
		metadata: { name: app, namespace: `${app}-${tier}` },
		spec: { environment: tier, name: app, rolloutRef: { name: app } }
	} as unknown as Environment;
}

// NEWEST-FIRST, so the index IS the expected rank.
const RELEASES = [
	{ sha: 'aaa0001', agoMin: 10 },
	{ sha: 'bbb0002', agoMin: 100 },
	{ sha: 'ccc0003', agoMin: 200 },
	{ sha: 'ddd0004', agoMin: 300 },
	{ sha: 'eee0005', agoMin: 400 }
];

function fixture(): { rollouts: Rollout[]; environments: Environment[] } {
	return {
		rollouts: [
			rollout('app', 'dev', [{ sha: 'aaa0001', agoMin: 5 }], RELEASES),
			rollout('app', 'staging', [{ sha: 'ccc0003', agoMin: 150 }], RELEASES),
			rollout('app', 'prod', [{ sha: 'eee0005', agoMin: 350 }], RELEASES)
		],
		environments: [environment('app', 'dev'), environment('app', 'staging'), environment('app', 'prod')]
	};
}

function group() {
	const { rollouts, environments } = fixture();
	return groupRolloutsByApp(rollouts, environments).get('app')!;
}

describe('env-rank — the one denominator', () => {
	it('ranks every environment against the app ladder, not against its upstream neighbour', () => {
		// THE REGRESSION THIS FILE EXISTS FOR. `cellLag` measures the HOP to the
		// upstream environment, so prod here would be `2` (its distance to
		// staging) while `/apps/[name]` printed `4` for the same rollout. The
		// rank is a property of the BUILD, so it does not change when a
		// different environment deploys.
		expect(rankVerdictFor(group(), 'dev')).toEqual({ kind: 'newest' });
		expect(rankVerdictFor(group(), 'staging')).toEqual({ kind: 'behind', by: 2 });
		expect(rankVerdictFor(group(), 'prod')).toEqual({ kind: 'behind', by: 4 });
	});

	it('is NOT capped at the number of distinct deployed versions', () => {
		// The `/environments` defect: `rank: version === newest ? 0 : i === 0 ? 0 : i`
		// indexed into the list of versions currently deployed, so with 3
		// environments the deepest lag it could ever print was 2. The real
		// answer here is 4, and the ladder is 5 builds deep.
		const verdicts = [...rankVerdicts(group()).values()];
		const deepest = Math.max(...verdicts.map(rankBehindBy));
		expect(deepest).toBe(4);
		expect(deepest).toBeGreaterThan(group().cells.length - 1);
	});

	it('reports a build that is on no release line as diverged, never as a distance', () => {
		const { rollouts, environments } = fixture();
		// prod runs a build no environment lists as available, deployed inside
		// the window the release line still covers.
		rollouts[2] = rollout('app', 'prod', [{ sha: 'fff9999', agoMin: 20 }], RELEASES);
		const g = groupRolloutsByApp(rollouts, environments).get('app')!;
		expect(rankVerdictFor(g, 'prod')).toEqual({ kind: 'diverged' });
		expect(rankLabel(rankVerdictFor(g, 'prod'))).toBe('diverged');
		expect(rankBehindBy(rankVerdictFor(g, 'prod'))).toBe(0);
	});

	it('prints NO number when there is nothing deployed', () => {
		const { rollouts, environments } = fixture();
		rollouts[2] = rollout('app', 'prod', [], RELEASES);
		const g = groupRolloutsByApp(rollouts, environments).get('app')!;
		const v = rankVerdictFor(g, 'prod');
		expect(v).toEqual({ kind: 'unknown' });
		// Silence, not a zero — a `0` here would render as "newest".
		expect(rankLabel(v)).toBeNull();
		expect(rankRole(v)).toBeNull();
	});

	it('orders by release time, not by sha, when no availableReleases are published', () => {
		// `orders-api` on the live fixture: no release list at all, so every
		// build had `createdMs === 0` and the ladder fell back to
		// `version.localeCompare`. It ranked ALPHABETICALLY BY SHA and printed
		// `−3` on the environment running the app's newest build.
		const rollouts = [
			rollout('bare', 'dev', [{ sha: 'e936e6f', agoMin: 5 }], null),
			rollout('bare', 'staging', [{ sha: '01ab7c9', agoMin: 600 }], null),
			rollout('bare', 'prod', [{ sha: '7c14e2a', agoMin: 1200 }], null)
		];
		const envs = [environment('bare', 'dev'), environment('bare', 'staging'), environment('bare', 'prod')];
		const g = groupRolloutsByApp(rollouts, envs).get('bare')!;
		expect(rankVerdictFor(g, 'dev')).toEqual({ kind: 'newest' });
		expect(rankBehindBy(rankVerdictFor(g, 'staging'))).toBeGreaterThan(0);
		expect(rankBehindBy(rankVerdictFor(g, 'prod'))).toBeGreaterThan(
			rankBehindBy(rankVerdictFor(g, 'staging'))
		);
	});

	it('maps each verdict onto exactly one chip role', () => {
		expect(rankRole({ kind: 'newest' })).toBe('newest');
		expect(rankRole({ kind: 'behind', by: 3 })).toBe('rank');
		expect(rankRole({ kind: 'diverged' })).toBe('diverged');
		expect(rankRole({ kind: 'unknown' })).toBeNull();
		expect(rankLabel({ kind: 'behind', by: 19 })).toBe('−19');
		expect(rankIsAdverse({ kind: 'newest' })).toBe(false);
		expect(rankIsAdverse({ kind: 'behind', by: 1 })).toBe(true);
		expect(rankIsAdverse({ kind: 'diverged' })).toBe(true);
		expect(rankIsAdverse({ kind: 'unknown' })).toBe(false);
	});
});

describe('the matrix carries the same number the app pages print', () => {
	it('agrees with rankVerdictFor cell by cell', () => {
		// `/apps` and `/environments` both render from `buildMatrix`, and
		// `/apps/[name]` renders from the ladder directly. Three surfaces, one
		// derivation — this is the assertion that keeps them from drifting.
		const { rollouts, environments } = fixture();
		const { rows } = buildMatrix(rollouts, environments);
		const g = groupRolloutsByApp(rollouts, environments).get('app')!;
		const row = rows.find((r) => r.appName === 'app')!;
		for (const tier of ['dev', 'staging', 'prod']) {
			expect(row.cells[tier]!.rank).toEqual(rankVerdictFor(g, tier));
		}
		expect(row.cells['prod']!.behindBy).toBe(4);
		expect(row.worstLag).toBe(4);
	});
});
