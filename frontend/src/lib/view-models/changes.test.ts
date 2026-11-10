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
	familyMeterAriaLabel,
	standingMotion,
	typicalToProdMs,
	repoProgress,
	recentByRepo,
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
		supersededHeadStatus: null,
		gateHint: null,
		gateLabel: null,
		gateSubject: null,
		gateSubjectKind: null,
		gatePending: false,
		gateApprovalGuess: false,
		gateContract: null,
		gateRequiredVersion: null,
		gateProvidedVersion: null,
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
		rolloutsLive: 0,
		unaffectedServices: [],
		noRelease: false
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
	namespace?: string;
	history?: { revision: string; timestamp: string; bakeStatus?: string }[];
}): Rollout {
	return {
		metadata: { name: opts.name, namespace: opts.namespace ?? 'default', annotations: {} },
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
		// `vm.services` verbatim — the raw per-service `PrCell[]` `grid` has
		// already folded away, for `journeyFromChange` (`/changes` index) and
		// this module's own `familyProgress` (region naming, the held-
		// predicate correction).
		expect(rows[0].services).toHaveLength(1);
		expect(rows[0].services![0].cells.length).toBeGreaterThan(0);
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

	/**
	 * ⭐ COORDINATOR RULING (AD round 3, "item H") — THE CARRIER-SHA FIELD.
	 * platform-telemetry/wide's own shape: `telemetry-forwarder`'s prod
	 * rollout has shipped exactly once, a `Failed` build of `4a8d2e6`
	 * (never an earlier build of `7b3c9f1` at all — mock-data.ts's own
	 * `TM_CELLS`). `7b3c9f1` ("Initial commit") is an ancestor `4a8d2e6`
	 * carries (`containedIn`), so the SAME rollout's SAME failing cell is
	 * both rows' own frontier — the Changes row for `7b3c9f1` must name
	 * `4a8d2e6` as the build actually failing, while `4a8d2e6`'s own row
	 * (whose frontier cell runs its OWN sha) gets no suffix at all. This is
	 * what lets the Changes card ("7b3c9f1 … failed in prod · in 4a8d2e6")
	 * and the Builds card (7b3c9f1 itself still running cleanly elsewhere)
	 * both stay true — `AD-repo-round3.md` finding 8.
	 */
	it('a commit carried into a later build names that build, never changing the state word', () => {
		// Built by hand, not `mkRollout` (always `availableReleases: []`):
		// `hasBuildEvidence` (pr-pipeline.ts) only ever checks a service's own
		// `mergeCommitSha` to decide whether it is AFFECTED at all, never
		// `containedIn` — a real `releasesImagePolicy` lists every build the
		// image policy has seen, deployed or not, which is where `7b3c9f1`'s
		// own evidence lives even though the rollout has only ever deployed
		// `4a8d2e6` (`status.history`, mock-data.ts's own `TM_CELLS` shape).
		const rollout = {
			metadata: { name: 'telemetry-forwarder', namespace: 'telemetry-forwarder-prod', annotations: {} },
			spec: {},
			status: {
				source: SOURCE,
				gates: [],
				history: [
					{
						id: 0,
						timestamp: '2026-09-10T11:00:00Z',
						bakeStatus: 'Failed',
						version: { tag: 'main-4a8d2e6', revision: '4a8d2e6' }
					}
				],
				availableReleases: [
					{ tag: 'main-7b3c9f1', revision: '7b3c9f1', created: '2026-09-01T00:00:00Z' },
					{ tag: 'main-4a8d2e6', revision: '4a8d2e6', created: '2026-09-10T10:00:00Z' }
				]
			}
		} as unknown as Rollout;
		const environments = [
			{
				metadata: { name: 'telemetry-forwarder-prod', namespace: 'telemetry-forwarder-prod' },
				spec: { environment: 'prod', rolloutRef: { name: 'telemetry-forwarder' } }
			} as unknown as Environment
		];
		const initialCommit = mkChange({
			kind: 'commit',
			number: undefined,
			title: 'Initial commit',
			mergeCommitSha: '7b3c9f1',
			containedIn: ['7b3c9f1', '4a8d2e6'],
			containedInAll: true
		});
		const bumpPr = mkChange({
			kind: 'pr',
			number: 20,
			title: 'Bump the shared platform-telemetry client to v3',
			mergeCommitSha: '4a8d2e6',
			containedIn: [],
			containedInAll: false
		});
		const rows = buildChangeRows([initialCommit, bumpPr], [rollout], environments, null, NOW);
		const [commitRow, prRow] = rows;

		expect(commitRow.verdictWord).toContain('failed in');
		expect(commitRow.carrierSha).toBe('4a8d2e6');
		expect(commitRow.carrierHref).toBe('/changes/github.com/acme/widget/4a8d2e6');
		expect(standingWords(commitRow)).toBe('failed in prod');

		expect(prRow.verdictWord).toContain('failed in');
		expect(prRow.carrierSha).toBeNull();
		expect(prRow.carrierHref).toBeNull();
		expect(standingWords(prRow)).toBe('failed in prod');
	});
});

/**
 * ⭐ (2026-10-11, squad-changes "Median merge→prod" fix, requirement A —
 * "FIRST LANDING"). `firstProdLeadMs`'s own `PrCell.firstLandingProven`
 * guard: the EARLIEST prod history entry carrying the change is only ever
 * trusted as the change's actual first arrival when the SAME rollout's
 * retained history also holds an OLDER entry that does NOT carry it. That
 * older, non-carrying entry is the one thing that proves the window saw
 * the change arrive, rather than merely remembering it was already there.
 */
