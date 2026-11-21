import { describe, expect, it } from 'vitest';
import { findRolloutByPath, pathIdentity, rolloutIdentity, rolloutPathParts } from './rollout-identity';

const r = (cluster: string, namespace: string, name: string) => ({
	metadata: { namespace, name, annotations: cluster ? { 'rollout-dashboard.kuberik.com/source-cluster': cluster } : undefined }
});

describe('rolloutIdentity', () => {
	it('tells the same namespace and name on two clusters apart', () => {
		expect(rolloutIdentity(r('dev', 'shared', 'api'))).not.toBe(rolloutIdentity(r('prod', 'shared', 'api')));
	});
});

describe('pathIdentity', () => {
	it('is the identity of the rollout a path names', () => {
		expect(pathIdentity('/rollouts/dev/shared/api/history')).toBe(rolloutIdentity(r('dev', 'shared', 'api')));
		expect(pathIdentity('/rollouts/hub/shared/api')).toBe(rolloutIdentity(r('', 'shared', 'api'), 'hub'));
		expect(pathIdentity('/apps/api')).toBe('');
	});
});

describe('findRolloutByPath', () => {
	const list = [r('prod', 'shared', 'api'), r('dev', 'shared', 'api')];
	it('picks the rollout of the named cluster, not the first of that name', () => {
		expect(findRolloutByPath(list, '/rollouts/dev/shared/api/history')).toBe(list[1]);
		expect(findRolloutByPath(list, '/rollouts/prod/shared/api')).toBe(list[0]);
	});
	it('falls back to an un-annotated or first match', () => {
		const l2 = [r('prod', 'a', 'b'), r('', 'a', 'b')];
		expect(findRolloutByPath(l2, '/rollouts/local/a/b')).toBe(l2[1]);
		expect(findRolloutByPath([r('prod', 'a', 'b')], '/rollouts/x/a/b')).not.toBeNull();
	});
	it('is null for a non-rollout path', () => {
		expect(findRolloutByPath(list, '/apps/api')).toBeNull();
		expect(rolloutPathParts('/rollouts/dev/ns')).toBeNull();
	});
});
