import { describe, it, expect } from 'vitest';
import {
	mergedPullServiceSummary,
	openPullAgeSummary,
	servicesForMergedPull,
	myPullSummary
} from './my-pulls';
import type { PrCell, PrService } from './pr-pipeline';
import type { Rollout, Environment } from '$lib/../types';
import type { MyPull } from '$lib/api/my-pulls';

const NOW = new Date('2026-09-10T12:00:00Z');

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

describe('mergedPullServiceSummary', () => {
	it('names no services when the repo has none on this cluster', () => {
		expect(mergedPullServiceSummary([])).toBe('not built here');
	});

	it('is "live everywhere" shaped when every service is live', () => {
		const services = [
			mkService('a', [mkCell('live')]),
			mkService('b', [mkCell('live')])
		];
		expect(mergedPullServiceSummary(services)).toBe('live in 2 of 2 services');
	});

	it("the design doc's own example: live in 2 of 3, held in the third", () => {
		const services = [
			mkService('hello-frontend-app', [mkCell('gated')]),
			mkService('hello-api-app', [mkCell('live')]),
			mkService('hello-worker-app', [mkCell('live')])
		];
		expect(mergedPullServiceSummary(services)).toBe(
			'live in 2 of 3 services · held in hello-frontend-app'
		);
	});

	it('a service counts as live if ANY of its envs is live, even if another env is held', () => {
		const services = [mkService('a', [mkCell('gated'), mkCell('live', { envName: 'prod' })])];
		expect(mergedPullServiceSummary(services)).toBe('live in 1 of 1 service');
	});

	it('names every held service when none is live yet', () => {
		const services = [
			mkService('hello-frontend-app', [mkCell('pinned')]),
			mkService('hello-api-app', [mkCell('waiting-upstream')])
		];
		expect(mergedPullServiceSummary(services)).toBe(
			'held in hello-frontend-app, hello-api-app'
		);
	});

	it('a failed build counts as held, not as its own bucket', () => {
		const services = [mkService('a', [mkCell('failed')])];
		expect(mergedPullServiceSummary(services)).toBe('held in a');
	});

	it('reports in-progress deploys when nothing is live or held yet', () => {
		const services = [mkService('a', [mkCell('baking')]), mkService('b', [mkCell('not-built')])];
		expect(mergedPullServiceSummary(services)).toBe('1 of 2 building');
	});

	it('falls back to "not built yet" when every service has no build at all', () => {
		const services = [mkService('a', [mkCell('not-built')])];
		expect(mergedPullServiceSummary(services)).toBe('not built yet');
	});
});

describe('openPullAgeSummary', () => {
	it('prints "open <compact age>" — the design doc\'s own "open 3d"', () => {
		const openedAt = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
		expect(openPullAgeSummary(openedAt, NOW)).toBe('open 3d');
	});

	it('degrades to a bare "open" rather than throwing when openedAt is missing', () => {
		expect(openPullAgeSummary(null, NOW)).toBe('open');
	});
});

const SOURCE = 'github.com/acme/widget';

function mkRollout(opts: {
	name: string;
	history?: { revision: string; timestamp: string }[];
	availableReleases?: { revision: string; created?: string }[];
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
				version: { tag: h.revision, revision: h.revision }
			})),
			availableReleases: (opts.availableReleases ?? []).map((r) => ({
				tag: r.revision,
				revision: r.revision,
				created: r.created
			}))
		}
	} as unknown as Rollout;
}

function mkEnv(name: string): Environment {
	return {
		metadata: { name, namespace: 'default' },
		spec: { environmentSelector: {} }
	} as unknown as Environment;
}

describe('servicesForMergedPull + myPullSummary integration', () => {
	const environments = [mkEnv('dev')];

	it('finds a live service by exact mergeCommitSha membership, no commits fetch needed', () => {
		const rollouts = [
			mkRollout({ name: 'widget-app', history: [{ revision: 'c0ffee1', timestamp: '2026-09-05T00:00:00Z' }] })
		];
		const services = servicesForMergedPull(
			{ owner: 'acme', repo: 'widget', number: 1, mergedAt: '2026-09-01T00:00:00Z', mergeCommitSha: 'c0ffee1' },
			rollouts,
			environments,
			null,
			NOW
		);
		expect(mergedPullServiceSummary(services)).toBe('live in 1 of 1 service');
	});

	it('under-reports a rebase-merge repo whose head is an earlier commit of the same rebase (documented limitation)', () => {
		// The service's head is a DIFFERENT sha than mergeCommitSha (as a real
		// rebase would produce) — exact-match containment cannot see it.
		const rollouts = [
			mkRollout({ name: 'widget-app', history: [{ revision: 'deadbeef', timestamp: '2026-09-05T00:00:00Z' }] })
		];
		const services = servicesForMergedPull(
			{ owner: 'acme', repo: 'widget', number: 1, mergedAt: '2026-09-01T00:00:00Z', mergeCommitSha: 'c0ffee1' },
			rollouts,
			environments,
			null,
			NOW
		);
		expect(mergedPullServiceSummary(services)).toBe('not built yet');
	});

	it('myPullSummary dispatches merged PRs through the service pipeline', () => {
		const rollouts = [
			mkRollout({ name: 'widget-app', history: [{ revision: 'c0ffee1', timestamp: '2026-09-05T00:00:00Z' }] })
		];
		const pull: MyPull = {
			owner: 'acme',
			repo: 'widget',
			number: 1,
			title: 'fix: retry',
			htmlUrl: '',
			state: 'merged',
			openedAt: '2026-08-30T00:00:00Z',
			mergedAt: '2026-09-01T00:00:00Z',
			mergeCommitSha: 'c0ffee1',
			headSha: 'c0ffee1',
			base: 'main',
			updatedAt: '2026-09-01T00:00:00Z'
		};
		expect(myPullSummary(pull, rollouts, environments, null, NOW)).toBe('live in 1 of 1 service');
	});

	it('myPullSummary dispatches open PRs to the age summary, never touching the pipeline', () => {
		const pull: MyPull = {
			owner: 'acme',
			repo: 'widget',
			number: 2,
			title: 'wip: something',
			htmlUrl: '',
			state: 'open',
			openedAt: new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
			mergedAt: null,
			mergeCommitSha: null,
			headSha: 'abc1234',
			base: 'main',
			updatedAt: NOW.toISOString()
		};
		expect(myPullSummary(pull, [], environments, null, NOW)).toBe('open 3d');
	});

	it('myPullSummary names a closed-without-merging PR rather than guessing', () => {
		const pull: MyPull = {
			owner: 'acme',
			repo: 'widget',
			number: 3,
			title: 'abandoned',
			htmlUrl: '',
			state: 'closed',
			openedAt: '2026-08-01T00:00:00Z',
			mergedAt: null,
			mergeCommitSha: null,
			headSha: null,
			base: 'main',
			updatedAt: '2026-08-05T00:00:00Z'
		};
		expect(myPullSummary(pull, [], environments, null, NOW)).toBe('closed without merging');
	});
});
