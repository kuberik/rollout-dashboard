import { describe, it, expect } from 'vitest';
import {
	displayVersionForTag,
	repoKeyFromSource,
	envFamilyWord,
	changeRepoPath,
	changeBuildPath
} from './version-utils';
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

describe('repoKeyFromSource', () => {
	// (2026-09-10, PR-view fix pass, item 12) A `/tree/<branch>` tail names a
	// REF inside the repo, not a different repo — `pkg/githubapp/repo.go`'s
	// doc comment already claimed this was handled; it was not.
	it('ignores a /tree/<branch> tail', () => {
		expect(repoKeyFromSource('https://github.com/acme/widget/tree/release-1.2', '')).toBe(
			repoKeyFromSource('https://github.com/acme/widget', '')
		);
	});

	it('ignores a /blob/<branch>/path tail', () => {
		expect(repoKeyFromSource('https://github.com/acme/widget/blob/main/README.md', '')).toBe(
			repoKeyFromSource('https://github.com/acme/widget', '')
		);
	});

	it('keeps dots in the repo name', () => {
		expect(repoKeyFromSource('https://github.com/acme/foo.js', '')).toBe('repo:github.com/acme/foo.js');
	});
});

describe('envFamilyWord', () => {
	it.each([
		['dev', 'DEV'],
		['development', 'DEV'],
		['staging', 'STG'],
		['stage', 'STG'],
		['prod', 'PRD'],
		['production', 'PRD'],
		['test', 'TEST'],
		['testing', 'TEST'],
		['qa', 'TEST']
	])('maps %s to %s', (envName, expected) => {
		expect(envFamilyWord(envName)).toBe(expected);
	});

	it('collapses three prod regions to the same family word', () => {
		expect(envFamilyWord('prod-us-east-1')).toBe('PRD');
		expect(envFamilyWord('prod-us-east-2')).toBe('PRD');
		expect(envFamilyWord('prod-eu-west-1')).toBe('PRD');
	});

	it('never prints the 19-character env name it was given', () => {
		const word = envFamilyWord('hello-world-staging');
		expect(word).toBe('STG');
		expect(word.length).toBeLessThanOrEqual(4);
	});

	it('falls back to the first 3 letters, uppercased, for an unmatched name', () => {
		expect(envFamilyWord('canary')).toBe('CAN');
		expect(envFamilyWord('sandbox')).toBe('SAN');
	});

	it('prod wins ties over other patterns (matcher order matches environment-theme.ts)', () => {
		expect(envFamilyWord('prod-test-1')).toBe('PRD');
	});
});

describe('changeRepoPath / changeBuildPath', () => {
	it('builds the repo page path', () => {
		expect(changeRepoPath('repo:github.com/littlechimera/kuberik-testing')).toBe(
			'/changes/github.com/littlechimera/kuberik-testing'
		);
	});

	it('keys the build path by revision when one is known', () => {
		expect(
			changeBuildPath('repo:github.com/littlechimera/kuberik-testing', '991829b6ab3bdb0100ac0a44d8867460732159f7', '1.66.0-66')
		).toBe('/changes/github.com/littlechimera/kuberik-testing/991829b6ab3b');
	});

	it('falls back to the label when no revision is known', () => {
		expect(changeBuildPath('repo:github.com/littlechimera/kuberik-testing', null, '1.66.0-66')).toBe(
			'/changes/github.com/littlechimera/kuberik-testing/1.66.0-66'
		);
	});
});
