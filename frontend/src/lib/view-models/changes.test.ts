import { describe, it, expect } from 'vitest';
import {
	buildChangeRows,
	changeVerdict,
	changeDayLabel,
	groupByDay,
	matchesChangeText,
	filterChangeRows,
	repoChipOptions,
	buildLedgerChangeRows,
	type ChangeRowVM
} from './changes';
import { buildPrPipeline } from './pr-pipeline';
import type { PrCell, PrPipelineVM, PrService } from './pr-pipeline';
import type { Change } from '../api/changes';
import type { Rollout, Environment } from '../../types';

function mkCell(state: PrCell['state'], overrides: Partial<PrCell> = {}): PrCell {
	return {
		cluster: '',
		envName: 'dev',
		namespace: 'default',
		rolloutName: 'app',
		theme: null,
		envRank: 1,
		state,
		reason: '',
		since: null,
		usuallyMs: null,
		bakeLeftMs: null,
		releaseLabel: '',
		revision: null,
		superseded: false,
		gateHint: null,
		gateLabel: null,
		gateSubject: null,
		gateSubjectKind: null,
		gatePending: false,
		...overrides
	};
}

function mkService(appName: string, cells: PrCell[]): PrService {
	return {
		appName,
		sourceRepo: 'github.com/acme/widget',
		cells,
		furthest: '',
		furthestCompact: '',
		leadTimeMs: null
	};
}

function mkVm(services: PrService[]): PrPipelineVM {
	return { services, verdict: '' };
}

const NOW = new Date('2026-09-10T12:00:00Z');
const SOURCE = 'github.com/acme/widget';

function mkChange(overrides: Partial<Change> = {}): Change {
	return {
		owner: 'acme',
		repo: 'widget',
		kind: 'pr',
		number: 4,
		title: 'fix(frontend): retry on 502',
		htmlUrl: 'https://github.com/acme/widget/pull/4',
		author: 'octocat',
		mergedAt: '2026-09-10T10:00:00Z',
		mergeCommitSha: 'c0ffee1',
		headSha: 'c0ffee1',
		base: 'main',
		containedIn: [],
		containedInAll: false,
		...overrides
	};
}

function mkRollout(opts: {
	name: string;
	history?: { revision: string; timestamp: string; bakeStatus?: string }[];
}): Rollout {
	return {
		metadata: { name: opts.name, namespace: 'default', annotations: {} },
		spec: {},
		status: {
			source: SOURCE,
			gates: [],
			history: (opts.history ?? []).map((h, i) => ({
				id: i,
				timestamp: h.timestamp,
				bakeStatus: h.bakeStatus ?? 'Succeeded',
				version: { tag: h.revision, revision: h.revision }
			})),
			availableReleases: []
		}
	} as unknown as Rollout;
}

function mkEnv(name: string): Environment {
	return {
		metadata: { name, namespace: 'default' },
		spec: { environmentSelector: {} }
	} as unknown as Environment;
}

describe('buildChangeRows', () => {
	it('builds one row per change, folding through buildPrPipeline + buildLandingGrid', () => {
		const rollouts = [
			mkRollout({ name: 'widget-app', history: [{ revision: 'c0ffee1', timestamp: '2026-09-05T00:00:00Z' }] })
		];
		const environments = [mkEnv('dev')];
		const rows = buildChangeRows([mkChange()], rollouts, environments, null, NOW);
		expect(rows).toHaveLength(1);
		expect(rows[0].verdictWord).toBe('live everywhere');
		expect(rows[0].verdictTone).toBe('live');
		expect(rows[0].notEverywhere).toBe(false);
		expect(rows[0].grid.services).toHaveLength(1);
		expect(rows[0].href).toBe('/changes/github.com/acme/widget/pull/4');
	});

	it('a bare commit links to the sha form', () => {
		const rows = buildChangeRows(
			[mkChange({ kind: 'commit', number: undefined, title: 'Add patch', mergeCommitSha: 'deadbeef' })],
			[],
			[],
			null,
			NOW
		);
		expect(rows[0].href).toBe('/changes/github.com/acme/widget/deadbeef');
		expect(rows[0].shortSha).toBe('deadbee');
	});

	it('a change matching no service on this cluster reads "not built here" and counts as not-everywhere', () => {
		const rows = buildChangeRows([mkChange({ mergeCommitSha: 'nomatch' })], [], [], null, NOW);
		expect(rows[0].verdictWord).toBe('not built here');
		expect(rows[0].notEverywhere).toBe(true);
	});
});

