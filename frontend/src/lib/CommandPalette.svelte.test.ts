import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import CommandPalette from './CommandPalette.svelte';
import { SOURCE_CLUSTER_ANNOTATION } from './source-dashboard';
import type { Rollout } from '../types';

// Multi-cluster: the hub merges rollouts from several clusters. Two clusters
// can share an app's namespace+name. The palette's per-row {#each} key includes
// the source-cluster name so these two rollouts don't collide on the same
// keyed-each key.
function rollout(ns: string, name: string, cluster: string): Rollout {
	return {
		metadata: {
			namespace: ns,
			name,
			annotations: { [SOURCE_CLUSTER_ANNOTATION]: cluster }
		},
		spec: {},
		status: {}
	} as unknown as Rollout;
}

describe('CommandPalette multi-cluster duplicate keys', () => {
	test('renders without throwing when two clusters share namespace+name', () => {
		const rollouts = [
			rollout('demo', 'hello-world', 'dev'),
			rollout('demo', 'hello-world', 'prod')
		];
		const { container } = render(CommandPalette, {
			props: {
				open: true,
				scope: 'rollout',
				rollouts,
				environments: [],
				localClusterName: 'hub'
			}
		});
		// Both cluster instances must render as distinct rows.
		expect(container.querySelectorAll('[data-idx]')).toHaveLength(2);
	});
});
