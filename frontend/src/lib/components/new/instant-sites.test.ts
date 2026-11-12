/* QA67 LOW-5 / QA58 LOW-3: every place that orders or compares instants goes through lib/instant.ts, not string order.
 * Each test feeds a pair where STRING order and TIME order disagree (an offset timestamp, or fractional seconds) through the public function behind the site. */
import { describe, it, expect, vi } from 'vitest';
import type { TRow } from './data';

const OFFSET_EARLY = '2026-10-24T20:00:00+02:00'; // 18:00Z: EARLIER than OFFSET_LATE by the clock, LATER by the string
const OFFSET_LATE = '2026-10-24T19:00:00Z';
const OLD = '2026-10-01T00:00:00Z';

/* rolloutsPage and homePage read `rollouts(hs)` from ./data: wrap it so chosen rows carry the trap instants (the fixture keeps its own state otherwise) */
const traps = vi.hoisted(() => ({ set: null as null | ((rows: any[]) => void), ev: null as null | ((evs: any[]) => any[]) }));
vi.mock('./data', async (orig) => {
	const real = await orig<typeof import('./data')>();
	return { ...real, fleet24hEvents: (...a: Parameters<typeof real.fleet24hEvents>) => { const e = real.fleet24hEvents(...a).map((x) => ({ ...x })); return traps.ev ? traps.ev(e) : e; }, rollouts: (...a: Parameters<typeof real.rollouts>) => { const R = real.rollouts(...a); traps.set?.(R.rows); return R; } };
});
import * as D from './data';
import { runwayRow, nextThing } from './rollout-view';
import { rolloutsPage } from './rollouts-page';
import { homePage } from './home-page';
import { rides, newest } from './change-view';

const rowOf = (over: Partial<TRow>): TRow => ({ ...(D.rollouts('incident').rows[0] as TRow), ...over });

describe('rollout-view', () => {
	it('nextThing names the EARLIEST approval by instant', () => {
		const base = D.rollouts('incident').rows.find((r) => r.group === 'approval')!;
		const a = { ...base, app: 'app-offset', since: OFFSET_EARLY }, b = { ...base, app: 'app-z', since: OFFSET_LATE };
		expect(nextThing([b, a])).toContain('app-offset');
		expect(nextThing([a, b])).toContain('app-offset');
	});
	it('nextThing falls back to the earliest HOLD by instant, and a missing since never wins', () => {
		const base = D.rollouts('incident').rows.find((r) => r.group === 'held')!;
		const a = { ...base, app: 'held-offset', since: OFFSET_EARLY }, b = { ...base, app: 'held-z', since: OFFSET_LATE }, c = { ...base, app: 'held-none', since: null };
		expect(nextThing([c, b, a])).toContain('held-offset');
	});
	it('runwayRow picks the NEWEST moving row by instant', () => {
		const base = D.rollouts('incident').rows.find((r) => r.group === 'moving')!;
		const a = { ...base, app: 'mv-offset', since: OFFSET_EARLY }, b = { ...base, app: 'mv-z', since: OFFSET_LATE };
		expect(runwayRow([a, b])!.app).toBe('mv-z');
		expect(runwayRow([{ ...base, app: 'mv-none', since: null }, a])!.app).toBe('mv-offset');
	});
});

describe('data.urgency', () => {
	it('within a class the newer instant leads', () => {
		const m = (since: string | null) => ({ state: 'deploying', group: 'moving', tier: 'dev', since }) as never;
		expect(D.urgency(m(OFFSET_EARLY), m(OFFSET_LATE))).toBeGreaterThan(0); // b (19:00Z) is newer, so b leads
		expect(D.urgency(m(null), m(OFFSET_LATE))).toBeGreaterThan(0);
	});
});

describe('rollouts page strands (sinceDesc)', () => {
	it('moving rows list the newest instant first', () => {
		traps.set = (rows) => {
			const mv = rows.filter((r) => r.group === 'moving');
			mv.forEach((r, i) => { r.since = i === 0 ? OFFSET_EARLY : i === 1 ? OFFSET_LATE : OLD; });
			traps.set = null;
			(globalThis as any).__mv = [mv[0].key, mv[1].key];
		};
		const p = rolloutsPage('incident');
		const [early, late] = (globalThis as any).__mv as string[];
		const keys = p.groups.find((g) => g.key === 'moving')!.rows.map((r) => r.key);
		expect(keys.indexOf(late)).toBeLessThan(keys.indexOf(early));
	});
});

describe('home page fleet', () => {
	it('trouble lists the OLDEST instant first within a kind', () => {
		let apps2: string[] = [];
		traps.set = (rows) => {
			const held = rows.filter((r) => r.group === 'held');
			apps2 = [...new Set(held.map((r) => r.app as string))].slice(0, 2);
			for (const r of held) r.since = r.app === apps2[0] ? OFFSET_EARLY : r.app === apps2[1] ? OFFSET_LATE : OLD;
			traps.set = null;
		};
		const h = homePage('incident');
		const apps = h.fleet.trouble.filter((t) => t.mark === 'held').map((t) => t.app);
		expect(apps2.length).toBe(2);
		/* both trap apps are held-trouble rows; OLD rows sort first, and the relative order of the two traps is the instant order */
		expect(apps).toContain(apps2[0]);
		expect(apps).toContain(apps2[1]);
		expect(apps.indexOf(apps2[0])).toBeLessThan(apps.indexOf(apps2[1]));
	});
});

