import { describe, it, expect } from 'vitest';
import { buildLandingGrid } from './landing-grid';
import {
	standingWords,
	standingWordsCompact,
	changesSummary,
	perRepoCounts,
	splitChangeSections,
	buildChangeRows,
	changeVerdict,
	changeDayLabel,
	groupByDay,
	matchesChangeText,
	filterChangeRows,
	repoChipOptions,
	buildLedgerChangeRows,
	summarizeChangeRows,
	myChangesCount,
	orderHomeChangeRows,
	familyProgress,
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
		gateContract: null,
		gateRequiredVersion: null,
		providerHasNoBuild: false,
		containmentKnown: true,
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
		leadTimeMs: null,
		builtElsewhere: false
	};
}

function mkVm(services: PrService[]): PrPipelineVM {
	return {
		services,
		verdict: '',
		verdictWord: '',
		verdictTone: 'not-built',
		containmentKnown: true,
		rolloutsTotal: 0,
		rolloutsWithBuild: 0,
		rolloutsLive: 0
	};
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

	/**
	 * ⭐ FIX PASS ITEM 1 (2026-09-10) REGRESSION — "THE NEWEST CHANGE IS NOT
	 * UNKNOWN". The bug, live: PR #4's own release (revision === its
	 * `mergeCommitSha`, so `containment()` matches it EXACTLY regardless of
	 * `containedInAll`) is HELD on an upstream dependency gate — but
	 * `buildCell`'s own `if (upstream && !containmentKnown) return
	 * notBuiltUnverified()` guard fired anyway, because this module never
	 * told `buildPrPipeline` that an empty `containedIn`/`containedInAll:
	 * false` here is a REAL, server-verified answer (the feed always
	 * computes it — see this module's own doc comment), not the bare-sha
	 * stub's ambiguity. Without `containmentKnown: true` on the meta this
	 * function builds, this row reads "not built yet"; a change whose own
	 * release is a gated, blocked HELD build must never do that.
	 */
	it('a change with empty containedIn and a release whose revision equals mergeCommitSha reads held, never not-built', () => {
		const rollout = {
			metadata: { name: 'widget-app', namespace: 'widget-dev', annotations: {} },
			spec: {},
			status: {
				source: SOURCE,
				gates: [{ name: 'dep-gate-1', passing: true, allowedVersions: [] }],
				history: [{ id: 0, timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded', version: { tag: 'old', revision: 'old-1' } }],
				availableReleases: [{ tag: 'main-c0ffee1', revision: 'c0ffee1', created: '2026-09-10T09:00:00Z' }]
			}
		} as unknown as Rollout;
		const environments = [mkEnv('dev')];
		const dependency = {
			metadata: { name: 'widget-app-needs-api', namespace: 'widget-dev' },
			spec: { rolloutRef: { name: 'widget-app' }, providerRef: { name: 'api-app' }, contract: 'api' },
			status: { gateName: 'dep-gate-1', providedVersion: '1.0.0' }
		} as unknown;
		const change = mkChange({ mergeCommitSha: 'c0ffee1', containedIn: [], containedInAll: false });
		const rows = buildChangeRows(
			[change],
			[rollout],
			environments,
			{ items: [dependency as never] },
			NOW
		);
		const cell = rows[0].grid.services[0].marks[0];
		expect(cell.state).not.toBe('not-built');
		expect(cell.state).toBe('waiting-upstream');
		expect(rows[0].verdictWord).not.toBe('not built yet');
		expect(rows[0].verdictWord).toContain('held in');
		expect(rows[0].verdictWord).toContain('api-app');
	});
});

// ⭐ RULING 3 (CHANGES-2026-09-10 fix pass, "ONE VERDICT, THE FRONTIER").
// `changeVerdict` is now a thin wrapper over `pr-pipeline.ts`'s own
// `buildChangeVerdict` — the FRONTIER (earliest env-rank cell not live),
// named with the raw environment name (never the family word — that
// abbreviation is `LandingMark`'s own budget, not the row's prose).
// ⭐ FIX PASS ITEM 5 (2026-09-10) — "SUBJECT FIRST". Every expectation below
// updated to lead with the BLOCKED SERVICE's own name (`buildChangeVerdict`'s
// own doc comment) — `live everywhere` is the one exception, a whole-fleet
// claim with no single subject.
describe('changeVerdict', () => {
	it('is "live everywhere" when every cell is live', () => {
		const vm = mkVm([mkService('a', [mkCell('live')]), mkService('b', [mkCell('live')])]);
		expect(changeVerdict(vm)).toEqual({ word: 'live everywhere', tone: 'live' });
	});

	it('names the subject service AND the raw environment for a held cell, worst-first', () => {
		const vm = mkVm([
			mkService('a', [mkCell('live', { envName: 'dev' })]),
			mkService('b', [mkCell('gated', { envName: 'prod' })])
		]);
		expect(changeVerdict(vm)).toEqual({ word: 'b held in prod', tone: 'held' });
	});

	it('names the subject service and the raw environment for a failed cell', () => {
		const vm = mkVm([mkService('a', [mkCell('failed', { envName: 'staging' })])]);
		expect(changeVerdict(vm)).toEqual({ word: 'a failed in staging', tone: 'failed' });
	});

	// ⭐ FIX PASS ITEM 5 — deliberately NO subject here: "nothing has built
	// this change anywhere yet" is a fact about the CHANGE, not about any
	// one service in particular (see `buildChangeVerdict`'s own comment) —
	// unlike a frontier candidate, which names the one specific service a
	// specific cell is blocking.
	it('is "not built yet" when nothing has built, but a service exists', () => {
		const vm = mkVm([mkService('a', [mkCell('not-built')])]);
		expect(changeVerdict(vm)).toEqual({ word: 'not built yet', tone: 'not-built' });
	});

	it('is "<service> deploying in <env>" for an in-flight cell with nothing worse', () => {
		const vm = mkVm([mkService('a', [mkCell('deploying')])]);
		expect(changeVerdict(vm)).toEqual({ word: 'a deploying in dev', tone: 'active' });
	});

	it('is "not built here" with no matching service at all', () => {
		const vm = mkVm([]);
		expect(changeVerdict(vm)).toEqual({ word: 'not built here', tone: 'not-built' });
	});

	it('names the subject service, then the upstream service, for a dependency wait', () => {
		const vm = mkVm([
			mkService('a', [
				mkCell('waiting-upstream', { envName: 'prod', gateSubject: 'api-app', gateSubjectKind: 'service' })
			])
		]);
		expect(changeVerdict(vm)).toEqual({ word: 'a held in prod on api-app', tone: 'held' });
	});

	it('earliest env-rank wins over "worst state": a dev hold outranks a prod failure', () => {
		const vm = mkVm([
			mkService('a', [
				mkCell('gated', { envName: 'dev', envRank: 0 }),
				mkCell('failed', { envName: 'prod', envRank: 7 })
			])
		]);
		expect(changeVerdict(vm)).toEqual({ word: 'a held in dev', tone: 'held' });
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
			prodLeadMs: null,
			frontierReason: null,
			frontierSince: null,
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

	// ⭐ RULING 5 (CHANGES-2026-09-10 fix pass, "COUNTS") — the "Pull requests" chip.
	it('filters by kind', () => {
		const rows = [mkRow({ kind: 'pr' }), mkRow({ kind: 'commit' })];
		expect(filterChangeRows(rows, '', { kind: 'pr' })).toHaveLength(1);
		expect(filterChangeRows(rows, '', { kind: 'pr' })[0].kind).toBe('pr');
	});

	it('kind unset matches everything', () => {
		const rows = [mkRow({ kind: 'pr' }), mkRow({ kind: 'commit' })];
		expect(filterChangeRows(rows, '', {})).toHaveLength(2);
	});
});

describe('summarizeChangeRows (CHANGES-2026-09-10 fix pass, ruling 5 — "COUNTS")', () => {
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
			prodLeadMs: null,
			frontierReason: null,
			frontierSince: null,
			...overrides
		};
	}

	it('computes count / notEverywhereCount / repoCount over whatever rows it is given', () => {
		const rows = [
			mkRow({ repoKey: 'a/one', notEverywhere: true }),
			mkRow({ repoKey: 'a/one', notEverywhere: false }),
			mkRow({ repoKey: 'a/two', notEverywhere: true })
		];
		expect(summarizeChangeRows(rows)).toEqual({ count: 3, notEverywhereCount: 2, repoCount: 2 });
	});

	it('reflects the FILTERED set, not some other total — the head band\'s own requirement', () => {
		const all = [mkRow({ repoKey: 'a/one' }), mkRow({ repoKey: 'a/two' })];
		const filtered = all.filter((r) => r.repoKey === 'a/one');
		expect(summarizeChangeRows(filtered).repoCount).toBe(1);
	});
});

describe('myChangesCount (ruling 5 — ONE definition of "your changes")', () => {
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
			prodLeadMs: null,
			frontierReason: null,
			frontierSince: null,
			...overrides
		};
	}

	it('counts merged PRs AND bare commits authored by the user, case-insensitively', () => {
		const rows = [
			mkRow({ author: 'Octocat', kind: 'pr' }),
			mkRow({ author: 'octocat', kind: 'commit' }),
			mkRow({ author: 'someone-else', kind: 'pr' })
		];
		expect(myChangesCount(rows, 'octocat')).toBe(2);
	});
});

