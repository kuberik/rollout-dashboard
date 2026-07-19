import { describe, it, expect } from 'vitest';
import { buildMatrix } from './matrix';
import type { Rollout, Environment } from '$lib/../types';

// Two apps: 'a' is bound to dev+prod Environments (dev=v3, prod=v1 — behind
// dev), 'b' is bound to dev only. Mirrors the minimal shape
// `groupRolloutsByApp` accepts: an Environment binds an app via
// `spec.rolloutRef.name` + `spec.environment`, and matches a Rollout via
// `rolloutMatchesEnvironment` (same namespace + cluster annotation, name ==
// rolloutRef.name).
function rollout(
  name: string,
  namespace: string,
  version: string,
  title?: string,
  bakeStatus = 'Succeeded'
): Rollout {
  return {
    metadata: { name, namespace },
    status: {
      title,
      history: [{ version: { version }, timestamp: '2026-01-01T00:00:00Z', bakeStatus }]
    }
  } as unknown as Rollout;
}

function environment(namespace: string, tier: string, rolloutName: string): Environment {
  return {
    metadata: { name: `${rolloutName}-${tier}`, namespace },
    spec: { environment: tier, rolloutRef: { name: rolloutName } }
  } as unknown as Environment;
}

const FIXTURE_ROLLOUTS: Rollout[] = [
  rollout('a', 'a-dev', 'v3', 'App A'),
  rollout('a', 'a-prod', 'v1', 'App A'),
  rollout('b', 'b-dev', 'v1', 'App B')
];

const FIXTURE_ENVS: Environment[] = [
  environment('a-dev', 'dev', 'a'),
  environment('a-prod', 'prod', 'a'),
  environment('b-dev', 'dev', 'b')
];

describe('buildMatrix', () => {
  it('produces sorted env tiers and one row per app', () => {
    const { envTiers, rows } = buildMatrix(FIXTURE_ROLLOUTS, FIXTURE_ENVS);
    expect(envTiers).toEqual(['dev', 'prod']);
    expect(rows.map((r) => r.appName).sort()).toEqual(['a', 'b']);
  });

  it('marks a lagging cell with behindBy > 0 and sets worstLag', () => {
    const { rows } = buildMatrix(FIXTURE_ROLLOUTS, FIXTURE_ENVS);
    const a = rows.find((r) => r.appName === 'a')!;
    expect(a.cells['prod']!.behindBy).toBeGreaterThan(0);
    expect(a.worstLag).toBe(a.cells['prod']!.behindBy);
  });

  it('leaves cells null where an app is not deployed to a tier', () => {
    const { rows } = buildMatrix(FIXTURE_ROLLOUTS, FIXTURE_ENVS);
    const b = rows.find((r) => r.appName === 'b')!;
    expect(b.cells['prod']).toBeNull();
  });

  it('surfaces bakeStatus so a baking cell can be told apart from a plain Deploying one', () => {
    const bakingRollouts: Rollout[] = [
      rollout('a', 'a-dev', 'v3', 'App A', 'InProgress'),
      rollout('a', 'a-prod', 'v1', 'App A'),
      rollout('b', 'b-dev', 'v1', 'App B')
    ];
    const { rows } = buildMatrix(bakingRollouts, FIXTURE_ENVS);
    const a = rows.find((r) => r.appName === 'a')!;
    expect(a.cells['dev']!.statusKey).toBe('active');
    expect(a.cells['dev']!.bakeStatus).toBe('InProgress');
  });
});
