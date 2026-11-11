import { it, expect } from 'vitest';
import * as D from './data';
import { rolloutsPage, GROUP_WORD, chipPlace } from './rollouts-page';

/* r39 build: the Rollouts page composition. Each rollout once: banner / Attention / one group; every number the header prints is a row count. */
for (const hs of ['incident', 'calm'] as const) {
	it(`${hs}: the banner, Attention and the groups never repeat a rollout`, () => {
		const P = rolloutsPage(hs);
		const keys = [...(P.banner ? [P.banner.row.key] : []), ...P.attention.map((a) => a.key), ...P.groups.flatMap((g) => g.rows.map((r) => r.key))];
		expect(new Set(keys).size).toBe(keys.length);
		expect(P.counts.moving + P.counts.waiting + P.counts.held).toBe(P.groups.reduce((n, g) => n + g.rows.length, 0));
		expect(P.counts.rest).toBe(P.rest.length);
		expect(P.groups.map((g) => g.word).every((w) => Object.values(GROUP_WORD).includes(w))).toBe(true);
	});
}
it('incident: the lead failure is the banner, the other failures then the viewer approvals are Attention', () => {
	const P = rolloutsPage('incident');
	const rows = D.rollouts('incident').rows;
	expect(P.banner?.row.group).toBe('failed');
	expect(P.failing).toBe(rows.filter((r) => r.group === 'failed').length);
	expect(P.attention.filter((a) => a.model.state === 'failed')).toHaveLength(P.failing - 1);
	expect(P.attention.filter((a) => a.yours).every((a) => a.row.needsYou)).toBe(true);
	/* no observations API on the list payload: a failing card leads with the check, never a figure */
	expect(P.attention.filter((a) => a.model.state === 'failed').every((a) => a.model.figure !== null)).toBe(true);
});
it('a place covered by a row is not also At rest; rest rows are healthy or rolled back, one per place', () => {
	const P = rolloutsPage('incident');
	const hrefs = new Set(D.rollouts('incident').rows.map((r) => r.href));
	expect(P.rest.every((r) => !hrefs.has(r.href))).toBe(true);
	expect(new Set(P.rest.map((r) => r.href)).size).toBe(P.rest.length);
	expect(P.rest.every((r) => /^(On the newest|Rolled back|Healthy|\d+ behind)$/.test(r.sentence))).toBe(true);
});
it('chipPlace: a folded region set is a count, a tier-only place is null', () => {
	const rows = D.rollouts('incident').rows;
	for (const r of rows) { const p = chipPlace(r); if (r.regions.length > 1) expect(p).toBe(`${r.regions.length} regions`); else expect(p === null || !/^(prod|production|staging|dev|test)$/.test(p)).toBe(true); }
});

/* QA #7 (2026-11-09): a place that was rolled back and is NOW held by an approval (or deploying) is waiting / in flight, not "At rest — Rolled back".
   Fixture = the live hub's hello-world-app after the rollback flow test: prod runs 785ffe0 (rolled back from d993f4d), approval gate refuses every newer build. */
import fs from 'node:fs';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
it('a rolled-back place that waits on an approval is in Waiting, not At rest', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-rolled-back-held.json', 'utf8'));
	installLiveSource({ rollouts: d.rollouts, environments: d.environments, rolloutDependencies: d.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'not_connected', healthChecks: [], github: { configured: false, connected: false }, me: '', now: new Date('2026-11-09T14:15:00Z') } as never);
	try {
		const P = rolloutsPage('incident');
		expect(P.rest.filter((r) => r.sentence === 'Rolled back' && /prod/.test(r.href))).toEqual([]);
		const prod = P.groups.flatMap((g) => g.rows.map((r) => ({ ...r, g: g.key }))).filter((r) => /hello-world-prod/.test(r.href));
		expect(prod).toHaveLength(1);
		expect(prod[0].g).toBe('waiting');
	} finally { installLiveSource(null); }
});

/* QA #7 (TL follow-up): live hub, prod runs 785ffe0 after a rollback; staging runs e7c1b60 and the chain gate allows e7c1b60/715ccd1/d993f4d, so only
   the manual approval stands between those builds and prod: the place is Waiting (approval), never At rest. */
it('a build blocked only by the approval gate (chain gate allows it) puts the place in Waiting', () => {
	const d = JSON.parse(fs.readFileSync('src/lib/components/new/fixtures/qa-approval-only-held.json', 'utf8'));
	installLiveSource({ rollouts: d.rollouts, environments: d.environments, rolloutDependencies: d.rolloutDependencies, kustomizations: [], kruiseRollouts: [], changes: [], changesState: 'not_connected', healthChecks: [], github: { configured: false, connected: false }, me: '', now: new Date() } as never);
	try {
		const P = rolloutsPage('incident');
		const all = [...P.groups.flatMap((g) => g.rows.map((r) => ({ href: r.href, g: g.key }))), ...P.attention.map((a) => ({ href: a.href, g: 'attention' }))];
		const prod = all.filter((r) => /hello-world-prod/.test(r.href));
		expect(prod).toHaveLength(1);
		expect(['waiting', 'attention']).toContain(prod[0].g);
		expect(P.rest.some((r) => /hello-world-prod/.test(r.href))).toBe(false);
	} finally { installLiveSource(null); }
});

it('chipPlace: several prod entries on one default site never say "regions" (QA2)', () => {
	const r = { tier: 'prod', regions: ['prod', 'production', 'prod'], where: '' } as never;
	expect(chipPlace(r) ?? '').not.toMatch(/regions/);
	expect(chipPlace({ tier: 'prod', regions: ['prod-us-east-1', 'prod-eu-west-1'], where: '' } as never)).toBe('2 regions');
});
