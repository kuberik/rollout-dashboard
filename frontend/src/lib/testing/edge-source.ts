/**
 * Test support: the `home-edge` scenario as a FleetSource, so a unit test reads the same edge apps the mock server serves under
 * MOCK_SCENARIO=home-edge. `installEdge()` installs it (and resets the cached home model); `uninstallEdge()` puts the pinned fixture back.
 * The fixture is the incident one, so `homeModel('incident')` over it is the incident model plus the edge apps.
 */
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource, resetHomeModel } from '$lib/components/home/sketch/home-data';
import raw from '$lib/view-models/home/fixtures/incident-input.json';
import { withEdgeCases } from '$lib/demo/home-edge';
import type { NetworkSchedules } from '$lib/api/schedules';
import type { HomeFixture } from '$lib/demo/home-incident';
import type { FleetSource } from '$lib/components/home/sketch/fleet-source.svelte';

export function edgeSource(): FleetSource {
	const base = fixtureSource();
	const f = withEdgeCases(raw as unknown as HomeFixture);
	const added = { rollouts: f.rollouts.slice(raw.rollouts.length), environments: f.environments.slice(raw.environments.length) };
	const deps = f.rolloutDependencies.slice(raw.rolloutDependencies.length);
	const schedules = new Map<string, NetworkSchedules>([['prod', { rolloutSchedules: { items: f.schedules ?? [] }, clusterRolloutSchedules: { items: [] } } as unknown as NetworkSchedules]]);
	const changes = f.changes.slice(raw.changes.length);
	return { ...base, changes: [...base.changes, ...(changes as unknown as FleetSource['changes'])], schedules, rolloutDependencies: { items: [...(base.rolloutDependencies?.items ?? []), ...(deps as unknown as NonNullable<FleetSource['rolloutDependencies']>['items'])] }, rollouts: [...base.rollouts, ...(added.rollouts as unknown as FleetSource['rollouts'])], environments: [...base.environments, ...(added.environments as unknown as FleetSource['environments'])] };
}
export function installEdge(): void { installLiveSource(edgeSource()); resetHomeModel(); }
export function uninstallEdge(): void { installLiveSource(null); resetHomeModel(); }
