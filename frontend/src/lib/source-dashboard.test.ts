import { describe, it, expect } from 'vitest';
import {
	SOURCE_CLUSTER_ANNOTATION,
	sourceClusterName,
	rolloutMatchesEnvironment,
	rolloutPath
} from './source-dashboard';

const DEV = 'dev';
const PROD = 'prod';

function rollout(name: string, namespace: string, cluster: string) {
	return { metadata: { name, namespace, annotations: { [SOURCE_CLUSTER_ANNOTATION]: cluster } } };
}
function environment(rolloutName: string, namespace: string, cluster: string) {
	return {
		metadata: { namespace, annotations: { [SOURCE_CLUSTER_ANNOTATION]: cluster } },
		spec: { rolloutRef: { name: rolloutName } }
	};
}

describe('sourceClusterName', () => {
	it('reads the source-cluster annotation', () => {
		expect(sourceClusterName(rollout('app', 'ns', DEV))).toBe(DEV);
	});
	it('returns empty string when missing', () => {
		expect(sourceClusterName({ metadata: {} })).toBe('');
		expect(sourceClusterName(undefined)).toBe('');
	});
});

describe('rolloutMatchesEnvironment', () => {
	it('matches a rollout to its environment on the same cluster', () => {
		expect(rolloutMatchesEnvironment(rollout('app', 'ns', DEV), environment('app', 'ns', DEV))).toBe(true);
	});

	// Regression: two clusters each have app "app" in namespace "ns". Before the
	// source-cluster check, the dev environment would match the prod rollout (or
	// vice versa) depending on merge order, so the app view showed prod's rollout
	// under dev and clicking dev opened prod.
	it('does NOT match a rollout from a different cluster with the same name/namespace', () => {
		expect(rolloutMatchesEnvironment(rollout('app', 'ns', PROD), environment('app', 'ns', DEV))).toBe(false);
	});

	it('picks the same-cluster rollout out of a merged multi-cluster list', () => {
		const devEnv = environment('app', 'ns', DEV);
		const merged = [rollout('app', 'ns', PROD), rollout('app', 'ns', DEV)];
		const matched = merged.find((r) => rolloutMatchesEnvironment(r, devEnv));
		expect(sourceClusterName(matched)).toBe(DEV);
	});

	it('does not match when names differ', () => {
		expect(rolloutMatchesEnvironment(rollout('other', 'ns', DEV), environment('app', 'ns', DEV))).toBe(false);
	});

	it('does not match when namespaces differ', () => {
		expect(rolloutMatchesEnvironment(rollout('app', 'ns-a', DEV), environment('app', 'ns-b', DEV))).toBe(false);
	});
});

describe('rolloutPath', () => {
	it('embeds the cluster name in the path', () => {
		expect(rolloutPath(PROD, 'ns', 'app')).toBe('/rollouts/prod/ns/app');
	});
	it('appends a sub-route', () => {
		expect(rolloutPath(DEV, 'ns', 'app', 'history')).toBe('/rollouts/dev/ns/app/history');
	});
	it('encodes path segments', () => {
		expect(rolloutPath('c/1', 'n s', 'a?b')).toBe('/rollouts/c%2F1/n%20s/a%3Fb');
	});
});