describe('orderHomeChangeRows (ruling 5 — stuck-first, then newest)', () => {
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
			prodLeadMs: null,
			frontierReason: null,
			frontierSince: null,
			...overrides
		};
	}

	it('puts every non-live-everywhere row ahead of every live-everywhere row', () => {
		const older = new Date(NOW.getTime() - 3600_000).toISOString();
		const rows = [
			mkRow({ title: 'live-newer', verdictTone: 'live', mergedAt: NOW.toISOString() }),
			mkRow({ title: 'stuck-older', verdictTone: 'held', mergedAt: older })
		];
		expect(orderHomeChangeRows(rows).map((r) => r.title)).toEqual(['stuck-older', 'live-newer']);
	});

	it('orders newest-first within each group', () => {
		const older = new Date(NOW.getTime() - 3600_000).toISOString();
		const rows = [
			mkRow({ title: 'older', verdictTone: 'held', mergedAt: older }),
			mkRow({ title: 'newer', verdictTone: 'held', mergedAt: NOW.toISOString() })
		];
		expect(orderHomeChangeRows(rows).map((r) => r.title)).toEqual(['newer', 'older']);
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

// ── ROUND 2, R2.1/R2.7 (LA ACCEPT) — `standingWords` IS ≤4 WORDS FOR EVERY
// ONE OF THE 12 CELL STATES. Builds a one-service, one-cell VM per `PrState`,
// runs it through the real production pipeline (`buildLandingGrid`, the same
// function `ChangeLine`/`ChangeCard` read), and asserts the word count — not
// a snapshot, per the accept criterion's own wording.
describe('standingWords — ≤4 words for every PrState', () => {
	const ALL_STATES: PrCell['state'][] = [
		'not-built',
		'gated',
		'pinned',
		'waiting-upstream',
		'queued',
		'promoting',
		'deploying',
		'baking',
		'retrying',
		'failed',
		'cancelled',
		'rolled-back',
		'live'
	];

	for (const state of ALL_STATES) {
		it(`"${state}" alone`, () => {
			const vm = mkVm([mkService('svc', [mkCell(state, { gateSubject: 'upstream-app' })])]);
			const verdict = changeVerdict(vm);
			const grid = buildLandingGrid(vm, new Date('2026-09-10T12:00:00Z'));
			const word = standingWords({ verdictTone: verdict.tone, grid });
			expect(word.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(4);
		});
	}

	it('reads "live everywhere" for an all-live change', () => {
		const vm = mkVm([mkService('a', [mkCell('live')]), mkService('b', [mkCell('live')])]);
		const grid = buildLandingGrid(vm, new Date());
		expect(standingWords({ verdictTone: 'live', grid })).toBe('live everywhere');
	});

	it('reads "not built yet" when a service exists but nothing has built', () => {
		const vm = mkVm([mkService('a', [mkCell('not-built')])]);
		const grid = buildLandingGrid(vm, new Date());
		expect(standingWords({ verdictTone: 'not-built', grid })).toBe('not built yet');
	});

	it('reads "not built here" with no matching service at all', () => {
		const grid = buildLandingGrid(mkVm([]), new Date());
		expect(standingWords({ verdictTone: 'not-built', grid })).toBe('not built here');
	});

	it('names the frontier family for a held (stuck) cell — "held in <family>"', () => {
		const vm = mkVm([mkService('a', [mkCell('gated', { envName: 'prod' })])]);
		const grid = buildLandingGrid(vm, new Date());
		expect(standingWords({ verdictTone: 'held', grid })).toBe('held in prd');
	});

	it('names the frontier family for a failed cell — "failed in <family>"', () => {
		const vm = mkVm([mkService('a', [mkCell('failed', { envName: 'dev' })])]);
		const grid = buildLandingGrid(vm, new Date());
		expect(standingWords({ verdictTone: 'failed', grid })).toBe('failed in dev');
	});
});

describe('standingWordsCompact', () => {
	it('folds to `<state> · <family>`, no separate verb tense to worry about', () => {
		const vm = mkVm([mkService('a', [mkCell('gated', { envName: 'prod' })])]);
		const grid = buildLandingGrid(vm, new Date());
		expect(standingWordsCompact({ verdictTone: 'held', grid })).toBe('held · prd');
	});

	it('is "live" (not "live everywhere") for the all-live case — the compact spelling', () => {
		const grid = buildLandingGrid(mkVm([mkService('a', [mkCell('live')])]), new Date());
		expect(standingWordsCompact({ verdictTone: 'live', grid })).toBe('live');
	});
});

// ── ROUND 2, R2.2 — `changesSummary`, `perRepoCounts`, `splitChangeSections` ─

function mkRows(overrides: Partial<ChangeRowVM>[]): ChangeRowVM[] {
	const base: ChangeRowVM = {
		owner: 'acme',
		repo: 'widget',
		repoKey: 'acme/widget',
		kind: 'pr',
		number: 1,
		title: 't',
		sha: 'a'.repeat(40),
		shortSha: 'aaaaaaa',
		href: '/changes/acme/widget/pull/1',
		htmlUrl: '',
		author: 'octocat',
		mergedAt: new Date('2026-09-01T00:00:00Z').toISOString(),
		verdictWord: 'live everywhere',
		verdictTone: 'live',
		grid: { services: [], allSameLabel: null, visible: [], overflow: null },
		notEverywhere: false,
		prodLeadMs: null,
		frontierReason: null,
		frontierSince: null
	};
	return overrides.map((o, i) => ({ ...base, number: i + 1, ...o }));
}

describe('changesSummary', () => {
	it('counts the merged feed, held and never-built rows', () => {
		const rows = mkRows([
			{ verdictTone: 'live' },
			{ verdictTone: 'held' },
			{ verdictTone: 'held' },
			{ verdictTone: 'not-built' }
		]);
		const s = changesSummary(rows);
		expect(s.mergedCount).toBe(4);
		expect(s.heldCount).toBe(2);
		expect(s.neverBuiltCount).toBe(1);
	});

	it('never computes a median from fewer than 3 prod-lead samples', () => {
		const rows = mkRows([{ prodLeadMs: 60_000 }, { prodLeadMs: 120_000 }]);
		expect(changesSummary(rows).typicalToProdMs).toBeNull();
	});

	it('computes the median once 3+ samples exist', () => {
		const rows = mkRows([{ prodLeadMs: 60_000 }, { prodLeadMs: 120_000 }, { prodLeadMs: 180_000 }]);
		expect(changesSummary(rows).typicalToProdMs).toBe(120_000);
	});
});

describe('perRepoCounts', () => {
	it('groups by repo, alphabetically, counting held per repo', () => {
		const rows = mkRows([
			{ repoKey: 'acme/zeta', repo: 'zeta', verdictTone: 'held' },
			{ repoKey: 'acme/alpha', repo: 'alpha', verdictTone: 'live' },
			{ repoKey: 'acme/alpha', repo: 'alpha', verdictTone: 'held' }
		]);
		expect(perRepoCounts(rows)).toEqual([
			{ repoKey: 'acme/alpha', label: 'alpha', count: 2, heldCount: 1 },
			{ repoKey: 'acme/zeta', label: 'zeta', count: 1, heldCount: 1 }
		]);
	});
});

describe('splitChangeSections', () => {
	it('splits into notEverywhere / liveEverywhere and orders failed-first within the first section', () => {
		const rows = mkRows([
			{ notEverywhere: true, verdictTone: 'not-built' },
			{ notEverywhere: true, verdictTone: 'failed' },
			{ notEverywhere: true, verdictTone: 'held' },
			{ notEverywhere: false, verdictTone: 'live' }
		]);
		const sections = splitChangeSections(rows);
		expect(sections.liveEverywhere).toHaveLength(1);
		expect(sections.notEverywhere).toHaveLength(3);
		expect(sections.notEverywhere.map((r) => r.verdictTone)).toEqual(['failed', 'held', 'not-built']);
	});
});

// ── HOME FEEDBACK PASS — `familyProgress` ─────────────────────────────────
//
// The human, on `YourChangesCard`: "I'd want to see at a glance whether
// they're progressing, how far, and whatnot. without showing every single
// environment." One step per FAMILY (dev/staging/prod), the worst mark
// across every service — never one mark per service/env cell.

describe('familyProgress', () => {
	it('orders steps DEV → STG → PRD and keeps the WORST mark across services for each family', () => {
		// #4-shaped: held in dev on one service, but a SECOND service is
		// already live in dev — the family step must read `held`, not
		// average the two or silently prefer whichever service came first.
		const vm = mkVm([
			mkService('hello-frontend-app', [
				mkCell('gated', { envName: 'dev', envRank: 0 }),
				mkCell('not-built', { envName: 'staging', envRank: 1 }),
				mkCell('not-built', { envName: 'prod', envRank: 2 })
			]),
			mkService('hello-api-app', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('not-built', { envName: 'staging', envRank: 1 }),
				mkCell('not-built', { envName: 'prod', envRank: 2 })
			])
		]);
		const grid = buildLandingGrid(vm, NOW);
		const steps = familyProgress({ grid });
		expect(steps.map((s) => s.family)).toEqual(['DEV', 'STG', 'PRD']);
		expect(steps[0]).toMatchObject({ family: 'DEV', tone: 'stuck', state: 'gated' });
		expect(steps[1]).toMatchObject({ family: 'STG', tone: 'none', state: 'not-built' });
		expect(steps[2]).toMatchObject({ family: 'PRD', tone: 'none', state: 'not-built' });
	});

	it('#3-shaped: live in dev, held in staging — DEV reads live, STG reads stuck', () => {
		const vm = mkVm([
			mkService('hello-api-app', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('waiting-upstream', { envName: 'staging', envRank: 1 }),
				mkCell('not-built', { envName: 'prod', envRank: 2 })
			])
		]);
		const grid = buildLandingGrid(vm, NOW);
		const steps = familyProgress({ grid });
		expect(steps.map((s) => `${s.family}:${s.tone}`)).toEqual(['DEV:live', 'STG:stuck', 'PRD:none']);
	});

	it('a service actively deploying/baking keeps its own PrState so the caller can split blue vs yellow', () => {
		const vm = mkVm([mkService('svc', [mkCell('deploying', { envName: 'dev', envRank: 0 })])]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		expect(steps).toEqual([
			expect.objectContaining({ family: 'DEV', tone: 'active', state: 'deploying' })
		]);
	});

	it('returns no steps for a row with no services (the ledger-fallback shape)', () => {
		expect(familyProgress({ grid: { services: [], allSameLabel: null, visible: [], overflow: null } })).toEqual(
			[]
		);
	});
});
