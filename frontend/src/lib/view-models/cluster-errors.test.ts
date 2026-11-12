import { it, expect } from 'vitest';
import { clusterErrorsFor } from './cluster-errors';
const e = (name: string) => ({ url: `https://${name}`, name, error: 'timeout' });
it('keeps only the errors naming this rollout\'s cluster', () => {
	expect(clusterErrorsFor([e('prod'), e('dev')], 'prod')).toEqual([e('prod')]);
	expect(clusterErrorsFor([e('dev')], 'prod')).toEqual([]);
	expect(clusterErrorsFor(undefined, 'prod')).toEqual([]);
});

import { readFileSync } from 'node:fs';
it('A10: the notice formats the last-seen time with the shared display-zone formatter, not toLocaleTimeString', () => {
	const src = readFileSync('src/lib/components/PartialDataNotice.svelte', 'utf8');
	expect(src).not.toMatch(/toLocaleTimeString/);
	expect(src).toMatch(/formatClockTime/);
});

import { clusterNoticeCopy, clusterReason } from './cluster-errors';
const stale = (name: string, reason?: 'slow' | 'unreachable') => ({ ...e(name), stale: true, lastSeen: '2026-11-11T09:41:00Z', reason, error: 'whatever the server said' });

it('MED-2: a slow cluster reads slow, in plain words, never unreachable', () => {
	const c = clusterNoticeCopy([stale('prod', 'slow')], 'Home', '09:41');
	expect(c.slow).toBe(true);
	expect(c.title).toBe('prod is slow to answer · showing its data from 09:41');
	expect(`${c.title} ${c.message}`).not.toMatch(/unreachable|stopped answering|spoke/i);
	expect(clusterNoticeCopy([stale('prod', 'slow'), stale('dev', 'slow')], 'Home', '').title).toBe('2 clusters are slow to answer');
});
it('MED-2: unreachable keeps today\'s copy, and a missing reason (older hub) is unreachable', () => {
	for (const r of ['unreachable', undefined] as const) {
		const c = clusterNoticeCopy([stale('prod', r)], 'Home', '09:41');
		expect(c.slow).toBe(false);
		expect(c.title).toBe('prod is unreachable · its rollouts show their last known state');
		expect(c.message).toContain('stopped answering after 09:41');
	}
	expect(clusterReason(stale('prod'))).toBe('unreachable');
});
it('MED-2: one unreachable cluster among slow ones makes the group unreachable; non-stale errors stay "did not answer"', () => {
	expect(clusterNoticeCopy([stale('a', 'slow'), stale('b', 'unreachable')], 'Home', '').slow).toBe(false);
	expect(clusterNoticeCopy([e('prod')], 'Home', '').title).toBe('prod did not answer · this page is incomplete');
});
it('MED-2: the notice takes its copy from the view-model', () => {
	const src = readFileSync('src/lib/components/PartialDataNotice.svelte', 'utf8');
	expect(src).toMatch(/clusterNoticeCopy/);
});
it('the slow message agrees in number, and no stale copy uses "live" as a state word', () => {
	expect(clusterNoticeCopy([stale('prod', 'slow')], 'Home', '').message).toBe(
		'Its rollouts show the last known state the hub holds. They refresh as soon as prod answers.'
	);
	expect(clusterNoticeCopy([stale('prod', 'slow'), stale('dev', 'slow')], 'Home', '').message).toBe(
		'Their rollouts show the last known state the hub holds. They refresh as soon as the clusters answer.'
	);
	for (const errs of [[stale('prod', 'slow')], [stale('prod', 'unreachable')], [stale('a', 'unreachable'), stale('b', 'unreachable')]]) {
		const c = clusterNoticeCopy(errs, 'Home', '09:41');
		expect(`${c.title} ${c.message}`).not.toMatch(/\blive\b/i);
	}
});

import { clusterDetail, clusterKind } from './cluster-errors';
it('the Details sentence is plain words chosen by the typed reason, and names its cluster', () => {
	const raw = 'Get "https://10.0.0.5:6443/api": dial tcp 10.0.0.5:6443: i/o timeout';
	const slow = clusterDetail({ ...stale('prod', 'slow'), error: raw });
	const unr = clusterDetail({ ...stale('prod', 'unreachable'), error: raw });
	const none = clusterDetail({ ...e('prod'), error: raw });
	expect(slow).toBe('prod is up, but did not answer in time.');
	expect(unr).toBe('prod could not be reached.');
	expect(none).toBe(unr);
	for (const t of [slow, unr, none]) expect(t).not.toMatch(/dial|tcp|10\.0|timeout|https/);
});
it('the notice headings use one grammar: cause · consequence, never a dash', () => {
	for (const r of ['slow', 'unreachable'] as const) {
		const t = clusterNoticeCopy([stale('prod', r)], 'Home', '09:41').title;
		expect(t).toContain(' · ');
		expect(t).not.toContain(' — ');
	}
	expect(clusterNoticeCopy([e('prod')], 'Home', '').title).toContain(' · ');
});
it('the notice lists the plain detail and never prints the raw error', () => {
	const src = readFileSync('src/lib/components/PartialDataNotice.svelte', 'utf8');
	expect(src).toMatch(/value: clusterDetail\(ce\)/);
	expect(src).not.toMatch(/ce\.error/);
});

it('typed kinds map to plain words naming the cluster; the HTTP status is a number, not server text', () => {
	const k = (kind: string, status?: number) => clusterDetail({ ...e('prod'), error: 'raw dial tcp 10.0.0.5: i/o timeout', kind, status } as never);
	expect(k('timeout')).toBe('prod did not answer in time.');
	expect(k('unreachable')).toBe('prod could not be reached.');
	expect(k('rejected', 403)).toBe('prod refused the request (HTTP 403).');
	expect(k('rejected')).toBe('prod refused the request.');
	expect(k('bad_answer')).toBe('prod answered with something the dashboard could not read.');
	// no kind (older hub) reads as unreachable; a typed kind wins over reason
	expect(clusterDetail(e('prod'))).toBe('prod could not be reached.');
	for (const kind of ['timeout', 'unreachable', 'rejected', 'bad_answer']) expect(k(kind, 500)).not.toMatch(/dial|tcp|10\.0|raw/);
	expect(clusterKind({ ...e('prod'), kind: 'rejected' } as never)).toBe('rejected');
	expect(clusterKind({ ...stale('prod', 'slow') })).toBe('timeout');
	expect(clusterKind(e('prod'))).toBe('unreachable');
});
