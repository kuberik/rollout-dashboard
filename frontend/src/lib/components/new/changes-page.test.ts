import { it, expect } from 'vitest';
import { changesPage, attentionRollupParts, refOf, gateOf, attentionOrder, attentionSince } from './changes-page';
import { ago } from './data';

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
it('incident: a failing Attention card ages from when its check began failing, like the banner', () => {
	const P = changesPage('incident');
	const failing = P.attention.filter((a) => a.model.state === 'failed' && a.p.c.failure?.since);
	expect(failing.length).toBeGreaterThan(0);
	for (const a of failing) expect(a.model.forAgeAt).toBe(a.p.c.failure!.since);
	for (const a of failing) expect(a.model.forAge).toBe(`for ${ago(a.p.c.failure!.since!)}`);
});
it('attention order: failures sort by when their check began failing, the age the card prints', () => {
	const mk = (k: string, rideSince: string, failSince: string) => ({ k, state: 'failed', ride: { since: rideSince }, c: { since: rideSince, failure: { since: failSince } } });
	/* a deployed first but began failing last; b deployed later but has failed longer */
	const ps = [mk('a', '2026-11-14T10:00:00Z', '2026-11-14T11:50:00Z'), mk('b', '2026-11-14T11:00:00Z', '2026-11-14T11:10:00Z')];
	expect(attentionOrder(ps, (p) => attentionSince(p, () => null)).map((p) => p.k)).toEqual(['b', 'a']);
});

it('Attention rollup: only the failing-now part is danger ink, a recovered failed is a plain part', () => {
	expect(attentionRollupParts(3, 1, 1)).toEqual([{ text: '2 failing', ink: 'danger' }, '1 failed', { text: '1 to approve', ink: 'held' }]);
});
