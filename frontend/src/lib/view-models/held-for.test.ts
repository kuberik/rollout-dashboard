import { describe, expect, it } from 'vitest';
import type { RolloutCard } from '$lib/rollout-cards';
import { heldFor, waitingSince } from './held-for';

const NOW = Date.UTC(2026, 9, 10, 12);
const H = 3_600_000;

/** A card in the state `nodeState` reads: held = healthy, behind, gate-held. */
function card(app: string, env: string, opts: { held?: boolean; checking?: boolean; waitingH?: number } = {}): RolloutCard {
	return {
		name: app,
		envName: env,
		envDisplay: env,
		statusKey: 'succeeded',
		stuck: null,
		checkFailure: null,
		bakeStatus: opts.checking ? 'InProgress' : 'Succeeded',
		held: !!opts.held,
		pinnedVersion: null,
		rank: opts.held ? { kind: 'behind', by: 1 } : { kind: 'newest' },
		rollout: {
			status: {
				history: [{ version: { tag: 'v1', version: 'v1' } }],
				availableReleases: [{ tag: 'v1', version: 'v1' }, { tag: 'v2', version: 'v2', created: new Date(NOW - (opts.waitingH ?? 1) * H).toISOString() }]
			}
		}
	} as unknown as RolloutCard;
}

describe('heldFor', () => {
	it('counts held apps and places with the map\'s own predicate', () => {
		const r = heldFor(
			[card('api', 'staging', { held: true, waitingH: 2 }), card('api', 'prod', { held: true, waitingH: 6 }), card('web', 'prod', { held: true, waitingH: 4 }), card('job', 'dev')],
			NOW
		);
		expect(r.apps).toBe(2);
		expect(r.places).toBe(3);
		expect(r.medianMs).toBe(4 * H);
		expect(r.longestMs).toBe(6 * H);
		expect(r.longestSubject).toEqual({ app: 'api', env: 'prod' });
	});
	it('a held rollout that is checking is checking, not held (in progress there)', () => {
		const r = heldFor([card('api', 'dev', { held: true, checking: true })], NOW);
		expect(r.places).toBe(0);
		expect(r.medianMs).toBeNull();
	});
	it('the wait starts when the oldest newer build was released', () => {
		expect(waitingSince(card('api', 'dev', { held: true, waitingH: 3 }))).toBe(NOW - 3 * H);
	});
	it('an app is held only when its lane leads with held (its Fleet row reads Held) — ⭐ shared/fleet-facts-ids (2026-10-11): an app with NO Environment at all is judged by its own worst place instead, and counts too', () => {
		const failedCard = { ...card('job', 'prod'), statusKey: 'failed' } as unknown as RolloutCard;
		const noEnv = { ...card('orphan', '', { held: true }), envName: '', envDisplay: '' } as unknown as RolloutCard;
		const r = heldFor([card('api', 'dev', { held: true }), card('job', 'staging', { held: true }), failedCard, noEnv], NOW);
		// job is failing in prod (worst wins, so its staging hold does not make
		// it an "app held"); orphan has no environment anywhere, so it has no
		// lane — its own worst place (held) is what counts it here now, same
		// as a real dependency-contract hold on an unmapped consumer.
		expect(r.apps).toBe(2);
		// places are the map's held blocks: api in dev and job's held block in staging
		expect(r.places).toBe(2);
	});
});
