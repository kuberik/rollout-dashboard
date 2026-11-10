import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// jsdom has no layout: this pins the rules that stop PlaceRow clipping (landing, 2026-11-10); the measured result is in the PR screenshots.
const src = readFileSync('src/lib/components/new/app/PlaceRow.svelte', 'utf8');
describe('PlaceRow never clips', () => {
	it('a chip that names a region takes the phone row and the state word sits under it', () => {
		expect(src).toContain('class:pl-mid--long={label.length > 8}');
		expect(src).toContain('.pl-mid--long { grid-template-columns: minmax(0, 1fr); }');
	});
	it('the state word + wave fact wraps instead of ellipsising, in a track at least 200px wide', () => {
		expect(src).not.toContain('text-overflow: ellipsis');
		expect(src).toContain('168px minmax(200px, max-content) minmax(0, 1fr) 64px');
	});
});
