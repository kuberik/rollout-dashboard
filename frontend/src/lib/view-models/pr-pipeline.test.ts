import { describe, it, expect } from 'vitest';
import { buildPrPipeline, buildChangeVerdict, type PrPipelineMeta, type PrCell, type PrService } from './pr-pipeline';
import { frontierUsuallyLabelForCell } from '$lib/pr-cell-copy';
import type { Rollout, Environment } from '$lib/../types';

const SOURCE_CLUSTER = 'rollout-dashboard.kuberik.com/source-cluster';
const SOURCE = 'github.com/acme/widget';
const NOW = new Date('2026-09-10T12:00:00Z');

function meta(overrides: Partial<PrPipelineMeta> = {}): PrPipelineMeta {
	return {
		owner: 'acme',
		repo: 'widget',
		number: 42,
		mergedAt: '2026-09-01T00:00:00Z',
		mergeCommitSha: 'c0ffee1',
		containedIn: ['c0ffee1'],
		containedInAll: true,
		...overrides
	};
}

type HistoryFixture = {
	revision?: string;
	tag?: string;
	version?: string;
	timestamp: string;
	bakeStatus?: string;
	bakeStartTime?: string;
	bakeEndTime?: string;
	bakeStatusMessage?: string;
	message?: string;
};

type ReleaseFixture = {
	tag?: string;
	revision?: string;
	version?: string;
	created?: string;
	metadataUnresolved?: boolean;
};

function mkRollout(opts: {
	name: string;
	namespace: string;
	cluster?: string;
	source?: string;
	wantedVersion?: string;
	bakeTime?: string;
	deployTimeout?: string;
	gates?: { name: string; passing?: boolean; allowedVersions?: string[] | null }[];
	history?: HistoryFixture[];
	availableReleases?: ReleaseFixture[];
}): Rollout {
	const status: any = {
		source: opts.source ?? SOURCE,
		gates: opts.gates ?? [],
		history: (opts.history ?? []).map((h, i) => ({
			id: i,
			timestamp: h.timestamp,
			bakeStatus: h.bakeStatus,
			bakeStartTime: h.bakeStartTime,
			bakeEndTime: h.bakeEndTime,
			bakeStatusMessage: h.bakeStatusMessage,
			message: h.message,
			version: { tag: h.tag ?? h.revision ?? 'tag', version: h.version, revision: h.revision }
		})),
		availableReleases: (opts.availableReleases ?? []).map((r) => ({
			tag: r.tag ?? r.revision ?? 'tag',
			version: r.version,
			revision: r.revision,
			created: r.created,
			metadataUnresolved: r.metadataUnresolved
		}))
	};
	return {
		metadata: {
			name: opts.name,
			namespace: opts.namespace,
			annotations: opts.cluster ? { [SOURCE_CLUSTER]: opts.cluster } : {}
		},
		spec: {
			wantedVersion: opts.wantedVersion,
			bakeTime: opts.bakeTime,
			deployTimeout: opts.deployTimeout
		},
		status
	} as unknown as Rollout;
}

function mkEnv(opts: {
	app: string;
	envName: string;
	namespace: string;
	cluster?: string;
}): Environment {
	return {
		metadata: {
			name: `${opts.app}-${opts.envName}`,
			namespace: opts.namespace,
			annotations: opts.cluster ? { [SOURCE_CLUSTER]: opts.cluster } : {}
		},
		spec: { environment: opts.envName, rolloutRef: { name: opts.app } }
	} as unknown as Environment;
}

