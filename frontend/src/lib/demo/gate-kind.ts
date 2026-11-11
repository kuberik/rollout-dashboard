/**
 * The mock backend's `kind` on every gate summary, the way #91's backend derives it (pkg/kubernetes/gatekind.go): promotion / schedule /
 * dependency come from the gate's owner (the mock has no owners, so its names carry it: `promotion-*` / `ghd-*`, `dependency-*`, schedule-ish names),
 * an ownerless gate with an allowedVersions list is an approval (the list the Approve button edits), anything else is `unknown`.
 * Applied to dev-mock-api's responses only; unit-test fixtures that hand-write `status.gates` keep `kind` ABSENT on purpose: they model a backend
 * that predates #91 (the name-prefix fallback in view-models/wait-cause.ts reads them).
 */
export type MockGateKind = 'approval' | 'schedule' | 'dependency' | 'promotion' | 'unknown';

export function mockGateKind(g: { name?: string; allowedVersions?: string[] | null }): MockGateKind {
	const n = g.name ?? '';
	if (/^(promotion-|ghd-)/.test(n)) return 'promotion';
	if (/^dependency-/.test(n)) return 'dependency';
	if (/(^|-)(schedule|window|freeze)(-|$)/.test(n)) return 'schedule';
	if (g.allowedVersions != null) return 'approval';
	return 'unknown';
}

type Gate = { name?: string; kind?: string; allowedVersions?: string[] | null };
const stamp = (r: { status?: { gates?: Gate[] } } | null | undefined) => {
	for (const g of r?.status?.gates ?? []) if (g.kind == null) g.kind = mockGateKind(g);
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
