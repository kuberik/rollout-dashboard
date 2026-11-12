import { describe, it, expect, afterEach } from 'vitest';
import { envPage, newerNote, type EnvPage } from './env-page';
import { installEdge, uninstallEdge } from '$lib/testing/edge-source';
import { environments, TIERS } from '../data';

/**
 * Batch 4 (a): one card per app per environment. An app whose place here is failing is drawn ONLY under Attention (or as the banner), never also under
 * Held / Ready to promote / Behind / In step. A newer build waiting upstream is a fact on the Failing card (`newer`), so the action is not lost.
 */
const sectionsOf = (P: EnvPage): Map<string, string[]> => {
	const m = new Map<string, string[]>();
	const add = (app: string, s: string) => m.set(app, [...(m.get(app) ?? []), s]);
	if (P.banner) add(P.banner.row.app, 'banner');
	for (const a of P.attention) add(a.app, a.failed ? 'attention' : 'approval');
	for (const t of P.gangway.held) add(t.app, 'held');
	for (const t of P.gangway.ready) add(t.app, 'ready');
	for (const b of P.gangway.behind) add(b.app, 'behind');
	for (const a of P.gangway.inStep) add(a.app, 'in-step');
	return m;
};
const names = (): string[] => [
	...TIERS,
	...environments('incident').regions.map((r) => `prod-${r.label}`)
];
afterEach(uninstallEdge);

describe('no app appears in two sections of one /envs page (a failing app or an approval: its Attention card or the banner only)', () => {
	for (const edge of [false, true]) {
		it(`over the ${edge ? 'incident + edge' : 'incident'} fixture, every environment and region`, () => {
			if (edge) installEdge();
			const dup: string[] = [];
			for (const n of names()) {
				const P = envPage('incident', n);
				if (!P) continue;
				for (const [app, ss] of sectionsOf(P)) if (ss.length > 1) dup.push(`${n}: ${app} in ${ss.join(' + ')}`);
			}
			expect(dup).toEqual([]);
		}, 60_000); /* builds the page model of every environment and region: slow under a loaded worker */
	}
});

describe('deploy-pin-fail on /envs/prod', () => {
	it('is a Failing card only, and the card carries the newer build as a fact', () => {
		installEdge();
		const P = envPage('incident', 'prod')!;
		expect(sectionsOf(P).get('deploy-pin-fail')).toEqual(['attention']);
		const a = P.attention.find((x) => x.app === 'deploy-pin-fail')!;
		expect(a.newer).toEqual({ build: 'dp-3', from: 'dev', hold: 'Held by the pin' });
		expect(newerNote(a.newer!)).toBe('Newer build dp-3 from dev · Held by the pin');
	});
});
