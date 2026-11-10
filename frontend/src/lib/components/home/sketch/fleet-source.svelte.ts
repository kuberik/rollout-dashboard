/**
 * LIVE DATA (r39, 2026-11-08) — the ONE place the five list pages' data comes from.
 * Role: the pages used to read the pinned incident fixture through data.ts. They now read the same API answers every other page reads
 * (rollouts list + environments + kustomizations + kruiseRollouts + dependencies, the fleet health checks, GitHub changes, the viewer's
 * GitHub login); a provider component (`FleetSource.svelte`) assembles those into a `FleetSource` and installs it here. data.ts / home-data.ts
 * read `liveSource()` first. With nothing installed (unit tests, truth expectations) they fall back to the pinned fixture, which is never a
 * page's data source. The mock API (MOCK_API=1) serves the incident fixture over the same routes, so mock mode draws the same pictures.
 * Reactive ($state.raw): everything that derives from `homeModel()` re-runs when a poll or a stream event swaps the source.
 */
import type { Change } from '$lib/api/changes';
import type { RolloutHealthChecks } from '$lib/api/health-checks';
import type { Environment, KruiseRollout, Kustomization, Rollout, RolloutDependency, RolloutTest } from '../../../../types';

export type GithubFacts = { configured: boolean | null; connected: boolean; login?: string; avatarUrl?: string };
export type FleetSource = {
	rollouts: Rollout[];
	environments: Environment[];
	rolloutDependencies: { items: RolloutDependency[] } | null;
	kustomizations: Kustomization[];
	kruiseRollouts: KruiseRollout[];
	changes: Change[];
	/** why `changes` is empty when it is: GitHub not connected / not configured / the read failed. `ok` = the list is the answer. */
	changesState: 'ok' | 'not_connected' | 'not_configured' | 'error' | 'loading';
	healthChecks: readonly RolloutHealthChecks[] | null;
	/** the RolloutTest objects of the fleet (spec.rolloutName = the KruiseRollout, spec.stepIndex = the canary step, status.phase). Optional: a source that omits it draws no Tests row. */
	rolloutTests?: readonly RolloutTest[] | null;
	github: GithubFacts;
	/** lower-cased GitHub login of the signed-in viewer ('' when GitHub is not connected) */
	me: string;
	now: Date;
};

let installed = $state.raw<FleetSource | null>(null);
export const liveSource = (): FleetSource | null => installed;
export const installLiveSource = (s: FleetSource | null): void => { installed = s; };
