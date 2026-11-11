import { describe, it, expect } from 'vitest';
import { rollouts, approvalTarget, grantApproval, revokeApproval, placeHolds, environments, buildInQuestion, deployableTags, inbox, type TRow } from './data';
import { sentenceOf } from './rollouts-page';
import { askSentence, doneWords } from './approvals.svelte';
import { source, resetHomeModel, homeModel } from '$lib/components/home/sketch/home-data';

/* ONE build in question per place: the newest candidate every non-approval gate lets through (given the clock and the promotion order),
   read by the verdict, the confirm dialog, the toast, the approval write, the approval target and the app detail's holds. The fixture is
   the incident fleet's payments-core (candidates f4a2c19 newest, c0d3e88 in staging). */
type G = { name: string; kind?: string; passing?: boolean | null; allowedVersions?: string[] | null };
type R = { metadata: { name: string; namespace: string }; status: { gates: G[]; releaseCandidates: { tag?: string }[]; history: { version: { tag: string; version: string; revision: string }; bakeStatus: string; timestamp: string }[] } };
const APP = 'payments-core';
const NEWEST = 'f4a2c19', STAGED = 'c0d3e88';
const all = () => source().rollouts as unknown as R[];
const prodRs = () => all().filter((r) => r.metadata.name === APP && /prod-(us-east|us-west|eu-west|ap-south|sa-east)$/.test(r.metadata.namespace));
const prodRow = (): TRow => rollouts('incident').rows.find((r) => r.app === APP && r.tier === 'prod')!;
const hrefOf = (r: R) => `/rollouts/prod/${r.metadata.namespace}/${r.metadata.name}`;
const withGates = (gs: G[], f: () => void) => {
	const rs = prodRs();
	rs.forEach((r) => r.status.gates.push(...gs.map((g) => ({ ...g }))));
	resetHomeModel();
	try { f(); } finally { rs.forEach((r) => { r.status.gates = r.status.gates.filter((g) => !gs.some((x) => x.name === g.name)); }); resetHomeModel(); }
};
const granted = (f: (t: NonNullable<ReturnType<typeof approvalTarget>>) => void) => {
	const t = approvalTarget(prodRow(), 'incident')!;
	expect(t).toBeTruthy();
	grantApproval(t);
	try { f(t); } finally { revokeApproval(t); }
};
const prodRows = () => rollouts('incident').rows.filter((x) => x.app === APP && x.tier === 'prod');
const approvalOf = (r: R) => r.status.gates.find((g) => g.kind === 'approval')!;
const withStagingDeploying = (f: () => void) => {
	const st = all().find((r) => r.metadata.namespace === 'payments-core-staging')!;
	const h = st.status.history, c0 = st.status.releaseCandidates;
	st.status.history = [{ ...h[0], version: { tag: NEWEST, version: NEWEST, revision: NEWEST }, bakeStatus: 'Deploying', timestamp: '2026-11-11T00:00:00Z' }, ...h];
	st.status.releaseCandidates = [];
	resetHomeModel();
	try { f(); } finally { st.status.history = h; st.status.releaseCandidates = c0; resetHomeModel(); }
};

describe('the build in question is one pick', () => {
	it('S6b: staging is still deploying the newest build and prod promotes only staged builds: the dialog, the toast, the write and the target all name the staged build', () => {
		withStagingDeploying(() => withGates([{ name: 'ghd-promo', kind: 'promotion', passing: true, allowedVersions: [STAGED, '9b7e410', '2a55f0c'] }], () => {
			const t = approvalTarget(prodRow(), 'incident')!;
			expect(t.build).toBe(STAGED);
			expect(t.places.map((p) => p.tag)).toEqual(t.places.map(() => STAGED));
			expect(askSentence(t)).toBe(`Approve ${STAGED} for ${t.where}?`);
			expect(doneWords(t).title).toBe(`Approved ${STAGED}`);
			const place = { href: t.places[0].href, app: APP };
			expect(buildInQuestion(place)).toBe(STAGED);
			const pv = homeModel('incident').apps.find((a) => a.app === APP)!.envs.find((e) => e.href === t.places[0].href)!.placeVerdict!;
			expect(pv.target).toBe(STAGED);
			grantApproval(t);
			try {
				for (const r of prodRs().filter((x) => t.places.some((p) => p.href === hrefOf(x)))) {
					expect(approvalOf(r).allowedVersions, r.metadata.namespace).toContain(STAGED);
					expect(approvalOf(r).allowedVersions, r.metadata.namespace).not.toContain(NEWEST);
				}
				const r0 = prodRs().find((x) => hrefOf(x) === t.places[0].href)!;
				expect(r0.status.history[0].version.tag, 'the approved build is the one that deploys').toBe(STAGED);
			} finally { revokeApproval(t); }
		}));
	});

	it('S6a: with no promotion gate the newest build is the target while staging deploys it', () => {
		withStagingDeploying(() => {
			const t = approvalTarget(prodRow(), 'incident')!;
			expect(t.build).toBe(NEWEST);
			expect(t.places.map((p) => p.tag)).toEqual(t.places.map(() => NEWEST));
		});
	});
});

