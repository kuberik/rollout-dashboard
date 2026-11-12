import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import WaveMark from './WaveMark.svelte';
import { waveMark, type MarkSiteState } from '$lib/view-models/wave-mark';

const draw = (states: MarkSiteState[]) => render(WaveMark, { mark: waveMark(states.map((state) => ({ state })), 'Wave 1') }).container.querySelector('svg')!;

describe('WaveMark', () => {
	it('is the same 16px box in every state (0px rule)', () => {
		for (const st of ['done', 'checking', 'deploying', 'held', 'failed', 'notreached'] as MarkSiteState[]) {
			const svg = draw([st]);
			expect([svg.getAttribute('width'), svg.getAttribute('height'), svg.getAttribute('viewBox')]).toEqual(['16', '16', '0 0 16 16']);
		}
		const mixed = draw(['done', 'checking']);
		expect([mixed.getAttribute('width'), mixed.getAttribute('height')]).toEqual(['16', '16']);
	});
	it('carries an accessible label that sums its sites', () => {
		expect(draw(['done', 'checking']).getAttribute('aria-label')).toBe('Wave 1: 1 deployed, 1 checking');
	});
	it('draws a pie slice per state and no icon glyph', () => {
		const svg = draw(['done', 'checking']);
		expect(svg.getAttribute('data-kinds')).toBe('done checking');
		expect(svg.querySelector('.wm-solid')).not.toBeNull();
		expect(svg.querySelector('line, polyline, text')).toBeNull();
	});
	it('only checking breathes and only deploying sweeps', () => {
		expect(draw(['done']).querySelector('.wm-halo, .wm-sweep')).toBeNull();
		expect(draw(['checking']).querySelector('.wm-halo')).not.toBeNull();
		expect(draw(['deploying']).querySelector('.wm-sweep')).not.toBeNull();
		expect(draw(['done', 'deploying']).querySelectorAll('.wm-sweep')).toHaveLength(1);
	});
	it('reduced motion is static: animations exist only inside no-preference, transform and opacity only', () => {
		const src = readFileSync('src/lib/components/WaveMark.svelte', 'utf8');
		const css = src.slice(src.indexOf('<style>'));
		const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\t\}\n/, '');
		expect(outside).not.toMatch(/animation\s*:/);
		expect(css).toMatch(/prefers-reduced-motion: reduce\) \{[\s\S]*\.wm-sweep[\s\S]*opacity: 0[\s\S]*\.wm-track[\s\S]*fill-opacity: 1/);
		expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*animation: wm-breathe[\s\S]*animation: wm-sweep/);
		const keyframes = css.slice(css.indexOf('@keyframes'));
		expect(keyframes.match(/[a-z-]+(?=\s*:)/g)!.filter((p) => !['opacity', 'transform'].includes(p))).toEqual([]);
	});
});