describe('buildPrPipeline', () => {
	it('squash merge: the head IS the merge commit — live', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [
				{
					revision: 'c0ffee1',
					timestamp: '2026-09-02T00:00:00Z',
					bakeStatus: 'Succeeded',
					bakeEndTime: '2026-09-02T00:05:00Z'
				},
				// An older entry BEFORE the merge, so this rollout's retained
				// window actually covers the merge — distinct from the "merged
				// before recorded history" case, which has its own test below.
				{ revision: 'pre-merge-1', timestamp: '2026-08-15T00:00:00Z', bakeStatus: 'Succeeded' }
			]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);

		expect(vm.services).toHaveLength(1);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('live');
		expect(cell.reason).toBe('live');
		expect(cell.revision).toBe('c0ffee1');
		expect(cell.superseded).toBe(false);
		expect(cell.since).toBe('2026-09-02T00:05:00Z');
	});

	// ⭐ ROUND 3 REGRESSION FIXTURE ("an old commit whose exact release
	// exists → its services, live via newer where heads moved on"). The
	// SERVICE is affected because CI DID release the exact merge commit at
	// some point (`availableReleases` below, superseded and evicted from
	// retained `history`) — eligibility is exact-sha only (⭐ ROUND 3
	// refinement) — and, once affected, `buildCell`'s own descendant
	// containment (`containedIn`) is what lets a LATER head still read
	// `live`.
	it('rebase merge: the build sha is a DESCENDANT of the merge commit, still live', () => {
		// The backend's commits-since(mergedAt) list covers every commit after
		// the merge on base, not just the merge commit itself — a later
		// deploy of a sha further down that list still contains the PR.
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [
				{ revision: 'deadbeef2', timestamp: '2026-09-03T00:00:00Z', bakeStatus: 'Succeeded' }
			],
			// CI's own build of the exact merge commit — this is what makes the
			// service AFFECTED; it has since been superseded by `deadbeef2` and
			// fallen out of the retained history window.
			availableReleases: [{ revision: 'c0ffee1', tag: 'build-42', created: '2026-08-29T00:00:00Z' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(
			meta({ containedIn: ['c0ffee1', 'deadbeef2'] }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		expect(vm.unaffectedServices).toEqual([]);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('live');
		expect(cell.revision).toBe('deadbeef2');
		// The PR's OWN merge commit has already been superseded by this later
		// build, even though that later build still carries the PR.
		expect(cell.superseded).toBe(true);
	});

	it('a PR merged before the retained history window: still live, since unknown', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [
				{ revision: 'c0ffee1', timestamp: '2026-09-05T00:00:00Z', bakeStatus: 'Succeeded' },
				{ revision: 'older-1', timestamp: '2026-09-04T00:00:00Z', bakeStatus: 'Succeeded' }
			]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		// mergedAt is BEFORE the oldest retained history entry (09-04).
		const vm = buildPrPipeline(
			meta({ mergedAt: '2026-08-01T00:00:00Z' }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('live');
		expect(cell.reason).toBe('live (since before recorded history)');
		expect(cell.since).toBeNull();
	});

	it('rollback: an OLDER history entry has it, HEAD does not', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [
				{
					revision: 'newer-9',
					timestamp: '2026-09-06T00:00:00Z',
					bakeStatus: 'Succeeded',
					message: 'Rolled back to newer-9'
				},
				{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }
			]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('rolled-back');
		expect(cell.reason).toBe('Rolled back to newer-9');
	});

	it('pinned AND gated: pinned wins, per the doc precedence', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			// history has neither the PR nor anything newer that contains it.
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			// Pinned to the OLD build — not the one containing the PR.
			wantedVersion: 'old-1',
			gates: [{ name: 'ghd-abc12', passing: true, allowedVersions: [] }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('pinned');
		expect(cell.reason).toContain('old-1');
	});

	it('two clusters sharing an env name: two distinct rows, not merged', () => {
		const a = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			cluster: 'cluster-a',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const b = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			cluster: 'cluster-b',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const envA = mkEnv({
			app: 'widget-app',
			envName: 'dev',
			namespace: 'widget-dev',
			cluster: 'cluster-a'
		});
		const envB = mkEnv({
			app: 'widget-app',
			envName: 'dev',
			namespace: 'widget-dev',
			cluster: 'cluster-b'
		});
		const vm = buildPrPipeline(meta(), [a, b], [envA, envB], { items: [] }, NOW);
		expect(vm.services).toHaveLength(1);
		const cells = vm.services[0].cells;
		expect(cells).toHaveLength(2);
		expect(new Set(cells.map((c) => c.cluster))).toEqual(new Set(['cluster-a', 'cluster-b']));
		expect(cells.every((c) => c.envName === 'dev')).toBe(true);
		expect(cells.find((c) => c.cluster === 'cluster-a')?.state).toBe('live');
		// ⭐ ROUND 3: cluster-a's own cell has release evidence, so this
		// service is INCLUDED; cluster-b's genuine "no candidate at all"
		// cell is recast `queued`, never the retired `not-built`.
		expect(cells.find((c) => c.cluster === 'cluster-b')?.state).toBe('queued');
	});

	it('bakeTime unset: "baking, no timer"', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [
				{ revision: 'c0ffee1', timestamp: '2026-09-10T11:00:00Z', bakeStatus: 'InProgress' }
			]
			// no bakeTime on spec
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('baking');
		expect(cell.reason).toBe('baking, no timer');
		expect(cell.bakeLeftMs).toBeNull();
	});

	it('metadataUnresolved: waiting-upstream (item 9 — not `gated`, a verification failure not a rule refusing it), "manifest unreadable"', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{
					revision: 'c0ffee1',
					tag: 'build-42',
					created: '2026-09-02T00:00:00Z',
					metadataUnresolved: true
				}
			]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('waiting-upstream');
		expect(cell.reason).toBe('manifest unreadable');
	});

	it('revert PR (documented limitation): the revert commit is still "since mergedAt", so the original PR still reads live', () => {
		// The revert PR's own merge lands AFTER the original PR's mergedAt, so
		// the backend's commits-since list includes it — this module cannot
		// tell a revert from a re-application by ancestry alone. Asserted as
		// current behaviour, not endorsed as correct; see the module doc.
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [
				{ revision: 'revert-9', timestamp: '2026-09-04T00:00:00Z', bakeStatus: 'Succeeded' }
			],
			// ⭐ ROUND 3 refinement: eligibility is exact-sha only — CI's own
			// build of the merge commit, since superseded by the revert.
			availableReleases: [{ revision: 'c0ffee1', tag: 'build-42', created: '2026-08-29T00:00:00Z' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(
			meta({ containedIn: ['c0ffee1', 'revert-9'] }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		expect(vm.services[0].cells[0].state).toBe('live');
	});

	// ⚠️ `containedInAll` is the BACKEND'S name for "the since-list was
	// TRUNCATED at 300" (main_github_pulls.go's `cutAt300`). `true` means the
	// list is INCOMPLETE and the per-release `created`-vs-`mergedAt` fallback
	// below applies; `false` means the list is a COMPLETE, AUTHORITATIVE
	// account and a revision absent from it is simply not built — no
	// fallback, whatever `created` says. These three tests, and the
	// regression fixture after them, pin that meaning: get the boolean
	// backwards here and every normal (non-truncated) PR page mis-reports
	// ancestor builds as containing the PR.

	it('the containedInAll fallback: containedInAll=true (list TRUNCATED at 300) falls back to created vs mergedAt — a release created after mergedAt counts as contained even off the truncated list, once the service is otherwise affected', () => {
		// ⭐ ROUND 3 REFINEMENT: eligibility is EXACT-SHA only now (the `dev`
		// rollout below), never descendant/fallback containment — so this
		// fixture adds the exact-match env that makes the SERVICE affected,
		// then exercises the fallback on a SECOND env/cell of that same
		// already-affected service (`buildCell`'s own rule 3/4 machinery,
		// untouched by the eligibility refinement).
		const affected = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'c0ffee1', timestamp: '2026-08-29T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-01T00:00:00Z' },
				// This revision is NOT literally in `containedIn` (the 300-commit
				// cap truncated it), but it was created AFTER the PR merged.
				{ revision: 'unlisted-later', tag: 'unlisted-later', created: '2026-09-05T00:00:00Z' }
			]
		});
		const envDev = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(
			meta({ containedIn: [], containedInAll: true }),
			[affected, rollout],
			[envDev, env],
			{ items: [] },
			NOW
		);
		expect(vm.services).toHaveLength(1);
		const cell = vm.services[0].cells.find((c) => c.envName === 'prod')!;
		// Contained via the fallback -> a build exists, so this is NOT not-built.
		expect(cell.state).not.toBe('not-built');
		expect(cell.revision).toBe('unlisted-later');
	});

	it('the containedInAll fallback, the other direction (containedInAll=true, truncated): a release created BEFORE mergedAt is not-contained — ⭐ ROUND 3: no evidence anywhere, so this reads noRelease, not a not-built cell', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [{ revision: 'old-1', tag: 'old-1', created: '2026-08-01T00:00:00Z' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(
			meta({ containedIn: [], containedInAll: true }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		expect(vm.services).toHaveLength(0);
		expect(vm.unaffectedServices).toEqual(['widget-app']);
		expect(vm.noRelease).toBe(true);
	});

	it('nil `created` under the truncated fallback (containedInAll=true): never claimed contained — ⭐ ROUND 3: an `unverified` candidate is not solid evidence, so this is noRelease, not a not-built cell', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [{ revision: 'unknown-created', tag: 'unknown-created' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(
			meta({ containedIn: [], containedInAll: true }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		expect(vm.services).toHaveLength(0);
		expect(vm.noRelease).toBe(true);
	});

	it('regression (PR #4 shape): containedInAll=false is authoritative — a release built AFTER mergedAt whose revision is an ancestor, absent from the set, gives this app no release evidence at all', () => {
		// hello-multi-app / hello-world-app on the live cluster run f7a46ae, an
		// ancestor of PR #4's merge commit — built well after the PR merged,
		// but NOT the merge commit and NOT among the (complete, non-truncated)
		// commits since the merge. `created >= mergedAt` alone must NEVER be
		// read as containment when the set is authoritative.
		//
		// ⭐ ROUND 3 (2026-09-10 ruling A). This app has NO release evidence for
		// the change, so it is dropped entirely (`unaffectedServices`), not
		// rendered as a `not-built` card — see the dedicated "no release means
		// not affected" describe block below for the full PR #4 fixture
		// (hello-frontend-app the ONE included service, three others excluded).
		const rollout = mkRollout({
			name: 'hello-multi-app',
			namespace: 'hello-dev',
			history: [{ revision: 'f7a46ae', timestamp: '2026-09-05T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'f7a46ae', tag: 'f7a46ae', created: '2026-09-06T00:00:00Z' }
			]
		});
		const env = mkEnv({ app: 'hello-multi-app', envName: 'dev', namespace: 'hello-dev' });
		const vm = buildPrPipeline(
			meta({
				mergedAt: '2026-09-01T00:00:00Z',
				mergeCommitSha: 'bf5be49',
				containedIn: ['bf5be49'],
				containedInAll: false
			}),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		expect(vm.services).toHaveLength(0);
		expect(vm.unaffectedServices).toEqual(['hello-multi-app']);
		expect(vm.noRelease).toBe(true);
	});

	it('waiting-upstream outranks gated when a dependency gate blocks the containing build', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			gates: [
				{ name: 'dep-gate-1', passing: true, allowedVersions: [] },
				{ name: 'ghd-abc12', passing: true, allowedVersions: [] }
			]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const dependency = {
			metadata: { name: 'widget-app-needs-api', namespace: 'widget-prod' },
			spec: { rolloutRef: { name: 'widget-app' }, providerRef: { name: 'api-app' }, contract: 'api' },
			status: { gateName: 'dep-gate-1', providedVersion: '1.0.0' }
		} as any;
		const vm = buildPrPipeline(
			meta(),
			[rollout],
			[env],
			{ items: [dependency] },
			NOW
		);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('waiting-upstream');
		expect(cell.gateHint).toEqual({
			cluster: '',
			namespace: 'widget-prod',
			rolloutName: 'widget-app',
			gateName: 'dep-gate-1'
		});
	});

	/**
	 * ⭐ FIX PASS ITEM 4 (2026-09-10) — "QUEUED, NOT WAITING-UPSTREAM". A gate
	 * joined to an environment-controller PROMOTION relationship
	 * (`subjectKind: 'environment'`, `classifyGate`'s own `kind: 'promotion'`
	 * branch) is a NORMAL promotion-order wait — "staging hasn't been given
	 * its turn because dev hasn't deployed yet", nobody stuck, nothing
	 * refusing anything. This used to render identically to a genuinely
	 * stuck dependency (`waiting-upstream`, amber field/ring); `queued` is
	 * its own state now so `LandingMark`/`PipelineRow` can draw it neutral.
	 */
	it('queued, not waiting-upstream: a promotion-relationship gate (subjectKind environment) is a normal order wait', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-staging',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			gates: [{ name: 'ghd-p2fld', passing: true, allowedVersions: [] }]
		});
		const env = {
			metadata: { name: 'widget-app-staging', namespace: 'widget-staging' },
			spec: {
				environment: 'staging',
				rolloutRef: { name: 'widget-app' },
				relationship: { environment: 'dev', type: 'After' }
			},
			status: { rolloutGateRef: { name: 'ghd-p2fld' } }
		} as unknown as Environment;
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('queued');
		expect(cell.state).not.toBe('waiting-upstream');
		expect(cell.gateSubject).toBe('dev');
		expect(cell.gateSubjectKind).toBe('environment');
	});

	/**
	 * ⭐ COORDINATOR FIX (fourth operator walk, item A, 2026-09-10). The prod
	 * row above (`queued, not waiting-upstream`) is the case where a
	 * promotion gate is the ONLY thing blocking. A live fleet's prod row had
	 * a SECOND gate in `blocking` at the same time — `hello-world-manual-
	 * approval`, `allowedVersions: []`, no promotion/dependency join — and
	 * the row still read `queued … usually 1 min once it starts`, because
	 * the old code picked the first `clears === 'upstream'` gate it found
	 * (the promotion one) and never looked at the rest of `blocking`. A
	 * promotion-order wait must never outrank a gate that is actively
	 * refusing the candidate for its own reason: `queued` is correct only
	 * when the promotion gate is the ONE gate present.
	 */
	it('a promotion gate beside a manual-approval gate is gated, never queued, and carries no ETA', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			gates: [
				{ name: 'ghd-p2fld', passing: true, allowedVersions: [] },
				{ name: 'hello-world-manual-approval', passing: false, allowedVersions: [] }
			]
		});
		const env = {
			metadata: { name: 'widget-app-prod', namespace: 'widget-prod' },
			spec: {
				environment: 'prod',
				rolloutRef: { name: 'widget-app' },
				relationship: { environment: 'staging', type: 'After' }
			},
			status: { rolloutGateRef: { name: 'ghd-p2fld' } }
		} as unknown as Environment;
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('gated');
		expect(cell.state).not.toBe('queued');
		expect(cell.state).not.toBe('waiting-upstream');
		// `gated` never carries an ETA (`HAS_BUILD_STATES` in `pr-cell-copy.ts`
		// is `queued`/`promoting` only) — the frontier verdict must not print
		// "usually N min once it starts" over a hold that will not clear on a
		// promotion tick.
		expect(frontierUsuallyLabelForCell(cell)).toBeNull();
	});

	it('no release anywhere carries the PR: the service is unaffected, not a not-built cell (⭐ ROUND 3 ruling A)', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		expect(vm.services).toHaveLength(0);
		expect(vm.unaffectedServices).toEqual(['widget-app']);
		expect(vm.noRelease).toBe(true);
	});

	it('deploying: bakeLeftMs counts down against deployTimeout', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			deployTimeout: '10m',
			history: [
				{ revision: 'c0ffee1', timestamp: '2026-09-10T11:55:00Z', bakeStatus: 'Deploying' }
			]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('deploying');
		// 10m deadline, 5m elapsed by NOW -> 5m left.
		expect(cell.bakeLeftMs).toBe(5 * 60_000);
	});

	it('failed and cancelled carry the bakeStatusMessage as the reason', () => {
		const failed = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [
				{
					revision: 'c0ffee1',
					timestamp: '2026-09-10T11:00:00Z',
					bakeStatus: 'Failed',
					bakeStatusMessage: 'health check p99 exceeded SLO'
				}
			]
		});
		const cancelled = mkRollout({
			name: 'widget-app',
			namespace: 'widget-staging',
			history: [
				{
					revision: 'c0ffee1',
					timestamp: '2026-09-10T11:00:00Z',
					bakeStatus: 'Cancelled',
					bakeStatusMessage: 'superseded by a newer deploy'
				}
			]
		});
		const envDev = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const envStaging = mkEnv({
			app: 'widget-app',
			envName: 'staging',
			namespace: 'widget-staging'
		});
		const vm = buildPrPipeline(meta(), [failed, cancelled], [envDev, envStaging], { items: [] }, NOW);
		const failedCell = vm.services[0].cells.find((c) => c.envName === 'dev')!;
		const cancelledCell = vm.services[0].cells.find((c) => c.envName === 'staging')!;
		expect(failedCell.state).toBe('failed');
		expect(failedCell.reason).toBe('health check p99 exceeded SLO');
		expect(cancelledCell.state).toBe('cancelled');
		expect(cancelledCell.reason).toBe('superseded by a newer deploy');
	});

	it('retrying: BakeTimeRetrying is its own state, not cancelled or failed', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [
				{ revision: 'c0ffee1', timestamp: '2026-09-10T11:00:00Z', bakeStatus: 'BakeTimeRetrying' }
			]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		expect(vm.services[0].cells[0].state).toBe('retrying');
	});

	it('furthest names every environment in rank order, and the verdict names the worst', () => {
		const dev = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const staging = mkRollout({
			name: 'widget-app',
			namespace: 'widget-staging',
			history: [
				{ revision: 'c0ffee1', timestamp: '2026-09-02T12:00:00Z', bakeStatus: 'InProgress' }
			]
		});
		const envDev = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const envStaging = mkEnv({
			app: 'widget-app',
			envName: 'staging',
			namespace: 'widget-staging'
		});
		const vm = buildPrPipeline(meta(), [dev, staging], [envDev, envStaging], { items: [] }, NOW);
		expect(vm.services[0].furthest).toBe('live in dev · baking in staging');
		expect(vm.verdict).toBe('Widget-app baking in staging');
	});

	// ⭐ ITEM 11 (2026-09-10 fix pass). `furthestCompact` is the folded form
	// `Card`'s `verdictCompact` shows below 560px instead of the clause
	// list, which has no length bound (one clause per environment) and
	// clipped mid-word on `hello-world-manifests` (3 environments, 535px in
	// a 341px card at 390).
	describe('furthestCompact', () => {
		it('N of M live, when at least one cell is live', () => {
			const rollout = mkRollout({
				name: 'widget-app',
				namespace: 'widget-dev',
				history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
			});
			const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
			const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
			expect(vm.services[0].furthestCompact).toBe('1 of 1 live');
		});

		it('held in N, when nothing is live but something is held', () => {
			const rollout = mkRollout({
				name: 'widget-app',
				namespace: 'widget-prod',
				history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
				availableReleases: [
					{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
					{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
				],
				gates: [{ name: 'hello-world-manual-approval', passing: true, allowedVersions: [] }]
			});
			const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
			const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
			// ⭐ RULING 7 (2026-09-10 fix pass): family words, never a bare count.
			expect(vm.services[0].furthestCompact).toBe('held in prd');
		});

		// ⭐ ROUND 3 (2026-09-10 ruling A): retired. A service with EVERY cell
		// `not-built` is no longer a shape `buildPrPipeline` ever produces — it
		// is unaffected and dropped (see `hasBuildEvidence`), reported as
		// `noRelease` at the VM level instead of a per-service card. This
		// exact fixture is now the canonical "no release" regression — see
		// the dedicated describe block below.
		it('a lone not-built cell is unaffected, not a "not built yet" card', () => {
			const rollout = mkRollout({
				name: 'widget-app',
				namespace: 'widget-dev',
				history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
			});
			const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
			const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
			expect(vm.services).toHaveLength(0);
			expect(vm.noRelease).toBe(true);
		});
	});

	it('an app whose source is a different repository is excluded entirely', () => {
		const other = mkRollout({
			name: 'other-app',
			namespace: 'other-dev',
			source: 'github.com/acme/unrelated',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const env = mkEnv({ app: 'other-app', envName: 'dev', namespace: 'other-dev' });
		const vm = buildPrPipeline(meta(), [other], [env], { items: [] }, NOW);
		expect(vm.services).toHaveLength(0);
		expect(vm.verdict).toBe('No service on this cluster deploys this repository');
	});

	it('live everywhere, when every cell is live', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		expect(vm.verdict).toBe('Live everywhere');
	});

	// ⭐ ITEM 4 (2026-09-10 fix pass). A service with no build at all must
	// never dominate the verdict — the PR's OWN state is decided by the
	// services that actually have a build carrying it.
	it('verdict: live everywhere among services WITH a build, even when another service has none at all', () => {
		const live = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const noBuild = mkRollout({
			name: 'widget-manifests',
			namespace: 'widget-manifests-dev',
			history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const envA = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const envB = mkEnv({ app: 'widget-manifests', envName: 'dev', namespace: 'widget-manifests-dev' });
		const vm = buildPrPipeline(meta(), [live, noBuild], [envA, envB], { items: [] }, NOW);
		// ⭐ ROUND 3: `widget-manifests` has no release evidence at all, so it
		// is dropped rather than rendered with a `not-built` cell.
		expect(vm.services.map((s) => s.appName)).toEqual(['widget-app']);
		expect(vm.unaffectedServices).toEqual(['widget-manifests']);
		expect(vm.verdict).toBe('Live everywhere');
	});

	// ⭐ COPY-DRIFT REGRESSION, F2 (2026-09-10). Live on
	// `/pr/littlechimera/kuberik-testing/1`: the verdict plugged
	// `worst.reason` (a full capitalised clause) after "on", producing
	// "Waiting in prod on Waiting for staging to deploy it first" — a
	// doubled verb. `buildVerdict` now uses `gateSubject`/`gateLabel`
	// (the same NAME `PipelineRow`'s "waiting on <service/env>" row
	// sentence reads), matching the design doc's own example shape
	// ("waiting in prod on gate X").
	it('verdict: waiting-upstream names the upstream SERVICE, not its full clause', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			gates: [{ name: 'dep-gate-1', passing: true, allowedVersions: [] }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const dependency = {
			metadata: { name: 'widget-app-needs-api', namespace: 'widget-prod' },
			spec: { rolloutRef: { name: 'widget-app' }, providerRef: { name: 'api-app' }, contract: 'api' },
			status: { gateName: 'dep-gate-1', providedVersion: '1.0.0' }
		} as any;
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [dependency] }, NOW);
		// ⭐ RULING 3 (2026-09-10 fix pass, "ONE VERDICT, THE FRONTIER"): a
		// dependency wait reads "held", the same word a gate hold uses — both
		// are "something else has to move first" from the reader's seat.
		expect(vm.verdict).toBe('Widget-app held in prod on api-app');
	});

	// ⭐ ITEM 3 (2026-09-10 fix pass). Without `rolloutGates` (this VM never
	// supplies them — only the per-row "why" fetch does), an `approval`/
	// `unknown` classification carries no owner evidence and is a guess this
	// VM cannot back up: the live bug was a CLOSED SCHEDULE gate named
	// `schedule-gate-fk44d` printing its raw id as "gated by
	// schedule-gate-fk44d" via exactly this path. So a gate with an
	// allow-list and no promotion/dependency join now renders the generic,
	// honest "held by a rule" here — never the gate's own name — until the
	// disclosure resolves it with real evidence.
	it('verdict: gated with no owner evidence (approval/unknown) reads "held by a rule", never the raw gate id', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			gates: [{ name: 'schedule-gate-fk44d', passing: true, allowedVersions: [] }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('gated');
		expect(cell.gateLabel).toBeNull();
		expect(cell.gatePending).toBe(true);
		expect(vm.verdict).not.toContain('schedule-gate-fk44d');
		// ⭐ RULING 3: no subject clause when `gateLabel` is unresolved — "held
		// in prod", never a raw gate id, never a fake "by a rule" filler.
		expect(vm.verdict).toBe('Widget-app held in prod');
	});

	it('verdict: gated with nothing actually blocking is its own state (promoting), no HELD contradiction', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			]
			// no gates at all — "built and ready, just not promoted"
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('promoting');
		expect(cell.gateLabel).toBeNull();
		// ⭐ RULING 3: the frontier verb table drops "shortly" — "promoting in
		// prod", no subject (nothing to name; the row's own reason carries it).
		expect(vm.verdict).toBe('Widget-app promoting in prod');
	});
});

