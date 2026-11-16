import { describe, it, expect } from 'vitest';
import type { HealthCheck } from '../../types';
import { headRecovered, headFailingNow, checkView, poolOf, snapView, worstOf, shortCause, evidenceLine, snapshotCause, figureOf, classOf, windowStrip, failingRowCount, bannerEvidence, historyPool, failureSince, failingNowList, failingSummary, withAge } from './health-failures';

const mk = (cls: string, status: Record<string, unknown>, name = 'x'): HealthCheck => ({ metadata: { name }, spec: { class: cls }, status } as unknown as HealthCheck);
const win = new Date('2026-11-15T09:00:00Z');
const T = (m: number) => `2026-11-15T10:${String(m).padStart(2, '0')}:00Z`;

describe('health-failures (observations only)', () => {
	it('C1 resource ratio: row from the failing observation, message verbatim', () => {
		const hc = mk('kustomization', { status: 'Unhealthy', lastChangeTime: T(1), observations: [{ name: 'Deployment shop/checkout-api', kind: 'Ratio', value: '1', total: '3', unit: 'ready', healthy: false, message: 'Readiness probe failed: HTTP probe failed with statuscode: 503' }] });
		const v = checkView(hc, win);
		expect(v.verdict).toBe('failing');
		expect(v.cls).toBe('kustomization');
		expect(v.rows).toHaveLength(1);
		expect(v.rows[0].figure).toEqual({ value: '1 of 3', note: 'ready' });
		expect(v.rows[0].message).toBe('Readiness probe failed: HTTP probe failed with statuscode: 503');
		expect(shortCause(v.rows[0])).toBe('Deployment shop/checkout-api 1/3 ready');
	});
	it('C2 threshold figure and short cause', () => {
		const hc = mk('datadog', { status: 'Unhealthy', observations: [{ name: 'checkout p99 latency', kind: 'Threshold', value: '812', limit: '500', direction: 'Above', unit: 'ms', window: '5m', healthy: false }] });
		const [r] = checkView(hc, win).rows;
		expect(r.figure).toEqual({ value: '812 ms', note: 'over 500 ms, 5m window' });
		expect(shortCause(r)).toBe('checkout p99 latency 812 ms / 500 ms');
	});
	it('healthy observations are not rows; State has no figure', () => {
		const hc = mk('datadog', { status: 'Unhealthy', observations: [{ name: 'a', kind: 'State', value: 'Alert', healthy: false }, { name: 'b', kind: 'Threshold', value: '1', limit: '5', direction: 'Above', healthy: true }] });
		const v = checkView(hc, win);
		expect(v.rows.map((r) => r.name)).toEqual(['a']);
		expect(v.rows[0].figure).toBeNull();
		expect(shortCause(v.rows[0])).toBe('a');
	});
	it('C4 pending: unset healthy is a pending row; waiting since lastChangeTime', () => {
		const hc = mk('kustomization', { status: 'Pending', lastChangeTime: T(2), observations: [{ name: 'Deployment orders/orders-worker', kind: 'Ratio', value: '2', total: '3', unit: 'updated' }] });
		const v = checkView(hc, win);
		expect(v.verdict).toBe('pending');
		expect(v.rows[0].state).toBe('pending');
		expect(v.since).toBe(T(2));
	});
	it('C7 pending without observations keeps only the message (a provider error is just pending)', () => {
		const hc = mk('prometheus-alert', { status: 'Pending', message: 'Prometheus query failed', lastChangeTime: T(2) });
		const v = checkView(hc, win);
		expect(v.verdict).toBe('pending');
		expect(v.rows).toEqual([]);
		expect(v.message).toBe('Prometheus query failed');
	});
	it('C5 recovered: figure from the snapshot, never the live healthy value; failedAt from the snapshot', () => {
		const hc = mk('prometheus-alert', { status: 'Healthy', lastErrorTime: T(4), lastChangeTime: T(5), observations: [{ name: 'HighLatency', kind: 'Threshold', value: '0.4', limit: '1', direction: 'Above', unit: 's', healthy: true }] }, 'chk');
		const snaps = [{ name: 'chk', observations: [{ name: 'HighLatency', kind: 'Threshold' as const, value: '1.9', limit: '1', direction: 'Above' as const, unit: 's', healthy: false, observedTime: T(2) }] }];
		const v = checkView(hc, win, snaps);
		expect(v.verdict).toBe('recovered');
		expect(v.rows).toEqual([]);
		expect(v.recovery?.okSince).toBe(T(5));
		expect(v.recovery?.failedAt).toBe(T(2));
		expect(v.recovery?.rows[0].figure?.value).toBe('1.9 s');
		const w = worstOf([v]);
		expect(w?.recovered).toBe(true);
		expect(shortCause(w!.row!, true)).toBe('HighLatency recovered');
		expect(evidenceLine([v])?.recovered).toBe(true);
	});
	it('recovered without a snapshot falls back to the witness for failedAt', () => {
		const hc = mk('datadog', { status: 'Healthy', lastErrorTime: T(3), lastChangeTime: T(4) });
		expect(checkView(hc, win).recovery?.failedAt).toBe(T(3));
	});
	it('a Healthy check with an error older than the window is passing, no recovery', () => {
		const hc = mk('datadog', { status: 'Healthy', lastErrorTime: '2026-11-15T08:00:00Z' });
		expect(checkView(hc, win).verdict).toBe('passing');
		expect(checkView(hc, win).recovery).toBeNull();
	});
	it('worst: a drawable figure first; +n more counts failing observations', () => {
		const a = mk('datadog', { status: 'Unhealthy', observations: [{ name: 'lag', kind: 'State', healthy: false }, { name: 'errs', kind: 'Threshold', value: '3', limit: '1', direction: 'Above', unit: '%', healthy: false }] }, 'a');
		const b = mk('prometheus-alert', { status: 'Unhealthy', observations: [{ name: 'Backlog', kind: 'Count', value: '9', healthy: false }] }, 'b');
		const pool = poolOf([a, b], [], win);
		expect(worstOf(pool)?.row?.name).toBe('errs');
		expect(failingRowCount(pool)).toBe(3);
		expect(evidenceLine(pool)?.note).toBe('+2 more');
		expect(evidenceLine(pool)?.short).toBe('3% / 1%');
	});
	it('snapshot only (no live check): failing rows from the history entry', () => {
		const obs = [{ name: 'p99', kind: 'Threshold' as const, value: '812', limit: '500', direction: 'Above' as const, unit: 'ms', healthy: false }];
		expect(snapView({ name: 'n', observations: obs }).verdict).toBe('failing');
		expect(snapshotCause([{ name: 'n', observations: obs }])).toEqual({ check: { name: 'p99', message: '812 ms / 500 ms' }, more: 0 });
	});
	it('no observation evidence: evidenceLine is null', () => {
		expect(evidenceLine([checkView(mk('x', { status: 'Unhealthy', message: 'boom' }), win)])).toBeNull();
	});
	it('figureOf: Count unit word, malformed numbers draw nothing', () => {
		expect(figureOf({ name: 'o', kind: 'Count', value: '0', unit: 'incidents' })).toEqual({ value: '0', note: 'incidents' });
		expect(figureOf({ name: 'o', kind: 'Threshold', value: 'abc', limit: '1', direction: 'Above' })).toBeNull();
	});
	it('classOf maps the spec class', () => {
		expect(classOf({ spec: { class: 'datadog-incidents' } })).toBe('incidents');
		expect(classOf({ spec: { class: 'datadog-monitor-crd' } })).toBe('datadog');
		expect(classOf({ spec: { class: 'prometheus-alert' } })).toBe('prometheus');
	});
	it('windowStrip clamps to the axis and keeps ok after failed', () => {
		const s = windowStrip({ failedAt: T(20), okSince: T(25), rows: [] }, new Date(T(0)), new Date(T(40)));
		expect(s?.failedPct).toBeCloseTo(0.5);
		expect(s?.okPct).toBeCloseTo(0.625);
		expect(s?.okLabel.startsWith('OK ')).toBe(true);
	});
});


