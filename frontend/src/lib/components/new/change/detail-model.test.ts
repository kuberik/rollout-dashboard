import { describe, it, expect } from 'vitest';
import fixture from '$lib/view-models/home/fixtures/incident-input.json';
import {
	findChange,
	classified,
	runningN,
	stripOf,
	statementOf,
	spineOf,
	blockLine,
	rollbackTo,
	countsOf,
	countLine,
	changeProd,
	commitsOf,
	openedOf,
	howFacts
} from './detail-model';
import { placesOfChange, ago, waitClock } from '../data';
import { firstBuildOf, headFacts, foldWindow, carrierRange } from './detail-model';

const at = (slug: string, s: 'incident' | 'calm' | 'quiet') => {
	const c = findChange(slug, s)!;
	return { c, ...classified(c, s) };
};
const P37 = 'github.com/exampleco/invoice-api/pull/37';
describe('change detail model (one model with the Changes list)', () => {
	it('#36 (CG2, rideTruth): eu-west ran the change healthily, so it is Landed there: no failed place, no roll back', () => {
		const { c, places } = at('github.com/exampleco/invoice-api/pull/36', 'incident');
		expect(places.some((p) => p.kind === 'failed')).toBe(false);
		expect(statementOf(c, places, []).kind).toBe('landed');
		expect(rollbackTo(places.find((p) => p.label === 'eu-west') ?? null)).toBeNull();
	});
	it('#37 (CD2): the strip counts the CHANGE: prod 2/3 = two healthy regions and the failing one, beside "Live in 5 of 6"', () => {
		const { c } = at(P37, 'incident');
		const t = stripOf(c, 'incident');
		expect(t.find((x) => x.tier === 'test')?.word).toBe('1 build behind');
		expect(t.find((x) => x.tier === 'staging')?.word).toBe('1 build behind');
		const prod = t.find((x) => x.tier === 'prod')!;
		expect(prod.frac).toBe('2/3');
		expect([...prod.squares].sort()).toEqual(['failed', 'healthy', 'healthy']); // r7 CG1: squares are THIS change's state per region; Live regions with a newer build waiting are not orange
		expect(prod.label).toBe('1 failing · 2 deployed'); // r13 CE1: "Live" is retired as a state word
		expect(changeProd(c, 'incident').healthy).toBe(2);
	});
	it('#37 quiet (CD2): landed in 3 prod regions = 3/3 healthy squares', () => {
		const { c } = at(P37, 'quiet');
		const prod = stripOf(c, 'quiet').find((x) => x.tier === 'prod')!;
		expect(prod.frac).toBe('3/3');
		expect(prod.squares).toEqual(['healthy', 'healthy', 'healthy']);
	});
	it('#37 (CD3, cs3): calm and quiet carry no failed or rolled-back event; production is reached ONCE, with no per-place deploy rows', () => {
		for (const sc of ['calm', 'quiet'] as const) {
			const { c, places } = at(P37, sc);
			const ev = spineOf(c, sc, places);
			expect(ev.some((e) => e.kind === 'failed' || e.kind === 'rollback')).toBe(false);
			expect(ev.filter((e) => e.words === 'Reached prod')).toHaveLength(1);
			expect(ev.some((e) => e.kind === 'deployed' && e.words !== 'Reached prod')).toBe(false);
			expect(ev.every((e) => e.places.length === 0)).toBe(true);
			expect(howFacts(c, places, classified(c, sc).all).failed).toBe(0);
		}
	});
	it('#37 (CD6, r13 CE4, cs3): us-east\'s only event is the rollback (the deploys are the Stages card\'s); the undone a11c303 is the rollback\'s "from", not an event', () => {
		const { c, places } = at(P37, 'incident');
		const us = spineOf(c, 'incident', places)
			.filter((e) => e.place === 'us-east')
			.map((e) => `${e.words} ${e.build}`);
		expect(us).toEqual(['Rolled back in prod-us-east a11c202']);
	});
	it("#37 (changedetail-12 CD1): the rollback carries the tab's cause", () => {
		const { c, places } = at(P37, 'incident');
		const rb = spineOf(c, 'incident', places).find((e) => e.kind === 'rollback')!;
		expect(rb.words).toBe('Rolled back in prod-us-east');
		expect(rb.build).toBe('a11c202');
		expect(rb.cause).toBe('duplicate invoice numbers');
		expect(rb.from).toBe('a11c303'); // the tab: "Rolled back from a11c303"
	});
	it('#90 (changedetail-12 CD2, AD r4): History is in causal order (a wait sits after the deploys of its build), ages never rise down the list', () => {
		for (const [p, sc] of [
			['github.com/exampleco/payments-core/pull/90', 'incident'],
			[P37, 'incident']
		] as const) {
			const { c, places } = at(p, sc);
			const ev = spineOf(c, sc, places);
			const ats = ev.map((e) => e.order ?? e.at ?? '');
			expect(ats).toEqual([...ats].sort());
			const w = ev.findIndex((e) => e.kind === 'waiting' || e.kind === 'held');
			/* cs3: the deploys are no events; a wait still never precedes the merge */
			expect(ev[0].kind).toBe('merged');
			if (w >= 0) expect(w).toBeGreaterThan(0);
		}
	});
	it('#90 (CD7, cs3): five identical waiting events are ONE event that says where in words (no chips)', () => {
		const { c, places } = at('github.com/exampleco/payments-core/pull/90', 'incident');
		const w = spineOf(c, 'incident', places).filter((e) => e.kind === 'waiting');
		expect(w).toHaveLength(1);
		expect(w[0].words).toBe('Waiting for approval in 5 prod regions');
		expect(w[0].places).toHaveLength(0);
	});
	it("#90 (r13 CE2): the wait is THIS change's build c0d3e88, aged by the wait clock (batch4 P1: the hold clock, not the build age); f4a2c19 is only the labelled newer build", () => {
		const { c, places } = at('github.com/exampleco/payments-core/pull/90', 'incident');
		const lead = places[0];
		const o = openedOf(lead, 'incident');
		expect(o.build).toBe('c0d3e88');
		expect(o.newerBuild).toEqual({ build: 'f4a2c19', age: '19m' });
		expect(o.steps.map((x) => `${x.name}:${x.state}`)).toEqual(['Started:todo', 'Check:todo']); // the tab's two steps; the approval is a rule, not a node
		expect(o.rule).toEqual({ text: 'Waiting for approval', href: `${lead.href}/gates` });
		expect(o.relation).toMatchObject({ word: `${lead.label} runs`, build: '9b7e410' });
		expect(o.commit).toEqual({ title: 'Fix partial refund rounding', author: 'paul-stevens' });
		expect(commitsOf(c, 'incident', lead).commits[0]).toMatchObject({ sha: 'c0d3e88' });
		/* fixed values from the fixture (truth v2 M1: the hold clock, the build's age and the row's since are three different instants), not recomputed through ago(waitClock(...)) */
		expect(waitClock(lead.row!, 'incident')).toBe('2026-10-24T14:56:26.893Z');
		expect(o.since).toBe('4h');
		/* the wait event names the tab's candidate c0d3e88 (never f4a2c19) and is dated by the wait clock */
		const raw = (
			fixture as unknown as {
				rollouts: {
					metadata: { namespace: string; name: string };
					status: { releaseCandidates?: { tag?: string; version?: string; created?: string }[] };
				}[];
			}
		).rollouts.find((r) => lead.href.endsWith(`${r.metadata.namespace}/${r.metadata.name}`))!;
		const cand = raw.status.releaseCandidates!.find((x) =>
			(x.version ?? x.tag ?? '').startsWith('c0d3e88')
		)!;
		const w = spineOf(c, 'incident', places).find((e) => e.kind === 'waiting')!;
		expect(cand.created).toBeTruthy();
		const oldest = places
			.filter((x) => x.kind === 'waiting')
			.map((x) => waitClock(x.row!, 'incident', x.build)!)
			.sort()[0];
		/* change-stages r2: ONE clock, asked for the change's build (never before it reached the gate) */
		expect([w.build, w.at]).toEqual(['c0d3e88', oldest]);
		expect(oldest).toBe('2026-10-24T14:56:26.893Z'); // the oldest of the five waiting places, clamped to c0d3e88's arrival upstream (r2), not the lead's
	});
	it("#37 (CD5, re-pinned r6 CG6): build subject = the tab's commit (danielreed, the PR title); the change subject stays the PR's", () => {
		const { c, places } = at(P37, 'incident');
		const o = openedOf(places[0], 'incident');
		expect(o.commit).toEqual({
			title: 'Retry webhook delivery with exponential backoff',
			author: 'danielreed'
		});
		expect(commitsOf(c, 'incident', places[0]).commits.map((k) => k.author)).toEqual([
			'danielreed'
		]);
	});
	it("#37: the statement names the Places' regions, and the failure costs 7 builds incl. the viewer's #44", () => {
		const { c, all, places } = at(P37, 'incident');
		const s = statementOf(c, places, all);
		expect(s.title).toBe('Failing in eu-west');
		expect(places.filter((p) => p.kind === 'failed').map((p) => p.label)).toEqual(['eu-west']);
		expect(blockLine(s.lead)).toBe(
			'eu-west is failing: 7 newer builds (incl. your #44) wait behind this failure; a11c101 is the build before this change, last healthy 9h ago.'
		);
		expect(rollbackTo(s.lead)).toBe('a11c101');
	});
	it('#36 (changedetail-9 CE3): a11c101 carries the change and leads Commits; a11c202 is the NEWER build that failed, History says so, and the rail counts 0 own failed deploys', () => {
		const { c, places, all } = at('github.com/exampleco/invoice-api/pull/36', 'incident');
		const cm = commitsOf(c, 'incident', places[0]);
		const euw = cm.builds.filter((b) => b.chips.some((x) => x.label === 'eu-west'));
		expect(cm.builds[0].build).toBe('a11c101');
		expect(cm.builds[0].newer).toBeFalsy();
		expect(euw.find((b) => b.build === 'a11c202')).toMatchObject({ newer: true });
		const ev = spineOf(c, 'incident', places);
		const f = ev.find((e) => e.kind === 'failed' && e.place === 'eu-west')!;
		expect(f.words).toBe('Newer build failed in prod-eu-west');
		expect(f.build).toBe('a11c202');
		expect(howFacts(c, places, all, ev).failed).toBe(0);
	});
	it('#14 (changedetail-9 CE1): ONE row for a02f1c4: dev live and staging failed, 2 chips, one build', () => {
		const { c, places } = at('github.com/exampleco/checkout-worker/pull/14', 'incident');
		const cm = commitsOf(c, 'incident', places[0]);
		expect(cm.builds).toHaveLength(1);
		expect(cm.builds[0]).toMatchObject({ build: 'a02f1c4' });
		expect(cm.builds[0].chips.map((x) => `${x.label}${x.failed ? '!' : ''}`).sort()).toEqual([
			'dev',
			'staging!'
		]);
		expect(cm.builds[0].newer).toBeFalsy();
	});
	it('#14 (changedetail-9 CE4): the failure is ONE instant: the place row, the pane and the History event share it', () => {
		const { c, places } = at('github.com/exampleco/checkout-worker/pull/14', 'incident');
		const fp = places.find((p) => p.kind === 'failed')!;
		const ev = spineOf(c, 'incident', places).find((e) => e.kind === 'failed')!;
		expect(ev.at).toBe(fp.at);
		expect(ago(ev.at)).toBe(ago(fp.at));
		expect(openedOf(fp, 'incident').since).toBe(ago(fp.at));
	});
	it('#90 (changedetail-9 CE2): c0d3e88 carries the change (header, commit row, first Commits row); f4a2c19 is only the newer build', () => {
		const { c, places } = at('github.com/exampleco/payments-core/pull/90', 'incident');
		expect(firstBuildOf(c, 'incident')).toBe('c0d3e88');
		expect(headFacts(c, places[0], 'incident').build).toBe('c0d3e88');
		const cm = commitsOf(c, 'incident', places[0]);
		expect(cm.commits[0].sha).toBe('c0d3e88');
		expect(cm.builds[0]).toMatchObject({ build: 'c0d3e88' });
		expect(cm.builds[0].newer).toBeFalsy();
		expect(cm.builds.find((b) => b.build === 'f4a2c19')).toMatchObject({ newer: true });
	});
	it('#90 (payments-core): a custom build does not run the change', () => {
		const { c, places } = at('github.com/exampleco/payments-core/pull/90', 'incident');
		const pc = placesOfChange(c, 'incident');
		expect(pc.find((p) => p.place === 'eu-central')?.containsChange).toBe(false);
		expect(places.some((p) => p.label === 'eu-central' && p.kind === 'running')).toBe(false);
		expect(runningN(places)).toBe(3);
	});
	it('#37: the spine keeps the us-east rollback and orders by time', () => {
		const { c, places } = at(P37, 'incident');
		const ev = spineOf(c, 'incident', places);
		expect(
			ev.some((e) => e.kind === 'rollback' && e.place === 'us-east' && e.who === 'sarahmiller')
		).toBe(true);
		const ats = ev.map((e) => e.at ?? '');
		expect([...ats].sort()).toEqual(ats);
		expect(ev[0].kind).toBe('merged');
	});
	it('CE2 #90: ONE count with a unit; the 9th place is named not affected', () => {
		const { all, places, unaffected } = at('github.com/exampleco/payments-core/pull/90', 'calm');
		expect(countLine(countsOf(all, places))).toBe(
			'8 places · 2 deployed · 1 checking · 5 waiting · 1 not affected'
		);
		expect(unaffected.map((u) => u.label)).toEqual(['eu-central']);
	});
	it("CE1 #90: place ages are the tab's current deploy (test checking 11m, dev 15m)", () => {
		const { places } = at('github.com/exampleco/payments-core/pull/90', 'calm');
		const age = (l: string) => ago(places.find((p) => p.label === l)!.at);
		expect(age('test')).toBe('11m');
		expect(age('dev')).toBe('15m');
	});
	it('CE4 #90 (cs3): the spine no longer lists the dev / test deploys of f4a2c19 (the Stages card does)', () => {
		const { c, places } = at('github.com/exampleco/payments-core/pull/90', 'calm');
		const ev = spineOf(c, 'calm', places);
		expect(ev.some((e) => ['Deployed', 'First deployed', 'Deploying', 'Checking', 'Redeployed'].includes(e.words))).toBe(false);
	});
	it("AD r5: changeProd carries the tab's region states and the count sentence", () => {
		const { c } = at(P37, 'incident');
		const pr = changeProd(c, 'incident');
		expect(pr.sentence).toBe('prod · 2 of 3 run it · 1 failing');
		expect(pr.states).toHaveLength(3);
	});
	it('calm heals the failure the raw history still records', () => {
		const { places } = at(P37, 'calm');
		expect(places.some((p) => p.kind === 'failed')).toBe(false);
	});
	it('an unknown slug finds nothing', () => {
		expect(findChange('github.com/exampleco/nope/pull/1', 'incident')).toBeNull();
	});

	/* changedetail-10 */
	const P90 = 'github.com/exampleco/payments-core/pull/90';
	it('CF1 #90: commit count and diffstat are the staging tab\'s for c0d3e88 ("1 commit deployed · +37 −24 · 1 file")', () => {
		const { c, places } = at(P90, 'incident');
		const r = carrierRange(c, 'incident')!;
		expect(r.commits.map((k) => k.sha)).toEqual(['c0d3e88']);
		expect([r.additions, r.deletions, r.files]).toEqual([37, 24, 1]);
		const cm = commitsOf(c, 'incident', places[0]);
		expect(cm.commits).toHaveLength(1);
		expect(cm.commits[0]).toMatchObject({ sha: 'c0d3e88', author: 'paul-stevens' });
		expect(headFacts(c, places[0], 'incident').stat).toEqual({ add: 37, del: 24, files: 1 });
	});
	it('CF9 #90: the waiting statement carries no phone line (no build id on the 390 banner)', () => {
		const { c, places, all } = at(P90, 'incident');
		const st = statementOf(c, places, all);
		expect(st.kind).toBe('waiting');
		expect(st.short).toBeNull();
	});
	it('CF4: the fold is one contiguous window; merge, failure, first live and the newest row stay visible', () => {
		const ev = (kind: string, words = 'Deployed') => ({ kind, words }) as never;
		const list = [
			ev('merged', 'Merged'),
			ev('deployed', 'Reached prod'),
			ev('deployed'),
			ev('deployed'),
			ev('deployed'),
			ev('deployed'),
			ev('deployed'),
			ev('failed', 'Newer build failed'),
			ev('deployed'),
			ev('deployed'),
			ev('deployed'),
			ev('deployed'),
			ev('moving', 'Deploying')
		];
		const w = foldWindow(list, 10)!;
		expect(w[1] - w[0]).toBeGreaterThanOrEqual(2);
		for (let i = w[0]; i < w[1]; i++)
			expect(['merged', 'failed']).not.toContain((list[i] as { kind: string }).kind);
		expect(w[0]).toBeGreaterThan(1);
		expect(w[1]).toBeLessThan(list.length);
		expect(foldWindow(list.slice(0, 10), 10)).toBeNull();
	});
	it('CF4 #36: the incident fold hides rows that follow the failure only as ONE window', () => {
		const { c, places } = at('github.com/exampleco/invoice-api/pull/36', 'incident');
		const ev = spineOf(c, 'incident', places);
		const w = foldWindow(ev, 10);
		/* cs3: History is short now (no per-place rows); a list of ten or fewer needs no fold at all */
		if (!w) { expect(ev.length).toBeLessThanOrEqual(10); return; }
		const shown = ev.map((_, i) => i).filter((i) => i < w[0] || i >= w[1]);
		expect(shown.length + (w[1] - w[0])).toBe(ev.length);
		ev.forEach((e, i) => {
			if (e.kind === 'failed') expect(i < w[0] || i >= w[1]).toBe(true);
		});
	});
});
