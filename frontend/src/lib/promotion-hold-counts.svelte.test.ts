/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { withPromotionHolds } from '$lib/demo/home-incident';
import * as D from '$lib/components/new/data';
import { rolloutsPage } from '$lib/components/new/rollouts-page';
import { homePage } from '$lib/components/new/home-page';

vi.mock('$app/state', () => ({ page: { params: {}, url: new URL('http://localhost/'), route: { id: null }, status: 200, error: null, data: {}, form: null } }));
afterEach(() => installLiveSource(null));

/**
 * batch4 #76 F: Home, /rollouts and the Holding card agree on WHICH places a promotion gate holds, and heldCauses' internal key
 * ("Held by Promotion from <env>", the cause text) neither splits one source nor merges two. The shipped fixture holds one place (telemetry-indexer prod,
 * source dev); the test serves four more: two more from dev (telemetry-worker prod, checkout-edge staging) and one from test (payments-core staging).
 */
const EXTRA = ['telemetry-worker-prod', 'checkout-edge-staging', 'payments-core-staging'];
function install() {
	const src = fixtureSource();
	const base = withPromotionHolds({ rollouts: src.rollouts } as never).rollouts as any[];
	const rollouts = base.map((r) => (EXTRA.includes(r.metadata.namespace) ? { ...r, status: { ...r.status, gates: [...(r.status?.gates ?? []), { name: 'promo-x', kind: 'promotion', allowedVersions: [], message: 'x' }] } } : r));
	installLiveSource({ ...src, rollouts } as never);
}
const promoCauses = () => D.heldCauses('incident').filter((h) => h.parts.some((p) => typeof p !== 'string' && p.kind === 'promotion'));

describe('heldCauses keys for promotion holds', () => {
	it('one source is one cause (3 places from dev), two sources are two causes', () => {
		install();
		const c = promoCauses();
		expect(c.map((h) => h.key).sort()).toEqual(['Held by Promotion from dev', 'Held by Promotion from test']);
		expect(c.find((h) => h.key.endsWith('dev'))!.rows.map((r) => r.app).sort()).toEqual(['checkout-edge', 'telemetry-indexer', 'telemetry-worker']);
		expect(c.find((h) => h.key.endsWith('test'))!.rows.map((r) => r.app)).toEqual(['payments-core']);
		expect(new Set(D.heldCauses('incident').map((h) => h.key)).size).toBe(D.heldCauses('incident').length);
	});
	it('the typed label, not the key, is what a surface draws', () => {
		install();
		for (const h of promoCauses()) expect(h.parts).toEqual(['Held by ', { kind: 'promotion', source: h.key.replace('Held by Promotion from ', '') }]);
	});
});

const surfaces = () => {
	const page = rolloutsPage('incident');
	const group = page.groups.find((g) => g.key === 'held');
	const card = D.heldCauses('incident').filter((h) => h.rows.every((r) => r.state !== 'awaiting-approval')).flatMap((h) => h.rows.map((r) => r.href));
	return { rollouts: (group?.rows ?? []).map((r) => r.href), card, count: page.counts.held, /* Home: a held place is fleet trouble, or (telemetry-indexer prod, which also awaits an approval) the viewer's ask */ trouble: new Set([...homePage('incident').fleet.trouble.filter((t) => t.mark === 'held').map((t) => t.app), ...homePage('incident').asks.map((x) => x.id?.name as string)]) };
};
describe('Home, /rollouts and the Holding card agree on the held places', () => {
	it('the four promotion holds add the same four places to /rollouts Held, the Holding card and Home trouble', () => {
		installLiveSource({ ...fixtureSource() } as never);
		const before = surfaces();
		installLiveSource(null);
		install();
		const after = surfaces();
		const promoHrefs = promoCauses().flatMap((h) => h.rows.map((r) => r.href)).sort();
		expect(promoHrefs).toHaveLength(4);
		const added = (a: string[], b: string[]) => b.filter((h) => !a.includes(h)).sort();
		expect(added(before.rollouts, after.rollouts)).toEqual(promoHrefs);
		expect(added(before.card, after.card)).toEqual(promoHrefs);
		expect(after.count - before.count).toBe(4);
		const newApps = [...after.trouble].filter((a) => !before.trouble.has(a)).sort();
		expect(newApps).toEqual(['checkout-edge', 'payments-core', 'telemetry-indexer', 'telemetry-worker'].filter((a) => !before.trouble.has(a)));
	});
});
