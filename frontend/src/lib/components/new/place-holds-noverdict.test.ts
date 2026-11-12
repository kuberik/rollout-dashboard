import { describe, it, expect, afterEach } from 'vitest';
import { placeHolds, heldCauses } from './data';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { source, homeModel, resetHomeModel } from '$lib/components/home/sketch/home-data';

/**
 * A place the model holds by a rule while NO verdict and NO gate object describe it (the dashboard mock: a dependency is a
 * RolloutDependency join, not a gate) is a rule hold named by the held cause the banner prints, never "Health checks".
 */
afterEach(() => { installLiveSource(null); resetHomeModel(); });
const STAGING = '/rollouts/staging/checkout-api-staging/checkout-api';

describe('placeHolds without a verdict', () => {
	it('checkout-api staging: rule hold named payments-svc, the same cause the banner reads', () => {
		resetHomeModel();
		for (const a of homeModel('incident').apps) for (const e of a.envs) if (e.href === STAGING) (e as { placeVerdict?: unknown }).placeVerdict = undefined;
		for (const x of source().rollouts as unknown as { metadata: { namespace: string; name: string }; status: { gates?: unknown[] } }[]) if (x.metadata.name === 'checkout-api' && /staging/.test(x.metadata.namespace)) x.status.gates = [];
		const p = placeHolds('checkout-api', 'incident').find((x) => x.href === STAGING)!;
		expect(p.state).toBe('held-by-rule');
		expect(p.holdReason).toBe('rule');
		expect(p.gate?.name).toBe('payments-svc');
		expect(heldCauses('incident').some((h) => h.cause === 'Waiting on payments-svc' && h.rows.some((x) => x.href === STAGING))).toBe(true);
	});
});
