/**
 * The Environments the wave chain lives in, for routes that have no FleetSource (the rollout detail tabs). `failedKeysOf` falls back to this
 * when no live source is installed, so a follower never counts a build that failed upstream on ANY route (batch4 #3b). Reactive ($state.raw),
 * so every derived count re-runs when the fleet list refreshes. The rollout layout sets it from the fleet list query it already runs.
 */
import type { Environment } from '../../types';

let installed = $state.raw<readonly Environment[] | null>(null);
export const waveEnvironments = (): readonly Environment[] | null => installed;
export const setWaveEnvironments = (e: readonly Environment[] | null): void => { installed = e; };
