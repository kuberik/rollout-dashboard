import { describe, it, expect } from 'vitest';
import { buildReleaseFrontier } from './release-frontier';
import type { Rollout, Environment } from '$lib/../types';

// Mirrors the minimal shape `groupRolloutsByApp` accepts (see matrix.test.ts):
// an Environment binds an app via `spec.rolloutRef.name` + `spec.environment`,
// and matches a Rollout via `rolloutMatchesEnvironment` (same namespace +
// cluster annotation, name == rolloutRef.name).
function rollout(
	name: string,
	namespace: string,
	version: string,
	title?: string,
	source = 'https://github.com/example/repo-a'
): Rollout {
	return {
		metadata: { name, namespace },
		status: {
			title,
			source,
			history: [{ version: { version }, timestamp: '2026-01-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		}
	} as unknown as Rollout;
}

function environment(namespace: string, tier: string, rolloutName: string): Environment {
	return {
		metadata: { name: `${rolloutName}-${tier}`, namespace },
		spec: { environment: tier, rolloutRef: { name: rolloutName } }
	} as unknown as Environment;
}

// App 'a': dev=v3, staging=v2, prod=v1 (newest-first: v3, v2, v1).
// App 'b': a separate repo, should be excluded when filtering by app 'a's repoKey.
const FIXTURE_ROLLOUTS: Rollout[] = [
	rollout('a', 'a-dev', 'v3', 'App A'),
	rollout('a', 'a-staging', 'v2', 'App A'),
	rollout('a', 'a-prod', 'v1', 'App A'),
	rollout('b', 'b-dev', 'v1', 'App B', 'https://github.com/example/repo-b')
];

const FIXTURE_ENVS: Environment[] = [
	environment('a-dev', 'dev', 'a'),
	environment('a-staging', 'staging', 'a'),
	environment('a-prod', 'prod', 'a'),
	environment('b-dev', 'dev', 'b')
];

const REPO_KEY_A = 'repo:github.com/example/repo-a';

describe('buildReleaseFrontier', () => {
	it('classifies each env stop relative to the target version', () => {
		const { apps } = buildReleaseFrontier(REPO_KEY_A, 'v2', FIXTURE_ROLLOUTS, FIXTURE_ENVS);
		const a = apps.find((x) => x.appName === 'a')!;
		const byEnv = Object.fromEntries(a.stops.map((s) => [s.envName, s.state]));
		expect(byEnv['dev']).toBe('ahead'); // dev on v3
		expect(byEnv['staging']).toBe('live'); // staging on v2
		expect(byEnv['prod']).toBe('behind'); // prod on v1
		expect(a.reached).toBe(1); // only staging is live on v2
		expect(a.total).toBe(3);
	});

	it('only includes apps whose repoKey matches', () => {
		const { apps } = buildReleaseFrontier(REPO_KEY_A, 'v2', FIXTURE_ROLLOUTS, FIXTURE_ENVS);
		expect(apps.every((x) => x.appName === 'a')).toBe(true);
	});

	it('marks a stop absent for an app not deployed to an env another app in the repo reaches', () => {
		// 'a' only has a dev cell; 'c' (same repo) also has a prod cell. The
		// frontier's env stops are the union across the repo's apps, so 'a'
		// should show an absent stop at 'prod' rather than simply omitting it.
		const rollouts: Rollout[] = [
			rollout('a', 'a-dev', 'v1', 'App A'),
			rollout('c', 'c-dev', 'v1', 'App C'),
			rollout('c', 'c-prod', 'v1', 'App C')
		];
		const environments: Environment[] = [
			environment('a-dev', 'dev', 'a'),
			environment('c-dev', 'dev', 'c'),
			environment('c-prod', 'prod', 'c')
		];
		const { apps } = buildReleaseFrontier(REPO_KEY_A, 'v1', rollouts, environments);
		const a = apps.find((x) => x.appName === 'a')!;
		const byEnv = Object.fromEntries(a.stops.map((s) => [s.envName, s.state]));
		expect(byEnv['dev']).toBe('live');
		expect(byEnv['prod']).toBe('absent');
		expect(a.total).toBe(1); // absent stops excluded from total
	});

	it('does not fold an unbound repo-mate rollout namespace into the tier set', () => {
		// App 'a' is Environment-bound (dev/staging/prod tiers). App 'u' shares
		// the repo but has NO Environment binding, so groupRolloutsByApp falls
		// back to grouping it by name with envName = its namespace ('u-ns').
		// That namespace must not leak into the frontier's tier union.
		const rollouts: Rollout[] = [
			...FIXTURE_ROLLOUTS.filter((r) => r.metadata?.name === 'a'),
			rollout('u', 'u-ns', 'v1', 'App U')
		];
		const environments: Environment[] = FIXTURE_ENVS.filter(
			(e) => e.spec?.rolloutRef?.name === 'a'
		);
		const { apps } = buildReleaseFrontier(REPO_KEY_A, 'v2', rollouts, environments);
		const a = apps.find((x) => x.appName === 'a')!;
		expect(a.stops.map((s) => s.envName)).toEqual(['dev', 'staging', 'prod']);
		expect(a.stops.some((s) => s.envName === 'u-ns')).toBe(false);
	});

	it('orders stops via sortEnvironmentNames', () => {
		const { apps } = buildReleaseFrontier(REPO_KEY_A, 'v2', FIXTURE_ROLLOUTS, FIXTURE_ENVS);
		const a = apps.find((x) => x.appName === 'a')!;
		expect(a.stops.map((s) => s.envName)).toEqual(['dev', 'staging', 'prod']);
	});
});
