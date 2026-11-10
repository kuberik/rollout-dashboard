import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

describe('PipelineCard header mark', () => {
	it('draws the in-flight mark with the product spinner, never a hand-rolled span', () => {
		const src = read('./PipelineCard.svelte');
		expect(src).toContain("import StatusSpinner from '$lib/components/StatusSpinner.svelte'");
		expect(src).toMatch(/<StatusSpinner size="4" color=\{st === 'checking' \? 'yellow' : 'blue'\}/);
		expect(src).not.toContain('border-active-solid/40');
	});
});

describe('Slipway compact card', () => {
	it('hangs its facts under both columns from a 640px card, so the rail has no tall void', () => {
		const src = read('./Slipway.svelte');
		expect(src).toMatch(/@container \(min-width: 640px\) \{\s*:global\(\.sw-compact\) :global\(\.pc-body\) \{[^}]*grid-template-areas: 'rail info' 'facts facts' 'act act'/);
	});
});
