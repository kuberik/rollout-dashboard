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
	expect(c.title).toBe('prod is slow to answer — showing its data from 09:41');
	expect(`${c.title} ${c.message}`).not.toMatch(/unreachable|stopped answering|spoke/i);
	expect(clusterNoticeCopy([stale('prod', 'slow'), stale('dev', 'slow')], 'Home', '').title).toBe('2 clusters are slow to answer');
});
it('MED-2: unreachable keeps today\'s copy, and a missing reason (older hub) is unreachable', () => {
	for (const r of ['unreachable', undefined] as const) {
		const c = clusterNoticeCopy([stale('prod', r)], 'Home', '09:41');
		expect(c.slow).toBe(false);
		expect(c.title).toBe('prod is unreachable — its rollouts show their last known state');
		expect(c.message).toContain('stopped answering after 09:41');
	}
	expect(clusterReason(stale('prod'))).toBe('unreachable');
});
it('MED-2: one unreachable cluster among slow ones makes the group unreachable; non-stale errors stay "did not answer"', () => {
	expect(clusterNoticeCopy([stale('a', 'slow'), stale('b', 'unreachable')], 'Home', '').slow).toBe(false);
	expect(clusterNoticeCopy([e('prod')], 'Home', '').title).toBe('prod did not answer — this page is incomplete');
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

import { clusterDetail } from './cluster-errors';
it('the Details line is plain words chosen by the typed reason, never the raw fetch error', () => {
	const raw = 'Get "https://10.0.0.5:6443/api": dial tcp 10.0.0.5:6443: i/o timeout';
	const slow = clusterDetail({ ...stale('prod', 'slow'), error: raw });
	const unr = clusterDetail({ ...stale('prod', 'unreachable'), error: raw });
	const none = clusterDetail({ ...e('prod'), error: raw });
	expect(slow).toBe('Is up, but did not answer in time.');
	expect(unr).toBe('Could not be reached.');
	expect(none).toBe(unr);
	for (const t of [slow, unr, none]) expect(t).not.toMatch(/dial|tcp|10\.0|timeout|https/);
});
it('the slow and the unreachable headings use one grammar: cause — consequence, never a middle dot', () => {
	for (const r of ['slow', 'unreachable'] as const) expect(clusterNoticeCopy([stale('prod', r)], 'Home', '09:41').title).not.toContain(' · ');
});
it('the notice lists the plain detail, not ce.error', () => {
	const src = readFileSync('src/lib/components/PartialDataNotice.svelte', 'utf8');
	expect(src).toMatch(/clusterDetail/);
	expect(src).not.toMatch(/ce\.error/);
});
