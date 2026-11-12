import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { withPromotionHolds } from '$lib/demo/home-incident';
import * as D from '$lib/components/new/data';
import Slipway from '$lib/components/new/Slipway.svelte';

vi.mock('$app/state', () => ({ page: { params: {}, url: new URL('http://localhost/'), route: { id: null }, status: 200, error: null, data: {}, form: null } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), pushState: vi.fn(), replaceState: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));
afterEach(() => installLiveSource(null));
function install() {
	const src = fixtureSource();
	installLiveSource({ ...src, rollouts: withPromotionHolds({ rollouts: src.rollouts } as never).rollouts } as never);
}
/** batch4 #76 E: the rail row of the promotion-held place reads "Held by » [DEV]", not "held: Held by a rule". */
describe('app rail: the promotion-held place', () => {
	it('newestBuild types the hold; a plain rule hold stays untyped', () => {
		install();
		const p = D.placeHolds('telemetry-indexer', 'incident').find((x) => x.env === 'prod')!;
		const nb = D.newestBuild({ app: 'telemetry-indexer', href: p.href, state: 'held-by-rule', word: 'Held by a rule' } as never)!;
		expect(nb.holdC).toEqual(['Held by ', { kind: 'promotion', source: 'dev' }]);
		const c = D.placeHolds('checkout-api', 'incident').find((x) => x.state === 'held-by-rule')!;
		expect(D.newestBuild({ app: 'checkout-api', href: c.href, state: 'held-by-rule', word: 'Waits on payments-svc' } as never)!.holdC).toBeNull();
	});
	it('the compact Slipway draws the » glyph and the DEV chip, never "held: Held by a rule"', () => {
		install();
		const p = D.placeHolds('telemetry-indexer', 'incident').find((x) => x.env === 'prod')!;
		const base = D.rollouts('incident').rows.find((r) => r.href === p.href)!;
		const row = { ...base, state: 'held-by-rule', word: 'Held by a rule', group: 'held' } as never;
		const { container } = render(Slipway, { row, hs: 'incident', compact: true });
		const dd = [...container.querySelectorAll('[data-slipway-facts] dd')].find((d) => /To deploy|\d/.test(d.textContent ?? '') && d.querySelector('[data-gate-label]'));
		expect(dd, container.textContent ?? '').toBeTruthy();
		expect(dd!.querySelector('[data-gate-source="dev"]')).not.toBeNull();
		expect(container.textContent).not.toContain('held: Held by a rule');
	});
});
