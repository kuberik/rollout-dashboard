import { it } from 'vitest';
import * as D from './data';
const mins = (iso?: string | null) => (iso ? Math.round((D.NOW.getTime() - Date.parse(iso)) / 60000) + 'm' : '-');
it('scratch', () => {
	for (const s of ['incident', 'quiet'] as const) {
		const C = D.changes(s);
		console.log('== ' + s, JSON.stringify(C.totals));
		for (const c of C.items.filter((c) => c.failure || c.regions)) console.log('CH', c.ref, c.fact, c.failure?.line ?? '', JSON.stringify(c.regions));
		for (const a of D.apps(s).items) console.log('APP', a.app, '|', a.fact, '| newest', a.newest, a.onNewest + '/' + a.places, 'prod', JSON.stringify(a.prod), 'failing', a.failing?.build ?? '-');
		for (const t of D.environments(s).tiers) console.log('TIER', t.key, JSON.stringify(t.counts), t.regions);
		for (const r of D.rollouts(s).rows.filter((r) => r.regionsOf)) console.log('ROW', r.key, JSON.stringify(r.regionsOf));
	}
});
