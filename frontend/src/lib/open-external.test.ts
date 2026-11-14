import { afterEach, describe, expect, it, vi } from 'vitest';
import { openExternal } from './open-external';

describe('openExternal', () => {
	const open = vi.fn();
	vi.stubGlobal('window', { open });
	afterEach(() => open.mockClear());

	it.each([
		'javascript:alert(1)',
		'javascript://%0aalert(1)',
		' \tJaVa\nScRiPt:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:x',
		'',
		null,
		undefined
	])('does not open %j', (u) => {
		expect(openExternal(u)).toBe(false);
		expect(open).not.toHaveBeenCalled();
	});

	it('opens https with noopener', () => {
		expect(openExternal('https://github.com/o/r/tree/abc')).toBe(true);
		expect(open).toHaveBeenCalledWith('https://github.com/o/r/tree/abc', '_blank', 'noopener,noreferrer');
	});
});
