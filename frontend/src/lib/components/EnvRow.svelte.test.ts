import { describe, expect, it } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import EnvRow from './EnvRow.svelte';

// jsdom has no layout: this pins the markup hooks the phone rules hang on and the rules' presence;
// the measured result (one line at 350 and 390, both themes) is in the PR's screenshots.
describe('EnvRow on a phone', () => {
	const cells = [
		{ key: 'dev', label: 'dev', word: 'Deploying', fact: '2 behind', factKind: 'lag' as const },
		{ key: 'staging', label: 'staging' },
		{ key: 'prod', label: 'prod', word: 'Checking', fact: '1 of 5 regions', factKind: 'detail' as const }
	];
	it('draws the order as one row of boxes, each with a droppable fact and word', () => {
		const { container } = render(EnvRow, { cells });
		expect(container.querySelectorAll('.env-cell').length).toBe(3);
		expect(container.querySelectorAll('.env-fact').length).toBe(2);
		expect(container.querySelectorAll('.env-word').length).toBe(2);
	});
	it('a cell with a short state word prints both forms (the container picks)', () => {
		const { container } = render(EnvRow, { cells: [{ key: 'prod', label: 'prod', word: 'Needs your approval', wordShort: 'Waiting' }] });
		expect(container.querySelector('.env-word-full')?.textContent).toBe('Needs your approval');
		expect(container.querySelector('.env-word-short')?.textContent).toBe('Waiting');
	});
	it('below 380px the facts drop and the floor goes; below 300px the words drop too', () => {
		const src = readFileSync('src/lib/components/EnvRow.svelte', 'utf8');
		const phone = src.slice(src.indexOf('@container (max-width: 379.98px)'));
		expect(phone).toContain('--env-min: 0px');
		expect(phone).toContain('.env-fact { display: none; }');
		expect(src).toContain('.env-word-short { display: inline; }');
		expect(src).toContain('.env-row:has(.env-cell:nth-child(4)) .env-word,');
		expect(src).toContain('.env-row:has(.env-cell:nth-child(4)) .env-word-slot { display: none; }');
		expect(src).toMatch(/@container \(max-width: 300px\) \{\s*\.env-word,\s*\.env-word-slot \{ display: none; \}/);
	});
});

describe('EnvRow site strip (strip-dots)', () => {
	const mk = (key: string, wave: number | null, state: 'done' | 'checking' | 'deploying', name = key) => ({ key, name, wave, state, word: state, href: '/' + key });
	const prod = { key: 'prod', label: 'prod', sites: [mk('a', 1, 'done'), mk('b', 1, 'checking'), mk('c', 2, 'done')] };
	const dev = { key: 'dev', label: 'dev', sites: [mk('d', null, 'done')] };
	it('draws one mark per wave, one for a tier without waves, no per-site glyphs', () => {
		const { container } = render(EnvRow, { cells: [dev, prod] });
		expect(container.querySelectorAll('[data-tier="dev"] [data-wave-mark]').length).toBe(1);
		expect(container.querySelectorAll('[data-tier="prod"] [data-wave-mark]').length).toBe(2);
		expect(container.querySelectorAll('.env-wave-div').length).toBe(0);
		const labels = [...container.querySelectorAll('[data-tier="prod"] [data-wave-mark]')].map((e) => e.getAttribute('aria-label'));
		expect(labels).toEqual(['Wave 1: 1 deployed, 1 checking', 'Wave 2: 1 deployed']);
	});
	it('the ring goes on the wave mark that holds the here site', () => {
		const here = { ...prod, sites: [mk('a', 1, 'done'), { ...mk('b', 1, 'checking'), here: true }, mk('c', 2, 'done')] };
		const { container } = render(EnvRow, { cells: [here] });
		const slots = [...container.querySelectorAll('.env-site')];
		expect(slots.map((e) => e.classList.contains('env-site--here'))).toEqual([true, false]);
	});
	it('a multi-site box still opens the picker listing every site by wave', async () => {
		const { container, getByRole } = render(EnvRow, { cells: [prod] });
		await fireEvent.click(container.querySelector('button.env-box')!);
		const rows = [...document.querySelectorAll('[data-site-row]')].map((e) => e.getAttribute('data-site-row'));
		expect(rows).toEqual(['a', 'b', 'c']);
		expect(document.body.textContent).toContain('Wave 2');
		expect(getByRole('dialog')).toBeTruthy();
	});
});