describe('buildChangeVerdict (CHANGES-2026-09-10 fix pass, ruling 3 — "ONE VERDICT, THE FRONTIER")', () => {
	it('the live PR #4 shape: frontend built+held in all 3 envs, api/multi/world never built — verdict names the frontier, not the deepest symptom', () => {
		const frontend = mkRollout({
			name: 'frontend-app',
			namespace: 'frontend-dev',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			gates: [{ name: 'peak-hours-protection', passing: true, allowedVersions: [] }]
		});
		const api = mkRollout({
			name: 'api-app',
			namespace: 'api-dev',
			history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }],
			source: 'github.com/acme/other'
		});
		const envFrontend = mkEnv({ app: 'frontend-app', envName: 'dev', namespace: 'frontend-dev' });
		const envApi = mkEnv({ app: 'api-app', envName: 'dev', namespace: 'api-dev' });
		const vm = buildPrPipeline(meta(), [frontend, api], [envFrontend, envApi], { items: [] }, NOW);
		// api-app is a different repo entirely — excluded, never dilutes the verdict.
		expect(vm.services.map((s) => s.appName)).toEqual(['frontend-app']);
		expect(vm.services[0].cells[0].state).toBe('gated');
		expect(vm.verdict).toBe('Frontend-app held in dev');
	});

	// `buildPrPipeline`'s own gate context never carries schedule/rolloutGate
	// evidence (only the per-row lazy "why" fetch does — see the module's own
	// F2/ITEM-3 comments), so a REAL `gated` cell built through it can never
	// carry a resolved `gateLabel`. `buildChangeVerdict` itself is tested
	// directly, against a hand-built `PrService`, for the subject-naming
	// case the design doc's own example names ("held in dev by Peak Hours
	// Protection") — the same fixture style `changes.test.ts` already uses.
	it('names the gate rule as the subject — "held in dev by <label>" — given a resolved gateLabel', () => {
		const cell: PrCell = {
			cluster: '',
			envName: 'dev',
			namespace: 'widget-dev',
			rolloutName: 'widget-app',
			theme: null,
			envRank: 0,
			state: 'gated',
			reason: 'Outside the Peak Hours Protection deploy window',
			since: null,
			usuallyMs: null,
			bakeLeftMs: null,
			releaseLabel: 'build-42',
			revision: 'c0ffee1',
			superseded: false,
			gateHint: { cluster: '', namespace: 'widget-dev', rolloutName: 'widget-app', gateName: 'peak-hours' },
			gateLabel: 'Peak Hours Protection',
			gateSubject: null,
			gateSubjectKind: null,
			gatePending: false,
			gateContract: null,
			gateRequiredVersion: null,
			providerHasNoBuild: false,
			containmentKnown: true,
			historyMatches: [],
			historyAtLimit: false,
			versionHistoryLimit: 10
		};
		const service: PrService = {
			appName: 'widget-app',
			sourceRepo: 'github.com/acme/widget',
			cells: [cell],
			furthest: '',
			furthestCompact: '',
			leadTimeMs: null,
			builtElsewhere: false
		};
		// ⭐ FIX PASS ITEM 5 (2026-09-10) — SUBJECT FIRST. Supersedes this
		// test's own former expectation (`'held in dev by Peak Hours
		// Protection'`, no subject) — the verdict now names the BLOCKED
		// SERVICE ahead of the state.
		expect(buildChangeVerdict([service])).toEqual({
			word: 'widget-app held in dev by Peak Hours Protection',
			tone: 'held'
		});
	});

	it('earliest env-rank wins over "worst progressed": a dev hold outranks a prod hold in the verdict', () => {
		const dev = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			]
			// no gates — "promoting", the LEAST progressed of the two non-live states below
		});
		const prod = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [
				{ revision: 'c0ffee1', timestamp: '2026-09-10T11:00:00Z', bakeStatus: 'Failed', bakeStatusMessage: 'boom' }
			]
		});
		const envDev = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const envProd = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(meta(), [dev, prod], [envDev, envProd], { items: [] }, NOW);
		// dev is the FRONTIER (lowest rank, not live) even though prod's own
		// state (`failed`) is louder — the old "worst-progressed" rule would
		// have picked prod here.
		expect(vm.verdict).toBe('Widget-app promoting in dev');
	});
});

