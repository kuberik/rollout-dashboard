import { describe, it, expect } from 'vitest';
import { approvalTarget, inbox, rollouts, grantApproval, revokeApproval } from './data';
import { sentenceOf } from './rollouts-page';
import { source, resetHomeModel, homeModel, ME } from '$lib/components/home/sketch/home-data';
import { buildSketch } from '../home/sketch/sketch-home';
import { compass } from '$lib/components/home/pocket/pocket-data';

/** The rule: a surface never asks for an approval without an Approve button. The row, the inbox, Home and the sketch ask exactly when the approval target exists. */
const APP = 'payments-core';
type R = { metadata: { namespace: string; name: string }; status: any };
const all = () => source().rollouts as unknown as R[];
const prodRs = () => all().filter((r) => r.metadata.name === APP && /prod-(us-east|us-west|eu-west|ap-south|sa-east)$/.test(r.metadata.namespace));
const prodRow = () => rollouts('incident').rows.find((r) => r.app === APP && r.tier === 'prod')!;

describe('after an approval, with the window open and the approved build not yet deploying', () => {
	it('every surface asks if and only if an Approve button exists', () => {
		const st = all().find((r) => r.metadata.namespace === 'payments-core-staging')!;
		const h = st.status.history, c0 = st.status.releaseCandidates;
		st.status.history = [{ ...h[0], version: { tag: 'f4a2c19', version: 'f4a2c19', revision: 'f4a2c19' }, bakeStatus: 'Deploying', timestamp: '2026-11-11T00:00:00Z' }, ...h];
		st.status.releaseCandidates = [];
		const gates = [{ name: 'ghd-promo', kind: 'promotion', passing: true, allowedVersions: ['c0d3e88', '9b7e410', '2a55f0c'] }, { name: 'schedule-gate-qqqqq', kind: 'schedule', passing: false, allowedVersions: null }];
		const rs = prodRs();
		rs.forEach((r) => r.status.gates.push(...gates.map((g) => ({ ...g }))));
		resetHomeModel();
		let t: ReturnType<typeof approvalTarget> = null;
		try {
			t = approvalTarget(prodRow(), 'incident')!;
			expect(t, 'before the grant there is something to approve').not.toBeNull();
			grantApproval(t);
			rs.forEach((r) => { r.status.gates.find((g: any) => g.name === 'schedule-gate-qqqqq').passing = true; });
			resetHomeModel();
			const row = prodRow();
			const button = approvalTarget(row, 'incident') != null;
			const asks = {
				row: /approval/.test(sentenceOf(row, 'incident')[0]),
				needsYou: row.needsYou,
				inbox: inbox('incident').items.some((i) => i.row.app === APP && /^Approve/.test(i.reason ?? '')),
				home: compass('incident').v.approvals.some((a) => a.app === APP),
				sketch: buildSketch(homeModel('incident'), ME).elsewhere.some((x) => x.app === APP && x.kind === 'approval'),
			};
			for (const [surface, asked] of Object.entries(asks)) expect(asked, `${surface} asks ⇔ the Approve button exists (button: ${button})`).toBe(button);
		} finally {
			if (t) revokeApproval(t);
			rs.forEach((r) => { r.status.gates = r.status.gates.filter((g: any) => !gates.some((x) => x.name === g.name)); });
			st.status.history = h; st.status.releaseCandidates = c0; resetHomeModel();
		}
	});
});
