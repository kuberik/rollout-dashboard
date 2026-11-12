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
	it('the place note (the tab disagrees with the build row) shows on a phone, on its own line, and only when it carries a note', () => {
		expect(src).not.toContain('.pl-note, .pl-since { display: none; }');
		expect(src).toContain('.pl-note { grid-column: 1 / -1; white-space: normal; }');
		expect(src).toContain('.pl-note:empty { display: none; }');
	});
});

describe('PlaceRow states a pinned place as held (batch4)', () => {
	// The pin is a hold on every surface: /rollouts lists the pinned place as held-by-rule. The app page's row used to carry the raw state
	// (rolled-back) in data-truth-state, so the truth checker and anything reading the attribute saw a rolled-back place while the row said "Held by the pin".
	it('data-truth-state is the pin-aware state (placeStateWithPin), the helper every count of held places reads', () => {
		expect(src).toMatch(/placeStateWithPin/);
		expect(src).toMatch(/data-truth-state=\{placeStateWithPin\(row\.state, pinned\)\}/);
	});
});
