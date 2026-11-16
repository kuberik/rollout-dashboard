import { describe, it, expect } from 'vitest';
import { currentRowChip, liveStatusVerb, pausedRollup } from './history-current-chip';
import { heldCheckSnaps } from './health-failures';
import { activityKindOf } from './activity-kind';
import { activityVerb } from './activity-verb';
import { holdRows } from '$lib/components/new/app/app-model';

const held = { bakeStatus: 'InProgress', bakeHoldStartTime: '2026-10-10T11:30:00Z' };

describe('history wording for a held bake', () => {
	it('the current-row chip says Paused, and Checking without a hold', () => {
		expect(currentRowChip('InProgress', null, true)).toBe('Paused');
		expect(currentRowChip('InProgress', null)).toBe('Checking');
		expect(currentRowChip('Failed', null, true)).toBe(currentRowChip('Failed', null));
	});
	it('the live line counts from the hold start', () => {
		expect(liveStatusVerb(held)).toEqual({ word: 'Paused for', since: 'hold' });
		expect(liveStatusVerb({ bakeStatus: 'InProgress' })).toEqual({ word: 'Checking for', since: 'deploy' });
		expect(liveStatusVerb({ bakeStatus: 'Failed', bakeHoldStartTime: held.bakeHoldStartTime })).toBeNull();
	});
	it('the Deploys rollup names the pause and the pending check', () => {
		expect(pausedRollup(1)).toEqual([{ text: 'Bake paused', ink: 'text-held' }, { text: '1 check pending', ink: 'text-fg-muted' }]);
		expect(pausedRollup(2).map((p) => p.text)).toEqual(['Bake paused', '2 checks pending']);
		expect(pausedRollup(0)).toEqual([{ text: 'Bake paused', ink: 'text-held' }]);
	});
	it('the evidence is the live checks that are not Healthy', () => {
		const live = [
			{ metadata: { name: 'ok', namespace: 'n' }, status: { status: 'Healthy' } },
			{ metadata: { name: 'flux', namespace: 'n' }, status: { status: 'Pending', message: 'waiting' } }
		] as never;
		expect(heldCheckSnaps(live)).toEqual([{ name: 'flux', namespace: 'n', message: 'waiting' }]);
	});
});

describe('activity: a held bake is its own kind', () => {
	const base = { bakeStatus: 'InProgress', isRollback: false, actorKind: 'controller' as const, envRank: 1, firstEnvRank: 1 };
	it('paused only when InProgress and held; failed wins', () => {
		expect(activityKindOf({ ...base, bakePaused: true })).toBe('paused');
		expect(activityKindOf(base)).toBe('checking');
		expect(activityKindOf({ ...base, bakeStatus: 'Failed', bakePaused: true })).toBe('failed');
	});
	it('reads in the held tone', () => {
		expect(activityVerb('paused').tone).toBe('paused');
	});
});

describe('the Holding card lists a paused bake', () => {
	it('one row per paused place, not for a pinned one', () => {
		const p = (place: string) => ({ place, href: `/r/${place}`, state: 'checking', bakePaused: true, heldBuilds: [], newerShown: [] }) as never;
		const rows = holdRows([], [p('prod')], null, 'inventory-api');
		expect(rows.map((r) => r.name)).toEqual(['inventory-api prod: bake paused, waiting on a health check']);
		expect(rows[0].holding).toBe(true);
		expect(holdRows([], [p('prod')], null, 'inventory-api', new Set(['prod'])).some((r) => r.kind === 'paused')).toBe(false);
	});
});

describe('health-failures clock honours the display zone', () => {
	it('prints the same HH:MM the history page does (UTC here)', async () => {
		const { clock } = await import('./health-failures');
		expect(clock('2026-10-10T11:05:00Z')).toMatch(/^\d{2}:\d{2}$/);
	});
});
