import { describe, it, expect } from 'vitest';
import { SOURCE_DASHBOARD_ANNOTATION, sourceDashboardURL, rolloutMatchesEnvironment } from './source-dashboard';

const DEV = 'https://kuberik.dev.example.com';
const PROD = 'https://kuberik.prod.example.com';

function rollout(name: string, namespace: string, source: string) {
	return { metadata: { name, namespace, annotations: { [SOURCE_DASHBOARD_ANNOTATION]: source } } };
}
function environment(rolloutName: string, namespace: string, source: string) {
	return {
		metadata: { namespace, annotations: { [SOURCE_DASHBOARD_ANNOTATION]: source } },
		spec: { rolloutRef: { name: rolloutName } }
	};
}

describe('sourceDashboardURL', () => {
	it('reads the source annotation', () => {
		expect(sourceDashboardURL(rollout('app', 'ns', DEV))).toBe(DEV);
	});
	it('returns empty string when missing', () => {
		expect(sourceDashboardURL({ metadata: {} })).toBe('');
		expect(sourceDashboardURL(undefined)).toBe('');
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
		const devEnv = environment('app', 'ns', DEV);
		const prodRollout = rollout('app', 'ns', PROD);
		expect(rolloutMatchesEnvironment(prodRollout, devEnv)).toBe(false);
	});

	it('picks the same-cluster rollout out of a merged multi-cluster list', () => {
		const devEnv = environment('app', 'ns', DEV);
		const merged = [rollout('app', 'ns', PROD), rollout('app', 'ns', DEV)];
		const matched = merged.find((r) => rolloutMatchesEnvironment(r, devEnv));
		expect(sourceDashboardURL(matched)).toBe(DEV);
	});

	it('does not match when names differ', () => {
		expect(rolloutMatchesEnvironment(rollout('other', 'ns', DEV), environment('app', 'ns', DEV))).toBe(false);
	});

	it('does not match when namespaces differ', () => {
		expect(rolloutMatchesEnvironment(rollout('app', 'ns-a', DEV), environment('app', 'ns-b', DEV))).toBe(false);
	});
});
