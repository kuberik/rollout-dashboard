import { describe, it, expect } from 'vitest';
import {
	splitRegions,
	regionSummary,
	regionLaggards,
	regionLabel,
	modalBuild,
	REGION_TILE_GRID_TEMPLATE,
	REGION_TILE_GRID_STYLE,
	REGION_TILE_MIN_WIDTH_PX,
	REGION_TILE_GAP_PX
} from './regions';

type Region = { env: string; version: string | null; adverse?: boolean };

const r = (env: string, version: string | null, adverse = false): Region => ({
	env,
	version,
	adverse
});

const versionOf = (c: Region) => c.version;
const isAdverse = (c: Region) => !!c.adverse;

describe('splitRegions', () => {
	it('keeps every healthy region as a tile', () => {
		const cells = [r('us-east', 'a44b210'), r('us-west', 'a44b210'), r('ap-se', 'a44b210')];
		const { tiles, rows } = splitRegions(cells, isAdverse);
		expect(tiles.map((c) => c.env)).toEqual(['us-east', 'us-west', 'ap-se']);
		expect(rows).toEqual([]);
	});

	it('promotes an adverse region OUT of the set into its own row', () => {
		const cells = [
			r('us-east', 'a44b210'),
			r('us-west', 'a44b210'),
			r('eu-west', 'e936e6f', true),
			r('sa-east', 'a44b210')
		];
		const { tiles, rows } = splitRegions(cells, isAdverse);
		expect(tiles.map((c) => c.env)).toEqual(['us-east', 'us-west', 'sa-east']);
		expect(rows.map((c) => c.env)).toEqual(['eu-west']);
	});

	it('preserves input order in both lists', () => {
		const cells = [r('a', 'v', true), r('b', 'v'), r('c', 'v', true), r('d', 'v')];
		const { tiles, rows } = splitRegions(cells, isAdverse);
		expect(tiles.map((c) => c.env)).toEqual(['b', 'd']);
		expect(rows.map((c) => c.env)).toEqual(['a', 'c']);
	});

	it('handles an all-adverse fan-out: no tiles, every region gets a row', () => {
		const cells = [r('us-east', 'x', true), r('eu-west', 'y', true)];
		const { tiles, rows } = splitRegions(cells, isAdverse);
		expect(tiles).toEqual([]);
		expect(rows).toHaveLength(2);
	});

	it('handles an empty fan-out', () => {
		expect(splitRegions([] as Region[], isAdverse)).toEqual({ tiles: [], rows: [] });
	});
});

