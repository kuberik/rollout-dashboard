import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The shared dot list draws the "·" the text lines beside it print: a dot no wider than a text middle dot (about 2px), still a background in the fact's left padding so no separator sits at a line edge. */
describe('dot list separator', () => {
	const css = readFileSync(join(__dirname, '../styles/language.css'), 'utf8');
	const rule = css.slice(css.indexOf('.dot-list .dot-list-row > *,'));
	const block = rule.slice(0, rule.indexOf('}'));
	it('is a small disc, not a bullet', () => {
		const m = /radial-gradient\(circle, var\(--k-fg-disabled\) ([\d.]+)px, transparent ([\d.]+)px\)/.exec(block);
		expect(m).toBeTruthy();
		expect(parseFloat(m![2])).toBeLessThanOrEqual(1.2);
	});
	it('keeps the wrap rule: a background in the fact padding, row pulled into a clip', () => {
		expect(block).toContain('padding-left: 20px');
		expect(css).toMatch(/\.dot-list-row \{\s*margin-left: -20px;/);
		expect(css).toMatch(/\.dot-list \{\s*overflow: hidden;/);
	});
});