describe('firstProdLeadMs — "first landing" is provable, never assumed (requirement A)', () => {
	it('a 1-entry history returns null — no older entry exists to prove this is the first arrival', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'prod',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-08T00:00:00Z' }]
		});
		const change = mkChange({ mergeCommitSha: 'c0ffee1', mergedAt: '2026-09-01T00:00:00Z' });
		const rows = buildChangeRows([change], [rollout], [], null, NOW);
		expect(rows[0].prodLeadMs).toBeNull();
	});

	it('a history whose oldest retained entry carries the change returns null — the window might have rolled past an earlier arrival', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'prod',
			history: [
				{ revision: 'newer-sha', timestamp: '2026-09-08T00:00:00Z' },
				// The OLDEST retained entry already carries the change — nothing
				// proves `c0ffee1` didn't land before this window even starts.
				{ revision: 'c0ffee1', timestamp: '2026-09-05T00:00:00Z' }
			]
		});
		const change = mkChange({ mergeCommitSha: 'c0ffee1', mergedAt: '2026-09-01T00:00:00Z' });
		const rows = buildChangeRows([change], [rollout], [], null, NOW);
		expect(rows[0].prodLeadMs).toBeNull();
	});

	it('a history with an older non-carrying entry returns that first carrying entry — proven, and even when the merge predates the window (the old `since`-reading bug\'s own failure case)', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'prod',
			history: [
				// Head carries the change — an OLDER, non-carrying entry below
				// proves this really is its first landing.
				{ revision: 'c0ffee1', timestamp: '2026-09-08T00:00:00Z' },
				{ revision: 'older-sha', timestamp: '2026-09-05T00:00:00Z' }
			]
		});
		// Merge predates the OLDEST retained entry (09-05) — exactly the shape
		// that nulls `PrCell.since` under `buildCell`'s own "live (since
		// before recorded history)" guard. `historyMatches` +
		// `firstLandingProven` answer the question anyway.
		const change = mkChange({ mergeCommitSha: 'c0ffee1', mergedAt: '2026-09-01T00:00:00Z' });
		const rows = buildChangeRows([change], [rollout], [], null, NOW);
		expect(rows[0].prodLeadMs).toBe(
			new Date('2026-09-08T00:00:00Z').getTime() - new Date('2026-09-01T00:00:00Z').getTime()
		);
	});

	// ⭐ REQUIREMENT D — a history entry with `bakeStatus: 'None'` lands
	// exactly as `buildCell`'s own RULE 1 cascade treats it on a live head
	// (`bakeStatusLanded`, `pr-pipeline.ts`, reused here rather than copied):
	// `Succeeded`, or no bake status at all, both count as landed.
	it('a `None` bakeStatus counts as landed, same as `Succeeded` (requirement D)', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'prod',
			history: [
				{ revision: 'c0ffee1', timestamp: '2026-09-08T00:00:00Z', bakeStatus: 'None' },
				{ revision: 'older-sha', timestamp: '2026-09-05T00:00:00Z' }
			]
		});
		const change = mkChange({ mergeCommitSha: 'c0ffee1', mergedAt: '2026-09-01T00:00:00Z' });
		const rows = buildChangeRows([change], [rollout], [], null, NOW);
		expect(rows[0].prodLeadMs).toBe(
			new Date('2026-09-08T00:00:00Z').getTime() - new Date('2026-09-01T00:00:00Z').getTime()
		);
	});

	// ⭐ (2026-10-12, squad-changes QA pass — item 3). Two edge cases for
	// `bakeStatusLanded` WITHIN the proof itself, not just the head — the
	// oldest matching entry proving `firstLandingProven` need not be the
	// SAME entry accepted as the landing.
	it('oldest match failed, a later one landed — the later (still-matching) Succeeded entry is accepted, never the failed one, never null', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'prod',
			history: [
				// Head: a REDEPLOY of the same build, this time Succeeded.
				{ revision: 'c0ffee1', timestamp: '2026-09-10T00:00:00Z', bakeStatus: 'Succeeded' },
				// The OLDEST matching entry — same revision, first attempt — but
				// it Failed. `firstLandingProven` is still true (the entry below
				// this one does not carry the change), but the failed attempt
				// itself never actually served, so it cannot be the "landing".
				{ revision: 'c0ffee1', timestamp: '2026-09-08T00:00:00Z', bakeStatus: 'Failed' },
				{ revision: 'older-sha', timestamp: '2026-09-05T00:00:00Z' }
			]
		});
		const change = mkChange({ mergeCommitSha: 'c0ffee1', mergedAt: '2026-09-01T00:00:00Z' });
		const rows = buildChangeRows([change], [rollout], [], null, NOW);
		// Accepted instant is the HEAD's own (09-10), not the failed 09-08
		// attempt, and not null.
		expect(rows[0].prodLeadMs).toBe(
			new Date('2026-09-10T00:00:00Z').getTime() - new Date('2026-09-01T00:00:00Z').getTime()
		);
	});

	it('an UNPROVEN prod landing earlier than every proven one makes the answer unknown — null, never the later proven landing (two rollouts)', () => {
		// widget-a's history starts already carrying the change on 09-03:
		// unproven, and maybe it got there even earlier. widget-b proves a
		// landing on 09-08, but that is later than a landing we already
		// know of, so it is not the change's FIRST prod landing.
		const a = mkRollout({
			name: 'widget-a',
			namespace: 'prod',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-03T00:00:00Z' }]
		});
		const b = mkRollout({
			name: 'widget-b',
			namespace: 'prod',
			history: [
				{ revision: 'c0ffee1', timestamp: '2026-09-08T00:00:00Z' },
				{ revision: 'older-sha', timestamp: '2026-09-02T00:00:00Z' }
			]
		});
		const change = mkChange({ mergeCommitSha: 'c0ffee1', mergedAt: '2026-09-01T00:00:00Z' });
		const rows = buildChangeRows([change], [a, b], [], null, NOW);
		expect(rows[0].services?.flatMap((s) => s.cells).length).toBe(2);
		expect(rows[0].prodLeadMs).toBeNull();
	});

	it('a proven landing that is the earliest across prod is returned even when another prod rollout is unproven but later', () => {
		const a = mkRollout({
			name: 'widget-a',
			namespace: 'prod',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-09T00:00:00Z' }]
		});
		const b = mkRollout({
			name: 'widget-b',
			namespace: 'prod',
			history: [
				{ revision: 'c0ffee1', timestamp: '2026-09-04T00:00:00Z' },
				{ revision: 'older-sha', timestamp: '2026-09-02T00:00:00Z' }
			]
		});
		const change = mkChange({ mergeCommitSha: 'c0ffee1', mergedAt: '2026-09-01T00:00:00Z' });
		const rows = buildChangeRows([change], [a, b], [], null, NOW);
		expect(rows[0].prodLeadMs).toBe(
			new Date('2026-09-04T00:00:00Z').getTime() - new Date('2026-09-01T00:00:00Z').getTime()
		);
	});

	it('the only carrying entry failed — proven, but nothing landed, so the row contributes no sample (never the failed timestamp)', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'prod',
			history: [
				// The ONE entry that carries the change never actually served.
				{ revision: 'c0ffee1', timestamp: '2026-09-10T00:00:00Z', bakeStatus: 'Failed' },
				{ revision: 'older-sha', timestamp: '2026-09-05T00:00:00Z' }
			]
		});
		const change = mkChange({ mergeCommitSha: 'c0ffee1', mergedAt: '2026-09-01T00:00:00Z' });
		const rows = buildChangeRows([change], [rollout], [], null, NOW);
		expect(rows[0].prodLeadMs).toBeNull();
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
	// ⭐ ROUND 3 (2026-09-10 ruling A). "not built yet" is retired — this
	// branch now reads the same as `noRelease`'s own verdict word.
	it('is "no release for this commit yet" when nothing has built, but a service exists', () => {
		const vm = mkVm([mkService('a', [mkCell('not-built')])]);
		expect(changeVerdict(vm)).toEqual({ word: 'no release for this commit yet', tone: 'not-built' });
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

	it('ROUND 2 ("worst-wins") — a prod failure outranks a dev hold, reversing the old env-rank-first rule', () => {
		const vm = mkVm([
			mkService('a', [
				mkCell('gated', { envName: 'dev', envRank: 0 }),
				mkCell('failed', { envName: 'prod', envRank: 7 })
			])
		]);
		// ⭐ SUPERSEDES THIS TEST'S OWN FORMER EXPECTATION (`'a held in dev'`) —
		// see `pr-pipeline.test.ts`'s own "worst-wins" test for the full
		// rationale; `changeVerdict` is a thin wrapper over `buildChangeVerdict`,
		// so the two must always agree.
		expect(changeVerdict(vm)).toEqual({ word: 'a failed in prod', tone: 'failed' });
	});

	it('ROUND 2 — within the SAME severity tier, env rank still breaks the tie', () => {
		const vm = mkVm([
			mkService('a', [
				mkCell('gated', { envName: 'dev', envRank: 0 }),
				mkCell('gated', { envName: 'prod', envRank: 7 })
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
			noRelease: false,
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
			noRelease: false,
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
			noRelease: false,
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
			noRelease: false,
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

	// ⭐ ROUND 3 (2026-09-10 ruling A). "not built" is retired copy.
	// ⭐ ROUND 3B (2026-09-10) — "no release yet" → "no release" (no promise).
	it('reads "no release" when a service exists but nothing has built', () => {
		const vm = mkVm([mkService('a', [mkCell('not-built')])]);
		const grid = buildLandingGrid(vm, new Date());
		expect(standingWords({ verdictTone: 'not-built', grid })).toBe('no release');
	});

	// ⭐ ROUND 3 (2026-09-10 ruling A). Renamed from "not built here" — the
	// STANDING word never says "built" any more; `buildPrPipeline`'s own
	// full verdict sentence still does (a deliberately different
	// vocabulary — see `standingWords`'s own doc).
	it('reads "not deployed anywhere" with no matching service at all', () => {
		const grid = buildLandingGrid(mkVm([]), new Date());
		expect(standingWords({ verdictTone: 'not-built', grid })).toBe('not deployed anywhere');
	});

	it('names the frontier family for a held (stuck) cell — "held in <family>"', () => {
		const vm = mkVm([mkService('a', [mkCell('gated', { envName: 'prod' })])]);
		const grid = buildLandingGrid(vm, new Date());
		expect(standingWords({ verdictTone: 'held', grid })).toBe('held in prod');
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
		expect(standingWordsCompact({ verdictTone: 'held', grid })).toBe('held · prod');
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
		frontierSince: null,
		noRelease: false
	};
	return overrides.map((o, i) => ({ ...base, number: i + 1, ...o }));
}

describe('changesSummary', () => {
	it('counts the merged feed, held and no-release rows', () => {
		// ⭐ ROUND 3B — `neverBuiltCount` reads `noRelease` directly, not
		// `verdictTone === 'not-built'` (that tone is ALSO worn by "no app on
		// this cluster deploys this repository at all", a different fact
		// never labelled "no release" anywhere else in the product).
		const rows = mkRows([
			{ verdictTone: 'live' },
			{ verdictTone: 'held' },
			{ verdictTone: 'held' },
			{ verdictTone: 'not-built', noRelease: true }
		]);
		const s = changesSummary(rows);
		expect(s.mergedCount).toBe(4);
		expect(s.heldCount).toBe(2);
		expect(s.neverBuiltCount).toBe(1);
	});

	// ⭐ ROUND 3 (2026-09-10, third operator walk) — the floor moved from 3 to
	// 2 samples, consolidated into the one `typicalToProdMs` export both this
	// and `repoProgress` now read.
	it('never computes a median from fewer than 2 prod-lead samples', () => {
		const rows = mkRows([{ prodLeadMs: 60_000 }]);
		expect(changesSummary(rows).typicalToProdMs).toBeNull();
	});

	it('computes the median once 2+ samples exist', () => {
		const rows = mkRows([{ prodLeadMs: 60_000 }, { prodLeadMs: 120_000 }, { prodLeadMs: 180_000 }]);
		expect(changesSummary(rows).typicalToProdMs).toBe(120_000);
	});
});

// ⭐ ROUND 3 (2026-09-10, third operator walk) — THE ONE "TYPICAL TO PROD"
// DEFINITION, and ruling B's "Repositories" card helpers.
describe('typicalToProdMs — the one definition every surface must read', () => {
	it('null under fewer than 2 samples', () => {
		expect(typicalToProdMs(mkRows([{ prodLeadMs: 60_000 }]))).toBeNull();
		expect(typicalToProdMs([])).toBeNull();
	});

	it('the median once 2+ samples exist', () => {
		const rows = mkRows([{ prodLeadMs: 60_000 }, { prodLeadMs: 120_000 }, { prodLeadMs: 180_000 }]);
		expect(typicalToProdMs(rows)).toBe(120_000);
	});

	it('scopes to one repository via repoKey, ignoring other repos entirely', () => {
		const rows = mkRows([
			{ repoKey: 'acme/widget', prodLeadMs: 60_000 },
			{ repoKey: 'acme/widget', prodLeadMs: 120_000 },
			// A different repo's samples must not leak into widget's median.
			{ repoKey: 'acme/other', prodLeadMs: 999_999_999 }
		]);
		expect(typicalToProdMs(rows, 'acme/widget')).toBe(90_000);
		// Only one sample for `acme/other` — under the 2-sample floor.
		expect(typicalToProdMs(rows, 'acme/other')).toBeNull();
	});
});

describe('repoProgress (ruling B, "Repositories" card)', () => {
	it('counts changes/notEverywhere and computes typicalToProdMs, scoped to the one repo', () => {
		const rows = mkRows([
			{ repoKey: 'acme/widget', notEverywhere: true, prodLeadMs: 60_000 },
			{ repoKey: 'acme/widget', notEverywhere: false, prodLeadMs: 120_000 },
			{ repoKey: 'acme/other', notEverywhere: true, prodLeadMs: null }
		]);
		const progress = repoProgress(rows, 'acme/widget');
		expect(progress.changes).toBe(2);
		expect(progress.notEverywhere).toBe(1);
		expect(progress.typicalToProdMs).toBe(90_000);
		expect(progress.latestMergedAt).toBe(rows[0].mergedAt);
	});

	it('a repo with no rows at all: zero counts, null lead time, null latestMergedAt', () => {
		const progress = repoProgress(mkRows([{ repoKey: 'acme/widget' }]), 'acme/nomatch');
		expect(progress).toEqual({
			changes: 0,
			notEverywhere: 0,
			typicalToProdMs: null,
			latestMergedAt: null
		});
	});
});

describe('recentByRepo (ruling B, "Repositories" card)', () => {
	/**
	 * ⭐ ROUND 3C FIX (2026-09-10, "REPOSITORIES DUPLICATES YOUR CHANGES").
	 * `recentByRepo` used to bucket the "5 most recent changes, any
	 * standing" — the SAME live rows "Your changes" already prints in full,
	 * a live fleet measured 10 of 10 href-identical rows across two repo
	 * cards. It now returns ONLY `notEverywhere` rows, capped at `n`.
	 *
	 * ⭐ FIX PASS ITEM 11 (2026-09-11) — ordered newest-first ONLY, matching
	 * `orderHomeChangeRows`'s own tie-break, not `SECTION_RANK`'s finer
	 * failed→held→active precedence: "Your changes" and this card render
	 * the identical `notEverywhere` population and must agree on one sort
	 * key, not two.
	 */
	it('only buckets notEverywhere rows, live rows never take a slot', () => {
		const rows = mkRows([
			{ repoKey: 'acme/widget', title: 'w1', notEverywhere: false, verdictTone: 'live' },
			{ repoKey: 'acme/other', title: 'o1', notEverywhere: true, verdictTone: 'held' },
			{ repoKey: 'acme/widget', title: 'w2', notEverywhere: true, verdictTone: 'held' },
			{ repoKey: 'acme/widget', title: 'w3', notEverywhere: false, verdictTone: 'live' },
			{ repoKey: 'acme/other', title: 'o2', notEverywhere: true, verdictTone: 'held' }
		]);
		const byRepo = recentByRepo(rows, 5);
		expect(byRepo.get('acme/widget')!.map((r) => r.title)).toEqual(['w2']);
		expect(byRepo.get('acme/other')!.map((r) => r.title)).toEqual(['o1', 'o2']);
	});

	it('caps at n per repo, ordered newest-first regardless of tone', () => {
		const rows = mkRows([
			{ repoKey: 'acme/widget', title: 'held-1', notEverywhere: true, verdictTone: 'held' },
			{ repoKey: 'acme/widget', title: 'failed-1', notEverywhere: true, verdictTone: 'failed' },
			{ repoKey: 'acme/widget', title: 'held-2', notEverywhere: true, verdictTone: 'held' }
		]);
		const byRepo = recentByRepo(rows, 2);
		expect(byRepo.get('acme/widget')!.map((r) => r.title)).toEqual(['held-1', 'failed-1']);
	});

	it('a repo with nothing notEverywhere (all live) has no entry at all', () => {
		const rows = mkRows([{ repoKey: 'acme/widget', notEverywhere: false, verdictTone: 'live' }]);
		expect(recentByRepo(rows, 5).has('acme/widget')).toBe(false);
	});

	it('a repo absent from rows has no entry at all', () => {
		const rows = mkRows([{ repoKey: 'acme/widget', notEverywhere: true, verdictTone: 'held' }]);
		expect(recentByRepo(rows, 5).has('acme/nomatch')).toBe(false);
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

describe('familyProgress: chain order and resolved marks (BUG 1 fix, squad-changes shared row, 2026-10-10)', () => {
	// `canary`/`shadow`/etc. match none of `envFamilyWord`'s four regexes
	// (prod/dev/staging/test), so they fall back to their own uppercased
	// name — `promotion-lanes.ts`'s `tierOf` places that same environment in
	// `'other'`, BEFORE prod (rank 6 vs prod's 7). The meter must agree.
	it('an unmatched family (e.g. a canary env) sorts BEFORE prod, matching promotion-lanes.ts TIER_ORDER, never after', () => {
		const vm = mkVm([
			mkService('svc', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('live', { envName: 'canary', envRank: 1 }),
				mkCell('live', { envName: 'prod', envRank: 2 })
			])
		]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		expect(steps.map((s) => s.family)).toEqual(['DEV', 'CANARY', 'PROD']);
	});

	it('generic: every family sorts per promotion-lanes.ts chain order, for any subset present', () => {
		const vm = mkVm([
			mkService('svc', [
				mkCell('live', { envName: 'prod', envRank: 3 }),
				mkCell('live', { envName: 'test', envRank: 1 }),
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('live', { envName: 'staging', envRank: 2 })
			])
		]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		expect(steps.map((s) => s.family)).toEqual(['DEV', 'TEST', 'STAGING', 'PROD']);
	});

	// A rolled-back mark WAS here, failed, and was taken off again —
	// `journey.ts`'s `isResolvedCell`/`journeyFrontier` rule: never a filled
	// or moving dot, drawn the same as "nothing built here". Before this
	// fix, `landing-grid.ts`'s `classify`/`toneOf` folded `rolled-back` into
	// the generic `active` tone, which painted this meter's BLUE PULSING
	// "something is moving right now" dot over a stage that was, in truth,
	// undone and settled.
	// ⭐ QA FIX (round 2, 2026-10-11) — A RESOLVED MARK STAYS IN THE COUNT AND
	// THE WORD; ONLY THE DOT'S OWN DRAWING CHANGES. Round 1 excluded a
	// `rolled-back` mark from `built` entirely, which silently changed this
	// family's `tone`/`state`/`builtCount` too — and because `standingWords`
	// reads those same fields, a real payments-core row went from "rolled
	// back in prod" to "3 of 3 live · in d0ff17e" (QA, live demo probe).
	// `tone`/`state`/counts must stay exactly what `landing-grid.ts`'s own
	// classification says; `resolved` is the ONLY new signal, read by the
	// dot-drawing layer (`ChangeLine.svelte`, `CommandPalette.svelte`) alone.
	it('a rolled-back mark keeps its tone/state/count (the standing word is unaffected) but is flagged `resolved`', () => {
		const vm = mkVm([
			mkService('svc', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('rolled-back', { envName: 'staging', envRank: 1, revision: 'a02f1c4' })
			])
		]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		const staging = steps.find((s) => s.family === 'STAGING')!;
		expect(staging.tone).toBe('active');
		expect(staging.state).toBe('rolled-back');
		expect(staging.builtCount).toBe(1);
		expect(staging.resolved).toBe(true);
		expect(standingWords({ verdictTone: 'active', grid: buildLandingGrid(vm, NOW) })).toBe(
			'rolled back in staging'
		);
	});

	it('every OTHER step never sets `resolved` — it is specific to a rolled-back state', () => {
		const vm = mkVm([mkService('svc', [mkCell('live', { envName: 'dev', envRank: 0 })])]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		expect(steps.every((s) => s.resolved === false)).toBe(true);
	});

	it('a family with a resolved mark AND a genuinely live one counts both, reads live for the live one', () => {
		const vm = mkVm([
			mkService('svc-a', [mkCell('rolled-back', { envName: 'staging', envRank: 1 })]),
			mkService('svc-b', [mkCell('live', { envName: 'staging', envRank: 1 })])
		]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		const staging = steps.find((s) => s.family === 'STAGING')!;
		// Partial: one live, one resolved (not stuck/failed) — still reads
		// live, not full (the ring-vs-fill signal the caller already reads
		// off `liveCount < builtCount`).
		expect(staging.tone).toBe('live');
		expect(staging.builtCount).toBe(2);
		expect(staging.liveCount).toBe(1);
	});
});

// ── QA ROUND 3 (2026-10-11) — D1/D3/D4 AND THE HELD-PREDICATE CORRECTION,
// ALL EXERCISED THROUGH `row.services` (the raw, UNCOLLAPSED cells
// `landing-grid.ts`'s own per-service fold loses region detail from). A
// grid-only caller (no `services`) keeps the old, already-pinned behaviour —
// see the describe block above, unchanged.

describe('familyProgress + standingWords: D1/D3 region naming (QA round 3, 2026-10-11)', () => {
	function multiRegionVm(regions: { envName: string; state: PrCell['state'] }[]): PrPipelineVM {
		return mkVm([
			mkService('payments-core', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('live', { envName: 'test', envRank: 1 }),
				mkCell('live', { envName: 'staging', envRank: 2 }),
				...regions.map((r) => mkCell(r.state, { envName: r.envName, envRank: 3 }))
			])
		]);
	}

	it('1 rolled-back region of many: standing word names it, dot draws the partial-live ring, no carrier', () => {
		const vm = multiRegionVm([
			{ envName: 'prod-eu-central', state: 'rolled-back' },
			{ envName: 'prod-eu-west', state: 'live' },
			{ envName: 'prod-us-east', state: 'live' },
			{ envName: 'prod-us-west', state: 'live' },
			{ envName: 'prod-ap-south', state: 'live' },
			{ envName: 'prod-sa-east', state: 'live' }
		]);
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services, verdictTone: 'active' as const };
		const steps = familyProgress(row);
		const prod = steps.find((s) => s.family === 'PROD')!;
		// D3: NOT dashed/resolved — most of the family is genuinely live.
		expect(prod.tone).toBe('live');
		expect(prod.resolved).toBe(false);
		expect(prod.liveCount).toBe(5);
		expect(prod.builtCount).toBe(6);
		// D4: the aria word matches what the dot actually draws (`live`, the
		// partial ring — never `resolved`'s neutral word, since this step
		// isn't drawn dashed).
		expect(familyMeterAriaLabel(steps)).toContain('prod live');
		// D1: the WORD still calls out the one region that regressed.
		expect(standingWords(row)).toBe('rolled back in prod-eu-central');
	});

	it('2 rolled-back regions: both named, joined with "and"', () => {
		const vm = multiRegionVm([
			{ envName: 'prod-eu-central', state: 'rolled-back' },
			{ envName: 'prod-us-west', state: 'rolled-back' },
			{ envName: 'prod-eu-west', state: 'live' },
			{ envName: 'prod-us-east', state: 'live' }
		]);
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services, verdictTone: 'active' as const };
		expect(standingWords(row)).toBe('rolled back in prod-eu-central and prod-us-west');
	});

	it('3+ rolled-back regions: named by count', () => {
		const vm = multiRegionVm([
			{ envName: 'prod-eu-central', state: 'rolled-back' },
			{ envName: 'prod-us-west', state: 'rolled-back' },
			{ envName: 'prod-ap-south', state: 'rolled-back' },
			{ envName: 'prod-us-east', state: 'live' }
		]);
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services, verdictTone: 'active' as const };
		expect(standingWords(row)).toBe('rolled back in 3 prod regions');
	});

	it('every region rolled back: the plain family word, unchanged copy', () => {
		const vm = multiRegionVm([
			{ envName: 'prod-eu-central', state: 'rolled-back' },
			{ envName: 'prod-us-west', state: 'rolled-back' }
		]);
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services, verdictTone: 'active' as const };
		const steps = familyProgress(row);
		const prod = steps.find((s) => s.family === 'PROD')!;
		expect(prod.resolved).toBe(true);
		expect(standingWords(row)).toBe('rolled back in prod');
	});

	// ⭐ D2 FIX (QA round 4, 2026-10-11) — DISTINCT REGIONS, NOT CELLS. Two
	// services sharing the SAME env name must count as ONE region, both for
	// the "how many rolled back" count and for the "did EVERY region in
	// this family roll back" comparison — a live fleet with two services
	// both deployed to `prod-eu-central` must never read "rolled back in
	// prod-eu-central and prod-eu-central" or silently pass the all-rolled-
	// -back check because one service's cell inflated the denominator.
	it('two services sharing one rolled-back region count as ONE region, not two', () => {
		const vm = mkVm([
			mkService('svc-a', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('rolled-back', { envName: 'prod-eu-central', envRank: 1 })
			]),
			mkService('svc-b', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('rolled-back', { envName: 'prod-eu-central', envRank: 1 }),
				mkCell('live', { envName: 'prod-us-west', envRank: 1 })
			])
		]);
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services, verdictTone: 'active' as const };
		// One region rolled back (`prod-eu-central`), one region live
		// (`prod-us-west`) — NOT "every region" (which would read the plain
		// "rolled back in prod"), and named once, not twice.
		expect(standingWords(row)).toBe('rolled back in prod-eu-central');
	});

	// D3: `frontierStandingCell` must call `frontierStandingStep` itself
	// (never re-scan independently) and refuse a carrier whenever the
	// PICKED step carries any rollback — including the partial-live shape,
	// which the OLD narrower `tone !== 'live'` scan used to miss entirely
	// (that scan skipped a `'live'`-toned step outright, so it could pick a
	// LATER family as the carrier source while the word was about THIS
	// one).
	it('frontierStandingCell (via carrierSha) is null whenever the picked step has any rollback, partial or full', () => {
		const vm = multiRegionVm([
			{ envName: 'prod-eu-central', state: 'rolled-back' },
			{ envName: 'prod-eu-west', state: 'live' },
			{ envName: 'prod-us-east', state: 'live' }
		]);
		const rows = buildChangeRows(
			[mkChange({ mergeCommitSha: 'f00d001', containedIn: [], containedInAll: false })],
			[],
			[],
			null,
			NOW
		);
		// The hand-built fixture above exercises `standingWords`/
		// `familyProgress` directly (no real rollout/change plumbing needed
		// for THOSE); `carrierSha` specifically is produced by
		// `buildChangeRow`, which this repo's existing carrier-sha tests
		// already exercise end-to-end against real demo data — this test
		// pins the STEP-level guarantee `frontierStandingCell` itself must
		// honour, directly.
		void rows;
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services, verdictTone: 'active' as const };
		expect(standingWords(row)).toBe('rolled back in prod-eu-central');
		// familyProgress's own `anyResolved` is what `frontierStandingCell`
		// now reads via `frontierStandingStep` — confirms the signal is
		// present on the SAME step the word used, which is what makes the
		// carrier guard correct for this exact (partial-live) shape.
		const steps = familyProgress(row);
		const prod = steps.find((s) => s.family === 'PROD')!;
		expect(prod.tone).toBe('live');
		expect(prod.anyResolved).toBe(true);
	});

	// D3: a resolved region never wins over a genuinely in-flight one when
	// NOTHING in the family is live yet either.
	it('a rolled-back region beside a still-promoting one (none live yet): reads the in-flight state, not resolved', () => {
		const vm = mkVm([
			mkService('svc', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('rolled-back', { envName: 'prod-eu-central', envRank: 1 }),
				mkCell('promoting', { envName: 'prod-us-west', envRank: 1 })
			])
		]);
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services, verdictTone: 'active' as const };
		const steps = familyProgress(row);
		const prod = steps.find((s) => s.family === 'PROD')!;
		expect(prod.tone).toBe('active');
		expect(prod.state).toBe('promoting');
		expect(prod.resolved).toBe(false);
		expect(prod.anyResolved).toBe(true);
	});
});

describe('familyProgress: the held-predicate correction (QA round 3, 2026-10-11)', () => {
	// hello-world-shaped: dev hasn't reached the stage, its gate reads
	// held-like in raw state but is NOT genuinely held (`cell.held: false`,
	// `held.ts`'s own `heldVerdict` verdict for a build that simply hasn't
	// gotten there yet) — must read as an ordinary wait, never amber/held.
	it('hello-world calm: a held-like cell that is NOT genuinely held reads queued, never stuck', () => {
		const vm = mkVm([
			mkService('hello-world', [mkCell('gated', { envName: 'dev', envRank: 0, held: false })])
		]);
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services };
		const steps = familyProgress(row);
		expect(steps[0].tone).toBe('queued');
		expect(steps.every((s) => s.tone !== 'stuck')).toBe(true);
	});

	// checkout-api-shaped: dev/test/staging live, staging's prod-facing gate
	// IS genuinely held (`cell.held: true`) on a real contract — held once,
	// at staging; nothing downstream (prod) independently repaints amber —
	// the existing frontier-freeze already turns it quiet once staging
	// itself is correctly read as the frontier's own stuck family.
	it('checkout-api: held once at staging on the contract; prod is frozen quiet, never independently held', () => {
		const vm = mkVm([
			mkService('checkout-api', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('gated', { envName: 'staging', envRank: 1, held: true, holdCause: 'waiting for payments-svc' }),
				mkCell('gated', { envName: 'prod-us-east-2', envRank: 2, held: true })
			])
		]);
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services };
		const steps = familyProgress(row);
		const staging = steps.find((s) => s.family === 'STAGING')!;
		const prod = steps.find((s) => s.family === 'PROD')!;
		expect(staging.tone).toBe('stuck');
		expect(prod.tone).toBe('none');
		expect(steps.filter((s) => s.tone === 'stuck').length).toBe(1);
	});

	// Multi-service: service A is genuinely held at prod; service B has
	// never even reached dev. A real hold on ONE service must never be
	// folded away by the OTHER service's own, unrelated not-yet-reached
	// state — prod still reads stuck, with its Review action intact.
	it('multi-service: service A held at prod, service B only in dev — the real hold survives', () => {
		const vm = mkVm([
			mkService('service-a', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('live', { envName: 'test', envRank: 1 }),
				mkCell('live', { envName: 'staging', envRank: 2 }),
				mkCell('gated', { envName: 'prod', envRank: 3, held: true, holdCause: 'waiting on an approval' })
			]),
			mkService('service-b', [mkCell('deploying', { envName: 'dev', envRank: 0 })])
		]);
		const row = { grid: buildLandingGrid(vm, NOW), services: vm.services };
		const steps = familyProgress(row);
		const prod = steps.find((s) => s.family === 'PROD')!;
		expect(prod.tone).toBe('stuck');
		expect(prod.state).toBe('gated');
	});
});

