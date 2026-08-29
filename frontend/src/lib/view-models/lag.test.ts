import { describe, it, expect } from 'vitest';
import { upstreamCell, cellLag } from './lag';

// Build a minimal AppGroup with two cells: dev on v3, prod on v1.
function mkGroup(): any {
  const cell = (envName: string, version: string) => ({
    envName, environment: envName,
    rollout: { status: { history: [{ version: { version } }] } },
    repoKey: 'app:x'
  });
  return { appName: 'x', hasEnvironmentBinding: true, cells: [cell('dev', 'v3'), cell('prod', 'v1')] };
}

describe('lag', () => {
  it('finds the upstream env by promotion order', () => {
    const g = mkGroup();
    expect(upstreamCell(g, 'prod')?.envName).toBe('dev');
    expect(upstreamCell(g, 'dev')).toBeNull();
  });
  it('reports prod as behind dev', () => {
    const g = mkGroup();
    const lag = cellLag(g, 'prod')!;
    expect(lag.behindBy).toBeGreaterThan(0);
    expect(lag.upstreamVersion).toBe('v3');
  });
  it('reports converged as 0 behind', () => {
    const g = mkGroup();
    g.cells[1].rollout.status.history[0].version.version = 'v3';
    expect(cellLag(g, 'prod')!.behindBy).toBe(0);
  });

  it('uses releaseCandidates counts when present — proves the old ≤1 ceiling is gone', () => {
    const g = mkGroup();
    // upstream (dev): at head, 0 release candidates waiting.
    g.cells[0].rollout.status.releaseCandidates = [];
    // downstream (prod): 24 release candidates waiting.
    g.cells[1].rollout.status.releaseCandidates = Array.from({ length: 24 }, (_, i) => ({
      version: `rc-${i}`
    }));
    expect(cellLag(g, 'prod')!.behindBy).toBe(24);
  });

  it('falls back to the distinct-version index when neither side has release-candidate data', () => {
    // Three envs, three distinct versions, no releaseCandidates/availableReleases
    // anywhere in the fixture — newerReleaseCount is null for every cell, so
    // cellLag must fall back to the old distinct-version index computation.
    const cell = (envName: string, version: string) => ({
      envName,
      environment: envName,
      rollout: { status: { history: [{ version: { version } }] } },
      repoKey: 'app:x'
    });
    const g: any = {
      appName: 'x',
      hasEnvironmentBinding: true,
      cells: [cell('dev', 'v3'), cell('staging', 'v2'), cell('prod', 'v1')]
    };
    expect(cellLag(g, 'staging')!.behindBy).toBe(1);
    // prod's upstream is staging (one hop away), not dev — one distinct
    // version apart in the list, same as staging's own gap to dev.
    expect(cellLag(g, 'prod')!.behindBy).toBe(1);
  });
});
