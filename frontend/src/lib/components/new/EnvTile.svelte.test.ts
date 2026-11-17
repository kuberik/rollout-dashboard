import { describe, test, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import EnvTile from './EnvTile.svelte';
import type { EnvTile as Tile } from './environments-page';

const tile = (places: number, apps: number) =>
	({
		key: 'dev', name: 'dev', href: '/envs/dev', places, apps, failing: 0, waiting: 0, yours: 0, moving: 0, rest: places,
		mark: 'healthy', lead: { text: 'All healthy', ink: 'muted' }, parts: [], calm: true, label: 'dev',
		arriving: { builds: 0, apps: [] }, last: null,
		regions: { cells: [], healthy: 0, held: null }
	}) as unknown as Tile;

describe('environment tile header count', () => {
	test('one place and one app read in the singular', () => {
		const { container } = render(EnvTile, { tile: tile(1, 1) });
		const t = container.querySelector('.et-cnt')?.textContent ?? '';
		expect(t).toBe('1 place · 1 app');
	});
	test('several read in the plural', () => {
		const { container } = render(EnvTile, { tile: tile(3, 2) });
		expect(container.querySelector('.et-cnt')?.textContent).toBe('3 places · 2 apps');
	});
});
