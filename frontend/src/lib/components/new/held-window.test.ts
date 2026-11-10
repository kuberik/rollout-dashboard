import { describe, it, expect, afterEach } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { heldCauses, windowCause } from './data';

afterEach(() => installLiveSource(null));

const window_ = (nextTransition: string | null) => new Map([['staging', { rolloutSchedules: { items: [{ metadata: { name: 'business-hours', namespace: 'orders-api-staging' }, spec: { action: 'Allow' }, status: { active: false, nextTransition, managedGates: ['integration-tests'] } }] }, clusterRolloutSchedules: { items: [] } }]]);
const orders = (cs: ReturnType<typeof heldCauses>) => cs.find((c) => c.rows.some((r) => r.href.includes('orders-api-staging')));

describe('a closed deploy window says the window', () => {
	it('without the schedule join the gate reads as a check (the defect)', () => {
		installLiveSource({ ...fixtureSource(), schedules: null } as never);
		expect(orders(heldCauses('incident'))?.cause).toBe('Waiting on Integration tests');
	});
	it('with the schedule join the hold is the deploy window and its clock', () => {
		installLiveSource({ ...fixtureSource(), schedules: window_('2026-11-16T09:00:00Z') } as never);
		const c = orders(heldCauses('incident'));
		expect(c?.cause).toMatch(/^Deploy window opens .*\d{2}:\d{2}/);
		expect(c?.cause).not.toMatch(/check|Gate|Integration/);
	});
	it('a window with no published transition still says window', () => {
		installLiveSource({ ...fixtureSource(), schedules: window_(null) } as never);
		expect(orders(heldCauses('incident'))?.cause).toBe('Waiting for the deploy window');
	});
});

describe('windowCause', () => {
	it('names the opening time, else the window', () => {
		expect(windowCause({ label: 'x', opensAt: '2026-11-16T09:00:00Z' }, new Date('2026-11-14T00:00:00Z'))).toMatch(/^Deploy window opens \w{3} \d{2}:\d{2}/);
		expect(windowCause(undefined)).toBe('Waiting for the deploy window');
	});
});
