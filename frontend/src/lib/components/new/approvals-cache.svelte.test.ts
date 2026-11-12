import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import { installApprovalCache, patchPlaceCaches, restorePlaceCaches, refreshPlaceCaches, stillApprovedWords } from './approvals.svelte';
import { rolloutQueryKey } from '$lib/api/rollouts';
import { approvalsQueryKey } from '$lib/api/approvals';
import { grantInRollout } from '$lib/view-models/approval-write';

type G = { name: string; kind: string; passing: boolean; allowedVersions?: string[] };
const gate = (allowed: string[]): G => ({ name: 'release-approval', kind: 'approval', passing: false, allowedVersions: allowed });
const payload = () => ({ rollout: { metadata: { name: 'payments-core' }, status: { gates: [gate(['9b7e410']), { name: 'window', kind: 'schedule', passing: false } as G] } } });
const target = { key: 'k', build: 'c0d3e88', where: '2 prod regions', count: 2, places: [
	{ href: '/rollouts/prod/payments-core-prod-ap-south/payments-core', label: 'ap-south', tag: 'c0d3e88' },
	{ href: '/rollouts/prod/payments-core-prod-eu-west/payments-core', label: 'eu-west', tag: 'c0d3e88' }
] } as never;

describe('an approval is written to the place\'s own copy of the gate, not only to the fleet fixture', () => {
	it('grantInRollout allows the tag on policy-owned approval gates only', () => {
		const out = grantInRollout(payload(), 'c0d3e88')!;
		expect(out.rollout!.status!.gates![0].allowedVersions).toEqual(['9b7e410', 'c0d3e88']);
		expect(out.rollout!.status!.gates![0].passing).toBe(true);
		expect(out.rollout!.status!.gates![1]).toEqual({ name: 'window', kind: 'schedule', passing: false });
		expect(grantInRollout({ rollout: { status: { gates: [{ name: 'window', kind: 'schedule' }] } } } as never, 'x')).toEqual({ rollout: { status: { gates: [{ name: 'window', kind: 'schedule' }] } } });
	});

	it('Approve patches every place\'s cached rollout at once; Undo puts the snapshot back; the settle refetches rollout and approvals', async () => {
		const qc = new QueryClient();
		installApprovalCache(qc);
		const k1 = rolloutQueryKey('payments-core-prod-ap-south', 'payments-core', 'prod');
		const k2 = rolloutQueryKey('payments-core-prod-eu-west', 'payments-core', 'prod');
		qc.setQueryData(k1, payload());
		qc.setQueryData(k2, payload());
		patchPlaceCaches(target);
		for (const k of [k1, k2]) expect((qc.getQueryData(k) as ReturnType<typeof payload>).rollout.status.gates[0].allowedVersions).toContain('c0d3e88');
		restorePlaceCaches(target);
		expect((qc.getQueryData(k1) as ReturnType<typeof payload>).rollout.status.gates[0].allowedVersions).toEqual(['9b7e410']);
		patchPlaceCaches(target);
		refreshPlaceCaches(target);
		expect(qc.getQueryState(k1)?.isInvalidated).toBe(true);
		qc.setQueryData(approvalsQueryKey('payments-core-prod-ap-south', 'payments-core', 'prod'), { byVerified: true, approvals: [] });
		installApprovalCache(null);
	});
});

describe('Undo that answered stillApproved names the place and the reason', () => {
	const reply = (by?: string) => [{ stillApproved: true, approvals: [{ name: 'payments-core-c0d3e88-git', ...(by ? { by } : {}) }] }];
	it('a partial keep names the place; a verified by wins over the object name', () => {
		expect(stillApprovedWords(target, reply(), ['ap-south'])).toMatchObject({ title: 'ap-south stays approved', who: 'payments-core-c0d3e88-git' });
		expect(stillApprovedWords(target, reply('oidc:wyatt'), ['ap-south']).who).toBe('wyatt');
				expect(stillApprovedWords(target, reply(), ['ap-south']).full).toBe('payments-core-c0d3e88-git');
	});
	it('every place kept: the build stays approved', () => {
		expect(stillApprovedWords(target, reply(), ['ap-south', 'eu-west']).title).toBe('c0d3e88 stays approved');
	});
});
