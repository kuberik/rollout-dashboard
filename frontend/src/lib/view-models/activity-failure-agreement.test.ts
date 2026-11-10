import { describe, expect, it } from 'vitest';
import { respond } from '../demo/respond';
import { resetDemoState } from '../demo/state';
import { buildRolloutCards } from '../rollout-cards';
import { blockedFact, blockedKindOf } from '../components/BlockedRow.svelte';
import { activityKindOf } from './activity-kind';
import { activityVerb } from './activity-verb';
import type { Environment, Rollout } from '../../types';

/**
 * ⭐ ONE EVENT, ONE STORY. (2026-10-11, demo/chain-order.) The Needs-you row
 * and the activity sentence for `checkout-worker-staging`'s `incident` head
 * entry used to disagree: the row said "Healthcheck failed", the activity
 * feed said "checkout-worker failed to deploy" — the SAME failing deploy,
 * named a health-check problem on one page and a deploy problem on the
 * other. Both now read `categorizeFailure(bakeStatusMessage)`
 * (`BlockedRow`'s `card.failureCategory`, `activityKindOf`'s own new
 * parameter), so they cannot disagree again.
 */
describe('Needs-you fact and activity sentence agree on why a deploy failed', () => {
	it("incident's health-check failure: both name the health check, neither says \"deploy\"", () => {
		resetDemoState('incident');
		const body = JSON.parse(respond('GET', '/api/rollouts').body ?? '{}') as {
			rollouts: { items: Rollout[] };
			environments: { items: Environment[] };
		};
		const cards = buildRolloutCards(body.rollouts.items, body.environments.items, new Date());
		const card = cards.find(
			(c) => c.name === 'checkout-worker' && c.ns === 'checkout-worker-staging'
		);
		expect(card, 'checkout-worker/staging must exist in the incident fixture').toBeTruthy();
		expect(card!.bakeStatus).toBe('Failed');
		expect(card!.failureCategory).toBe('healthcheck');

		const kind = blockedKindOf(card!);
		const fact = blockedFact(card!, kind);
		expect(fact.toLowerCase()).toContain('health check');
		expect(fact.toLowerCase()).not.toContain('deploy');

		const head = card!.rollout.status!.history![0];
		const activityKind = activityKindOf({
			bakeStatus: head.bakeStatus,
			bakeStatusMessage: head.bakeStatusMessage,
			isRollback: false,
			actorKind: 'controller',
			envRank: 2,
			firstEnvRank: 1
		});
		expect(activityKind).toBe('failedHealthCheck');
		const sentence = activityVerb(activityKind).appVerb;
		expect(sentence.toLowerCase()).toContain('health check');
		expect(sentence.toLowerCase()).not.toContain('deploy');
	});

	it('a genuine deploy failure (no health-check message): both say it failed to deploy', () => {
		const card = {
			name: 'example-app',
			ns: 'example-app-prod',
			envDisplay: 'prod',
			statusKey: 'failed' as const,
			checkFailure: null,
			failureCategory: 'failed' as string | null,
			version: 'abc1234',
			timestamp: new Date().toISOString(),
			stuck: null,
			rollout: {
				metadata: { name: 'example-app', namespace: 'example-app-prod' },
				status: { history: [{ version: { tag: 'abc1234', version: 'abc1234' }, bakeStatus: 'Failed' }] }
			}
		} as unknown as Parameters<typeof blockedFact>[0];

		const kind = blockedKindOf(card);
		const fact = blockedFact(card, kind);
		expect(fact.toLowerCase()).toContain('deploy');
		expect(fact.toLowerCase()).not.toContain('health check');

		const activityKind = activityKindOf({
			bakeStatus: 'Failed',
			bakeStatusMessage: 'image pull failed: manifest unknown',
			isRollback: false,
			actorKind: 'controller',
			envRank: 1,
			firstEnvRank: 1
		});
		expect(activityKind).toBe('failed');
		const sentence = activityVerb(activityKind).appVerb;
		expect(sentence.toLowerCase()).toContain('deploy');
		expect(sentence.toLowerCase()).not.toContain('health check');
	});
});
