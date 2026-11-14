import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../../svelte.config.js';

describe('CSP configuration', () => {
	const csp = (config as any).kit.csp;
	it('is enabled with a locked-down script-src', () => {
		expect(csp.mode).toBe('hash');
		expect(csp.directives['script-src']).toEqual(['self']);
		expect(csp.directives['object-src']).toEqual(['none']);
		expect(csp.directives['base-uri']).toEqual(['self']);
		expect(csp.directives['connect-src']).toEqual(['self']);
	});
	it('app.html has no inline script (it would be blocked by script-src self)', () => {
		const html = readFileSync(resolve(__dirname, '../app.html'), 'utf8');
		const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
		expect(scripts.length).toBeGreaterThan(0);
		for (const m of scripts) expect(m[1]).toMatch(/\bsrc=/);
	});
});

