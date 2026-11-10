/** r39 Environment page view-model (env/env-page.ts): agrees with the Environments tile, one headline per app, waves from the sites-waves model, wording helpers. */
import { describe, it, expect } from 'vitest';
import { envPage, resolveEnv, suggestEnv } from './env/env-page';
import { environmentsPage } from './environments-page';
import { rollouts, type HomeState, type TierKey } from './data';
import { needApprovalCount, approvalWord, mostSevere, severity, stateWord } from './state-words';

const TIERS: TierKey[] = ['dev', 'test', 'staging', 'prod'];

describe('envPage', () => {
	it('resolves tiers and regions; near matches are suggested', () => {
		expect(resolveEnv('prod', 'incident')).toEqual({ kind: 'tier', tier: 'prod' });
		expect(resolveEnv('nope', 'incident')).toBeNull();
		expect(envPage('incident', 'nope')).toBeNull();
		expect(suggestEnv('eu-west', 'incident')).toBe('prod-eu-west');
	});
	for (const hs of ['incident', 'calm', 'quiet'] as HomeState[]) {
		it(`${hs}: the header is the Environments tile's own counts, per tier`, () => {
			const L = environmentsPage(hs);
			for (const t of [...L.tiles, ...(L.prod ? [L.prod] : [])]) {
				const P = envPage(hs, t.key)!;
				expect([P.tile.failing, P.tile.waiting, P.tile.moving, P.tile.rest], t.key).toEqual([t.failing, t.waiting, t.moving, t.rest]);
				expect(P.tile.lead.text).toBe(t.lead.text);
			}
		});
	}
	it('incident prod: every row app is a tile exactly once; an app at rest has no row; no tier chip in Attention', () => {
		const P = envPage('incident', 'prod')!;
		const rowApps = new Set(rollouts('incident').rows.filter((r) => r.tier === 'prod').map((r) => r.app));
		expect(new Set(P.active.map((a) => a.app))).toEqual(rowApps);
		expect(P.active.length).toBe(rowApps.size);
		for (const a of P.attention) expect(a.model.tier).toBe('');
		expect(P.banner?.row.group).toBe('failed');
		for (const a of P.atRest) expect(rowApps.has(a.app)).toBe(false);
	});
	it('an app headline is its most severe place', () => {
		for (const t of TIERS) for (const a of envPage('incident', t)!.active) {
			if (a.row) expect(severity(a.row.state)).toBeLessThanOrEqual(severity(mostSevere(a.places, (p) => p.state)?.state));
		}
	});
	it('waves: only apps with two or more sites get wave boxes, each wave names its leader', () => {
		for (const a of envPage('incident', 'prod')!.active) for (const w of a.waves) expect(w.leader).toBeTruthy();
		for (const t of ['dev', 'test'] as const) for (const a of envPage('incident', t)!.active) expect(a.waves).toEqual([]);
	});
});

describe('one approval word', () => {
	it('Needs your approval when yours, Waiting for approval otherwise', () => {
		expect(approvalWord(true)).toBe('Needs your approval');
		expect(approvalWord(false)).toBe('Waiting for approval');
		expect(stateWord('approval', { yours: true })).toBe('Needs your approval');
	});
});

describe('Gangway body (r39 concept B)', () => {
	it('prod: held tiles carry the gate word (approvalWord for approvals), ready tiles hold nothing; an app is in exactly one group', () => {
		const G = envPage('incident', 'prod')!.gangway;
		for (const t of G.held) {
			const box = t.cells[t.cells.length - 1];
			expect(box.key).toBe('prod');
			expect(box.mark).toBeTruthy();
			if (t.hold === 'approval') expect([approvalWord(true), approvalWord(false)]).toContain(box.word);
			else expect(box.word).toMatch(/^Waits on |^Held/);
		}
		for (const t of G.ready) expect(t.cells[t.cells.length - 1].mark).toBeUndefined();
		const all = [...G.held, ...G.ready].map((t) => t.app);
		expect(new Set(all).size).toBe(all.length);
		for (const a of G.inStep) expect(all).not.toContain(a.app);
	});
	it('the environments before this one come first; the last cell is this environment', () => {
		for (const t of ['staging', 'prod'] as const) for (const tile of envPage('incident', t)!.gangway.held) {
			expect(tile.cells[tile.cells.length - 1].key).toBe(t);
			expect(tile.cells.slice(0, -1).map((c) => c.key)).not.toContain(t);
		}
	});
	it('Today folds in the view, lists newest first, failures flagged', () => {
		const d = envPage('incident', 'prod')!.gangway.today;
		expect(d.length).toBeGreaterThan(8);
		expect(d.filter((x) => x.kind === 'failed').length).toBeGreaterThan(0);
	});
	it('a footer never invents a wait: ageLabel is waiting (gate arrival) or merged (oldest change)', () => {
		for (const t of ['staging', 'prod'] as const) for (const x of [...envPage('incident', t)!.gangway.held, ...envPage('incident', t)!.gangway.ready]) {
			if (x.foot.title) expect(['waiting', 'merged']).toContain(x.foot.ageLabel);
		}
	});
});

describe('env deploy list marks person-pressed deploys (QA #14)', () => {
	it('every row carries manual + reason; manual agrees with the trigger, automatic deploys have no reason', () => {
		for (const t of ['dev', 'staging', 'prod']) for (const d of envPage('incident', t)!.gangway.today) {
			expect([null, 'manual']).toContain(d.mark);
			expect(d.reason === null || typeof d.reason === 'string').toBe(true);
			if (!d.mark) expect(d.reason).toBeNull();
		}
	});
});

describe('QA2 #6: one plural phrase for approvals', () => {
	it('1 needs approval, N need approval', () => {
		expect(needApprovalCount(1)).toBe('1 needs approval');
		expect(needApprovalCount(3)).toBe('3 need approval');
	});
	it('the Held header on every environment page agrees with it', () => {
		for (const hs of ['incident', 'calm', 'quiet'] as HomeState[]) for (const t of TIERS) {
			const g = envPage(hs, t)?.gangway;
			const texts = (g?.heldRollup ?? []).map((r) => (typeof r === 'string' ? r : r.text));
			for (const x of texts) expect(x).not.toMatch(/^1 need approval/);
			const ap = texts.find((x) => /approval$/.test(x));
			if (ap) expect(ap).toBe(needApprovalCount(parseInt(ap)));
		}
	});
});
