import { describe, it, expect, afterEach } from 'vitest';
import { installLiveSource } from '$lib/components/home/sketch/fleet-source.svelte';
import { fixtureSource } from '$lib/components/home/sketch/home-data';
import { heldCauses, windowCause, windowOpens } from './data';

afterEach(() => installLiveSource(null));

const window_ = (nextTransition: string | null) => new Map([['staging', { rolloutSchedules: { items: [{ metadata: { name: 'business-hours', namespace: 'orders-api-staging' }, spec: { action: 'Allow' }, status: { active: false, nextTransition, managedGates: ['integration-tests'] } }] }, clusterRolloutSchedules: { items: [] } }]]);
const orders = (cs: ReturnType<typeof heldCauses>) => cs.find((c) => c.rows.some((r) => r.href.includes('orders-api-staging')));

describe('a closed deploy window says the window', () => {
	it('without the schedule join the gate reads as a check (the defect)', () => {
		installLiveSource({ ...fixtureSource(), schedules: null } as never);
		expect(orders(heldCauses('incident'))?.cause).toBe('Waiting on Integration tests');
	});
	it('with the schedule join the hold names the window like a row does, and its clock is its own clause', () => {
		installLiveSource({ ...fixtureSource(), schedules: window_('2026-11-16T09:00:00Z') } as never);
		const c = orders(heldCauses('incident'));
		expect(c?.cause).toBe('Held by Business hours');
		expect(c?.window?.opens).toMatch(/^opens \w{3} \d{2}:\d{2}/);
		expect(c?.cause).not.toMatch(/check|Gate|Integration/);
	});
	it('a window with no published transition is still named, with no opening clause', () => {
		installLiveSource({ ...fixtureSource(), schedules: window_(null) } as never);
		const c = orders(heldCauses('incident'));
		expect(c?.cause).toBe('Held by Business hours');
		expect(c?.window?.opens).toBeNull();
	});
});

describe('windowCause', () => {
	it('is the one window wording: the published name, else "Waits for the deploy window"; the clock is a separate clause', () => {
		expect(windowCause({ label: 'Business Hours Only', opensAt: '2026-11-16T09:00:00Z' })).toBe('Held by Business Hours Only');
		expect(windowCause({ label: 'Gate', opensAt: null })).toBe('Waits for the deploy window');
		expect(windowCause({ label: 'deploy window', opensAt: null })).toBe('Waits for the deploy window');
		expect(windowCause(undefined)).toBe('Waits for the deploy window');
		expect(windowOpens({ label: 'x', opensAt: '2026-11-16T09:00:00Z' }, new Date('2026-11-14T00:00:00Z'))).toMatch(/^opens \w{3} \d{2}:\d{2}/);
		expect(windowOpens(undefined)).toBeNull();
	});
});
