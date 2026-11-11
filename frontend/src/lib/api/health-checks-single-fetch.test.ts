import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * One owner of the `/health-checks` URL: `healthChecksQueryOptions` in
 * `api/health-checks.ts`, which throws on a non-2xx. A page that built the
 * request itself and resolved a 500 to `{healthChecks: []}` poisoned the shared
 * cache key and hid the recovery warning (batch4 #8).
 *
 * THE SCAN IS ON RAW TEXT. No comment or string is stripped, so no trick
 * (a `//` inside a template, a `'//'` or `/*` string, a wrapper function, a
 * variable, encodeURIComponent) can hide a URL from it. The only lines it skips
 * are import/export-from lines, whose module PATH ends in `health-checks`.
 * Product comments that name the endpoint are reworded instead of exempted.
 *
 * Allow-list is by EXACT FILE, with the reason: the owner, and the mock servers
 * that SERVE (never request) the endpoint. Test files (`*.test.ts`) stub it and
 * are skipped by suffix.
 *
 * Second rule: product code may import a `lib/demo` module that mentions the
 * endpoint only from the exact importers listed below.
 */
const OWNER = join('lib', 'api', 'health-checks.ts');
const MOCK_SERVERS = new Set([
	join('lib', 'demo', 'respond.ts'),
	join('lib', 'demo', 'home-incident.ts'),
	join('lib', 'messages', 'fleet-fixture.ts')
]);
/** Product files that import a mock server, each deliberate (fixture builders). */
const MOCK_IMPORTERS = new Set([
	join('lib', 'view-models', 'home', 'fixture.ts'),
	join('lib', 'view-models', 'gates-tab-reference.testkit.ts'),
	join('lib', 'components', 'new', 'github-read.svelte.ts')
]);
const SEGMENT = /\/health-checks(?![\w-])/;
const IMPORT_LINE = /^\s*(?:import|export)\b[^\n]*\bfrom\s*['"][^'"\n]*['"]|\bimport\(\s*['"][^'"\n]*['"]\s*\)/;

export function mentionsEndpoint(raw: string): boolean {
	return raw.split('\n').some((line) => !IMPORT_LINE.test(line) && SEGMENT.test(line));
}

/** files: relative path (under src) -> raw text. */
export function findOffenders(files: Record<string, string>): string[] {
	const out: string[] = [];
	const demoMentioning = new Set(
		Object.entries(files)
			.filter(([rel, t]) => rel.startsWith(`lib${sep}demo${sep}`) && mentionsEndpoint(t))
			.map(([rel]) => rel)
	);
	for (const [rel, text] of Object.entries(files)) {
		if (rel === OWNER || MOCK_SERVERS.has(rel)) continue;
		if (mentionsEndpoint(text)) out.push(`${rel}: mentions /health-checks`);
		if (!rel.startsWith(`lib${sep}demo${sep}`) && !MOCK_IMPORTERS.has(rel)) {
			for (const m of text.matchAll(/(?:from\s*|import\(\s*)['"][^'"\n]*\/demo\/([\w-]+)['"]/g)) {
				const target = join('lib', 'demo', `${m[1]}.ts`);
				if (demoMentioning.has(target) || MOCK_SERVERS.has(target))
					out.push(`${rel}: imports ${target}, which carries the endpoint`);
			}
		}
	}
	return out;
}

const SRC = join(__dirname, '..', '..');
function walk(dir: string, out: string[] = []): string[] {
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|ts|js)$/.test(f) && !/\.test\.(ts|js)$/.test(f)) out.push(p);
	}
	return out;
}

describe('the /health-checks URL has exactly one owner', () => {
	const planted: Record<string, string> = {
		'a plain fetch': 'await fetch(apiPath(cluster, `/rollouts/${namespace}/${name}/health-checks`))',
		'a URL built in a variable': 'const u = `/rollouts/${ns}/${n}/health-checks`;\nconst r = await go(u);',
		'a template with encodeURIComponent':
			'const u = `/rollouts/${encodeURIComponent(ns)}/${encodeURIComponent(n)}/health-checks`;',
		'a wrapper function': "function hc(base: string) { return get(base + '/health-checks'); }",
		'a `//` inside a template': 'const u = `https://h//${ns}/${n}/health-checks`;',
		"a '//' string before it": "const s = '//'; const u = '/rollouts/' + n + '/health-checks';",
		'a `/*` inside a string before it': "const s = '/*'; const u = `/rollouts/${n}/health-checks`;"
	};
	for (const [name, src] of Object.entries(planted)) {
		it(`trips on ${name}`, () => expect(findOffenders({ [join('lib', 'x.ts')]: src })).not.toEqual([]));
	}
	it('trips on a fetch planted in lib/demo/embed.ts (no whole-directory exemption)', () => {
		expect(
			findOffenders({ [join('lib', 'demo', 'embed.ts')]: 'fetch(`/rollouts/${n}/${m}/health-checks`)' })
		).not.toEqual([]);
	});
	it('trips on product code importing a demo module that carries the endpoint', () => {
		expect(
			findOffenders({
				[join('lib', 'demo', 'embed.ts')]: "export const a = 'x/health-checks';",
				[join('routes', 'p.svelte')]: "import { a } from '$lib/demo/embed';"
			}).some((o) => o.includes('imports'))
		).toBe(true);
	});
	it('does not trip on a module path import or a hyphenated reason name', () => {
		expect(findOffenders({ [join('lib', 'x.ts')]: "import { a } from '$lib/api/health-checks';" })).toEqual([]);
		expect(findOffenders({ [join('lib', 'x.ts')]: "const r = 'health-checks-unavailable';" })).toEqual([]);
	});
	it('the real source tree: only the owner and the named mock servers mention it', () => {
		const files: Record<string, string> = {};
		for (const p of walk(SRC)) files[relative(SRC, p)] = readFileSync(p, 'utf8');
		expect(findOffenders(files)).toEqual([]);
	});
});
