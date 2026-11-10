import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
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
		expect(src).toContain('.env-row:has(.env-cell:nth-child(4)) .env-word { display: none; }');
		expect(src).toMatch(/@container \(max-width: 300px\) \{\s*\.env-word \{ display: none; \}/);
	});
});
