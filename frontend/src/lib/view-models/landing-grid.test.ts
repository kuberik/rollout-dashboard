import { describe, it, expect } from 'vitest';
import { buildLandingGrid, orderByVerdict, classify, worstCell } from './landing-grid';
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
		containmentKnown: true,
		...overrides
	};
}

function mkService(appName: string, cells: PrCell[], builtElsewhere = false): PrService {
	return {
		appName,
		sourceRepo: 'github.com/littlechimera/kuberik-testing',
		cells,
		furthest: '',
		furthestCompact: '',
		leadTimeMs: null,
		builtElsewhere
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
		expect(grid.services[0].marks[0].familyOrder).toBe(0); // DEV — first tier
	});

	// ⭐ RULING 6 (CHANGES-2026-09-10 fix pass, "GRID DATA"). State-only colour:
	// identity (family word + ring) never moves, tone is the sole state channel.
	it('tone: held-like states are `stuck` (amber\'s one reserved meaning), never `held`', () => {
		const cases: [PrState, string][] = [
			['failed', 'failed'],
			['gated', 'stuck'],
			['pinned', 'stuck'],
			['waiting-upstream', 'stuck'],
			['deploying', 'active'],
			['baking', 'active'],
			['not-built', 'none'],
			['live', 'live']
		];
		for (const [state, expectedTone] of cases) {
			const grid = buildLandingGrid(mkVm([mkService('svc', [mkCell({ envName: 'dev', state })])]), NOW);
			expect(grid.services[0].marks[0].tone).toBe(expectedTone);
		}
	});

	it('familyOrder aligns DEV/TEST/STG/PRD across services, in canonical tier order', () => {
		const cells = [
			mkCell({ envName: 'dev', state: 'live' }),
			mkCell({ envName: 'staging', state: 'live' }),
			mkCell({ envName: 'prod', state: 'live' })
		];
		const grid = buildLandingGrid(mkVm([mkService('svc', cells)]), NOW);
		const byFamily = new Map(grid.services[0].marks.map((m) => [m.family, m.familyOrder]));
		expect(byFamily.get('DEV')).toBeLessThan(byFamily.get('STG')!);
		expect(byFamily.get('STG')).toBeLessThan(byFamily.get('PRD')!);
	});

	it('an unmatched family (fallback 3-letter name) sorts after every named tier', () => {
		const grid = buildLandingGrid(
			mkVm([mkService('svc', [mkCell({ envName: 'canary', state: 'live' })])]),
			NOW
		);
		expect(grid.services[0].marks[0].familyOrder).toBeGreaterThan(3);
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

describe('buildLandingGrid — builtElsewhere threads into the mark sentence (ruling 2)', () => {
	it('a not-built mark on a service with builtElsewhere:true reads "no build of this change for this service"', () => {
		const grid = buildLandingGrid(
			mkVm([mkService('svc', [mkCell({ envName: 'dev', state: 'not-built' })], true)]),
			NOW
		);
		expect(grid.services[0].marks[0].sentence).toContain('no build of this change for this service');
	});

	it('a not-built mark with builtElsewhere:false reads the plain "not built yet"', () => {
		const grid = buildLandingGrid(
			mkVm([mkService('svc', [mkCell({ envName: 'dev', state: 'not-built' })], false)]),
			NOW
		);
		expect(grid.services[0].marks[0].sentence).toContain('not built yet');
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

// ⭐ RULING 6 (CHANGES-2026-09-10 fix pass, "GRID DATA"). VM-level truncation
// is retired: `visible` is now EVERY service, adverse-first then
// alphabetical, and `overflow` is always `null` — the +N fold is
// `LandingGrid.svelte`'s own `max` prop against this ordered list now.
describe('buildLandingGrid — services are never truncated (ruling 6)', () => {
	it('orders every service adverse-first, then alphabetical, and never truncates', () => {
		const services = [
			mkService('live-svc', [mkCell({ envName: 'dev', state: 'live' })]),
			mkService('failed-svc', [mkCell({ envName: 'dev', state: 'failed' })]),
			mkService('held-svc', [mkCell({ envName: 'dev', state: 'gated' })]),
			mkService('active-svc', [mkCell({ envName: 'dev', state: 'deploying' })]),
			mkService('not-built-svc', [mkCell({ envName: 'dev', state: 'not-built' })])
		];
		const grid = buildLandingGrid(mkVm(services), NOW);
		expect(grid.allSameLabel).toBeNull();
		expect(grid.visible.map((s) => s.appName)).toEqual([
			'failed-svc',
			'held-svc',
			'active-svc',
			'not-built-svc',
			'live-svc'
		]);
		expect(grid.overflow).toBeNull();
	});

	it('breaks ties alphabetically within the same verdict word', () => {
		// Different envs (so the two services' mark SIGNATURES differ and the
		// all-same fold does not swallow the ordering this test targets) but
		// the same worst classification (`failed`) either way.
		const services = [
			mkService('zebra', [mkCell({ envName: 'dev', state: 'failed' })]),
			mkService('apple', [mkCell({ envName: 'prod', state: 'failed' })])
		];
		const grid = buildLandingGrid(mkVm(services), NOW);
		expect(grid.visible.map((s) => s.appName)).toEqual(['apple', 'zebra']);
	});
});

describe('orderByVerdict (ruling 6 — the SAME order function the change page\'s cards use)', () => {
	it('sorts adverse-first, then alphabetical, over any shape with a verdictWord/name', () => {
		const items = [
			{ name: 'z', word: 'live' as const },
			{ name: 'a', word: 'failed' as const },
			{ name: 'm', word: 'held' as const }
		];
		const ordered = orderByVerdict(
			items,
			(i) => i.word,
			(i) => i.name
		);
		expect(ordered.map((i) => i.name)).toEqual(['a', 'm', 'z']);
	});
});

describe('classify / worstCell — exported for cross-module reuse (ruling 6)', () => {
	it('classify folds every PrState to the closed vocabulary', () => {
		expect(classify('failed')).toBe('failed');
		expect(classify('gated')).toBe('held');
		expect(classify('not-built')).toBe('not-built');
		expect(classify('live')).toBe('live');
		expect(classify('deploying')).toBe('active');
	});

	it('worstCell picks the worst-ranked cell', () => {
		const live = mkCell({ envName: 'dev', state: 'live' });
		const failed = mkCell({ envName: 'prod', state: 'failed' });
		expect(worstCell([live, failed])).toBe(failed);
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
