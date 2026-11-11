import { describe, expect, it } from 'vitest';
import { behindOfRollout, behindOfStatus } from './behind';
import { noSourceOf } from '../components/new/data';

const noSource = {
	metadata: { name: 'app', namespace: 'ns' },
	spec: {},
	status: {
		currentVersion: 'v1',
		history: [{ version: { tag: 'v1' } }],
		conditions: [{ type: 'ReleasesUpdated', status: 'False', reason: 'ReleaseSourceRequired', message: 'Create a ReleaseSource.' }]
	}
};

describe('a Rollout without a ReleaseSource', () => {
	it('is behind by nothing, whatever the rank says', () => {
		expect(behindOfStatus(noSource)).toBe(0);
		expect(behindOfRollout(noSource, { kind: 'behind', by: 3 } as never)).toBe(0);
	});
	it('exports no message for an unknown place', () => {
		expect(noSourceOf('/rollouts/x/y/z')).toBeUndefined();
	});
});
