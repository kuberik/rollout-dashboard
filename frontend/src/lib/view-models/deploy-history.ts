import type { HistoryEntry } from '$lib/../types';

type Tick = 'ok' | 'fail' | 'active' | 'none';

function tickOf(e: HistoryEntry): Tick {
  const s = e.bakeStatus;
  if (s === 'Failed' || s === 'Cancelled') return 'fail';
  if (s === 'InProgress' || s === 'Deploying') return 'active';
  return 'ok';
}

export function historyTicks(history: HistoryEntry[] | undefined, count: number): Tick[] {
  const recent = (history ?? []).slice(0, count).map(tickOf).reverse(); // oldest→newest
  const pad: Tick[] = Array(Math.max(0, count - recent.length)).fill('none');
  return [...pad, ...recent];
}
