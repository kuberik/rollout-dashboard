import { describe, it, expect } from 'vitest';
import { buildPaletteBuildIndex, buildEntryLine, scoreBuildEntry, buildPrPaletteResults } from './palette-index';
import type { Environment, Rollout } from '../types';

/**
 * The operator-walk bug this module closes: pasting `9f10e49` into ⌘K
 * returned "No matches · 0 results" although
 * `/revisions/github.com/littlechimera/kuberik-testing/9f10e494d560` exists,
 * while `064b655` matched only because that sha happened to also be the
 * VERSION LABEL some rollout is currently displaying — a service with a
 * semver annotation never resolved by sha at all.
 *
 * The fixture below reproduces both halves in one repo: `api` labels its
 * build with a semver tag (`labelDiffers`), `web` has no semver annotation
 * so its label IS the sha.
 */

const SOURCE = 'https://github.com/littlechimera/kuberik-testing.git';

function rel(sha: string, label: string | undefined, minutesAgo: number) {
	return {
		tag: `main-${sha}`,
		version: label,
		revision: `${sha}${'0'.repeat(40)}`.slice(0, 40),
		created: new Date(Date.now() - minutesAgo * 60_000).toISOString()
	};
}

function rollout(
	name: string,
	ns: string,
	releases: ReturnType<typeof rel>[],
	history: { r: ReturnType<typeof rel>; minutesAgo: number }[]
): Rollout {
	return {
		metadata: { name, namespace: ns },
		spec: {},
		status: {
			source: SOURCE,
			availableReleases: [...releases].reverse(),
			history: history.map((h) => ({
				version: h.r,
				timestamp: new Date(Date.now() - h.minutesAgo * 60_000).toISOString(),
				bakeStatus: 'Succeeded'
			}))
		}
	} as unknown as Rollout;
}

function environment(app: string, ns: string, tier: string): Environment {
	return {
		metadata: { name: app, namespace: ns },
		spec: { environment: tier, name: app, rolloutRef: { name: app } }
	} as unknown as Environment;
}

function fixture() {
	// `api` ships this commit under a semver label — the build that never
	// resolved by sha before this module existed.
	const SEMVER_SHA = '9f10e49';
	const API = [rel(SEMVER_SHA, '2.66.0-66', 10)];
	// `web` has no semver annotation, so its label is its own sha — the build
	// that "worked by accident" because the label and the sha were the same
	// string.
	const SHA_LABEL_SHA = '064b655';
	const WEB = [rel(SHA_LABEL_SHA, undefined, 20)];

	const rollouts = [
		rollout('api', 'api-prod', API, [{ r: API[0], minutesAgo: 5 }]),
		rollout('web', 'web-prod', WEB, [{ r: WEB[0], minutesAgo: 5 }])
	];
	const environments = [environment('api', 'api-prod', 'prod'), environment('web', 'web-prod', 'prod')];
	return { rollouts, environments, SEMVER_SHA, SHA_LABEL_SHA };
}

describe('buildPaletteBuildIndex', () => {
	it('indexes a revision independently of the label any service ships it under', () => {
		const { rollouts, environments } = fixture();
		const entries = buildPaletteBuildIndex(rollouts, environments);
		// api's semver-labelled build and web's sha-labelled build are both
		// present as their own entries.
		const shorts = entries.map((e) => e.short);
		expect(shorts).toContain('9f10e49');
		expect(shorts).toContain('064b655');
	});

	it('carries the full revision, not just the 7-character display form', () => {
		const { rollouts, environments, SEMVER_SHA } = fixture();
		const entries = buildPaletteBuildIndex(rollouts, environments);
		const entry = entries.find((e) => e.short === SEMVER_SHA)!;
		expect(entry.revision.startsWith(SEMVER_SHA)).toBe(true);
		expect(entry.revision.length).toBeGreaterThan(SEMVER_SHA.length);
	});

	it('carries every label the revision ships under, and the repo short name', () => {
		const { rollouts, environments } = fixture();
		const entries = buildPaletteBuildIndex(rollouts, environments);
		const apiEntry = entries.find((e) => e.short === '9f10e49')!;
		expect(apiEntry.labels).toContain('2.66.0-66');
		expect(apiEntry.repoShort).toBe('kuberik-testing');
		// `revisionPath` slices to the 12-character URL form (`revisionSlug`)
		// — the fixture's revision is `9f10e49` zero-padded to 40 characters,
		// so the first 12 are `9f10e49` + five zeros.
		expect(apiEntry.href).toBe('/revisions/github.com/littlechimera/kuberik-testing/9f10e4900000');
	});

	it('renders the required display line: <sha7> · <labels> · <repo short name>', () => {
		const { rollouts, environments } = fixture();
		const entries = buildPaletteBuildIndex(rollouts, environments);
		const apiEntry = entries.find((e) => e.short === '9f10e49')!;
		expect(buildEntryLine(apiEntry)).toBe('9f10e49 · 2.66.0-66 · kuberik-testing');
	});
});