describe('regionSummary — IS THE FLEET CONSISTENT?', () => {
	it('is empty for no tiles', () => {
		expect(regionSummary([] as Region[], versionOf)).toBe('');
	});

	it('reads sanely for ONE region', () => {
		expect(regionSummary([r('us-east', 'a44b210')], versionOf)).toBe('All 1 region on a44b210');
	});

	it('leads with the verdict when the fan-out is converged', () => {
		expect(regionSummary([r('us-east', 'a44b210'), r('us-west', 'a44b210')], versionOf)).toBe(
			'All 2 regions on a44b210'
		);
	});

	it('names the majority build when exactly one region straggles', () => {
		expect(regionSummary([r('us-east', 'a44b210'), r('us-west', 'e936e6f')], versionOf)).toBe(
			'1 of 2 regions on a44b210'
		);
	});

	it('reads sanely for FIVE regions with one lagging — the mockup case', () => {
		const tiles = [
			r('us-east', 'a44b210'),
			r('us-west', 'a44b210'),
			r('ap-se', 'a44b210'),
			r('sa-east', 'a44b210'),
			r('eu-west', 'e936e6f')
		];
		expect(regionSummary(tiles, versionOf)).toBe('4 of 5 regions on a44b210');
	});

	it('says SCATTERED rather than naming a majority that is not one', () => {
		// Three builds across the fan-out: no single sha is the answer, so
		// printing one as though it were is worse than printing the spread.
		const tiles = [
			r('us-east', 'a44b210'),
			r('us-west', 'a44b210'),
			r('eu-west', 'e936e6f'),
			r('ap-se', '7cdafab')
		];
		expect(regionSummary(tiles, versionOf)).toBe('4 regions across 3 builds');
	});

	it('reads sanely for TWELVE regions', () => {
		const tiles = Array.from({ length: 12 }, (_, i) =>
			r(`region-${i}`, i < 9 ? 'a44b210' : 'e936e6f')
		);
		expect(regionSummary(tiles, versionOf)).toBe('9 of 12 regions on a44b210');
	});

	it('reads sanely for TWELVE regions all in sync', () => {
		const tiles = Array.from({ length: 12 }, (_, i) => r(`region-${i}`, 'a44b210'));
		expect(regionSummary(tiles, versionOf)).toBe('All 12 regions on a44b210');
	});

	it('counts an undeployed region as a straggler rather than dropping it', () => {
		const tiles = [r('us-east', 'a44b210'), r('us-west', 'a44b210'), r('ap-se', null)];
		expect(regionSummary(tiles, versionOf)).toBe('2 of 3 regions on a44b210');
	});

	it('never invents a version when nothing has deployed', () => {
		expect(regionSummary([r('us-east', null)], versionOf)).toBe('no deploy yet');
		expect(regionSummary([r('us-east', null), r('us-west', null)], versionOf)).toBe(
			'2 regions with no deploy yet'
		);
	});

	it('breaks ties deterministically instead of by insertion order', () => {
		const a = regionSummary([r('x', 'bbb'), r('y', 'aaa')], versionOf);
		const b = regionSummary([r('y', 'aaa'), r('x', 'bbb')], versionOf);
		expect(a).toBe(b);
		expect(a).toBe('1 of 2 regions on aaa');
	});

	// THE DENOMINATOR IS THE WHOLE FLEET, not the tiles that survived the
	// split. An adverse region sitting in its own row below must still be
	// counted, or the set row says "all 5 regions" while a sixth is red.
	it('counts regions promoted OUT of the set in the denominator', () => {
		const tiles = [r('us-east', 'a44b210'), r('us-west', 'a44b210')];
		expect(regionSummary(tiles, versionOf, 3)).toBe('2 of 3 regions on a44b210');
	});

	it('never says ALL while a region has been promoted out', () => {
		const tiles = [r('us-east', 'a44b210'), r('us-west', 'a44b210')];
		expect(regionSummary(tiles, versionOf, 2)).toBe('All 2 regions on a44b210');
		expect(regionSummary(tiles, versionOf, 3)).not.toContain('All');
	});

	it('folds a promoted-out region into the spread count', () => {
		// 2 tiles on 2 builds + 1 region in its own row = 3 builds in play.
		const tiles = [r('us-east', 'a44b210'), r('us-west', 'e936e6f')];
		expect(regionSummary(tiles, versionOf, 3)).toBe('3 regions across 3 builds');
	});
});

describe('modalBuild', () => {
	it('is null when nothing has deployed', () => {
		expect(modalBuild([r('a', null)], versionOf)).toBeNull();
		expect(modalBuild([] as Region[], versionOf)).toBeNull();
	});

	it('returns the build most of the set is running, with its count', () => {
		const tiles = [r('a', 'x'), r('b', 'x'), r('c', 'y')];
		expect(modalBuild(tiles, versionOf)).toEqual({ version: 'x', count: 2 });
	});
});