describe('r2 rulings', () => {
	const failing = mk('datadog', { status: 'Unhealthy', lastChangeTime: T(5), lastErrorTime: T(10), observations: [{ name: 'p99', kind: 'Threshold', value: '812', limit: '500', direction: 'Above', unit: 'ms', healthy: false, message: 'svc:a' }] }, 'a-dd');
	const pending = mk('kustomization', { status: 'Pending', lastChangeTime: T(6), observations: [{ name: 'Deployment x/y', kind: 'Ratio', value: '2', total: '3', unit: 'updated' }] }, 'b-ks');
	const recovered = mk('prometheus', { status: 'Healthy', lastChangeTime: T(20), lastErrorTime: T(15), observations: [{ name: 'HighLatency', kind: 'Threshold', value: '0.4', limit: '1', direction: 'Above', unit: 's', healthy: true }] }, 'c-pm');
	const snaps = [
		{ name: 'c-pm', observations: [{ name: 'HighLatency', kind: 'Threshold', value: '1.9', limit: '1', direction: 'Above', unit: 's', healthy: false, observedTime: T(12) }] },
		{ name: 'b-ks' },
		{ name: 'a-dd', observations: [{ name: 'p99', kind: 'Threshold', value: '812', limit: '500', direction: 'Above', unit: 'ms', healthy: false }] }
	] as never[];
	it('history uses the Overview classification and order: failing, pending, recovered; a pending check stays pending', () => {
		const v = historyPool(snaps, [recovered, pending, failing], win);
		expect(v.map((x) => x.verdict)).toEqual(['failing', 'pending', 'recovered']);
		expect(v.map((x) => x.key.split('/')[0])).toEqual(['a-dd', 'b-ks', 'c-pm']);
		expect(v[2].recovery?.okSince).toBe(T(20));
	});
	it('a past entry draws every snapshot as failed, in snapshot order', () => {
		expect(historyPool(snaps, [], null).map((x) => x.verdict)).toEqual(['failing', 'failing', 'failing']);
	});
	it('banner evidence: live failure counts checks and ages; recovered says when a retry is reasonable', () => {
		const live = bannerEvidence(poolOf([failing, pending, recovered], snaps, win), 1, '12m')!;
		expect(live.message).toBe('1\u00a0health check failing, 1\u00a0pending\u00a0\u00b7\u00a012m\u00a0ago');
		expect(live.check.cls).toBe('datadog');
		const none = bannerEvidence(poolOf([failing], [snaps[2]], win), 0, null)!;
		expect(none.message).toBe('1\u00a0health check failing');
		const rec = bannerEvidence(poolOf([recovered], [snaps[0]], win), 0, null)!;
		expect(rec.recovered).toBe(true);
		expect(rec.message).toMatch(/^Recovered at \d\d:\d\d, so a retry is reasonable\.$/);
		expect(rec.check.message).toMatch(/^1\.9 s over 1 s.* at \d\d:\d\d$/);
	});
	it('the recovered strip starts at the check and ends at now', () => {
		const rec = checkView(recovered, win, [snaps[0]]).recovery!;
		const s = windowStrip(rec, new Date(T(2)), new Date(T(30)))!;
		expect(s.startLabel).toMatch(/^check \d\d:\d\d$/);
	});
});

