import { describe, it, expect } from 'vitest';
import { highlightSearch, escapeHtml } from './highlight-search';

const PAYLOADS = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '"><svg onload=alert(1)>'];

function parse(html: string): HTMLElement {
	const d = document.createElement('div');
	d.innerHTML = html;
	return d;
}

describe('highlightSearch', () => {
	for (const p of PAYLOADS) {
		it(`renders ${p} as text with no query`, () => {
			const el = parse(highlightSearch(p, ''));
			expect(el.querySelector('img,script,svg')).toBeNull();
			expect(el.textContent).toBe(p);
		});
		it(`renders ${p} as text when the query matches inside it`, () => {
			const el = parse(highlightSearch(`before ${p} after`, 'img'));
			expect(el.querySelector('img,script,svg')).toBeNull();
			expect(el.textContent).toBe(`before ${p} after`);
		});
		it(`escapes the match itself (${p})`, () => {
			const el = parse(highlightSearch(`x ${p} y`, p));
			expect(el.querySelector('img,script,svg')).toBeNull();
			expect(el.querySelectorAll('mark')).toHaveLength(1);
			expect(el.textContent).toBe(`x ${p} y`);
		});
	}
	it('wraps matches in <mark> only', () => {
		const el = parse(highlightSearch('error: boom', 'boom'));
		expect(el.querySelector('mark')?.textContent).toBe('boom');
	});
	it('escapeHtml covers & < > " \'', () => {
		expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
	});
});
