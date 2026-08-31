import { describe, it, expect } from 'vitest';
import { displayVersionForTag } from './version-utils';
import type { Rollout } from '../types';

// The live shape: `spec.wantedVersion` is an OCI TAG, and the name every
// other surface prints is the `version` annotation carried beside it.
const TAG = 'main-1787999329-991829b6ab3bdb0100ac0a44d8867460732159f7';
const OLD_TAG = 'main-1787000000-0afab6f11111111111111111111111111111111';

const rollout = {
	metadata: { name: 'hello-world-app', namespace: 'hello-world-prod' },
	spec: { wantedVersion: TAG },
	status: {
		availableReleases: [
			{ tag: TAG, version: '991829b', revision: '991829b6ab3bdb0100ac0a44d8867460732159f7' }
		],
		history: [
			{
				version: {
					tag: OLD_TAG,
					version: '0afab6f',
					revision: '0afab6f11111111111111111111111111111111'
				}
			}
		]
	}
} as unknown as Rollout;

describe('displayVersionForTag', () => {
	it('resolves a tag through availableReleases to the display version', () => {
		expect(displayVersionForTag(rollout, TAG)).toBe('991829b');
	});

	it('falls back to deploy history for a build that aged out of the release list', () => {
		expect(displayVersionForTag(rollout, OLD_TAG)).toBe('0afab6f');
	});

	it('shortens an unknown tag rather than inventing a version', () => {
		expect(displayVersionForTag(rollout, 'main-1788000000-abcdef1234567890abcdef')).toBe(
			'main-1788000000-abcdef1'
		);
	});

	it('leaves a semver-style tag alone', () => {
		expect(displayVersionForTag(rollout, 'rel-66')).toBe('rel-66');
	});

	it('is empty for no tag, and safe with no rollout', () => {
		expect(displayVersionForTag(rollout, null)).toBe('');
		expect(displayVersionForTag(null, TAG)).toBe('main-1787999329-991829b');
	});
});
