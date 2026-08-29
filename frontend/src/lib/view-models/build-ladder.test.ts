import { describe, it, expect } from 'vitest';
import { buildLadder, liveIn, everIn, divergedFromLine } from './build-ladder';
import type { AppCell } from '$lib/version-utils';

function cell(envName: string, available: unknown[], history: unknown[]): AppCell {
	return {
		envName,
		environment: null,
		theme: null,
		sourceURL: '',
		sourceCluster: '',
		repoKey: 'github.com/acme/app',
		repoLabel: 'acme/app',
		rollout: {
			metadata: { name: 'app', namespace: `ns-${envName}` },
			status: { availableReleases: available, history }
		}
	} as unknown as AppCell;
}

const rel = (version: string, created: string) => ({
	version,
	revision: `${version}0000`,
	tag: `main-${version}`,
	created
});
const dep = (version: string, created: string, timestamp: string) => ({
	timestamp,
	bakeStatus: 'Succeeded',
	version: rel(version, created)
});

describe('buildLadder', () => {
	it('unions availableReleases across envs and ranks newest-first by release time', () => {
		const ladder = buildLadder([
			cell('dev', [rel('aaa', '2026-01-01T00:00:00Z'), rel('bbb', '2026-01-02T00:00:00Z')], []),
			cell('prod', [rel('aaa', '2026-01-01T00:00:00Z'), rel('ccc', '2026-01-03T00:00:00Z')], [])
		]);
		expect(ladder.builds.map((b) => b.version)).toEqual(['ccc', 'bbb', 'aaa']);
		expect(ladder.rankOf('ccc')).toBe(0);
		expect(ladder.rankOf('aaa')).toBe(2);
	});

	it('never fabricates a rank for an unknown build', () => {
		const ladder = buildLadder([cell('dev', [rel('aaa', '2026-01-01T00:00:00Z')], [])]);
		expect(ladder.rankOf('zzz')).toBe(-1);
		expect(ladder.rankOf(null)).toBe(-1);
	});

	it('folds in a build an env is running even when it aged out of every release list', () => {
		// prod is running `old`, which no rollout still lists as available.
		const ladder = buildLadder([
			cell('dev', [rel('new', '2026-02-01T00:00:00Z')], []),
			cell('prod', [rel('new', '2026-02-01T00:00:00Z')], [dep('old', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')])
		]);
		expect(ladder.builds.map((b) => b.version)).toEqual(['new', 'old']);
		expect(ladder.rankOf('old')).toBe(1);
	});

	it('orders by release creation time, not deploy time', () => {
		// `held` was released FIRST but deployed LAST (a pin). It must still
		// rank older than the build released after it.
		const ladder = buildLadder([
			cell(
				'staging',
				[rel('held', '2026-01-01T00:00:00Z'), rel('later', '2026-01-05T00:00:00Z')],
				[dep('held', '2026-01-01T00:00:00Z', '2026-01-09T00:00:00Z')]
			)
		]);
		expect(ladder.rankOf('later')).toBe(0);
		expect(ladder.rankOf('held')).toBe(1);
	});
});

describe('liveIn', () => {
	it('maps each version to the envs currently running it', () => {
		const map = liveIn([
			cell('dev', [], [dep('bbb', '2026-01-02T00:00:00Z', '2026-01-02T01:00:00Z')]),
			cell('staging', [], [dep('bbb', '2026-01-02T00:00:00Z', '2026-01-02T02:00:00Z')]),
			cell('prod', [], [dep('aaa', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')])
		]);
		expect(map.get('bbb')?.map((c) => c.envName)).toEqual(['dev', 'staging']);
		expect(map.get('aaa')?.map((c) => c.envName)).toEqual(['prod']);
	});
});

describe('everIn', () => {
	it('maps each version to every env that has run it, current or past', () => {
		const map = everIn([
			cell('dev', [], [
				dep('bbb', '2026-01-02T00:00:00Z', '2026-01-02T01:00:00Z'),
				dep('aaa', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')
			]),
			cell('prod', [], [dep('aaa', '2026-01-01T00:00:00Z', '2026-01-03T01:00:00Z')])
		]);
		expect(map.get('bbb')?.map((c) => c.envName)).toEqual(['dev']);
		expect(map.get('aaa')?.map((c) => c.envName)).toEqual(['dev', 'prod']);
	});

	it('counts an env once even when it redeployed the same build', () => {
		const map = everIn([
			cell('dev', [], [
				dep('aaa', '2026-01-01T00:00:00Z', '2026-01-04T00:00:00Z'),
				dep('bbb', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z'),
				dep('aaa', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')
			])
		]);
		expect(map.get('aaa')?.map((c) => c.envName)).toEqual(['dev']);
	});

	it('says nothing at all about a build with no retained deploy', () => {
		const map = everIn([cell('dev', [rel('ccc', '2026-01-05T00:00:00Z')], [])]);
		expect(map.get('ccc')).toBeUndefined();
	});
});


// ─────────────────────────────────────────────────────────────────────────
// DIVERGED — the third drift state.
//
// The whole risk in this predicate is FALSE POSITIVES. `availableReleases`
// is a retention window, so "not on the line" is the normal condition of
// any build old enough, and calling that divergence would paint the most
// stale environment on the cluster red for being stale. Every test below
// exists to pin one half of the discrimination: off the line AND deployed
// inside the window the line still covers.
// ─────────────────────────────────────────────────────────────────────────

const ms = (iso: string) => new Date(iso).getTime();

describe('the release line', () => {
	it('marks a build seen in ANY env availableReleases as on the line', () => {
		const ladder = buildLadder([
			cell('dev', [rel('aaa', '2026-01-01T00:00:00Z')], []),
			cell('prod', [], [dep('aaa', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')])
		]);
		expect(ladder.get('aaa')?.onReleaseLine).toBe(true);
	});

	it('marks a history-only build as OFF the line', () => {
		const ladder = buildLadder([
			cell('dev', [rel('aaa', '2026-02-01T00:00:00Z')], []),
			cell('prod', [], [dep('hotfix', '2026-02-02T00:00:00Z', '2026-02-02T01:00:00Z')])
		]);
		expect(ladder.get('hotfix')?.onReleaseLine).toBe(false);
		expect(ladder.get('aaa')?.onReleaseLine).toBe(true);
	});

	it('reports the oldest surviving release as the line window edge', () => {
		const ladder = buildLadder([
			cell('dev', [rel('aaa', '2026-01-05T00:00:00Z'), rel('bbb', '2026-01-09T00:00:00Z')], []),
			cell('prod', [rel('ccc', '2026-01-02T00:00:00Z')], [])
		]);
		expect(ladder.releaseLineOldestMs).toBe(ms('2026-01-02T00:00:00Z'));
	});

	it('reports NO line at all when no env publishes availableReleases', () => {
		const ladder = buildLadder([
			cell('dev', [], [dep('aaa', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')])
		]);
		expect(ladder.releaseLineOldestMs).toBe(0);
	});
});

describe('divergedFromLine', () => {
	// The positive case: a build nobody's release list contains, deployed
	// well after the oldest release the line still remembers.
	it('flags a build deployed INSIDE the window that is not on the line', () => {
		const ladder = buildLadder([
			cell('dev', [rel('aaa', '2026-01-01T00:00:00Z'), rel('bbb', '2026-01-10T00:00:00Z')], []),
			cell('prod', [], [dep('hotfix', '2026-01-05T00:00:00Z', '2026-01-05T01:00:00Z')])
		]);
		expect(divergedFromLine(ladder, 'hotfix', ms('2026-01-05T01:00:00Z'))).toBe(true);
	});

	// THE FALSE POSITIVE THAT MATTERS. A build older than the line's oldest
	// surviving release simply aged out. That is "unknowable", which the
	// page already renders as no rank chip — not as an adverse state.
	it('does NOT flag a build that merely aged out of the window', () => {
		const ladder = buildLadder([
			cell('dev', [rel('aaa', '2026-06-01T00:00:00Z'), rel('bbb', '2026-06-10T00:00:00Z')], []),
			cell('prod', [], [dep('ancient', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')])
		]);
		expect(divergedFromLine(ladder, 'ancient', ms('2026-01-01T01:00:00Z'))).toBe(false);
	});

	it('does not flag a build that IS on the line', () => {
		const ladder = buildLadder([
			cell('dev', [rel('aaa', '2026-01-01T00:00:00Z'), rel('bbb', '2026-01-10T00:00:00Z')], []),
			cell('prod', [], [dep('aaa', '2026-01-01T00:00:00Z', '2026-01-11T00:00:00Z')])
		]);
		expect(divergedFromLine(ladder, 'aaa', ms('2026-01-11T00:00:00Z'))).toBe(false);
	});

	// No line published anywhere means there is nothing to be off. The
	// bare-rollout fixtures in dev-mock-api are exactly this shape, and a
	// page that painted all of them red would be inventing the claim.
	it('claims nothing when no env publishes a release list', () => {
		const ladder = buildLadder([
			cell('dev', [], [dep('aaa', '2026-01-01T00:00:00Z', '2026-01-01T01:00:00Z')]),
			cell('prod', [], [dep('bbb', '2026-01-02T00:00:00Z', '2026-01-02T01:00:00Z')])
		]);
		expect(divergedFromLine(ladder, 'bbb', ms('2026-01-02T01:00:00Z'))).toBe(false);
	});

	it('claims nothing for an unknown or absent version', () => {
		const ladder = buildLadder([cell('dev', [rel('aaa', '2026-01-01T00:00:00Z')], [])]);
		expect(divergedFromLine(ladder, 'zzz', Date.now())).toBe(false);
		expect(divergedFromLine(ladder, null, Date.now())).toBe(false);
		expect(divergedFromLine(ladder, undefined, Date.now())).toBe(false);
	});

	// The mock fixtures carry no `created` on history entries, which is the
	// real API's shape for some payloads too. The deploy timestamp is the
	// fallback anchor, and it has to work or the whole predicate is dead on
	// exactly the data used to develop against.
	it('falls back to the DEPLOY time when the build carries no release time', () => {
		const bare = (version: string, timestamp: string) => ({
			timestamp,
			bakeStatus: 'Succeeded',
			version: { version, tag: version }
		});
		const ladder = buildLadder([
			cell('dev', [rel('aaa', '2026-01-01T00:00:00Z'), rel('bbb', '2026-01-10T00:00:00Z')], []),
			cell('prod', [], [bare('hotfix', '2026-01-06T00:00:00Z')])
		]);
		expect(ladder.get('hotfix')?.createdMs).toBe(0);
		expect(divergedFromLine(ladder, 'hotfix', ms('2026-01-06T00:00:00Z'))).toBe(true);
		// …and the same build deployed before the window opened is still
		// just old, not diverged.
		expect(divergedFromLine(ladder, 'hotfix', ms('2025-12-01T00:00:00Z'))).toBe(false);
	});

	it('claims nothing when the deploy time is unusable', () => {
		const ladder = buildLadder([
			cell('dev', [rel('aaa', '2026-01-01T00:00:00Z')], []),
			cell('prod', [], [{ timestamp: 'nonsense', bakeStatus: 'Succeeded', version: { version: 'hotfix', tag: 'hotfix' } }])
		]);
		expect(divergedFromLine(ladder, 'hotfix', Number.NaN)).toBe(false);
		expect(divergedFromLine(ladder, 'hotfix', 0)).toBe(false);
	});
});
