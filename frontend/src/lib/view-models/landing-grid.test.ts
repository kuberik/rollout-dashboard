import { describe, it, expect } from 'vitest';
import { buildLandingGrid } from './landing-grid';
import type { PrCell, PrPipelineVM, PrService, PrState } from './pr-pipeline';
import type { EnvironmentTheme } from '../environment-theme';

const NOW = new Date('2026-09-10T12:00:00Z');

function theme(name: string): EnvironmentTheme {
	return {
		name,
		label: name,
		environmentName: name,
		color: '#000000',
		textColor: '#111111',
		borderColor: '#222222',
		surfaceColor: '#ffffff',
		darkSurfaceColor: '#000000',
		darkTextColor: '#eeeeee',
		darkBorderColor: '#dddddd'
	};
}

function mkCell(overrides: Partial<PrCell> & { envName: string; state: PrState }): PrCell {
	return {
		cluster: 'rollout-a',
		namespace: 'default',
		rolloutName: `${overrides.envName}-app`,
		theme: theme(overrides.envName),
		envRank: 0,
		reason: '',
		since: null,
		usuallyMs: null,
		bakeLeftMs: null,
		releaseLabel: 'v1.0.0',
		revision: 'abc1234',
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
		sourceRepo: 'github.com/littlechimera/kuberik-testing',
		cells,
		furthest: '',
		furthestCompact: '',
		leadTimeMs: null
	};
}

function mkVm(services: PrService[]): PrPipelineVM {
	return { services, verdict: '' };
}

// Every `PrState`, once, so the state-table mapping (`classify`, the family
// collapse's worst-cell pick) is exercised for all twelve.
const ALL_STATES: PrState[] = [
	'not-built',
	'gated',
	'pinned',
	'waiting-upstream',
	'promoting',
	'deploying',
	'baking',
	'retrying',
	'failed',
	'cancelled',
	'rolled-back',
	'live'
];

describe('buildLandingGrid — all 12 states', () => {
	it.each(ALL_STATES)('produces a mark for a lone %s cell', (state) => {
		const cell = mkCell({ envName: 'dev', state });
		const grid = buildLandingGrid(mkVm([mkService('svc', [cell])]), NOW);
		expect(grid.services).toHaveLength(1);
		expect(grid.services[0].marks).toHaveLength(1);
		expect(grid.services[0].marks[0].state).toBe(state);
		expect(grid.services[0].marks[0].family).toBe('DEV');
		expect(grid.services[0].marks[0].count).toBe(1);
	});

	it('classifies verdictWord as the closed vocabulary', () => {
		const cases: [PrState, string][] = [
			['failed', 'failed'],
			['gated', 'held'],
			['pinned', 'held'],
			['waiting-upstream', 'held'],
			['deploying', 'active'],
			['baking', 'active'],
			['retrying', 'active'],
			['cancelled', 'active'],
			['rolled-back', 'active'],
			['promoting', 'active'],
			['not-built', 'not-built'],
			['live', 'live']
		];
		for (const [state, expected] of cases) {
			const grid = buildLandingGrid(
				mkVm([mkService('svc', [mkCell({ envName: 'dev', state })])]),
				NOW
			);
			expect(grid.services[0].verdictWord).toBe(expected);
		}
	});
});

describe('buildLandingGrid — family collapse (regions)', () => {
	it('collapses a 3-region prod set into one mark with the group size as count', () => {
		const cells = [
			mkCell({ envName: 'prod-us-east-1', state: 'live' }),
			mkCell({ envName: 'prod-us-east-2', state: 'live' }),
			mkCell({ envName: 'prod-eu-west-1', state: 'held' as PrState })
		].map((c, i) => (i < 2 ? c : { ...c, state: 'gated' as PrState }));
		const grid = buildLandingGrid(mkVm([mkService('svc', cells)]), NOW);
		expect(grid.services[0].marks).toHaveLength(1);
		const mark = grid.services[0].marks[0];
		expect(mark.family).toBe('PRD');
		expect(mark.count).toBe(3);
		// Worst state wins the collapse — two live, one gated (held-like).
		expect(mark.state).toBe('gated');
	});

	it('never lets a 19-character env name appear in a mark\'s visible text', () => {
		const cells = [
			mkCell({ envName: 'hello-world-staging', state: 'live' }),
			mkCell({ envName: 'hello-world-prod', state: 'live' })
		];
		const grid = buildLandingGrid(mkVm([mkService('svc', cells)]), NOW);
		const families = grid.services[0].marks.map((m) => m.family);
		expect(families).toEqual(['STG', 'PRD']);
		for (const m of grid.services[0].marks) {
			expect(m.family.length).toBeLessThanOrEqual(4);
			expect(m.family).not.toContain('hello-world');
		}
		// The full name still survives in `sentence` (the mark's `title`).
		expect(grid.services[0].marks[0].sentence).toContain('hello-world-staging');
	});

	it('falls back to the first 3 letters, uppercased, for an unmatched env name', () => {
		const cells = [mkCell({ envName: 'canary', state: 'live' })];
		const grid = buildLandingGrid(mkVm([mkService('svc', cells)]), NOW);
		expect(grid.services[0].marks[0].family).toBe('CAN');
	});

	it('stages never collapse — dev and prod stay two separate marks', () => {
		const cells = [
			mkCell({ envName: 'dev', state: 'live' }),
			mkCell({ envName: 'prod', state: 'live' })
		];
		const grid = buildLandingGrid(mkVm([mkService('svc', cells)]), NOW);
		expect(grid.services[0].marks.map((m) => m.family)).toEqual(['DEV', 'PRD']);
	});
});