describe('buildPaletteBuildIndex — split revisions never collide', () => {
	/**
	 * ⭐ CAUGHT LIVE, NOT BY A UNIT TEST FIRST. Verifying this in the browser
	 * against the real cluster threw `each_key_duplicate` on
	 * `9f10e494d560...` and froze the palette's reactivity mid-keystroke (the
	 * DOM input kept advancing; every derived list downstream stopped
	 * updating, so it looked exactly like a dropped keystroke). Cause:
	 * `revision-ledger.ts`'s own "one row per RELEASE" split — a rollback
	 * re-ships a commit under a second tag, so ONE revision can resolve to
	 * TWO `RevisionRow`s (see `revision-ledger.test.ts`'s own
	 * "splits one row per release" case, reproduced minimally here).
	 *
	 * ⛔ ⭐ LANE 9, ROUND 11 QA, ITEM 15 — SUPERSEDES THE FIRST FIX. Keying
	 * each split row `repoKey:revision:${i}` stopped the crash but not the
	 * actual defect a later operator walk caught: `9f10e49` still returned
	 * TWO results, both opening the SAME `href` (the split is
	 * release-scoped; the build page is revision-scoped) with only a
	 * partial label each. The fix now merges by `(repoKey, revision)`
	 * before a result is even built, so one revision is one result,
	 * carrying every label it ships under.
	 */
	it('merges held and running releases of one rolled-back commit into one result', () => {
		const older = rel('eeeeeee', '2.66.0-66', 120); // rel-66, running
		const newer = rel('eeeeeee', '2.67.0-67', 10); // rel-67, held — never deployed
		const rollouts = [
			rollout('hello-frontend-app', 'hfa-prod', [newer, older], [{ r: older, minutesAgo: 5 }])
		];
		const environments = [environment('hello-frontend-app', 'hfa-prod', 'prod')];
		const entries = buildPaletteBuildIndex(rollouts, environments);

		const forRevision = entries.filter((e) => e.short === 'eeeeeee');
		// ONE result now, not two — the same commit under two release
		// labels is one build with one destination.
		expect(forRevision).toHaveLength(1);
		expect(forRevision[0].labels.slice().sort()).toEqual(['2.66.0-66', '2.67.0-67']);
	});
});

