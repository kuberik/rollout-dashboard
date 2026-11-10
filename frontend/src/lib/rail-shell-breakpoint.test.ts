import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * ⭐ D-22 GUARD (2026-10-08, coordinator decision via `fix-dash`, "system"
 * lane). "≥1024 never single column" broke at 1024-with-sidebar-open
 * because the shared rail shell (`app.css`'s `.rail-grid`) and FOUR private
 * hand-copies of its old single `860px` threshold (`ControlCenter.svelte`,
 * `/apps`, `/apps/<name>`, `/envs/<name>`) all agreed on one number that
 * was too wide for that width. `app.css` now steps the rail at `700px`
 * (280px rail) and `1000px` (320px rail) instead — see the comment beside
 * `.rail-grid` for the arithmetic. The four hand-copies are each owned by
 * a different lane and migrate on their own schedule; this test is the
 * ratchet that keeps the count from growing while that happens, and the
 * literal file list below is the exact TODO for whoever's turn it is to
 * bring it to zero and lower the number by one.
 *
 * `app.css` ITSELF holding zero `860px` rules is asserted unconditionally
 * — the shared shell is not allowed to regress back to the number that
 * caused D-22 in the first place.
 */
const SRC_ROOT = join(import.meta.dirname, '..');

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry === '.svelte-kit') continue;
		const full = join(dir, entry);
		const st = statSync(full);
		if (st.isDirectory()) {
			yield* walk(full);
		} else if (/\.(svelte|css|ts)$/.test(entry)) {
			yield full;
		}
	}
}

/** A REAL rule, not a comment mentioning the number — the literal CSS form. */
const RULE = /@container\s*\(min-width:\s*860px\)\s*\{/g;

function findRuleHits(): { file: string; count: number }[] {
	const hits: { file: string; count: number }[] = [];
	for (const file of walk(SRC_ROOT)) {
		const text = readFileSync(file, 'utf-8');
		const matches = text.match(RULE);
		if (matches) hits.push({ file: file.slice(SRC_ROOT.length + 1), count: matches.length });
	}
	return hits;
}

describe('rail shell breakpoint (D-22)', () => {
	it('app.css never reintroduces the single 860px threshold', () => {
		const appCss = readFileSync(join(SRC_ROOT, 'app.css'), 'utf-8');
		expect(appCss.match(RULE)).toBeNull();
	});

	it('the known private 860px copies do not grow past the current, named debt', () => {
		const hits = findRuleHits();
		// KNOWN DEBT, 2026-10-08 — one lane each, migrating to the 760/1000
		// two-step independently. Shrink this list (and the number below) as
		// each lane adopts `.rail-grid`/`.rail-main`/`.rail-side` or its own
		// matching two-step; a NEW file appearing here that is not one of
		// these is the thing this test exists to catch.
		//
		// ⛔ SHRUNK 2026-10-08 (r2-fleet lane): `/apps`, `/apps/<name>` and
		// `/envs/<name>` all migrated their own 860px rule to the 760/1000
		// two-step (same numbers as `app.css`'s `.rail-grid`; `/apps/<name>`
		// kept its private named-area `.ab-grid` SHAPE, moving only the
		// threshold, per the standing decision).
		const KNOWN = new Set<string>([
			// Debt cleared 2026-10-08: the r2-fleet lane migrated `/apps`,
			// `/apps/<name>` and `/envs/<name>`; the home lane migrated
			// `lib/ControlCenter.svelte` (its `order` rule now switches at the
			// same 760px point `.rail-grid` first goes two-column).
		]);
		const unexpected = hits.filter((h) => !KNOWN.has(h.file));
		expect(unexpected, 'a NEW 860px breakpoint appeared outside the known debt list').toEqual([]);
		expect(hits.length, 'the known debt list shrank — remove the migrated file(s) above').toBeLessThanOrEqual(
			KNOWN.size
		);
	});
});

describe('rail-grid seam', () => {
	it('is 16px stacked (phone) and 32px side by side', () => {
		const css = readFileSync(join(SRC_ROOT, 'app.css'), 'utf-8');
		const stacked = css.match(/\.rail-grid\s*\{\s*display:\s*flex;[^}]*gap:\s*([^;]+);/);
		expect(stacked?.[1].trim()).toBe('1rem');
		const sideBySide = css.match(/@container \(min-width: 700px\)\s*\{\s*\.rail-grid\s*\{[^}]*gap:\s*([^;]+);/);
		expect(sideBySide?.[1].trim()).toBe('32px');
	});
});