describe('regionLaggards — the promote target', () => {
	it('is empty for a converged fan-out', () => {
		expect(regionLaggards([r('a', 'x'), r('b', 'x')], versionOf)).toEqual([]);
	});

	// ONE laggard is the only case where a single-rollout modal can express
	// the row's action honestly. The page keys its promote control on this.
	it('names exactly the one region off the majority build', () => {
		const tiles = [r('a', 'x'), r('b', 'x'), r('c', 'y')];
		expect(regionLaggards(tiles, versionOf).map((t) => t.env)).toEqual(['c']);
	});

	it('returns every straggler when there is more than one', () => {
		const tiles = [r('a', 'x'), r('b', 'x'), r('c', 'y'), r('d', null)];
		expect(regionLaggards(tiles, versionOf).map((t) => t.env)).toEqual(['c', 'd']);
	});

	it('preserves input order', () => {
		const tiles = [r('c', 'y'), r('a', 'x'), r('d', 'z'), r('b', 'x')];
		expect(regionLaggards(tiles, versionOf).map((t) => t.env)).toEqual(['c', 'd']);
	});

	it('is empty when nothing has deployed — there is no majority to lag', () => {
		expect(regionLaggards([r('a', null), r('b', null)], versionOf)).toEqual([]);
	});
});

describe('regionLabel', () => {
	it('drops the prod token the row header already carries', () => {
		expect(regionLabel('prod-us-east')).toBe('us-east');
		expect(regionLabel('production-eu-central')).toBe('eu-central');
		expect(regionLabel('us-west-prod')).toBe('us-west');
		expect(regionLabel('prod_ap_south')).toBe('ap_south');
	});

	it('keeps a name that is ONLY the prod token, rather than emptying the chip', () => {
		expect(regionLabel('prod')).toBe('prod');
		expect(regionLabel('production')).toBe('production');
	});

	it('leaves anything else alone', () => {
		expect(regionLabel('us-east')).toBe('us-east');
		expect(regionLabel('reproduction-1')).toBe('reproduction-1');
		expect(regionLabel('')).toBe('');
		expect(regionLabel(null)).toBe('');
	});
});

describe('the tile grid', () => {
	// The column COUNT is a function of container width, not of region
	// count — that is the property that makes 12 regions wrap instead of
	// scroll. Assert the template, not pixels, because pixels depend on a
	// layout engine this test does not have.
	it('is auto-fit, so it can never overflow horizontally', () => {
		expect(REGION_TILE_GRID_TEMPLATE).toBe('repeat(auto-fit, minmax(150px, 1fr))');
		expect(REGION_TILE_GRID_TEMPLATE).toContain('auto-fit');
		// `1fr` as the max is what lets a lone tile fill the row rather than
		// sitting at 150px with a ragged gap beside it.
		expect(REGION_TILE_GRID_TEMPLATE).toContain('1fr');
		// No fixed column count anywhere — that would be the thing that
		// overflows at 12.
		expect(REGION_TILE_GRID_TEMPLATE).not.toMatch(/repeat\(\s*\d/);
	});

	it('publishes one style string so the component cannot drift from this test', () => {
		expect(REGION_TILE_GRID_STYLE).toBe(
			'display:grid;grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));gap:8px'
		);
		expect(REGION_TILE_MIN_WIDTH_PX).toBe(150);
	});

	it('fits 12 tiles without horizontal overflow at every realistic width', () => {
		// auto-fit places floor(width / min) columns and wraps the rest, so
		// the rendered row count is ceil(n / columns) and the used width
		// never exceeds the container. Model it to prove the arithmetic.
		const columnsAt = (containerPx: number) =>
			Math.max(1, Math.floor((containerPx + REGION_TILE_GAP_PX) / (REGION_TILE_MIN_WIDTH_PX + REGION_TILE_GAP_PX)));
		for (const width of [320, 390, 640, 768, 1024, 1280, 1536]) {
			const cols = columnsAt(width);
			const usedPx = cols * REGION_TILE_MIN_WIDTH_PX + (cols - 1) * REGION_TILE_GAP_PX;
			expect(usedPx).toBeLessThanOrEqual(width);
			expect(Math.ceil(12 / cols)).toBeGreaterThanOrEqual(1);
		}
	});
});
