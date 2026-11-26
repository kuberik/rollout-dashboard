import { describe, expect, test } from 'vitest';
import { refusedRollouts } from './deploy-refused-fixtures';
import { readyIssue } from '$lib/view-models/ready-refusal';

describe('deploy-refused fixtures drive the Ready banner', () => {
	const byNs = new Map(refusedRollouts().map((r) => [r.metadata.namespace, r] as const));
	const issue = (ns: string) => readyIssue((byNs.get(ns)?.status as { conditions?: [] }).conditions);

	test('billing-api dev: the Helm conflict names the path and gitops-demo', () => {
		expect(issue('billing-api-dev')).toMatchObject({ title: 'Deploy refused', line: 'HelmReleaseFieldConflict on spec.values.image.tag, also set by gitops-demo' });
	});
	test('orders-web dev: the Kustomization conflict names the variable and the other rollout', () => {
		expect(issue('orders-web-dev')).toMatchObject({ title: 'Deploy refused', line: 'KustomizationFieldConflict on spec.postBuild.substitute.ORDERS_TAG, also set by Rollout orders-api' });
	});
	test('the other places carry no Ready=False', () => {
		const rest = [...byNs.keys()].filter((ns) => !ns.endsWith('-dev'));
		expect(rest).toHaveLength(4);
		for (const ns of rest) expect(issue(ns)).toBeNull();
	});
});
