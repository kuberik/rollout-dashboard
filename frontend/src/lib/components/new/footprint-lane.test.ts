import { it, expect } from 'vitest';
import { laneOf } from './Footprint.svelte';

/* QA #11: an env-less rollout (hello-world-manifests) has a blank place label; its lane node is named by its tier, never an empty box. */
it('laneOf names an unlabelled place by its tier', () => {
	const pl = (tier: string, label: string) => ({ env: label, label, tier, state: 'healthy', href: `/${tier}`, version: 'e7c1b60', onNewest: true, onBuild: true });
	const { lane } = laneOf({ app: 'x', newest: 'e7c1b60', placeList: [pl('dev', 'dev'), pl('staging', ''), pl('prod', '')] } as never, { apps: [] } as never, [] as never);
	expect([...lane.stages, ...lane.prod].map((n) => n.env)).toEqual(['dev', 'staging', 'prod']);
});
