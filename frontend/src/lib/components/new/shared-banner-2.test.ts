import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');

/* r34 S1b: patterns that behave the same on every page are ONE component; a host that hand-rolls one again fails here */
describe('shared banner + pipeline card (S1b)', () => {
	it('the action rows of the four hosts are ActRow (primary flex-1 on a phone, never stacked)', () => {
		expect(src('./Slipway.svelte')).toMatch(/<ActRow/);
		expect(src('./Slipway.svelte')).not.toMatch(/\.sw-btn|sw-more/);
	});
	it('the four Deployment-pipeline shells are PipelineCard: none draws its own 47px header', () => {
		for (const f of ['./Slipway.svelte']) {
			const s = src(f);
			expect(s, f).toMatch(/<PipelineCard/);
			expect(s, f).not.toMatch(/min-h-\[47px\]/);
		}
		/* the Gates card is a different job (held builds, not steps): its own header stays, said in PipelineCard's doc comment */
		expect(src('./PipelineCard.svelte')).toMatch(/min-h-\[47px\]/);
	});
	it('PipelineCard names its reason and its container breakpoints are the hosts\'', () => {
		const s = src('./PipelineCard.svelte');
		expect(s).toMatch(/WHY CARD\.svelte IS NOT USED/);
		for (const at of [520, 560, 600, 640]) expect(s).toContain(`min-width: ${at}px`);
	});
	it('the banner disclosure is one AlertPanel chevron (44px), not one per host', () => {
		expect(src('../AlertPanel.svelte')).toMatch(/data-ap-toggle/);
		expect(src('../AlertPanel.svelte')).toMatch(/h-11 w-11/);
	});
});
