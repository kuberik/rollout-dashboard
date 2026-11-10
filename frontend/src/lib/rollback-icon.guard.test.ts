import { describe, test, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * SOURCE GUARD (rollout-tabs item 5, 2026-10-25): every "Roll back" control on
 * the rollout tabs draws the one UndoOutline glyph. ReplyOutline (an arrow
 * pointing the wrong way, read as "reply") must not come back in
 * src/routes/rollouts/** or RolloutTabHeader. Scoped on purpose: other routes
 * are owned by other squads.
 */
const src = resolve(__dirname, '..');
function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? walk(p) : p.endsWith('.svelte') ? [p] : [];
	});
}

describe('Roll back controls never use ReplyOutline', () => {
	const files = [
		...walk(join(src, 'routes/rollouts')),
		join(src, 'lib/components/RolloutTabHeader.svelte')
	];
	test('the scan sees the rollout tab files', () => {
		expect(files.length).toBeGreaterThan(5);
	});
	test.each(files.map((f) => [f.slice(src.length + 1), f]))('%s', (_n, f) => {
		expect(readFileSync(f, 'utf8')).not.toContain('ReplyOutline');
	});
});
