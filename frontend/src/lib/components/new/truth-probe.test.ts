import { it, expect } from 'vitest';
import * as D from './data';
/* r34 truth lane: invariants the page lanes rely on */
it.each(['incident', 'calm', 'quiet'] as const)('invariants %s', (s) => {
	const A = D.arrivals(s);
	expect(new Set(A.map((a) => a.key)).size, 'arrival keys unique').toBe(A.length);
	const R = D.rollouts(s);
	for (const r of R.rows) {
		const names = r.steps.filter((x) => !x.gate).map((x) => x.name);
		expect(names[0]).toBe('Started');
		expect(names[names.length - 1]).toBe('Check');
		expect(names.every((n) => /^(Started|Stage \d+|Check)$/.test(n)), r.key).toBe(true);
		if ((r.state === 'awaiting-approval' || r.state === 'held-by-rule') && !r.stillChecking) expect(r.steps.every((x) => x.state === 'done' && !x.gate), r.key).toBe(true);
		if (r.state === 'deploying' || r.state === 'checking') expect(r.steps.filter((x) => x.state === 'active').length, r.key).toBe(1);
		D.pathPosition(r, s); D.lastHealthy(r);
		if (r.group === 'failed') expect(r.failure?.line, r.key).toBeTruthy();
	}
	const E = D.environments(s);
	expect(E.regions.some((x) => x.label === 'production' || x.label === 'prod')).toBe(false);
	for (const g of E.regions) expect(g.href.endsWith('-' + g.label + '/' + g.href.split('/').pop()) && g.places.every((p) => p.href.includes('-' + g.label + '/')), g.label).toBe(true);
	const C = D.changes(s).items;
	const refs = new Map<string, string>();
	for (const c of C) { const k = c.refLabel; expect(refs.has(k) && refs.get(k) !== c.title, `dup ref ${k}`).toBe(false); refs.set(k, c.title); }
	/* AD round 1 invariants */
	const CH = D.changes(s);
	const sum = (x: { failed: number; waiting: number; moving: number; landed: number; rolledBack: number; total: number }) => x.failed + x.waiting + x.moving + x.landed + x.rolledBack;
	expect(sum(CH.totals.mine)).toBe(CH.totals.mine.total);
	expect(sum(CH.totals.team)).toBe(CH.totals.team.total);
	expect(CH.totals.mine.total + CH.totals.team.total).toBe(CH.items.length);
	for (const c of C) {
		if (c.glyph === 'arrived') expect(c.group, c.ref).toBe('landed');
		if (c.group === 'moving' && c.fact.includes('not in')) expect(c.glyph, c.ref).toBe('rest');
		if (c.group === 'landed' && !c.rolledBack) expect(c.reach, c.ref).toBe(c.tiers[c.tiers.length - 1]);
		if (c.group === 'failed' && !c.rolledBack) expect(c.failure?.line, c.ref).toBeTruthy();
	}
	for (const a of D.apps(s).items) {
		expect(a.newest ?? '', a.app).not.toMatch(/[.-]$/);
		expect(a.onNewest, a.app).toBe(a.placeList.filter((p) => p.onNewest).length);
		if (a.failing) expect(a.failing.build, a.app).toBeTruthy();
	}
	for (const t of E.tiers) expect(t.counts.failing + t.counts.moving + t.counts.waiting + t.counts.rest, t.key).toBe(t.counts.places);
	/* lead: one order */
	const L = D.lead(s);
	if (L) { /* build-fairway: within the first row's class the viewer's own action leads */ const r0 = D.rollouts(s).rows[0]; expect(D.urgencyClass(L)).toBe(D.urgencyClass(r0)); if (L.href !== r0.href) expect(L.needsYou).toBe(true); expect(D.inbox(s).items[0]?.row.href === L.href || !L.needsYou).toBe(true); }
	const rows = D.rollouts(s).rows;
	for (let k = 1; k < rows.length; k++) expect(D.urgency(rows[k - 1], rows[k]), 'rows ordered').toBeLessThanOrEqual(0);
	for (const r of rows) { D.gateName(r); D.candidateBuilds(r); }
	D.cleared(s);
	const f = D.fleet24h(s); expect(f.deploys).toBeGreaterThanOrEqual(f.failed + f.rolledBack > 0 ? 1 : 0);
	for (const r of rows) expect(D.pathPosition(r, s), r.key).toMatch(/on the newest|Never deployed/);
	for (const c of C) { if (c.mine && c.author && !c.youApprove) expect(c.author, c.ref).toBe(D.ME); expect(c.who ?? c.author).toBe(c.author ?? c.who); }
	D.changes24h(s, 'mine'); D.changes24h(s, 'team'); D.avatarSrc('danielreed');
});
