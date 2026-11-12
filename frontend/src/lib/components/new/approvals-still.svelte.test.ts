import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import ApprovalLayer from './ApprovalLayer.svelte';
import { approvalUi, askApprove, confirmApprove, undoApprove, stillApprovedWords } from './approvals.svelte';
import { rollouts, approvalTarget, revokeApproval } from './data';

if (!Element.prototype.animate) Element.prototype.animate = function () { return { cancel() {}, finish() {}, onfinish: null, finished: Promise.resolve() } as unknown as Animation; };
let last: ReturnType<typeof approvalTarget> = null;
afterEach(() => { if (last) { revokeApproval({ ...last, key: `${last.key}#still` }); revokeApproval(last); } last = null; document.body.innerHTML = ''; });
const reply = (body: object) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;

describe('Undo with the server reply', () => {
	beforeEach(() => { approvalUi.ask = null; approvalUi.done = null; });
	it('says who still approves, by display name, with the full identity in the tooltip', () => {
		const t = { build: 'f4a2c19' } as never;
		const w = stillApprovedWords(t, [{ stillApproved: true, approvals: [{ name: 'x', by: 'oidc:wyatt' }] }]);
		expect(w).toEqual({ title: 'f4a2c19 stays approved', who: 'wyatt', full: 'oidc:wyatt' });
		expect(stillApprovedWords(t, [{ stillApproved: true, approvals: [{ name: 'x-git' }] }]).who).toBe('x-git');
	});
	it('a stillApproved reply keeps the optimistic approval and the toast says the build stays approved', async () => {
		render(ApprovalLayer);
		const r = rollouts('incident').rows.find((x) => x.state === 'awaiting-approval' && x.needsYou)!;
		last = approvalTarget(r, 'incident')!;
		const before = rollouts('incident').rows.filter((x) => x.state === 'awaiting-approval').length;
		askApprove(last, null);
		confirmApprove(reply({ approval: { name: 'n', version: 'v' } }));
		await tick();
		const approved = rollouts('incident').rows.filter((x) => x.state === 'awaiting-approval').length;
		expect(approved).toBeLessThan(before);
		undoApprove(reply({ stillApproved: true, approvals: last.places.map(() => ({ name: 'git-1', by: 'oidc:wyatt' })).slice(0, 1) }));
		await new Promise((res) => setTimeout(res, 30));
		await tick();
		expect(approvalUi.done?.still?.who).toBe('wyatt');
		expect(document.querySelector('[data-approve-toast]')?.textContent).toMatch(/stays approved/);
		expect(document.querySelector('[data-approve-toast]')?.textContent).toMatch(/wyatt/);
		expect(rollouts('incident').rows.filter((x) => x.state === 'awaiting-approval').length).toBe(approved);
	});
	it('a plain revoke reply reverts: the place asks again', async () => {
		render(ApprovalLayer);
		const r = rollouts('incident').rows.find((x) => x.state === 'awaiting-approval' && x.needsYou)!;
		last = approvalTarget(r, 'incident')!;
		const before = rollouts('incident').rows.filter((x) => x.state === 'awaiting-approval').length;
		askApprove(last, null);
		confirmApprove(reply({}));
		await tick();
		undoApprove(reply({}));
		await new Promise((res) => setTimeout(res, 30));
		expect(rollouts('incident').rows.filter((x) => x.state === 'awaiting-approval').length).toBe(before);
		expect(approvalUi.done).toBeNull();
	});
	/** a two-place target out of the first approvable row: the second place is a copy under another tag */
	const twoPlaces = () => {
		const r = rollouts('incident').rows.find((x) => x.state === 'awaiting-approval' && x.needsYou)!;
		const t = approvalTarget(r, 'incident')!;
		return { ...t, places: [t.places[0], { ...t.places[0], tag: `${t.places[0].tag}-b` }] } as NonNullable<typeof last>;
	};
	it('one rejected revoke re-grants that place and shows an error toast, the other place stays reverted', async () => {
		render(ApprovalLayer);
		last = twoPlaces();
		askApprove(last, null);
		let calls = 0;
		const f = (async () => { calls++; if (calls === 3) return new Response('{"error":"boom"}', { status: 500 }); return new Response('{}'); }) as unknown as typeof fetch;
		confirmApprove(f);
		await tick();
		undoApprove(f);
		await new Promise((res) => setTimeout(res, 30));
		await tick();
		expect(approvalUi.done?.error).toBe('boom');
		expect(document.querySelector('[data-approve-toast]')?.textContent).toMatch(/boom/);
		expect(approvalUi.done?.still).toBeUndefined();
	});
	it('a stillApproved place is re-granted while the other place reverts', async () => {
		render(ApprovalLayer);
		last = twoPlaces();
		askApprove(last, null);
		let calls = 0;
		const f = (async () => { calls++; return new Response(calls === 3 ? '{"stillApproved":true,"approvals":[{"name":"g"}]}' : '{}'); }) as unknown as typeof fetch;
		confirmApprove(f);
		await tick();
		undoApprove(f);
		await new Promise((res) => setTimeout(res, 30));
		expect(approvalUi.done?.still?.who).toBeTruthy();
		expect(approvalUi.done?.error).toBeNull();
	});
	it('a late stillApproved never overwrites another build\'s toast', async () => {
		render(ApprovalLayer);
		last = twoPlaces();
		askApprove(last, null);
		let release: () => void = () => {};
		const gate = new Promise<void>((r) => (release = r));
		let calls = 0;
		const f = (async () => { calls++; if (calls <= 2) return new Response('{}'); await gate; return new Response('{"stillApproved":true,"approvals":[]}'); }) as unknown as typeof fetch;
		confirmApprove(f);
		await tick();
		undoApprove(f);
		const other = { ...last, key: 'someone-else', build: 'zzz' } as NonNullable<typeof last>;
		approvalUi.done = { target: other, error: null };
		release();
		await new Promise((res) => setTimeout(res, 30));
		expect(approvalUi.done?.target.key).toBe('someone-else');
		approvalUi.done = null;
	});
});
