import { expect, it } from 'vitest';
import { currentRowChip, deploysFailedParts } from './history-current-chip';
import { rolloutStateChip } from './rollout-state-chip';

it('currency only for a healthy current row, in the neutral count chip (QA2 #9)', () => {
	expect(currentRowChip('Succeeded', 0)).toEqual({ role: 'count', label: 'Up to date' });
	expect(currentRowChip('Succeeded', 7)).toEqual({ role: 'count', label: '7 builds behind' });
	expect(currentRowChip('Cancelled', 0)).toBeNull();
	expect(currentRowChip(undefined, 0)).toBeNull();
});

it('the Deploys "N failed" rollup splits failing / failed with the shared ink', () => {
	const off = { open: false, failingNow: false, recovered: false };
	// a check failing now: the open failure reads failing in danger ink, the older ones failed in neutral ink
	expect(deploysFailedParts(3, { open: true, failingNow: true, recovered: false })).toEqual([{ text: '1 failing', ink: 'text-danger' }, { text: '2 failed', ink: 'text-fg-muted' }]);
	expect(deploysFailedParts(1, { open: true, failingNow: true, recovered: false })).toEqual([{ text: '1 failing', ink: 'text-danger' }]);
	// recovered: failed in neutral ink, never danger
	expect(deploysFailedParts(2, { open: true, failingNow: false, recovered: true })).toEqual([{ text: '2 failed', ink: 'text-fg-muted' }]);
	// no health check involved: a failed deploy stays failed, in danger ink
	expect(deploysFailedParts(1, { open: true, failingNow: false, recovered: false })).toEqual([{ text: '1 failed', ink: 'text-danger' }]);
	// superseded failures are neutral
	expect(deploysFailedParts(2, off)).toEqual([{ text: '2 failed', ink: 'text-fg-muted' }]);
	expect(deploysFailedParts(0, off)).toEqual([]);
});

it('a failed or in-flight current row prints the header pill: same role, same word (visual audit #3)', () => {
	for (const s of ['Failed', 'InProgress', 'BakeTimeRetrying', 'Deploying']) {
		const head = rolloutStateChip(s);
		expect(currentRowChip(s, 3), s).toEqual({ role: head.role, label: head.label });
	}
	/* the one that shipped: grey `count` "Failing" under a red `failing` "failed" header */
	expect(currentRowChip('Failed', 0)).toEqual({ role: 'failing', label: 'failed' });
	/* a state is never drawn in the count chip */
	for (const s of ['Failed', 'InProgress', 'Deploying']) expect(currentRowChip(s, 0)?.role).not.toBe('count');
});

it('a paused bake prints the header pill: held "paused", through the same call with the same hold inputs', () => {
	const hold = { bakeHoldStartTime: '2026-11-17T10:00:00Z' };
	expect(rolloutStateChip('InProgress', hold)).toMatchObject({ role: 'held', label: 'paused' });
	expect(currentRowChip('InProgress', 0, hold)).toEqual({ role: 'held', label: 'paused' });
	/* a failed bake is failed on both, whether or not its checks have recovered since (the lastErrorTime witness keeps it failed) */
	expect(currentRowChip('Failed', 0, hold)).toEqual({ role: 'failing', label: 'failed' });
	expect(currentRowChip('Failed', 0, { bakeHoldStartTime: null })).toEqual({ role: 'failing', label: 'failed' });
});

it('a failed head whose check fails right now reads "failing" on the row, as on the header', () => {
	expect(rolloutStateChip('Failed', null, true)).toMatchObject({ role: 'failing', label: 'failing' });
	expect(currentRowChip('Failed', 0, null, true)).toEqual({ role: 'failing', label: 'failing' });
});

it('a failed head whose checks have recovered reads "failed" on the row, as on the header', () => {
	expect(rolloutStateChip('Failed', null, false)).toMatchObject({ role: 'failing', label: 'failed' });
	expect(currentRowChip('Failed', 0, null, false)).toEqual({ role: 'failing', label: 'failed' });
});
