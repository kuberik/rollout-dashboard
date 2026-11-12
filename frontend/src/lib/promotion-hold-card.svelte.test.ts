import { describe, it, expect, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/svelte';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { withPromotionHolds } from '$lib/demo/home-incident';
import * as D from '$lib/components/new/data';
import AppGates from '$lib/components/new/app/AppGates.svelte';
import { holdRows } from '$lib/components/new/app/app-model';

vi.mock('$app/state', () => ({ page: { params: {}, url: new URL('http://localhost/'), route: { id: null }, status: 200, error: null, data: {}, form: null } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), pushState: vi.fn(), replaceState: vi.fn(), beforeNavigate: vi.fn(), afterNavigate: vi.fn() }));

/** batch4 #76 D: the app's Holding card lists a promotion HOLD as `Held by » [SOURCE]`; a promotion gate that only sequences stays out. */
afterEach(() => installLiveSource(null));
function install() {
	const src = fixtureSource();
	installLiveSource({ ...src, rollouts: withPromotionHolds({ rollouts: src.rollouts } as never).rollouts } as never);
}
const rowsOf = (app: string) => holdRows(D.gatesOf(app, 'incident'), D.placeHolds(app, 'incident'), null, app).filter((r) => r.holding);

describe('gatesOf and the Holding card (home-incident withPromotionHolds)', () => {
	it('checkout-edge staging: the promotion hold is a gate card with the typed label', () => {
		install();
		const g = D.gatesOf('checkout-edge', 'incident').filter((x) => x.kind === 'promotion');
		expect(g).toHaveLength(1);
		expect(g[0].holding).toBe(true);
		expect(g[0].label).toEqual({ kind: 'promotion', source: 'dev' });
		const r = rowsOf('checkout-edge').find((x) => x.label);
		expect(r?.label).toEqual({ kind: 'promotion', source: 'dev' });
	});
	it('passing / sequencing promotion gates stay out (invoice-api test and staging, checkout-api)', () => {
		install();
		for (const app of ['invoice-api', 'checkout-api']) expect(D.gatesOf(app, 'incident').filter((x) => x.kind === 'promotion'), app).toEqual([]);
	});
	it('the card draws "Held by" + the glyph + the source chip, never the gate name', () => {
		install();
		const { container } = render(AppGates, { props: { rows: rowsOf('checkout-edge') } });
		const li = [...container.querySelectorAll('li')].find((x) => x.querySelector('[data-gate-label="promotion"]'))!;
		expect(li).toBeTruthy();
		expect(li.querySelector('[data-gate-source="dev"]')).not.toBeNull();
		expect((li.querySelector('a')?.textContent ?? '').replace(/\s+/g, ' ').trim()).toMatch(/^Held by/);
	});
});