describe('changeVerdict', () => {
	it('is "live everywhere" when every cell is live', () => {
		const vm = mkVm([mkService('a', [mkCell('live')]), mkService('b', [mkCell('live')])]);
		expect(changeVerdict(vm)).toEqual({ word: 'live everywhere', tone: 'live' });
	});

	it('names the environment family for a held cell, worst-first', () => {
		const vm = mkVm([
			mkService('a', [mkCell('live', { envName: 'dev' })]),
			mkService('b', [mkCell('gated', { envName: 'prod' })])
		]);
		expect(changeVerdict(vm)).toEqual({ word: 'held in prd', tone: 'held' });
	});

	it('names the environment family for a failed cell', () => {
		const vm = mkVm([mkService('a', [mkCell('failed', { envName: 'staging' })])]);
		expect(changeVerdict(vm)).toEqual({ word: 'failed in stg', tone: 'failed' });
	});

	it('is "not built yet" when nothing has built, but a service exists', () => {
		const vm = mkVm([mkService('a', [mkCell('not-built')])]);
		expect(changeVerdict(vm)).toEqual({ word: 'not built yet', tone: 'not-built' });
	});

	it('is "deploying" for an in-flight cell with nothing worse', () => {
		const vm = mkVm([mkService('a', [mkCell('deploying')])]);
		expect(changeVerdict(vm)).toEqual({ word: 'deploying', tone: 'active' });
	});

	it('is "not built here" with no matching service at all', () => {
		const vm = mkVm([]);
		expect(changeVerdict(vm)).toEqual({ word: 'not built here', tone: 'not-built' });
	});
});

describe('matchesChangeText', () => {
	const row: Pick<ChangeRowVM, 'title' | 'number' | 'sha' | 'shortSha'> = {
		title: 'fix(frontend): retry on 502',
		number: 4,
		sha: 'bf5be4932430f8f3576912d0ae7e57c0a9177383',
		shortSha: 'bf5be49'
	};

	it('matches the title', () => {
		expect(matchesChangeText(row, 'retry')).toBe(true);
		expect(matchesChangeText(row, 'nope')).toBe(false);
	});

	it('matches #n, with or without the hash', () => {
		expect(matchesChangeText(row, '#4')).toBe(true);
		expect(matchesChangeText(row, '4')).toBe(true);
		expect(matchesChangeText(row, '#5')).toBe(false);
	});

	it('matches a sha prefix', () => {
		expect(matchesChangeText(row, 'bf5be')).toBe(true);
		expect(matchesChangeText(row, 'deadbeef')).toBe(false);
	});

	it('matches everything on an empty query', () => {
		expect(matchesChangeText(row, '')).toBe(true);
		expect(matchesChangeText(row, '   ')).toBe(true);
	});
});

describe('filterChangeRows', () => {
	function mkRow(overrides: Partial<ChangeRowVM>): ChangeRowVM {
		return {
			owner: 'acme',
			repo: 'widget',
			repoKey: 'acme/widget',
			kind: 'pr',
			number: 1,
			title: 'a change',
			sha: 'abc1234',
			shortSha: 'abc1234',
			href: '/changes/x',
			htmlUrl: '',
			author: 'octocat',
			mergedAt: NOW.toISOString(),
			verdictWord: 'live everywhere',
			verdictTone: 'live',
			grid: { services: [], allSameLabel: null, visible: [], overflow: null },
			notEverywhere: false,
			...overrides
		};
	}

	it('filters to mine, case-insensitively', () => {
		const rows = [mkRow({ author: 'Octocat' }), mkRow({ author: 'someone-else' })];
		expect(filterChangeRows(rows, 'octocat', { mine: true })).toHaveLength(1);
	});

	it('filters by repo, OR across a multi-select', () => {
		const rows = [mkRow({ repoKey: 'a/one' }), mkRow({ repoKey: 'a/two' }), mkRow({ repoKey: 'a/three' })];
		expect(filterChangeRows(rows, '', { repos: ['a/one', 'a/two'] })).toHaveLength(2);
	});

	it('filters to pending (not-everywhere) only', () => {
		const rows = [mkRow({ notEverywhere: true }), mkRow({ notEverywhere: false })];
		expect(filterChangeRows(rows, '', { pendingOnly: true })).toHaveLength(1);
	});

	it('applies q via matchesChangeText', () => {
		const rows = [mkRow({ title: 'fix retry' }), mkRow({ title: 'add feature' })];
		expect(filterChangeRows(rows, '', { q: 'retry' })).toHaveLength(1);
	});

	it('combines every filter with AND', () => {
		const rows = [
			mkRow({ author: 'octocat', repoKey: 'a/one', notEverywhere: true, title: 'fix retry' }),
			mkRow({ author: 'octocat', repoKey: 'a/one', notEverywhere: false, title: 'fix retry' })
		];
		const filtered = filterChangeRows(rows, 'octocat', {
			mine: true,
			repos: ['a/one'],
			pendingOnly: true,
			q: 'retry'
		});
		expect(filtered).toHaveLength(1);
		expect(filtered[0].notEverywhere).toBe(true);
	});
});

