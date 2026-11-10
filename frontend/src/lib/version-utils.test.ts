import { describe, it, expect } from 'vitest';
import {
	displayVersionForTag,
	repoKeyFromSource,
	envFamilyWord,
	changeRepoPath,
	changeBuildPath,
	groupRolloutsByApp,
	shortRevision,
	revisionSlug
} from './version-utils';
import type { Rollout, Environment } from '../types';

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
	// ⛔ 2026-10-08 (U-13 vocabulary fix) — the family word is the FULL
	// uppercase name, never an abbreviation (`STG`/`PRD` retired; see
	// `version-utils.ts`'s own fix-pass note on `FAMILY_WORD`).
	it.each([
		['dev', 'DEV'],
		['development', 'DEV'],
		['staging', 'STAGING'],
		['stage', 'STAGING'],
		['prod', 'PROD'],
		['production', 'PROD'],
		['test', 'TEST'],
		['testing', 'TEST'],
		['qa', 'TEST']
	])('maps %s to %s', (envName, expected) => {
		expect(envFamilyWord(envName)).toBe(expected);
	});

	it('collapses three prod regions to the same family word', () => {
		expect(envFamilyWord('prod-us-east-1')).toBe('PROD');
		expect(envFamilyWord('prod-us-east-2')).toBe('PROD');
		expect(envFamilyWord('prod-eu-west-1')).toBe('PROD');
	});

	it('names staging in full, not a 3-letter abbreviation, for a long env name', () => {
		const word = envFamilyWord('hello-world-staging');
		expect(word).toBe('STAGING');
	});

	it('uppercases an unmatched name in full rather than truncating to 3 letters', () => {
		expect(envFamilyWord('canary')).toBe('CANARY');
		expect(envFamilyWord('sandbox')).toBe('SANDBOX');
	});

	it('prod wins ties over other patterns (matcher order matches environment-theme.ts)', () => {
		expect(envFamilyWord('prod-test-1')).toBe('PROD');
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

/**
 * ⛔ U-12 (2026-10-08): A SECOND, UNRELATED ROLLOUT SHARING AN APP NAME MUST
 * NOT VANISH. The fallback loop used to skip a rollout whose NAME had EVER
 * been bound to an `Environment` ANYWHERE in the fleet
 * (`boundAppNames.has(name)`, a `Set<string>`), so a rollout like
 * `orders-prod/orders-api` — same name as the real, environment-bound
 * `orders-api-dev/staging/prod` fleet app, but itself matched by no
 * `Environment` — was skipped by BOTH branches: not bound (no `Environment`
 * resolves to it) and not counted as unbound (its name read as "already
 * spoken for"). It never got a cell in any group. `/apps` and
 * `/environments` both undercounted their "N rollouts without an
 * Environment record" link by exactly this rollout (5 shown, 6 real on
 * `/rollouts?unlinked=1`). Fixed by tracking bound ROLLOUT INSTANCES
 * (`Set<Rollout>`), not names.
 */
describe('groupRolloutsByApp — a same-named, unbound rollout is not dropped (U-12)', () => {
	const mkRollout = (name: string, namespace: string): Rollout =>
		({
			metadata: { name, namespace },
			spec: {},
			status: { history: [] }
		}) as unknown as Rollout;

	const mkEnv = (name: string, namespace: string, tier: string): Environment =>
		({
			metadata: { name, namespace },
			spec: { environment: tier, name, rolloutRef: { name } }
		}) as unknown as Environment;

	it('a bound app and an unrelated same-named, unbound rollout both appear — the second with environment: null', () => {
		const boundRollout = mkRollout('orders-api', 'orders-api-prod');
		const orphanRollout = mkRollout('orders-api', 'orders-prod'); // no Environment matches this one
		const env = mkEnv('orders-api', 'orders-api-prod', 'prod');

		const groups = groupRolloutsByApp([boundRollout, orphanRollout], [env]);
		const group = groups.get('orders-api');

		expect(group).toBeDefined();
		expect(group!.cells).toHaveLength(2);
		expect(group!.cells.map((c) => c.rollout)).toContain(boundRollout);
		expect(group!.cells.map((c) => c.rollout)).toContain(orphanRollout);

		const orphanCell = group!.cells.find((c) => c.rollout === orphanRollout);
		expect(orphanCell?.environment).toBeNull();

		// The whole-group flag stays true (it IS bound, for the other
		// rollout) — callers must count unbound ROLLOUTS by `cell.environment
		// === null`, never by filtering out this group wholesale.
		expect(group!.hasEnvironmentBinding).toBe(true);
	});

	it('an entirely unbound rollout (no name collision) still falls into its own group, unbound', () => {
		const lonely = mkRollout('standalone-api', 'standalone-prod');
		const groups = groupRolloutsByApp([lonely], []);
		const group = groups.get('standalone-api');
		expect(group?.hasEnvironmentBinding).toBe(false);
		expect(group?.cells).toHaveLength(1);
		expect(group?.cells[0].environment).toBeNull();
	});
});

describe('shortRevision / revisionSlug — only a real hex revision is shortened', () => {
	// ⛔ U-16 (2026-10-08, polish pass). `revision-ledger.ts`'s `releasesByKey`
	// falls back to a release's `version` LABEL (e.g. `4.43.0-43`) when no
	// `revision` annotation exists, and that label rides through as if it
	// were a revision. Blindly slicing to 7/12 characters turned
	// `4.43.0-43` into `4.43.0-` — a dash with its trailing digits cut off —
	// on the change page's own h1 and <title>. Neither helper may shorten a
	// string that is not hex.
	it('shortens a real 40-char hex sha to 7 characters', () => {
		expect(shortRevision('991829b6ab3bdb0100ac0a44d8867460732159f7')).toBe('991829b');
	});

	it('leaves a semver-shaped label untouched, even though it is longer than 7 characters', () => {
		expect(shortRevision('4.43.0-43')).toBe('4.43.0-43');
	});

	it('leaves a short hex sha untouched', () => {
		expect(shortRevision('abc1234')).toBe('abc1234');
	});

	it('slices a real hex revision to 12 characters for the URL slug', () => {
		expect(revisionSlug('991829b6ab3bdb0100ac0a44d8867460732159f7')).toBe('991829b6ab3b');
	});

	it('leaves a semver-shaped label untouched in the URL slug too', () => {
		expect(revisionSlug('4.43.0-43')).toBe('4.43.0-43');
	});
});
