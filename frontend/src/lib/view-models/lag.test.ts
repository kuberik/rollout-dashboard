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
});