describe('buildLandingGrid — the all-same fold', () => {
	it('collapses to one label when every service shares the same family/state sequence', () => {
		const svc1 = mkService('frontend', [
			mkCell({ envName: 'dev', state: 'live' }),
			mkCell({ envName: 'prod', state: 'gated' })
		]);
		const svc2 = mkService('api', [
			mkCell({ envName: 'dev', state: 'live' }),
			mkCell({ envName: 'prod', state: 'gated' })
		]);
		const grid = buildLandingGrid(mkVm([svc1, svc2]), NOW);
		expect(grid.allSameLabel).toBe('all 2 services');
		expect(grid.visible).toHaveLength(2);
		expect(grid.overflow).toBeNull();
	});

	it('does not fold when services differ by state', () => {
		const svc1 = mkService('frontend', [mkCell({ envName: 'dev', state: 'live' })]);
		const svc2 = mkService('api', [mkCell({ envName: 'dev', state: 'failed' })]);
		const grid = buildLandingGrid(mkVm([svc1, svc2]), NOW);
		expect(grid.allSameLabel).toBeNull();
	});

	it('singular label for one service', () => {
		const grid = buildLandingGrid(
			mkVm([mkService('frontend', [mkCell({ envName: 'dev', state: 'live' })])]),
			NOW
		);
		expect(grid.allSameLabel).toBe('all 1 service');
	});
});

describe('buildLandingGrid — the +N services cap', () => {
	it('shows at most 3 groups worst-first and folds the rest into overflow', () => {
		const services = [
			mkService('live-svc', [mkCell({ envName: 'dev', state: 'live' })]),
			mkService('failed-svc', [mkCell({ envName: 'dev', state: 'failed' })]),
			mkService('held-svc', [mkCell({ envName: 'dev', state: 'gated' })]),
			mkService('active-svc', [mkCell({ envName: 'dev', state: 'deploying' })]),
			mkService('not-built-svc', [mkCell({ envName: 'dev', state: 'not-built' })])
		];
		const grid = buildLandingGrid(mkVm(services), NOW);
		expect(grid.allSameLabel).toBeNull();
		expect(grid.visible.map((s) => s.appName)).toEqual(['failed-svc', 'held-svc', 'active-svc']);
		expect(grid.overflow).toEqual({ count: 2, title: 'not-built-svc, live-svc' });
	});

	it('sets overflow to null when there are 3 or fewer services', () => {
		const services = [
			mkService('a', [mkCell({ envName: 'dev', state: 'failed' })]),
			mkService('b', [mkCell({ envName: 'dev', state: 'live' })])
		];
		const grid = buildLandingGrid(mkVm(services), NOW);
		expect(grid.overflow).toBeNull();
		expect(grid.visible).toHaveLength(2);
	});
});

describe('buildLandingGrid — edges', () => {
	it('returns an empty grid for no services', () => {
		const grid = buildLandingGrid(mkVm([]), NOW);
		expect(grid.services).toEqual([]);
		expect(grid.allSameLabel).toBeNull();
		expect(grid.visible).toEqual([]);
		expect(grid.overflow).toBeNull();
	});

	it('landedCount/total count pre-collapse cells, not marks', () => {
		const cells = [
			mkCell({ envName: 'prod-us-east-1', state: 'live' }),
			mkCell({ envName: 'prod-us-east-2', state: 'live' }),
			mkCell({ envName: 'dev', state: 'not-built' })
		];
		const grid = buildLandingGrid(mkVm([mkService('svc', cells)]), NOW);
		expect(grid.services[0].landedCount).toBe(2);
		expect(grid.services[0].total).toBe(3);
		// but the two prod regions still collapse to one mark
		expect(grid.services[0].marks).toHaveLength(2);
	});
});
