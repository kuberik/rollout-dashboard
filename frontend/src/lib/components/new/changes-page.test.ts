import { it, expect } from 'vitest';
import { changesPage, refOf, gateOf } from './changes-page';

/* r39 build: the Changes page composition. Each change once: banner / Attention / one repo card; section counts are the cards' own counts. */
for (const hs of ['incident', 'calm'] as const) {
	it(`${hs}: a change is in the banner, Attention or the repo cards, never two of them`, () => {
		const P = changesPage(hs);
		const att = P.attention.map((a) => a.p.c.key);
		const bn = P.banner ? [P.banner.p.c.key] : [];
		expect(new Set([...bn, ...att]).size).toBe(bn.length + att.length);
		for (const a of P.attention) expect(['failed', 'approval-yours']).toContain(a.p.state);
		/* no repo is both in flight and at rest; repos are unique per section */
		const mine = P.mine.map((r) => r.repo), rest = P.rest.map((r) => r.repo);
		expect(new Set(mine).size).toBe(mine.length);
		expect(mine.filter((r) => rest.includes(r))).toEqual([]);
		expect(P.counts.repos).toBe(mine.length + rest.length);
	});
}
it('incident: the lead failing change is the banner, no figure without observations', () => {
	const P = changesPage('incident');
	expect(P.banner?.p.state).toBe('failed');
	expect(P.banner?.change.you).toBe(true);
	/* the mock's failing checks carry observations: a failing card leads with the figure, an approval card has none */
	expect(P.attention.filter((a) => a.model.state === 'failed').every((a) => a.model.figure !== null)).toBe(true);
	expect(P.attention.filter((a) => a.model.state === 'failed').length).toBe(P.counts.failing - 1);
});
it('refOf / gateOf: PR number else short sha; prod places gate on prod', () => {
	expect(refOf({ prNumber: 37, ref: 'x' })).toBe('#37');
	expect(refOf({ prNumber: null, ref: 'b17b002abcdef' })).toBe('b17b002');
	expect(gateOf({ where: '5 prod regions', at: 'staging' })).toBe('prod');
});