describe('containmentKnown (CHANGES-2026-09-10 fix pass, ruling 1 — "SUPERSEDED IS LIVE")', () => {
	// The old commit shape: the head has moved on to a later commit this VM
	// cannot prove carries the change (a bare-sha meta before `commits/:sha`
	// is wired, or genuinely truncated data) — an exact-match candidate that
	// is merely still sitting, unpromoted, in `availableReleases` must NOT
	// be read as "promoting shortly"/"waiting", because the real head may
	// already have superseded it by a route this VM cannot see.
	function oldCommitRollout(gates: { name: string; passing?: boolean; allowedVersions?: string[] | null }[] = []) {
		return mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			// HEAD has moved on to a commit this meta's `containedIn` (empty)
			// cannot vouch for.
			history: [{ revision: 'c943222', timestamp: '2026-09-10T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				// The literal merge commit itself, still sitting unpromoted.
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-08-29T00:00:00Z' }
			],
			gates
		});
	}

	it('unknown containment: an unblocked exact-match candidate reads not-built (unverified), never "promoting"', () => {
		const rollout = oldCommitRollout();
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const bareShaMeta = meta({ containedIn: [], containedInAll: false });
		const vm = buildPrPipeline(bareShaMeta, [rollout], [env], { items: [] }, NOW);
		expect(vm.containmentKnown).toBe(false);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('not-built');
		expect(cell.reason).toBe('not built (unverified)');
		expect(cell.containmentKnown).toBe(false);
	});

	it('unknown containment: a blocking dependency gate on the same exact-match candidate also reads not-built (unverified), never "waiting"', () => {
		const rollout = oldCommitRollout([{ name: 'dep-gate-1', passing: true, allowedVersions: [] }]);
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const dependency = {
			metadata: { name: 'widget-app-needs-api', namespace: 'widget-prod' },
			spec: { rolloutRef: { name: 'widget-app' }, providerRef: { name: 'api-app' }, contract: 'api' },
			status: { gateName: 'dep-gate-1', providedVersion: '1.0.0' }
		} as any;
		const bareShaMeta = meta({ containedIn: [], containedInAll: false });
		const vm = buildPrPipeline(bareShaMeta, [rollout], [env], { items: [dependency] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('not-built');
		expect(cell.reason).toBe('not built (unverified)');
	});

	it('`containmentKnown: true` (explicit override) restores the normal "promoting" reading even off an empty containedIn', () => {
		const rollout = oldCommitRollout();
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const bareShaMeta = meta({ containedIn: [], containedInAll: false, containmentKnown: true });
		const vm = buildPrPipeline(bareShaMeta, [rollout], [env], { items: [] }, NOW);
		expect(vm.containmentKnown).toBe(true);
		expect(vm.services[0].cells[0].state).toBe('promoting');
	});

	it('a `gated` cell (no upstream named) is untouched by unknown containment — it names no specific candidate\'s fate', () => {
		const rollout = oldCommitRollout([{ name: 'schedule-gate-fk44d', passing: true, allowedVersions: [] }]);
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const bareShaMeta = meta({ containedIn: [], containedInAll: false });
		const vm = buildPrPipeline(bareShaMeta, [rollout], [env], { items: [] }, NOW);
		expect(vm.services[0].cells[0].state).toBe('gated');
	});

	it('the default meta() fixture (containedInAll: true) is known', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		expect(vm.containmentKnown).toBe(true);
	});
});