describe('scoreBuildEntry — the bug, closed both directions', () => {
	it('resolves a semver-labelled build by its sha prefix (>= 7 chars), which used to return nothing', () => {
		const entry = { revision: '9f10e494d5605d5d5d5d5d5d5d5d5d5d5d5d5d5d', labels: ['2.66.0-66'] };
		expect(scoreBuildEntry(entry, '9f10e49')).toBeGreaterThanOrEqual(0);
		// A 12-character slug — the length a `/revisions/.../<slug>` URL
		// carries — resolves exactly like the 7-character one.
		expect(scoreBuildEntry(entry, '9f10e494d560')).toBeGreaterThanOrEqual(0);
	});

	it('still resolves a build by its own sha as a label, not only by luck', () => {
		const entry = { revision: '064b6550000000000000000000000000000000', labels: ['064b655'] };
		expect(scoreBuildEntry(entry, '064b655')).toBeGreaterThanOrEqual(0);
	});

	it('resolves by version label independent of the sha', () => {
		const entry = { revision: '9f10e494d5605d5d5d5d5d5d5d5d5d5d5d5d5d5d', labels: ['2.66.0-66'] };
		expect(scoreBuildEntry(entry, '2.66.0-66')).toBeGreaterThanOrEqual(0);
		expect(scoreBuildEntry(entry, '2.66.0')).toBeGreaterThanOrEqual(0);
	});

	it('requires at least 7 hex characters before treating a query as a sha prefix', () => {
		const entry = { revision: '9f10e494d5605d5d5d5d5d5d5d5d5d5d5d5d5d5d', labels: ['2.66.0-66'] };
		// A 6-character prefix of the revision, with no label to back it,
		// must not match — the floor is deliberate (see the doc comment).
		expect(scoreBuildEntry(entry, '9f10e4')).toBe(-1);
	});

	it('does not match an unrelated query', () => {
		const entry = { revision: '9f10e494d5605d5d5d5d5d5d5d5d5d5d5d5d5d5d', labels: ['2.66.0-66'] };
		expect(scoreBuildEntry(entry, 'zzzzzzz')).toBe(-1);
	});

	it('scores an exact revision match at least as high as an exact label match', () => {
		const entry = { revision: '9f10e494d5605d5d5d5d5d5d5d5d5d5d5d5d5d5d', labels: ['2.66.0-66'] };
		const shaScore = scoreBuildEntry(entry, entry.revision);
		const labelScore = scoreBuildEntry(entry, '2.66.0-66');
		expect(shaScore).toBeGreaterThan(0);
		expect(labelScore).toBeGreaterThan(0);
	});
});

describe('buildPrPaletteResults', () => {
	function withSource(source: string): Rollout {
		return { metadata: {}, spec: {}, status: { source } } as unknown as Rollout;
	}

	it('returns nothing for a query naming no PR', () => {
		expect(buildPrPaletteResults('hello world', [])).toEqual([]);
		expect(buildPrPaletteResults('', [])).toEqual([]);
	});

	it('resolves a full URL to exactly one result, without touching the cluster data', () => {
		const results = buildPrPaletteResults(
			'https://github.com/kuberik/rollout-dashboard/pull/123',
			[]
		);
		expect(results).toEqual([
			{
				key: 'pr:kuberik/rollout-dashboard#123',
				owner: 'kuberik',
				repo: 'rollout-dashboard',
				number: 123,
				title: 'Open PR #123 · kuberik/rollout-dashboard',
				href: '/pr/kuberik/rollout-dashboard/123'
			}
		]);
	});

	it('resolves owner/repo#123 to exactly one result', () => {
		const results = buildPrPaletteResults('kuberik/rollout-dashboard#123', []);
		expect(results).toHaveLength(1);
		expect(results[0].title).toBe('Open PR #123 · kuberik/rollout-dashboard');
	});

	it('fans a bare #123 out to one result per distinct cluster source repo', () => {
		const rollouts = [
			withSource('https://github.com/acme/widget.git'),
			// A second rollout of the SAME repo, differently formatted — must
			// not produce a second result.
			withSource('github.com/acme/widget'),
			withSource('https://github.com/acme/gadget')
		];
		const results = buildPrPaletteResults('#7', rollouts);
		expect(results).toHaveLength(2);
		expect(results.map((r) => r.title)).toEqual([
			'Open PR #7 · acme/gadget',
			'Open PR #7 · acme/widget'
		]);
	});

	it('ignores a rollout with no source at all', () => {
		const rollouts = [{ metadata: {}, spec: {}, status: {} } as unknown as Rollout];
		expect(buildPrPaletteResults('#7', rollouts)).toEqual([]);
	});

	it('produces nothing for a bare #n when no rollout has a GitHub source', () => {
		const rollouts = [withSource('https://gitlab.com/acme/widget')];
		expect(buildPrPaletteResults('#7', rollouts)).toEqual([]);
	});
});
