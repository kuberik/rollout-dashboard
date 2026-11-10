import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * One owner of the `/health-checks` URL: `healthChecksQueryOptions` in
 * `api/health-checks.ts`, which throws on a non-2xx. A page that built the
 * request itself and resolved a 500 to `{healthChecks: []}` poisoned the shared
 * cache key and hid the recovery warning (batch4 #8).
 *
 * The scan is on the PATH SEGMENT, not on a call shape, so a URL built into a
 * variable, a template with encodeURIComponent, or a wrapper function all trip
 * it. Imports and comments are stripped first. Deliberately exempt: test files,
 * and the demo/fixture responders that SERVE the endpoint (they answer it, they
 * never request it): `lib/demo/` and `lib/messages/fleet-fixture.ts`.
 */
const SEGMENT = /\/health-checks(?![\w-])/;
const EXEMPT = [`lib${sep}demo${sep}`, `lib${sep}messages${sep}fleet-fixture.ts`];
const OWNER = join('lib', 'api', 'health-checks.ts');

function stripNonCode(src: string): string {
	return src
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
		.replace(/\bfrom\s+(['"])[^'"\n]*\1/g, '')
		.replace(/\bimport\(\s*(['"])[^'"\n]*\1\s*\)/g, '');
}
const touchesEndpoint = (src: string) => SEGMENT.test(stripNonCode(src));

const SRC = join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
	}
	return out;
}

describe('the /health-checks URL has exactly one owner', () => {
	const variants: Record<string, string> = {
		'a plain fetch': 'await fetch(apiPath(cluster, `/rollouts/${namespace}/${name}/health-checks`))',
		'a URL built in a variable': 'const u = `/rollouts/${ns}/${n}/health-checks`;\nconst r = await go(u);',
		'a template with encodeURIComponent':
			'const u = `/rollouts/${encodeURIComponent(ns)}/${encodeURIComponent(n)}/health-checks`;',
		'a wrapper function': "function hc(base: string) { return get(base + '/health-checks'); }"
	};
	for (const [name, src] of Object.entries(variants)) {
		it(`trips on ${name}`, () => expect(touchesEndpoint(src)).toBe(true));
	}
	it('does not trip on imports, comments, or the hyphenated reason names', () => {
		expect(touchesEndpoint("import { a } from '$lib/api/health-checks';")).toBe(false);
		expect(touchesEndpoint('// GET /rollouts/x/y/health-checks\nconst a = 1;')).toBe(false);
		expect(touchesEndpoint("const r = 'health-checks-unavailable';")).toBe(false);
	});
	it('only api/health-checks.ts mentions it in source', () => {
		const offenders = walk(SRC)
			.map((p) => relative(SRC, p))
			.filter((rel) => rel !== OWNER && !EXEMPT.some((e) => rel.startsWith(e) || rel === e))
			.filter((rel) => touchesEndpoint(readFileSync(join(SRC, rel), 'utf8')));
		expect(offenders).toEqual([]);
	});
});