describe('a recovered check follows its verdict, not the presence of observations', () => {
	const hc = mk('datadog', { status: 'Healthy', lastErrorTime: T(3), lastChangeTime: T(6) }, 'dd');
	const pool = () => poolOf([hc], [{ name: 'dd', message: 'monitor alerted' }], win);
	it('Healthy + a recent lastErrorTime + no observations is recovered, and the evidence says so', () => {
		const v = checkView(hc, win, [{ name: 'dd' }]);
		expect(v.verdict).toBe('recovered');
		const w = worstOf(pool());
		expect(w?.recovered).toBe(true);
		expect(w?.row).toBeNull();
		const ev = evidenceLine(pool());
		expect(ev?.recovered).toBe(true);
		expect(ev?.cause).toBe('dd recovered');
		expect(ev?.okSince).toBe(T(6));
		const b = bannerEvidence(pool(), 0, null);
		expect(b?.recovered).toBe(true);
		expect(b?.check.name).toBe('dd');
	});
});

describe('a check failing now outranks a recovered one, even without observations', () => {
	it('Unhealthy with no observations + another check recovered: not recovered, no "retry is reasonable"', () => {
		const a = mk('kustomization', { status: 'Unhealthy', lastChangeTime: T(5) }, 'a');
		const b = mk('datadog', { status: 'Healthy', lastErrorTime: T(3), lastChangeTime: T(6) }, 'b');
		const pool = poolOf([a, b], [{ name: 'a' }, { name: 'b', message: 'monitor alerted' }], win);
		expect(pool.map((c) => c.verdict).sort()).toEqual(['failing', 'recovered']);
		const w = worstOf(pool);
		expect(w?.recovered).toBe(false);
		expect(w?.check.name).toBe('a');
		expect(w?.row).toBeNull();
		expect(evidenceLine(pool)).toBeNull();
		expect(bannerEvidence(pool, 0, null)).toBeNull();
	});
});