describe('a place that runs its build reads Deploying', () => {
	it('S7: a deploy window closing while the approved build deploys does not turn the place into a hold', () => {
		withGates([{ name: 'permits-target-only', kind: 'unknown', allowedVersions: [STAGED] }], () => granted(() => {
			withGates([{ name: 'schedule-gate-qqqqq', kind: 'schedule', passing: false, allowedVersions: null }], () => {
				const pr = prodRows();
				expect(pr.length).toBeGreaterThan(0);
				for (const r of pr) { expect(sentenceOf(r, 'incident')[0], r.key).toBe('Deploying'); expect(r.needsYou).toBe(false); }
				const envs = homeModel('incident').apps.find((a) => a.app === APP)!.envs.filter((e) => e.isProdRegion && e.placeVerdict);
				expect(envs.length).toBeGreaterThan(0);
				for (const e of envs) expect(e.placeVerdict!.state).toBe('running');
			});
		}));
	});

	it('S8: after a grant with a newer candidate still behind it, every target place reads Deploying (a grant that never deploys fails this)', () => {
		granted((t) => {
			const hrefs = new Set(t.places.map((p) => p.href));
			const pr = prodRows().filter((r) => hrefs.has(r.href) || r.regions.length > 1);
			expect(pr.length).toBeGreaterThan(0);
			for (const r of pr) { expect(r.state, r.key).toBe('deploying'); expect(sentenceOf(r, 'incident')[0], r.key).toBe('Deploying'); expect(r.needsYou).toBe(false); }
			for (const r of prodRs().filter((x) => hrefs.has(hrefOf(x)))) {
				expect(r.status.history[0].version.tag, r.metadata.namespace).toBe(t.build);
				expect(r.status.history[0].bakeStatus).toBe('Deploying');
			}
			const envs = homeModel('incident').apps.find((a) => a.app === APP)!.envs.filter((e) => hrefs.has(e.href));
			for (const e of envs) expect(e.state, e.env).toBe('deploying');
		});
	});
});

describe('the app detail and the approval target read the row\'s verdict', () => {
	it('F4: after the permits-target grant the place is Deploying, so it carries no approval hold and offers no approval', () => {
		withGates([{ name: 'permits-target-only', kind: 'unknown', allowedVersions: [STAGED] }], () => granted(() => {
			const prod = placeHolds(APP, 'incident').filter((h) => h.tier === 'prod' && h.href !== '' && prodRs().some((r) => hrefOf(r) === h.href));
			expect(prod.length).toBeGreaterThan(0);
			for (const h of prod) { expect(h.holdReason, h.label).not.toBe('approval'); expect(h.holdReason, h.label).toBeNull(); }
			expect(approvalTarget(prodRow(), 'incident')).toBeNull();
			expect(inbox('incident').items.some((i) => i.row.app === APP && i.row.tier === 'prod')).toBe(false);
		}));
	});
});

describe('the Environments page reads the verdict, never its own awaiting-approval', () => {
	it('F5: every prod place still baking its own build reads the place verdict, in every region (never an awaiting-approval invented for one row)', () => {
		const rs = prodRs();
		const was = rs.map((r) => r.status.history[0].bakeStatus);
		rs.forEach((r) => { r.status.history[0].bakeStatus = 'InProgress'; });
		try {
			withGates([{ name: 'refuses-all', kind: 'unknown', allowedVersions: [] }], () => {
				const mine = environments('incident').regions.flatMap((rg) => rg.places.filter((p) => p.app === APP && rs.some((r) => hrefOf(r) === p.href)).map((p) => ({ label: rg.label, state: p.state })));
				expect(mine.length).toBe(rs.length);
				const model = homeModel('incident').apps.find((a) => a.app === APP)!.envs;
				for (const p of mine) {
					const pv = model.find((e) => e.isProdRegion && e.env.endsWith(p.label))!.placeVerdict;
					expect(pv?.state, p.label).toBe('held-by-rule');
					expect(p.state, p.label).toBe(pv!.state);
				}
			});
		} finally { rs.forEach((r, i) => { r.status.history[0].bakeStatus = was[i]; }); resetHomeModel(); }
	});
});
