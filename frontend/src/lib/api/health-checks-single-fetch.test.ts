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
/**
 * A TRUE import/export-from line, anchored at both ends: the whole line is the
 * clause, `from`, a module path ending in `health-checks`, and an optional `;`.
 * A trailing comment, a second statement or a dynamic `import()` on the line
 * all fail the anchor, so they are scanned (QA18 n1, n2, n5). The bare
 * `} from '...'` tail of a multi-line import is the same shape.
 */
const IMPORT_LINE =
	/^\s*(?:(?:import|export)\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\}|\w+(?:\s*,\s*\{[^}]*\})?)|\})\s*from\s*['"][^'"\n]*health-checks['"]\s*;?\s*$/;

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
			for (const m of text.matchAll(/(?:from\s*|import\(\s*)['"][^'"\n]*\/demo\/([\w-]+)(?:\.[jt]s)?['"]/g)) {
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
	// QA18 plants n1, n2, n3, n5: each slipped a URL past the first IMPORT_LINE.
	// n4 (the literal split across a concatenation: '/health' + '-checks') is an
	// ACCEPTED LIMIT of any text scan; the real guard against it is review.
	const bypasses: Record<string, [string, string]> = {
		'n1 a dynamic import() on the same line': [
			join('lib', 'x.ts'),
			"export async function a(n: string) {\n\treturn fetch(`/rollouts/${n}/health-checks`).then((r) => import('./p1').then(() => r));\n}"
		],
		'n2 a dynamic import() after the fetch in a .svelte file': [
			join('routes', 'x.svelte'),
			"<script lang=\"ts\">\n\tconst load = () => fetch(`/api/rollouts/${n}/health-checks`); import('svelte');\n</script>"
		],
		'n3 a mock-server import with a .ts extension': [
			join('lib', 'x.ts'),
			"import { respond } from '$lib/demo/respond.ts';\nexport const x = respond;"
		],
		"n5 an export line with a trailing comment quoting 'from api/health-checks'": [
			join('lib', 'x.ts'),
			"export const hcUrl = (n: string) => `/rollouts/${n}/health-checks`; // shape copied from 'api/health-checks'"
		]
	};
	for (const [name, [rel, src]] of Object.entries(bypasses)) {
		it(`trips on ${name}`, () => expect(findOffenders({ [rel]: src })).not.toEqual([]));
	}
	it('still lets true import/export-from lines through, including a multi-line import tail', () => {
		for (const l of [
			"import { a } from '$lib/api/health-checks';",
			"import type { A } from '$lib/api/health-checks';",
			"import * as hc from '$lib/api/health-checks';",
			"export { a } from './health-checks';",
			"export * from './health-checks';",
			"} from '$lib/api/health-checks';"
		])
			expect(findOffenders({ [join('lib', 'x.ts')]: l }), l).toEqual([]);
	});
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
