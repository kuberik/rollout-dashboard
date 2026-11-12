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
	/* LOW-4 of #124: a place folded into a multi-region row (heldCauses row.hrefs, not row.href) is named by the same cause as the row's lead place.
	   checkout-api prod: ap-southeast-2 leads the row and us-east-1 is folded into r.hrefs; with no verdict and no gate object, only the hrefs fold can name it. */
	it('checkout-api prod us-east-1 (folded into the row\'s hrefs, no verdict, no gate object): rule hold named payments-svc', () => {
		resetHomeModel();
		const LEAD = '/rollouts/prod/checkout-api-prod-ap-southeast-2/checkout-api';
		const FOLDED = '/rollouts/prod/checkout-api-prod-us-east-1/checkout-api';
		const row = heldCauses('incident').flatMap((h) => h.rows).find((r) => r.app === 'checkout-api' && r.hrefs?.includes(FOLDED))!;
		expect(row.href).toBe(LEAD);
		expect(row.href).not.toBe(FOLDED);
		for (const a of homeModel('incident').apps) for (const e of a.envs) if (e.href === FOLDED) (e as { placeVerdict?: unknown }).placeVerdict = undefined;
		for (const x of source().rollouts as unknown as { metadata: { namespace: string; name: string }; status: { gates?: unknown[] } }[]) if (x.metadata.name === 'checkout-api' && x.metadata.namespace === 'checkout-api-prod-us-east-1') x.status.gates = [];
		const p = placeHolds('checkout-api', 'incident').find((x) => x.href === FOLDED)!;
		expect(p.state).toBe('held-by-rule');
		expect(p.holdReason).toBe('rule');
		expect(p.gate?.name).toBe('payments-svc');
	});
});