describe('failureSince: the failure has one age', () => {
	it('is the earliest start among the failing checks, never a pending one', () => {
		const dd = mk('datadog', { status: 'Unhealthy', lastChangeTime: T(8), lastErrorTime: T(40), observations: [{ name: 'a', kind: 'State', value: 'Alert', healthy: false }] }, 'dd');
		const prom = mk('prometheus-alert', { status: 'Unhealthy', lastChangeTime: T(12), lastErrorTime: T(40), observations: [{ name: 'b', kind: 'State', value: 'Alert', healthy: false }] }, 'prom');
		const kust = mk('kustomization', { status: 'Pending', lastChangeTime: T(2) }, 'kust');
		const pool = poolOf([prom, kust, dd], [], null);
		expect(failureSince(pool)).toBe(T(8));
	});
	it('a recovered failure keeps the age its evidence prints: recovery.failedAt, the earliest across checks', () => {
		const rec = mk('prometheus-alert', { status: 'Healthy', lastErrorTime: T(4), lastChangeTime: T(5), observations: [{ name: 'HighLatency', kind: 'Threshold', value: '0.4', limit: '1', direction: 'Above', unit: 's', healthy: true }] }, 'rec');
		const snaps = [{ name: 'rec', observations: [{ name: 'HighLatency', kind: 'Threshold' as const, value: '1.9', limit: '1', direction: 'Above' as const, unit: 's', healthy: false, observedTime: T(2) }] }];
		const pool = poolOf([rec], snaps, win);
		expect(pool[0].verdict).toBe('recovered');
		expect(failureSince(pool)).toBe(T(2));
		expect(failureSince(pool)).toBe(pool[0].recovery?.failedAt);
		/* a check still failing joins in: the earliest of the two */
		const dd = mk('datadog', { status: 'Unhealthy', lastChangeTime: T(1), observations: [{ name: 'a', kind: 'State', value: 'Alert', healthy: false }] }, 'dd');
		expect(failureSince(poolOf([rec, dd], snaps, win))).toBe(T(1));
	});
	it('a recovered check with no observations ages from its witness lastErrorTime', () => {
		const hc = mk('datadog', { status: 'Healthy', lastErrorTime: T(3), lastChangeTime: T(6) }, 'dd');
		expect(failureSince(poolOf([hc], [{ name: 'dd' }], win))).toBe(T(3));
	});
	it('is null when nothing is failing', () => {
		const kust = mk('kustomization', { status: 'Pending', lastChangeTime: T(3) }, 'kust');
		expect(failureSince(poolOf([kust], [], null))).toBeNull();
	});
});

