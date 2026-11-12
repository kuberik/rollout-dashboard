import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { respond } from './respond';
import { armApprovalGate, resetDemoState } from './state';

/** The mock implements CONTRACT "Dashboard HTTP contract": approve, revoke (incl. stillApproved), approvals list, permissions.approve, history approval records. */
const post = (path: string, b: object) => respond('POST', path, { body: JSON.stringify(b) });
const json = (r: { body?: string }) => JSON.parse(r.body ?? '{}');
const NS = 'hello-world-staging', NAME = 'hello-world';
const gate = (): { allowedVersions: string[] } => json(respond('GET', `/api/rollouts/${NS}/${NAME}`)).rollout.status.gates.find((g: { kind: string }) => g.kind === 'approval');
const head = () => json(respond('GET', `/api/rollouts/${NS}/${NAME}`)).rollout.status.history[0];

describe('the mock approvals API', () => {
	beforeEach(() => { resetDemoState('calm'); armApprovalGate(NS, NAME, ['old1']); });
	afterEach(() => resetDemoState('calm'));

	it('approve -> the gate allows the version and the history row carries the approval; Undo -> held again', () => {
		const a = post(`/api/rollouts/${NS}/${NAME}/approve`, { version: 'f68d0ac' });
		expect(a.status).toBe(200);
		expect(json(a).approval).toEqual({ name: 'hello-world-f68d0ac', version: 'f68d0ac', by: 'oidc:danielreed' });
		expect(gate().allowedVersions).toContain('f68d0ac');
		expect(head().approval).toEqual({ name: 'hello-world-f68d0ac', by: 'oidc:danielreed' });
		const r = post(`/api/rollouts/${NS}/${NAME}/approve`, { version: 'f68d0ac', revoke: true });
		expect(r.status).toBe(200);
		expect(json(r)).toEqual({});
		expect(gate().allowedVersions).toEqual(['old1']);
		expect(head().approval).toBeUndefined();
	});

	it('Undo answers stillApproved while a git approval names the version, and the approval stays', () => {
		post(`/api/rollouts/${NS}/${NAME}/approve`, { version: 'f68d0ac' });
		post('/api/demo/approvals', { namespace: NS, name: NAME, version: 'f68d0ac', approvalName: 'hello-world-hotfix' });
		const r = json(post(`/api/rollouts/${NS}/${NAME}/approve`, { version: 'f68d0ac', revoke: true }));
		expect(r).toEqual({ stillApproved: true, approvals: [{ name: 'hello-world-hotfix' }] });
		const list = json(respond('GET', `/api/rollouts/${NS}/${NAME}/approvals`));
		expect(list.byVerified).toBe(true);
		expect(list.approvals.map((a: { name: string }) => a.name)).toEqual(['hello-world-hotfix']);
	});

	it('a missing version is 400; permissions say approve; the fixtures carry both history renderings', () => {
		expect(post(`/api/rollouts/${NS}/${NAME}/approve`, {}).status).toBe(400);
		expect(json(respond('GET', `/api/rollouts/${NS}/${NAME}/permissions/all`)).permissions.approve).toBe(true);
		const hw = json(respond('GET', '/api/rollouts/default/hello-world')).rollout.status.history;
		const by = hw.filter((h: { approval?: { by?: string } }) => h.approval).map((h: { approval: { by?: string } }) => h.approval.by);
		expect(by).toContain('oidc:wyatt');
		expect(by).toContain(undefined);
		expect(json(respond('GET', '/api/rollouts/default/hello-world/approvals')).approvals.every((a: { by?: string }) => a.by === undefined || a.by.startsWith('oidc:'))).toBe(true);
	});
});
