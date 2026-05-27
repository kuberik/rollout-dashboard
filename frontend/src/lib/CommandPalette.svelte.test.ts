import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import CommandPalette from './CommandPalette.svelte';
import { SOURCE_DASHBOARD_ANNOTATION } from './source-dashboard';
import type { Rollout } from '../types';

// Multi-cluster: the hub merges rollouts from several clusters. Two clusters
// can share an app's namespace+name. The palette's per-row {#each} key is
// `rollout:${namespace}/${name}` with no source-cluster component, so these
// two rollouts collide on the same keyed-each key.
function rollout(ns: string, name: string, source: string): Rollout {
	return {
		metadata: {
			namespace: ns,
			name,
			annotations: { [SOURCE_DASHBOARD_ANNOTATION]: source }
		},
		spec: {},
		status: {}
	} as unknown as Rollout;
}

describe('CommandPalette multi-cluster duplicate keys', () => {
	test('renders without throwing when two clusters share namespace+name', () => {
		const rollouts = [
			rollout('demo', 'hello-world', 'https://dev.example'),
			rollout('demo', 'hello-world', 'https://prod.example')
		];
		const { container } = render(CommandPalette, {
			props: {
				open: true,
				scope: 'rollout',
				rollouts,
				environments: [],
				localClusterURL: 'https://hub.example'
			}
		});
		// Both cluster instances must render as distinct rows.
		expect(container.querySelectorAll('[data-idx]')).toHaveLength(2);
	});
});
