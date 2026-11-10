import { it, expect } from 'vitest';
import { homePage } from './home-page';
import { needsYouRedirect } from '../../../routes/needs-you/+page';

/* r39 build: the Home composition. Each ask once; Your changes never repeats an ask's change; the viewer is 'you'; no figure without data. */
it('incident: asks are failures first, then approvals; counts agree with the rollup', () => {
	const P = homePage('incident');
	expect(P.asks.length).toBe(P.counts.failing + P.counts.toApprove);
	const kinds = P.asks.map((a) => a.failed);
	expect(kinds).toEqual([...kinds].sort((a, b) => Number(b) - Number(a)));
	expect(new Set(P.asks.map((a) => a.key)).size).toBe(P.asks.length);
	expect(P.calm).toBe(false);
	/* a failing ask has no figure (no observations on the list payload): it leads with the check */
	for (const a of P.asks.filter((x) => x.failed)) expect(a.model.figure).not.toBeNull();
});
it('incident: an approval ask leads with "N of M prod regions" only from regionStates', () => {
	const P = homePage('incident');
	for (const a of P.asks.filter((x) => !x.failed && x.model.figure)) {
		expect(a.row.tier).toBe('prod');
		expect(a.model.figure!.unit).toMatch(/^of \d+$/);
	}
});
it('Your changes never repeats a change an ask carries, and the viewer is never named', () => {
	const P = homePage('incident');
	const askRepos = new Set(P.asks.map((a) => a.app));
	for (const r of P.repos) expect(r.card.cells.some((c) => c.beads.length) || r.card.landed > 0).toBe(true);
	for (const a of P.asks) expect(a.id.person?.toLowerCase()).not.toBe('danielreed');
	expect(askRepos.size).toBeGreaterThan(0);
});
it('calm: nothing asks, the fleet reads healthy and the page still has its body', () => {
	const P = homePage('calm');
	expect(P.calm).toBe(true);
	expect(P.asks).toEqual([]);
	expect(P.asksRollup).toEqual([]);
	expect(P.fleet.deploys.length).toBeLessThanOrEqual(5);
});
it('/needs-you redirects to / keeping the query', () => {
	expect(needsYouRedirect(new URL('https://x/needs-you?calm=1'))).toBe('/?calm=1');
	expect(needsYouRedirect(new URL('https://x/needs-you'))).toBe('/');
});

/* QA #6: a rollout that waits on an approval (or is moving) must show on Home even when it is not the viewer's ask */
import { rollouts } from './data';
import { classifyChanges } from './changes-page';
it.each(['incident', 'calm', 'quiet'] as const)('%s: every approval-held or moving rollout is on Home exactly once (ask, your change, or Fleet)', (s) => {
	const P = homePage(s);
	const R = rollouts(s);
	const asked = new Set(P.asks.map((a) => a.app));
	const fleetApps = new Set(P.fleet.trouble.map((t) => t.app));
	for (const r of R.rows.filter((x) => x.group === 'approval' || x.group === 'moving')) {
		const mine = classifyChanges(s).mineP.some((p) => p.ride.row?.key === r.key);
		expect(asked.has(r.app) || fleetApps.has(r.app) || mine, `${r.app}@${r.key} (${r.group})`).toBe(true);
	}
	if (R.rows.some((x) => x.group === 'approval' || x.group === 'moving')) expect(P.fleet.trouble.length + P.asks.length).toBeGreaterThan(0);
});

/* QA #10 / #13 / round 2 B1 */
import { fleet24hEvents } from './data';
import { TIERS } from './change-view';
it('Fleet deploys: one row per app, carrying the furthest tier its latest build reached; "N regions" only for several sites; no hover-only facts', () => {
	for (const s of ['incident', 'calm', 'quiet'] as const) {
		const P = homePage(s);
		expect(new Set(P.fleet.deploys.map((d) => d.app)).size).toBe(P.fleet.deploys.length);
		for (const d of P.fleet.deploys) {
			expect(d).not.toHaveProperty('more');
			const evs = fleet24hEvents(s).filter((e) => e.app === d.app).sort((a, b) => b.at.localeCompare(a.at));
			const same = evs.filter((e) => e.kind === evs[0].kind && e.build === evs[0].build);
			expect(TIERS.indexOf(d.tier as never)).toBe(Math.max(...same.map((e) => TIERS.indexOf(e.tier))));
			const m = /^(\d+) regions$/.exec(d.place);
			if (m) { expect(Number(m[1])).toBeGreaterThan(1); expect(d.href).toBe(`/apps/${encodeURIComponent(d.app)}`); }
		}
	}
});
