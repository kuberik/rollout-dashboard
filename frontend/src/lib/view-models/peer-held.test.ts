import { describe, expect, it } from 'vitest';
import { peerHeldMap, placeVerdictHeld } from './home-model';
import type { RolloutCard } from '../rollout-cards';

/* a place still baking its own build: the frontier read (`held`) refuses the next build, the place verdict says Checking */
const baking = { held: true, heldCause: 'dependency', heldCauseLabel: 'payments-svc', bakeStatus: 'InProgress', statusKey: 'deploying', checkFailure: null, rolledBack: false, stuck: null, version: '4.42.0-42', pinnedVersion: null, rank: { kind: 'newest' } } as unknown as RolloutCard;
const waiting = { ...baking, bakeStatus: 'Succeeded', statusKey: 'succeeded', rank: { kind: 'behind', by: 2 } } as unknown as RolloutCard;

describe('the Gates tab neighbour tile reads the place verdict, not the frontier', () => {
	it('a place that is Checking is not held, though card.held is true (us-east-2 on checkout-api)', () => {
		expect(baking.held).toBe(true);
		expect(placeVerdictHeld(baking)).toBe(false);
		expect(peerHeldMap(new Map([['prod-us-east-2', baking]])).get('prod-us-east-2')?.held).toBe(false);
	});
	it('a place the verdict holds stays held, with its cause label', () => {
		const m = peerHeldMap(new Map([['staging', waiting]]));
		expect(m.get('staging')).toEqual({ held: true, causeLabel: 'payments-svc' });
	});
});
