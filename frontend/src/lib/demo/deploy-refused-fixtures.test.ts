import { describe, expect, test } from 'vitest';
import { refusedRollouts } from './deploy-refused-fixtures';
import { readyIssue, REMEDIATION_NEXT_STEP } from '$lib/view-models/ready-refusal';

describe('deploy-refused fixtures drive the Ready banner', () => {
	const byNs = new Map(refusedRollouts().map((r) => [r.metadata.namespace, r] as const));
	const issue = (ns: string) => readyIssue((byNs.get(ns)?.status as { conditions?: [] }).conditions);

	test('billing-api dev: the Helm conflict names the path and gitops-demo', () => {
		expect(issue('billing-api-dev')).toMatchObject({ title: 'Deploy refused', conflict: { kind: 'HelmRelease', name: 'billing-api', path: 'spec.values.image.tag', by: 'gitops-demo' } });
	});
	test('orders-web dev: the Kustomization conflict names the variable and the other rollout', () => {
		expect(issue('orders-web-dev')).toMatchObject({ title: 'Deploy refused', conflict: { kind: 'Kustomization', name: 'orders-web', path: 'spec.postBuild.substitute.ORDERS_TAG', by: 'Rollout orders-api' } });
	});
	test('receipts-api dev: the Helm remediation conflict is a refusal with its own next step', () => {
		expect(issue('receipts-api-dev')).toMatchObject({
			title: 'Deploy refused',
			kind: 'refused',
			conflict: { kind: 'HelmRelease', name: 'receipts-api', path: 'spec.upgrade.remediation.retries', by: 'kustomize-controller' },
			nextStep: REMEDIATION_NEXT_STEP
		});
	});
	test('the other places carry no Ready=False', () => {
		const rest = [...byNs.keys()].filter((ns) => !ns.endsWith('-dev'));
		expect(rest).toHaveLength(6);
		for (const ns of rest) expect(issue(ns)).toBeNull();
	});
});
