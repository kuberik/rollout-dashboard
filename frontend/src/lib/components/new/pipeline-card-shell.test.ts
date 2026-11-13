import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

describe('PipelineCard header mark', () => {
	it('draws the header mark with the one StatusMark, never a hand-rolled spinner or icon', () => {
		const src = read('./PipelineCard.svelte');
		expect(src).toContain("import StatusMark from '$lib/components/StatusMark.svelte'");
		expect(src).toMatch(/<StatusMark state=\{MARK\[st\]\} \/>/);
		expect(src).not.toContain('border-active-solid/40');
		expect(src).not.toContain('as never');
	});
});

describe('Slipway compact card', () => {
	it('hangs its facts under both columns from a 640px card, so the rail has no tall void', () => {
		const src = read('./Slipway.svelte');
		expect(src).toMatch(/@container \(min-width: 640px\) \{\s*:global\(\.sw-compact\) :global\(\.pc-body\) \{[^}]*grid-template-areas: 'rail info' 'facts facts' 'act act'/);
	});
});
