import { describe, it, expect } from 'vitest';
import { safeHref } from './safe-href';

describe('safeHref', () => {
	it.each([
		'javascript:alert(1)',
		'JaVaScRiPt:alert(1)',
		'  javascript:alert(1)',
		'\u0001\u0002javascript:alert(1)',
		'\tjava\nscript:alert(1)',
		'java\tscript:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'DATA:text/html;base64,PHNjcmlwdD4=',
		'vbscript:msgbox(1)',
		'file:///etc/passwd',
		'blob:https://x/y',
		'',
		'   ',
		null,
		undefined
	])('rejects %j', (u) => {
		expect(safeHref(u as string)).toBeUndefined();
	});

	it.each([
		['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/1'],
		['HTTP://example.com/a', 'HTTP://example.com/a'],
		['  https://example.com ', 'https://example.com'],
		['/rollouts/a/b', '/rollouts/a/b'],
		['./x', './x'],
		['?kind=failed', '?kind=failed'],
		['#frag', '#frag'],
		['a/b:c', 'a/b:c'],
		['//cdn.example.com/x', '//cdn.example.com/x']
	])('allows %j', (u, want) => {
		expect(safeHref(u)).toBe(want);
	});
});
