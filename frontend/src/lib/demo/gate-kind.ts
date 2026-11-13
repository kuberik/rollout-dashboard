/**
 * The mock backend's `kind` on every gate summary, the way #91's backend derives it (pkg/kubernetes/gatekind.go): promotion / schedule /
 * dependency come from the gate's owner (the mock has no owners, so its names carry it: `promotion-*` / `ghd-*`, `dependency-*`, schedule-ish names),
 * an approval gate is one an ApprovalPolicy owns (design/APPROVALS-API.md §5.1: `approval-gate-*`, ownerReferences kind ApprovalPolicy + label `gate.kuberik.com/approval-policy-name`; see `approvalPolicyMeta`),
 * or, still for one minor release, an ownerless gate with an allowedVersions list (the legacy shape); anything else is `unknown`.
 * Applied to dev-mock-api's responses only; unit-test fixtures that hand-write `status.gates` keep `kind` ABSENT on purpose: they model a backend
 * that predates #91 (the name-prefix fallback in view-models/wait-cause.ts reads them).
 */
export type MockGateKind = 'approval' | 'schedule' | 'dependency' | 'promotion' | 'unknown';

export function mockGateKind(g: { name?: string; allowedVersions?: string[] | null }): MockGateKind {
	const n = g.name ?? '';
	if (/^approval-gate-/.test(n)) return 'approval';
	if (/^(promotion-|ghd-)/.test(n)) return 'promotion';
	if (/^dependency-/.test(n)) return 'dependency';
	if (/(^|-)(schedule|window|freeze)(-|$)/.test(n)) return 'schedule';
	if (g.allowedVersions != null) return 'approval';
	return 'unknown';
}

/** The metadata the approval controller writes on a policy-owned gate (design §5.1): the owner reference and the labels the backend's gate-kind classifier reads (`approval` by owner, label fallback). The mock gate OBJECTS of every approval gate carry it. */
export function approvalPolicyMeta(namespace: string, rolloutName: string, policy = 'prod-needs-approval', pretty = 'Manual approval'): { labels: Record<string, string>; annotations: Record<string, string>; ownerReferences: object[] } {
	return {
		labels: { 'gate.kuberik.com/approval-policy-name': policy, 'gate.kuberik.com/approval-policy-namespace': namespace, 'gate.kuberik.com/approval-policy-kind': 'ApprovalPolicy', 'gate.kuberik.com/rollout-name': rolloutName },
		annotations: { 'gate.kuberik.com/pretty-name': pretty },
		ownerReferences: [{ apiVersion: 'kuberik.com/v1alpha1', kind: 'ApprovalPolicy', name: policy, controller: true, blockOwnerDeletion: true }]
	};
}

type GateRuleJson = { kind: string; name: string; namespace?: string };
type Gate = { name?: string; kind?: string; allowedVersions?: string[] | null; rule?: GateRuleJson };
type RolloutMeta = { name?: string; namespace?: string };

/**
 * The mock backend's `rule` on every gate summary, the way pkg/kubernetes/gatekind.go's `GateRule` derives it from the owner: a schedule gate's rule is its schedule
 * (the mock has no owners, so the one fixture schedule gate is named by hand), a promotion gate's is the Environment, a dependency gate's the RolloutDependency, an approval
 * gate's the ApprovalPolicy, anything else is its own rule (`RolloutGate`, the gate's name). Cluster kinds carry no namespace.
 */
export function mockGateRule(g: Gate, rollout: RolloutMeta | undefined): GateRuleJson {
	const name = g.name ?? '';
	const namespace = rollout?.namespace;
	switch (g.kind ?? mockGateKind(g)) {
		case 'approval':
			return { kind: 'ApprovalPolicy', name: 'prod-needs-approval', ...(namespace ? { namespace } : {}) };
		case 'promotion':
			return { kind: 'Environment', name: rollout?.name ?? name, ...(namespace ? { namespace } : {}) };
		case 'dependency':
			return { kind: 'RolloutDependency', name: name.replace(/^dependency-/, ''), ...(namespace ? { namespace } : {}) };
		case 'schedule':
			return { kind: 'RolloutSchedule', name: name === 'schedule-gate-ck7qx' ? 'checkout-business-hours' : name, ...(namespace ? { namespace } : {}) };
		default:
			return { kind: 'RolloutGate', name };
	}
}

const stamp = (r: { metadata?: RolloutMeta; status?: { gates?: Gate[] } } | null | undefined) => {
	for (const g of r?.status?.gates ?? []) {
		if (g.kind == null) g.kind = mockGateKind(g);
		if (g.rule == null) g.rule = mockGateRule(g, r?.metadata);
	}
};

/** stamp `kind` on every gate summary of a JSON rollouts response (list, detail, or a mutation's `rollout`); anything else passes through untouched */
export function stampGateKinds(body: string | undefined): string | undefined {
	if (!body || !body.includes('"gates"')) return body;
	try {
		const j = JSON.parse(body);
		j?.rollouts?.items?.forEach?.(stamp);
		stamp(j?.rollout);
		return JSON.stringify(j);
	} catch {
		return body;
	}
}
