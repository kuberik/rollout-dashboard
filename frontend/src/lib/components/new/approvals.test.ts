import { describe, it, expect } from 'vitest';
import { rollouts, approvalTarget, grantApproval, revokeApproval, appHolds, apps, heldCauses, stateVerb, type TRow } from './data';
import { source, resetHomeModel } from '$lib/components/home/sketch/home-data';
import { askSentence, doneWords } from './approvals.svelte';

/* r34 r3-approve: Approve acts in place. The target names the build and every region whose own gate refuses it; granting moves
   those places out of the approval group on EVERY derivation (rows, changes, apps), and revoking restores them exactly. */
const row = (app: string): TRow | undefined => rollouts('incident').rows.find((r) => r.app === app && r.state === 'awaiting-approval' && r.needsYou);

describe('approving in place', () => {
	it('names the build and the places', () => {
		const r = row('payments-core')!;
		expect(r).toBeTruthy();
		const t = approvalTarget(r, 'incident')!;
		expect(t.count).toBeGreaterThan(1);
		expect(askSentence(t)).toBe(`Approve ${t.build} for ${t.where}?`);
		expect(t.places.every((p) => p.tag)).toBe(true);
	});
	it('grant moves the places to deploying everywhere; undo restores them', () => {
		const before = rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort();
		const t = approvalTarget(row('payments-core')!, 'incident')!;
		grantApproval(t);
		const after = rollouts('incident').rows.filter((r) => r.app === 'payments-core');
		expect(after.some((r) => r.state === 'awaiting-approval' && t.places.some((p) => p.href === r.href))).toBe(false);
		expect(after.some((r) => r.state === 'deploying' || r.state === 'checking')).toBe(true);
		expect(apps('incident').items.find((a) => a.app === 'payments-core')!.approval).toBe(false);
		revokeApproval(t);
		expect(rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort()).toEqual(before);
	});
	it('a build something else still holds reads that hold after the approval, never deploying; undo restores it', () => {
		const t0 = approvalTarget(row('payments-core')!, 'incident')!;
		/* the real shape: each approval place also carries a controller-written `dependency-<name>` gate that refuses the held build, backed by its RolloutDependency (provider payments-svc) */
		type G = { name: string; passing?: boolean; allowedVersions?: string[] | null };
		type R = { metadata: { name: string; namespace: string }; status: { gates?: G[]; releaseCandidates?: { tag?: string }[] } };
		const src = source() as unknown as { rollouts: R[]; rolloutDependencies: { items: object[] } };
		const rs = src.rollouts.filter((r) => t0.places.some((p) => p.href.split('/').slice(3, 5).join('/') === `${r.metadata.namespace}/${r.metadata.name}`));
		expect(rs.length).toBe(t0.places.length);
		const DEP = 'payments-core-needs-payments-svc';
		const deps: object[] = rs.map((r) => ({ apiVersion: 'kuberik.com/v1alpha1', kind: 'RolloutDependency', metadata: { name: DEP, namespace: r.metadata.namespace, annotations: { 'rollout-dashboard.kuberik.com/source-cluster': 'prod' } }, spec: { contract: 'payments', providerRef: { name: 'payments-svc', namespace: 'platform-prod' }, rolloutRef: { name: r.metadata.name } }, status: { providedVersion: '2.4.1', providedTag: 'pay-241', admittedVersions: ['0.0.0-older'], blockedReleases: (r.status.releaseCandidates ?? []).map((c) => ({ tag: c.tag, requiredVersion: '^3.0.0', reason: 'ConstraintNotSatisfied' })), gateName: `dependency-${DEP}` } }));
		const added = rs;
		rs.forEach((r) => { r.status.gates = [...(r.status.gates ?? []), { name: `dependency-${DEP}`, passing: true, allowedVersions: ['0.0.0-older'] }]; });
		src.rolloutDependencies.items.push(...deps);
		resetHomeModel();
		try {
			const before = rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort();
			const t = approvalTarget(row('payments-core')!, 'incident')!;
			expect(t.waitsOn, 'approvalTarget computes waitsOn itself').toBe('payments-svc');
			expect(doneWords(t).detail).toBe(`payments-core waits on payments-svc for ${t.where}`);
			grantApproval(t);
			const mine = rollouts('incident').rows.filter((r) => r.app === 'payments-core' && r.tier === 'prod');
			expect(mine.length, 'the prod row survives').toBeGreaterThan(0);
			expect(t.places.every((p) => mine.some((r) => r.href === p.href || r.regions.includes(p.label))), 'every place is still covered by a row').toBe(true);
			expect(mine.some((r) => r.state === 'deploying' || r.state === 'checking' || r.state === 'awaiting-approval')).toBe(false);
			const hc = heldCauses('incident').map((c) => c.cause);
			expect(hc, 'the row names the same provider as the toast').toContain(`Waiting on ${t.waitsOn}`);
			expect(stateVerb(mine[0], 'incident').text).toMatch(/waits on/i);
			const item = apps('incident').items.find((a) => a.app === 'payments-core')!;
			expect(appHolds(item, 'incident').some((h) => /Waiting on|waits on/i.test(h.text) && !h.approval)).toBe(true);
			revokeApproval(t);
			expect(rollouts('incident').rows.filter((r) => r.app === 'payments-core').map((r) => `${r.key}:${r.state}`).sort()).toEqual(before);
		} finally {
			for (const r of added) r.status.gates = r.status.gates!.filter((g) => g.name !== `dependency-${DEP}`);
			src.rolloutDependencies.items = src.rolloutDependencies.items.filter((d) => !deps.includes(d));
			resetHomeModel();
		}
	});
	it('a hold says which kind it is without its words being parsed', () => {
		const a = apps('incident').items.find((x) => x.approval)!;
		const h = appHolds(a, 'incident');
		expect(h.some((x) => x.approval && /^Waiting for (your )?approval/.test(x.text))).toBe(true);
	});
});
