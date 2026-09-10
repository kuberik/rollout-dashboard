import { describe, it, expect } from 'vitest';
import { buildPrPipeline, type PrPipelineMeta } from './pr-pipeline';
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

	it('rebase merge: the build sha is a DESCENDANT of the merge commit, still live', () => {
		// The backend's commits-since(mergedAt) list covers every commit after
		// the merge on base, not just the merge commit itself — a later
		// deploy of a sha further down that list still contains the PR.
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-dev',
			history: [
				{ revision: 'deadbeef2', timestamp: '2026-09-03T00:00:00Z', bakeStatus: 'Succeeded' }
			]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'dev', namespace: 'widget-dev' });
		const vm = buildPrPipeline(
			meta({ containedIn: ['c0ffee1', 'deadbeef2'] }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
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
		expect(cells.find((c) => c.cluster === 'cluster-b')?.state).toBe('not-built');
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

	it('metadataUnresolved: gated, "manifest unreadable"', () => {
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
		expect(cell.state).toBe('gated');
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
			]
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

	it('the containedInAll fallback: a release created after mergedAt counts as contained even off the truncated list', () => {
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
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(
			meta({ containedIn: [], containedInAll: false }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		const cell = vm.services[0].cells[0];
		// Contained via the fallback -> a build exists, so this is NOT not-built.
		expect(cell.state).not.toBe('not-built');
		expect(cell.revision).toBe('unlisted-later');
	});

	it('the containedInAll fallback, the other direction: a release created BEFORE mergedAt is not-contained', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [{ revision: 'old-1', tag: 'old-1', created: '2026-08-01T00:00:00Z' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(
			meta({ containedIn: [], containedInAll: false }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		expect(vm.services[0].cells[0].state).toBe('not-built');
	});

	it('nil `created`: not built (unverified), never claimed contained', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-01T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [{ revision: 'unknown-created', tag: 'unknown-created' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(
			meta({ containedIn: [], containedInAll: false }),
			[rollout],
			[env],
			{ items: [] },
			NOW
		);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('not-built');
		expect(cell.reason).toBe('not built (unverified)');
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

	it('not-built: no release anywhere carries the PR', () => {
		const rollout = mkRollout({
			name: 'widget-app',
			namespace: 'widget-prod',
			history: [{ revision: 'old-1', timestamp: '2026-08-20T00:00:00Z', bakeStatus: 'Succeeded' }],
			availableReleases: [{ revision: 'old-1', tag: 'old-1', created: '2026-08-20T00:00:00Z' }]
		});
		const env = mkEnv({ app: 'widget-app', envName: 'prod', namespace: 'widget-prod' });
		const vm = buildPrPipeline(meta(), [rollout], [env], { items: [] }, NOW);
		const cell = vm.services[0].cells[0];
		expect(cell.state).toBe('not-built');
		expect(cell.reason).toBe('not built here yet');
		expect(cell.revision).toBeNull();
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
		expect(vm.verdict).toBe('Baking in staging');
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
		expect(vm.verdict).toBe('Waiting in prod on api-app');
	});

	it('verdict: gated names the rule, never "on [object Object]" or a raw sentence', () => {
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
		expect(vm.services[0].cells[0].state).toBe('gated');
		expect(vm.verdict).toBe('Waiting in prod on hello-world-manual-approval');
	});

	it('verdict: gated with nothing actually blocking reads as ready, not a broken "on" clause', () => {
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
		expect(vm.services[0].cells[0].gateLabel).toBeNull();
		expect(vm.verdict).toBe('Ready in prod, not promoted yet');
	});
});
