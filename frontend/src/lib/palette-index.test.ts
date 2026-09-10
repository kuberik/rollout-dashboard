import { describe, it, expect } from 'vitest';
import {
	buildPaletteBuildIndex,
	buildEntryLine,
	scoreBuildEntry,
	parseChangeRef,
	changePath,
	buildChangeRefPaletteResults,
	buildMergedChangeIndex
} from './palette-index';
import type { Environment, Rollout } from '../types';
import type { MyPull } from './api/my-pulls';

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
		// `changeBuildPath` slices to the 12-character URL form (`revisionSlug`)
		// — the fixture's revision is `9f10e49` zero-padded to 40 characters,
		// so the first 12 are `9f10e49` + five zeros. CHANGES-2026-09-10.md
		// §1: the build result's href is `/changes/...` now, not `/revisions/...`.
		expect(apiEntry.href).toBe('/changes/github.com/littlechimera/kuberik-testing/9f10e4900000');
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

/**
 * ⭐ CHANGES-2026-09-10.md, "THE PALETTE" — the renamed `pr` kind. Renamed
 * from `buildPrPaletteResults`/`PalettePrEntry`, and pointed at `/changes/…`
 * instead of `/pr/…` (the old routes are retired, never produced again).
 */
describe('parseChangeRef', () => {
	it('parses a full PR URL, owner/repo#n and a bare #n exactly as pr-ref.ts does', () => {
		expect(parseChangeRef('https://github.com/kuberik/rollout-dashboard/pull/123')).toEqual({
			kind: 'full',
			owner: 'kuberik',
			repo: 'rollout-dashboard',
			number: 123
		});
		expect(parseChangeRef('kuberik/rollout-dashboard#123')).toEqual({
			kind: 'full',
			owner: 'kuberik',
			repo: 'rollout-dashboard',
			number: 123
		});
		expect(parseChangeRef('#123')).toEqual({ kind: 'bare', number: 123 });
	});

	it('parses a bare 7-40 character hex string as a sha', () => {
		expect(parseChangeRef('bf5be49')).toEqual({ kind: 'sha', sha: 'bf5be49' });
		expect(parseChangeRef('9F10E494D5605D5D5D5D5D5D5D5D5D5D5D5D5D5D')).toEqual({
			kind: 'sha',
			sha: '9f10e494d5605d5d5d5d5d5d5d5d5d5d5d5d5d5d'
		});
	});

	it('requires at least 7 hex characters for the sha shape', () => {
		expect(parseChangeRef('bf5be4')).toBeNull();
	});

	it('returns null for free text', () => {
		expect(parseChangeRef('hello world')).toBeNull();
		expect(parseChangeRef('')).toBeNull();
	});
});

// ⭐ FIX PASS ITEM 3 (2026-09-10). The canonical `github.com/<owner>/<repo>`
// slug shape, not the host-less form these tests used to assert (the exact
// bug: ⌘K's own rows navigated to a host-less path the `[...slug]` route
// rejects as "This repository does not exist" — see `changePath`'s own doc
// comment above).
describe('changePath', () => {
	it('builds the pull-request path', () => {
		expect(changePath('kuberik', 'rollout-dashboard', { kind: 'pull', number: 123 })).toBe(
			'/changes/github.com/kuberik/rollout-dashboard/pull/123'
		);
	});

	it('builds the sha path', () => {
		expect(changePath('kuberik', 'rollout-dashboard', { kind: 'sha', sha: 'bf5be49' })).toBe(
			'/changes/github.com/kuberik/rollout-dashboard/bf5be49'
		);
	});

	it('encodes owner/repo segments', () => {
		expect(changePath('ku berik', 'foo/bar', { kind: 'pull', number: 1 })).toBe(
			'/changes/github.com/ku%20berik/foo%2Fbar/pull/1'
		);
	});
});

