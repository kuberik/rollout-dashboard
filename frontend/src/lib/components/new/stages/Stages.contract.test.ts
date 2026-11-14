import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// jsdom has no layout: this pins the rules that keep the Progress card's release line whole at narrow card widths (narrow-cards, 2026-11-14).
// Before, at a 326-425px card the title shrank to "#" / "#38 S…" and View change pushed past the card padding. The measured sweep is in the PR.
const src = readFileSync('src/lib/components/new/stages/Stages.svelte', 'utf8');
describe('Progress release line degrades by width, never to a lone "#"', () => {
	it('the line is its own size container, and below 600px it splits in two lines', () => {
		expect(src).toContain('.stg-rel-cq { container-type: inline-size; }');
		expect(src).toContain('@container (max-width: 599.98px)');
		expect(src).toContain('.stg-rel-br { display: block; order: 9; flex: 0 0 100%; height: 0; }');
	});
	it('the title takes line 2 (the only part that gives), with the age at its end', () => {
		expect(src).toContain('.stg-rel-title { order: 10; flex: 1 1 0; margin-top: 4px; }');
		expect(src).toContain('.stg-rel-br + .stg-rel-age { order: 11; margin-top: 4px; margin-left: auto; }');
	});
	it('the break exists only when the line names a titled release itself', () => {
		expect(src).toContain('{#if !inRail && release.title}<span class="stg-rel-br" aria-hidden="true"></span>{/if}');
	});
	it('View change never shrinks', () => {
		expect(src).toMatch(/class="nav-link -my-2 ml-auto shrink-0[^"]*" data-release-change/);
	});
});
