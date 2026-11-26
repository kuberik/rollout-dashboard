import { describe, expect, it } from 'vitest';
import { sourceTreeUrl } from './source-url';

describe('sourceTreeUrl', () => {
	it('adds https:// to a source with no scheme (qa9 B3: the mock source)', () => {
		expect(sourceTreeUrl('github.com/exampleco/checkout', 'a02f1c4')).toBe('https://github.com/exampleco/checkout/tree/a02f1c4');
	});
	it('keeps an explicit scheme', () => {
		expect(sourceTreeUrl('https://github.com/o/r', 'v1')).toBe('https://github.com/o/r/tree/v1');
		expect(sourceTreeUrl('http://git.example.com/o/r', 'v1')).toBe('http://git.example.com/o/r/tree/v1');
	});
	it('turns an SSH remote into https and drops .git', () => {
		expect(sourceTreeUrl('git@github.com:o/r.git', 'abc')).toBe('https://github.com/o/r/tree/abc');
		expect(sourceTreeUrl('ssh://git@github.com/o/r.git', 'abc')).toBe('https://github.com/o/r/tree/abc');
	});
	it('drops a trailing slash and .git', () => {
		expect(sourceTreeUrl('https://github.com/o/r.git/', 'abc')).toBe('https://github.com/o/r/tree/abc');
		expect(sourceTreeUrl('github.com/o/r/', 'abc')).toBe('https://github.com/o/r/tree/abc');
	});
	it('is empty without a source', () => {
		expect(sourceTreeUrl('', 'abc')).toBe('');
		expect(sourceTreeUrl(undefined, 'abc')).toBe('');
	});
	it('is never relative', () => {
		for (const s of ['github.com/o/r', 'git@github.com:o/r', 'https://github.com/o/r', 'gitlab.com/o/r.git'])
			expect(sourceTreeUrl(s, 'x')).toMatch(/^https?:\/\//);
	});
	it('is empty unless the result is http(s) (OCI annotation is attacker-controlled)', () => {
		for (const s of [
			'javascript://%0aalert(1)',
			'JaVaScRiPt://x',
			'data://text/html,<script>alert(1)</script>',
			'vbscript://x',
			' javascript://%0aalert(1)',
			'\tjavascript://%0aalert(1)',
			'\n JaVaScRiPt://x/y\t'
		])
			expect(sourceTreeUrl(s, 'abc'), JSON.stringify(s)).toBe('');
	});
	it('still builds https URLs for the supported forms', () => {
		expect(sourceTreeUrl('git@github.com:org/repo', 'abc')).toBe('https://github.com/org/repo/tree/abc');
		expect(sourceTreeUrl('https://github.com/org/repo', 'abc')).toBe('https://github.com/org/repo/tree/abc');
		expect(sourceTreeUrl('  https://github.com/org/repo.git/ ', 'v1.2')).toBe('https://github.com/org/repo/tree/v1.2');
	});
});
