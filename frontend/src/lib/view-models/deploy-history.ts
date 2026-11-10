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

/**
 * Is the rollout's history CURRENTLY failed — i.e. is its newest entry (the
 * first one with a timestamp; the controller can write an entry with no
 * timestamp yet, which must not be read as "the newest") itself `Failed`?
 *
 * The one predicate `/history`'s head-band and card-rollup "N failed" tallies
 * both call to decide red vs neutral ink — the same rule `ActivityRail`'s own
 * day-header `open` tally, `fleet-pulse`'s `isCurrentFailure` and
 * `DeployBars`' `resolved` already use: a failure is red only while it is
 * the rollout's current state; an older failure is resolved even when a
 * newer one also failed (coordinator ruling 2026-10-10).
 */
export function isHistoryCurrentlyFailed(history: HistoryEntry[] | undefined): boolean {
  const live = (history ?? []).find((e) => e.timestamp);
  return live?.bakeStatus === 'Failed';
}