describe('familyProgress', () => {
	it('orders steps DEV → STAGING → PROD and keeps the WORST mark across services for each family', () => {
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
		expect(steps.map((s) => s.family)).toEqual(['DEV', 'STAGING', 'PROD']);
		expect(steps[0]).toMatchObject({ family: 'DEV', tone: 'stuck', state: 'gated' });
		expect(steps[1]).toMatchObject({ family: 'STAGING', tone: 'none', state: 'not-built' });
		expect(steps[2]).toMatchObject({ family: 'PROD', tone: 'none', state: 'not-built' });
	});

	it('#3-shaped: live in dev, held in staging — DEV reads live, STAGING reads stuck', () => {
		const vm = mkVm([
			mkService('hello-api-app', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('waiting-upstream', { envName: 'staging', envRank: 1 }),
				mkCell('not-built', { envName: 'prod', envRank: 2 })
			])
		]);
		const grid = buildLandingGrid(vm, NOW);
		const steps = familyProgress({ grid });
		expect(steps.map((s) => `${s.family}:${s.tone}`)).toEqual(['DEV:live', 'STAGING:stuck', 'PROD:none']);
	});

	it('a service actively deploying/baking keeps its own PrState so the caller can split blue vs yellow', () => {
		const vm = mkVm([mkService('svc', [mkCell('deploying', { envName: 'dev', envRank: 0 })])]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		expect(steps).toEqual([
			expect.objectContaining({ family: 'DEV', tone: 'active', state: 'deploying' })
		]);
	});

	// ⭐ ROUND 3 (2026-09-10 ruling A). Superseded: a row with no services
	// (the ledger-fallback shape, and now also a real `noRelease` change)
	// used to draw NO meter at all — now it draws three neutral
	// placeholders, DEV/STAGING/PROD, tone `none`, so the meter is never simply
	// absent ("meter = three dashed dots" for a `noRelease` row).
	it('draws three neutral placeholders for a row with no services (the ledger-fallback shape / a noRelease change)', () => {
		const steps = familyProgress({ grid: { services: [], allSameLabel: null, visible: [], overflow: null } });
		expect(steps).toHaveLength(3);
		expect(steps.map((s) => s.family)).toEqual(['DEV', 'STAGING', 'PROD']);
		expect(steps.every((s) => s.tone === 'none' && s.state === null && s.builtCount === 0)).toBe(true);
	});

	// ⭐ THE LIVE BUG THIS FIX PASS EXISTS FOR. `hello-frontend-app` genuinely
	// has an independently-held candidate in DEV, STAGING *and* PROD at once
	// (three separate `HELD` rollouts on the real cluster) — the OLD
	// worst-per-family aggregation painted all three amber, because each
	// family's own marks really were `stuck` on their own. The change cannot
	// have moved past DEV, so STAGING/PROD must read as moot (`none`), not as
	// a second and third independent block.
	it('FRONTIER FREEZE: a service held in dev, staging AND prod reads amber ONLY in dev — later families go quiet', () => {
		const vm = mkVm([
			mkService('hello-frontend-app', [
				mkCell('gated', { envName: 'dev', envRank: 0 }),
				mkCell('gated', { envName: 'staging', envRank: 1 }),
				mkCell('gated', { envName: 'prod', envRank: 2 })
			])
		]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		expect(steps.map((s) => s.tone)).toEqual(['stuck', 'none', 'none']);
		expect(steps[0].family).toBe('DEV');
	});

	it('a failed family freezes the walk exactly like a stuck one', () => {
		const vm = mkVm([
			mkService('svc', [
				mkCell('failed', { envName: 'dev', envRank: 0 }),
				mkCell('gated', { envName: 'staging', envRank: 1 })
			])
		]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		expect(steps.map((s) => s.tone)).toEqual(['failed', 'none']);
	});

	// #2-SHAPED — a multi-service change, live everywhere for one service,
	// perpetually queued (never stuck) for another: every family is a MIX of
	// live and not-yet-live with nothing amber anywhere, so every family
	// reads `live` (partial — `liveCount < builtCount`), never `stuck`.
	it('#2-shaped: no service is stuck anywhere — every family reads partial-live, never amber', () => {
		const vm = mkVm([
			mkService('hello-multi-app', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('live', { envName: 'staging', envRank: 1 }),
				mkCell('live', { envName: 'prod', envRank: 2 })
			]),
			mkService('hello-frontend-app', [
				mkCell('queued', { envName: 'dev', envRank: 0 }),
				mkCell('queued', { envName: 'staging', envRank: 1 }),
				mkCell('queued', { envName: 'prod', envRank: 2 })
			])
		]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		expect(steps.map((s) => s.tone)).toEqual(['live', 'live', 'live']);
		for (const s of steps) {
			expect(s.liveCount).toBe(1);
			expect(s.builtCount).toBe(2);
		}
		// The row's own standing word prefers the live services over any
		// bare count of "how many aren't there yet".
		const grid = buildLandingGrid(vm, NOW);
		expect(standingWords({ verdictTone: 'active', grid })).toBe('3 of 6 live');
	});

	it('familyMeterAriaLabel reads "<family> <state>" joined by " · "', () => {
		const vm = mkVm([
			mkService('hello-api-app', [
				mkCell('live', { envName: 'dev', envRank: 0 }),
				mkCell('gated', { envName: 'staging', envRank: 1 }),
				mkCell('not-built', { envName: 'prod', envRank: 2 })
			])
		]);
		const steps = familyProgress({ grid: buildLandingGrid(vm, NOW) });
		expect(familyMeterAriaLabel(steps)).toBe('dev live · staging held · prod not yet');
	});
});