describe('rolloutsTotal / rolloutsWithBuild / rolloutsLive (CHANGES-2026-09-10 fix pass, ruling 5 — "COUNTS")', () => {
	it('counts every rollout this change could land in, how many have a build, and how many are live', () => {
		const live = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const notBuilt = mkRollout({
			name: 'widget-app',
			namespace: 'widget-staging',
			history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const envDev = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const envStaging = mkEnv({ app: 'widget-app', envName: 'staging', namespace: 'widget-staging' });
		const vm = buildPrPipeline(meta(), [live, notBuilt], [envDev, envStaging], { items: [] }, NOW);
		expect(vm.rolloutsTotal).toBe(2);
		// ⭐ ROUND 3: `rolloutsWithBuild` is now redundant with `rolloutsTotal`
		// in the ordinary case — the service is included because `dev` has
		// evidence, and `staging`'s genuine "no candidate at all" cell is
		// recast `queued` (never `not-built`) rather than dropped.
		expect(vm.rolloutsWithBuild).toBe(2);
		expect(vm.rolloutsLive).toBe(1);
	});
});

describe('builtElsewhere / joined dependency reasons (CHANGES-2026-09-10 fix pass, rulings 2 & 4)', () => {
	function depGate(providerName = 'api-app') {
		return {
			metadata: { name: 'widget-app-needs-api', namespace: 'widget-dev' },
			spec: { rolloutRef: { name: 'widget-app' }, providerRef: { name: providerName }, contract: 'api' },
			status: { gateName: 'dep-gate-1', providedVersion: '1.0.0' }
		} as any;
	}

	it('a service with no build of its own, while a sibling service DOES have one, is builtElsewhere: true', () => {
		const built = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const unbuilt = mkRollout({
			name: 'widget-manifests',
			namespace: 'widget-manifests-dev',
			history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const envA = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const envB = mkEnv({ app: 'widget-manifests', envName: 'dev', namespace: 'widget-manifests-dev' });
		const vm = buildPrPipeline(meta(), [built, unbuilt], [envA, envB], { items: [] }, NOW);
		// ⭐ ROUND 3: `widget-manifests` has no release evidence anywhere, so it
		// is dropped into `unaffectedServices` rather than kept with a
		// `not-built` cell and `builtElsewhere: true`.
		expect(vm.services.map((s) => s.appName)).toEqual(['widget-app']);
		expect(vm.services[0].builtElsewhere).toBe(false);
		expect(vm.unaffectedServices).toEqual(['widget-manifests']);
	});

	it('joins the reason when the dependency provider is itself a service of this change and has NO build at all', () => {
		const dependent = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			gates: [{ name: 'dep-gate-1', passing: true, allowedVersions: [] }]
		});
		const provider = mkRollout({
			name: 'api-app',
			namespace: 'api-dev',
			history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const envDependent = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const envProvider = mkEnv({ app: 'api-app', envName: 'dev', namespace: 'api-dev' });
		const vm = buildPrPipeline(
			meta(),
			[dependent, provider],
			[envDependent, envProvider],
			{ items: [depGate()] },
			NOW
		);
		const dependentSvc = vm.services.find((s) => s.appName === 'widget-app')!;
		expect(dependentSvc.cells[0].state).toBe('waiting-upstream');
		// ⭐ ROUND 3B (2026-09-10, coordinator correction) — the reason is the
		// ORDINARY dependency constraint sentence (`blocking-story.ts`'s own
		// "Waiting for X to ship Y — it is on Z"), never the retired "its
		// build of this change does not exist yet" join: under ruling A,
		// api-app is unaffected by this change and needs a NEW release of its
		// own contract, not a build of this specific commit.
		expect(dependentSvc.cells[0].reason).toBe('Waiting for api-app to ship a newer api — it is on 1.0.0');
		expect(dependentSvc.cells[0].providerHasNoBuild).toBe(true);
	});

	/**
	 * ⭐ FIX PASS ITEM 5 (2026-09-10) — "THE HONEST WHEN". The SAME fixture as
	 * the test above (provider has NO build of this change at all), but this
	 * time asserting the VERDICT itself, not just the cell's own reason: a
	 * dependency the provider cannot possibly satisfy right now gets the
	 * verdict's own "will not move on its own" tail, naming the exact
	 * contract and range — `buildChangeVerdict`'s `providerHasNoBuild` read.
	 */
	it('verdict: "will not move on its own — needs <provider> <contract> <range>" when the provider has no build at all', () => {
		const dependent = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			gates: [{ name: 'dep-gate-1', passing: true, allowedVersions: [] }]
		});
		const provider = mkRollout({
			name: 'api-app',
			namespace: 'api-dev',
			history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const envDependent = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const envProvider = mkEnv({ app: 'api-app', envName: 'dev', namespace: 'api-dev' });
		const dependency = {
			metadata: { name: 'widget-app-needs-api', namespace: 'widget-dev' },
			spec: { rolloutRef: { name: 'widget-app' }, providerRef: { name: 'api-app' }, contract: 'api' },
			status: {
				gateName: 'dep-gate-1',
				providedVersion: '1.66.0',
				blockedReleases: [{ requiredVersion: '^1.68.0' }]
			}
		} as any;
		const vm = buildPrPipeline(
			meta(),
			[dependent, provider],
			[envDependent, envProvider],
			{ items: [dependency] },
			NOW
		);
		expect(vm.verdict).toBe(
			'Widget-app held in dev on api-app · will not move on its own — needs api-app api ^1.68.0'
		);
	});

	it('joins the reason when the dependency provider HAS a build, just not deployed to this environment yet', () => {
		const dependent = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: 'c0ffee1', tag: 'build-42', created: '2026-09-02T00:00:00Z' }
			],
			gates: [{ name: 'dep-gate-1', passing: true, allowedVersions: [] }]
		});
		const providerDev = mkRollout({
			name: 'api-app',
			namespace: 'api-dev',
			history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const providerStaging = mkRollout({
			name: 'api-app',
			namespace: 'api-staging',
			history: [{ revision: 'c0ffee1', timestamp: '2026-09-02T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const envDependent = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const envProviderDev = mkEnv({ app: 'api-app', envName: 'dev', namespace: 'api-dev' });
		const envProviderStaging = mkEnv({ app: 'api-app', envName: 'staging', namespace: 'api-staging' });
		const vm = buildPrPipeline(
			meta(),
			[dependent, providerDev, providerStaging],
			[envDependent, envProviderDev, envProviderStaging],
			{ items: [depGate()] },
			NOW
		);
		const dependentSvc = vm.services.find((s) => s.appName === 'widget-app')!;
		expect(dependentSvc.cells[0].state).toBe('waiting-upstream');
		expect(dependentSvc.cells[0].reason).toBe('waiting on api-app to reach dev');
	});
});

// ── ROUND 3 (2026-09-10 ruling A, REFINED after the third operator walk) ──
//
// "No release means not affected", refined: a service is affected by a
// change only when it has a release built from the change's OWN commit
// (exact `mergeCommitSha` match) — never merely because a LATER release of
// it happens to be a descendant that "contains" the commit in its ancestry.
// The bug this closes, live: `hello-frontend-app`'s one held release is a
// descendant of nearly every older merged commit on its repo, so every one
// of those older changes read "held in dev on hello-api-app" regardless of
// whether hello-frontend-app was ever actually built for THAT commit.
describe('Round 3 (2026-09-10 ruling A, refined) — no release means not affected', () => {
	const PR4_SHA = 'bf5be49';

	it('PR #4 (bf5be49): only hello-frontend-app has a release built from the exact commit — the other three services on the same repo are unaffected', () => {
		const frontendDev = mkRollout({
			name: 'hello-frontend-app',
			namespace: 'hello-frontend-dev',
			history: [{ revision: PR4_SHA, timestamp: '2026-09-05T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const frontendStaging = mkRollout({
			name: 'hello-frontend-app',
			namespace: 'hello-frontend-staging',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: PR4_SHA, tag: 'build-4', created: '2026-09-05T00:00:00Z' }
			]
		});
		const frontendProd = mkRollout({
			name: 'hello-frontend-app',
			namespace: 'hello-frontend-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [
				{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' },
				{ revision: PR4_SHA, tag: 'build-4', created: '2026-09-05T00:00:00Z' }
			]
		});
		const api = mkRollout({
			name: 'hello-api-app',
			namespace: 'hello-api-dev',
			history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const multi = mkRollout({
			name: 'hello-multi-app',
			namespace: 'hello-multi-dev',
			// Only ever built a LATER commit — a descendant that CONTAINS
			// bf5be49 in its ancestry, but was never itself built from
			// bf5be49. Must NOT count as evidence.
			history: [{ revision: 'f7a46ae', timestamp: '2026-09-06T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const world = mkRollout({
			name: 'hello-world-app',
			namespace: 'hello-world-dev',
			history: [{ revision: 'unrelated-2', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const envs = [
			mkEnv({ app: 'hello-frontend-app', envName: 'dev', namespace: 'hello-frontend-dev' }),
			mkEnv({ app: 'hello-frontend-app', envName: 'staging', namespace: 'hello-frontend-staging' }),
			mkEnv({ app: 'hello-frontend-app', envName: 'prod', namespace: 'hello-frontend-prod' }),
			mkEnv({ app: 'hello-api-app', envName: 'dev', namespace: 'hello-api-dev' }),
			mkEnv({ app: 'hello-multi-app', envName: 'dev', namespace: 'hello-multi-dev' }),
			mkEnv({ app: 'hello-world-app', envName: 'dev', namespace: 'hello-world-dev' })
		];
		const vm = buildPrPipeline(
			meta({ mergeCommitSha: PR4_SHA, containedIn: [PR4_SHA, 'f7a46ae'], containedInAll: false }),
			[frontendDev, frontendStaging, frontendProd, api, multi, world],
			envs,
			{ items: [] },
			NOW
		);
		expect(vm.services.map((s) => s.appName)).toEqual(['hello-frontend-app']);
		expect(vm.rolloutsTotal).toBe(3);
		expect(vm.unaffectedServices.slice().sort()).toEqual([
			'hello-api-app',
			'hello-multi-app',
			'hello-world-app'
		]);
		expect(vm.noRelease).toBe(false);
	});

	it('PR #1 (c943222), the shared image: hello-world-app and hello-multi-app were built from the exact commit; hello-frontend-app only has a LATER descendant release and is excluded', () => {
		const PR1_SHA = 'c943222';
		const world = mkRollout({
			name: 'hello-world-app',
			namespace: 'hello-world-dev',
			history: [{ revision: PR1_SHA, timestamp: '2026-08-10T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const multi = mkRollout({
			name: 'hello-multi-app',
			namespace: 'hello-multi-dev',
			history: [{ revision: PR1_SHA, timestamp: '2026-08-10T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const frontend = mkRollout({
			name: 'hello-frontend-app',
			namespace: 'hello-frontend-dev',
			// hello-frontend-app's ONE release is `rel-68`, a LATER commit that
			// happens to be a descendant of (and so "contains") c943222 in the
			// backend's own commits-since list — the exact shape the third
			// operator walk found wrongly included every older change.
			history: [{ revision: 'rel-68', timestamp: '2026-09-08T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const envs = [
			mkEnv({ app: 'hello-world-app', envName: 'dev', namespace: 'hello-world-dev' }),
			mkEnv({ app: 'hello-multi-app', envName: 'dev', namespace: 'hello-multi-dev' }),
			mkEnv({ app: 'hello-frontend-app', envName: 'dev', namespace: 'hello-frontend-dev' })
		];
		const vm = buildPrPipeline(
			meta({ mergeCommitSha: PR1_SHA, containedIn: [PR1_SHA, 'rel-68'], containedInAll: false }),
			[world, multi, frontend],
			envs,
			{ items: [] },
			NOW
		);
		expect(vm.services.map((s) => s.appName).sort()).toEqual(['hello-multi-app', 'hello-world-app']);
		expect(vm.unaffectedServices).toEqual(['hello-frontend-app']);
	});

	it('an old commit whose exact release exists: its services are affected, live via the newer build once heads have moved on', () => {
		// Same shape as the "rebase merge" fixture above, restated here as its
		// own named Round 3 regression: CI's own build of the exact commit is
		// what makes the service affected; the head has since moved on to a
		// descendant, and that is what buildCell reads to call it `live`.
		const rollout = mkRollout({
			name: 'hello-frontend-app',
			namespace: 'hello-frontend-dev',
			history: [{ revision: 'newer-9', timestamp: '2026-09-08T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [{ revision: 'c0ffee1', tag: 'build-4', created: '2026-08-29T00:00:00Z' }]
		});
		const env = mkEnv({ app: 'hello-frontend-app', envName: 'dev', namespace: 'hello-frontend-dev' });
		const vm = buildPrPipeline(
			meta({ containedIn: ['c0ffee1', 'newer-9'] }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		expect(vm.services.map((s) => s.appName)).toEqual(['hello-frontend-app']);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('live');
		expect(cell.superseded).toBe(true);
	});

	it('a change with no release anywhere reads noRelease, services: []', () => {
		const rollout = mkRollout({
			name: 'hello-frontend-app',
			namespace: 'hello-frontend-dev',
			history: [{ revision: 'unrelated-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }]
		});
		const env = mkEnv({ app: 'hello-frontend-app', envName: 'dev', namespace: 'hello-frontend-dev' });
		const vm = buildPrPipeline(
			meta({ mergeCommitSha: 'deadfeed', containedIn: ['deadfeed'] }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		expect(vm.services).toEqual([]);
		expect(vm.noRelease).toBe(true);
		// ⭐ ROUND 3B (2026-09-10) — "no release for this commit", not "…yet":
		// "yet" promises a future build this dashboard cannot back up (it
		// cannot tell a skipped build from a failed one).
		expect(vm.verdict).toBe('No release for this commit');
	});
});
