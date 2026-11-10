import { describe, it, expect } from 'vitest';
import { historyTicks, isHistoryCurrentlyFailed } from './deploy-history';

const h = (bakeStatus: string, timestamp = '2026-07-19T00:00:00Z') =>
  ({ timestamp, version: { tag: 'v' }, bakeStatus }) as any;

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

describe('isHistoryCurrentlyFailed — qa9 B1: red only while the newest entry is the failure', () => {
  it('true when the newest (first-with-timestamp) entry is Failed', () => {
    expect(isHistoryCurrentlyFailed([h('Failed')])).toBe(true);
  });

  it('false when the failure is older than the current (succeeded) entry', () => {
    // history is newest-first: index 0 is current.
    expect(isHistoryCurrentlyFailed([h('Succeeded'), h('Failed')])).toBe(false);
  });

  it('an older failure stays resolved even when a NEWER entry also failed (not the same one)', () => {
    expect(isHistoryCurrentlyFailed([h('Failed'), h('Succeeded'), h('Failed')])).toBe(true);
  });

  it('skips a leading entry with no timestamp yet (not the newest)', () => {
    expect(isHistoryCurrentlyFailed([h('Succeeded', ''), h('Failed')])).toBe(true);
  });

  it('false for empty/undefined history', () => {
    expect(isHistoryCurrentlyFailed(undefined)).toBe(false);
    expect(isHistoryCurrentlyFailed([])).toBe(false);
  });
});
