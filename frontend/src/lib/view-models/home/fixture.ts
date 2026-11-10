/**
 * The pinned incident fixture as `buildHomeModel` input, `now` = its
 * `capturedAt`. Shared by the home view-model tests.
 */
import fixture from './fixtures/incident-input.json';
import type { Change } from '$lib/api/changes';
import type {
	Environment,
	KruiseRollout,
	Kustomization,
	Rollout,
	RolloutDependency
} from '../../../types';
import { homeIncidentFleetHealthChecks, type HomeFixture } from '$lib/demo/home-incident';
import { rolloutHealthChecks, type FleetHealthChecksResponse } from '$lib/api/health-checks';

export const FIXTURE_NOW = new Date(fixture.capturedAt);
export const FIXTURE_ME = fixture.me;

export function homeInput(now = new Date(fixture.capturedAt)) {
	return {
		changes: fixture.changes as unknown as Change[],
		rollouts: fixture.rollouts as unknown as Rollout[],
		environments: fixture.environments as unknown as Environment[],
		rolloutDependencies: { items: fixture.rolloutDependencies as unknown as RolloutDependency[] },
		kustomizations: fixture.kustomizations as unknown as Kustomization[],
		kruiseRollouts: fixture.kruiseRollouts as unknown as KruiseRollout[],
		me: fixture.me,
		now,
		// hc-v2: what the mock's `GET /api/health-checks` serves for this fixture
		healthChecks: rolloutHealthChecks(
			homeIncidentFleetHealthChecks(fixture as unknown as HomeFixture) as FleetHealthChecksResponse
		)
	};
}
