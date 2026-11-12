import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The four Svelte callers of buildGateContext (the pure callers are pinned by gate-context-callers.test.ts) must each hand over the rollouts,
 * so a gate's displayName seeds ctx.pretty and no surface prints an unseeded "Gate" (QA52 LOW-A). These components cannot be mounted cheaply
 * (a page, a modal, the Apps grid), so the test reads the call's argument object from the source: SOURCE-SHAPE tests, honest about it. Each fails when
 * its caller drops the `rollouts` key or passes something other than the rollout(s) it has in hand.
 */
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
/** the `{ ... }` argument of every `buildGateContext(` call in the file, balanced on braces */
const calls = (src: string): string[] => {
	const out: string[] = [];
	for (const m of src.matchAll(/buildGateContext\(\{/g)) {
		let i = m.index! + m[0].length,
			depth = 1;
		while (i < src.length && depth) ((depth += src[i] === '{' ? 1 : src[i] === '}' ? -1 : 0), i++);
		out.push(src.slice(m.index! + m[0].length - 1, i));
	}
	return out;
};
const only = (p: string) => {
	const c = calls(read(p));
	expect(c, `${p} calls buildGateContext once`).toHaveLength(1);
	return c[0];
};

describe('every Svelte buildGateContext caller hands over the rollouts', () => {
	it('Apps.svelte: the fleet rollouts', () => {
		expect(only('../components/new/Apps.svelte')).toMatch(/\brollouts,\s*rolloutGates: null\b/);
	});
	it("ChangeVersionModal.svelte: the modal's own rollout", () => {
		expect(only('../components/ChangeVersionModal.svelte')).toMatch(
			/\brollouts: rollout \? \[rollout\] : null\b/
		);
	});
	it("rollout detail +page.svelte: the page's rollout", () => {
		expect(only('../../routes/rollouts/[cluster]/[namespace]/[name]/+page.svelte')).toMatch(
			/\brollouts: rollout \? \[rollout\] : null\b/
		);
	});
	it("gates +page.svelte: the page's rollout", () => {
		expect(only('../../routes/rollouts/[cluster]/[namespace]/[name]/gates/+page.svelte')).toMatch(
			/\brollouts: rollout \? \[rollout\] : null\b/
		);
	});
});
