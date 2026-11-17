import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The compact View diff is an icon with a name and a tooltip, never an unlabelled glyph. */
const src = readFileSync(resolve(__dirname, 'DiffLink.svelte'), 'utf8');
describe('DiffLink compact', () => {
	test('icon only: the words ride in aria-label and title', () => {
		expect(src).toMatch(/title=\{compact \? 'View diff' : undefined\}/);
		expect(src).toMatch(/aria-label=\{compact \? 'View diff' : undefined\}/);
		expect(src).toMatch(/\{#if !compact\}View diff\{\/if\}/);
	});
});
