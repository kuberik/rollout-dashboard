import { describe, it, expect, afterEach } from 'vitest';
import { ago, pinSinceOfHref } from './data';
import { rolloutsPage } from './rollouts-page';
import { pinSince } from '$lib/view-models/pin-hold';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { source, resetHomeModel } from '$lib/components/home/sketch/home-data';

afterEach(() => { installLiveSource(null); resetHomeModel(); });

describe('when a pin started holding is one fact: the pin / rollback event time', () => {
	const rollout = () => (source().rollouts as unknown as { metadata: { namespace: string }; status: { history: { timestamp: string; message?: string }[] } }[]).find((r) => r.metadata.namespace === 'checkout-api-prod-af-south-1')!;
	it('pinSince reads the rollback entry, not the deploy or the arrival', () => {
		const r = rollout();
		const ev = r.status.history.find((h) => /^Rolled back/.test(h.message ?? ''))!;
		expect(pinSince(r as never)).toBe(ev.timestamp);
	});
	it('no pin event in the history: null, never a guessed time', () => {
		expect(pinSince({ status: { history: [{ timestamp: '2026-01-01T00:00:00Z', message: 'Deployed' }] } } as never)).toBeNull();
		expect(pinSince(null)).toBeNull();
	});
	it('/rollouts Held row == app-page Holding row == rollout page (checkout-api af-south-1): the printed age and the time', () => {
		const held = rolloutsPage('incident').groups.find((g) => g.key === 'held')!.rows.find((r) => r.app === 'checkout-api' && r.href.includes('af-south-1'))!;
		const onRolloutPage = pinSince(rollout() as never);
		const onAppPage = pinSinceOfHref(held.href);
		expect(onRolloutPage).toBeTruthy();
		expect(onAppPage).toBe(onRolloutPage);
		expect(held.row.since).toBe(onRolloutPage);
		expect(held.age).toBe(ago(onRolloutPage));
	});
});
