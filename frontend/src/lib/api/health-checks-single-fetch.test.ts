import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * One fetch of `/rollouts/:ns/:name/health-checks`: `healthChecksQueryOptions`
 * in `api/health-checks.ts`, which throws on a non-2xx. A page that fetched it
 * itself and resolved a 500 to `{healthChecks: []}` poisoned the shared cache
 * key and hid the recovery warning (batch4 #8). This fails if any other file
 * builds that request.
 */
const FETCH_OF_ENDPOINT = /(?:fetch|apiPath)\(\s*[^)]*\/rollouts\/[^)]*\/health-checks/;
const SRC = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
	for (const f of readdirSync(dir)) {
		const p = join(dir, f);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(svelte|ts)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
	}
	return out;
}

describe('the per-rollout health-checks endpoint has exactly one fetcher', () => {
	it('the pattern recognises the pre-fix page fetch', () => {
		expect(FETCH_OF_ENDPOINT.test('await fetch(apiPath(cluster, `/rollouts/${namespace}/${name}/health-checks`))')).toBe(true);
	});
	it('only api/health-checks.ts builds the request', () => {
		const offenders = walk(SRC)
			.map((p) => relative(SRC, p))
			.filter((rel) => rel !== join('lib', 'api', 'health-checks.ts'))
			.filter((rel) => FETCH_OF_ENDPOINT.test(readFileSync(join(SRC, rel), 'utf8')));
		expect(offenders).toEqual([]);
	});
});
