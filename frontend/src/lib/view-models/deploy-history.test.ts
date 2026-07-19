import { describe, it, expect } from 'vitest';
import { historyTicks } from './deploy-history';

const h = (bakeStatus: string) => ({ timestamp: '2026-07-19T00:00:00Z', version: { tag: 'v' }, bakeStatus }) as any;

describe('historyTicks', () => {
  it('pads to length with none on the left', () => {
    expect(historyTicks([h('Succeeded')], 3)).toEqual(['none', 'none', 'ok']);
  });
  it('maps statuses and keeps chronological (oldest left)', () => {
    // history[0] is newest in the model → newest must be rightmost
    const out = historyTicks([h('Failed'), h('Succeeded'), h('InProgress')], 3);
    expect(out).toEqual(['active', 'ok', 'fail']);
  });
  it('truncates to the most recent `count`', () => {
    const out = historyTicks([h('Failed'), h('Succeeded'), h('Succeeded'), h('Succeeded')], 2);
    expect(out).toEqual(['ok', 'fail']);
  });
  it('handles empty/undefined', () => {
    expect(historyTicks(undefined, 2)).toEqual(['none', 'none']);
  });
});