describe('repoChipOptions', () => {
	it('dedupes and sorts alphabetically by repo name', () => {
		const rows = [
			{ repoKey: 'a/zebra', repo: 'zebra' },
			{ repoKey: 'a/apple', repo: 'apple' },
			{ repoKey: 'a/zebra', repo: 'zebra' }
		] as ChangeRowVM[];
		expect(repoChipOptions(rows)).toEqual([
			{ repoKey: 'a/apple', label: 'apple' },
			{ repoKey: 'a/zebra', label: 'zebra' }
		]);
	});
});

describe('changeDayLabel', () => {
	it('is Today / Yesterday for the two nearest days, a calendar date otherwise', () => {
		expect(changeDayLabel(NOW.toISOString(), NOW)).toBe('Today');
		expect(changeDayLabel(new Date(NOW.getTime() - 24 * 3600_000).toISOString(), NOW)).toBe('Yesterday');
		expect(changeDayLabel('2026-09-01T12:00:00Z', NOW)).toBe('1 Sep');
	});
});

describe('groupByDay', () => {
	it('groups consecutive newest-first rows by their own day label', () => {
		const rows = [
			{ at: NOW.toISOString() },
			{ at: new Date(NOW.getTime() - 3600_000).toISOString() },
			{ at: new Date(NOW.getTime() - 24 * 3600_000).toISOString() }
		];
		const groups = groupByDay(rows, (r) => r.at, NOW);
		expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday']);
		expect(groups[0].rows).toHaveLength(2);
		expect(groups[1].rows).toHaveLength(1);
	});

	it('is empty for an empty input', () => {
		expect(groupByDay([], () => '', NOW)).toEqual([]);
	});
});

describe('buildLedgerChangeRows', () => {
	it('honestly degrades to one row per deployed revision, no author, newest first', () => {
		const environments = [
			{
				metadata: { name: 'widget-app', namespace: 'default' },
				spec: { environment: 'dev', name: 'widget-app', rolloutRef: { name: 'widget-app' } }
			} as unknown as Environment
		];
		const rollouts = [
			{
				metadata: { name: 'widget-app', namespace: 'default' },
				spec: {},
				status: {
					source: SOURCE,
					availableReleases: [
						{ tag: 'v1', revision: 'r1'.padEnd(40, '0'), created: '2026-09-01T00:00:00Z' },
						{ tag: 'v2', revision: 'r2'.padEnd(40, '0'), created: '2026-09-05T00:00:00Z' }
					],
					history: [
						{
							version: { tag: 'v2', revision: 'r2'.padEnd(40, '0') },
							timestamp: '2026-09-05T00:00:00Z',
							bakeStatus: 'Succeeded'
						}
					]
				}
			} as unknown as Rollout
		];
		const rows = buildLedgerChangeRows(rollouts, environments);
		expect(rows.length).toBeGreaterThan(0);
		for (const r of rows) {
			expect(r.href).toMatch(/^\/changes\//);
		}
		// newest first
		const times = rows.map((r) => new Date(r.createdAt).getTime());
		expect([...times]).toEqual([...times].sort((a, b) => b - a));
	});
});
