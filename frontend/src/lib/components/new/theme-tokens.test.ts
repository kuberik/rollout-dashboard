import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/* `--color-*` come from `@theme inline` in styles/language.css: they exist only where Tailwind substitutes them into a utility, and are NOT custom properties a
   component's own <style> can rely on (the landing's embedded build drops them: `color: var(--color-fg)` became invalid and the Builds ledger's version fell back to the
   button's dark ink, nearly invisible on dark). A scoped <style> reads the source tokens, `--k-*`, which are always defined. */
function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory() ? svelteFiles(p) : p.endsWith('.svelte') ? [p] : [];
	});
}

describe('scoped styles read --k-* tokens', () => {
	it('no component under components/new reads a --color-* custom property', () => {
		const offenders = svelteFiles(new URL('.', import.meta.url).pathname).filter((f) => /var\(--color-/.test(readFileSync(f, 'utf8')));
		expect(offenders).toEqual([]);
	});
});