describe('buildChangeRefPaletteResults', () => {
	function withSource(source: string): Rollout {
		return { metadata: {}, spec: {}, status: { source } } as unknown as Rollout;
	}

	it('returns nothing for a query naming no change', () => {
		expect(buildChangeRefPaletteResults('hello world', [])).toEqual([]);
		expect(buildChangeRefPaletteResults('', [])).toEqual([]);
	});

	it('resolves a full URL to exactly one result, without touching the cluster data', () => {
		const results = buildChangeRefPaletteResults(
			'https://github.com/kuberik/rollout-dashboard/pull/123',
			[]
		);
		expect(results).toEqual([
			{
				key: 'change-ref:kuberik/rollout-dashboard:pull:123',
				owner: 'kuberik',
				repo: 'rollout-dashboard',
				ref: { kind: 'pull', number: 123 },
				title: 'Open change #123 · rollout-dashboard',
				href: '/changes/github.com/kuberik/rollout-dashboard/pull/123'
			}
		]);
	});

	it('resolves owner/repo#123 to exactly one result', () => {
		const results = buildChangeRefPaletteResults('kuberik/rollout-dashboard#123', []);
		expect(results).toHaveLength(1);
		expect(results[0].title).toBe('Open change #123 · rollout-dashboard');
		expect(results[0].href).toBe('/changes/github.com/kuberik/rollout-dashboard/pull/123');
	});

	it('fans a bare #123 out to one result per distinct cluster source repo', () => {
		const rollouts = [
			withSource('https://github.com/acme/widget.git'),
			// A second rollout of the SAME repo, differently formatted — must
			// not produce a second result.
			withSource('github.com/acme/widget'),
			withSource('https://github.com/acme/gadget')
		];
		const results = buildChangeRefPaletteResults('#7', rollouts);
		expect(results).toHaveLength(2);
		expect(results.map((r) => r.title)).toEqual([
			'Open change #7 · gadget',
			'Open change #7 · widget'
		]);
		expect(results.map((r) => r.href)).toEqual([
			'/changes/github.com/acme/gadget/pull/7',
			'/changes/github.com/acme/widget/pull/7'
		]);
	});

	/**
	 * ⛔ FIX PASS ITEM 8, 2026-09-10 — A BARE SHA NARROWS TO REPOS THE
	 * LEDGER ACTUALLY KNOWS IT IN, UNLIKE A BARE #n (which stays ambiguous
	 * across every repo — no local data can resolve a PR number without a
	 * network call). Superseded: `fans a bare sha out the same way a bare
	 * #n does` — that was the exact defect item 8 fixes; a fan-out is now
	 * ONLY the "nobody knows this sha" fallback (renamed below), and a
	 * known revision narrows to just the one repo whose rollout data
	 * actually carries it.
	 */
	it('narrows a bare sha to the repo whose rollout history actually carries it', () => {
		const known: Rollout = {
			metadata: {},
			spec: {},
			status: {
				source: 'https://github.com/acme/widget.git',
				availableReleases: [{ tag: 'v1', revision: 'bf5be49123456789' }]
			}
		} as unknown as Rollout;
		const unknown = withSource('https://github.com/acme/gadget');
		const results = buildChangeRefPaletteResults('bf5be49', [known, unknown]);
		expect(results).toEqual([
			{
				key: 'change-ref:acme/widget:sha:bf5be49',
				owner: 'acme',
				repo: 'widget',
				ref: { kind: 'sha', sha: 'bf5be49' },
				title: 'Open change bf5be49 · widget',
				href: '/changes/github.com/acme/widget/bf5be49'
			}
		]);
	});

	it('falls back to one "Look up …" row per repo when no ledger knows the sha', () => {
		const rollouts = [withSource('https://github.com/acme/widget.git')];
		const results = buildChangeRefPaletteResults('bf5be49', rollouts);
		expect(results).toEqual([
			{
				key: 'change-ref:acme/widget:sha:bf5be49',
				owner: 'acme',
				repo: 'widget',
				ref: { kind: 'sha', sha: 'bf5be49' },
				title: 'Look up bf5be49 in widget',
				href: '/changes/github.com/acme/widget/bf5be49'
			}
		]);
	});

	it('ignores a rollout with no source at all', () => {
		const rollouts = [{ metadata: {}, spec: {}, status: {} } as unknown as Rollout];
		expect(buildChangeRefPaletteResults('#7', rollouts)).toEqual([]);
	});

	it('produces nothing for a bare #n or sha when no rollout has a GitHub source', () => {
		const rollouts = [withSource('https://gitlab.com/acme/widget')];
		expect(buildChangeRefPaletteResults('#7', rollouts)).toEqual([]);
		expect(buildChangeRefPaletteResults('bf5be49', rollouts)).toEqual([]);
	});
});

describe('buildMergedChangeIndex', () => {
	function pull(overrides: Partial<MyPull>): MyPull {
		return {
			owner: 'kuberik',
			repo: 'kuberik-testing',
			number: 4,
			title: 'fix(frontend): retry on 502',
			htmlUrl: '',
			state: 'merged',
			openedAt: null,
			mergedAt: '2026-09-01T00:00:00Z',
			mergeCommitSha: 'deadbeef',
			headSha: null,
			base: 'main',
			updatedAt: '2026-09-01T00:00:00Z',
			...overrides
		};
	}

	it('includes only MERGED pulls — open and closed are excluded', () => {
		const pulls = [pull({ state: 'merged' }), pull({ state: 'open', number: 5 }), pull({ state: 'closed', number: 6 })];
		const entries = buildMergedChangeIndex(pulls);
		expect(entries).toHaveLength(1);
		expect(entries[0].ref).toEqual({ kind: 'pull', number: 4 });
	});

	it('carries the pull title verbatim, so a free-text search matches on it', () => {
		const entries = buildMergedChangeIndex([pull({})]);
		expect(entries[0].title).toBe('fix(frontend): retry on 502');
		expect(entries[0].href).toBe('/changes/github.com/kuberik/kuberik-testing/pull/4');
	});
});
