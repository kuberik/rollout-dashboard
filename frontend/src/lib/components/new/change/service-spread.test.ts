import { it, expect } from 'vitest';
import { servicesOf, spreadOf, type Svc } from './service-spread';
import { changes } from '../data';
import { findChange, classified } from './detail-model';

/* platform-telemetry #20 ships as four services at four positions (mock incident + calm) */
it.each(['incident', 'calm'] as const)('#20 spread %s', (s) => {
	const c = changes(s, { rolledBackLands: true }).items.find((i) => i.repo === 'platform-telemetry' && i.prNumber === 20)!;
	const S = servicesOf(c, s)!;
	const by = (a: string) => S.find((x) => x.app === a)!;
	expect(S.length).toBe(4);
	expect(by('telemetry-worker')).toMatchObject({ tier: 'dev', state: 'checking', done: false });
	expect(by('telemetry-indexer')).toMatchObject({ tier: 'dev', state: 'approval', next: 'prod' });
	expect(by('telemetry-collector').done).toBe(true);
	expect(by('telemetry-forwarder').done).toBe(true);
	expect(spreadOf(S)).toMatchObject({ col: 'dev', state: 'approval', service: 'telemetry-indexer' });
	const { unaffected } = classified(c, s);
	expect(unaffected.find((p) => p.app === 'telemetry-indexer' && p.tier === 'prod')).toBeUndefined();
});
it('spread: a failing service leads', () => {
	const S = (app: string, tier: string, state: Svc['state'], done = false): Svc => ({ app, tier, state, next: null, since: null, href: null, done });
	expect(spreadOf([S('a', 'prod', 'landed', true), S('b', 'staging', 'failed'), S('c', 'dev', 'checking')])).toMatchObject({ col: 'dev', state: 'failed', service: 'b', inLast: 1 });
	expect(spreadOf([S('a', 'prod', 'landed', true), S('b', 'prod', 'landed', true)])).toMatchObject({ col: 'prod', inLast: 2 });
});
