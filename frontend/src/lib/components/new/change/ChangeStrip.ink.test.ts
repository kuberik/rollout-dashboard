import { describe, test, expect } from 'vitest';
import { siteWordInk } from './ChangeStrip.svelte';

describe('ChangeStrip: a site row word ink', () => {
	test('failing now reads danger, a recovered failure reads neutral', () => {
		expect(siteWordInk({ state: 'failed', recovered: false })).toBe('text-danger');
		expect(siteWordInk({ state: 'failed', recovered: true })).toBe('text-fg-muted');
	});
	test('quiet states carry no ink', () => {
		expect(siteWordInk({ state: 'deployed', recovered: false })).toBeUndefined();
	});
});
