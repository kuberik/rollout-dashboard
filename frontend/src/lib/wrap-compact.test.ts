import { describe, expect, it } from 'vitest';
import { topsWrap } from './wrap-compact';

describe('topsWrap', () => {
	it('is false for one line, an empty row and sub-pixel jitter', () => {
		expect(topsWrap([])).toBe(false);
		expect(topsWrap([10])).toBe(false);
		expect(topsWrap([10, 10, 11.5])).toBe(false);
	});
	it('is true as soon as any child sits on a later line', () => {
		expect(topsWrap([10, 10, 28])).toBe(true);
		expect(topsWrap([10, 30, 30])).toBe(true);
	});
});
