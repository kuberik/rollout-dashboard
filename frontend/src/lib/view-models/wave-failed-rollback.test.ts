import { afterEach, describe, expect, it } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { placeHolds } from '$lib/components/new/data';
import { waveHeldRegions } from '$lib/components/new/environments-page';

/**
 * batch4 #3c (landing truth verify, t=33 -> t=46). Phase 1, right after the catch: us-east-1 still RUNS the failed build, so the wave holds the
 * four wave-2 regions ("4 regions held · us-east-1 failed the bake"). Phase 2, after rollback + pin: us-east-1 runs its older build again; the
 * failed build is not a candidate anywhere (#82) so nothing refuses the wave-2 regions any more and the line must clear.
 */
const probe = () => {
	const fx = fixtureSource();
	const P = placeHolds('checkout-api', 'incident');
	return { fx, P };
};
const twoPhase = (phase: 'catch' | 'rolledBack') => {
	const { fx, P } = probe();
	const lead = P.find((p) => p.label === 'ap-southeast-2')!; /* wave-2 leader of checkout-api's prod; us-east-1, us-east-2 follow it */
	const first = P.find((p) => p.label === 'eu-central')!; /* wave 1: the site that fails the bake */
	const part = (href: string) => { const [, , ns, name] = href.split('/').filter(Boolean); return { ns, name }; };
	const L = part(lead.href), F = part(first.href);
	const rev = 'eeeeeee0000000';
	const rolloutsRaw = fx.rollouts as any[];
	const leadRaw = rolloutsRaw.find((r) => r.metadata.namespace === L.ns && r.metadata.name === L.name);
	const firstRaw = rolloutsRaw.find((r) => r.metadata.namespace === F.ns && r.metadata.name === F.name);
	const failedV = { ...leadRaw.status.releaseCandidates[0], revision: rev };
	const older = firstRaw.status.currentVersion;
	const wave2 = new Set(P.filter((p) => p.wave?.wave === 2).map((p) => `${part(p.href).ns}/${part(p.href).name}`));
	const rollouts = rolloutsRaw.map((r) => {
		if (wave2.has(`${r.metadata.namespace}/${r.metadata.name}`)) return { ...r, status: { ...r.status, releaseCandidates: [failedV], gates: [{ name: 'promotion-staging', kind: 'promotion', passing: true, allowedVersions: ['b-44'] }] } };
		if (r === leadRaw) return { ...r, status: { ...r.status, releaseCandidates: [failedV] } };
		if (r === firstRaw) return { ...r, status: { ...r.status, currentVersion: phase === 'catch' ? (failedV.tag ?? failedV.version) : older, releaseCandidates: [failedV], history: [...(phase === 'rolledBack' ? [{ bakeStatus: 'Succeeded', version: (r.status.history ?? [])[0]?.version ?? failedV, timestamp: new Date().toISOString() }] : []), { bakeStatus: 'Failed', version: failedV, timestamp: new Date(Date.now() - 60000).toISOString() }, ...(r.status.history ?? [])] } };
		return r;
	});
	const environments = (fx.environments as any[]).map((e) => (e.metadata.namespace === L.ns && e.spec?.rolloutRef?.name === L.name
		? { ...e, status: { ...e.status, conditions: [{ type: 'WaveReady', status: 'False', reason: 'WaitingFor', message: 'bake failed' }], wave: { ...(e.status?.wave ?? {}), blocker: { reason: 'WaitingFor', environment: 'prod', site: first.label, waitingOn: 'Bake', revision: rev } } } }
		: e));
	installLiveSource({ ...fx, rollouts, environments } as any);
	return { lead, first };
};
describe('the wave hold ends when the failed build is rolled back from', () => {
	afterEach(() => installLiveSource(null));
	it('phase 1 (catch): the failing site still runs the build, the leader is held by the wave', () => {
		const { lead } = twoPhase('catch');
		expect(placeHolds('checkout-api', 'incident').find((p) => p.label === lead.label)!.upstreamFailed).toBeTruthy();
	});
	it('phase 2 (rolled back + pinned): nothing holds the leader by the wave', () => {
		const { lead } = twoPhase('rolledBack');
		const p = placeHolds('checkout-api', 'incident').find((x) => x.label === lead.label)!;
		expect(p.upstreamFailed ?? null).toBeNull();
		expect(p.heldBuilds).toEqual([]);
	});
	it('Production tile text model: the held line shows in phase 1 and clears in phase 2 (M2: placeHolds -> waveHeldRegions on fixture data, real blocker shapes)', () => {
		/* the wave-2 places read healthy on the landing fleet (the incident fixture parks them in other states); the tile's own rule runs on the real holds */
		const holds = (a: string) => placeHolds(a, 'incident').map((p) => ({ ...p, state: 'healthy' as const }));
		const at = () => waveHeldRegions('incident', new Set(['ap-southeast-2', 'us-east-1', 'us-east-2']), holds, ['checkout-api']);
		const { lead } = twoPhase('catch');
		expect(holds('checkout-api').find((p) => p.label === lead.label)!.holdReason).toBe('rule');
		const r1 = at();
		expect(r1.held?.because).toBe('eu-central failed the bake');
		expect([...r1.held!.labels]).toContain('ap-southeast-2');
		twoPhase('rolledBack');
		const r2 = at();
		expect(r2.held).toBeNull();
		expect([...(r2.waiting?.labels ?? [])]).not.toContain('ap-southeast-2');
	});
	it('a plain wave-order wait (no failure anywhere) is neutral: waiting, never held', () => {
		const P = (l: string, w: number, leader: boolean) => ({ wave: { site: l, wave: w, leader, follows: leader ? null : 'a', multi: true }, env: l, label: l, place: l, tier: 'prod', state: 'healthy', href: `/r/${l}`, deployedBuild: 'b-45', holdReason: 'rule', gate: { name: 'Promotion gate', sentence: '', promotion: true }, upstreamFailed: null, heldBuilds: [{ build: 'b-46' }], runs: 'b-45' }) as never;
		const ps = [P('us-east-1', 1, true), P('eu-west-1', 2, true)];
		const r = waveHeldRegions('incident', new Set(['eu-west-1']), () => ps, ['app'], () => false);
		expect(r.held).toBeNull();
		expect(r.waiting?.because).toBe('waiting for us-east-1');
	});
});