describe('the banner sentence counts only the checks failing now', () => {
	const snaps = [{ name: 'a', message: 'a: latency over budget; more' }, { name: 'b', message: 'b monitor alerted' }];
	const live = [mk('datadog', { status: 'Unhealthy' }, 'a'), mk('datadog', { status: 'Healthy', lastErrorTime: T(3), lastChangeTime: T(5) }, 'b')];
	const nameOf = (c: { name: string }) => c.name;
	it('A failing, B recovered: one check, named, not "2 health checks failing: a, b"', () => {
		const list = failingNowList(snaps, live);
		expect(list.map((c) => c.name)).toEqual(['a']);
		expect(failingSummary(list, nameOf)).toBe('a: a: latency over budget');
	});
	it('both failing now: counts and names both', () => {
		const both = [mk('datadog', { status: 'Unhealthy' }, 'a'), mk('datadog', { status: 'Unhealthy' }, 'b')];
		expect(failingSummary(failingNowList(snaps, both), nameOf)).toBe('2 health checks failing: a, b');
	});
	it('all recovered, or no live checks (older controllers): the history record answers', () => {
		const rec = [mk('datadog', { status: 'Healthy', lastErrorTime: T(3), lastChangeTime: T(5) }, 'a'), live[1]];
		expect(failingNowList(snaps, rec)).toBe(snaps);
		expect(failingNowList(snaps, [])).toBe(snaps);
		expect(failingSummary(failingNowList(snaps, []), nameOf)).toBe('2 health checks failing: a, b');
		expect(failingSummary([], nameOf)).toBeNull();
	});
	it('a check failing now that the snapshot never recorded is still named, with its live message', () => {
		const only = [mk('datadog', { status: 'Unhealthy', message: 'late failure' }, 'c')];
		expect(failingSummary(failingNowList(snaps, only), nameOf)).toBe('c: late failure');
	});
	it('the lead check is the one failing now, even when the record never named it (not the record\'s first, which may have recovered)', () => {
		const rec = [{ name: 'a', message: 'a recovered earlier' }];
		const only = [mk('datadog', { status: 'Healthy', lastErrorTime: T(3), lastChangeTime: T(5) }, 'a'), mk('datadog', { status: 'Unhealthy', message: 'c is down', observations: [{ name: 'q', healthy: false }] }, 'c')];
		const lead = failingNowList(rec, only)[0];
		expect(lead.name).toBe('c');
		expect(lead.message).toBe('c is down');
		expect(lead.observations?.[0].name).toBe('q');
		expect(failingNowList(rec, [only[0]])[0].name).toBe('a');
	});
});

describe('withAge', () => {
	it('puts the age on the health line, never on a meta line', () => {
		expect(withAge('2\u00a0health checks failing, 1\u00a0pending', '12m ago')).toBe('2\u00a0health checks failing, 1\u00a0pending\u00a0\u00b7\u00a012m\u00a0ago');
		expect(withAge('2 health checks failing', null)).toBe('2 health checks failing');
	});
});

describe('headRecovered', () => {
	const snap = [{ name: 'chk', observations: [{ name: 'HighLatency', kind: 'Threshold' as const, value: '1.9', limit: '1', direction: 'Above' as const, unit: 's', healthy: false, observedTime: T(2) }] }];
	const head = { timestamp: '2026-11-15T09:00:00Z', failedHealthChecks: snap };
	it('is true once every failed check is OK again', () => {
		const ok = mk('prometheus-alert', { status: 'Healthy', lastErrorTime: T(4), lastChangeTime: T(5), observations: [{ name: 'HighLatency', kind: 'Threshold', value: '0.4', limit: '1', direction: 'Above', unit: 's', healthy: true }] }, 'chk');
		expect(headRecovered([ok], head)).toBe(true);
	});
	it('is false while a check fails now, and with no head', () => {
		const bad = mk('prometheus-alert', { status: 'Unhealthy', lastChangeTime: T(5), observations: [{ name: 'HighLatency', kind: 'Threshold', value: '1.9', limit: '1', direction: 'Above', unit: 's', healthy: false }] }, 'chk');
		expect(headRecovered([bad], head)).toBe(false);
		expect(headRecovered([], null)).toBe(false);
	});
});

describe('headFailingNow', () => {
	const snap = [{ name: 'chk', observations: [{ name: 'HighLatency', kind: 'Threshold' as const, value: '1.9', limit: '1', direction: 'Above' as const, unit: 's', healthy: false, observedTime: T(2) }] }];
	const head = { timestamp: '2026-11-15T09:00:00Z', failedHealthChecks: snap };
	const bad = mk('prometheus-alert', { status: 'Unhealthy', lastChangeTime: T(5), observations: [{ name: 'HighLatency', kind: 'Threshold', value: '1.9', limit: '1', direction: 'Above', unit: 's', healthy: false }] }, 'chk');
	const ok = mk('prometheus-alert', { status: 'Healthy', lastErrorTime: T(4), lastChangeTime: T(5), observations: [{ name: 'HighLatency', kind: 'Threshold', value: '0.4', limit: '1', direction: 'Above', unit: 's', healthy: true }] }, 'chk');
	it('is true while a check of the head deploy fails now', () => expect(headFailingNow([bad], head)).toBe(true));
	it('is false once every check recovered, with no check involved, and with no head', () => {
		expect(headFailingNow([ok], head)).toBe(false);
		expect(headFailingNow([], { timestamp: '2026-11-15T09:00:00Z' })).toBe(false);
		expect(headFailingNow([], null)).toBe(false);
	});
});