describe('home page fleet: last deploys and the trouble fold', () => {
	it('an app\'s deploy takes the latest instant of its events; the list is newest first', () => {
		traps.ev = (evs) => {
			const X = 'checkout-api', Y = 'invoice-api', Z = 'hello-world';
			const same = evs.filter((e) => e.app === X && e.build === '4.42.0-42' && e.tier === 'prod');
			for (const e of evs) e.at = OLD;
			same[0].at = '2026-10-24T19:00:00.5Z'; same[1].at = '2026-10-24T19:00:00Z';
			const y = evs.filter((e) => e.app === Y); const z = evs.filter((e) => e.app === Z);
			for (const e of y) e.at = OFFSET_EARLY;
			for (const e of z) e.at = OFFSET_LATE;
			return evs;
		};
		try {
			const h = homePage('incident');
			const d = h.fleet.deploys;
			expect(d[0].app).toBe('checkout-api');
			expect(d[0].at).toBe('2026-10-24T19:00:00.5Z');
			expect(d.slice(0, 3).map((x) => x.app)).toEqual(['checkout-api', 'hello-world', 'invoice-api']);
		} finally { traps.ev = null; }
	});
	it('a trouble row dates itself by the EARLIEST instant among its rows', () => {
		let a0 = '', a1 = '';
		traps.set = (rows) => {
			const held = rows.filter((r) => r.group === 'held');
			const n = (app: string) => held.filter((r) => r.app === app).length;
			const apps = [...new Set(held.map((r) => r.app as string))];
			a0 = apps.find((x) => n(x) >= 2)!; a1 = apps.find((x) => x !== a0)!;
			let i = 0;
			for (const r of held) r.since = r.app === a0 ? (i++ === 0 ? OFFSET_EARLY : OFFSET_LATE) : r.app === a1 ? '2026-10-24T18:30:00Z' : OLD;
			traps.set = null;
		};
		const h = homePage('incident');
		const apps = h.fleet.trouble.filter((t) => t.mark === 'held').map((t) => t.app);
		const own = apps.filter((x) => x === a0 || x === a1);
		/* a0's earliest row is 18:00Z, before a1's 18:30Z; the later 19:00Z row of a0 must not displace it */
		expect(own).toEqual([a0, a1]);
	});
});

describe('change-view', () => {
	const fx = () => ({ C: D.changes('incident'), R: D.rollouts('incident') });
	/* two copies of one real change that differ only by key, place and instant: same bucket, same tier, same urgency, so ONLY the instant orders them */
	const pair = (bucket: string, same = false) => {
		const { C, R } = fx();
		const base = C.items.find((c) => rides([c], R.rows, null)[0]?.bucket === bucket)!;
		/* no roster row behind the clone's href: a failed/held/approval ride's age is otherwise overwritten by its row's own clock */
		const mk = (k: string, since: string) => ({ ...base, key: k, href: same ? base.href : `/nowhere/${k}`, where: same ? base.where : `${base.where}-${k}`, since, mergedAt: OLD });
		return { R, a: mk('k-early', OFFSET_EARLY), b: mk('k-late', OFFSET_LATE) };
	};
	it('newest() picks the newest ride by instant', () => {
		expect(newest([{ since: OFFSET_EARLY, key: 'a' }, { since: OFFSET_LATE, key: 'b' }] as never)!.key).toBe('b');
		expect(newest([{ since: null, key: 'n' }, { since: OFFSET_EARLY, key: 'a' }] as never)!.key).toBe('a');
	});
	for (const bucket of ['landed', 'moving', 'stopped']) {
		it(`${bucket} rides list the newest instant first`, () => {
			const { R, a, b } = pair(bucket);
			const out = rides([a, b] as never, R.rows, null).filter((r) => r.bucket === bucket);
			expect(out.map((r) => r.items[0].key)).toEqual(['k-late', 'k-early']);
		});
	}
	it('a ride keeps the LATEST instant among its changes', () => {
		const { R, a, b } = pair('moving', true);
		const out = rides([a, b] as never, R.rows, null).filter((r) => r.bucket === 'moving');
		expect(out.length).toBe(1);
		expect(out[0].items.length).toBe(2);
		expect(out[0].since).toBe(OFFSET_LATE);
	});
	it('a ride lists its changes newest merge first by instant', () => {
		const { R, a, b } = pair('moving', true);
		const out = rides([{ ...a, mergedAt: OFFSET_EARLY, since: OLD }, { ...b, mergedAt: OFFSET_LATE, since: OLD }] as never, R.rows, null).filter((r) => r.bucket === 'moving');
		expect(out[0].items.map((c) => c.key)).toEqual(['k-late', 'k-early']);
	});
});
